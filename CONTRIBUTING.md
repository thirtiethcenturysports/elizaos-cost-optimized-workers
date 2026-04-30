# Contributing

Thanks for considering a contribution. This is a small repo with a focused scope.

## Scope

This project is the canonical Cloudflare integration for ElizaOS agents. It ships three subsystems on a single Worker: KV-backed response cache (stable), replayable per-task decision log with chain-hash integrity check (stable), and an experimental cost-aware model router. Patterns out of scope (for now):

- Task decomposition orchestrators
- Batched inference endpoints (Cloudflare Queue integration is on the roadmap)
- Non-classification action types
- Witness-anchored tamper-resistance (on the roadmap; current decision log is honest about its limits)

If you want any of those, the [Roadmap](./README.md#roadmap) is the right place to start a discussion.

## Local setup

```bash
git clone https://github.com/thirtiethcenturysports/elizaos-plugin-cloudflare.git
cd elizaos-plugin-cloudflare
npm install
cp .dev.vars.example .dev.vars   # add your ANTHROPIC_API_KEY
npm run typecheck
npm test
npm run bench                    # mock mode
```

## Pull requests

- Run `npm run typecheck` and `npm test` before opening a PR
- Keep PRs small and focused on one change
- If you change cost-relevant code (router, cache, model selection), re-run `npm run bench` and update `bench/results.md`
- For doc changes, make sure code samples still match shipped code (we already burned ourselves on this once — see git history)

## Reporting issues

For bugs, include:
- Wrangler version (`npx wrangler --version`)
- Node version (`node -v`)
- Whether the issue is in mock or live bench mode (if applicable)
- Minimal reproduction

## Honest measurement

If you publish numbers based on this repo, run `--mode=live` first. Mock-mode numbers are reproducible but not measurements. The headline 42% / 71% in the README came from `--mode=live` against the real Anthropic API on 2026-04-30; do not modify that claim without re-running.
