import type { PlayerIdentity, SteamId } from '../../shared/report';
import { identity, MAX_PLAYERS, validSteamId, withDeadline } from './roster';
export function parseManualRoster(text: string): { steamIds: SteamId[]; vanityNames: string[]; errors: string[] } {
	const ids = new Set<string>(),
		names = new Map<string, string>(),
		errors: string[] = [];
	if (new TextEncoder().encode(text).length > 32768) return { steamIds: [], vanityNames: [], errors: ['Paste limit: 32 KiB.'] };
	for (const item of text
		.trim()
		.split(/[\s,;]+/)
		.filter(Boolean)) {
		let id: string | undefined;
		const nameKey = item.toLowerCase();
		const three = item.match(/^\[U:1:(\d{1,10})\]$/),
			two = item.match(/^STEAM_[01]:([01]):(\d{1,10})$/);
		if (validSteamId(item)) id = item;
		else if (/^[A-Za-z0-9_-]{1,64}$/.test(item) && !/^\d{17,}$/.test(item)) {
			if (!names.has(nameKey)) names.set(nameKey, item);
			continue;
		} else if (three || two) {
			const account = three ? BigInt(three[1]) : BigInt(two![2]) * 2n + BigInt(two![1]);
			if (account > 0n && account <= 4294967295n) id = (76561197960265728n + account).toString();
		} else {
			try {
				const input = /^(?:www\.)?steamcommunity\.com\//i.test(item) ? `https://${item}` : /^\/(?:id|profiles)\//.test(item) ? `https://steamcommunity.com${item}` : item;
				const url = new URL(input);
				if (!['https:', 'http:'].includes(url.protocol) || !['steamcommunity.com', 'www.steamcommunity.com'].includes(url.hostname) || url.port || url.username || url.password) throw Error();
				const path = url.pathname.match(/^\/(profiles|id)\/([A-Za-z0-9_-]{1,64})\/?$/);
				if (!path) throw Error();
				if (path[1] === 'profiles') {
					if (validSteamId(path[2])) id = path[2];
				} else {
					if (!names.has(path[2].toLowerCase())) names.set(path[2].toLowerCase(), path[2]);
					continue;
				}
			} catch {
				/* All invalid items are reported below. */
			}
		}
		if (id) ids.add(id);
		else errors.push(`Invalid profile: ${item.slice(0, 100)}`);
	}
	if (ids.size + names.size > MAX_PLAYERS) return { steamIds: [], vanityNames: [], errors: ['Report limit: 128 players.'] };
	return { steamIds: [...ids], vanityNames: [...names.values()], errors };
}
export async function resolveManualRoster(
	text: string,
	resolveVanity: (name: string) => Promise<SteamId>,
	options: { signal?: AbortSignal; managedDeadline?: boolean } = {},
): Promise<{ players: PlayerIdentity[]; errors: string[] }> {
	const parsed = parseManualRoster(text),
		ids = new Set(parsed.steamIds);
	let index = 0;
	let stopped = false;
	await Promise.all(
		[0, 1].map(async () => {
			while (!stopped && !options.signal?.aborted && index < parsed.vanityNames.length) {
				const name = parsed.vanityNames[index++];
				try {
					const request = resolveVanity(name);
					const id = await (options.managedDeadline ? request : withDeadline(request, 10000, options.signal));
					if (options.signal?.aborted) break;
					if (!validSteamId(id)) throw Error('Invalid SteamID.');
					ids.add(id);
				} catch (error) {
					parsed.errors.push((error as { status?: string })?.status === 'rate_limited' ? `Steam rate limited: ${name}. Try later.` : `Could not resolve: ${name}`);
					if (options.signal?.aborted || (error as { status?: string })?.status === 'rate_limited' || (error instanceof Error && /timed out/.test(error.message)))
						stopped = true;
				}
			}
		}),
	);
	for (const name of parsed.vanityNames.slice(index)) parsed.errors.push(`Not resolved: ${name}`);
	return { players: [...ids].map((id) => identity(id, 'manual')), errors: parsed.errors };
}
