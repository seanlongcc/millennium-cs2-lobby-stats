import type { PlayerIdentity, RosterSnapshot, SteamId, TeamGroup } from '../../shared/report';
import type { SteamRuntime } from './runtime';
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
		return normalizeCoplay(await withDeadline(runtime.readCoplay(), 5000, signal), runtime.currentUserId(), now());
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
