// StaleSignal: three Rovo actions that find stale Jira work and explain why
// each item stalled. Finding candidates uses Jira JQL (the right tool for
// "not updated in N days"); explaining them uses Teamwork Graph context
// (assignee's teams, recent commenters, linked goals).
//
// Every action answers JSON that Rovo turns into prose. Anything that might
// be partial goes into `notes`, and the agent prompt turns that into
// "this may be incomplete" instead of "there is nothing".

import api, { route } from "@forge/api";
import { twgAll, Q, userAri, workItemAri } from "./twg.js";

const log = (event, data) => console.log(JSON.stringify({ stalesignal: event, ...data }));

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATUS = /^(done|closed|resolved)$/i;

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

const daysSince = (isoDate) => {
  const ms = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / DAY_MS);
};

// Rovo puts the person chatting in payload.context.accountId.
const askerOf = (payload) => payload?.context?.accountId || null;

const issueKeyOf = (payload) =>
  String(payload?.issueKey || payload?.context?.jira?.issueKey || "").trim().toUpperCase();

// Jira REST: search issues with JQL. Returns { issues, total } or { error }.
async function searchIssues(jql, maxResults) {
  const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jql,
      fields: ["summary", "status", "assignee", "reporter", "updated", "issuelinks", "priority"],
      maxResults,
    }),
  });

  if (!res.ok) {
    return { error: `issue search failed (${res.status})` };
  }

  const body = await res.json();
  return { issues: Array.isArray(body.issues) ? body.issues : [], total: body.total || 0 };
}

const staleRow = (issue) => ({
  key: issue.key,
  summary: issue.fields?.summary || "",
  status: issue.fields?.status?.name || null,
  assignee: issue.fields?.assignee?.displayName || null,
  daysSinceUpdate: daysSince(issue.fields?.updated),
  webUrl: issue.self ? issue.self.replace(/\/rest\/api\/3\/issue\/.*$/, `/browse/${issue.key}`) : null,
});

// Action 1: find work items not updated in N days, optionally in one project.
export async function findStaleIssues(payload) {
  const t0 = Date.now();
  const notes = [];

  const days = clampInt(payload?.daysStale, 14, 1, 365);
  const maxResults = clampInt(payload?.maxResults, 10, 1, 25);
  const project = String(payload?.projectKey || "").trim().toUpperCase();
  if (project && !/^[A-Z][A-Z0-9]+$/.test(project)) {
    return { error: `"${payload.projectKey}" is not a valid project key. Use a key such as PROJ.` };
  }

  const jql = `${project ? `project = ${project} AND ` : ""}updated <= -${days}d AND statusCategory != Done ORDER BY updated ASC`;
  const result = await searchIssues(jql, maxResults);
  if (result.error) {
    return { error: result.error };
  }

  const items = result.issues.map(staleRow);
  if (result.total > items.length) {
    notes.push(`showing the ${items.length} stalest of ${result.total} matching items`);
  }

  log("find-stale-issues", { ms: Date.now() - t0, days, project: project || null, found: result.total });
  return { daysStale: days, project: project || null, staleCount: result.total, items, notes };
}

// Teams a person belongs to, via Teamwork Graph.
async function teamsOf(accountId, notes) {
  const r = await twgAll("userTeams", Q.userTeams, { userId: userAri(accountId) }, "atlassianUserInTeams");
  if (!r.ok) {
    notes.push(`teams could not be read: ${r.error}`);
  } else if (!r.complete) {
    notes.push("team list may be incomplete");
  }
  return r.nodes.map((t) => ({ id: t.id, name: t.displayName }));
}

