// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { normalizeCoplay, captureRoster, groupRoster } from '../frontend/steam/roster';
import { createSteamRuntime } from '../frontend/steam/runtime';
import type { PlayerIdentity, TeamGroup } from '../shared/report';
const raw = (count: number) => ({ currentUsers: Array.from({ length: count }, (_, i) => ({ appid: 730, accountid: i + 1 })), recentUsers: [] });
it('never promotes recent users or another game into the live roster', () => {
	const r = normalizeCoplay(
		{
			currentUsers: [
				{ appid: 730, accountid: 1 },
				{ appid: 730, accountid: 1 },
				{ appid: 440, accountid: 2 },
			],
			recentUsers: [{ appid: 730, accountid: 3 }],
		},
		null,
		1000,
	);
	expect(r.players.map((p) => p.steamId)).toEqual(['76561197960265729']);
	expect(r.coverage).toBe('unknown');
	expect(r.players[0].team).toBe('unknown');
});
it('retains community rosters and rejects overflow instead of silently truncating', () => {
	expect(normalizeCoplay(raw(32), null, 0).players).toHaveLength(32);
	expect(normalizeCoplay(raw(128), null, 0).players).toHaveLength(128);
	expect(normalizeCoplay(raw(129), null, 0)).toMatchObject({ state: 'error', players: [] });
});
it('validates integer account IDs and preserves 64-bit precision', () => {
	const r = normalizeCoplay({ currentUsers: [4294967295, 4294967296, -1, 1.5, '2', 0].map((accountid) => ({ appid: 730, accountid })) }, null, 0);
	expect(r.players.map((p) => p.steamId)).toEqual(['76561202255233023']);
	expect(r.rejectedCount).toBe(5);
});
it('adds You only to a real roster and never duplicates the signed-in player', () => {
	expect(normalizeCoplay(raw(0), '76561197960265729', 0).state).toBe('empty');
	expect(normalizeCoplay(raw(1), '76561197960265729', 0).players).toMatchObject([{ origin: 'self' }]);
	expect(normalizeCoplay(raw(1), '76561197960265730', 0).players).toHaveLength(2);
	expect(normalizeCoplay({ currentUsers: {} }, null, 0).state).toBe('error');
});
it('does not confuse a missing API, rejection or timeout with an empty roster', async () => {
	expect((await captureRoster(createSteamRuntime({}), () => 0)).state).toBe('unavailable');
	const runtime = createSteamRuntime({ SteamClient: { Friends: { GetCoplayData: () => Promise.reject(new Error('failed')) } } });
	expect((await captureRoster(runtime, () => 0)).state).toBe('error');
	vi.useFakeTimers();
	runtime.readCoplay = () => new Promise(() => {});
	const p = captureRoster(runtime, () => 0);
	await vi.advanceTimersByTimeAsync(5000);
	expect((await p).state).toBe('error');
	expect(vi.getTimerCount()).toBe(0);
	vi.useRealTimers();
});
it('groups uneven verified teams, spectators and teamless players without guessing unknown assignments', () => {
	const teams: TeamGroup[] = [...Array(7).fill('your_team'), ...Array(9).fill('opponents'), 'spectators', 'free_for_all', 'unknown'];
	const players = teams.map((team, i) => ({
		steamId: String(i),
		origin: 'steam',
		team,
		teamSource: team === 'unknown' ? 'unavailable' : 'verified_live',
		teamObservedAt: team === 'unknown' ? null : 100,
	})) as PlayerIdentity[];
	const groups = groupRoster(players);
	expect(groups.map((g) => [g.team, g.players.length])).toEqual([
		['opponents', 9],
		['your_team', 7],
		['spectators', 1],
		['free_for_all', 1],
		['unknown', 1],
	]);
	expect(new Set(groups.flatMap((g) => g.players.map((p) => p.steamId))).size).toBe(19);
	expect(groupRoster([{ ...players[0], teamSource: 'unavailable', teamObservedAt: null }])[0].team).toBe('unknown');
});
