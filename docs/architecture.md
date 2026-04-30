# Architecture

Two pieces of code in this repo:

1. **`src/plugin.ts`** — the ElizaOS Plugin published as `@thirtieth/elizaos-plugin-cloudflare`. It runs inside the agent process and exposes two Actions: `CLASSIFY_TRADING_SENTIMENT` and `VERIFY_DECISION_LOG`.
2. **`worker/`** — a Cloudflare Worker that the plugin talks to over HTTP. The Worker is where the cache, decision log, and router live.

```
┌─────────────────────────────────────────┐
│ Your ElizaOS Agent                      │
│ (Discord bot, Telegram, web, CLI, ...)  │
│                                         │
│  Plugin: @thirtieth/elizaos-plugin-     │
│           cloudflare                    │
│   Actions:                              │
│   - CLASSIFY_TRADING_SENTIMENT          │
│   - VERIFY_DECISION_LOG                 │
│     │                                   │
│     │ fetch(CLOUDFLARE_WORKER_URL/...)  │
└─────┼───────────────────────────────────┘
      │ HTTPS
      ▼
┌─────────────────────────────────────────┐
│ Cloudflare Worker (your account)        │
│                                         │
│  worker/index.ts                        │
│    POST /classify ─┐                    │
│    GET  /audit/:id ┤                    │
│    GET  /audit/:id/verify ┤             │
│    GET  /stats     ┤                    │
│    GET  /health    ┘                    │
│                    │                    │
│         ┌──────────┴──────────┐         │
│         ▼                     ▼         │
│   worker/cache.ts      worker/router.ts │
│   (stable)             (experimental)   │
│         │                     │         │
│         │             ┌───────┴───────┐ │
│         │             ▼               ▼ │
│         │      Anthropic Haiku  Anthropic│
│         │      (cheap, first)    Sonnet  │
│         │                       (escalate)│
│         ▼                               │
│   worker/audit-log.ts                   │
│   (stable, see threat model)            │
│         │                               │
└─────────┼───────────────────────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Cloudflare KV    │
   │ (ROUTER_KV)      │
   │                  │
   │ cache:<hash>     │
   │ audit:entry:...  │
   │ audit:tail:...   │
   │ cache:stats      │
   └──────────────────┘
```

## Why split the plugin from the Worker

- **One Worker, many agents.** Multiple ElizaOS agents (or non-ElizaOS callers) can share a single Worker deployment, so the cache hit rate compounds across all of them.
- **Secrets stay in CF.** `ANTHROPIC_API_KEY` lives in Worker secrets, not in the agent's environment. The plugin only needs the public Worker URL.
- **KV access is Worker-native.** Plugins running outside CF can't bind KV directly, so the Worker is the only natural home for the cache and decision log.

## Request flow

1. Agent calls `runtime.processActions(...)` with a message
2. ElizaOS routes to `CLASSIFY_TRADING_SENTIMENT.handler`
3. Handler reads `runtime.getSetting('CLOUDFLARE_WORKER_URL')` (or `COST_ROUTER_URL` for v0.1 compat) and POSTs to `/classify`
4. Worker:
   1. Computes cache key from `model + normalized_input`
   2. KV lookup. Cache hit returns immediately, decision-logged as `cache_hit`.
   3. Cache miss: call Haiku, parse JSON, validate schema
   4. If confidence ≥ 0.75 and schema valid, return Haiku result
   5. Otherwise call Sonnet, parse, validate, return Sonnet result
   6. Write to cache (with TTL) and append to decision log (chained hash)
5. Plugin returns `ActionResult` with `success`, `text`, `values.sentiment`, and full `data` payload (model used, cost, latency, escalated flag, task_id)
6. Agent can later invoke `VERIFY_DECISION_LOG` with the task_id to integrity-check the chain against the live KV state

## Why these primitives

- **KV for cache:** simple, eventual-consistent, native TTL. Per-key writes are fast. List-by-prefix supports the decision log.
- **KV for decision log:** the same store keeps deployment simple. Chain hash provides integrity verification *against a known-good copy* (see [docs/append-only-logging.md](./append-only-logging.md) for what this does and does not protect against).
- **`crypto.subtle` for hashing:** native to the Workers runtime, no dependency.
- **Anthropic SDK directly:** simpler than re-implementing the client, and matches what most ElizaOS plugins already use.

## What's not in this architecture

- No queue or pub/sub. The plugin calls the Worker synchronously over HTTP.
- No multi-Worker fan-out. One Worker handles the full request.
- No Durable Objects. Cache eviction relies on KV TTL, not a global LRU. Stats counter is read-modify-write on KV (acceptable for demo, not for production-scale concurrency — documented inline).
- No task decomposition layer. Each input is one classification.
- No external witness anchor for the decision log. See [docs/append-only-logging.md#threat-model](./append-only-logging.md#threat-model) for what this means in practice.

These are intentional omissions. Adding them is the [roadmap](../README.md#roadmap).