// Action 2: explain why one work item stalled.
export async function explainStall(payload) {
  const t0 = Date.now();
  const notes = [];

  const key = issueKeyOf(payload);
  if (!key) {
    return { error: "Which work item? Give me a key such as PROJ-12, or open the item and ask again." };
  }

  // Jira REST first: a 404 tells the person plainly they cannot see the item,
  // and the response carries the numeric id the graph ARI needs.
  const res = await api.asUser().requestJira(
    route`/rest/api/3/issue/${key}?fields=summary,status,assignee,reporter,updated,issuelinks,priority`
  );
  if (res.status === 404) {
    return { error: `${key} does not exist or you cannot see it.` };
  }
  if (!res.ok) {
    return { error: `Could not read ${key} (${res.status}).` };
  }

  const issue = await res.json();
  const fields = issue.fields || {};
  const cloudId = payload?.context?.cloudId;
  const ari = workItemAri(cloudId, issue.id);
  const assignee = fields.assignee || null;

  const [comments, goals, assigneeTeams] = await Promise.all([
    twgAll("itemComments", Q.itemComments, { id: ari, since: "P90D" }, "jiraWorkItemComments"),
    twgAll("itemGoals", Q.itemGoals, { id: ari }, "jiraWorkItemGoals"),
    assignee ? teamsOf(assignee.accountId, notes) : Promise.resolve([]),
  ]);

  if (!comments.ok) notes.push(`comments could not be read: ${comments.error}`);
  if (!goals.ok) notes.push(`goals could not be read: ${goals.error}`);

  const days = daysSince(fields.updated);
  const openBlockers = (fields.issuelinks || [])
    .filter(
      (link) =>
        link.type?.inward?.toLowerCase().includes("blocked by") &&
        link.inwardIssue?.fields?.status &&
        !DONE_STATUS.test(link.inwardIssue.fields.status.name)
    )
    .map((link) => ({
      key: link.inwardIssue.key,
      summary: link.inwardIssue.fields.summary || "",
      status: link.inwardIssue.fields.status.name,
    }));

  const commenters = [...new Set(comments.nodes.map((c) => c.author?.name).filter(Boolean))];
  const lastCommentAt = comments.nodes.reduce(
    (latest, c) => (c.createdAt && (!latest || c.createdAt > latest) ? c.createdAt : latest),
    null
  );

  // Stall reasons, most telling first.
  const reasons = [];
  if (!assignee) {
    reasons.push({ code: "no-assignee", detail: "Nobody owns this item." });
  }
  if (openBlockers.length > 0) {
    reasons.push({
      code: "blocked",
      detail: `Blocked by ${openBlockers.length} open item(s): ${openBlockers.map((b) => b.key).join(", ")}.`,
    });
  }
  if (assigneeTeams.length >= 3) {
    reasons.push({
      code: "assignee-spread-thin",
      detail: `${assignee.displayName} belongs to ${assigneeTeams.length} teams (${assigneeTeams.map((t) => t.name).join(", ")}).`,
    });
  }
  if (comments.nodes.length === 0) {
    reasons.push({ code: "silent", detail: "No comments in the last 90 days." });
  }
  if (goals.nodes.length === 0) {
    reasons.push({ code: "no-goal", detail: "Not linked to any goal, so nothing pulls it forward." });
  }
  reasons.push({ code: "stale-since", detail: `Last updated ${days} day(s) ago.` });

  log("explain-stall", {
    ms: Date.now() - t0,
    key,
    days,
    blockers: openBlockers.length,
    comments: comments.nodes.length,
    goals: goals.nodes.length,
  });

  return {
    workItem: {
      key,
      summary: fields.summary || "",
      status: fields.status?.name || null,
      priority: fields.priority?.name || null,
      assignee: assignee?.displayName || null,
      reporter: fields.reporter?.displayName || null,
      daysSinceUpdate: days,
    },
    verdict: reasons[0]?.detail || "No clear stall signal found.",
    reasons,
    blockers: openBlockers,
    assigneeTeams: assigneeTeams.map((t) => t.name),
    commentersLast90Days: commenters,
    lastCommentAt,
    goals: goals.nodes.map((g) => ({ name: g.name, url: g.url })),
    notes,
  };
}

// Action 3: stale-work digest for a team the asker belongs to.
export async function staleTeamDigest(payload) {
  const t0 = Date.now();
  const notes = [];

  const asker = askerOf(payload);
  if (!asker) {
    return { error: "I could not tell who is asking." };
  }

  const days = clampInt(payload?.daysStale, 14, 1, 365);
  const wanted = String(payload?.team || "").trim().toLowerCase();

  // Curated queries start from a user id or a team id, not a team name, so
  // teams are found through the asker.
  const myTeams = await teamsOf(asker, notes);
  const team = wanted ? myTeams.find((t) => t.name.toLowerCase().includes(wanted)) : myTeams[0];

  if (!team && wanted) {
    return {
      error: `You are not in a team called "${payload.team}". Your teams: ${myTeams.map((t) => t.name).join(", ") || "none"}.`,
    };
  }
  if (!team) {
    return { error: "You are not in any Atlassian team yet.", notes };
  }

  const members = await twgAll("teamMembers", Q.teamMembers, { teamAri: team.id }, "atlassianTeamMembers");
  if (!members.ok) {
    return { error: `Members of ${team.name} could not be read: ${members.error}` };
  }

  // One small JQL search per member, sequentially, to stay inside Rovo's
  // per-action time budget and Jira's rate limits.
  const rows = [];
  for (const member of members.nodes.slice(0, 10)) {
    const safeId = String(member.accountId).replace(/"/g, '\\"');
    const result = await searchIssues(
      `assignee = "${safeId}" AND updated <= -${days}d AND statusCategory != Done ORDER BY updated ASC`,
      5
    );
    if (result.error) {
      notes.push(`stale work for ${member.name} could not be read: ${result.error}`);
      rows.push({ name: member.name, staleCount: null, stale: [] });
      continue;
    }
    rows.push({ name: member.name, staleCount: result.total, stale: result.issues.map(staleRow) });
  }

  if (members.nodes.length > 10) {
    notes.push(`showing 10 of ${members.nodes.length} members`);
  }

  const totalStale = rows.reduce((sum, r) => sum + (r.staleCount || 0), 0);
  log("stale-team-digest", { ms: Date.now() - t0, team: team.name, members: members.nodes.length, totalStale });

  return { team: team.name, daysStale: days, totalStale, members: rows, notes: [...new Set(notes)] };
}
