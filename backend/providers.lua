-- Shared upstream providers; each invocation owns its request budget.
return function(context)
local cjson = require("json")
local native_http = require("http")
local retry_after = nil
local function bounded_request(method, url, options)
    if context then
        local remaining = math.floor(context.deadline - os.time())
        if remaining <= 0 then return nil, "Report request budget exhausted." end
        options.timeout = math.min(options.timeout or 10, 10, remaining)
        options.follow_redirects = false
    end
    local response, err = native_http[method](url, options)
    if response and response.status == 429 then
        local headers = response.headers or {}
        retry_after = headers["retry-after"] or headers["Retry-After"] or "60"
    end
    return response, err
end
local http = {
    get = function(url, options) return bounded_request("get", url, options) end,
    request = function(url, options) return bounded_request("request", url, options) end,
}
local logger = require("logger")
local millennium = require("millennium")

local PLUGIN_VERSION = "0.1.0"
local USER_AGENT = "cs2-player-tracker/" .. PLUGIN_VERSION

local function encode(payload)
    if retry_after then payload.retry_after = retry_after end
    local ok, result = pcall(cjson.encode, payload)
    if ok then
        return result
    end

    logger:error("Failed to encode an IPC response: " .. tostring(result))
    return [[{"status":"error","message":"Could not encode provider response."}]]
end

local function is_null(value)
    return value == nil or value == cjson.null
end

local function optional(value)
    if is_null(value) then
        return nil
    end

    return value
end

local function trimmed_config(key)
    local value = millennium.config.get(key)
    if type(value) ~= "string" then
        return nil
    end

    value = value:match("^%s*(.-)%s*$")
    if value == "" then
        return nil
    end

    return value
end

local valid_steam_id = require("steam").valid_id

local function request_json(url, headers, timeout)
    local response, request_error = http.get(url, {
        headers = headers,
        timeout = timeout or 10,
        follow_redirects = true,
        verify_ssl = true,
        user_agent = USER_AGENT,
    })

    if response == nil then
        return nil, 0, request_error or "Network request failed."
    end

    if response.status < 200 or response.status >= 300 then
        return nil, response.status, "HTTP " .. tostring(response.status)
    end

    local ok, data = pcall(cjson.decode, response.body)
    if not ok or type(data) ~= "table" then
        return nil, response.status, "Invalid JSON response."
    end

    return data, response.status, nil
end

local function post_json(url, body, headers)
    -- Millennium 3.4.0's http.post wrapper loses its generated options table and
    -- performs a GET. The generic request entry point sends the POST correctly.
    local response, request_error = http.request(url, {
        method = "POST",
        data = body,
        headers = headers,
        timeout = 10,
        follow_redirects = true,
        verify_ssl = true,
        user_agent = USER_AGENT,
    })

    if response == nil then
        return nil, 0, request_error or "Network request failed."
    end

    if response.status < 200 or response.status >= 300 then
        return nil, response.status, "HTTP " .. tostring(response.status)
    end

    local ok, data = pcall(cjson.decode, response.body)
    if not ok or type(data) ~= "table" then
        return nil, response.status, "Invalid JSON response."
    end

    return data, response.status, nil
end

local function error_status(http_status)
    if http_status == 401 or http_status == 403 then
        return "unauthorized"
    elseif http_status == 404 then
        return "not_found"
    elseif http_status == 429 then
        return "rate_limited"
    end

    return "error"
end

local function provider_error(provider, http_status, message)
    local log_message = provider .. " request failed (" .. tostring(http_status) .. "): " .. tostring(message)
    if http_status == 404 then
        logger:info(log_message)
    else
        logger:warn(log_message)
    end
    return encode({
        status = error_status(http_status),
        message = message or "Provider request failed.",
    })
end

local function get_preferences()
    return encode({
        show_steam_details = millennium.config.get("show_steam_details") ~= false,
        expand_details = millennium.config.get("expand_details") == true,
    })
end

