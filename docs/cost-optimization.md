# Cost Optimization

The Worker has two cost-related levers: a stable KV-backed response cache, and an experimental confidence-based model router. Measured live against the Anthropic API on 2026-04-30 over the included 100-prompt corpus, the cache + router together cut cost by **42% cold-cache, 71% across two passes**. But the data also surfaced an inconvenient finding: on this corpus, **calling Haiku alone (no router) was both cheaper and slightly more accurate than the optimized router**.

## TL;DR

- **Cache: ship it.** Free wins for any repeat-heavy workload.
- **Router: measure before relying on it.** Cascade routing is workload-dependent. On forgiving classification tasks, the cheap model alone is often enough.

## Lever 1: KV response cache (stable)

Repeated identical prompts skip the model call entirely.

```ts
const key = `cache:${sha256(model + ':' + normalizedInput)}`;
const cached = await env.ROUTER_KV.get(key, 'json');
if (cached) return cached.result;  // 0 token cost

// ... model call ...

await env.ROUTER_KV.put(key, JSON.stringify(value), { expirationTtl: 3600 });
```

Normalization: trim + lowercase. Same input with different whitespace or case hits the same key. TTL is enforced by KV's `expirationTtl`; no manual eviction loop.

### When the cache pays off

- Same news headline classified across many agents
- Same tool description seen by many agent invocations
- Recurring user queries with deterministic results

### When the cache barely helps

- Long unique prompts with timestamps, user IDs, or session tokens embedded
- Highly personalized agent contexts
- One-shot workloads with no repeats

## Lever 2: Confidence-based model router (experimental)

Call the cheap model first. Escalate to the expensive model when the cheap output is unreliable.

Pseudocode (real implementation in [worker/router.ts](../worker/router.ts)):

```ts
const cheapResult = await callModel(input, 'claude-haiku-4-5');
const parsed = parseSentiment(cheapResult.text);

if (parsed && parsed.confidence >= 0.75) {
  return parsed;
}

// Escalate to Sonnet on malformed or low-confidence cheap output
const expensive = await callModel(input, 'claude-sonnet-4-6');
return parseSentiment(expensive.text);
```

### Escalation triggers

The router escalates when any of these are true:

1. Haiku response fails JSON parse
2. Parsed object fails schema validation (`sentiment` not in `bullish|bearish|neutral`, `confidence` not in `[0, 1]`, `reasoning` missing)
3. `confidence < CONFIDENCE_THRESHOLD` (default `0.75`)

### Honest aggregate cost accounting

When the router escalates, the cost reported by the Worker **includes the wasted Haiku call**. Most cascade demos report only the cost of the winning model and quietly drop the failed cheap call from the total. That makes cascades look 20-40% cheaper than they actually are.

The bench in this repo accounts for both calls. That's why on the trading-sentiment corpus the optimized router measures at $0.0529 instead of the $0.0353 you'd get if you only counted the winning model. Honest math changes the conclusion.

## Measurement

| Scenario | Cost / 100 prompts | Accuracy | Notes |
|---|---:|---:|---|
| Naive (Sonnet always, no cache) | $0.0915 | 92.5% | Baseline |
| **Cheap-only (Haiku always)** | **$0.0310** | **93.8%** | Lower bound on cost AND tied/beat Sonnet on accuracy |
| Optimized (Haiku-first + escalate) | $0.0529 | 92.5% | 70% more expensive than Haiku-only with no accuracy gain on this corpus |
| Optimized + warm cache (2nd pass) | $0.0000 | — | Repeats cost nothing |

Numbers above are from live-mode benchmark against the real Anthropic API on 2026-04-30. Sample size is 80 decidable prompts (20 ambiguous excluded). Re-run with `npm run bench -- --mode=live` to verify on your own corpus.

### What this data is saying

The router exists because cascade routing is supposed to save money. On a forgiving classification task, **the cheap model is good enough that the escalation tier costs more than it saves**. Haiku alone wins on cost and ties on accuracy. The router is doing real work (24% escalation rate triggered by the 20 ambiguous prompts plus 4 schema-failed cheap calls) but the work isn't paying off in this regime.

The router earns its keep when:

- The cheap model fails loudly (refuses, returns malformed JSON, hallucinates structured fields) and the schema check catches it
- The task is high-stakes enough that 1-2 percentage points of accuracy matters more than 70% cost
- The cheap model's confidence calibration is reliable for *your* domain

If you're not in one of those situations, just use the cheap model directly. The bench gives you the data to make that call honestly instead of trusting a marketing claim.

## Anti-patterns

- **Caching personalized output.** Two users with the same input prompt may need different responses. Don't cache responses that depend on user identity unless the cache key includes the user.
- **Premature downgrade for high-stakes tasks.** Trading sentiment is forgiving; medical/legal classification is not. Tune `CONFIDENCE_THRESHOLD` upward for high-stakes work, or skip the cheap tier entirely.
- **Cache without TTL.** KV has no built-in LRU. Without `expirationTtl`, stale entries pile up indefinitely.
- **Trusting a cascade vendor's headline savings number.** If they don't include the cost of the failed cheap call in the total, the savings are inflated. Always check the methodology.
