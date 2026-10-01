local calls,responses={},{}
local json={null={}}
json.encode=function(x)return x end;json.decode=function(x) if type(x)~='table' then error('Invalid JSON') end; return x end
package.loaded.json=json
package.loaded.logger={info=function()end,warn=function()end,error=function()end}
package.loaded.millennium={config={get=function()return nil end}}
package.loaded.utils={}
local function request(url,options) calls[#calls+1]={url=url,options=options};return table.remove(responses,1) end
package.loaded.http={get=request,request=request}
package.loaded.steam=nil;package.loaded.providers=nil;package.loaded.report=nil
local report=require('report')
local function reset(r) calls={};responses=r end
local id='76561197960265729'
local function profile() return {privacy_mode='public',name='Synthetic',ranks={leetify=2,premier=12000},rating={aim=95},stats={accuracy_enemy_spotted=34.4,counter_strafing_good_shots_ratio=80.7}} end
local function games(zero)
 local result={};for i=1,20 do result[i]={stats={{steam64_id=id,total_kills=20,total_deaths=(zero or i==20) and 0 or 10}}} end;return result
end
test('invalid IDs and link-only sources make zero HTTP calls',function()
 reset({});eq(report.fetch('leetify','103582791429521412').status,'error');eq(report.fetch('csstats',id).status,'error');eq(#calls,0)
end)
test('private and unauthorized profiles never trigger legacy fallback',function()
 reset({{status=403}});eq(report.fetch('leetify',id).status,'unauthorized');eq(#calls,1)
 reset({{status=200,body={privacy_mode='private'}}});eq(report.fetch('leetify',id).status,'private');eq(#calls,1)
end)
test('report aggregates 20 valid recent matches including zero deaths and skips SCOPE',function()
 reset({{status=200,body=profile()},{status=200,body=games(false)}})
 local r=report.fetch('leetify',id);eq(r.status,'ok');eq(r.data.stats.kd_matches,20);assert(math.abs(r.data.stats.kd-400/190)<0.00001);eq(r.data.stats.accuracy_enemy_spotted,34.4);eq(#calls,2)
 for _,call in ipairs(calls) do assert(not call.url:find('scope',1,true));assert(call.options.timeout<=10);eq(call.options.follow_redirects,false) end
end)
test('all-zero deaths never produce infinite K/D',function()
 reset({{status=200,body=profile()},{status=200,body=games(true)}});local r=report.fetch('leetify',id);eq(r.data.stats.kd,nil);eq(r.data.stats.kd_matches,20)
end)
test('legacy fallback checks privacy and preserves profile shape without bulk SCOPE',function()
 reset({{status=404},{status=200,body={meta={privacyMode='private'},recentGameRatings={aim=95},games={}}}});eq(report.fetch('leetify',id).status,'private');eq(#calls,2)
 reset({{status=404},{status=200,body={meta={name='Legacy'},recentGameRatings={aim=95,leetify=0.02,gamesPlayed=20},games={}}}});local r=report.fetch('leetify',id);eq(r.status,'ok');eq(r.data.rating.aim,95);eq(r.data.ranks.leetify,2);eq(#calls,2)
end)
test('429 returns Retry-After without fallback requests',function()
 reset({{status=429,headers={['Retry-After']='17'}}});local r=report.fetch('leetify',id);eq(r.status,'rate_limited');eq(r.retry_after,'17');eq(#calls,1)
 reset({{status=429,headers={['retry-after']='Wed, 30 Sep 2026 22:00:00 GMT'}}});eq(report.fetch('leetify',id).retry_after,'Wed, 30 Sep 2026 22:00:00 GMT')
end)
test('each request consumes only the remaining route budget',function()
 local real=os.time;local clock=100;os.time=function()local v=clock;clock=clock+11;return v end
 reset({{status=200,body=profile()},{status=200,body=games(false)}});local ok,err=pcall(function()report.fetch('leetify',id);for _,c in ipairs(calls) do assert(c.options.timeout>0 and c.options.timeout<=10) end end);os.time=real;assert(ok,err)
end)
test('original profile calls retain optional SCOPE enrichment',function()
 reset({{status=404},{status=200,body={meta={name='Legacy'},recentGameRatings={aim=95},games={}}},{status=404}})
 local r=require('providers')().get_leetify_profile(id);eq(r.status,'ok');eq(r.data.rating.aim,95);eq(#calls,3);assert(calls[3].url:find('scope.gg',1,true))
end)
