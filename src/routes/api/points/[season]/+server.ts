import { error, json } from '@sveltejs/kit';
import { fetchUpstream, normalize } from '$lib/server/icscc';
import type { RequestHandler } from './$types';

/**
 * GET /api/points/:season
 *
 * Proxies and normalizes the ICSCC class-points JSON, filtered to PRO3.
 * Slice 1 of the dashboard: leaderboard + minimal schedule.
 *
 * Caching strategy:
 *  - Edge cache: 5 minutes (`Cache-Control: public, max-age=300`).
 *    Race results don't change after a weekend wraps; in-race the upstream is
 *    re-fetched at most once every 5 min per edge POP.
 *  - Conditional GET upstream: forwards `If-None-Match` from our cached ETag
 *    so we get cheap 304s and don't burn the upstream rate limit (1000/window).
 *  - Browser-side `ETag` echoes our content hash so SWR-style clients revalidate
 *    without a full payload re-download.
 */

const EDGE_TTL_SECONDS = 300;
const SUPPORTED_MIN_SEASON = 2020;

export const GET: RequestHandler = async ({ params, request, fetch }) => {
	const season = parseSeason(params.season);

	const ifNoneMatch = request.headers.get('if-none-match');
	const upstream = await fetchUpstream(season, { ifNoneMatch, fetch });

	if (upstream.status === 304) {
		return new Response(null, {
			status: 304,
			headers: cacheHeaders(upstream.etag)
		});
	}

	const payload = normalize(upstream.body, season);
	payload.meta.upstreamEtag = upstream.etag;

	return json(payload, { headers: cacheHeaders(upstream.etag) });
};

function parseSeason(raw: string | undefined): number {
	if (!raw || !/^\d{4}$/.test(raw)) {
		throw error(400, 'season must be a 4-digit year, e.g. /api/points/2026');
	}
	const n = Number(raw);
	const currentYear = new Date().getUTCFullYear();
	if (n < SUPPORTED_MIN_SEASON || n > currentYear + 1) {
		throw error(404, `season ${n} is out of range`);
	}
	return n;
}

function cacheHeaders(etag: string | null): Record<string, string> {
	const headers: Record<string, string> = {
		'cache-control': `public, max-age=${EDGE_TTL_SECONDS}, s-maxage=${EDGE_TTL_SECONDS}`
	};
	if (etag) headers.etag = etag;
	return headers;
}
