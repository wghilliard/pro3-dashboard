# pro3-dashboard

Single-page dashboard for the [PRO3 racing league](https://www.pro3-racing.com/) — leaderboards, schedule, and links in one place for drivers, fans, and visitors.

The app is a **SvelteKit 2 + Svelte 5 (runes)** project deployed to **Cloudflare Pages**. A thin server-side proxy normalizes the legacy ICSCC points feed into a small, stable wire contract for the client.

See [`docs/idea.md`](./docs/idea.md) for the product brief.

## Stack

- SvelteKit 2 / Svelte 5 (runes mode), TypeScript strict
- Vite 8 build tooling
- `@sveltejs/adapter-cloudflare` — deploys to Cloudflare Pages, with bindings declared in [`wrangler.toml`](./wrangler.toml)
- Vitest with two projects: `server` (Node) and `client` (Playwright/Firefox browser)
- Prettier + ESLint

## Architecture

- **`src/lib/server/icscc.ts`** — pure normalizer: fetch + transform the upstream ICSCC JSON into [`PointsResponse`](./src/lib/types.ts). No framework imports, easy to test directly against captured fixtures.
- **`src/routes/api/points/[season]/+server.ts`** — thin HTTP layer: param validation, `If-None-Match` / ETag forwarding, `Cache-Control` headers (5 min edge TTL).
- **`src/lib/types.ts`** — the wire contract returned by the proxy. Targets ~30 KB for a full season (vs. 683 KB raw upstream), filtered to the PRO3 class and with upstream quirks (wrong year on current-season dates, mixed lap-time units, tiebreaker-encoding decimal points) papered over.

A future slice will scrape `season.php` for schedule enrichment and cache it in a Cloudflare KV namespace (`SCHEDULE_KV`, currently stubbed out).

## Developing

```sh
npm install
npm run dev          # Vite dev server with Cloudflare platformProxy (so event.platform.env works locally)
npm run dev -- --open
```

Try the points proxy: <http://localhost:5173/api/points/2026>

## Scripts

| Command                             | What it does                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`                       | Vite dev server with Cloudflare bindings proxied from `wrangler.toml`.                                 |
| `npm run build` / `npm run preview` | Production build / local preview.                                                                      |
| `npm run check`                     | `svelte-kit sync && svelte-check` — closest thing to a typecheck.                                      |
| `npm run lint`                      | `prettier --check . && eslint .`                                                                       |
| `npm run format`                    | Prettier write.                                                                                        |
| `npm run test`                      | Vitest single-pass run (all projects). Scope with `-- --project=server` or filter with `-- <pattern>`. |
| `npm run test:unit`                 | Vitest in watch mode.                                                                                  |

## Testing

This project follows **TDD**: write the failing test first, watch it fail for the right reason, then implement.

- Plain `*.test.ts` runs in the **`server`** (Node) project.
- `*.svelte.test.ts` runs in the **`client`** (Firefox via Playwright) project.
- Tests live alongside their source; fixtures live in `__fixtures__/` directories (excluded from the test glob and from Prettier).
- `expect.requireAssertions` is on — every test must assert.

## Deployment

Deployed via `@sveltejs/adapter-cloudflare` to Cloudflare Pages. Bindings (KV, etc.) are declared in `wrangler.toml` and typed in [`src/app.d.ts`](./src/app.d.ts) under `App.Platform`.
