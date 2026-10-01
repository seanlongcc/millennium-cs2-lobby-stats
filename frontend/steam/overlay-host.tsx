import { Component, type ReactNode } from 'react';
import * as client from '@steambrew/client';
import { classMapList, constSysfsExpr, DialogButtonSecondary, IconsModule } from '@steambrew/client';
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
			const missing = nativeComponentErrors(client);
			// Resolve the active Steam CSS module instead of pinning version-specific hashes.
			const toolbarStyles = classMapList.filter((classes) => classes.Toolbar && classes.ToolbarContainer && classes.ToolbarButton);
			if (!toolbarStyles.length) missing.push('Steam overlay toolbar styles unavailable.');
			if (!IconsModule?.Search) missing.push('Steam search icon unavailable.');
			if (runtime.canRunReports?.() === false) missing.push(...(runtime.compatibilityErrors?.() ?? ['Steam lifecycle unavailable.']));
			if (typeof createRoot !== 'function') missing.push('Steam React root unavailable.');
			if (missing.length) throw Error(missing.join(' '));
			const container = host.window.document.createElement('div');
			container.dataset.cs2TrackerButton = '';
			container.className = 'cs2-tracker-toolbar-slot';
			const style = host.window.document.createElement('style');
			style.textContent = styles;
			let root: Root | undefined;
			let observer: MutationObserver | undefined;
			let cleaned = false;
			const cleanup = () => {
				if (cleaned) return;
				cleaned = true;
				observer?.disconnect();
				try {
					root?.unmount();
				} finally {
					container.remove();
					style.remove();
				}
			};
			try {
				host.window.document.head.append(style);
				root = createRoot(container);
				let buttonClass = '';
				const attach = () => {
					if (cleaned) return;
					for (const classes of toolbarStyles) {
						const toolbar = [...host.window.document.getElementsByClassName(classes.Toolbar)].find((element) =>
							element.parentElement?.classList.contains(classes.ToolbarContainer),
						);
						if (!toolbar) continue;
						if (buttonClass !== classes.ToolbarButton) {
							buttonClass = classes.ToolbarButton;
							root!.render(
								<NativeBoundary
									onError={(message) => {
										onError(message);
										queueMicrotask(cleanup);
									}}
								>
									<DialogButtonSecondary
										className={`${buttonClass} cs2-tracker-scan-button`}
										aria-label="Scan players"
										title="Scan players"
										onClick={() => onScan(host)}
									>
										<IconsModule.Search aria-hidden="true" />
									</DialogButtonSecondary>
								</NativeBoundary>,
							);
						}
						// Keep Steam's minimize/restore action last. The slot adds no layout box.
						if (container.parentElement !== toolbar) toolbar.insertBefore(container, toolbar.lastElementChild);
						return;
					}
					container.remove();
				};
				// Steam can create or replace its toolbar after the overlay host appears.
				observer = new host.window.document.defaultView!.MutationObserver(attach);
				observer.observe(host.window.document.body, { childList: true, subtree: true });
				attach();
			} catch (error) {
				cleanup();
				throw error;
			}
			return cleanup;
		},
		onError,
	);
}
