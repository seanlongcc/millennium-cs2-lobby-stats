import { Component, type ReactNode } from 'react';
import * as Native from '@steambrew/client';
import { constSysfsExpr, DialogButtonSecondary } from '@steambrew/client';
import { createRoot, type Root } from 'react-dom/client';
import type { OverlayHost, SteamRuntime } from './runtime';
import { reconcileOverlayHosts } from './hosts';
import { nativeComponentErrors } from './compatibility';
const styles = constSysfsExpr('cs2-lobby-stats.css', { basePath: '../../static', encoding: 'utf8' }).content;
export class NativeBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(error: Error) {
		this.props.onError(`Steam component failed: ${error.message}`);
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}
export function startOverlayHosts(runtime: SteamRuntime, onScan: (host: OverlayHost) => void, onError: (message: string) => void = console.warn): () => void {
	return reconcileOverlayHosts(
		runtime,
		(host) => {
			const missing = nativeComponentErrors(Native);
			if (runtime.canRunReports?.() === false) missing.push(...(runtime.compatibilityErrors?.() ?? ['Steam lifecycle unavailable.']));
			if (typeof createRoot !== 'function') missing.push('Steam React root unavailable.');
			if (typeof Native.showModal !== 'function') missing.push('Steam modal API unavailable.');
			if (missing.length) throw Error(missing.join(' '));
			const container = host.window.document.createElement('div');
			container.dataset.cs2TrackerButton = '';
			Object.assign(container.style, { position: 'fixed', right: '24px', top: '90px', zIndex: '1000' });
			const style = host.window.document.createElement('style');
			style.textContent = styles;
			let root: Root | undefined;
			let cleaned = false;
			const cleanup = () => {
				if (cleaned) return;
				cleaned = true;
				try {
					root?.unmount();
				} finally {
					container.remove();
					style.remove();
				}
			};
			try {
				host.window.document.head.append(style);
				host.window.document.body.append(container);
				root = createRoot(container);
				root.render(
					<NativeBoundary
						onError={(message) => {
							onError(message);
							queueMicrotask(cleanup);
						}}
					>
						<DialogButtonSecondary onClick={() => onScan(host)}>Scan players</DialogButtonSecondary>
					</NativeBoundary>,
				);
			} catch (error) {
				cleanup();
				throw error;
			}
			return cleanup;
		},
		onError,
	);
}
