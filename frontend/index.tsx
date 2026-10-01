import { createReportController, type ReportController } from './report/controller';
import { fetchProvider, resolveVanity } from './report/ipc';
import { ReportPanel } from './report/ReportPanel';
import { createSteamRuntime } from './steam/runtime';
import { startOverlayHosts } from './steam/overlay-host';
import { definePlugin, DialogBody, DialogBodyText, ModalRoot, Router, showModal, Field, IconsModule, TextField, ToggleField, usePluginConfig } from '@steambrew/client';

const SettingsContent = () => {
 const [highlight, setHighlight] = usePluginConfig<boolean>('highlight_enabled');
	const [leetifyApiKey, setLeetifyApiKey] = usePluginConfig<string>('leetify_api_key');
	const [showSteamDetails, setShowSteamDetails] = usePluginConfig<boolean>('show_steam_details');
	const [expandDetails, setExpandDetails] = usePluginConfig<boolean>('expand_details');

	return (
		<DialogBody>
            <DialogBodyText>In CS2, open Shift+Tab and select Scan players.</DialogBodyText>
            <ToggleField label="Highlight unusual stats" checked={highlight ?? true} onChange={value => void setHighlight(value)} bottomSeparator="standard"/>
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

const ReportContent = ({controller,onClose}:{controller:ReportController;onClose:()=>void}) => {
 const [highlight] = usePluginConfig<boolean>('highlight_enabled');
 return <ReportPanel controller={controller} onClose={onClose} highlightEnabled={highlight ?? true}/>;
};

export default definePlugin(() => {
 const runtime = createSteamRuntime({SteamClient, App: (window as any).App, Router});
 const controller = createReportController({runtime,fetch:fetchProvider,resolveVanity,now:Date.now});
 let modal:ReturnType<typeof showModal>|undefined;
 const close=()=>{const previous=modal;modal=undefined;previous?.Close();controller.close();};
 const stop=startOverlayHosts(runtime,host=>{
  close();
  modal=showModal(<ModalRoot onCancel={close} onEscKeypress={close} closeModal={close} bAllowFullSize>
   <ReportContent controller={controller} onClose={close}/>
  </ModalRoot>,host.window,{strTitle:'CS2 Player Tracker',bNeverPopOut:true,fnOnClose:()=>{modal=undefined;controller.close();}});
  void controller.scan();
 });
 return {
  title: 'CS2 Player Tracker',
  icon: <IconsModule.Settings />,
  content: <SettingsContent />,
  onDismount:()=>{close();stop();controller.dispose();},
 };
});
