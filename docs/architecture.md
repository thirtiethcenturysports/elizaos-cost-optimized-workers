# Architecture

Two pieces of code in this repo:

1. **`src/plugin.ts`** — an ElizaOS Plugin published as the npm package `@thirtieth/elizaos-plugin-cf-cost-router`. It runs inside the agent process and exposes one `Action`.
2. **`worker/`** — a Cloudflare Worker that the plugin talks to over HTTP. The Worker is where the cost router, cache, and audit log actually live.

```
┌─────────────────────────────────────────┐
│ Your ElizaOS Agent (anywhere)           │
│                                         │
│  Plugin: @thirtieth/...cost-router      │
│   Action: CLASSIFY_TRADING_SENTIMENT    │
│     │                                   │
│     │  fetch(COST_ROUTER_URL/classify)  │
└─────┼───────────────────────────────────┘
      │ HTTPS POST { text, task_id }
      ▼
┌─────────────────────────────────────────┐
│ Cloudflare Worker (your account)        │
│                                         │
│  worker/index.ts                        │
│    POST /classify ─┐                    │
│                    │                    │
│         ┌──────────┴──────────┐         │
│         ▼                     ▼         │
│   worker/cache.ts      worker/router.ts │
│         │                     │         │
│         │             ┌───────┴───────┐ │
│         │             ▼               ▼ │
│         │      Anthropic Haiku  Anthropic│
│         │      (cheap, first)    Sonnet  │
│         │                       (escalate)│
│         ▼                               │
│   worker/audit-log.ts                   │
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
- **KV access is Worker-native.** Plugins running outside CF can't bind KV directly, so the Worker is the only natural home for the cache and audit log.

## Request flow

1. Agent calls `runtime.processActions(...)` with a message
2. ElizaOS routes to `CLASSIFY_TRADING_SENTIMENT.handler`
3. Handler reads `runtime.getSetting('COST_ROUTER_URL')` and POSTs to `/classify`
4. Worker:
   1. Computes cache key from `model + normalized_input`
   2. KV lookup. Cache hit returns immediately, audit-logged as `cache_hit`.
   3. Cache miss: call Haiku, parse JSON, validate schema
   4. If confidence ≥ 0.75 and schema valid, return Haiku result
   5. Otherwise call Sonnet, parse, validate, return Sonnet result
   6. Write to cache (with TTL) and append to audit log (chained hash)
5. Plugin returns `ActionResult` with `success`, `text`, `values.sentiment`, and full `data` payload (model used, cost, latency, escalated flag)

## Why these primitives

- **KV for cache:** simple, eventual-consistent, native TTL. Per-key writes are fast. List-by-prefix supports the audit log.
- **KV for audit log:** the same store keeps deployment simple. Chain hash gives tamper detection without a separate database.
- **`crypto.subtle` for hashing:** native to the Workers runtime, no dependency.
- **Anthropic SDK directly:** simpler than re-implementing the client, and matches what most ElizaOS plugins already use.

## What's not in this architecture

- No queue or pub/sub. The plugin calls the Worker synchronously over HTTP.
- No multi-Worker fan-out. One Worker handles the full request.
- No Durable Objects. Cache eviction relies on KV TTL, not a global LRU.
- No task decomposition layer. Each input is one classification.

These are intentional omissions for the demo. Adding them is the [roadmap](../README.md#roadmap).
