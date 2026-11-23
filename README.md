# StaleSignal

Find stale Jira work and explain why each item stalled — with Teamwork Graph
context about the people and goals around it.

StaleSignal is a Forge app built for Codegeist 2026. It works as a Rovo agent
and as an MCP server, so any AI agent that speaks MCP can use the same tools.

## The problem

Every software team has work that goes quiet: an issue nobody touches for
weeks, a ticket blocked by something nobody owns, a task whose assignee is
spread across five teams. Teams discover these items by accident — in a
retro, or when a deadline slips. Existing stale-work bots only report age:
"this is 30 days old". Age alone never says *why* it stalled, so nobody knows
what to do next.

StaleSignal answers the why. It combines Jira data (age, blockers, assignee)
with Teamwork Graph context (the assignee's teams, recent commenters, linked
goals) and explains each stall in plain language.

## What it does

Three read-only tools, available in Rovo chat and over MCP:

| Tool | What it answers |
| --- | --- |
| `find-stale-issues` | Which work items have not been updated in N days (default 14), optionally in one project |
| `explain-stall` | Why one item stalled: blockers, missing or overloaded assignee, silence, missing goals |
| `stale-team-digest` | Each member's stale items for a team, so a lead sees where the stall sits |

Example questions in Rovo chat:

- "What work has gone stale in my project?"
- "Why has PROJ-12 stalled?"
- "Give me a stale-work digest for my team"

## How it works

- **Find candidates with JQL** — `updated <= -14d AND statusCategory != Done`,
  ordered stalest first. JQL is the right tool for "not updated in N days".
- **Explain with Teamwork Graph** — curated GraphQL queries for the assignee's
  teams (`atlassianUserInTeams`), team members (`atlassianTeamMembers`),
  recent comments (`jiraWorkItemComments`), and linked goals
  (`jiraWorkItemGoals`). All calls run as the chatting user, so people only
  ever see work they can already see.
- **Honest about partial data** — a rate-limited graph call can return zero
  rows, and a missing scope drops rows silently. Every tool reports `notes`
  when a source could not be read, and the agent says "this may be
  incomplete" instead of presenting a partial list as complete.

## Structure

```text
manifest.yml            Forge manifest: rovo:agent, rovo:mcp, 3 actions, scopes
prompts/agent-prompt.md Rovo agent instructions
src/index.js            The three action handlers (Jira REST + Teamwork Graph)
src/twg.js              Teamwork Graph client: operation naming, paging, retries
skill.md                MCP skill file for third-party agents
```

## Setup (for judges and developers)

Requires a Jira Cloud site with Rovo (Standard or Premium trial includes it)
and an org admin to approve the Teamwork Graph scopes at install time.

```bash
npm install
npm test            # offline smoke tests (mocked Forge APIs) — 20 checks
forge deploy -e development
forge install -e development --site <your-site>.atlassian.net --product jira
```

Then open a work item in Jira, click **Open Rovo Chat**, choose **Browse
agents**, and search for **StaleSignal**.

To use it over MCP, connect any MCP client to the app's MCP endpoint (the
`rovo:mcp` module) and read `skill.md` for tool descriptions.

## Prize categories (Codegeist 2026)

- **Main category:** Apps for Software Teams
- **Bonus — Best Agents (Rovo):** the `rovo:agent` module with three actions
- **Bonus — Best app with Atlassian MCP:** the `rovo:mcp` module exposing the
  same three tools, plus `skill.md` for third-party agents
- **Bonus — Best Teamwork Graph integration:** consumes the Teamwork Graph API
  (teams, members, comments, goals) for every explanation
- **Bonus — Best Marketplace published app:** submitted for Marketplace
  listing (a separate app copy carries the installation link for judges,
  since a listing-submitted app cannot be shared by installation link)

## Limitations

- Teamwork Graph is a Preview API: curated queries only, at most 25 rows per
  page, and rate limits can return empty results (handled with retries and
  honest `notes`).
- Teams are found through the asker — the curated API starts from a user id
  or a team id, not a team name.
- The "Done" check matches the status names Done, Closed, and Resolved; a
  site using other status names needs the JQL `statusCategory` filter, which
  is already used for the search actions.

## License

MIT
