/**
 * HTTP-layer tests for `GET /api/points/[season]`.
 *
 * Scope is narrow on purpose — this file does NOT re-test normalization
 * (`icscc.test.ts` owns that). What lives here:
 *
 *  - Param validation (400 on bad input, 404 on out-of-range seasons)
 *  - Conditional GET behavior (forwarding `If-None-Match`, returning 304)
 *  - `Cache-Control` + `ETag` response headers
 *  - That `meta.upstreamEtag` round-trips into the response body
 *
 * The upstream is mocked with a plain `vi.fn()` — no msw needed because
 * `fetchUpstream` accepts an injected fetch (see `src/lib/server/icscc.ts`).
 * The SvelteKit handler is called directly; we never start an HTTP server.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';
import raw2026 from '$lib/server/__fixtures__/icscc-2026.json';

type PointsRouteEvent = Parameters<typeof GET>[0];

/**
 * Build a SvelteKit-shaped RequestEvent stub with just the fields our handler
 * touches. Cast through `unknown` so we don't have to fill every irrelevant
 * field on the real `RequestEvent` type.
 */
function makeEvent(opts: {
	season: string;
	fetch: typeof fetch;
	ifNoneMatch?: string;
}): PointsRouteEvent {
	const headers = new Headers();
	if (opts.ifNoneMatch) headers.set('if-none-match', opts.ifNoneMatch);

	const event = {
		params: { season: opts.season },
		request: new Request('http://test.local/api/points/' + opts.season, { headers }),
		fetch: opts.fetch
	} as unknown as PointsRouteEvent;
	return event;
}

/** Build a Response that mimics an ICSCC 200 reply with the 2026 fixture. */
function upstream200(etag = '"abc123"'): Response {
	return new Response(JSON.stringify(raw2026), {
		status: 200,
		headers: { 'content-type': 'application/json', etag }
	});
}

function upstream304(etag = '"abc123"'): Response {
	return new Response(null, { status: 304, headers: { etag } });
}

// -----------------------------------------------------------------------------
// param validation
// -----------------------------------------------------------------------------

