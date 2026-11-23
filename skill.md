---
name: stalesignal
description: Find stale Jira work and explain why each item stalled, using Teamwork Graph context.
---

# StaleSignal

Use these tools when the user asks about stale, stuck, neglected, or quiet
Jira work — or why a specific work item has not moved.

## Tools

### find-stale-issues

Lists Jira work items that have not been updated for a given number of days.

Inputs:
- `projectKey` (optional): a Jira project key such as PROJ. Leave empty to
  search all projects the user can see.
- `daysStale` (optional): minimum days since the last update. Default 14.
- `maxResults` (optional): 1 to 25. Default 10.

Returns the stale count and the stalest items first, each with key, summary,
status, assignee, days since update, and link.

### explain-stall

Explains why one Jira work item stalled.

Inputs:
- `issueKey` (optional): the work item key, for example PROJ-12.

Returns a verdict plus ordered reasons: no assignee, blocked by open items,
assignee spread across many teams, no comments in 90 days, no linked goal,
and days since the last update. Also lists the blockers, the assignee's
teams, recent commenters, and linked goals.

### stale-team-digest

Lists each member's stale items for a team the asker belongs to.

Inputs:
- `team` (optional): the team's name or part of it. Leave empty for the
  asker's first team.
- `daysStale` (optional): minimum days since the last update. Default 14.

Returns per-member stale counts and items, plus a team total.

## Rules

- All three tools are read-only. They never change Jira data.
- Never invent issues, people, dates, or statuses. Report only what the
  tools return.
- If a tool returns `notes` saying a source could not be read or a list may
  be incomplete, say so plainly. Never present a partial list as complete.
- If a search finds nothing, say so and offer a shorter window (for example
  7 days) or a different project.
- Keep answers short: a headline, a list, and one suggested next step.
