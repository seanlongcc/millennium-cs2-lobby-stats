import type { OverlayHost, SteamRuntime } from './runtime';
export function reconcileOverlayHosts(runtime: SteamRuntime, mount: (host: OverlayHost) => () => void, onError: (message: string) => void = console.warn): () => void {
	const mounted = new Map<string, { host: OverlayHost; dispose: () => void }>();
	const reconcile = () => {
		const hosts = runtime.overlayHosts();
		const keys = new Set(hosts.map((h) => h.key));
		for (const [key, entry] of mounted)
			if (!keys.has(key)) {
				entry.dispose();
				mounted.delete(key);
			}
		for (const host of hosts)
			if (!mounted.has(host.key)) {
				try {
					mounted.set(host.key, { host, dispose: mount(host) });
				} catch (error) {
					onError(`Overlay component unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
				}
			}
	};
	reconcile();
	const timer = setInterval(reconcile, 1000);
	return () => {
		clearInterval(timer);
		for (const entry of mounted.values()) entry.dispose();
		mounted.clear();
	};
}
