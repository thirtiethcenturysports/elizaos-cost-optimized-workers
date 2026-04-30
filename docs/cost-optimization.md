# Cost Optimization

This Worker uses two levers to reduce LLM cost: confidence-based model downgrade and KV response caching. Measured savings on the included 100-prompt corpus: **53% cold cache, 77% with warm cache** vs naive Sonnet-always.

## Lever 1: Confidence-based model downgrade

Rather than calling the expensive model for every request, call the cheap model first. Only escalate when the cheap output is unreliable.

Pseudocode (real implementation in [worker/router.ts](../worker/router.ts)):

```ts
const cheapResult = await callModel(input, 'claude-haiku-4-5');
const parsed = parseSentiment(cheapResult.text);

if (parsed && parsed.confidence >= 0.75) {
  return parsed;  // ~80% of prompts in the corpus
}

// Escalate to Sonnet only when Haiku output is malformed or low-confidence
const expensive = await callModel(input, 'claude-sonnet-4-6');
return parseSentiment(expensive.text);
```

### Escalation triggers

The router escalates when any of these are true:

1. Haiku response fails JSON parse
2. Parsed object fails schema validation (`sentiment` not in `bullish|bearish|neutral`, `confidence` not in `[0, 1]`, `reasoning` missing)
3. `confidence < CONFIDENCE_THRESHOLD` (default `0.75`)

Self-reported confidence is imperfect, but combined with hard schema validation it's a reasonable demo signal. Escalation rate on the included corpus is 20%, matching the 20 prompts labeled "ambiguous."

## Lever 2: KV response cache

Repeated identical prompts skip the model call entirely.

```ts
const key = `cache:${sha256(model + ':' + normalizedInput)}`;
const cached = await env.ROUTER_KV.get(key, 'json');
if (cached) return cached.result;  // 0 token cost

// ... model call ...

await env.ROUTER_KV.put(key, JSON.stringify(value), { expirationTtl: 3600 });
```

Normalization: trim + lowercase. Same input with different whitespace or case hits the same key. TTL is enforced by KV's `expirationTtl`; no manual eviction loop.

### Cache hit ratio depends on traffic

A workload of mostly-unique prompts gets the routing benefit (53%) but minimal cache benefit. A workload with repeated identical prompts (e.g. classifying the same news headline N times across N agents) gets close to 100% on hits.

## Measurement

| Scenario | Cost / 100 prompts | Notes |
|---|---:|---|
| Naive (Sonnet always, no cache) | $0.068 | Baseline |
| Cheap-only (Haiku always) | $0.018 | Lower bound, but accuracy degrades on ambiguous inputs |
| Optimized (Haiku-first + escalate) | $0.032 | Recommended default |
| Optimized + warm cache (2nd pass) | $0.000 | Repeats cost nothing |

Numbers are mock-mode (deterministic, free, reproducible). See [bench/results.md](../bench/results.md) for the full report and [bench/run.ts](../bench/run.ts) for the methodology.

## Why these and not other levers

The README mentions task decomposition and batching as additional patterns, but they're not implemented here. They require either:

- An orchestrator above the agent (decomposition) — out of scope for a single plugin
- Latency budget headroom (batching) — varies per workload, hard to demonstrate generically

This repo demonstrates the two levers that are universally applicable to ElizaOS plugins doing classification-style work. Other levers are listed in the [Roadmap](../README.md#roadmap).

## Anti-patterns

- **Caching personalized output.** Two users with the same input prompt may need different responses. Don't cache responses that depend on user identity unless the cache key includes the user.
- **Premature downgrade for high-stakes tasks.** Trading sentiment classification is forgiving; medical or legal classification is not. Tune `CONFIDENCE_THRESHOLD` upward for high-stakes work, or skip the cheap tier entirely.
- **Cache without TTL.** KV has no built-in LRU. Without `expirationTtl`, stale entries pile up indefinitely and your cache is wrong for as long as the data drifts.
