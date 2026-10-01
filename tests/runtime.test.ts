import { afterEach, expect, it, vi } from 'vitest';
import { createSteamRuntime } from '../frontend/steam/runtime';
import { reconcileOverlayHosts } from '../frontend/steam/hosts';
afterEach(() => vi.useRealTimers());
it('reports missing Steam APIs instead of fabricating an empty roster', () => {
	expect(() => createSteamRuntime({}).readCoplay()).toThrow(/unavailable/i);
	expect(createSteamRuntime({}).overlayHosts()).toEqual([]);
});
it('reads only CS2 windows, including windows created after startup, and removes every mount', () => {
	vi.useFakeTimers();
	const doc = () => document.implementation.createHTMLDocument();
	const a = { document: doc(), closed: false },
		b = { document: doc(), closed: false },
		other = { document: doc(), closed: false };
	const routers = [
		{ params: { browserInfo: { m_unAppID: 730 } }, BrowserWindow: a },
		{ params: { browserInfo: { m_unAppID: 440 } }, BrowserWindow: other },
	];
	const runtime = createSteamRuntime({ Router: { WindowStore: { OverlayWindows: routers } } });
	const render = vi.fn((host) => {
		const button = host.window.document.createElement('button');
		button.dataset.cs2TrackerButton = '';
		host.window.document.body.append(button);
		return () => button.remove();
	});
	const stop = reconcileOverlayHosts(runtime, render);
	expect(a.document.querySelectorAll('[data-cs2-tracker-button]')).toHaveLength(1);
	expect(other.document.querySelectorAll('[data-cs2-tracker-button]')).toHaveLength(0);
	routers.push({ params: { browserInfo: { m_unAppID: 730 } }, BrowserWindow: b });
	vi.advanceTimersByTime(3000);
	expect(render).toHaveBeenCalledTimes(2);
	routers.shift();
	vi.advanceTimersByTime(1000);
	expect(a.document.body.childElementCount).toBe(0);
	stop();
	expect(b.document.body.childElementCount).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});
it('keeps Steam callbacks additive and unregisters them', () => {
	const unregister = vi.fn();
	let active: Function = () => {},
		lifetime: Function = () => {};
	const runtime = createSteamRuntime({
		SteamClient: {
			Overlay: {
				RegisterForOverlayActivated: (cb: Function) => {
					active = cb;
					return { unregister };
				},
			},
			GameSessions: {
				RegisterForAppLifetimeNotifications: (cb: Function) => {
					lifetime = cb;
					return { unregister };
				},
			},
		},
	});
	const onActive = vi.fn(),
		onExit = vi.fn();
	const off1 = runtime.onOverlayActive(onActive),
		off2 = runtime.onAppExit(onExit);
	active(1, 440, true, false);
	active(2, 730, true, false);
	lifetime({ unAppID: 440, bRunning: false });
	lifetime({ unAppID: 730, bRunning: false });
	expect(onActive).toHaveBeenCalledExactlyOnceWith(true);
	expect(onExit).toHaveBeenCalledTimes(1);
	off1();
	off2();
	expect(unregister).toHaveBeenCalledTimes(2);
});
