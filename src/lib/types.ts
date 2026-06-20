// =============================================================================
// PRO3 Dashboard — Normalized API contract (DRAFT)
// =============================================================================
// What our proxy returns. Deliberately *not* a mirror of the ICSCC JSON —
// this is a clean, typed, minimal shape tailored to the dashboard's needs.
//
// Wire-size goal: ~30 KB for a full season (vs. 683 KB raw).
// =============================================================================

/** ISO-8601 date string, e.g. "2026-04-25". Year is always correct
 *  (the proxy patches the upstream year bug for the current season). */
export type IsoDate = string;

/** Lap time in seconds with ms precision (e.g. 80.396). null when missing. */
export type LapSeconds = number | null;

/** Driver status for a single race weekend. */
export type RaceStatus = 'normal' | 'dns' | 'dnf' | 'dq';

/** Short ICSCC track code from the source data. */
export type TrackCode = 'PIR' | 'PIR CHC' | 'PR' | 'The Ridge' | 'QRP' | string;

/** Sanctioning club for a race weekend. */
export type ClubCode = 'CSCC' | 'IRDC' | 'NWMS' | 'BCRC' | string;

// -----------------------------------------------------------------------------
// Schedule
// -----------------------------------------------------------------------------

export interface RaceEvent {
	/** Race number in the season, e.g. 1. Stable across the season. */
	raceNumber: number;
	/** Human label, e.g. "Race 1". Convenience for display. */
	label: string;
	/** Date the race was/will be run, ISO-8601. */
	date: IsoDate;
	/** Whether this race has been run and scored. */
	completed: boolean;
	/** Track this race is held at. */
	track: TrackCode;
	/** Friendly track name, e.g. "Portland International Raceway". */
	trackName: string;
	/** Sanctioning club. */
	club: ClubCode;
	/** Event id grouping rounds within a weekend, e.g. "PIR1". */
	eventId: string;
	/** Weekend display name, e.g. "Rose City Opener XXXIV".
	 *  Populated by the season.php scraper in Slice 2; null in Slice 1. */
	weekendName: string | null;
	/** Enrichment links from the scraper (Slice 2). All null in Slice 1. */
	links: {
		registration: string | null;
		announcement: string | null;
		supplementaryRules: string | null;
		results: string | null;
		qualifying: string | null;
		lapTimes: string | null;
	};
}

// -----------------------------------------------------------------------------
// Per-race driver result
// -----------------------------------------------------------------------------

export interface RaceResult {
	raceNumber: number;
	carNumber: string;
	/** Finishing position in the race. */
	position: number;
	/** Official championship points (integer part of the raw decimal). */
	points: number;
	/** Raw decimal points value, preserves tiebreaker fractional part.
	 *  Used for sorting; never displayed directly. */
	pointsRaw: number;
	/** Best race lap for this race, in seconds. null if dns/dnf with no lap. */
	fastestLap: LapSeconds;
	status: RaceStatus;
	/** Qualifying sub-session result, if available. */
	qualifying: {
		position: number;
		points: number;
		fastestLap: LapSeconds;
		status: RaceStatus;
	} | null;
}

// -----------------------------------------------------------------------------
// Driver standing (one row in the leaderboard)
// -----------------------------------------------------------------------------

export interface DriverStanding {
	/** Standings position. null if ineligible for championship. */
	position: number | null;
	name: string;
	/** Car numbers used across the season. Often a single number. */
	carNumbers: string[];
	/** Total championship points (integer). */
	total: number;
	/** Raw total with decimal tiebreakers preserved. Used for sorting. */
	totalRaw: number;
	starts: number;
	finishes: number;
	entries: number;
	/** Eligible for the championship (met minimum-races threshold etc.). */
	eligible: boolean;
	/** Reason for ineligibility (e.g. "too few races"). null when eligible. */
	ineligibilityReason: string | null;
	/** Best lap per track, in seconds. */
	fastestLapByTrack: Record<TrackCode, LapSeconds>;
	/** Sparse map: raceNumber -> result. Missing key = did not enter. */
	results: Record<number, RaceResult>;
}

// -----------------------------------------------------------------------------
// Season-level metadata
// -----------------------------------------------------------------------------

export interface SeasonMeta {
	/** Four-digit year. */
	season: number;
	/** Race class this payload represents (always "PRO3" for our use). */
	class: 'PRO3';
	/** ISO timestamp when our proxy last fetched upstream. */
	fetchedAt: string;
	/** Upstream ETag, surfaced for client-side conditional requests. */
	upstreamEtag: string | null;
	/** Total scheduled races in the season. */
	scheduledRaces: number;
	/** Number of races completed and scored. */
	completedRaces: number;
	/** Total unique driver entries across the season. */
	totalDrivers: number;
	/** Drivers currently eligible for the championship. */
	eligibleDrivers: number;
	/** True if proxy patched the upstream year bug on this response. */
	yearPatched: boolean;
}

// -----------------------------------------------------------------------------
// Top-level API responses
// -----------------------------------------------------------------------------

/** GET /api/points/:season -> the leaderboard payload. */
export interface PointsResponse {
	meta: SeasonMeta;
	schedule: RaceEvent[];
	standings: DriverStanding[];
}

/** GET /api/schedule/:season -> schedule-only, KV-backed, includes non-points
 *  events (HPDEs, test-and-tune) from the season.php scrape. Slice 2. */
export interface ScheduleResponse {
	meta: Pick<SeasonMeta, 'season' | 'fetchedAt'>;
	events: ScheduleEntry[];
}

export interface ScheduleEntry {
	/** Date range for the weekend, ISO-8601. start === end for single-day. */
	startDate: IsoDate;
	endDate: IsoDate;
	weekendName: string;
	club: ClubCode;
	track: TrackCode;
	trackName: string;
	/** Kind of event from the season.php row class. */
	kind: 'race' | 'enduro' | 'training' | 'meeting' | 'special' | 'other';
	/** True if this weekend has any PRO3 championship races. */
	hasChampionshipRaces: boolean;
	links: RaceEvent['links'];
}
