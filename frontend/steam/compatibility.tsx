import { useSyncExternalStore, type ElementType } from 'react';
import * as Native from '@steambrew/client';

export function createDiagnostics() {
	let messages: string[] = [];
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => messages,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		set(next: string[]) {
			const unique = [...new Set(next)];
			if (JSON.stringify(unique) === JSON.stringify(messages)) return;
			messages = unique;
			listeners.forEach((listener) => listener());
		},
	};
}
export type Diagnostics = ReturnType<typeof createDiagnostics>;
const isComponent = (value: unknown) => typeof value === 'function' || !!(value && typeof value === 'object' && '$$typeof' in value);
export function nativeComponentErrors(registry: Record<string, unknown>): string[] {
	return [
		'DialogBody',
		'DialogBodyText',
		'DialogHeader',
		'DialogSubHeader',
		'DialogFooter',
		'DialogControlsSection',
		'DialogControlsSectionHeader',
		'DialogButtonPrimary',
		'DialogButtonSecondary',
		'Field',
		'Focusable',
		'TextField',
		'ScrollPanel',
		'ProgressBar',
		'ModalRoot',
	]
		.filter((name) => !isComponent(registry[name]))
		.map((name) => `Steam component ${name} unavailable.`);
}
export function CompatibilityNotice({ diagnostics }: { diagnostics: Diagnostics }) {
	const messages = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot);
	if (!messages.length) return null;
	// Last-resort HTML is used only when Steam exposes no working text component.
	const Text = ([Native.DialogBodyText, Native.DialogSubHeader, Native.Focusable].find(isComponent) ?? 'p') as ElementType;
	return <Text role="alert">{messages.join(' ')}</Text>;
}
