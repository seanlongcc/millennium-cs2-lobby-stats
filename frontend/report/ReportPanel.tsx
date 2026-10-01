import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DialogBody, DialogBodyText, DialogButtonPrimary, DialogButtonSecondary, DialogControlsSectionHeader, DialogFooter, DialogHeader, DialogSubHeader, Focusable, ProgressBar, ScrollPanel, TextField } from '@steambrew/client';
import type { ProviderTab, TeamGroup } from '../../shared/report';
import { groupRoster } from '../steam/roster';
import type { ReportController } from './controller';
import { PlayerRow } from './PlayerRow';
import { PlayerProfile } from './PlayerProfile';
const groupNames:Record<TeamGroup,string>={opponents:'Opponents',your_team:'Your team',spectators:'Spectators',unknown:'Team unknown',free_for_all:'Free-for-all'};
export function ReportPanel({controller,onClose,highlightEnabled}:{controller:ReportController;onClose:()=>void;highlightEnabled:boolean}) {
 const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
 const [selectedId,setSelectedId]=useState<string|null>(null),[tab,setTab]=useState<ProviderTab>('leetify');
 const [adding,setAdding]=useState(false),[input,setInput]=useState(''),[busy,setBusy]=useState(false);
 const container=useRef<HTMLDivElement>(null);
 useEffect(()=>{setTab('leetify');setSelectedId(null);setInput('');},[snapshot.id]);
 useEffect(()=>{
  const element=container.current,doc=element?.ownerDocument,previous=doc?.activeElement as HTMLElement|null;
  element?.querySelector<HTMLButtonElement>('button')?.focus();
  return ()=>{if(previous?.isConnected)previous.focus();};
 },[]);
 const close=()=>{controller.close();onClose();};
 const auto=snapshot.roster.players.filter(p=>p.origin!=='manual').length,manual=snapshot.roster.players.length-auto;
 const completed=snapshot.rows.filter(row=>Object.values(row.providers).every(p=>p.status!=='loading')).length;
 const failed=snapshot.rows.reduce((n,row)=>n+Object.values(row.providers).filter(p=>!['ok','loading','canceled'].includes(p.status)).length,0);
 const selected=snapshot.rows.find(r=>r.player.steamId===selectedId)??snapshot.rows[0];
 return <Focusable ref={container} className="cs2-tracker-report" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
  <DialogHeader>CS2 player report</DialogHeader>
  <DialogSubHeader>{new Date(snapshot.roster.capturedAt).toLocaleTimeString()} · Historical stats</DialogSubHeader>
  <Focusable className="cs2-tracker-actions"><DialogButtonPrimary onClick={()=>void controller.scan()}>Refresh report</DialogButtonPrimary><DialogButtonSecondary onClick={()=>setAdding(!adding)}>Add profile links</DialogButtonSecondary>{snapshot.state==='loading'&&<DialogButtonSecondary onClick={()=>controller.cancel()}>Cancel</DialogButtonSecondary>}<DialogButtonSecondary onClick={close}>Close</DialogButtonSecondary></Focusable>
  <DialogBodyText>{auto} detected by Steam{manual?` · ${manual} added manually`:''} · Coverage unverified</DialogBodyText>
  <DialogBodyText role="status">{snapshot.message??`${completed}/${snapshot.rows.length} ready${failed?` · ${failed} unavailable`:''}`}</DialogBodyText>
  {snapshot.state==='loading'&&<ProgressBar nProgress={snapshot.rows.length?completed/snapshot.rows.length*100:0}/>}
  {adding&&<Focusable className="cs2-tracker-manual">
   <TextField label="Steam profiles or IDs" value={input} onChange={event=>setInput(event.currentTarget.value)} onPaste={event=>{event.preventDefault();const raw=event.clipboardData.getData('text');setInput(raw);}}/>
   <DialogButtonSecondary disabled={busy||!input.trim()} onClick={()=>{setBusy(true);void controller.addProfiles(input).finally(()=>setBusy(false));}}>Add players</DialogButtonSecondary>
  </Focusable>}
  {snapshot.inputErrors?.map((error,i)=><DialogBodyText key={i} role="alert">{error}</DialogBodyText>)}
  <DialogBody className="cs2-tracker-columns">
   <Focusable className="cs2-tracker-roster" role="list" aria-label="Players"><ScrollPanel>
    {groupRoster(snapshot.roster.players).map(group=><Focusable key={group.team}>
     <DialogControlsSectionHeader>{groupNames[group.team]} · {group.players.length}</DialogControlsSectionHeader>
     {group.players.map(player=>snapshot.rows.find(row=>row.player.steamId===player.steamId)!).filter(Boolean).sort((a,b)=>Number(highlightEnabled&&b.assessment.label==='unusual')-Number(highlightEnabled&&a.assessment.label==='unusual')).map(row=><PlayerRow key={row.player.steamId} row={row} selected={row.player.steamId===selected?.player.steamId} onSelect={()=>setSelectedId(row.player.steamId)} highlightEnabled={highlightEnabled}/>)}
    </Focusable>)}
    {!snapshot.rows.length&&snapshot.state!=='loading'&&<><DialogBodyText>No roster available</DialogBodyText><DialogBodyText>{snapshot.roster.message??'Retry or add profiles.'}</DialogBodyText></>}
   </ScrollPanel></Focusable>
   <Focusable className="cs2-tracker-profile"><ScrollPanel>{selected&&<PlayerProfile row={selected} providerTab={tab} onProviderTab={setTab} highlightEnabled={highlightEnabled}/>}</ScrollPanel></Focusable>
  </DialogBody>
  <DialogFooter>Flags are not proof of cheating.</DialogFooter>
 </Focusable>;
}
