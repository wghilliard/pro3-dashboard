/**
 * ICSCC points proxy + normalization.
 *
 * Pure functions, no SvelteKit/Cloudflare imports — keeps this module trivially
 * testable. The HTTP layer lives in `src/routes/api/points/[season]/+server.ts`.
 *
 * Upstream quirks handled here (see plan.md for full notes):
 *  - Current-season `/points/{year}/` JSON labels dates with the previous year.
 *    We override the year using the season we requested.
 *  - Lap times come in mixed units (ms at race level, s at driver level).
 *    We normalize to seconds with millisecond precision.
 *  - Points are decimals where the fractional part encodes tiebreakers; we
 *    surface both the integer (`points`) and raw (`pointsRaw`) values.
 */

import type {
	DriverStanding,
	IsoDate,
	PointsResponse,
	RaceEvent,
	RaceResult,
	RaceStatus,
	SeasonMeta
} from '$lib/types';

const ICSCC_BASE = 'https://www.icscc.com/points';
const PRO3_CLASS = 'PRO3';

/** Build the upstream URL for a season. */
export function upstreamUrl(season: number): string {
	return `${ICSCC_BASE}/${season}/icsccClassPoints.json`;
}

/**
 * Fetch upstream points JSON. Forwards conditional-request headers when provided
 * so the caller can cheaply revalidate against ICSCC's ETag.
 */
export async function fetchUpstream(
	season: number,
	init?: { ifNoneMatch?: string | null; fetch?: typeof fetch }
): Promise<{ status: number; etag: string | null; body: unknown | null }> {
	const f = init?.fetch ?? fetch;
	const headers: Record<string, string> = { accept: 'application/json' };
	if (init?.ifNoneMatch) headers['if-none-match'] = init.ifNoneMatch;

	const res = await f(upstreamUrl(season), { headers });
	const etag = res.headers.get('etag');

	if (res.status === 304) return { status: 304, etag, body: null };
	if (!res.ok) {
		throw new Error(`ICSCC upstream returned ${res.status} for season ${season}`);
	}
	const body = await res.json();
	return { status: res.status, etag, body };
}

/**
 * Normalize the raw ICSCC payload into our `PointsResponse` shape, filtered to
 * PRO3 only.
 *
 * `season` is the source of truth for the year; date strings from upstream are
 * year-corrected to match.
 */
export function normalize(raw: unknown, season: number): PointsResponse {
	const data = raw as RawIcsccPayload;
	const pro3Table = data.tables.find((t) => t.class === PRO3_CLASS);
	if (!pro3Table) {
		throw new Error(`PRO3 class not found in upstream payload for ${season}`);
	}

	let yearPatched = false;
	const schedule = data.events.map<RaceEvent>((e) => {
		const parsed = parseIcsccDate(e.date);
		const date = patchYear(parsed, season, () => (yearPatched = true));
		const raceNumber = parseRaceNumber(e.id);
		const completed = pro3Table.rows.some((r) => e.id in r);
		return {
			raceNumber,
			label: e.id,
			date,
			completed,
			track: e.track,
			trackName: friendlyTrack(e.track),
			club: e.club,
			eventId: e.eventid,
			weekendName: null,
			links: emptyLinks()
		};
	});

	const standings = pro3Table.rows.map<DriverStanding>((r) => normalizeRow(r));
	const eligibleDrivers = standings.filter((s) => s.eligible).length;

	const meta: SeasonMeta = {
		season,
		class: 'PRO3',
		fetchedAt: new Date().toISOString(),
		upstreamEtag: null, // set by the HTTP layer
		scheduledRaces: schedule.length,
		completedRaces: schedule.filter((e) => e.completed).length,
		totalDrivers: standings.length,
		eligibleDrivers,
		yearPatched
	};

	return { meta, schedule, standings };
}

// -----------------------------------------------------------------------------
// internals
// -----------------------------------------------------------------------------

