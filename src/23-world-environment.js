(function () {
    "use strict";

    const FALLBACK_WEATHER = "The air is mild and still beneath an unremarkable sky.";
    const IP_GEOLOCATION_URL = "https://ipwho.is/";
    const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
    const PHASE_LABELS = Object.freeze({
        evening: "Evening",
        nighttime_timelapse: "Night",
        morning: "Morning",
        daytime_timelapse: "Day"
    });
    const weatherInFlightByKey = new Map();
    let lastWeatherDiagnostics = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function world() {
        return setup.Game.getWorld();
    }

    function ensureShape(target) {
        const w = target || world();
        if (!w.environment || typeof w.environment !== "object" || Array.isArray(w.environment)) w.environment = {};
        if (!Object.prototype.hasOwnProperty.call(PHASE_LABELS, w.environment.timePhase)) w.environment.timePhase = "evening";
        if (typeof w.environment.weatherNarrative !== "string" || !w.environment.weatherNarrative.trim()) {
            w.environment.weatherNarrative = FALLBACK_WEATHER;
        }
        if (typeof w.environment.weatherInitialized !== "boolean") w.environment.weatherInitialized = false;
        if (typeof w.environment.weatherSource !== "string") w.environment.weatherSource = "fallback";
        return w.environment;
    }

    function timeLabel(phase) {
        const value = phase || ensureShape().timePhase;
        return PHASE_LABELS[value] || "Evening";
    }

    function setTimePhase(phase) {
        if (!Object.prototype.hasOwnProperty.call(PHASE_LABELS, phase)) {
            return { ok: false, error: { code: "TIME_PHASE_INVALID", message: `Unknown time phase '${String(phase)}'.` } };
        }
        ensureShape().timePhase = phase;
        const label = timeLabel(phase);
        // world.environment.timePhase is authoritative. Keep the legacy SugarCube $time mirror synchronized
        // for old saves/debug dumps and any compatibility UI that still inspects State.variables.time.
        if (typeof State !== "undefined" && State.variables) State.variables.time = label;
        return { ok: true, value: { timePhase: phase, timeLabel: label } };
    }

    function weatherCodeText(code) {
        const n = Number(code);
        if (n === 0) return "clear sky";
        if (n === 1) return "mostly clear";
        if (n === 2) return "partly cloudy";
        if (n === 3) return "overcast";
        if (n === 45 || n === 48) return "fog";
        if ([51, 53, 55].includes(n)) return "drizzle";
        if ([56, 57].includes(n)) return "freezing drizzle";
        if ([61, 63, 65].includes(n)) return "rain";
        if ([66, 67].includes(n)) return "freezing rain";
        if ([71, 73, 75, 77].includes(n)) return "snow";
        if ([80, 81, 82].includes(n)) return "rain showers";
        if ([85, 86].includes(n)) return "snow showers";
        if ([95, 96, 99].includes(n)) return "thunderstorm";
        return "mixed weather";
    }

    function normalizeWeather(current) {
        current = current && typeof current === "object" ? current : {};
        return {
            condition: weatherCodeText(current.weather_code),
            temperatureC: Number.isFinite(Number(current.temperature_2m)) ? Number(current.temperature_2m) : null,
            precipitationMm: Number.isFinite(Number(current.precipitation)) ? Number(current.precipitation) : null,
            rainMm: Number.isFinite(Number(current.rain)) ? Number(current.rain) : null,
            snowfallCm: Number.isFinite(Number(current.snowfall)) ? Number(current.snowfall) : null,
            cloudCoverPercent: Number.isFinite(Number(current.cloud_cover)) ? Number(current.cloud_cover) : null,
            windKph: Number.isFinite(Number(current.wind_speed_10m)) ? Number(current.wind_speed_10m) : null
        };
    }

    function stripOutput(text) {
        let value = String(text || "").trim();
        if (value.startsWith("```") && value.endsWith("```")) {
            value = value.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
        }
        value = value.replace(/^['\"]|['\"]$/g, "").trim();
        if (value.length > 800) value = value.slice(0, 800).trim();
        return value;
    }

    async function fallbackFetchJson(url, fetchImpl) {
        const fetcher = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
        if (!fetcher) throw new Error("Fetch is unavailable.");
        const response = await fetcher(url);
        if (!response || !response.ok) throw new Error(`External request failed with HTTP ${response && response.status || 0}.`);
        if (typeof response.json === "function") return response.json();
        if (typeof response.text === "function") return JSON.parse(await response.text());
        throw new Error("External request returned no readable response body.");
    }

    function networkFetchJson(spec) {
        if (setup.RuntimeDiagnostics && typeof setup.RuntimeDiagnostics.fetchJson === "function") {
            return setup.RuntimeDiagnostics.fetchJson(spec);
        }
        return fallbackFetchJson(spec.url, spec.fetchImpl);
    }

    async function fetchWeatherData(fetchImpl, onStage) {
        if (typeof onStage === "function") onStage("ip-geolocation");
        const location = await networkFetchJson({
            purpose: "weather-refresh",
            stage: "ip-geolocation",
            service: "ipwho.is",
            url: IP_GEOLOCATION_URL,
            fetchImpl: fetchImpl
        });
        if (location && location.success === false) throw new Error(location.message || "IP geolocation request failed.");
        const latitude = Number(location && location.latitude);
        const longitude = Number(location && location.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("IP geolocation returned no usable coordinates.");

        if (typeof onStage === "function") onStage("weather-fetch");
        const url = WEATHER_URL + "?latitude=" + encodeURIComponent(latitude) +
            "&longitude=" + encodeURIComponent(longitude) +
            "&current=temperature_2m,precipitation,rain,snowfall,cloud_cover,weather_code,wind_speed_10m";
        const weather = await networkFetchJson({
            purpose: "weather-refresh",
            stage: "weather-fetch",
            service: "Open-Meteo",
            url: url,
            fetchImpl: fetchImpl
        });
        if (!weather || !weather.current) throw new Error("Weather response contained no current conditions.");
        return normalizeWeather(weather.current);
    }

    async function narrateWeather(data, client) {
        if (!setup.AIRequestExecutor || !setup.AIRequestProfiles) throw new Error("AI request infrastructure is unavailable.");
        const messages = [{
            role: "system",
            content: [
                "Write one short atmospheric description of the supplied current weather for a rural, low-technology environment.",
                "Describe weather only. Do not mention time of day, dawn, dusk, morning, evening, night, or use the sun's position as a time cue.",
                "Do not mention measurements, forecasts, APIs, modern meteorological technology, real-world places, people, character actions, or invented events.",
                "Stay grounded in the supplied weather data. Return plain prose only, preferably one or two sentences."
            ].join(" ")
        }, {
            role: "user",
            content: "CURRENT WEATHER DATA:\n" + JSON.stringify(data)
        }];
        const result = await setup.AIRequestExecutor.executeCustom({
            actorId: null,
            purpose: "weather-narration",
            stage: "weather-narration",
            messages: clone(messages),
            requestOptions: setup.AIRequestProfiles.resolve("weather-narration", { actorId: null }),
            client: client || setup.OpenRouterClient,
            run: async function (policyClient) {
                const response = await policyClient.chat(messages);
                if (!response || !response.ok) {
                    return {
                        ok: false,
                        value: null,
                        error: clone(response && response.error || { code: "WEATHER_NARRATOR_FAILED", message: "Weather narrator request failed." }),
                        modelId: response && response.modelId || null,
                        usage: response && response.usage || null,
                        rawContent: response && response.content || "",
                        trace: null
                    };
                }
                const text = stripOutput(response.content);
                if (!text) {
                    return { ok: false, value: null, error: { code: "WEATHER_NARRATOR_EMPTY", message: "Weather narrator returned empty text." }, modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content || "", trace: null };
                }
                return { ok: true, value: { text: text }, error: null, modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content || "", trace: null };
            }
        });
        if (!result || !result.ok || !result.value || !result.value.text) throw new Error(result && result.error && result.error.message || "Weather narrator failed.");
        return result.value.text;
    }

    function refreshStillApplicable(options) {
        return !options || typeof options.shouldCommit !== "function" || options.shouldCommit() !== false;
    }

    function staleRefreshResult(stage) {
        const finishedAt = Date.now();
        lastWeatherDiagnostics = Object.assign(lastWeatherDiagnostics || {}, {
            finishedAt: new Date(finishedAt).toISOString(),
            durationMs: lastWeatherDiagnostics && lastWeatherDiagnostics.startedAt ? Math.max(0, finishedAt - Date.parse(lastWeatherDiagnostics.startedAt)) : null,
            ok: false,
            stage: stage || "stale",
            failedStage: null,
            fallbackUsed: false,
            stale: true,
            error: null
        });
        return { ok: false, skipped: true, stale: true, value: null, error: null };
    }

    async function performWeatherRefresh(client, options) {
        options = options && typeof options === "object" ? options : {};
        const env = ensureShape();
        const hadNarrative = typeof env.weatherNarrative === "string" && env.weatherNarrative.trim() && env.weatherNarrative !== FALLBACK_WEATHER;
        const startedAt = Date.now();
        let stage = "ip-geolocation";
        lastWeatherDiagnostics = {
            startedAt: new Date(startedAt).toISOString(),
            finishedAt: null,
            durationMs: null,
            ok: null,
            stage: stage,
            failedStage: null,
            fallbackUsed: false,
            weatherSourceBefore: env.weatherSource || null,
            weatherSourceAfter: null,
            error: null
        };
        try {
            if (!refreshStillApplicable(options)) return staleRefreshResult("stale-before-fetch");
            if (options.fallbackWhenKeyMissing === true && setup.AIRuntimeSettings && setup.AIRuntimeSettings.getStatus && !setup.AIRuntimeSettings.getStatus().hasKey) {
                stage = "weather-narration";
                lastWeatherDiagnostics.stage = stage;
                throw new Error("Weather narration has no OpenRouter API key; using the canonical fallback weather.");
            }
            const normalized = await fetchWeatherData(options.fetchImpl, function (nextStage) {
                stage = nextStage;
                if (lastWeatherDiagnostics) lastWeatherDiagnostics.stage = nextStage;
            });
            stage = "weather-narration";
            lastWeatherDiagnostics.stage = stage;
            const narrative = await narrateWeather(normalized, client);
            stage = "weather-commit";
            lastWeatherDiagnostics.stage = stage;
            if (!refreshStillApplicable(options)) return staleRefreshResult("stale-before-commit");
            env.weatherNarrative = narrative;
            env.weatherInitialized = true;
            env.weatherSource = "real_weather";
            const finishedAt = Date.now();
            lastWeatherDiagnostics = Object.assign(lastWeatherDiagnostics, {
                finishedAt: new Date(finishedAt).toISOString(),
                durationMs: Math.max(0, finishedAt - startedAt),
                ok: true,
                stage: "weather-commit",
                failedStage: null,
                fallbackUsed: false,
                weatherSourceAfter: env.weatherSource,
                normalized: clone(normalized),
                error: null
            });
            return { ok: true, value: { weatherNarrative: narrative, normalized: clone(normalized) } };
        } catch (error) {
            if (!refreshStillApplicable(options)) return staleRefreshResult("stale-after-failure");
            if (!env.weatherNarrative || !env.weatherNarrative.trim()) env.weatherNarrative = FALLBACK_WEATHER;
            env.weatherInitialized = true;
            if (!hadNarrative) env.weatherSource = "fallback";
            const finishedAt = Date.now();
            const failure = { code: "WEATHER_REFRESH_FAILED", message: error && error.message ? error.message : "Weather refresh failed." };
            lastWeatherDiagnostics = Object.assign(lastWeatherDiagnostics || {}, {
                finishedAt: new Date(finishedAt).toISOString(),
                durationMs: Math.max(0, finishedAt - startedAt),
                ok: false,
                stage: stage,
                failedStage: stage,
                fallbackUsed: true,
                weatherSourceAfter: env.weatherSource,
                error: clone(failure)
            });
            if (setup.EmergencyDiagnostics && typeof setup.EmergencyDiagnostics.recordError === "function") {
                setup.EmergencyDiagnostics.recordError("weather-refresh:" + stage, error);
            }
            return {
                ok: false,
                fallbackUsed: true,
                failedStage: stage,
                value: { weatherNarrative: env.weatherNarrative },
                error: failure
            };
        }
    }

    async function refreshWeather(client, options) {
        options = options && typeof options === "object" ? options : {};
        const inFlightKey = typeof options.inFlightKey === "string" && options.inFlightKey ? options.inFlightKey : "canonical";
        if (weatherInFlightByKey.has(inFlightKey)) return weatherInFlightByKey.get(inFlightKey);
        const request = performWeatherRefresh(client, options).finally(function () {
            if (weatherInFlightByKey.get(inFlightKey) === request) weatherInFlightByKey.delete(inFlightKey);
        });
        weatherInFlightByKey.set(inFlightKey, request);
        return request;
    }

    async function ensureWeatherInitialized(client, options) {
        const env = ensureShape();
        if (setup.Game && setup.Game.isPlayerSetupComplete && !setup.Game.isPlayerSetupComplete()) return { ok: false, skipped: true, value: { weatherNarrative: env.weatherNarrative }, error: { code: "PLAYER_SETUP_INCOMPLETE", message: "Weather narration waits until Traveler setup is complete." } };
        if (env.weatherInitialized === true) return { ok: true, skipped: true, value: { weatherNarrative: env.weatherNarrative } };
        const refreshOptions = Object.assign({}, options || {}, { fallbackWhenKeyMissing: true });
        return refreshWeather(client, refreshOptions);
    }

    setup.WorldEnvironment = {
        FALLBACK_WEATHER: FALLBACK_WEATHER,
        IP_GEOLOCATION_URL: IP_GEOLOCATION_URL,
        WEATHER_URL: WEATHER_URL,
        PHASE_LABELS: clone(PHASE_LABELS),
        ensureShape: ensureShape,
        getStatus: function () { return clone(ensureShape()); },
        getWeatherDiagnostics: function () { return clone(lastWeatherDiagnostics); },
        timeLabel: timeLabel,
        setTimePhase: setTimePhase,
        ensureWeatherInitialized: ensureWeatherInitialized,
        refreshWeather: refreshWeather,
        _normalizeWeather: normalizeWeather,
        _fetchWeatherData: fetchWeatherData
    };
}());
