# Changelog

All notable changes to this project follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-04-30

Patch release fixing two issues caught by the post-rename audit.

### Fixed
- `VERIFY_DECISION_LOG` action used a loose regex (`/[a-f0-9-]{8,}/i`) that false-matched hex-only English words like "feedback", "decade", "facade". Tightened to a strict UUID v4 shape with word-boundary anchors. Added regression tests in `src/plugin.test.ts`.
- `worker/audit-log.ts` source comment still claimed "tamper-evident chain" — replaced with honest framing pointing to `docs/append-only-logging.md` threat model. Source comments are GitHub-visible and the previous wording contradicted the public docs.

### Polish
- `examples/character.ts` plugin comment now matches README (mentions plugin-discord, plugin-telegram, etc.).

Test count: 22 passing (was 16; added 6 UUID regex tests).

## [0.2.0] - 2026-04-30

Reframe and rename. The package was previously published as `@thirtieth/elizaos-plugin-cf-cost-router` and the repo as `elizaos-cost-optimized-workers`. v0.2 repositions as the canonical Cloudflare integration for ElizaOS rather than a single-purpose cost router.

### Renamed
- npm package: `@thirtieth/elizaos-plugin-cf-cost-router` → `@thirtieth/elizaos-plugin-cloudflare`. v0.1 npm package deprecated with a redirect notice.
- GitHub repo: `elizaos-cost-optimized-workers` → `elizaos-plugin-cloudflare`. GitHub auto-redirects the old URL.
- Default plugin export: `costRouterPlugin` → `cloudflarePlugin`. Old name kept as a backwards-compat alias.
- Plugin setting: `COST_ROUTER_URL` → `CLOUDFLARE_WORKER_URL`. Old setting still accepted for v0.1 users.
- Worker name in `wrangler.toml`: `elizaos-cost-router` → `elizaos-cloudflare`.

### Added
- New `VERIFY_DECISION_LOG` plugin Action that calls `/audit/:taskId/verify` so an agent can self-check chain integrity.
- README "What this isn't" section explicitly naming what this primitive does NOT cover (replacement for Langfuse / Helicone, tamper-resistant audit log, fan-out orchestrator).
- README "Three features" structure with stable / experimental labels.
- Roadmap items for D1 backend, Cloudflare Queue integration, OpenTelemetry exporter, witness anchor for stronger tamper claims, multi-provider support.

### Changed: honesty fixes
- Decision log framing demoted from "tamper-evident audit log" to "replayable per-task decision log with integrity check **against a known-good copy**." The previous framing was overstated: with no external witness anchor, anyone with KV write access can rewrite the chain top-down without detection. New `docs/append-only-logging.md` includes a full threat model section naming what's covered and what isn't.
- Router framing demoted from "default cost optimization" to **experimental**. The 2026-04-30 live benchmark showed Haiku alone (no router) was both cheaper AND more accurate than the optimized router on the included corpus. README and `docs/cost-optimization.md` now lead with this finding rather than burying it.
- Cost-optimization doc reframed: cache is the stable lever, router is the experimental lever, with explicit "when this pays off / when it doesn't" guidance.
- Architecture doc updated for new naming and the new `VERIFY_DECISION_LOG` action.

### Why this rename
Three independent reviewers (Trend Researcher, Software Architect, Developer Advocate) converged on the same finding: the v0.1 framing led with the weakest piece (the router) while the strongest positioning is "canonical Cloudflare integration for ElizaOS." The rename doesn't add features (mostly); it makes the framing match what the data actually supports and gives the plugin room to grow into the broader Cloudflare integration story (D1, Queues, R2, Workers AI) without another rename.

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
