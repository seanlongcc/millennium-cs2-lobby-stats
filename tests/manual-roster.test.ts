// @vitest-environment node
import { expect, it } from 'vitest';
import { parseManualRoster, resolveManualRoster } from '../frontend/steam/manual-roster';
it('deduplicates all supported ID forms with lossless conversion',()=>{
 expect(parseManualRoster('[U:1:1]\nSTEAM_1:1:0\nhttps://steamcommunity.com/profiles/76561197960265729').steamIds).toEqual(['76561197960265729']);
 expect(parseManualRoster('[U:1:4294967295]').steamIds).toEqual(['76561202255233023']);
});
it.each(['https://steamcommunity.com.evil.test/id/me','http://steamcommunity.com/id/me','https://evil.test/id/me','https://user@steamcommunity.com/id/me','[U:1:0]','[U:1:4294967296]','76561197960265728','103582791429521412','https://steamcommunity.com/id/a%2Fb'])('rejects unsafe or non-individual input %s',text=>expect(parseManualRoster(text).errors).toHaveLength(1));
it('rejects 32 KiB and 128-entry overflow without returning a partial roster',()=>{
 expect(parseManualRoster('x'.repeat(32769)).errors).toHaveLength(1);
 const input=Array.from({length:129},(_,i)=>`[U:1:${i+1}]`).join('\n');expect(parseManualRoster(input)).toMatchObject({steamIds:[],vanityNames:[]});expect(parseManualRoster(input).errors).toHaveLength(1);
});
it('deduplicates vanity names, caps resolver concurrency, validates results and reports errors',async()=>{
 let active=0,max=0;const names:string[]=[];
 const r=await resolveManualRoster('https://steamcommunity.com/id/one https://steamcommunity.com/id/one https://steamcommunity.com/id/two https://steamcommunity.com/id/bad',async name=>{names.push(name);active++;max=Math.max(max,active);await Promise.resolve();active--;if(name==='bad')throw Error('Not found');return name==='one'?'76561197960265729':'76561197960265730';});
 expect(max).toBeLessThanOrEqual(2);expect(names).toEqual(['one','two','bad']);expect(r.players).toHaveLength(2);expect(r.players.every(p=>p.team==='unknown'&&p.origin==='manual')).toBe(true);expect(r.errors).toHaveLength(1);
 expect((await resolveManualRoster('https://steamcommunity.com/id/nope',async()=> '123')).errors).toHaveLength(1);
});
