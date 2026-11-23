// Teamwork Graph client for StaleSignal's Forge backend functions.
//
// How the Teamwork Graph API behaves (verified against Atlassian's docs and a
// live-site walkthrough, Nov 2026):
// - Only curated GraphQL queries are accepted; raw Cypher at request time is refused.
// - Every operation needs a name shaped `[company]_[operation]` (company >= 3 chars,
//   operation >= 4 chars). A bad name comes back as HTTP 200 with a
//   DataFetchingException inside the body, so errors must be read from the body.
// - Curated connections return at most 25 rows per page; page with `after`.
// - A rate-limited call can return zero rows. "Empty plus errors" means
//   "could not read", never "nothing there".
// - requestTeamworkGraph exists on api.asUser() only: results are filtered to
//   what the person chatting can already see.

import api from "@forge/api";

const OP_PREFIX = "stalesignal_";
const PAGE_SIZE = 25;
const MAX_RETRIES = 3;

const TRANSIENT = /RATE_LIMIT|THROTTL|429|502|503|504/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;

export const workItemAri = (cloudId, issueId) =>
  `ari:cloud:jira:${cloudId}:issue/${issueId}`;

// One GraphQL call as the chatting user, with retries on transient errors.
// Always resolves to { ok, data, error, ms } and never throws.
export async function twg(opName, query, variables) {
  const operationName = `${OP_PREFIX}${opName}`;
  const text = query.replace("query OP", `query ${operationName}`);
  const started = Date.now();

  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let json = null;

    try {
      const res = await api.asUser().requestTeamworkGraph(text, variables, operationName);
      status = res.status;
      json = await res.json().catch(() => null);
    } catch (e) {
      json = { errors: [{ message: String(e?.message || e) }] };
    }

    const errors = Array.isArray(json?.errors) ? json.errors : [];
    const firstError = errors.length
      ? `${errors[0].extensions?.classification || errors[0].extensions?.errorType || "error"}: ${String(errors[0].message).slice(0, 160)}`
      : status >= 400
        ? `http-${status}`
        : null;

    if (!firstError && json?.data) {
      return { ok: true, data: json.data, ms: Date.now() - started };
    }

    if (attempt < MAX_RETRIES && TRANSIENT.test(`${firstError} ${status}`)) {
      await sleep(Math.min(1200, 200 * 2 ** attempt) + Math.floor(Math.random() * 250));
      continue;
    }

    return { ok: false, error: firstError || "no-data", data: json?.data || null, ms: Date.now() - started };
  }
}

// Reads a curated connection page by page (25 rows per page).
// `field` is the root field name in the query.
// Resolves to { ok, nodes, complete, error }. complete=false means paging
// stopped early (maxPages) or a page failed — callers must say so.
export async function twgAll(opName, query, variables, field, maxPages = 4) {
  const nodes = [];
  let after = null;

  for (let page = 0; page < maxPages; page++) {
    const r = await twg(opName, query, { ...variables, first: PAGE_SIZE, after });
    if (!r.ok) {
      return { ok: nodes.length > 0, nodes, complete: false, error: r.error };
    }

    const conn = r.data?.[field];
    if (!conn || !Array.isArray(conn.edges)) {
      return { ok: false, nodes, complete: false, error: "no-connection" };
    }

    for (const edge of conn.edges) {
      if (edge?.node) nodes.push(edge.node);
    }

    // A short page with hasNextPage still true is not the end — keep paging.
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) {
      return { ok: true, nodes, complete: true };
    }
    after = conn.pageInfo.endCursor;
  }

  return { ok: true, nodes, complete: false, error: "stopped-after-max-pages" };
}

// Curated Teamwork Graph queries used by StaleSignal. Each query starts with
// `query OP`; twg() swaps in the real operation name before sending.
export const Q = {
  // Teams a user belongs to.
  userTeams: `query OP($userId: ID!, $first: Int, $after: String) {
    atlassianUserInTeams(userId: $userId, first: $first, after: $after) {
      edges { node { ... on AtlassianTeam { id displayName } } }
      pageInfo { hasNextPage endCursor }
    }
  }`,

  // Members of one team.
  teamMembers: `query OP($teamAri: ID!, $first: Int, $after: String) {
    atlassianTeamMembers(teamAri: $teamAri, first: $first, after: $after) {
      edges { node { ... on AtlassianUser { accountId name } } }
      pageInfo { hasNextPage endCursor }
    }
  }`,

  // Comments on one work item since an ISO 8601 duration ago (e.g. "P90D").
  itemComments: `query OP($id: ID!, $since: String!, $first: Int, $after: String) {
    jiraWorkItemComments(id: $id, since: $since, first: $first, after: $after) {
      edges { node { ... on JiraWorkItemComment { createdAt author { name ... on AtlassianUser { accountId } } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`,

  // Goals a work item is linked to.
  itemGoals: `query OP($id: ID!, $first: Int, $after: String) {
    jiraWorkItemGoals(id: $id, first: $first, after: $after) {
      edges { node { ... on AtlassianGoal { name url } } }
      pageInfo { hasNextPage endCursor }
    }
  }`,
};
