# @thirtieth/elizaos-plugin-cloudflare

Cloudflare integration for [ElizaOS](https://elizaos.com) agents. Runs your agent's expensive paths behind a Cloudflare Worker with KV-backed response cache, replayable per-task decision log, and an experimental cost-aware model router.

```bash
npm install @thirtieth/elizaos-plugin-cloudflare
```

[![npm](https://img.shields.io/npm/v/@thirtieth/elizaos-plugin-cloudflare.svg)](https://www.npmjs.com/package/@thirtieth/elizaos-plugin-cloudflare)
[![license](https://img.shields.io/npm/l/@thirtieth/elizaos-plugin-cloudflare.svg)](./LICENSE)

> Built for the ElizaOS framework. Not affiliated with the ElizaOS team.

## Deploy ElizaOS to Cloudflare in ~10 minutes

```bash
git clone https://github.com/thirtiethcenturysports/elizaos-plugin-cloudflare.git
cd elizaos-plugin-cloudflare
npm install
cp .dev.vars.example .dev.vars                       # paste your ANTHROPIC_API_KEY here
npx wrangler login
npx wrangler kv namespace create ROUTER_KV
# copy the returned id into wrangler.toml
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY            # interactive, requires existing deployment
```

You'll get a URL like `https://elizaos-cloudflare.<your-subdomain>.workers.dev`. Hit `/health` to confirm it's live, then wire it into your ElizaOS character:

```ts
import cloudflarePlugin from '@thirtieth/elizaos-plugin-cloudflare';
import type { Character } from '@elizaos/core';

export const character: Character = {
  name: 'YourAgent',
  plugins: [
    cloudflarePlugin,
    // Common pairings: @elizaos/plugin-discord (run as a Discord bot),
    // @elizaos/plugin-telegram, @elizaos/plugin-bootstrap, @elizaos/plugin-anthropic
  ],
  settings: {
    CLOUDFLARE_WORKER_URL: 'https://elizaos-cloudflare.<your-subdomain>.workers.dev',
  },
};
```

A working example character is in [examples/character.ts](./examples/character.ts).

## Three features

### 1. KV-backed response cache

Stable. Repeated identical prompts skip the model call entirely. Content-hash keys (sha256 over normalized model+input), TTL eviction via KV's `expirationTtl`. See [docs/cost-optimization.md](./docs/cost-optimization.md).

### 2. Replayable per-task decision log

Stable. Every classification produces a chain-hashed log entry stored in KV. Replay all entries for a task in order via `GET /audit/:taskId`, integrity-check the chain via `GET /audit/:taskId/verify`. The plugin exposes a `VERIFY_DECISION_LOG` Action so an agent can self-check.

**Honest scope:** the chain detects accidental corruption and outsider tampering of a *copy* of the log against a known-good reference. It does NOT prevent insider tampering of the live KV — anyone with KV write access can recompute the chain top-down. For real tamper-resistance you need an external witness anchor (signed roots, periodic publication to write-once storage, TEE attestation). This plugin is appropriate for debugging, replay, and integrity checks against a backup; it is not appropriate as a sole compliance control. Full caveats in [docs/append-only-logging.md](./docs/append-only-logging.md).

### 3. Cost-aware model router (experimental)

Marked experimental. Calls Claude Haiku first, escalates to Sonnet on low-confidence or schema-invalid output. **Honest aggregate cost accounting** — when escalation fires, the wasted Haiku call is included in the reported cost. Most cascade demos hide this; the bench in this repo doesn't.

Verified live against the Anthropic API on 2026-04-30:

| Scenario | Cost / 100 prompts | Accuracy |
|---|---:|---:|
| Naive (Sonnet only) | $0.0915 | 92.5% |
| Cheap-only (Haiku only) | $0.0310 | **93.8%** |
| Optimized (Haiku-first + escalate) | $0.0529 | 92.5% |

**On this corpus, Haiku alone beat the optimized router on both cost and accuracy.** That's why the router ships marked experimental: cascade routing is workload-dependent, and on forgiving classification tasks the cheap model is good enough that the escalation tier costs more than it saves. Run the included benchmark on your own corpus before relying on it.

The escalation tier is genuinely useful when the cheap model's failure mode is loud (malformed JSON, refusals, hallucinated values that fail schema validation). It's not a silver bullet for cost.

Full methodology in [bench/results.md](./bench/results.md).

## Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/classify` | Run input through cache → router → log |
| `GET` | `/audit/:taskId` | Replay all log entries for a task in order |
| `GET` | `/audit/:taskId/verify` | Integrity-check the chain against current KV state |
| `GET` | `/stats` | Cumulative cache hit/miss counters |
| `GET` | `/health` | Liveness check |

## Plugin Actions

| Action | Description |
|---|---|
| `CLASSIFY_TRADING_SENTIMENT` | Classify sentiment via the cache + router pipeline |
| `VERIFY_DECISION_LOG` | Verify chain integrity for a given task_id |

## Configuration

| `wrangler.toml` var | Default | Notes |
|---|---|---|
| `CACHE_TTL_SECONDS` | `3600` | KV `expirationTtl` for cached responses |
| `CONFIDENCE_THRESHOLD` | `0.75` | Below this, Haiku output triggers Sonnet escalation |
| `CHEAP_MODEL` | `claude-haiku-4-5` | First-try model |
| `EXPENSIVE_MODEL` | `claude-sonnet-4-6` | Escalation target |

Secrets:

| Name | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Required |

Plugin settings (in your ElizaOS character config):

| Setting | Notes |
|---|---|
| `CLOUDFLARE_WORKER_URL` | Required. Your deployed Worker URL. |
| `COST_ROUTER_URL` | Backwards-compat alias for `CLOUDFLARE_WORKER_URL` from v0.1 |

## Reproducing the benchmark

```bash
npm run bench                  # mock mode (free, deterministic)
npm run bench -- --mode=live   # live mode, requires ANTHROPIC_API_KEY (~$0.50 per run)
```

## What this isn't

- **Not a replacement for Langfuse / Helicone / LangSmith.** Those are full observability platforms with traces, evals, dashboards, replay UIs, and managed retention. This is a focused Worker-side primitive that complements them.
- **Not a tamper-resistant audit log.** See the honest-scope note above. Use TEE attestation, signed roots, or write-once storage if you need real tamper-resistance.
- **Not a generic LLM cache for any provider.** Wired to Anthropic. Other providers possible but not shipped.
- **Not a fan-out orchestrator.** One Worker handles one classify call. No queues, no task decomposition, no multi-step planning.

## Roadmap

- [x] Live-mode benchmark verified against the real Anthropic API (2026-04-30)
- [ ] D1 backend option for the decision log (KV + D1 dual-write for queryability)
- [ ] Cloudflare Queue integration for async batch classification
- [ ] OpenTelemetry / Langfuse exporter so chain-hashed events flow into existing observability stacks
- [ ] Witness anchor option (periodic root publication to R2 or write-once storage) for stronger tamper claims
- [ ] Multi-provider support (OpenAI, Workers AI as cheap tier)
- [ ] Generic classification Action (not just trading sentiment)

## Repo layout

```
src/plugin.ts                 ElizaOS Plugin export, npm entry point
worker/index.ts               Cloudflare Worker entry
worker/router.ts              Haiku-first routing + cost math
worker/cache.ts               KV cache + content-hash keys
worker/audit-log.ts           Chain-hashed KV decision log
worker/*.test.ts              Unit tests (vitest)
bench/corpus.ts               100-prompt trading-sentiment corpus
bench/run.ts                  Benchmark runner, mock + live modes
bench/results.md              Latest measured output (live mode)
docs/                         Architecture, cost optimization, decision log details
examples/character.ts         Minimal ElizaOS character config
```

## License

MIT. See [LICENSE](./LICENSE).
