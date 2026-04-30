# @thirtieth/elizaos-plugin-cf-cost-router

Drop-in [ElizaOS](https://elizaos.com) plugin that routes LLM calls through a Cloudflare Worker with confidence-based model downgrade, KV response caching, and an append-only audit log.

```bash
npm install @thirtieth/elizaos-plugin-cf-cost-router
```

[![npm](https://img.shields.io/npm/v/@thirtieth/elizaos-plugin-cf-cost-router.svg)](https://www.npmjs.com/package/@thirtieth/elizaos-plugin-cf-cost-router)
[![license](https://img.shields.io/npm/l/@thirtieth/elizaos-plugin-cf-cost-router.svg)](./LICENSE)

> Built for the ElizaOS framework. Not affiliated with the ElizaOS team.

## What this is

A working ElizaOS plugin + Cloudflare Worker that demonstrates one specific cost-optimization pattern end to end:

- **Router:** call Claude Haiku first, escalate to Sonnet only when Haiku output is low-confidence or schema-invalid
- **Cache:** KV-backed, content-hashed, TTL-bounded
- **Audit log:** append-only, chain-hashed, replay + integrity verification

One Worker, one route, one ElizaOS Action. Reproducible benchmark included.

## What this isn't

- Not a framework. It's one plugin and one Worker.
- Not a marketing claim about other people's stacks. The headline number below is measured against this repo's specific corpus and methodology, not extrapolated.
- Not finished. See [Roadmap](#roadmap).

## Headline number

Verified against the real Anthropic API on 2026-04-30:

| Scenario | Cost / 100 prompts | Savings vs naive | Accuracy |
|---|---:|---:|---:|
| Naive (Sonnet only, no cache) | $0.0915 | — | 92.5% |
| Cheap-only (Haiku only) | $0.0310 | 66.1% | 93.8% |
| **Optimized (Haiku-first + escalation)** | **$0.0529** | **42.2%** | 92.5% |
| Optimized + warm cache (2nd pass) | $0.0000 | 100% | — |

**42% cost reduction**, single pass, cold cache, Haiku-first routing with 24% escalation rate to Sonnet. **71% reduction** over two passes once the cache warms.

Accuracy measured on 80 decidable prompts (20 ambiguous prompts excluded). On this specific corpus Haiku slightly outperformed Sonnet — sample size is small, but the practical takeaway is that Haiku alone is competitive for trading-sentiment classification and the escalation tier exists primarily as a safety net for low-confidence outputs.

Numbers above are from `--mode=live`. Run `npm run bench -- --mode=mock` for a free deterministic reproducer. Full methodology and per-prompt token counts in [bench/results.md](./bench/results.md).

## Install

```bash
npm install @thirtieth/elizaos-plugin-cf-cost-router
```

Peer dependency: `@elizaos/core ^1.7.2`.

## Quickstart

You need a Cloudflare account and an Anthropic API key. First-time setup runs about 10 minutes (mostly waiting on `wrangler login` and the first deploy).

### 1. Deploy the Worker

```bash
git clone https://github.com/thirtiethcenturysports/elizaos-cost-optimized-workers.git
cd elizaos-cost-optimized-workers
npm install
cp .dev.vars.example .dev.vars     # paste your ANTHROPIC_API_KEY here for `wrangler dev`
npx wrangler login                 # if not already logged in
npx wrangler kv namespace create ROUTER_KV
# Copy the returned id into wrangler.toml, replacing REPLACE_WITH_KV_NAMESPACE_ID
npx wrangler deploy                # first deploy provisions the Worker subdomain
npx wrangler secret put ANTHROPIC_API_KEY   # interactive; secrets require an existing deployment
```

You'll get a URL like `https://elizaos-cost-router.<your-subdomain>.workers.dev`. Check `/health` to confirm it's live.

### 2. Wire the plugin into your ElizaOS character

```ts
import costRouter from '@thirtieth/elizaos-plugin-cf-cost-router';
import type { Character } from '@elizaos/core';

export const character: Character = {
  name: 'YourAgent',
  plugins: [costRouter],
  settings: {
    COST_ROUTER_URL: 'https://elizaos-cost-router.<your-subdomain>.workers.dev',
  },
};
```

### 3. Use the action

The plugin registers `CLASSIFY_TRADING_SENTIMENT`. Any message your agent decides to classify gets routed through the Worker. Result returns sentiment, confidence, which model handled it, whether it was cached, and the cost in USD.

## Architecture

```
ElizaOS Agent
     |
     v  (Action.handler -> fetch)
+---------------------------------+
| Cloudflare Worker               |
|  POST /classify                 |
|   1. cache.get()  -> hit? return|
|   2. router.route()             |
|      a. callModel(Haiku)        |
|      b. parse & validate JSON   |
|      c. confidence >= 0.75?     |
|         yes -> return Haiku     |
|         no  -> callModel(Sonnet)|
|   3. cache.put()                |
|   4. auditLog.append()          |
+---------------------------------+
     |
     v
Cloudflare KV (ROUTER_KV binding)
   - cache:<sha256>          (TTL'd response cache)
   - audit:entry:<task>:<seq> (append-only log)
   - audit:tail:<task>        (pointer to latest)
   - cache:stats              (hit/miss counters)
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/classify` | Classify trading sentiment via the router |
| `GET` | `/audit/:taskId` | Replay all log entries for a task in order |
| `GET` | `/audit/:taskId/verify` | Validate the chain hash for a task's log |
| `GET` | `/stats` | Cumulative cache hit/miss counters |
| `GET` | `/health` | Liveness check |

## Configuration

| `wrangler.toml` var | Default | Notes |
|---|---|---|
| `CACHE_TTL_SECONDS` | `3600` | KV `expirationTtl` for cached responses |
| `CONFIDENCE_THRESHOLD` | `0.75` | Below this, Haiku output triggers Sonnet escalation |
| `CHEAP_MODEL` | `claude-haiku-4-5` | First-try model |
| `EXPENSIVE_MODEL` | `claude-sonnet-4-6` | Escalation target |

Secrets (set via `wrangler secret put`):

| Name | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Required |

## Reproducing the benchmark

```bash
npm run bench                  # mock mode (free, deterministic)
npm run bench -- --mode=live   # live mode, requires ANTHROPIC_API_KEY (~$0.50 per run)
```

Mock mode uses Anthropic's published rates against character-count token estimates with deterministic mock responses. **Mock numbers are a model, not a measurement** — useful for reproducibility, but verify with `--mode=live` before publishing claims.

## How escalation works

Haiku is asked to return strict JSON: `{ sentiment, confidence, reasoning }`. The router escalates to Sonnet if any of these are true:

1. Haiku's response fails to parse as JSON
2. The parsed object fails schema validation (sentiment not in enum, confidence out of range, reasoning missing)
3. Haiku reports `confidence < CONFIDENCE_THRESHOLD`

Self-reported confidence is not perfect, but combined with hard schema validation it's a reasonable demo signal. Logprob-based escalation would be stronger if Anthropic exposed logprobs.

## Caveats

- **One pattern, not five.** This repo demonstrates Haiku-first routing + KV cache + audit log. It does not implement task decomposition, batching, or model fan-out. Those are real patterns but not in scope here.
- **Self-reported confidence has limits.** A model can be confidently wrong. The escalation path catches schema failures too, which helps but doesn't eliminate the issue.
- **KV is eventually consistent.** Cache reads can return stale entries within seconds of a write across regions. Acceptable for sentiment classification, may not be for other workloads.
- **Cache hit rate depends on your traffic.** Repeated identical prompts cache perfectly. Unique prompts get zero cache benefit (only routing benefit).

## Roadmap

- [x] Live-mode benchmark numbers committed (verified 2026-04-30 against real Anthropic API)
- [ ] Task decomposition example (split classify + summarize into separate model calls)
- [ ] Batching example (group N classifications into one Sonnet call when latency permits)
- [ ] Cloudflare Queue-based pub/sub for multi-Worker fan-out
- [ ] CHANGELOG + semver discipline once npm-published

## Repo layout

```
src/plugin.ts              ElizaOS Plugin export, npm entry point
worker/index.ts            Cloudflare Worker entry
worker/router.ts           Haiku-first routing + cost math
worker/cache.ts            KV cache + content-hash keys
worker/audit-log.ts        Append-only KV log with chain hash
worker/*.test.ts           Unit tests (vitest)
bench/corpus.ts            100-prompt trading-sentiment corpus
bench/run.ts               Benchmark runner, mock + live modes
bench/results.md           Latest measured output
docs/                      Architecture, routing, audit log details
```

## License

MIT. See [LICENSE](./LICENSE).
