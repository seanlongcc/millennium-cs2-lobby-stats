import type { SteamId } from '../../shared/report';
import { steamAvatarUrl } from '../../shared/steam-avatar';
import { validSteamId } from './roster';
export type OverlayHost = { key: string; appId: number; window: Window };
export type SteamMatchContext = {
	state: string;
	mode: string;
	server: string;
	map: string;
	partyIds: SteamId[];
	partySize: number;
	notBefore: number;
	key: string;
};
export interface SteamRuntime {
	readCoplay(): Promise<unknown>;
	matchContext?(now: number): SteamMatchContext | null;
	currentUserId(): SteamId | null;
	playerInfo?(steamId: SteamId): { displayName?: string; avatarUrl?: string };
	overlayHosts(): OverlayHost[];
	onOverlayActive(cb: (active: boolean) => void): () => void;
	onAppExit(cb: () => void): () => void;
	openBrowser?(host: OverlayHost, url: string): void;
	compatibilityErrors?(): string[];
	canRunReports?(): boolean;
}
// Steam's internal objects are unversioned. All dynamic access stays at this boundary.
type Dynamic = Record<string, any>;
const object = (v: unknown): Dynamic => (v && typeof v === 'object' ? (v as Dynamic) : {});
export function createSteamRuntime(globals: unknown): SteamRuntime {
	const g = object(globals);
	const ids = new WeakMap<object, string>();
	let serial = 0;
	let info: Dynamic[] = [];
	let pending = false;
	let lastProbe = 0;
	let lastMatch: { key: string; at: number; notBefore: number } | undefined;
	const steam = () => object(g.SteamClient);
	const registrationErrors = new Set<string>();
	const lifecycleErrors = () => {
		const errors = [...registrationErrors];
		if (typeof object(steam().Overlay).RegisterForOverlayActivated !== 'function') errors.push('Steam overlay activation API unavailable.');
		if (typeof object(steam().GameSessions).RegisterForAppLifetimeNotifications !== 'function') errors.push('Steam app lifecycle API unavailable.');
		return errors;
	};
	const subscribe = (source: Dynamic, key: string, cb: (...args: any[]) => void) => {
		if (typeof source[key] !== 'function') {
			registrationErrors.add(`Steam ${key} registration unavailable. Reload the plugin after updating Steam/Millennium.`);
			return () => {};
		}
		try {
			const token = source[key](cb);
			if (typeof token?.unregister !== 'function') registrationErrors.add(`Steam ${key} registration returned an unsupported handle.`);
			return () => {
				try {
					token?.unregister?.();
				} catch {
					/* Steam window already closed. */
				}
			};
		} catch {
			registrationErrors.add(`Steam ${key} registration failed. Reload the plugin after updating Steam/Millennium.`);
			return () => {};
		}
	};
	return {
		matchContext(now) {
			try {
				const selfId = object(object(g.App).m_CurrentUser).strSteamID;
				if (!validSteamId(selfId)) return null;
				const store = object(g.friendStore);
				const self = store.GetFriendState?.(Number(BigInt(selfId) - 76561197960265728n))?.persona;
				const rp = self?.m_mapRichPresence;
				if (self?.m_unGamePlayedAppID !== 730 || typeof rp?.get !== 'function') return null;
				const read = (key: string) => typeof rp.get(key) === 'string' ? rp.get(key) as string : '';
				const state = read('game:state'), mode = read('game:mode'), server = read('game:server'), map = read('game:map');
				// Rich presence can briefly omit fields. Do not advance the match cutoff
				// or fall back to frozen currentUsers on an incomplete competitive update.
				if (!state || (state === 'game' && (!mode || (mode === 'competitive' && (!server || !map))))) return null;
				const key = JSON.stringify([selfId, state, mode, server, map]);
				const notBefore = lastMatch && lastMatch.key !== key ? lastMatch.at : lastMatch?.notBefore ?? 0;
				lastMatch = { key, at: now, notBefore };
				const group = read('steam_player_group');
				const partySize = group ? Number(read('steam_player_group_size')) : 1;
				const partyIds = new Set<SteamId>([selfId]);
				if (group) {
					const friends = store.GetFriendsInGame?.(730);
					for (const friend of Array.isArray(friends) ? friends : []) {
						const p = friend?.persona, presence = p?.m_mapRichPresence;
						if (p?.m_unGamePlayedAppID !== 730 || presence?.get?.('steam_player_group') !== group ||
							presence.get('game:state') !== state || presence.get('game:mode') !== mode || presence.get('game:map') !== map) continue;
						const id = p.m_steamid?.ConvertTo64BitString?.();
						if (validSteamId(id)) partyIds.add(id);
					}
				}
				return { state, mode, server, map, partyIds: [...partyIds], partySize, notBefore, key };
			} catch {
				return null;
			}
		},
		playerInfo(steamId) {
			if (!validSteamId(steamId)) return {};
			try {
				// Steam requests missing personas itself; later browser polls pick up the response.
				const store = object(g.friendStore);
				const persona = store.GetFriendState?.(Number(BigInt(steamId) - 76561197960265728n))?.persona;
				const name = persona?.m_strPlayerName;
				return {
					displayName: typeof name === 'string' && name.trim() ? name.slice(0, 256) : undefined,
					avatarUrl: steamAvatarUrl(persona?.avatar_url_medium),
				};
			} catch {
				return {};
			}
		},
		openBrowser(host, url) {
			const routers = object(object(g.Router).WindowStore).OverlayWindows;
			const router = Array.isArray(routers) ? routers.find((entry) => entry.BrowserWindow === host.window) : null;
			if (host.appId !== 730 || !router || typeof router.NavigateToSteamWeb !== 'function') throw Error('Steam overlay browser is unavailable.');
			router.NavigateToSteamWeb(url);
		},
		canRunReports: () => lifecycleErrors().length === 0 && Array.isArray(object(object(g.Router).WindowStore).OverlayWindows),
		compatibilityErrors() {
			const errors = lifecycleErrors();
			if (!Array.isArray(object(object(g.Router).WindowStore).OverlayWindows)) errors.push('Steam overlay windows API unavailable.');
			if (typeof object(steam().Friends).GetCoplayData !== 'function') errors.push('Automatic roster unavailable. Add profile links manually.');
			return errors;
		},
		readCoplay() {
			const friends = object(steam().Friends);
			if (typeof friends.GetCoplayData !== 'function') throw new Error('Automatic roster discovery is unavailable on this Steam version.');
			return Promise.resolve(friends.GetCoplayData());
		},
		currentUserId() {
			const id = object(object(g.App).m_CurrentUser).strSteamID;
			return typeof id === 'string' && /^\d{17}$/.test(id) && BigInt(id) > 76561197960265728n && BigInt(id) <= 76561202255233023n ? id : null;
		},
		overlayHosts() {
			const routers = object(object(g.Router).WindowStore).OverlayWindows;
			if (!Array.isArray(routers)) return [];
			const result: OverlayHost[] = [];
			for (const value of routers) {
				const router = object(value),
					params = object(router.params),
					browser = object(params.browserInfo);
				const win = router.BrowserWindow;
				let appId = browser.m_unAppID;
				if (appId === undefined) {
					const match = info.find((x) => x.nBrowserID === browser.m_nBrowserID && x.unPID === browser.m_unPID);
					appId = match?.appID;
					const overlay = object(steam().Overlay);
					if (!pending && Date.now() - lastProbe > 5000 && typeof overlay.GetOverlayBrowserInfo === 'function') {
						pending = true;
						lastProbe = Date.now();
						Promise.resolve()
							.then(() => overlay.GetOverlayBrowserInfo())
							.then((raw) => {
								info = Array.isArray(raw) ? raw.map(object) : [];
							})
							.catch(() => {
								info = [];
							})
							.finally(() => {
								pending = false;
							});
					}
				}
				try {
					if (appId !== 730 || !win || win.closed || !win.document?.body) continue;
					if (!ids.has(win)) ids.set(win, `cs2-${++serial}`);
					result.push({ key: ids.get(win)!, appId: 730, window: win });
				} catch {
					/* Detached/inaccessible child window. */
				}
			}
			return result;
		},
		onOverlayActive: (cb) =>
			subscribe(object(steam().Overlay), 'RegisterForOverlayActivated', (_pid, appId, active) => {
				if (appId === 730 && typeof active === 'boolean') cb(active);
			}),
		onAppExit: (cb) =>
			subscribe(object(steam().GameSessions), 'RegisterForAppLifetimeNotifications', (event) => {
				if (event?.unAppID === 730 && event.bRunning === false) cb();
			}),
	};
}
