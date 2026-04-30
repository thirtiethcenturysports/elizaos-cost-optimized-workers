# Replayable Decision Log

Every classification produces an immutable log entry stored in Cloudflare KV. Entries are chain-hashed so that **a holder of a known-good copy** can detect changes between that copy and the live KV state.

This page is honest about what this primitive does and does not protect against. Read the [Threat model](#threat-model) section before relying on it for compliance.

## Entry shape

```ts
interface AuditEntry {
  task_id: string;       // caller-supplied or auto-generated UUID
  seq: number;           // 0-indexed sequence within a task
  timestamp: number;     // Date.now() at append time
  worker_id: string;     // 'elizaos-cloudflare'
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

## Threat model

This is the most important section on this page. The chain-hash construction does not, by itself, make the log "tamper-evident" in the strong cryptographic sense. Be honest about which threats it covers.

### Threats this protects against

- **Accidental corruption.** Disk corruption, partial writes, JSON encoding bugs. The chain detects these.
- **Outsider tampering of a copy.** If you periodically export the log to a separate store and someone modifies the live KV after that export, comparing the export's final `entry_hash` to the live tail will detect the change.
- **Replay-against-known-good.** You can hash any entry yourself and compare against a hash you previously recorded.

### Threats this does NOT protect against

- **Insider tampering of the live KV.** Anyone with write access to the `ROUTER_KV` namespace can:
  1. Read the existing chain
  2. Modify any entry they want
  3. Recompute every subsequent `entry_hash` and `prev_hash` from the modified entry forward
  4. Write the rebuilt chain back

  After this, `verifyChain()` returns `valid: true` because the chain *is* internally consistent. There is no external anchor that says "the chain looked like X at time T."

- **Forking attacks.** An attacker with KV write access can produce two valid chains from any seq onward and serve different chains to different verifiers.

- **Tail truncation.** Deleting the most recent N entries leaves the remaining chain valid. Without an external record of the expected tail position, truncation is undetectable.

### What you'd need for real tamper-resistance

Pick at least one:

1. **External witness anchor.** Periodically publish the latest `entry_hash` (and optionally a Merkle root over a batch) to a write-once or hard-to-rewrite store: a public blockchain, a transparency log, an R2 bucket with object lock, a third-party notary service. Verifiers compare against the witness, not just against the chain.

2. **Hardware-rooted attestation (TEE).** Run the log writer inside a Trusted Execution Environment so the writes are signed by hardware that an insider cannot impersonate. The ElizaOS plugin `@elizaos/plugin-tee-verifiable-log` does this and is strictly stronger than this primitive for tamper-resistance.

3. **Append-only ACL with separation of duties.** Run a writer service that only has append permissions and a reader service that has read-only permissions, with no human able to grant write privileges to the reader. KV does not natively support this; you'd need a custom proxy.

This plugin ships none of these. The roadmap includes adding a witness-anchor option (periodic root publication to R2 or a public store), but it is not implemented today.

## Recommended use cases

Where this primitive is genuinely useful:

- **Debugging and replay.** Your agent did something weird; pull the per-task log and see exactly what happened, in order, with hashes that prove the entries you're reading match what you thought you stored.
- **Integrity check against a backup.** You exported the log nightly to S3. Today's KV state should match yesterday's export plus today's appends. The chain hash makes that comparison cheap.
- **Outsider-tamper detection.** A read replica or analytics export got corrupted en route. Chain verification catches it.

Where it is NOT sufficient on its own:

- **Compliance evidence in regulated industries.** SOC 2 / HIPAA / EU AI Act / financial audit trails should be backed by external witnesses, write-once storage, or TEE attestation. This primitive is a useful complement but not a sole control.

## Implementation notes

- KV is eventually consistent across regions. Reads immediately after a write may not see the new entry for up to ~60 seconds.
- The `append()` flow is read-modify-write on the tail pointer. Concurrent appends to the same `task_id` can clobber each other. The `/classify` flow is single-writer per `task_id` by construction; if you fan out work under one task_id, switch to a Durable Object.
- `crypto.subtle.digest('SHA-256', ...)` is the Workers runtime's native hash. No external dependency.
