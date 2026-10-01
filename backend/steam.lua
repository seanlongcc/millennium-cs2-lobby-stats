local http=require('http')
local M={}
function M.valid_id(id)
 return type(id)=='string' and #id==17 and id:match('^%d+$')~=nil and id>'76561197960265728' and id<='76561202255233023'
end
local function result_error(status,headers)
 headers=headers or {}
 local retry=status==429 and (headers['Retry-After'] or headers['retry-after'] or '60') or nil
 return {retry_after=retry,status=status==404 and 'not_found' or status==429 and 'rate_limited' or status==403 and 'private' or 'error',message='Steam profile unavailable.'}
end
function M.request(url,deadline)
 local remaining=math.floor(deadline-os.time())
 if remaining<=0 then return nil,'Request timed out.' end
 -- Redirects are handled explicitly so an approved host cannot redirect elsewhere.
 local response,err=http.get(url,{timeout=math.min(10,remaining),follow_redirects=false,verify_ssl=true,user_agent='cs2-lobby-stats/0.1.0'})
 if response and response.status>=300 and response.status<400 then
  local location=(response.headers or {}).location or (response.headers or {}).Location
  if type(location)~='string' or not location:match('^https://steamcommunity%.com/profiles/%d+/%?xml=1$') then return nil,'Unexpected redirect.' end
  remaining=math.floor(deadline-os.time());if remaining<=0 then return nil,'Request timed out.' end
  response,err=http.get(location,{timeout=math.min(10,remaining),follow_redirects=false,verify_ssl=true,user_agent='cs2-lobby-stats/0.1.0'})
 end
 return response,err
end
function M.resolve_vanity(vanity)
 if type(vanity)~='string' or #vanity<1 or #vanity>64 or not vanity:match('^[%w_-]+$') then return {status='error',message='Invalid vanity name.'} end
 local response=M.request('https://steamcommunity.com/id/'..vanity..'/?xml=1',os.time()+10)
 if not response or response.status~=200 then return result_error(response and response.status,response and response.headers) end
 local body=response.body or ''
 if not body:match('<profile>.*</profile>%s*$') or body:find('<!DOCTYPE',1,true) then return result_error() end
 local id=body:match('<steamID64>(%d+)</steamID64>')
 if not M.valid_id(id) then return result_error() end
 return {status='ok',steamId=id}
end
function M.summary(steam_id,deadline)
 if not M.valid_id(steam_id) then return {status='error',message='Invalid SteamID64.'} end
 local root='https://steamcommunity.com/profiles/'..steam_id
 local profile=M.request(root..'/?xml=1',deadline)
 if not profile or profile.status~=200 then return result_error(profile and profile.status,profile and profile.headers) end
 local body=profile.body or ''
 local privacy=body:match('<privacyState>(.-)</privacyState>')
 if privacy and privacy~='public' then return {status='private',message='This Steam profile is private.'} end
 if body:match('<steamID64>(%d+)</steamID64>')~=steam_id then return result_error() end
 local games=M.request(root..'/games/?tab=all&xml=1',deadline)
 local retry=games and games.status==429 and ((games.headers or {})['Retry-After'] or (games.headers or {})['retry-after'] or '60') or nil
 return {status='ok',fetched_at=os.time(),retry_after=retry,data={profile_xml=body,games_xml=games and games.status==200 and games.body or nil}}
end
return M
