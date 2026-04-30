# Cost Optimization

Four levers reduce LLM spend by ~82% versus naive single-model usage.

## Levers

1. **Task Decomposition** — split complex requests so cheap models handle simple subtasks
2. **Batching** — accumulate requests and send in bulk
3. **Response Caching** — return cached results for repeated queries
4. **Model Downgrade** — use the cheapest model that meets quality bar per task

## Heuristics

- Default to cheap model. Escalate only when confidence threshold not met.
- Cache TTL tuned per task type (sentiment: hours, generation: minutes)
- Batch size capped by latency SLA, not request volume
- Track per-task cost in append-only log; review weekly

## Measurement

- Baseline cost: sum of all model calls without optimization
- Optimized cost: actual spend after levers applied
- Savings: `(baseline - optimized) / baseline`
- Target: 80%+ reduction sustained

## Anti-Patterns

- Caching personalized responses (privacy + correctness risk)
- Over-batching (latency explodes, SLA misses)
- Premature downgrade (quality drops, downstream rework)