local function number_or_nil(value)
    value = optional(value)
    if type(value) == "number" then
        return value == value and math.abs(value) ~= math.huge and value or nil
    elseif type(value) == "string" then
        local parsed = tonumber(value)
        return parsed and parsed == parsed and math.abs(parsed) ~= math.huge and parsed or nil
    end

    return nil
end

local function scaled_rating(value)
    local number = number_or_nil(value)
    if number == nil then
        return nil
    end

    return number * 100
end

local function normalize_public_leetify_profile(profile, steam_id, recent_kd, recent_kd_matches)
    local ranks = type(profile.ranks) == "table" and profile.ranks or {}
    local rating = type(profile.rating) == "table" and profile.rating or {}
    local stats = type(profile.stats) == "table" and profile.stats or {}
    local recent_matches = {}

    if type(profile.recent_matches) == "table" then
        for index = 1, math.min(#profile.recent_matches, 5) do
            local match = profile.recent_matches[index]
            if type(match) == "table" then
                recent_matches[#recent_matches + 1] = {
                    outcome = optional(match.outcome),
                    map_name = optional(match.map_name),
                    finished_at = optional(match.finished_at),
                    score = optional(match.score),
                    data_source = optional(match.data_source),
                }
            end
        end
    end

    return {
        name = optional(profile.name),
        steam64_id = steam_id,
        profile_id = optional(profile.id),
        privacy_mode = optional(profile.privacy_mode),
        winrate = optional(profile.winrate),
        total_matches = optional(profile.total_matches),
        first_match_date = optional(profile.first_match_date),
        ranks = {
            premier = optional(ranks.premier),
            faceit = optional(ranks.faceit),
            faceit_elo = optional(ranks.faceit_elo),
            leetify = optional(ranks.leetify),
        },
        rating = {
            aim = optional(rating.aim),
            positioning = optional(rating.positioning),
            utility = optional(rating.utility),
            clutch = scaled_rating(rating.clutch),
            opening = scaled_rating(rating.opening),
        },
        stats = {
            kd = recent_kd,
            kd_matches = recent_kd_matches,
            reaction_time_ms = optional(stats.reaction_time_ms),
            preaim = optional(stats.preaim),
            spray_accuracy = optional(stats.spray_accuracy),
            accuracy_enemy_spotted = optional(stats.accuracy_enemy_spotted),
            counter_strafing = optional(stats.counter_strafing_good_shots_ratio),
        },
        recent_matches = recent_matches,
    }
end

local function latest_legacy_rank(games, expected_rank_type, expected_source)
    for _, match in ipairs(games) do
        if type(match) == "table" then
            local rank = number_or_nil(match.skillLevel)
            local rank_type = number_or_nil(match.rankType)
            local source = type(match.dataSource) == "string" and match.dataSource:lower() or ""
            local source_matches = expected_source == nil or source:find(expected_source, 1, true) ~= nil
            if rank ~= nil and rank > 0 and rank_type == expected_rank_type and source_matches then
                return rank
            end
        end
    end

    return nil
end

local function average_legacy_stat(games, limit, key, multiplier)
    local total = 0
    local count = 0

    for index = 1, math.min(#games, limit) do
        local match = games[index]
        local value = type(match) == "table" and number_or_nil(match[key]) or nil
        if value ~= nil and value > 0 then
            total = total + value
            count = count + 1
        end
    end

    if count == 0 then
        return nil
    end

    return (total / count) * (multiplier or 1)
end

local function aggregate_legacy_kd(games, limit)
    local kills = 0
    local deaths = 0
    local matches = 0

    for index = 1, math.min(#games, limit) do
        local match = games[index]
        local match_kills = type(match) == "table" and number_or_nil(match.kills) or nil
        local match_deaths = type(match) == "table" and number_or_nil(match.deaths) or nil
        if match_kills ~= nil and match_deaths ~= nil and match_deaths >= 0 and match_kills >= 0 and match_kills % 1 == 0 and match_deaths % 1 == 0 then
            kills = kills + match_kills
            deaths = deaths + match_deaths
            matches = matches + 1
        end
    end

    if deaths == 0 then
        return nil, matches
    end

    return kills / deaths, matches
end

local function get_public_recent_kd(steam_id, headers)
    local url = "https://api-public.cs-prod.leetify.com/v3/profile/matches?steam64_id=" .. steam_id
    local matches, status, request_error = request_json(url, headers, 4)
    if matches == nil then
        logger:info("Optional Leetify match history unavailable (" .. tostring(status) .. "): " .. tostring(request_error))
        return nil, nil
    end

    local kills = 0
    local deaths = 0
    local match_count = 0

    for _, match in ipairs(matches) do
        local player_stats = type(match) == "table" and match.stats or nil
        if type(player_stats) == "table" then
            for _, player in ipairs(player_stats) do
                if type(player) == "table" and tostring(player.steam64_id) == steam_id then
                    local player_kills = number_or_nil(player.total_kills)
                    local player_deaths = number_or_nil(player.total_deaths)
                    if player_kills ~= nil and player_deaths ~= nil and player_deaths >= 0 and player_kills >= 0 and player_kills % 1 == 0 and player_deaths % 1 == 0 then
                        kills = kills + player_kills
                        deaths = deaths + player_deaths
                        match_count = match_count + 1
                    end
                    break
                end
            end
        end
    end

    if deaths == 0 then
        return nil, match_count
    end

    return kills / deaths, match_count
end

local function subtract_decimal_strings(left, right)
    local result = {}
    local borrow = 0
    local right_offset = #left - #right

    for index = #left, 1, -1 do
        local left_digit = tonumber(left:sub(index, index))
        local right_index = index - right_offset
        local right_digit = right_index >= 1 and tonumber(right:sub(right_index, right_index)) or 0
        if left_digit == nil or right_digit == nil then
            return nil
        end

        local digit = left_digit - right_digit - borrow
        if digit < 0 then
            digit = digit + 10
            borrow = 1
        else
            borrow = 0
        end
        result[#result + 1] = tostring(digit)
    end

    if borrow ~= 0 then
        return nil
    end

    local value = table.concat(result):reverse():gsub("^0+", "")
    return value ~= "" and value or "0"
end

local function table_contains(values, expected)
    if type(values) ~= "table" then
        return false
    end

    for _, value in ipairs(values) do
        if value == expected then
            return true
        end
    end

    return false
end

local function get_scope_damage_time(steam_id)
    local account_id = subtract_decimal_strings(steam_id, "76561197960265728")
    if account_id == nil then
        return nil, nil, nil
    end

    local scope_url = "https://app.scope.gg/progress/" .. account_id
    local response, request_error = http.get(scope_url, {
        headers = { ["Accept"] = "text/html" },
        timeout = 6,
        follow_redirects = true,
        verify_ssl = true,
        user_agent = USER_AGENT,
    })

    if response == nil or response.status < 200 or response.status >= 300 then
        logger:info("Optional SCOPE.GG enrichment unavailable (" .. tostring(response and response.status or 0) .. "): " .. tostring(request_error))
        return nil, nil, nil
    end

    local next_data_json = response.body:match('<script id="__NEXT_DATA__" type="application/json">(.-)</script>')
    if next_data_json == nil then
        return nil, nil, nil
    end

    local ok, next_data = pcall(cjson.decode, next_data_json)
    if not ok or type(next_data) ~= "table" then
        return nil, nil, nil
    end

    local props = type(next_data.props) == "table" and next_data.props or {}
    local initial_state = type(props.initialState) == "table" and props.initialState or {}
    local dashboard = type(initial_state.publicDashboard) == "table" and initial_state.publicDashboard or {}
    local ratings = type(dashboard.ratings) == "table" and dashboard.ratings or {}
    local rating_payload = type(ratings.ratings) == "table" and ratings.ratings or {}
    local all_ratings = type(rating_payload.Ratings) == "table" and rating_payload.Ratings or {}
    local by_side = type(all_ratings.StatsBySide) == "table" and all_ratings.StatsBySide or {}
    local general = type(by_side.GeneralStats) == "table" and by_side.GeneralStats or {}
    local metrics = type(general.Metrics) == "table" and general.Metrics or {}

    for _, metric in ipairs(metrics) do
        if type(metric) == "table" and metric.ID == "MedianDamageTimeByClass" and table_contains(metric.ShowToRoles, "Sniper") then
            local aggregated = type(metric.Aggregated) == "table" and metric.Aggregated or {}
            local range = type(aggregated[1]) == "table" and aggregated[1] or {}
            local minimum = number_or_nil(range[1])
            local maximum = number_or_nil(range[2])
            if minimum ~= nil and maximum ~= nil then
                return minimum * 1000, maximum * 1000, scope_url
            end
        end
    end

    return nil, nil, nil
end

local function normalize_legacy_leetify_profile(profile, steam_id)
    local ratings = type(profile.recentGameRatings) == "table" and profile.recentGameRatings or {}
    local meta = type(profile.meta) == "table" and profile.meta or {}
    local games = type(profile.games) == "table" and profile.games or {}
    local games_played = number_or_nil(ratings.gamesPlayed) or #games
    local aggregate_limit = math.min(#games, games_played)
    local wins = 0
    local recent_matches = {}
    local recent_kd, recent_kd_matches = aggregate_legacy_kd(games, aggregate_limit)

    for index = 1, aggregate_limit do
        local match = games[index]
        if type(match) == "table" and match.matchResult == "win" then
            wins = wins + 1
        end
    end

    for index = 1, math.min(#games, 5) do
        local match = games[index]
        if type(match) == "table" then
            recent_matches[#recent_matches + 1] = {
                outcome = optional(match.matchResult),
                map_name = optional(match.mapName),
                finished_at = optional(match.gameFinishedAt),
                score = optional(match.scores),
                data_source = optional(match.dataSource),
            }
        end
    end

    local first_match_date = nil
    if #games > 0 and type(games[#games]) == "table" then
        first_match_date = optional(games[#games].gameFinishedAt)
    end

    return {
        name = optional(meta.name),
        steam64_id = steam_id,
        profile_id = optional(meta.leetifyUserId),
        privacy_mode = "public",
        winrate = aggregate_limit > 0 and wins / aggregate_limit or nil,
        total_matches = games_played,
        first_match_date = first_match_date,
        ranks = {
            premier = latest_legacy_rank(games, 11, "matchmaking"),
            faceit = latest_legacy_rank(games, 3, "faceit"),
            faceit_elo = nil,
            leetify = scaled_rating(ratings.leetify),
        },
        rating = {
            aim = optional(ratings.aim),
            positioning = optional(ratings.positioning),
            utility = optional(ratings.utility),
            clutch = scaled_rating(ratings.clutch),
            opening = scaled_rating(ratings.opening),
        },
        stats = {
            kd = recent_kd,
            kd_matches = recent_kd_matches,
            reaction_time_ms = average_legacy_stat(games, aggregate_limit, "reactionTime", 1000),
            preaim = average_legacy_stat(games, aggregate_limit, "preaim"),
            spray_accuracy = nil,
            counter_strafing = nil,
        },
        recent_matches = recent_matches,
    }
end

local function is_private(profile)
    local meta = type(profile.meta) == "table" and profile.meta or {}
    for _, source in ipairs({profile, meta}) do
        for _, key in ipairs({"privacy_mode", "privacyMode"}) do
            local value = optional(source[key])
            if value ~= nil and value ~= "public" then return true end
        end
        if source.isPrivate == true or source.private == true then return true end
    end
    return false
end

local function get_leetify_profile(steamId)
    if not valid_steam_id(steamId) then
        return encode({ status = "error", message = "Invalid SteamID64." })
    end

    local headers = { ["Accept"] = "application/json" }
    local api_key = trimmed_config("leetify_api_key")
    if api_key ~= nil then
        headers["_leetify_key"] = api_key
    end

    local url = "https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=" .. steamId
    local profile, status, request_error = request_json(url, headers)
    if profile == nil then
        if status ~= 404 then
            return provider_error("Leetify", status, request_error)
        end

        -- Leetify's public v3 endpoint omits some unregistered/legacy profiles
        -- even though their public profile page still exposes recent ratings.
        -- This is the same keyless endpoint used by Leetify's own web client.
        local legacy_url = "https://api.cs-prod.leetify.com/api/profile/id/" .. steamId
        local legacy_headers = {
            ["Accept"] = "application/json",
            ["Origin"] = "https://leetify.com",
            ["Referer"] = "https://leetify.com/",
        }
        local legacy_profile, legacy_status, legacy_error = request_json(legacy_url, legacy_headers)
        if legacy_profile == nil then
            return provider_error("Leetify legacy profile", legacy_status, legacy_error)
        end

        if is_private(legacy_profile) then return encode({status="private", message="This Leetify profile is private."}) end

        local legacy_ratings = type(legacy_profile.recentGameRatings) == "table" and legacy_profile.recentGameRatings or {}
        local legacy_games = type(legacy_profile.games) == "table" and legacy_profile.games or {}
        if next(legacy_ratings) == nil and #legacy_games == 0 then
            return encode({ status = "not_found", message = "Leetify has no public matches for this Steam account." })
        end

        local normalized_profile = normalize_legacy_leetify_profile(legacy_profile, steamId)
        if normalized_profile.stats.reaction_time_ms == nil and (not context or context.include_scope ~= false) then
            local damage_time_min_ms, damage_time_max_ms, scope_url = get_scope_damage_time(steamId)
            normalized_profile.stats.damage_time_min_ms = damage_time_min_ms
            normalized_profile.stats.damage_time_max_ms = damage_time_max_ms
            normalized_profile.stats.damage_time_source_url = scope_url
        end

        logger:info("Using Leetify web profile fallback for SteamID64 " .. steamId)
        return encode({
            status = "ok",
            data = normalized_profile,
            fetched_at = os.time(),
        })
    end

    if is_private(profile) then
        return encode({ status = "private", message = "This Leetify profile is private." })
    end

    local recent_kd, recent_kd_matches = get_public_recent_kd(steamId, headers)
    return encode({
        status = "ok",
        data = normalize_public_leetify_profile(profile, steamId, recent_kd, recent_kd_matches),
        fetched_at = os.time(),
    })
end

local function faceit_lifetime_map(payload)
    if type(payload) ~= "table" then
        return {}
    end

    local lifetime = payload.lifetime or payload.lifetime_stats
    if type(lifetime) ~= "table" and type(payload.payload) == "table" then
        lifetime = payload.payload.lifetime or payload.payload.lifetime_stats
    end
    if type(lifetime) ~= "table" then
        return {}
    end

    local result = {}
    for key, value in pairs(lifetime) do
        if type(key) == "string" then
            result[key] = value
        elseif type(value) == "table" and type(value.key) == "string" then
            result[value.key] = optional(value.value)
        end
    end
    return result
end

local function first_lifetime_value(lifetime, keys)
    for _, key in ipairs(keys) do
        local value = optional(lifetime[key])
        if value ~= nil and tostring(value) ~= "" then
            return value
        end
    end
    return nil
end

local function get_faceit_profile(steamId)
    if not valid_steam_id(steamId) then
        return encode({ status = "error", message = "Invalid SteamID64." })
    end

    local headers = {
        ["Accept"] = "application/json",
        ["Content-Type"] = "application/json",
    }
    local lookup_body = cjson.encode({
        steamUrl = "https://steamcommunity.com/profiles/" .. steamId,
    })
    local player, player_status, player_error = post_json("https://faceit-finder.com/api/search/steam", lookup_body, headers)
    if player == nil then
        return provider_error("FACEIT lookup", player_status, player_error)
    end

    local cs2 = type(player.games) == "table" and player.games.cs2 or nil
    if type(cs2) ~= "table" or type(player.player_id) ~= "string" or not player.player_id:match("^[%w-]+$") then
        return encode({
            status = "not_found",
            message = "FACEIT lookup returned no CS2 account (HTTP " .. tostring(player_status) .. ").",
        })
    end

    local lifetime = {}
    local stats_api_url = "https://api.faceit.com/stats/v1/stats/users/" .. tostring(player.player_id) .. "/games/cs2"
    local stats_payload, stats_status, stats_error = request_json(stats_api_url, {
        ["Accept"] = "application/json",
        ["Origin"] = "https://www.faceit.com",
        ["Referer"] = "https://www.faceit.com/",
    })

    if stats_payload ~= nil then
        lifetime = faceit_lifetime_map(stats_payload)
    end

    local stats_response = nil
    local html_error = nil
    local partial_message = nil
    local lifetime_matches = optional(lifetime.matches) or first_lifetime_value(lifetime, { "Matches", "matches", "m35" })
    local lifetime_kd = optional(lifetime.kd) or first_lifetime_value(lifetime, { "Average K/D Ratio", "K/D Ratio", "K/D", "kd", "k5" })

    -- The public FACEIT endpoint can return a non-empty lifetime object without
    -- the summary fields we display. In that case, supplement the missing values
    -- from Faceit Finder instead of treating any non-empty object as complete.
    if lifetime_matches == nil or lifetime_kd == nil then
        local stats_url = "https://faceit-finder.com/id/" .. steamId .. "?lang=en"
        stats_response, html_error = http.get(stats_url, {
            headers = { ["Accept"] = "text/html" },
            timeout = 12,
            follow_redirects = true,
            verify_ssl = true,
            user_agent = USER_AGENT,
        })

        if stats_response ~= nil and stats_response.status == 200 then
            local hero = stats_response.body:match("Kluczowe liczby.-ELO Rating") or stats_response.body:match("Key numbers.-ELO Rating") or stats_response.body
            lifetime.matches = lifetime_matches or hero:match(">Matches</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.winrate = optional(lifetime.winrate) or first_lifetime_value(lifetime, { "Win Rate %", "Winrate", "winrate", "k6" }) or hero:match(">Win Rate</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.kd = lifetime_kd or hero:match(">K/D</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.adr = optional(lifetime.adr) or first_lifetime_value(lifetime, { "ADR", "Average Damage Per Round", "adr", "k17" }) or hero:match(">ADR</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.headshots = optional(lifetime.headshots) or first_lifetime_value(lifetime, { "Average Headshots %", "Headshots %", "HS %", "headshots", "k8" }) or hero:match(">HS %%</p>%s*<p[^>]*>([^<]+)</p>")
        end
    end

    lifetime_matches = optional(lifetime.matches) or first_lifetime_value(lifetime, { "Matches", "matches", "m35" })
    lifetime_kd = optional(lifetime.kd) or first_lifetime_value(lifetime, { "Average K/D Ratio", "K/D Ratio", "K/D", "kd", "k5" })

    if lifetime_matches == nil and lifetime_kd == nil then
        partial_message = "FACEIT profile loaded, but lifetime statistics are unavailable."
        local html_status = stats_response and stats_response.status or 0
        logger:info("Optional FACEIT lifetime stats unavailable (API " .. tostring(stats_status) .. ", HTML " .. tostring(html_status) .. "): " .. tostring(stats_error or html_error))
    end

    return encode({
        status = "ok",
        message = partial_message,
        data = {
            nickname = optional(player.nickname),
            country = optional(player.country),
            player_id = optional(player.player_id),
            level = optional(cs2.skill_level),
            elo = optional(cs2.faceit_elo),
            region = optional(cs2.region),
            stats = {
                matches = lifetime_matches,
                kd = lifetime_kd,
                adr = optional(lifetime.adr) or first_lifetime_value(lifetime, { "ADR", "Average Damage Per Round", "adr", "k17" }),
                headshots = optional(lifetime.headshots) or first_lifetime_value(lifetime, { "Average Headshots %", "Headshots %", "HS %", "headshots", "k8" }),
                winrate = optional(lifetime.winrate) or first_lifetime_value(lifetime, { "Win Rate %", "Winrate", "winrate", "k6" }),
                recent_results = type(lifetime.s0) == "table" and lifetime.s0 or {},
            },
        },
        fetched_at = os.time(),
    })
end


return {get_preferences=get_preferences, get_leetify_profile=get_leetify_profile, get_faceit_profile=get_faceit_profile}
end
