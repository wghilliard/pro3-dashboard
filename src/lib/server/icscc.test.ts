/**
 * Unit tests for the ICSCC normalization layer.
 *
 * These tests live next to the implementation and exercise every quirk listed
 * in AGENTS.md / copilot-instructions.md. They use real upstream fixtures
 * captured in __fixtures__/ so regressions in our normalization surface
 * immediately. Fixtures are intentionally large — they're the ground truth.
 */

import { describe, expect, it } from 'vitest';
import { normalize, upstreamUrl } from './icscc';
import raw2026 from './__fixtures__/icscc-2026.json';
import raw2025 from './__fixtures__/icscc-2025.json';

describe('upstreamUrl', () => {
	it('builds the canonical ICSCC URL for a season', () => {
		expect(upstreamUrl(2026)).toBe('https://www.icscc.com/points/2026/icsccClassPoints.json');
	});
});

describe('normalize — current-season (2026) fixture', () => {
	const result = normalize(raw2026, 2026);

	it('filters down to a small wire payload (PRO3 only)', () => {
		// 683 KB raw -> we don't enforce an exact byte budget, but assert the
		// expected shape that produces the small footprint.
		expect(result.meta.class).toBe('PRO3');
		expect(result.standings.length).toBeLessThan(100);
		// All 54 classes from upstream collapse to one driver list.
		expect(Array.isArray(result.standings)).toBe(true);
	});

	it('patches the year on the buggy current-season payload', () => {
		// Upstream returns dates like "Apr 25, 2025" under /points/2026/.
		// normalize() should rewrite to the requested season.
		expect(result.meta.yearPatched).toBe(true);
		for (const event of result.schedule) {
			expect(event.date.startsWith('2026-')).toBe(true);
		}
	});

	it('returns events sorted with correct race numbers and ISO dates', () => {
		const r1 = result.schedule[0];
		expect(r1.raceNumber).toBe(1);
		expect(r1.label).toBe('Race 1');
		expect(r1.date).toBe('2026-04-25');
		expect(r1.track).toBe('PIR');
		expect(r1.trackName).toBe('Portland International Raceway');
	});

	it('flags races as completed iff at least one driver has results', () => {
		// In the 2026 fixture 6 of 15 races have been run.
		const completed = result.schedule.filter((e) => e.completed);
		expect(completed.length).toBe(6);
		expect(result.meta.completedRaces).toBe(6);
		expect(result.meta.scheduledRaces).toBe(15);
	});

	it('separates eligible and ineligible drivers', () => {
		// In the 2026 fixture: 40 drivers, 31 eligible for the championship.
		expect(result.meta.totalDrivers).toBe(40);
		expect(result.meta.eligibleDrivers).toBe(31);

		const eligible = result.standings.filter((s) => s.eligible);
		const ineligible = result.standings.filter((s) => !s.eligible);
		expect(eligible).toHaveLength(31);
		expect(ineligible).toHaveLength(9);

		// Eligible drivers always have a numeric position.
		for (const driver of eligible) {
			expect(typeof driver.position).toBe('number');
		}

		// Ineligible drivers have null position + a human-readable reason.
		for (const driver of ineligible) {
			expect(driver.position).toBeNull();
			expect(driver.ineligibilityReason).toBeTruthy();
		}
	});

	it('preserves decimal points in totalRaw so the client can sort by tiebreakers', () => {
		const leader = result.standings[0];
		expect(leader.name).toBe('Isaiah Dummer');
		expect(leader.total).toBe(131); // integer — what gets displayed
		expect(leader.totalRaw).toBeCloseTo(131.0302, 4); // decimal — used for sort
		expect(Number.isInteger(leader.total)).toBe(true);
		expect(leader.totalRaw).toBeGreaterThan(leader.total);
	});

	it('converts race-level fastestlap from ms to seconds with ms precision', () => {
		const leader = result.standings[0];
		const r1 = leader.results[1];
		// Upstream stored 80988 (ms). We expect 80.988 (s).
		expect(r1.fastestLap).toBeCloseTo(80.988, 3);
		// Sanity bound: a PRO3 race lap is between 50s and 5min.
		expect(r1.fastestLap).toBeGreaterThan(50);
		expect(r1.fastestLap).toBeLessThan(300);
	});

	it('keeps driver-level fastestLapByTrack in seconds (no double-conversion)', () => {
		const leader = result.standings[0];
		// Upstream already had {"PIR": 80.396, "PR": 93.841} in seconds.
		expect(leader.fastestLapByTrack.PIR).toBeCloseTo(80.396, 3);
		expect(leader.fastestLapByTrack.PR).toBeCloseTo(93.841, 3);
	});

	it('builds a sparse results map (missing keys = did not enter)', () => {
		// Pick a driver who skipped races.
		const partial = result.standings.find((s) => s.starts > 0 && s.starts < 6);
		expect(partial).toBeDefined();
		const raceNumbers = Object.keys(partial!.results).map(Number);
		expect(raceNumbers.length).toBe(partial!.entries);
		// All keys are positive race numbers within the season.
		for (const n of raceNumbers) {
			expect(n).toBeGreaterThanOrEqual(1);
			expect(n).toBeLessThanOrEqual(result.meta.scheduledRaces);
		}
	});

	it('captures qualifying sub-session when present', () => {
		const leader = result.standings[0];
		const r1 = leader.results[1];
		expect(r1.qualifying).not.toBeNull();
		expect(r1.qualifying!.position).toBeGreaterThan(0);
		expect(r1.qualifying!.fastestLap).toBeGreaterThan(0);
		expect(['normal', 'dns', 'dnf', 'dq']).toContain(r1.qualifying!.status);
	});

	it('preserves dns/dnf/dq statuses from upstream', () => {
		const statuses = new Set<string>();
		for (const driver of result.standings) {
			for (const r of Object.values(driver.results)) {
				statuses.add(r.status);
			}
		}
		// We expect to see at least 'normal' plus at least one non-normal status
		// across 6 weekends with 30 drivers.
		expect(statuses.has('normal')).toBe(true);
		expect([...statuses].some((s) => s !== 'normal')).toBe(true);
	});

	it('sets meta.fetchedAt to an ISO timestamp', () => {
		expect(result.meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(Number.isNaN(Date.parse(result.meta.fetchedAt))).toBe(false);
	});
});

describe('normalize — historic (2025) fixture, no year bug', () => {
	const result = normalize(raw2025, 2025);

	it('does NOT flag yearPatched when upstream year matches season', () => {
		expect(result.meta.yearPatched).toBe(false);
		for (const event of result.schedule) {
			expect(event.date.startsWith('2025-')).toBe(true);
		}
	});

	it('handles a fully completed season (all races marked completed)', () => {
		expect(result.meta.completedRaces).toBe(result.meta.scheduledRaces);
		expect(result.schedule.every((e) => e.completed)).toBe(true);
	});
});

describe('normalize — error cases', () => {
	it('throws when the PRO3 class is missing from upstream', () => {
		expect(() => normalize({ events: [], tables: [] }, 2026)).toThrow(/PRO3/);
	});

	it('throws when upstream date is unparseable', () => {
		const bad = {
			events: [
				{
					id: 'Race 1',
					date: 'not-a-date',
					track: 'PIR',
					club: 'CSCC',
					eventid: 'PIR1',
					name: 'PIR1',
					link: ''
				}
			],
			tables: [{ class: 'PRO3', rows: [] }]
		};
		expect(() => normalize(bad, 2026)).toThrow(/Unparseable upstream date/);
	});
});
