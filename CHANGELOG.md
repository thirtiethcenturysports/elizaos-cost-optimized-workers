# Changelog

All notable changes to this project follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-30

Initial release.

### Added
- ElizaOS plugin (`@thirtieth/elizaos-plugin-cf-cost-router`) exporting `costRouterPlugin` with one Action: `CLASSIFY_TRADING_SENTIMENT`
- Cloudflare Worker (`worker/index.ts`) with four routes: `POST /classify`, `GET /audit/:taskId`, `GET /audit/:taskId/verify`, `GET /stats`, `GET /health`
- Confidence-based model router (`worker/router.ts`): Haiku-first, escalates to Sonnet on `confidence < 0.75` or schema-invalid output
- KV-backed response cache (`worker/cache.ts`) with content-hash keys and TTL eviction
- Append-only audit log (`worker/audit-log.ts`) with chain-hashed entries and integrity verification
- 100-prompt benchmark corpus (`bench/corpus.ts`) and runner (`bench/run.ts`) supporting `--mode=mock` (free, deterministic) and `--mode=live` (real Anthropic API)
- Architecture, cost-optimization, and audit-log docs (`docs/`)
- 16 unit tests covering cache key hashing, sentiment parsing, and cost computation

### Verified
- Live-mode benchmark run on 2026-04-30 against the real Anthropic API. Headline numbers updated from mock estimates (53% / 77%) to verified live measurements (42% / 71%). Live mode also produced real classification accuracy: Naive Sonnet 92.5%, Cheap-only Haiku 93.8%, Optimized 92.5%.

### Known limitations
- Cache stats counter and audit-log tail pointer use read-modify-write on KV; safe under the demo's single-writer-per-task pattern, not safe for concurrent writers (documented inline)
