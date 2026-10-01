import { DialogButtonSecondary } from '@steambrew/client';
import { createRoot } from 'react-dom/client';
import type { OverlayHost, SteamRuntime } from './runtime';
import { reconcileOverlayHosts } from './hosts';
export function startOverlayHosts(runtime:SteamRuntime,onScan:(host:OverlayHost)=>void):()=>void {
 return reconcileOverlayHosts(runtime,host=>{
  const container=host.window.document.createElement('div');
  container.dataset.cs2TrackerButton='';
  Object.assign(container.style,{position:'fixed',right:'24px',top:'90px',zIndex:'1000'});
  host.window.document.body.append(container);
  const root=createRoot(container);
  root.render(<DialogButtonSecondary onClick={()=>onScan(host)}>Scan players</DialogButtonSecondary>);
  return ()=>{root.unmount();container.remove();};
 });
}
