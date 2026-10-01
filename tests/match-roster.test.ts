// @vitest-environment node
import { expect, it } from 'vitest';
import { captureRoster } from '../frontend/steam/roster';
import { createSteamRuntime } from '../frontend/steam/runtime';
const now = 1_790_828_917_000;
const base = 76561197960265728n;
const id = (account: number) => String(base + BigInt(account));
function harness() {
	// Observed Premier match: eight non-friends arrived in two batches, 89 seconds apart.
	// The remaining teammate is a friend, absent from coplay, with the same party ID.
	let raw = {
		currentUsers: Array.from({ length: 13 }, (_, i) => ({ appid: 730, accountid: i + 1 })),
		recentUsers: [
			...Array.from({ length: 6 }, (_, i) => ({ appid: 730, accountid: i + 100, rtTimePlayed: 1790828482 })),
			{ appid: 730, accountid: 106, rtTimePlayed: 1790828393 },
			{ appid: 730, accountid: 107, rtTimePlayed: 1790828393 },
			{ appid: 730, accountid: 90, rtTimePlayed: 1790828257 },
		],
	};
	const presence = new Map([
		['game:state', 'game'], ['game:mode', 'competitive'], ['game:server', 'kv'], ['game:map', 'de_mirage'],
		['steam_player_group', 'party-a'], ['steam_player_group_size', '2'],
	]);
	const persona = (account: number, rp: Map<string, string>) => ({
		m_unGamePlayedAppID: 730, m_steamid: { ConvertTo64BitString: () => id(account) }, m_mapRichPresence: rp,
	});
	const self = persona(500, presence);
	const party = persona(501, new Map(presence));
	const other = persona(502, new Map([...presence, ['steam_player_group', 'different-party']]));
	let friends = [{ persona: party }, { persona: other }];
	const runtime = createSteamRuntime({
		SteamClient: { Friends: { GetCoplayData: async () => raw } },
		App: { m_CurrentUser: { strSteamID: id(500) } },
		friendStore: { GetFriendState: () => ({ persona: self }), GetFriendsInGame: () => friends },
	});
	return { runtime, presence, raw, setRaw: (next: typeof raw) => { raw = next; }, setFriends: (next: typeof friends) => { friends = next; } };
}
it('replaces a frozen current list with the newest complete cohort and same-party friend, explicitly estimated', async () => {
	const h = harness();
	const roster = await captureRoster(h.runtime, () => now);
	expect(roster.players.map(p => p.steamId).sort()).toEqual([100,101,102,103,104,105,106,107,500,501].map(id).sort());
	expect(roster).toMatchObject({ state: 'ready', coverage: 'unknown', source: 'steam_recent_estimate', observedAt: 1790828482000 });
	expect(roster.players.find(p => p.steamId === id(500))?.origin).toBe('self');
	expect(roster.players.every(p => p.team === 'unknown')).toBe(true);
});
it('fresh scans adopt changed recent players even when currentUsers stays frozen', async () => {
	const h = harness();
	await captureRoster(h.runtime, () => now);
	h.setRaw({ ...h.raw, recentUsers: [...Array.from({ length: 8 }, (_, i) => ({ appid: 730, accountid: i + 200, rtTimePlayed: now / 1000 + 100 })), ...h.raw.recentUsers] });
	const next = await captureRoster(h.runtime, () => now + 200000);
	expect(next.players.map(p => p.steamId).sort()).toEqual([200,201,202,203,204,205,206,207,500,501].map(id).sort());
});
it('does not fill missing recent players with older history or the stale current list', async () => {
	const h = harness();
	h.raw.recentUsers.splice(0, 1);
	expect(await captureRoster(h.runtime, () => now)).toMatchObject({ state: 'unavailable', players: [] });
});
it('refuses ambiguous oversized cohorts instead of taking the first eight', async () => {
	const h = harness();
	h.raw.recentUsers.push({ appid: 730, accountid: 999, rtTimePlayed: 1790828482 });
	expect(await captureRoster(h.runtime, () => now)).toMatchObject({ state: 'unavailable', players: [] });
});
it('still requires ten players when a party member is missing from both known friends and recent activity', async () => {
	const h = harness();
	h.setFriends([]);
	expect(await captureRoster(h.runtime, () => now)).toMatchObject({ state: 'unavailable', players: [] });
});
it('accepts a complete recent cohort when a party member is not a known Steam friend', async () => {
	const h = harness();
	// Live Dust II: a three-person party, but only one party member is a Steam friend.
	// The other party member is one of the eight recent players, so the union is ten.
	h.presence.set('steam_player_group_size', '3');
	const roster = await captureRoster(h.runtime, () => now);
	expect(roster).toMatchObject({ state: 'ready', coverage: 'unknown', source: 'steam_recent_estimate' });
	expect(roster.players.map(p => p.steamId).sort()).toEqual([100,101,102,103,104,105,106,107,500,501].map(id).sort());
	// Never compensate for a genuinely missing player with an older entry.
	h.raw.recentUsers.splice(0, 1);
	expect(await captureRoster(h.runtime, () => now)).toMatchObject({ state: 'unavailable', players: [] });
});
it('clears automatic players outside a match and refuses old history', async () => {
	const h = harness();
	h.presence.set('game:state', 'lobby');
	expect((await captureRoster(h.runtime, () => now)).players).toEqual([]);
	h.presence.set('game:state', 'game');
	expect((await captureRoster(h.runtime, () => now + 3 * 60 * 60 * 1000)).players).toEqual([]);
});
it('does not repopulate a newly observed match with the previous match cohort', async () => {
	const h = harness();
	await captureRoster(h.runtime, () => now);
	h.presence.set('game:state', 'lobby');
	await captureRoster(h.runtime, () => now + 1000);
	h.presence.set('game:state', 'game');
	expect((await captureRoster(h.runtime, () => now + 2000)).players).toEqual([]);
});
it('validates recent entries, ignores other games and deduplicates without skewing the cohort', async () => {
	const h = harness();
	h.raw.recentUsers.push(h.raw.recentUsers[0], { appid: 440, accountid: 999, rtTimePlayed: now / 1000 }, { appid: 730, accountid: -1, rtTimePlayed: now / 1000 });
	expect((await captureRoster(h.runtime, () => now)).players).toHaveLength(10);
});
