import { createSteamRuntime } from './steam/runtime';
import { startOverlayHosts } from './steam/overlay-host';
import { definePlugin, DialogBody, DialogBodyText, ModalRoot, Router, showModal, Field, IconsModule, TextField, ToggleField, usePluginConfig } from '@steambrew/client';

const SettingsContent = () => {
	const [leetifyApiKey, setLeetifyApiKey] = usePluginConfig<string>('leetify_api_key');
	const [showSteamDetails, setShowSteamDetails] = usePluginConfig<boolean>('show_steam_details');
	const [expandDetails, setExpandDetails] = usePluginConfig<boolean>('expand_details');

	return (
		<DialogBody>
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

export default definePlugin(() => {
 const runtime = createSteamRuntime({SteamClient, App: (window as any).App, Router});
 const stop = startOverlayHosts(runtime, host => {
  showModal(<ModalRoot><DialogBodyText>Report tools are loading.</DialogBodyText></ModalRoot>, host.window, {strTitle:'CS2 Player Tracker',bNeverPopOut:true});
 });
 return ({
	title: 'CS2 Player Tracker',
	icon: <IconsModule.Settings />,
	content: <SettingsContent />,
 onDismount: stop,
});
});
