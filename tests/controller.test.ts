// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createReportController } from '../frontend/report/controller';
import type { Metrics, Provider, ProviderResult } from '../shared/report';
import type { SteamRuntime } from '../frontend/steam/runtime';
type Result=ProviderResult<Partial<Metrics>>;
const ok=(data:Partial<Metrics>={}):Result=>({status:'ok',data,fetchedAt:1000});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(fn=>fn());vi.useRealTimers();});
function harness(count=3) {
 vi.useFakeTimers();vi.setSystemTime(1000);
 let roster={currentUsers:Array.from({length:count},(_,i)=>({appid:730,accountid:i+1}))};let user:string|null=null;
 let activation:(active:boolean)=>void=()=>{},exit:()=>void=()=>{};
 const runtime:SteamRuntime={readCoplay:vi.fn(async()=>roster),currentUserId:()=>user,overlayHosts:()=>[],onOverlayActive:cb=>{activation=cb;return ()=>{};},onAppExit:cb=>{exit=cb;return ()=>{};}};
 const jobs:{provider:Provider;id:string;resolve:(r:Result)=>void;done:boolean}[]=[];
 let active=0,max=0;
 const fetch=vi.fn((provider:Provider,id:string)=>{active++;max=Math.max(max,active);return new Promise<Result>(resolve=>{const job={provider,id,done:false,resolve:(r:Result)=>{active--;job.done=true;resolve(r);}};jobs.push(job);});});
 const controller=createReportController({runtime,fetch,resolveVanity:async()=> '76561197960265799',now:()=>Date.now()});cleanups.push(()=>controller.dispose());
 return {controller,jobs,fetch,runtime,activation:(v:boolean)=>activation(v),exit:()=>exit(),setUser:(v:string)=>{user=v;},roster:(ids:number[])=>{roster={currentUsers:ids.map(accountid=>({appid:730,accountid}))};},max:()=>max};
}
it('caps actual outstanding work at two and one per provider through refresh and completion',async()=>{
 const h=harness();await h.controller.scan();expect(h.jobs).toHaveLength(2);expect(new Set(h.jobs.map(j=>j.provider)).size).toBe(2);
 for(let i=0;i<15;i++){const pending=h.jobs.filter(j=>!j.done);expect(new Set(pending.map(j=>j.provider)).size).toBe(pending.length);for(const j of pending)j.resolve(ok());await flush();}
 expect(h.max()).toBe(2);expect(h.jobs).toHaveLength(9);expect(h.controller.getSnapshot().state).toBe('complete');
});
it('never applies old results to a new scan and expires manual entries on refresh',async()=>{
 const h=harness(1);await h.controller.scan();const old=h.controller.getSnapshot().id;await h.controller.addProfiles('[U:1:99]');expect(h.controller.getSnapshot().rows).toHaveLength(2);
 h.roster([2]);await h.controller.scan();const id=h.controller.getSnapshot().id;expect(id).toBeGreaterThan(old);h.jobs[0].resolve(ok({name:'Old',recentKd:9,recentMatches:50}));await flush();
 expect(h.controller.getSnapshot().id).toBe(id);expect(h.controller.getSnapshot().rows.map(r=>r.player.steamId)).toEqual(['76561197960265730']);expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();
});
it('uses a new scan ID for an identical roster and deduplicates unfinished keys',async()=>{
 const h=harness(1);await h.controller.scan();const old=h.controller.getSnapshot().id;await h.controller.scan();expect(h.controller.getSnapshot().id).toBeGreaterThan(old);expect(h.jobs).toHaveLength(2);
});
it('holds timed-out IPC slots until promises actually settle, even after close and reopen',async()=>{
 const h=harness();await h.controller.scan();await vi.advanceTimersByTimeAsync(45000);expect(h.jobs).toHaveLength(2);expect(h.controller.getSnapshot().rows[0].providers.leetify.status).toBe('error');
 h.controller.close();expect(h.controller.getSnapshot().rows).toHaveLength(0);await h.controller.scan();expect(h.jobs).toHaveLength(2);
 h.jobs[0].resolve(ok());await flush();expect(h.jobs).toHaveLength(2);await h.controller.scan();expect(h.jobs).toHaveLength(3);expect(h.max()).toBe(2);
});
it('cancels queued work and discards running responses',async()=>{
 const h=harness();await h.controller.scan();h.controller.cancel();for(const j of h.jobs)j.resolve(ok({name:'Ignored'}));await flush();expect(h.jobs).toHaveLength(2);expect(h.controller.getSnapshot().state).toBe('canceled');expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();
});
it('shares cooldowns across refresh while allowing other providers and never automatically retries',async()=>{
 const h=harness();await h.controller.scan();h.jobs.find(j=>j.provider==='leetify')!.resolve({status:'rate_limited',data:null,fetchedAt:null,retryAfterMs:60000});await flush();
 expect(h.controller.getSnapshot().rows.every(r=>r.providers.leetify.status==='rate_limited')).toBe(true);
 h.jobs.find(j=>j.provider==='faceit')!.resolve(ok({faceitElo:1800}));await flush();expect(h.controller.getSnapshot().rows[0].metrics.faceitElo).toBe(1800);
 await h.controller.scan();expect(h.controller.getSnapshot().rows.every(r=>r.providers.leetify.status==='rate_limited')).toBe(true);await vi.advanceTimersByTimeAsync(61000);expect(h.jobs.filter(j=>j.provider==='leetify')).toHaveLength(1);
});
it('pauses hidden work and validates roster before accepting buffered results',async()=>{
 const h=harness();await h.controller.scan();h.activation(false);h.jobs[0].resolve(ok({name:'Hidden'}));await flush();expect(h.jobs).toHaveLength(2);expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();
 h.roster([20]);h.activation(true);await flush();expect(h.controller.getSnapshot().state).toBe('stale');expect(h.controller.getSnapshot().rows[0].metrics.name).toBeNull();expect(h.jobs).toHaveLength(2);
});
it('accepts buffered results only after unchanged-roster resume',async()=>{
 const h=harness(1);await h.controller.scan();h.activation(false);h.jobs[0].resolve(ok({name:'Current'}));await flush();h.activation(true);await flush();expect(h.controller.getSnapshot().rows[0].metrics.name).toBe('Current');
});
it('marks membership changes stale without automatic stats scans',async()=>{
 const h=harness();await h.controller.scan();h.roster([8]);await vi.advanceTimersByTimeAsync(5000);expect(h.controller.getSnapshot().state).toBe('stale');expect(h.jobs).toHaveLength(2);
});
it('invalidates on app exit and checks signed-in identity before accepting results',async()=>{
 const h=harness(1);await h.controller.scan();h.setUser('76561197960265790');h.jobs[0].resolve(ok({name:'Wrong account'}));await flush();expect(h.controller.getSnapshot().rows).toHaveLength(0);
 await h.controller.scan();h.exit();expect(h.controller.getSnapshot().rows).toHaveLength(0);
});
it('keeps provider failures isolated and name precedence independent of response order',async()=>{
 const h=harness(1);await h.controller.scan();h.jobs[1].resolve(ok({name:'FACEIT',faceitKd:5}));await flush();h.jobs[0].resolve(ok({name:'Leetify',leetifyAim:95,recentKd:1,recentMatches:20}));await flush();h.jobs.find(j=>j.provider==='steam')!.resolve({status:'private',data:null,fetchedAt:null});await flush();
 expect(h.controller.getSnapshot().rows[0].metrics).toMatchObject({name:'Leetify',leetifyAim:95,faceitKd:5});expect(h.controller.getSnapshot().rows[0].assessment.label).toBe('no_flags');
});
it('never overlaps unresolved roster reads and removes deadlines on unload',async()=>{
 const h=harness();h.runtime.readCoplay=vi.fn(()=>new Promise(()=>{}));const first=h.controller.scan();await flush();await vi.advanceTimersByTimeAsync(5000);await first;await h.controller.scan();expect(h.runtime.readCoplay).toHaveBeenCalledTimes(1);expect(h.controller.getSnapshot().state).toBe('error');h.controller.dispose();expect(vi.getTimerCount()).toBe(0);
});
it('removes an in-progress roster deadline when disposed before Steam answers',async()=>{
 const h=harness();h.runtime.readCoplay=()=>new Promise(()=>{});void h.controller.scan();await flush();h.controller.dispose();expect(vi.getTimerCount()).toBe(0);
});
