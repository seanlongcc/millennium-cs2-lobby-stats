local calls={};local responses={}
package.loaded.http={get=function(url,options) calls[#calls+1]={url=url,options=options};return table.remove(responses,1) end}
package.loaded.steam=nil
local steam=require('steam')
test('vanity uses constructed HTTPS URL and accepts a private valid identity',function()
 responses={{status=200,body='<profile><steamID64>76561197960265729</steamID64><privacyState>private</privacyState></profile>'}}
 eq(steam.resolve_vanity('sample_name').steamId,'76561197960265729');eq(calls[1].url,'https://steamcommunity.com/id/sample_name/?xml=1');eq(calls[1].options.follow_redirects,false)
end)
test('vanity rejects malformed input without network work',function()
 local before=#calls;eq(steam.resolve_vanity('../evil').status,'error');eq(#calls,before)
end)
test('unexpected redirect never receives another request',function()
 responses={{status=302,headers={location='https://evil.test/'},body=''}};local before=#calls;eq(steam.resolve_vanity('sample').status,'error');eq(#calls,before+1)
end)
test('vanity rejects incomplete XML and invalid IDs',function()
 responses={{status=200,body='<profile><steamID64>76561197960265729</steamID64>'}};eq(steam.resolve_vanity('sample').status,'error')
 responses={{status=200,body='<profile><steamID64>103582791429521412</steamID64></profile>'}};eq(steam.resolve_vanity('sample').status,'error')
end)
test('Steam rate limits retain Retry-After and never request games after a denied profile',function()
 responses={{status=429,body='',headers={['Retry-After']='120'}}};local before=#calls;local r=steam.summary('76561197960265729',os.time()+40);eq(r.status,'rate_limited');eq(r.retry_after,'120');eq(#calls,before+1)
end)
