// @vitest-environment node
import { expect, it } from 'vitest';
import { assess, emptyMetrics } from '../frontend/report/rules';
it.each([[4,19,'insufficient_data'],[2,20,'unusual'],[1.99,20,'no_flags'],[2.01,21,'unusual'],[Infinity,20,'insufficient_data'],[NaN,20,'insufficient_data'],[-1,20,'insufficient_data'],[3,20.5,'insufficient_data'],[2,null,'insufficient_data']] as const)('assesses K/D %s only with an eligible recent sample %s',(recentKd,recentMatches,label)=>{
 expect(assess({...emptyMetrics(),recentKd,recentMatches}).label).toBe(label);
});
it('explains the exact source, plugin threshold and sample without a suspicion score',()=>{
 expect(assess({...emptyMetrics(),recentKd:2,recentMatches:20})).toEqual({version:'rules-v2-leetify',label:'unusual',evidence:[{ruleId:'recent-kd',category:'kd',provider:'leetify',thresholdSource:'plugin',value:2,threshold:2,matches:20,window:'recent'}]});
});
it('never flags missing data, low hours, FACEIT lifetime or unbenchmarked Aim and Time to Damage',()=>{
 expect(assess(emptyMetrics()).label).toBe('insufficient_data');
 for(const metrics of [{faceitKd:5,faceitMatches:300,faceitHeadshotsPct:99},{leetifyAim:100,timeToDamageMs:100},{cs2Hours:0},{recentKd:4,faceitMatches:300}]) expect(assess({...emptyMetrics(),...metrics}).evidence).toEqual([]);
});
