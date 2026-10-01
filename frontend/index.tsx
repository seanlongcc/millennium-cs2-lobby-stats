import { createReportController, type ReportController } from './report/controller';
import { fetchProvider, resolveVanity } from './report/ipc';
import { ReportPanel } from './report/ReportPanel';
import { createSteamRuntime } from './steam/runtime';
import { startOverlayHosts, NativeBoundary } from './steam/overlay-host';
import { CompatibilityNotice, createDiagnostics, nativeComponentErrors } from './steam/compatibility';
import * as Native from '@steambrew/client';
import { definePlugin, DialogBody, DialogBodyText, ModalRoot, Router, showModal, Field, IconsModule, TextField, ToggleField, usePluginConfig } from '@steambrew/client';

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

const ReportContent = ({ controller, onClose }: { controller: ReportController; onClose: () => void }) => {
	const [highlight] = usePluginConfig<boolean>('highlight_enabled');
	return <ReportPanel controller={controller} onClose={onClose} highlightEnabled={highlight ?? true} />;
};

export default definePlugin(() => {
	const runtime = createSteamRuntime({ SteamClient, App: (window as any).App, Router });
	const controller = createReportController({ runtime, fetch: fetchProvider, resolveVanity, now: Date.now });
	const diagnostics = createDiagnostics();
	let mountError = '';
	const updateDiagnostics = () =>
		diagnostics.set([
			...(runtime.compatibilityErrors?.() ?? []),
			...nativeComponentErrors(Native),
			...(typeof showModal === 'function' ? [] : ['Steam modal API unavailable.']),
			...(mountError ? [mountError] : []),
		]);
	updateDiagnostics();
	const diagnosticTimer = setInterval(updateDiagnostics, 1000);
	const reportError = (message: string) => {
		mountError = message;
		updateDiagnostics();
		controller.close();
	};
	let modal: ReturnType<typeof showModal> | undefined;
	const close = () => {
		const previous = modal;
		modal = undefined;
		previous?.Close();
		controller.close();
	};
	const stop = startOverlayHosts(
		runtime,
		(host) => {
			close();
			try {
				modal = showModal(
					<ModalRoot onCancel={close} onEscKeypress={close} closeModal={close} bAllowFullSize>
						<CompatibilityNotice diagnostics={diagnostics} />
						<NativeBoundary onError={reportError}>
							<ReportContent controller={controller} onClose={close} />
						</NativeBoundary>
					</ModalRoot>,
					host.window,
					{
						strTitle: 'CS2 Lobby Stats',
						bNeverPopOut: true,
						fnOnClose: () => {
							modal = undefined;
							controller.close();
						},
					},
				);
				void controller.scan();
			} catch (error) {
				reportError(error instanceof Error ? error.message : 'Steam modal unavailable.');
			}
		},
		reportError,
	);
	return {
		title: 'CS2 Lobby Stats',
		icon: <IconsModule.Settings />,
		content: (
			<>
				<CompatibilityNotice diagnostics={diagnostics} />
				<NativeBoundary onError={reportError}>{nativeComponentErrors(Native).length === 0 && <SettingsContent />}</NativeBoundary>
			</>
		),
		onDismount: () => {
			close();
			stop();
			clearInterval(diagnosticTimer);
			controller.dispose();
		},
	};
});