describe('GET /api/points/[season] — param validation', () => {
	it('rejects non-numeric season with 400', async () => {
		const fetchMock = vi.fn();
		await expect(
			GET(makeEvent({ season: 'abcd', fetch: fetchMock as unknown as typeof fetch }))
		).rejects.toMatchObject({ status: 400 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects 3-digit season with 400', async () => {
		const fetchMock = vi.fn();
		await expect(
			GET(makeEvent({ season: '202', fetch: fetchMock as unknown as typeof fetch }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects 5-digit season with 400', async () => {
		const fetchMock = vi.fn();
		await expect(
			GET(makeEvent({ season: '20260', fetch: fetchMock as unknown as typeof fetch }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects season before 2020 with 404', async () => {
		const fetchMock = vi.fn();
		await expect(
			GET(makeEvent({ season: '2019', fetch: fetchMock as unknown as typeof fetch }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('rejects season more than one year in the future with 404', async () => {
		const fetchMock = vi.fn();
		const farFuture = String(new Date().getUTCFullYear() + 2);
		await expect(
			GET(makeEvent({ season: farFuture, fetch: fetchMock as unknown as typeof fetch }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('accepts the current and next year', async () => {
		// Important: return a *fresh* Response per call — Response bodies are
		// single-use streams, so a shared instance fails on the second read.
		const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(upstream200()));
		const currentYear = String(new Date().getUTCFullYear());
		const nextYear = String(new Date().getUTCFullYear() + 1);

		const res1 = await GET(
			makeEvent({ season: currentYear, fetch: fetchMock as unknown as typeof fetch })
		);
		const res2 = await GET(
			makeEvent({ season: nextYear, fetch: fetchMock as unknown as typeof fetch })
		);
		expect(res1.status).toBe(200);
		expect(res2.status).toBe(200);
	});
});

// -----------------------------------------------------------------------------
// happy-path response shape
// -----------------------------------------------------------------------------

describe('GET /api/points/[season] — 200 response', () => {
	it('returns Cache-Control and ETag headers', async () => {
		const fetchMock = vi.fn().mockResolvedValue(upstream200('"upstream-etag"'));

		const res = await GET(
			makeEvent({ season: '2026', fetch: fetchMock as unknown as typeof fetch })
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
		expect(res.headers.get('etag')).toBe('"upstream-etag"');
	});

	it('round-trips the upstream ETag into meta.upstreamEtag', async () => {
		const fetchMock = vi.fn().mockResolvedValue(upstream200('"upstream-etag"'));

		const res = await GET(
			makeEvent({ season: '2026', fetch: fetchMock as unknown as typeof fetch })
		);
		const body = await res.json();

		expect(body.meta.upstreamEtag).toBe('"upstream-etag"');
		expect(body.meta.season).toBe(2026);
	});

	it('calls upstream with the correct URL for the requested season', async () => {
		const fetchMock = vi.fn().mockResolvedValue(upstream200());

		await GET(makeEvent({ season: '2026', fetch: fetchMock as unknown as typeof fetch }));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledUrl = fetchMock.mock.calls[0][0];
		expect(calledUrl).toBe('https://www.icscc.com/points/2026/icsccClassPoints.json');
	});
});

// -----------------------------------------------------------------------------
// conditional GET
// -----------------------------------------------------------------------------

describe('GET /api/points/[season] — conditional GET', () => {
	it('forwards If-None-Match to the upstream', async () => {
		const fetchMock = vi.fn().mockResolvedValue(upstream200());

		await GET(
			makeEvent({
				season: '2026',
				fetch: fetchMock as unknown as typeof fetch,
				ifNoneMatch: '"client-etag"'
			})
		);

		const calledInit = fetchMock.mock.calls[0][1] as RequestInit;
		const calledHeaders = calledInit.headers as Record<string, string>;
		expect(calledHeaders['if-none-match']).toBe('"client-etag"');
	});

	it('returns 304 with no body when upstream returns 304', async () => {
		const fetchMock = vi.fn().mockResolvedValue(upstream304('"matched-etag"'));

		const res = await GET(
			makeEvent({
				season: '2026',
				fetch: fetchMock as unknown as typeof fetch,
				ifNoneMatch: '"matched-etag"'
			})
		);

		expect(res.status).toBe(304);
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
		expect(res.headers.get('etag')).toBe('"matched-etag"');
		// 304 must have empty body per RFC 9110.
		expect(await res.text()).toBe('');
	});

	it('does not forward an if-none-match header when the client did not send one', async () => {
		const fetchMock = vi.fn().mockResolvedValue(upstream200());

		await GET(makeEvent({ season: '2026', fetch: fetchMock as unknown as typeof fetch }));

		const calledInit = fetchMock.mock.calls[0][1] as RequestInit;
		const calledHeaders = calledInit.headers as Record<string, string>;
		expect(calledHeaders['if-none-match']).toBeUndefined();
	});
});

// -----------------------------------------------------------------------------
// upstream failures
// -----------------------------------------------------------------------------

describe('GET /api/points/[season] — upstream failures', () => {
	it('surfaces a 500-ish error when upstream returns 5xx', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('upstream down', { status: 502 }));

		// fetchUpstream throws on non-OK; SvelteKit turns thrown non-`error()`
		// into a 500 response in production. Here we just assert it rejects so
		// the contract is "we don't silently return garbage on upstream errors".
		await expect(
			GET(makeEvent({ season: '2026', fetch: fetchMock as unknown as typeof fetch }))
		).rejects.toThrow(/ICSCC upstream returned 502/);
	});
});

// Suppress an unused-type warning when RequestEvent isn't needed at runtime.
void (null as unknown as RequestEvent);
