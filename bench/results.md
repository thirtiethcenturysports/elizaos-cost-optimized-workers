# Benchmark Results

**Mode:** mock
**Corpus:** 100 trading-sentiment prompts (30 bullish, 30 bearish, 20 neutral, 20 ambiguous)
**Run duration:** 0.00s
**Generated:** 2026-04-30T15:59:59.729Z

## Headline

| | Cost | Savings vs naive |
|---|---:|---:|
| Naive baseline (Sonnet always, no cache) | $0.068415 | — |
| Cheap-only (Haiku always, no cache) | $0.018244 | 73.3% |
| **Optimized (Haiku-first + escalation, cold cache)** | **$0.031975** | **53.3%** |
| Optimized + warm cache (second pass) | $0.000000 | 100.0% |

**Cold cache, single pass:** 53.3% reduction vs Sonnet-always.
**Two passes with warm cache:** 76.6% reduction vs running naive twice.

## Routing behavior

- Escalations (Haiku low-confidence -> Sonnet): **20 / 100** (20.0%)
- Classification accuracy on **decidable** prompts (80 non-ambiguous):
  - Naive Sonnet: 100.0%
  - Cheap-only Haiku: 100.0%
  - Optimized: 100.0%

> Mock mode constructs responses to match the expected label, so accuracy ~100% in mock is uninformative. Run `--mode=live` to measure real classifier accuracy.

## Token totals

| Scenario | Input tokens | Output tokens |
|---|---:|---:|
| Naive baseline | 9,805 | 2,600 |
| Cheap-only | 9,805 | 2,600 |
| Optimized | 11,782 | 3,120 |

## Methodology

- **Cheap model:** `claude-haiku-4-5` ($0.0000008/input token, $0.000004/output token)
- **Expensive model:** `claude-sonnet-4-6` ($0.000003/input token, $0.000015/output token)
- **Confidence threshold:** 0.75 (Haiku output below this triggers escalation)
- **Token estimate (mock mode only):** `Math.ceil(text.length / 3.5)`, Anthropic English heuristic
- **Cache:** SHA-256 of `<model>:<normalized_input>`, normalization lowercases and trims

## Reproducing

```bash
npm run bench                  # mock mode (this run)
npm run bench -- --mode=live   # live mode, requires ANTHROPIC_API_KEY
```

Live mode hits the real Anthropic API and counts real tokens. Mock mode uses
Anthropic's published rates against character-count token estimates with a
deterministic mock LLM. Mock numbers are a model, not a measurement; use them
for reproducibility, then verify against live mode before publishing claims.

## Caveats

- The 100-prompt corpus is one author's hand-curated sample. Results vary with
  prompt distribution. Heavily ambiguous corpora drive escalation rate up and
  shrink savings.
- Cache benefit requires repeat queries. A workload with no repeats sees only
  the routing benefit (cheap-first), not the cache benefit.
- Token estimates in mock mode differ from live tokenization by 5-15%; the
  cost ratios are stable but absolute dollar figures are approximate.
