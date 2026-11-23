// Mock @forge/api for offline testing of StaleSignal's action handlers.
// Lets the three actions run locally without a Forge deployment.

export function route(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += encodeURIComponent(String(values[i])) + strings[i + 1];
  }
  return out;
}

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const fakeIssue = (key, days, assigneeName) => ({
  id: "10001",
  key,
  self: `https://example.atlassian.net/rest/api/3/issue/10001`,
  fields: {
    summary: `Fake ${key}`,
    status: { name: "In Progress" },
    assignee: assigneeName ? { displayName: assigneeName, accountId: "acc-1" } : null,
    reporter: { displayName: "Rina Reporter" },
    updated: daysAgo(days),
    priority: { name: "Medium" },
    issuelinks: [],
  },
});

const proj12 = {
  id: "10012",
  key: "PROJ-12",
  fields: {
    summary: "Migrate auth to SSO",
    status: { name: "In Progress" },
    assignee: { displayName: "Budi Builder", accountId: "acc-1" },
    reporter: { displayName: "Rina Reporter" },
    updated: daysAgo(20),
    priority: { name: "High" },
    issuelinks: [
      // Open blocker — must be reported.
      { type: { name: "Blocks", inward: "is blocked by" }, inwardIssue: { key: "PROJ-9", fields: { summary: "Vendor API key", status: { name: "To Do" } } } },
      // Resolved blocker — must be filtered out.
      { type: { name: "Blocks", inward: "is blocked by" }, inwardIssue: { key: "PROJ-3", fields: { summary: "Old dep", status: { name: "Done" } } } },
    ],
  },
};

function connection(nodes) {
  return { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } };
}

const graphResponses = {
  stalesignal_userTeams: {
    atlassianUserInTeams: connection([
      { id: "ari:cloud:identity::team/1", displayName: "Platform" },
      { id: "ari:cloud:identity::team/2", displayName: "Mobile" },
      { id: "ari:cloud:identity::team/3", displayName: "Growth" },
    ]),
  },
  stalesignal_teamMembers: {
    atlassianTeamMembers: connection([
      { accountId: "acc-1", name: "Budi Builder" },
      { accountId: "acc-2", name: "Sari Tester" },
    ]),
  },
  stalesignal_itemComments: { jiraWorkItemComments: connection([]) },
  stalesignal_itemGoals: { jiraWorkItemGoals: connection([]) },
};

const asUser = () => ({
  async requestJira(path, opts = {}) {
    if (String(path).includes("/rest/api/3/search/jql")) {
      const body = JSON.parse(opts.body || "{}");
      const isDigest = body.jql.includes("assignee =");
      const issues = isDigest
        ? [fakeIssue("PROJ-77", 18, "Budi Builder")]
        : [fakeIssue("PROJ-12", 20, "Budi Builder"), fakeIssue("PROJ-15", 16, null)];
      return { ok: true, status: 200, json: async () => ({ issues, total: issues.length }) };
    }
    if (String(path).includes("/rest/api/3/issue/PROJ-12")) {
      return { ok: true, status: 200, json: async () => proj12 };
    }
    if (String(path).includes("/rest/api/3/issue/")) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  },
  async requestTeamworkGraph(_text, _variables, operationName) {
    const data = graphResponses[operationName];
    if (!data) return { ok: true, status: 200, json: async () => ({ errors: [{ message: "unknown op" }] }) };
    return { ok: true, status: 200, json: async () => ({ data }) };
  },
});

export default { asUser };
