import { constSysfsExpr, DialogButtonSecondary } from '@steambrew/client';
import { createRoot } from 'react-dom/client';
import type { OverlayHost, SteamRuntime } from './runtime';
import { reconcileOverlayHosts } from './hosts';
const styles=constSysfsExpr('cs2-player-tracker.css',{basePath:'../../static',encoding:'utf8'}).content;
export function startOverlayHosts(runtime:SteamRuntime,onScan:(host:OverlayHost)=>void):()=>void {
 return reconcileOverlayHosts(runtime,host=>{
  const container=host.window.document.createElement('div');
  container.dataset.cs2TrackerButton='';
  Object.assign(container.style,{position:'fixed',right:'24px',top:'90px',zIndex:'1000'});
  const style=host.window.document.createElement('style');style.textContent=styles;host.window.document.head.append(style);
  host.window.document.body.append(container);
  const root=createRoot(container);
  root.render(<DialogButtonSecondary onClick={()=>onScan(host)}>Scan players</DialogButtonSecondary>);
  return ()=>{root.unmount();container.remove();style.remove();};
 });
}
