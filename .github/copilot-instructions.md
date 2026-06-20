# pro3-dashboard — Copilot instructions

Single-page dashboard for the PRO3 racing league. SvelteKit 2 + Svelte 5 on Cloudflare Pages, with a thin server-side proxy/normalizer in front of the legacy ICSCC points feed.

## Stack

- **SvelteKit 2** with **Svelte 5 in runes mode** (forced for project files via `vite.config.ts`; don't write legacy `$:`/`export let` syntax).
- **TypeScript strict** (`tsconfig.json`), `moduleResolution: bundler`, `checkJs` on.
- **Vite 8** build tooling.
- **Cloudflare Pages** deploy target via `@sveltejs/adapter-cloudflare`. Bindings live in `wrangler.toml` and are typed in `src/app.d.ts` under `App.Platform`. `npm run dev` proxies the wrangler config so `event.platform.env` / `waitUntil` work locally.
- **Vitest** for tests. See `docs/testing.md` for the full layered strategy, conventions, and TDD loop.

## Commands

- `npm run dev` — Vite dev server (with Cloudflare platformProxy).
- `npm run build` / `npm run preview` — production build / local preview.
- `npm run check` — `svelte-kit sync && svelte-check`. This is the closest thing to a typecheck; run it after non-trivial changes.
- `npm run lint` — `prettier --check . && eslint .`.
- `npm run format` — Prettier write.
- `npm run test` — Vitest. See `docs/testing.md` for invocation patterns (project filters, name patterns, watch mode).

### Local node toolchain (this machine)

Node/npm are installed via nvm and **not on PATH in non-interactive shells**. Source nvm first:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use default
```

## Testing

This project follows **TDD**: write the failing test first, watch it fail for the right reason, write the smallest implementation that passes, refactor.

See **[`docs/testing.md`](../docs/testing.md)** for the canonical strategy: layer-by-layer breakdown (pure / HTTP / component / page integration / E2E), conventions (co-location, `__fixtures__/`, fixtures-as-ground-truth), the wire-contract-not-upstream-shape rule, the Playwright MCP plan, and CI ordering. Keep that document in sync when adding a new test surface — do not duplicate its content here.

The app is a SvelteKit project with a small server-side API that proxies and normalizes upstream ICSCC data. The work is broken into "slices":

- **Slice 1 (current):** leaderboard + minimal schedule, served by `GET /api/points/[season]`.
- **Slice 2 (planned):** schedule enrichment scraped from `season.php`, persisted in a Cloudflare KV namespace (`SCHEDULE_KV`, currently commented out in `wrangler.toml` and `app.d.ts`). The `ScheduleResponse` / `ScheduleEntry` types and the `weekendName` / `links` fields on `RaceEvent` are placeholders for Slice 2 — they're typed but not yet populated.

### Layering of the points endpoint

1. **`src/lib/server/icscc.ts`** — pure functions only. No SvelteKit / Cloudflare imports. Handles upstream fetch + normalization. Easy to reason about and (eventually) unit-test in isolation.
2. **`src/routes/api/points/[season]/+server.ts`** — thin HTTP layer. Owns request validation, ETag forwarding, and `Cache-Control` headers. Don't put normalization logic here.
3. **`src/lib/types.ts`** — the wire contract returned by the proxy. **This is not a mirror of the ICSCC JSON.** Goal is ~30 KB for a full season (vs. 683 KB raw), filtered to the PRO3 class only. When adding fields, update this file; treat it as the source of truth for what clients receive.

### Upstream (ICSCC) quirks you must respect

The whole point of the proxy is to paper over these. Don't "fix" them by reading raw upstream values in client code:

- **Wrong year on current-season dates.** `/points/{year}/icsccClassPoints.json` labels dates with the previous year. `normalize()` overrides the year using the requested season and flags it in `meta.yearPatched`.
- **Mixed lap-time units.** Race-level `fastestlap` is **milliseconds**; driver-level `fastestlap` map is **seconds**. Both are normalized to `LapSeconds` (seconds with ms precision, or `null`). See `msToSeconds` and the comment in `normalizeRow`.
- **Decimal points encode tiebreakers.** `points` / `total` are integers (via `Math.trunc`); the raw decimal is preserved as `pointsRaw` / `totalRaw` for sorting. Never display `*Raw` values directly.
- **Rate limit ~1000/window** upstream. Endpoints forward `If-None-Match` so we cheaply get 304s; preserve this behavior when editing the endpoint or fetch helper.
- **Edge cache TTL is 5 minutes** (`Cache-Control: public, max-age=300, s-maxage=300`). Race results are immutable after the weekend, so this is fine.

## Conventions

- **Path alias:** `$lib` → `src/lib` (SvelteKit default; do not redefine in `tsconfig.json`).
- **Server-only code** lives under `src/lib/server/` and is enforced by SvelteKit's import rules — keep upstream fetching and any secrets there.
- **Pure-vs-HTTP split:** mirror the icscc.ts / +server.ts pattern for any new upstream integration. Pure normalization stays free of framework imports.
- **Formatting (Prettier):** tabs, single quotes, no trailing commas, print width 100. Run `npm run format` rather than hand-formatting.
- **Comments:** the existing modules use top-of-file JSDoc blocks to explain _why_ (especially upstream quirks). Follow that style for non-obvious logic; skip comments for self-explanatory code.
- **`scratch/`** is gitignored and holds sample upstream payloads / scraped HTML used during exploration. Don't import from it in app code, and don't commit new fixtures there expecting them to land in git.
- **Workspace boundaries:** keep downloads, scratch data, and temp artifacts inside this project directory — don't write to `/tmp` or outside the repo.

## Things not yet wired up

- No KV bindings, no scraper, no client UI beyond the SvelteKit starter (`src/routes/+page.svelte` is still the default "Welcome to SvelteKit"). When asked to build UI, assume you're starting from scratch.
- `wrangler.toml` has placeholder comments for the Slice 2 KV namespace; uncomment and add an `id` when actually provisioning.
