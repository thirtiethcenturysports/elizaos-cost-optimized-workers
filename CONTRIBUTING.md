# Contributing

Thanks for considering a contribution. This is a small repo with a focused scope.

## Scope

This project demonstrates one ElizaOS plugin + one Cloudflare Worker doing confidence-based model downgrade with KV cache and append-only audit log. Patterns out of scope (for now):

- Task decomposition orchestrators
- Batched inference endpoints
- Multi-Worker fan-out via Queues / Durable Objects
- Non-classification action types

If you want any of those, the [Roadmap](./README.md#roadmap) is the right place to start a discussion.

## Local setup

```bash
git clone https://github.com/thirtiethcenturysports/elizaos-cost-optimized-workers.git
cd elizaos-cost-optimized-workers
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

If you publish numbers based on this repo, run `--mode=live` first. Mock-mode numbers are reproducible but not measurements. Don't ship the mock-mode 53% as a real-world claim without verification.
