local cjson = require("json")
local millennium = require("millennium")
local logger = require("logger")
local providers = require("providers")
local PLUGIN_VERSION = "0.1.0"
local report_hook
local plugin_root = debug.getinfo(1, "S").source:gsub("^@", ""):gsub("\\", "/"):gsub("/backend/main.lua$", "")
function get_report_browser_url()
    local path = plugin_root .. "/static/cs2-report.html"
    return "https://millennium.ftp/" .. path:gsub("([^%w%-%._~/])", function(char) return string.format("%%%02X", string.byte(char)) end)
end
function report_browser_request(token, action, input)
    if type(token) ~= "string" or #token ~= 36 or type(action) ~= "string" or type(input) ~= "string" or #input > 32768 then
        return cjson.encode({error = "Invalid report request."})
    end
    local result = millennium.call_frontend_method("reportBrowserRequest", {token, action, input})
    return result or cjson.encode({error = "Report unavailable. Select Scan players again."})
end
local function encode(payload) return cjson.encode(payload) end
function get_preferences() return providers().get_preferences() end
function get_leetify_profile(steamId) return providers().get_leetify_profile(steamId) end
function get_faceit_profile(steamId) return providers().get_faceit_profile(steamId) end
function get_report_provider(provider, steamId) return encode(require("report").fetch(provider, steamId)) end

function resolve_steam_profile(vanity)
    return encode(require("steam").resolve_vanity(vanity))
end

local function set_default(key, value)
    if millennium.config.get(key) == nil then
        millennium.config.set(key, value)
    end
end

local function on_load()
    logger:info("Loading CS2 Lobby Stats v" .. PLUGIN_VERSION .. " on Millennium " .. millennium.version())
    set_default("show_steam_details", true)
    set_default("expand_details", false)
    set_default("highlight_enabled", true)
    -- The exact local report path opts this page into Millennium's isolated WebKit context.
    -- The page itself loads its packaged stylesheet; this hook registers the allowed URL.
    report_hook = millennium.add_browser_css(plugin_root .. "/static/cs2-report.css", "https://millennium[.]ftp/.*[/]static/cs2-report[.]html([#?].*)?")
    millennium.ready()
end

local function on_unload()
    if report_hook then millennium.remove_browser_module(report_hook) end
    logger:info("Unloading CS2 Lobby Stats")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
