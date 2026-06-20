# Testing strategy

How we test this project, layer by layer. This is a living document — update it
when we add a new test surface (e.g. when we register Playwright MCP, when we
add Slice 2 KV bindings, when we wire a real E2E suite).

## TL;DR

| Layer                       | Tool                                    | Where it lives                      | Speed            | What it catches                                                 |
| --------------------------- | --------------------------------------- | ----------------------------------- | ---------------- | --------------------------------------------------------------- |
| **Pure unit**               | Vitest (Node)                           | `src/lib/server/*.test.ts`          | ~5 ms            | Logic bugs in normalization, parsing, math                      |
| **HTTP endpoint**           | Vitest (Node) + injected `fetch`        | `src/routes/**/server.test.ts`      | ~30 ms           | Param validation, headers, status codes, contract round-trip    |
| **Component**               | Vitest browser (Playwright/Chromium)    | `src/**/*.svelte.test.ts`           | ~seconds         | Rendering, interaction, accessibility of a single component     |
| **Page integration**        | Vitest browser                          | `src/**/+page.svelte.test.ts`       | ~seconds         | A route's components, stores, and data loader composed together |
| **Browser E2E** _(not yet)_ | Playwright Test runner + Playwright MCP | `tests/e2e/**/*.spec.ts` _(future)_ | ~seconds–minutes | Whole-app flows against a real dev server                       |

Run the lot with `npm test`. Scope with `-- --project=server` or `-- --project=client`.

---

## Philosophy

Three rules that bias every test decision in this repo:

1. **Test the wire contract, not the upstream shape.** Our tests assert against
   the types we export to clients (`PointsResponse` from `src/lib/types.ts`),
   never against the raw ICSCC payload. If ICSCC changes their JSON tomorrow we
   should be able to fix normalization in one place and watch tests stay green —
   that's the whole point of having a proxy.

2. **Pure functions get exhaustive tests; HTTP gets thin tests.** Anything that
   can be a pure function should be — they're trivial to test, fast to run, and
   compose without ceremony. HTTP routes get a small set of tests that cover
   only what's unique to that layer (status codes, headers, validation), and
   delegate everything else to the pure layer's tests.

3. **Fixtures over fakes.** Real captured upstream payloads are the ground
   truth. Hand-crafted minimal inputs are fine for error cases, but the happy
   path should run against real data so we catch upstream weirdness we never
   would have thought to mock.

---

## Layer 1 — Pure unit tests (Node)

**What:** Tests for functions that take inputs and return outputs, no I/O.
**Project:** `server` (Node environment).
**Location:** Co-located with implementation. `src/lib/server/icscc.ts` →
`src/lib/server/icscc.test.ts`.
**Example:** `src/lib/server/icscc.test.ts` (17 tests covering year patching,
unit conversion, decimal-point tiebreakers, eligibility, sparse results,
status passthrough, error cases).

### What belongs here

- Parsing, formatting, normalization
- Math and aggregation (point totals, fastest-lap derivation, ranking)
- Validation logic (`parseSeason`, future date parsing, etc.)
- Anything that doesn't need a `Request`, `Response`, DOM, or filesystem

### What does NOT belong here

- Anything that does `fetch()` against a real upstream — use the HTTP layer
  with an injected `fetch` mock instead
- Rendering Svelte components — that's Layer 3
- Cloudflare bindings (`platform.env.KV`, `caches.default`) — those need the
  browser project or wrangler emulation

### Fixtures

Live in `__fixtures__/` next to the test file. The double-underscore name is
a Vitest/Jest convention — Vitest never matches it as a test file even though
it sits inside `src/`. Captured upstream payloads go here:

```
src/lib/server/
├── icscc.ts
├── icscc.test.ts
└── __fixtures__/
    ├── icscc-2026.json   ← current season, has the year bug
    └── icscc-2025.json   ← completed historic season, no quirks
```

The two existing fixtures intentionally cover orthogonal quirks. Add a new
one when you encounter a regression case the current pair doesn't reach.

Fixtures are excluded from Prettier via `.prettierignore` and from the test
glob via the `__fixtures__/` directory name.

### Conventions

- Group related tests in `describe()` blocks named after the function or
  scenario, not the test type.
- Prefer one assertion per test when it doesn't bloat setup; bundle when
  they're testing the same invariant.
