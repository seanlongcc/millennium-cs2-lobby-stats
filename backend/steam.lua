local http=require('http')
local M={}
function M.valid_id(id)
 return type(id)=='string' and #id==17 and id:match('^%d+$')~=nil and id>'76561197960265728' and id<='76561202255233023'
end
local function result_error(status)
 return {status=status==404 and 'not_found' or status==429 and 'rate_limited' or status==403 and 'private' or 'error',message='Steam profile unavailable.'}
end
function M.request(url,deadline)
 local remaining=math.floor(deadline-os.time())
 if remaining<=0 then return nil,'Request timed out.' end
 -- Redirects are handled explicitly so an approved host cannot redirect elsewhere.
 local response,err=http.get(url,{timeout=math.min(10,remaining),follow_redirects=false,verify_ssl=true,user_agent='cs2-player-tracker/0.1.0'})
 if response and response.status>=300 and response.status<400 then
  local location=(response.headers or {}).location or (response.headers or {}).Location
  if type(location)~='string' or not location:match('^https://steamcommunity%.com/profiles/%d+/%?xml=1$') then return nil,'Unexpected redirect.' end
  remaining=math.floor(deadline-os.time());if remaining<=0 then return nil,'Request timed out.' end
  response,err=http.get(location,{timeout=math.min(10,remaining),follow_redirects=false,verify_ssl=true,user_agent='cs2-player-tracker/0.1.0'})
 end
 return response,err
end
function M.resolve_vanity(vanity)
 if type(vanity)~='string' or #vanity<1 or #vanity>64 or not vanity:match('^[%w_-]+$') then return {status='error',message='Invalid vanity name.'} end
 local response=M.request('https://steamcommunity.com/id/'..vanity..'/?xml=1',os.time()+10)
 if not response or response.status~=200 then return result_error(response and response.status) end
 local body=response.body or ''
 if not body:match('<profile>.*</profile>%s*$') or body:find('<!DOCTYPE',1,true) then return result_error() end
 local id=body:match('<steamID64>(%d+)</steamID64>')
 if not M.valid_id(id) then return result_error() end
 return {status='ok',steamId=id}
end
return M
