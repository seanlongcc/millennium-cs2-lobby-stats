local calls = {}
package.loaded.json = {encode=function(value) return value end}
package.loaded.providers = function() return {} end
package.loaded.logger = {info=function() end}
package.loaded.millennium = {
    config={get=function() return true end}, version=function() return 'test' end, ready=function() end,
    add_browser_css=function(path, pattern) calls.hook={path,pattern}; return 7 end,
    remove_browser_module=function(id) calls.removed=id end,
    call_frontend_method=function(name,args) calls.frontend={name,args}; return 'snapshot-json' end,
}
local file=assert(io.open('backend/main.lua')); local source=file:read('*a'); file:close()
local lifecycle=assert(load(source, '@C:\\Program Files (x86)\\Steam\\millennium\\plugins\\cs2-lobby-stats\\backend\\main.lua'))()
test('browser page is served from the installed plugin path, with an isolated WebKit hook', function()
    eq(get_report_browser_url(), 'https://millennium.ftp/C%3A/Program%20Files%20%28x86%29/Steam/millennium/plugins/cs2-lobby-stats/static/cs2-report.html')
    lifecycle.on_load()
    eq(calls.hook[1], 'C:/Program Files (x86)/Steam/millennium/plugins/cs2-lobby-stats/static/cs2-report.css')
    lifecycle.on_unload(); eq(calls.removed, 7)
end)
test('browser requests validate primitives and dispatch to the exported frontend handler', function()
    local token='12345678-1234-1234-1234-123456789012'
    eq(report_browser_request(token, 'snapshot', ''), 'snapshot-json')
    eq(calls.frontend[1], 'reportBrowserRequest'); eq(calls.frontend[2][1], token)
    calls.frontend=nil
    assert(report_browser_request({}, 'snapshot', '').error)
    assert(report_browser_request(token, 'add', string.rep('x',32769)).error)
    eq(calls.frontend,nil)
end)
