import type { SteamId } from '../../shared/report';
export type OverlayHost = { key: string; appId: number; window: Window };
export interface SteamRuntime {
 readCoplay(): Promise<unknown>;
 currentUserId(): SteamId | null;
 overlayHosts(): OverlayHost[];
 onOverlayActive(cb: (active: boolean) => void): () => void;
 onAppExit(cb: () => void): () => void;
}
// Steam's internal objects are unversioned. All dynamic access stays at this boundary.
type Dynamic = Record<string, any>;
const object = (v: unknown): Dynamic => v && typeof v === 'object' ? v as Dynamic : {};
export function createSteamRuntime(globals: unknown): SteamRuntime {
 const g=object(globals); const ids=new WeakMap<object,string>(); let serial=0;
 let info: Dynamic[]=[]; let pending=false; let lastProbe=0;
 const steam=()=>object(g.SteamClient);
 const subscribe=(source: Dynamic, key:string, cb: (...args:any[])=>void) => {
  if(typeof source[key]!=='function') return ()=>{};
  try { const token=source[key](cb); return ()=>{ try { token?.unregister?.(); } catch { /* Steam window already closed. */ } }; }
  catch { return ()=>{}; }
 };
 return {
  readCoplay() {
   const friends=object(steam().Friends);
   if(typeof friends.GetCoplayData!=='function') throw new Error('Automatic roster discovery is unavailable on this Steam version.');
   return Promise.resolve(friends.GetCoplayData());
  },
  currentUserId() {
   const id=object(object(g.App).m_CurrentUser).strSteamID;
   return typeof id==='string' && /^\d{17}$/.test(id) && BigInt(id)>76561197960265728n && BigInt(id)<=76561202255233023n ? id:null;
  },
  overlayHosts() {
   const routers=object(object(g.Router).WindowStore).OverlayWindows;
   if(!Array.isArray(routers)) return [];
   const result:OverlayHost[]=[];
   for(const value of routers) {
    const router=object(value), params=object(router.params), browser=object(params.browserInfo);
    const win=router.BrowserWindow;
    let appId=browser.m_unAppID;
    if(appId===undefined) {
     const match=info.find(x=>x.nBrowserID===browser.m_nBrowserID && x.unPID===browser.m_unPID);
     appId=match?.appID;
     const overlay=object(steam().Overlay);
     if(!pending && Date.now()-lastProbe>5000 && typeof overlay.GetOverlayBrowserInfo==='function') {
      pending=true; lastProbe=Date.now();
      Promise.resolve().then(()=>overlay.GetOverlayBrowserInfo()).then(raw=>{info=Array.isArray(raw)?raw.map(object):[];}).catch(()=>{info=[];}).finally(()=>{pending=false;});
     }
    }
    try {
     if(appId!==730 || !win || win.closed || !win.document?.body) continue;
     if(!ids.has(win)) ids.set(win,`cs2-${++serial}`);
     result.push({key:ids.get(win)!,appId:730,window:win});
    } catch { /* Detached/inaccessible child window. */ }
   }
   return result;
  },
  onOverlayActive: cb=>subscribe(object(steam().Overlay),'RegisterForOverlayActivated',(_pid,appId,active)=>{if(appId===730 && typeof active==='boolean') cb(active);}),
  onAppExit: cb=>subscribe(object(steam().GameSessions),'RegisterForAppLifetimeNotifications',event=>{if(event?.unAppID===730 && event.bRunning===false) cb();}),
 };
}
