# Append-Only Audit Log

Every classification produces an immutable log entry stored in Cloudflare KV. Entries are chain-hashed so tampering is detectable on replay.

## Entry shape

```ts
interface AuditEntry {
  task_id: string;       // caller-supplied or auto-generated UUID
  seq: number;           // 0-indexed sequence within a task
  timestamp: number;     // Date.now() at append time
  worker_id: string;     // 'elizaos-cost-router'
  decision: string;      // 'cache_hit' | 'cheap_only' | 'escalated'
  model_used: string;    // 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'cache'
  escalated: boolean;
  cost_usd: number;
  latency_ms: number;
  cache_hit: boolean;
  prev_hash: string;     // entry_hash of previous entry, or 'GENESIS'
  entry_hash: string;    // sha256 of the entry minus this field
}
```

## Storage layout

| KV key | Value |
|---|---|
| `audit:entry:<task_id>:<seq>` | JSON-serialized `AuditEntry`. Padded `seq` to 10 digits for lexicographic ordering. |
| `audit:tail:<task_id>` | The latest entry for the task (used to compute next `prev_hash` without listing). |

## Replay

```ts
const entries = await auditLog.getLog(taskId);
```

Lists by `audit:entry:<taskId>:` prefix and returns sorted by `seq`.

## Verification

```ts
const result = await auditLog.verifyChain(taskId);
// { valid: true } or { valid: false, broken_at: <seq> }
```

The verifier:
1. Walks entries in order
2. Confirms each entry's `prev_hash` equals the previous entry's `entry_hash` (or `'GENESIS'` for `seq=0`)
3. Recomputes each `entry_hash` from the rest of the entry and compares

Any mismatch returns `valid: false` with the `seq` of the first broken entry.

## Caveats

- KV is eventually consistent across regions. Reads immediately after a write may not see the new entry for up to ~60 seconds.
- The chain hash detects in-place tampering of any single entry, but cannot detect entry deletion at the tail. For tail-deletion resistance, mirror the tail pointer to a second store.
- `crypto.subtle.digest('SHA-256', ...)` is the Workers runtime's native hash. No external dependency.