function normalizeRow(r: RawDriverRow): DriverStanding {
	const results: Record<number, RaceResult> = {};
	for (const [k, v] of Object.entries(r)) {
		if (!k.startsWith('Race ') || typeof v !== 'object' || v === null) continue;
		const race = v as RawRaceResult;
		const raceNumber = parseRaceNumber(k);
		const qualSession = race.sessions?.find((s) => s.type === 'qual') ?? null;
		results[raceNumber] = {
			raceNumber,
			carNumber: race.carnum,
			position: race.position,
			points: Math.trunc(race.points),
			pointsRaw: race.points,
			fastestLap: msToSeconds(race.fastestlap),
			status: race.status as RaceStatus,
			qualifying: qualSession
				? {
						position: qualSession.position,
						points: Math.trunc(qualSession.points),
						fastestLap: msToSeconds(qualSession.fastestlap),
						status: qualSession.status as RaceStatus
					}
				: null
		};
	}

	const fastestLapByTrack: Record<string, number | null> = {};
	for (const [track, sec] of Object.entries(r.fastestlap ?? {})) {
		// driver-level fastestlap is already in seconds (see plan.md)
		fastestLapByTrack[track] = typeof sec === 'number' && sec > 0 ? sec : null;
	}

	return {
		position: typeof r.pos === 'number' ? r.pos : null,
		name: r.name,
		carNumbers: Array.isArray(r.numbers) ? r.numbers.map(String) : [],
		total: Math.trunc(r.total ?? 0),
		totalRaw: typeof r.sortValue === 'number' ? r.sortValue : (r.total ?? 0),
		starts: r.starts ?? 0,
		finishes: r.finishes ?? 0,
		entries: r.entries ?? 0,
		eligible: !!r.eligible,
		ineligibilityReason: r.eligible ? null : (r.notes ?? null),
		fastestLapByTrack,
		results
	};
}

function emptyLinks(): RaceEvent['links'] {
	return {
		registration: null,
		announcement: null,
		supplementaryRules: null,
		results: null,
		qualifying: null,
		lapTimes: null
	};
}

/** "Race 12" -> 12. Throws on unexpected format. */
function parseRaceNumber(label: string): number {
	const m = /^Race\s+(\d+)$/.exec(label);
	if (!m) throw new Error(`Unexpected race label: ${label}`);
	return Number(m[1]);
}

/** Convert milliseconds (or 0/missing) to seconds with ms precision, or null. */
function msToSeconds(ms: number | null | undefined): number | null {
	if (typeof ms !== 'number' || ms <= 0) return null;
	return Math.round(ms) / 1000;
}

/**
 * Parse ICSCC date strings like "Apr 25, 2025" into ISO "YYYY-MM-DD".
 * Returns the parsed year separately so the caller can patch it.
 */
function parseIcsccDate(s: string): { year: number; month: number; day: number } {
	// Avoid Date() timezone shenanigans — parse the string directly.
	const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(s.trim());
	if (!m) throw new Error(`Unparseable upstream date: ${s}`);
	const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
	if (month === undefined) throw new Error(`Unknown month in date: ${s}`);
	return { year: Number(m[3]), month, day: Number(m[2]) };
}

function patchYear(
	parts: { year: number; month: number; day: number },
	season: number,
	onPatch: () => void
): IsoDate {
	let { year, month, day } = parts;
	if (year !== season) {
		year = season;
		onPatch();
	}
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTHS: Record<string, number> = {
	jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
	jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const TRACK_NAMES: Record<string, string> = {
	PIR: 'Portland International Raceway',
	'PIR CHC': 'Portland International Raceway (Chicane)',
	PR: 'Pacific Raceways',
	'The Ridge': 'The Ridge Motorsports Park',
	QRP: 'Mission Raceway Park'
};

function friendlyTrack(code: string): string {
	return TRACK_NAMES[code] ?? code;
}

// -----------------------------------------------------------------------------
// Upstream payload types (minimal — only what we read)
// -----------------------------------------------------------------------------

interface RawIcsccPayload {
	events: RawEvent[];
	tables: RawClassTable[];
}

interface RawEvent {
	id: string;
	date: string;
	track: string;
	club: string;
	eventid: string;
	name: string;
	link: string;
}

interface RawClassTable {
	class: string;
	rows: RawDriverRow[];
}

interface RawDriverRow {
	name: string;
	pos: number | string;
	total: number;
	sortValue: number;
	starts: number;
	finishes: number;
	entries: number;
	eligible: boolean;
	notes?: string;
	numbers?: unknown[];
	fastestlap?: Record<string, number>;
	[raceKey: string]: unknown;
}

interface RawRaceResult {
	carnum: string;
	position: number;
	points: number;
	fastestlap: number;
	status: string;
	sessions?: RawSession[];
}

interface RawSession {
	type: 'qual' | 'race';
	position: number;
	points: number;
	fastestlap: number;
	status: string;
}
