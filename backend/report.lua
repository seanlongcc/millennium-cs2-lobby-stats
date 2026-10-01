local json=require('json')
local steam=require('steam')
local providers=require('providers')
local M={}
function M.fetch(provider,steam_id)
 if not steam.valid_id(steam_id) then return {status='error',message='Invalid SteamID64.'} end
 if provider~='leetify' and provider~='faceit' and provider~='steam' then return {status='error',message='Unsupported provider.'} end
 local deadline=os.time()+40
 local ok,result=pcall(function()
  if provider=='steam' then return steam.summary(steam_id,deadline) end
  local api=providers({deadline=deadline,include_scope=false})
  return json.decode(api['get_'..provider..'_profile'](steam_id))
 end)
 if not ok or type(result)~='table' then return {status='error',message='Provider response unavailable.'} end
 return result
end
return M
