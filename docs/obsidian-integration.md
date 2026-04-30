# Obsidian Integration

Sync orchestrator decisions and cost summaries to an Obsidian vault for review and longitudinal analysis.

## Pattern

- Append-only log replayed nightly into a daily note
- One file per day: `YYYY-MM-DD-orchestrator.md`
- Sections: cost summary, top tasks, anomalies, replay events

## Implementation

- Cron Worker reads KV log for the day
- Renders markdown with frontmatter (`tags: [orchestrator, cost]`)
- Writes to vault via local sync agent or git-backed vault repo

## Why

- Reviewable history without standing up a dashboard
- Backlinks let you correlate cost spikes with deploys, prompt changes, traffic events
- Keeps optimization decisions auditable in human-readable form
