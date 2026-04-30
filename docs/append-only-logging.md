# Append-Only Logging

Every decision logged. Survive crashes. Replay on failure.

## Pattern

- Each Worker decision appended to immutable log
- Log stored in KV with timestamp and decision hash
- On failure, replay from last checkpoint
- No overwrites. No deletions. Full audit trail.

## Implementation

- Log entry: `timestamp`, `worker_id`, `task_id`, `decision`, `cost`, `latency`
- Storage: Cloudflare KV (immutable append)
- Replay: Query log by `task_id`, execute from checkpoint

## Benefit

Crash recovery without data loss. Full audit trail for compliance. Debugging enabled by replay.
