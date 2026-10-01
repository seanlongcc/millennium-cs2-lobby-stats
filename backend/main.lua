local cjson = require("json")
local millennium = require("millennium")
local logger = require("logger")
local providers = require("providers")
local PLUGIN_VERSION = "0.1.0"
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
    millennium.ready()
end

local function on_unload()
    logger:info("Unloading CS2 Lobby Stats")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
