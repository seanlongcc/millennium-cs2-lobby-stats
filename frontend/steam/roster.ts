import type { PlayerIdentity, RosterSnapshot, SteamId, TeamGroup } from '../../shared/report';
import type { SteamMatchContext, SteamRuntime } from './runtime';
export const MAX_PLAYERS = 128;
export const validSteamId = (id: unknown): id is SteamId =>
	typeof id === 'string' && /^\d{17}$/.test(id) && BigInt(id) > 76561197960265728n && BigInt(id) <= 76561202255233023n;
export const identity = (steamId: SteamId, origin: PlayerIdentity['origin']): PlayerIdentity => ({
	steamId,
	origin,
	team: 'unknown',
	teamSource: 'unavailable',
	teamObservedAt: null,
});
export const emptyRoster = (now: number, state: RosterSnapshot['state'] = 'empty', message?: string): RosterSnapshot => ({
	capturedAt: now,
	players: [],
	coverage: 'unknown',
	rejectedCount: 0,
	state,
	message,
});
export function normalizeCoplay(raw: unknown, selfId: SteamId | null, now: number): RosterSnapshot {
	if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { currentUsers?: unknown }).currentUsers))
		return emptyRoster(now, 'error', 'Invalid current-player response.');
	const players = new Map<string, PlayerIdentity>();
	let rejectedCount = 0;
	for (const row of (raw as { currentUsers: unknown[] }).currentUsers) {
		if (!row || typeof row !== 'object') {
			rejectedCount++;
			continue;
		}
		const { appid, accountid } = row as { appid: unknown; accountid: unknown };
		if (appid !== 730) continue;
		if (typeof accountid !== 'number' || !Number.isInteger(accountid) || accountid < 1 || accountid > 4294967295) {
			rejectedCount++;
			continue;
		}
		const id = (76561197960265728n + BigInt(accountid)).toString();
		players.set(id, identity(id, id === selfId ? 'self' : 'steam'));
	}
	if (players.size && validSteamId(selfId)) players.set(selfId, identity(selfId, 'self'));
	if (players.size > MAX_PLAYERS) return emptyRoster(now, 'error', 'Report limit: 128 players.');
	return { ...emptyRoster(now, players.size ? 'ready' : 'empty'), players: [...players.values()], rejectedCount };
}
// Steam gives coplay timestamps, not a match ID. This is a deliberately labelled
// estimate: accept an entire recent cohort, never truncate history to nine names.
const COHORT_SECONDS = 120;
const MAX_AGE_SECONDS = 2 * 60 * 60;
export function normalizeMatchCoplay(raw: unknown, selfId: SteamId | null, now: number, context: SteamMatchContext | null): RosterSnapshot {
	const unavailable = (message: string): RosterSnapshot => ({ ...emptyRoster(now, 'unavailable', message), source: 'steam_recent_estimate' });
	if (!context || !validSteamId(selfId) || !context.state) return unavailable('Steam match presence unavailable. Retry or add profile links.');
	if (context.state !== 'game') return { ...emptyRoster(now, 'empty', 'Steam does not report an active CS2 match.'), source: 'steam_recent_estimate' };
	// Keep larger/community rosters on the original, explicitly unverified source.
	if (context.mode !== 'competitive' || context.server !== 'kv') return { ...normalizeCoplay(raw, selfId, now), source: 'steam_current', map: context.map || undefined };
	// Steam exposes rich presence for friends, not necessarily every party member.
	// Non-friend party members can be in recentUsers; the union below must still be ten.
	if (!context.map || !Number.isInteger(context.partySize) || context.partySize < 1 || context.partySize > 5 ||
		!context.partyIds.includes(selfId) || context.partyIds.length > context.partySize)
		return unavailable('Steam party information is incomplete. Retry or add profile links.');
	const recent = raw && typeof raw === 'object' ? (raw as { recentUsers?: unknown }).recentUsers : null;
	if (!Array.isArray(recent)) return unavailable('Steam recent-player data unavailable. Retry or add profile links.');
	const times = new Map<SteamId, number>();
	for (const entry of recent) {
		if (!entry || typeof entry !== 'object') continue;
		const { appid, accountid, rtTimePlayed: time } = entry;
		if (appid !== 730 || !Number.isInteger(accountid) || accountid < 1 || accountid > 4294967295 ||
			!Number.isInteger(time) || time <= 0 || time > now / 1000) continue;
		const id = String(76561197960265728n + BigInt(accountid));
		if (context.partyIds.includes(id)) continue;
		times.set(id, Math.max(time, times.get(id) ?? 0));
	}
	const latest = Math.max(0, ...times.values());
	if (!latest || now / 1000 - latest > MAX_AGE_SECONDS) return unavailable('No fresh Steam player group available. Retry or add profile links.');
	const cohort = [...times].filter(([, time]) => latest - time <= COHORT_SECONDS);
	if (cohort.length + context.partyIds.length !== 10 || cohort.some(([, time]) => time * 1000 < context.notBefore))
		return unavailable('Steam’s newest player group is incomplete or ambiguous. Retry when players finish joining, or replace the list with profile links.');
	return {
		...emptyRoster(now, 'ready'),
		source: 'steam_recent_estimate',
		observedAt: latest * 1000,
		contextKey: context.key,
		map: context.map,
		players: [...cohort.map(([id]) => id), ...context.partyIds].map(id => identity(id, id === selfId ? 'self' : 'steam')),
		message: 'Estimated from Steam’s newest recent-player group and your party. Check against the scoreboard; Steam does not provide a match ID.',
	};
}

export async function withDeadline<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				onAbort = () => {
					clearTimeout(timer);
					reject(new Error('Request canceled.'));
				};
				timer = setTimeout(() => reject(new Error('Request timed out.')), ms);
				signal?.addEventListener('abort', onAbort, { once: true });
				if (signal?.aborted) onAbort();
			}),
		]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	}
}
export async function captureRoster(runtime: SteamRuntime, now: () => number, signal?: AbortSignal): Promise<RosterSnapshot> {
	try {
		const raw = await withDeadline(runtime.readCoplay(), 5000, signal);
		const capturedAt = now();
		return runtime.matchContext
			? normalizeMatchCoplay(raw, runtime.currentUserId(), capturedAt, runtime.matchContext(capturedAt))
			: normalizeCoplay(raw, runtime.currentUserId(), capturedAt);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not read current players.';
		return emptyRoster(now(), /unavailable on this Steam version/.test(message) ? 'unavailable' : 'error', message);
	}
}
export function groupRoster(players: PlayerIdentity[]): Array<{ team: TeamGroup; players: PlayerIdentity[] }> {
	const order: TeamGroup[] = ['opponents', 'your_team', 'spectators', 'free_for_all', 'unknown'];
	return order
		.map((team) => ({ team, players: players.filter((p) => (p.teamSource === 'verified_live' && p.teamObservedAt !== null ? p.team : 'unknown') === team) }))
		.filter((g) => g.players.length);
}