- `vitest.config.ts` has `expect.requireAssertions = true` — every test
  must have at least one assertion.
- For testing throws, prefer `expect(...).toThrow(/pattern/)` over
  try/catch — clearer intent and better failure messages.

---

## Layer 2 — HTTP endpoint tests (Node)

**What:** Tests for SvelteKit `+server.ts` handlers — the thin HTTP shell
around our pure logic.
**Project:** `server` (Node environment).
**Location:** Co-located with the route file as `server.test.ts` (avoids the
SvelteKit-reserved `+server.test.ts` name, which the framework would try to
treat as a route).
**Example:** `src/routes/api/points/[season]/server.test.ts` (13 tests).

### How they work

Import the `GET` / `POST` / etc. handler directly and call it with a
hand-built `RequestEvent`-shaped object. Mock the upstream `fetch` with
`vi.fn()`. No HTTP server, no port binding, no network.

```ts
import { GET } from './+server';

const fetchMock = vi
	.fn()
	.mockResolvedValue(
		new Response(JSON.stringify(fixture), { status: 200, headers: { etag: '"x"' } })
	);
const res = await GET(makeEvent({ season: '2026', fetch: fetchMock }));
expect(res.status).toBe(200);
```

The `fetchUpstream` helper in `icscc.ts` accepts an injected `fetch` precisely
to make this possible without msw or similar.

### What belongs here

- Status codes — what the handler returns for valid/invalid/missing input
- Response headers — `Cache-Control`, `ETag`, `Vary`, etc.
- Conditional GET behavior — `If-None-Match` forwarding, 304 passthrough
- That upstream errors don't silently become 200s with garbage
- That the response body's meta fields round-trip correctly

### What does NOT belong here

- Re-testing what `normalize()` does — Layer 1 owns that
- Real network calls — always mock the injected fetch
- Cloudflare cache or KV behavior — those need wrangler emulation

### Single-use Response gotcha

`Response.body` is a stream that can only be read once. When mocking a fetch
that might be called more than once, use `mockImplementation` with a fresh
`Response` per call, not `mockResolvedValue` with a shared instance:

```ts
// ❌ second call fails: "Body has already been read"
const fetchMock = vi.fn().mockResolvedValue(upstream200());

// ✅ each call gets a fresh Response
const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(upstream200()));
```

---

## Layer 3 — Component tests (browser)

**What:** Tests for individual Svelte components — does it render, does it
respond to clicks, does it set the right ARIA attributes.
**Project:** `client` (Playwright/Chromium browser).
**Location:** Co-located with the component, `*.svelte.test.ts` suffix.
`Leaderboard.svelte` → `Leaderboard.svelte.test.ts`.
**Library:** `vitest-browser-svelte` (already installed).
**Example:** _(none yet — added once we start building components)_

### How they work

```ts
import { render } from 'vitest-browser-svelte';
import Leaderboard from './Leaderboard.svelte';

it('renders a row per driver', async () => {
	const screen = render(Leaderboard, { props: { standings: fixture.standings } });
	await expect.element(screen.getByRole('row')).toBeInTheDocument();
});
```

Real Chromium, real layout, real event dispatching. Slower than unit tests
(seconds, not milliseconds) but catches things JSDOM-style fakes can't:
real CSS, real `scrollIntoView`, real focus management.

### What belongs here

- Component renders correct DOM for given props
- User interactions (click, keyboard, focus) produce expected state changes
- Conditional rendering (loading / error / empty states)
- Accessibility queries (`getByRole`, `getByLabelText`) succeed
- Custom events fire with the right detail

### What does NOT belong here

- Data fetching — pass data in via props; test the loader separately
- Multi-page flows — that's Layer 5
- Testing CSS values directly (brittle and almost never what we care about)

### Conventions

- Prefer `getByRole`, `getByLabelText`, `getByText` over selectors. Tests
  that work the way assistive tech does catch a11y bugs for free.
- Use the user's perspective: test outcomes ("the leaderboard shows the
  driver"), not implementation ("the `<tr>` element has class `x`").

---

## Layer 4 — Page integration tests (browser)

**What:** A route's `+page.svelte`, its load function, and the components it
composes — tested together.
**Project:** `client`.
**Location:** Co-located with the route. `src/routes/+page.svelte` →
`src/routes/+page.svelte.test.ts`.
**Example:** _(none yet)_

