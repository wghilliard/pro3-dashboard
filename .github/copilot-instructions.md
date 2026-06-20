# pro3-dashboard — Copilot instructions

Single-page dashboard for the PRO3 racing league. SvelteKit 2 + Svelte 5 on Cloudflare Pages, with a thin server-side proxy/normalizer in front of the legacy ICSCC points feed.

## Stack

- **SvelteKit 2** with **Svelte 5 in runes mode** (forced for project files via `vite.config.ts`; don't write legacy `$:`/`export let` syntax).
- **TypeScript strict** (`tsconfig.json`), `moduleResolution: bundler`, `checkJs` on.
- **Vite 8** build tooling.
- **Cloudflare Pages** deploy target via `@sveltejs/adapter-cloudflare`. Bindings live in `wrangler.toml` and are typed in `src/app.d.ts` under `App.Platform`. `npm run dev` proxies the wrangler config so `event.platform.env` / `waitUntil` work locally.
- **Vitest** for tests, configured in `vite.config.ts` with two projects:
  - `server` — Node environment, picks up `src/**/*.{test,spec}.ts`
  - `client` — Playwright/Chromium browser, picks up `src/**/*.svelte.{test,spec}.ts`
  - `expect.requireAssertions` is on — every test must have at least one assertion.

## Commands

- `npm run dev` — Vite dev server (with Cloudflare platformProxy).
- `npm run build` / `npm run preview` — production build / local preview.
- `npm run check` — `svelte-kit sync && svelte-check`. This is the closest thing to a typecheck; run it after non-trivial changes.
- `npm run lint` — `prettier --check . && eslint .`.
- `npm run format` — Prettier write.
- `npm run test` — Vitest single-pass run (all projects). Use `-- --project=server` or `-- --project=client` to scope, and `-- <pattern>` to filter (e.g. `npm run test -- icscc`).
- `npm run test:unit` — Vitest in watch mode.

### Local node toolchain (this machine)

Node/npm are installed via nvm and **not on PATH in non-interactive shells**. Source nvm first:

```sh
source "$HOME/.nvm/nvm.sh" && nvm use default
```

## Test-driven development

**This project follows TDD.** When asked to add or change behavior:

1. **Write the test first.** Capture the expected behavior as a failing test before touching implementation code. Let the test name and assertions force you to define the contract up front.
2. **Run it and watch it fail** for the right reason (assertion failure, not a compile/import error). A red test you didn't expect tells you the contract is wrong before you've written any code.
3. **Write the smallest implementation** that makes the test pass. Resist scope creep — additional behavior gets additional tests first.
4. **Refactor** with the green test as a safety net.

Lean on the framework to guide design:

- **Pure functions first.** The `src/lib/server/icscc.ts` layer is deliberately framework-free so tests can call `normalize(rawJson, season)` directly with fixtures from `src/lib/server/__fixtures__/` — no HTTP, no mocking. Mirror this split for any new logic: if it's hard to test, it probably belongs in a pure module rather than inside a `+server.ts` / `+page.server.ts`.
- **Test the wire contract, not the upstream shape.** Assertions should target `PointsResponse` (the type in `src/lib/types.ts`). That keeps tests stable when ICSCC changes its payload and surfaces breaking changes to clients immediately.
- **Cover the upstream quirks explicitly.** Every quirk listed under "Upstream (ICSCC) quirks" deserves a regression test — year patching, ms↔s lap-time conversion, integer-vs-raw points, PRO3 filtering, eligibility/`null` position. These are exactly the behaviors that will silently regress.
- **HTTP route tests** belong at the `+server.ts` layer and should focus on what's unique to it: param validation (400s, range errors), ETag forwarding (304 passthrough), and `Cache-Control` headers. Don't re-test normalization here.

**No test runner is checked in yet.** Vitest is the canonical choice for SvelteKit/Vite projects — install it (with `@vitest/ui` optional) and wire `npm run test` / `npm run test:watch` scripts the first time TDD is needed. Add a `vitest.config.ts` that reuses the existing Vite config so `$lib` aliases resolve.

### Test layout & conventions

- **Co-locate tests with the code they test.** `src/lib/server/icscc.ts` → `src/lib/server/icscc.test.ts`. The vitest globs in `vite.config.ts` require tests to live under `src/`.
- **Component tests use the `.svelte.test.ts` suffix** and run in the `client` (browser) project. Plain `.test.ts` runs in the `server` (Node) project.
- **Fixtures live in `__fixtures__/` directories next to their tests.** The double-underscore name is a Vitest/Jest convention — it's never matched by the test glob even though it sits inside `src/`. Captured upstream payloads belong there (e.g. `src/lib/server/__fixtures__/icscc-2026.json`) and are excluded from Prettier via `.prettierignore`. Don't import fixtures from `scratch/` — that directory is gitignored exploration scratch space.
- **Fixtures are the ground truth.** When asserting on normalization, prefer asserting on real captured upstream payloads over hand-crafted minimal inputs. The 2026 fixture has the year bug; the 2025 fixture is a fully-completed historic season — together they cover most quirk regressions.

### Future option: Playwright MCP

When UI work starts in earnest, register `@playwright/mcp` (`/mcp` in Copilot CLI) so the agent can drive a real browser against `npm run dev` — author component flows live, then transcribe them into `*.svelte.test.ts`. Don't install it preemptively; it adds no value while only the SvelteKit starter page exists. This is orthogonal to (and lighter than) adding the Playwright Test runner for committed E2E suites — only add that if/when we want a separate E2E layer in CI.

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
