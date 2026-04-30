# Benchmark Results

**Mode:** live
**Corpus:** 100 trading-sentiment prompts (30 bullish, 30 bearish, 20 neutral, 20 ambiguous)
**Run duration:** 514.13s
**Generated:** 2026-04-30T16:18:02.862Z

## Headline

| | Cost | Savings vs naive |
|---|---:|---:|
| Naive baseline (Sonnet always, no cache) | $0.091515 | — |
| Cheap-only (Haiku always, no cache) | $0.031044 | 66.1% |
| **Optimized (Haiku-first + escalation, cold cache)** | **$0.052915** | **42.2%** |
| Optimized + warm cache (second pass) | $0.000000 | 100.0% |

**Cold cache, single pass:** 42.2% reduction vs Sonnet-always.
**Two passes with warm cache:** 71.1% reduction vs running naive twice.

## Routing behavior

- Escalations (Haiku low-confidence -> Sonnet): **24 / 100** (24.0%)
- Classification accuracy on **decidable** prompts (80 non-ambiguous):
  - Naive Sonnet: 92.5%
  - Cheap-only Haiku: 93.8%
  - Optimized: 92.5%

> Accuracy above is real (live API). Sample size is 80 decidable prompts; treat small differences between scenarios as noise.

## Token totals

| Scenario | Input tokens | Output tokens |
|---|---:|---:|
| Naive baseline | 6,400 | 4,821 |
| Cheap-only | 6,300 | 6,501 |
| Optimized | 7,845 | 7,697 |

## Methodology

- **Cheap model:** `claude-haiku-4-5` ($0.0000008/input token, $0.000004/output token)
- **Expensive model:** `claude-sonnet-4-6` ($0.000003/input token, $0.000015/output token)
- **Confidence threshold:** 0.75 (Haiku output below this triggers escalation)
- **Token estimate (mock mode only):** `Math.ceil(text.length / 3.5)`, Anthropic English heuristic
- **Cache:** SHA-256 of `<model>:<normalized_input>`, normalization lowercases and trims

## Reproducing

```bash
npm run bench                  # mock mode
npm run bench -- --mode=live   # live mode (this run), requires ANTHROPIC_API_KEY
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