These mostly look like Layer 3 tests but with more component depth and the
route's `load` function feeding real (or fixture) data through. Use sparingly —
prefer testing components in isolation when feasible.

---

## Layer 5 — Browser E2E _(not yet wired up)_

**Status:** Deferred until there's enough UI to make whole-app flows
meaningful. Probably mid-Slice 1.

**Plan when we get there:**

- **Tool:** Playwright Test runner (separate from vitest's browser project).
  Lives in `tests/e2e/`. Not co-located with source.
- **What it covers:** "User lands on the dashboard, sees the leaderboard,
  clicks a driver row, sees their per-race breakdown." Whole-app flows
  against a real `npm run preview` server (or a deployed Pages preview).
- **What it does NOT cover:** Rendering details (Layer 3 owns those),
  business logic (Layer 1), HTTP contracts (Layer 2). E2E is the last line
  of defense, not the first.

### Why a separate runner from vitest

Vitest's browser project is purpose-built for component tests inside a Vite
dev environment. Playwright Test gives us proper E2E features: multi-page
navigation, network interception, video/trace artifacts on failure, parallel
worker isolation, and built-in retry-on-flake. Different problem, different
tool.

### Playwright MCP (authoring aid)

A Microsoft-maintained MCP server (`@playwright/mcp`) lets the Copilot CLI
agent drive a real Chromium during a session. We'll register it via `/mcp`
once Layer 5 work starts. Use it for **authoring** tests interactively:

1. Build the feature.
2. Have the agent open `localhost:5180` in the MCP browser and walk the
   intended user flow.
3. Have the agent transcribe what worked into a committed `.spec.ts`.
4. `playwright test` runs that suite in CI like any other.

The MCP server is an authoring tool, not a runtime — it never executes during
CI. Don't conflate the two.

---

## Running tests

```sh
# everything (server + client projects)
npm test

# just the fast Node tests (most common during development)
npm test -- --project=server

# just the browser/component tests
npm test -- --project=client

# pattern filter
npm test -- icscc                 # only files matching "icscc"
npm test -- --project=server normalize  # only normalize-related tests

# watch mode (Vitest default — runs continuously, re-runs on save)
npm run test:unit

# narrow watch by test name pattern
npm run test:unit -- -t "year patch"
```

### TDD loop

The canonical workflow for new behavior (see also `copilot-instructions.md`):

1. **Write the failing test first.** Make it specific enough that there's a
   single obvious implementation.
2. **Run it; confirm it fails for the right reason.** Compile errors and
   missing imports don't count — the assertion should fire.
3. **Write the smallest implementation that makes it pass.**
4. **Refactor.** The green test is your safety net.

Pair this loop with `npm run test:unit -- -t "<your describe block>"` in a
side terminal so the test reruns on every save.

---

## CI integration _(not yet wired up)_

When we add CI (GitHub Actions, likely), the pipeline should be:

```
npm ci
npm run lint
npm run check
npm test
npm run build
```

In that order — fastest signal first. Format/lint catches the most common
mistakes in seconds; type-check catches the next tier; tests run on a known-
good codebase; build is the final gate. `npm test` runs both projects, which
spins up Chromium for the `client` project — that's fine on GitHub-hosted
runners but adds ~10 seconds of overhead.

---

## What's intentionally NOT in our test surface

These are real things people test that we've decided are not worth the cost
right now:

- **Snapshot tests.** Easy to commit, easy to ignore when they break. They
  test that "the output didn't change," which is rarely what we actually
  want to assert. Use them only for stable, structured output (e.g. a CLI's
  help text), and we don't have any of that yet.
- **Visual regression / screenshot diffing.** Powerful but heavy. Reconsider
  if/when the design system stabilizes and we have a hosted runner.
- **Worker runtime tests** (`vitest-pool-workers`). Only worth the complexity
  if we end up with non-trivial logic that depends on Cloudflare-specific
  bindings. Slice 2's KV reads are not non-trivial — a unit-test on the
  abstraction over `KVNamespace.get` is enough.
- **Performance / load tests.** Not relevant for a content site backed by an
  edge cache. The hardest thing this app does is JSON parsing on a cold
  cache, and that's bounded by ICSCC's response time, not ours.
