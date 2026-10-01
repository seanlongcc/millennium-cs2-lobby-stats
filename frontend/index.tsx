import { createReportController } from './report/controller';
import { createBrowserReport } from './report/browser';
import { fetchProvider, resolveVanity } from './report/ipc';
import { createSteamRuntime } from './steam/runtime';
import { startOverlayHosts, NativeBoundary } from './steam/overlay-host';
import { CompatibilityNotice, createDiagnostics, nativeComponentErrors } from './steam/compatibility';
// TTC 3.3 matches the namespace name to inject the plugin ID into IPC/config calls.
import * as client from '@steambrew/client';
import { callable, definePlugin, DialogBody, DialogBodyText, pluginConfig, Router, Field, IconsModule, TextField, ToggleField, usePluginConfig } from '@steambrew/client';

const SettingsContent = () => {
	const [highlight, setHighlight] = usePluginConfig<boolean>('highlight_enabled');
	const [leetifyApiKey, setLeetifyApiKey] = usePluginConfig<string>('leetify_api_key');
	const [showSteamDetails, setShowSteamDetails] = usePluginConfig<boolean>('show_steam_details');
	const [expandDetails, setExpandDetails] = usePluginConfig<boolean>('expand_details');

	return (
		<DialogBody>
			<DialogBodyText>In CS2, open Shift+Tab and select Scan players.</DialogBodyText>
			<ToggleField label="Highlight unusual stats" checked={highlight ?? true} onChange={(value) => void setHighlight(value)} bottomSeparator="standard" />
			<Field
				label="Leetify API key"
				description="Optional. Public requests work without a key, while a personal key provides better rate limits."
				icon={<IconsModule.Settings />}
				childrenLayout="below"
				bottomSeparator="standard"
			>
				<TextField
					value={leetifyApiKey ?? ''}
					onChange={(event) => void setLeetifyApiKey(event.currentTarget.value.trim())}
					bIsPassword
					bShowClearAction
					bAlwaysShowClearAction
				/>
			</Field>

			<ToggleField
				label="Show Steam activity"
				description="Show total CS2 hours, recent hours, and the Steam account creation date in the expanded view."
				checked={showSteamDetails ?? true}
				onChange={(checked) => void setShowSteamDetails(checked)}
				bottomSeparator="standard"
			/>

			<ToggleField
				label="Expand details by default"
				description="Open the detailed Leetify, FACEIT, and Steam metrics when a profile loads."
				checked={expandDetails ?? false}
				onChange={(checked) => void setExpandDetails(checked)}
				bottomSeparator="none"
			/>
		</DialogBody>
	);
};

const getReportBrowserUrl = callable<[], string>('get_report_browser_url');
let browserReport: ReturnType<typeof createBrowserReport> | undefined;
export function reportBrowserRequest(token: string, action: string, input: string) {
	return browserReport?.request(token, action, input) ?? JSON.stringify({ error: 'Plugin unloaded. Select Scan players again.' });
}

export default definePlugin(() => {
	const runtime = createSteamRuntime({ SteamClient, App: (window as any).App, Router, friendStore: (window as any).friendStore });
	const controller = createReportController({ runtime, fetch: fetchProvider, resolveVanity, now: Date.now });
	const diagnostics = createDiagnostics();
	let mountError = '';
	const updateDiagnostics = () => diagnostics.set([...(runtime.compatibilityErrors?.() ?? []), ...nativeComponentErrors(client), ...(mountError ? [mountError] : [])]);
	updateDiagnostics();
	const diagnosticTimer = setInterval(updateDiagnostics, 1000);
	const reportError = (message: string) => {
		mountError = message;
		updateDiagnostics();
		controller.close();
	};
	let highlightEnabled = true;
	void pluginConfig
		.get<boolean>('highlight_enabled')
		.then((value) => {
			highlightEnabled = value ?? true;
		})
		.catch(() => {});
	browserReport = createBrowserReport({ runtime, controller, getUrl: getReportBrowserUrl, highlightEnabled: () => highlightEnabled });
	const stop = startOverlayHosts(
		runtime,
		(host) => {
			void pluginConfig
				.get<boolean>('highlight_enabled')
				.then((value) => {
					highlightEnabled = value ?? true;
				})
				.catch(() => {});
			void browserReport!.open(host).catch((error) => reportError(error instanceof Error ? error.message : 'Steam browser unavailable.'));
		},
		reportError,
	);

	return {
		title: 'CS2 Lobby Stats',
		icon: <IconsModule.Settings />,
		content: (
			<>
				<CompatibilityNotice diagnostics={diagnostics} />
				<NativeBoundary onError={reportError}>{nativeComponentErrors(client).length === 0 && <SettingsContent />}</NativeBoundary>
			</>
		),
		onDismount: () => {
			browserReport?.dispose();
			browserReport = undefined;
			stop();
			clearInterval(diagnosticTimer);
			controller.dispose();
		},
	};
});
