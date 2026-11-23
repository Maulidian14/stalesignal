// Offline smoke test for StaleSignal's three actions (mocked Forge APIs).
// Run with: npm test
import { register } from "node:module";
register(new URL("./hooks.mjs", import.meta.url));

const { findStaleIssues, explainStall, staleTeamDigest } = await import(
  new URL("../src/index.js", import.meta.url).href
);

let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra !== undefined ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

// --- Action 1: find stale issues ---
const found = await findStaleIssues({ projectKey: "PROJ", daysStale: 14, maxResults: 10 });
check("find: 2 items", found.items?.length === 2, JSON.stringify(found.items?.map((i) => i.key)));
check("find: stalest first (20d then 16d)", found.items?.[0]?.daysSinceUpdate === 20 && found.items?.[1]?.daysSinceUpdate === 16);
check("find: staleCount 2", found.staleCount === 2);
check("find: no-assignee item has null assignee", found.items?.[1]?.assignee === null);
const badProject = await findStaleIssues({ projectKey: "bad key!" });
check("find: invalid project key rejected", !!badProject.error);

// --- Action 2: explain one stall ---
const explained = await explainStall({ issueKey: "PROJ-12", context: { cloudId: "cloud-1" } });
check("explain: verdict is the blocker reason", explained.verdict?.includes("PROJ-9"), explained.verdict);
const codes = (explained.reasons || []).map((r) => r.code);
check("explain: blocked reason present", codes.includes("blocked"));
check("explain: spread-thin reason present (3 teams)", codes.includes("assignee-spread-thin"));
check("explain: silent reason present (0 comments)", codes.includes("silent"));
check("explain: no-goal reason present", codes.includes("no-goal"));
check("explain: only 1 open blocker (resolved one filtered)", explained.blockers?.length === 1 && explained.blockers[0].key === "PROJ-9");
check("explain: 3 assignee teams", explained.assigneeTeams?.length === 3);
check("explain: 20 days stale", explained.workItem?.daysSinceUpdate === 20);
const missing = await explainStall({ issueKey: "NOPE-1", context: { cloudId: "cloud-1" } });
check("explain: missing item gives plain error", !!missing.error && missing.error.includes("cannot see it"));
const noKey = await explainStall({ context: {} });
check("explain: no key asks for one", !!noKey.error && noKey.error.includes("Which work item"));

// --- Action 3: team digest ---
const digest = await staleTeamDigest({ team: "Platform", daysStale: 14, context: { accountId: "user-1" } });
check("digest: team resolved", digest.team === "Platform");
check("digest: 2 members", digest.members?.length === 2, JSON.stringify(digest.members?.map((m) => m.name)));
check("digest: total stale 2", digest.totalStale === 2);
const wrongTeam = await staleTeamDigest({ team: "Nope", context: { accountId: "user-1" } });
check("digest: unknown team lists user's teams", !!wrongTeam.error && wrongTeam.error.includes("Platform"));
const noAsker = await staleTeamDigest({ team: "Platform", context: {} });
check("digest: no asker gives plain error", !!noAsker.error);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
