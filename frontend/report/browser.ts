import type { OverlayHost, SteamRuntime } from '../steam/runtime';
import type { ReportController } from './controller';

export function createBrowserReport(deps: { runtime: SteamRuntime; controller: ReportController; getUrl: () => Promise<string>; highlightEnabled: () => boolean }) {
	let token = '',
		lastSeen = 0,
		active = true,
		generation = 0;
	let host: OverlayHost | undefined;
	const close = () => {
		token = '';
		host = undefined;
		generation++;
		deps.controller.close();
	};
	const unsubscribeActive = deps.runtime.onOverlayActive((value) => {
		active = value;
		lastSeen = Date.now();
	});
	const unsubscribeExit = deps.runtime.onAppExit(close);
	const timer = setInterval(() => {
		if (token && active && (Date.now() - lastSeen > 30_000 || !deps.runtime.overlayHosts().some((h) => h.window === host?.window))) close();
	}, 1000);
	return {
		async open(nextHost: OverlayHost) {
			close();
			const current = generation;
			// Millennium returns Lua strings as JSON text, including the surrounding quotes.
			const url = new URL(JSON.parse(await deps.getUrl()));
			if (current !== generation) return;
			if (url.origin !== 'https://millennium.ftp' || !url.pathname.endsWith('/static/cs2-report.html')) throw Error('Invalid local report URL.');
			if (!deps.runtime.openBrowser) throw Error('Steam overlay browser is unavailable.');
			token = crypto.randomUUID();
			host = nextHost;
			lastSeen = Date.now();
			url.hash = token;
			try {
				deps.runtime.openBrowser(nextHost, url.href);
			} catch (error) {
				close();
				throw error;
			}
			void deps.controller.scan();
		},
		// Keep this synchronous: Lua calls back into Steam while holding its IPC lane.
		// Provider/vanity work is queued without waiting for another backend response.
		request(suppliedToken: string, action: string, input: string): string {
			if (!token || suppliedToken !== token) return JSON.stringify({ error: 'Report closed. Select Scan players in the overlay to open a new report.' });
			lastSeen = Date.now();
			if (action === 'close') {
				close();
				return JSON.stringify({ closed: true });
			}
			if (action === 'refresh') void deps.controller.scan();
			else if (action === 'refresh-player') deps.controller.refreshPlayer(input);
			else if (action === 'add' && typeof input === 'string' && input.length <= 32768) void deps.controller.addProfiles(input);
			else if (action === 'replace' && typeof input === 'string' && input.length <= 32768) void deps.controller.addProfiles(input, 'replace');
			else if (action === 'cancel') deps.controller.cancel();
			else if (action !== 'snapshot') return JSON.stringify({ error: 'Invalid report action.' });
			const snapshot = deps.controller.getSnapshot();
			const rows = snapshot.rows.map((row) => ({ ...row, player: { ...row.player, ...deps.runtime.playerInfo?.(row.player.steamId) } }));
			return JSON.stringify({ snapshot: { ...snapshot, rows }, highlightEnabled: deps.highlightEnabled() });
		},
		dispose() {
			close();
			clearInterval(timer);
			unsubscribeActive();
			unsubscribeExit();
		},
	};
}
