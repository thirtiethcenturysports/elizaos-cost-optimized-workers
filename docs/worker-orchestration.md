# Worker Orchestration

Coordinate 17 Cloudflare Workers via a shared event bus.

## Pattern

- Central orchestrator receives requests
- Decomposes into subtasks via task-decomposition rules
- Publishes tasks to event bus
- Workers subscribe to relevant event types
- Results aggregated and returned

## Event Bus

- Publish/subscribe over Cloudflare Queues or Durable Objects
- Each event tagged with `task_id` for trace correlation
- Failed events retried with exponential backoff
- Dead-letter queue for unrecoverable failures

## Routing Heuristics

Orchestrator chooses target Worker by:
- Task type (sentiment vs. generation vs. classification)
- Current cost budget
- Latency SLA
- Cache hit probability

## Failure Handling

- Worker crash: replay from append-only log
- Bus failure: fall back to direct Worker invocation
- Aggregation timeout: return partial results with degraded flag
