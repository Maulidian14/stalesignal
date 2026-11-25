# Privacy Policy — StaleSignal

**Effective date:** 25 November 2026
**Developer:** Maulidian Arif Rofiat (individual developer, Codegeist 2026 hackathon project)
**Contact:** https://github.com/Maulidian14/stalesignal

StaleSignal is a Forge app for Jira Cloud. It finds Jira work that has gone stale and explains why it stalled, through Rovo agent tools and a Rovo MCP server.

## What data the app accesses

When you invoke the app (for example, `findStaleIssues` or `staleTeamDigest`), it reads the following from your Jira site through the Jira REST API, only at the moment you ask for it:

- Issue details: issue key, summary, status, assignee, dates (created, updated), and comments needed to explain why work stalled.
- Project and board information needed to locate that work.

The app does **not** read any other Atlassian product data, and it does not access data outside your Jira site.

## What data the app stores

**Nothing.** StaleSignal stores no personal data outside Jira. It keeps no database, no logs of issue content, and no copy of your data on any server of its own. Results are computed on demand and returned to you; nothing is retained after the request finishes.

## Third parties

The app sends your data to **no third party**. It uses only Atlassian's own platform services (Forge runtime, Jira API, Rovo) to do its work. No analytics, tracking, or advertising services are used.

## Your choices

Because the app stores nothing, there is nothing to delete or export from the app itself. Removing the app from your Jira site stops all access immediately. Your Jira data itself remains in your Jira site, controlled by your site administrator.

## Changes

If this policy changes, the updated version will be published here in this repository.

## Contact

Questions about this policy: open an issue at https://github.com/Maulidian14/stalesignal/issues.
