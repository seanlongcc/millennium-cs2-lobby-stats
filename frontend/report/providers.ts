import type { Metrics, Provider, ProviderResult, ProviderStatus } from '../../shared/report';
type ObjectData=Record<string,unknown>;
const object=(v:unknown):ObjectData=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectData:{};
const text=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v.slice(0,256):null;
export function numeric(v:unknown,min=-Infinity,max=Infinity,integer=false):number|null {
 if(typeof v==='string') {
  const s=v.trim().replace(/%$/,'');
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) return null;
  v=Number(s.replace(/,/g,''));
 }
 return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&(!integer||Number.isInteger(v))?v:null;
}
function xml(raw:unknown,root:string):Document {
 if(typeof raw!=='string'||raw.includes('<!DOCTYPE')) throw Error('Invalid XML.');
 const doc=new DOMParser().parseFromString(raw,'application/xml');
 if(doc.querySelector('parsererror')||doc.documentElement.tagName!==root) throw Error('Invalid XML.');
 return doc;
}
function steamMetrics(data:ObjectData):Partial<Metrics> {
 const doc=xml(data.profile_xml,'profile');
 const name=text(doc.querySelector('steamID')?.textContent),memberSince=text(doc.querySelector('memberSince')?.textContent);
 let hours:number|null=null;
 if(data.games_xml) {
  const games=xml(data.games_xml,'gamesList');
  if(!games.querySelector('error')) for(const game of games.querySelectorAll('game')) if(game.querySelector('appID')?.textContent==='730') hours=numeric(game.querySelector('hoursOnRecord')?.textContent,0);
 }
 return {name,memberSince,cs2Hours:hours};
}
export function parseProviderResponse(provider:Provider,raw:string,now:number):ProviderResult<Partial<Metrics>> {
 const error:ProviderResult<Partial<Metrics>>={status:'error',data:null,fetchedAt:null,message:'Invalid provider response.'};
 try {
  const payload=object(JSON.parse(raw)),data=object(payload.data);
  const statuses:ProviderStatus[]=['ok','not_found','private','unauthorized','rate_limited','error'];
  if(!statuses.includes(payload.status as ProviderStatus)) return error;
  const status=payload.status as ProviderStatus;
  let retryAfterMs:number|undefined;
  if(status==='rate_limited'||payload.retry_after!==undefined||payload.retry_after_seconds!==undefined) {
   const seconds=numeric(payload.retry_after_seconds??payload.retry_after,0);
   const date=typeof payload.retry_after==='string'?Date.parse(payload.retry_after):NaN;
   retryAfterMs=seconds!==null?Math.max(1000,seconds*1000):Number.isFinite(date)&&date>now?date-now:60000;
  }
  const timestamp=numeric(payload.fetched_at,0);
  const result:ProviderResult<Partial<Metrics>>={status,data:null,fetchedAt:timestamp===null?null:timestamp*1000,message:text(payload.message)??undefined,retryAfterMs};
  if(status!=='ok') return result;
  if(!payload.data||typeof payload.data!=='object'||Array.isArray(payload.data)) return error;
  if(provider==='leetify') {
   if(data.privacy_mode!=null&&data.privacy_mode!=='public') return {...result,status:'private'};
   const ranks=object(data.ranks),rating=object(data.rating),stats=object(data.stats);
   result.data={name:text(data.name),leetifyRating:numeric(ranks.leetify),leetifyAim:numeric(rating.aim,0,100),leetifyUtility:numeric(rating.utility,0,100),leetifyPositioning:numeric(rating.positioning,0,100),premier:numeric(ranks.premier,0,Infinity,true),timeToDamageMs:numeric(stats.reaction_time_ms,0),crosshairPlacementDeg:numeric(stats.preaim,0,180),spottedAccuracyPct:numeric(stats.accuracy_enemy_spotted,0,100),counterStrafingPct:numeric(stats.counter_strafing,0,100),recentKd:numeric(stats.kd,0),recentMatches:numeric(stats.kd_matches,0,Infinity,true)};
  } else if(provider==='faceit') {
   const stats=object(data.stats);
   result.data={name:text(data.nickname),faceitLevel:numeric(data.level,1,10,true),faceitElo:numeric(data.elo,0,Infinity,true),faceitKd:numeric(stats.kd,0),faceitHeadshotsPct:numeric(stats.headshots,0,100),faceitWinratePct:numeric(stats.winrate,0,100),faceitMatches:numeric(stats.matches,0,Infinity,true)};
  } else {
   const profile=xml(data.profile_xml,'profile');
   const privacy=profile.querySelector('privacyState')?.textContent;
   if(privacy&&privacy!=='public') return {...result,status:'private'};
   result.data=steamMetrics(data);
  }
  return result;
 } catch {return error;}
}
