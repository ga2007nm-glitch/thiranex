/* ==========================================================================
   WEATHER DASHBOARD — Asynchronous JavaScript & RESTful APIs
   --------------------------------------------------------------------------
   Data flow (one direction, async at the edge):

       input ──▶ fetch JSON ──▶ normalise ──▶ render()
                     │
                     └── any failure ──▶ showError()   (never a blank screen)

   Network layer: the native Fetch API driven by async/await.
     • Every await is wrapped in try/catch — a rejected promise (offline,
       DNS failure, CORS) is caught, not left as an unhandled rejection.
     • `response.ok` is checked explicitly, because fetch() only rejects on
       network errors — a 400 or 500 still resolves with a response object.
     • JSON parsing is guarded separately: a 200 with an HTML error page
       throws a SyntaxError inside response.json(), and we want a different
       message for that than for "no such city".
     • AbortController cancels a stale in-flight request when the user
       searches again, so a slow first response cannot overwrite a newer one.

   API: Open-Meteo (https://open-meteo.com) — free, no API key, CORS enabled.
     Geocoding:  /v1/search            (city name  -> latitude/longitude)
     Forecast:   /v1/forecast          (coords      -> nested weather JSON)
   ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     1. CONFIGURATION
     ======================================================================== */

  var GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

  var STORAGE_KEY = 'gagana.weather.recent';
  var MAX_RECENT = 5;
  var REFRESH_MS = 5 * 60 * 1000; // auto-refresh cadence
  var REQUEST_TIMEOUT_MS = 12000; // give up on a hanging socket

  /* Only the fields we actually render are requested — smaller payload,
     fewer surprises if the upstream shape ever changes. */
  var CURRENT_FIELDS = [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'is_day',
    'precipitation',
    'weather_code',
    'cloud_cover',
    'pressure_msl',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m'
  ].join(',');

  var HOURLY_FIELDS = [
    'temperature_2m',
    'weather_code',
    'precipitation_probability'
  ].join(',');

  var DAILY_FIELDS = ['sunrise', 'sunset', 'uv_index_max'].join(',');

  /* WMO weather interpretation codes -> label + glyph.
     Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes) */
  var WMO_CODES = {
    0:  { label: 'Clear sky',                     day: '\u2600\uFE0F', night: '\uD83C\uDF1F' },
    1:  { label: 'Mainly clear',                  day: '\uD83C\uDF24\uFE0F', night: '\uD83C\uDF1F' },
    2:  { label: 'Partly cloudy',                 day: '\u26C5',       night: '\u2601\uFE0F' },
    3:  { label: 'Overcast',                      day: '\u2601\uFE0F', night: '\u2601\uFE0F' },
    45: { label: 'Fog',                           day: '\uD83C\uDF2B\uFE0F', night: '\uD83C\uDF2B\uFE0F' },
    48: { label: 'Depositing rime fog',           day: '\uD83C\uDF2B\uFE0F', night: '\uD83C\uDF2B\uFE0F' },
    51: { label: 'Light drizzle',                 day: '\uD83C\uDF26\uFE0F', night: '\uD83C\uDF26\uFE0F' },
    53: { label: 'Moderate drizzle',              day: '\uD83C\uDF26\uFE0F', night: '\uD83C\uDF26\uFE0F' },
    55: { label: 'Dense drizzle',                 day: '\uD83C\uDF27\uFE0F', night: '\uD83C\uDF27\uFE0F' },
    56: { label: 'Light freezing drizzle',        day: '\uD83C\uDF28\uFE0F', night: '\uD83C\uDF28\uFE0F' },
    57: { label: 'Dense freezing drizzle',        day: '\uD83C\uDF28\uFE0F', night: '\uD83C\uDF28\uFE0F' },
    61: { label: 'Slight rain',                   day: '\uD83C\uDF26\uFE0F', night: '\uD83C\uDF26\uFE0F' },
    63: { label: 'Moderate rain',                 day: '\uD83C\uDF27\uFE0F', night: '\uD83C\uDF27\uFE0F' },
    65: { label: 'Heavy rain',                    day: '\uD83C\uDF27\uFE0F', night: '\uD83C\uDF27\uFE0F' },
    66: { label: 'Light freezing rain',           day: '\uD83C\uDF28\uFE0F', night: '\uD83C\uDF28\uFE0F' },
    67: { label: 'Heavy freezing rain',           day: '\uD83C\uDF28\uFE0F', night: '\uD83C\uDF28\uFE0F' },
    71: { label: 'Slight snow fall',              day: '\uD83C\uDF28\uFE0F', night: '\uD83C\uDF28\uFE0F' },
    73: { label: 'Moderate snow fall',            day: '\u2744\uFE0F', night: '\u2744\uFE0F' },
    75: { label: 'Heavy snow fall',               day: '\u2744\uFE0F', night: '\u2744\uFE0F' },
    77: { label: 'Snow grains',                   day: '\u2744\uFE0F', night: '\u2744\uFE0F' },
    80: { label: 'Slight rain showers',           day: '\uD83C\uDF26\uFE0F', night: '\uD83C\uDF26\uFE0F' },
    81: { label: 'Moderate rain showers',         day: '\uD83C\uDF27\uFE0F', night: '\uD83C\uDF27\uFE0F' },
    82: { label: 'Violent rain showers',          day: '\u26C8\uFE0F', night: '\u26C8\uFE0F' },
    85: { label: 'Slight snow showers',           day: '\uD83C\uDF28\uFE0F', night: '\uD83C\uDF28\uFE0F' },
    86: { label: 'Heavy snow showers',            day: '\u2744\uFE0F', night: '\u2744\uFE0F' },
    95: { label: 'Thunderstorm',                  day: '\u26C8\uFE0F', night: '\u26C8\uFE0F' },
    96: { label: 'Thunderstorm with slight hail', day: '\u26C8\uFE0F', night: '\u26C8\uFE0F' },
    99: { label: 'Thunderstorm with heavy hail',  day: '\u26C8\uFE0F', night: '\u26C8\uFE0F' }
  };

  /* ========================================================================
     2. DOM REFERENCES
     ======================================================================== */

  var el = {
    form: document.getElementById('weather-form'),
    input: document.getElementById('city-input'),
    submit: document.getElementById('weather-submit'),
    geo: document.getElementById('weather-geo'),
    status: document.getElementById('weather-status'),

    recentWrap: document.getElementById('weather-recent'),
    recentChips: document.getElementById('recent-chips'),

    panel: document.getElementById('results-panel'),
    loading: document.getElementById('weather-loading'),
    error: document.getElementById('weather-error'),
    errorTitle: document.getElementById('weather-error-title'),
    errorDetail: document.getElementById('weather-error-detail'),
    retry: document.getElementById('weather-retry'),
    empty: document.getElementById('weather-empty'),
    result: document.getElementById('weather-result'),

    place: document.getElementById('w-place'),
    meta: document.getElementById('w-meta'),
    condition: document.getElementById('w-condition'),
    emoji: document.getElementById('w-emoji'),
    temp: document.getElementById('w-temp'),
    feels: document.getElementById('w-feels'),

    humidity: document.getElementById('w-humidity'),
    humiditySub: document.getElementById('w-humidity-sub'),
    wind: document.getElementById('w-wind'),
    windSub: document.getElementById('w-wind-sub'),
    precip: document.getElementById('w-precip'),
    precipSub: document.getElementById('w-precip-sub'),
    pressure: document.getElementById('w-pressure'),
    pressureSub: document.getElementById('w-pressure-sub'),
    clouds: document.getElementById('w-clouds'),
    cloudsSub: document.getElementById('w-clouds-sub'),
    uv: document.getElementById('w-uv'),
    uvSub: document.getElementById('w-uv-sub'),

    sunrise: document.getElementById('w-sunrise'),
    sunset: document.getElementById('w-sunset'),
    daylight: document.getElementById('w-daylight'),
    hourly: document.getElementById('w-hourly'),
    updated: document.getElementById('w-updated')
  };

  /* ========================================================================
     3. STATE
     ======================================================================== */

  var state = {
    /* The last successfully resolved location — needed to auto-refresh and
       to retry without re-geocoding. */
    place: null,
    /* In-flight request controller, so a new search cancels the old one. */
    controller: null,
    refreshTimer: null
  };

  /* ========================================================================
     4. NETWORK LAYER — async/await over the Fetch API
     ======================================================================== */

  /**
   * Custom error carrying a user-facing message and a retry hint.
   * Distinguishing error *kinds* is what lets the UI say "check your
   * connection" instead of the useless "undefined is not a function".
   */
  function ApiError(message, kind) {
    this.name = 'ApiError';
    this.message = message;
    this.kind = kind || 'unknown';
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /**
   * Fetch + parse JSON with a timeout, cancellation and layered error
   * handling. Returns the parsed object or throws an ApiError.
   *
   * @param {string} url
   * @param {AbortSignal} signal - outer signal (cancels a superseded search)
   * @returns {Promise<object>}
   */
  async function fetchJSON(url, signal) {
    /* A per-request timeout controller, chained to the caller's signal so
       either one can abort the fetch. */
    var timeoutController = new AbortController();
    var timer = setTimeout(function () {
      timeoutController.abort();
    }, REQUEST_TIMEOUT_MS);

    if (signal) {
      if (signal.aborted) {
        timeoutController.abort();
      } else {
        signal.addEventListener('abort', function () {
          timeoutController.abort();
        }, { once: true });
      }
    }

    var response;
    try {
      /* The one and only network call. */
      response = await fetch(url, { signal: timeoutController.signal });
    } catch (error) {
      clearTimeout(timer);

      /* A superseded search is not an error — the caller checks for this. */
      if (error && error.name === 'AbortError') {
        if (signal && signal.aborted) {
          throw new ApiError('Search cancelled.', 'aborted');
        }
        throw new ApiError(
          'The request timed out after ' + (REQUEST_TIMEOUT_MS / 1000) + ' seconds.',
          'timeout'
        );
      }

      /* Everything else here is a transport-level failure: offline, DNS,
         CORS, blocked by an extension. fetch() rejects only in these cases. */
      throw new ApiError(
        'Could not reach the weather service. Check your internet connection and try again.',
        'network'
      );
    }
    clearTimeout(timer);

    /* fetch() resolves for 4xx/5xx too — `response.ok` is the real check. */
    if (!response.ok) {
      if (response.status === 429) {
        throw new ApiError(
          'The weather service is rate-limiting requests. Please wait a moment and try again.',
          'rate-limit'
        );
      }
      if (response.status >= 500) {
        throw new ApiError(
          'The weather service is temporarily unavailable (HTTP ' + response.status + ').',
          'server'
        );
      }
      throw new ApiError(
        'The weather service rejected the request (HTTP ' + response.status + ').',
        'client'
      );
    }

    /* Guard the parse separately: a 200 carrying malformed JSON throws a
       SyntaxError here, which is a different story from a failed request. */
    try {
      return await response.json();
    } catch (error) {
      throw new ApiError(
        'The weather service returned a response that could not be read.',
        'parse'
      );
    }
  }

  /**
   * Resolve a free-text city name to coordinates.
   * Also handles the "city exists but has no coordinates" edge case, which
   * Open-Meteo does emit for some administrative records.
   *
   * @param {string} cityName
   * @param {AbortSignal} signal
   * @returns {Promise<object>} normalised place object
   */
  async function geocodeCity(cityName, signal) {
    var url = GEOCODE_URL +
      '?name=' + encodeURIComponent(cityName) +
      '&count=1' +
      '&language=en' +
      '&format=json';

    var data = await fetchJSON(url, signal);

    /* Nested JSON guard #1: the `results` array is absent (not empty) when
       nothing matches, so `!data.results` is the correct test. */
    if (!data || !Array.isArray(data.results) || data.results.length === 0) {
      throw new ApiError(
        'No city named "' + cityName + '" was found. Check the spelling and try again.',
        'not-found'
      );
    }

    var hit = data.results[0];

    /* Nested JSON guard #2: coordinates must be finite numbers before they
       go anywhere near a query string. */
    if (typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number' ||
        !isFinite(hit.latitude) || !isFinite(hit.longitude)) {
      throw new ApiError(
        'Found "' + cityName + '" but it has no usable coordinates.',
        'bad-payload'
      );
    }

    /* Flatten the parts we care about into a stable shape. */
    var parts = [hit.name];
    if (hit.admin1 && hit.admin1 !== hit.name) { parts.push(hit.admin1); }
    if (hit.country) { parts.push(hit.country); }

    return {
      name: hit.name || cityName,
      label: parts.join(', '),
      country: hit.country || '',
      countryCode: hit.country_code || '',
      timezone: hit.timezone || 'auto',
      latitude: hit.latitude,
      longitude: hit.longitude
    };
  }

  /**
   * Fetch current + hourly + daily conditions for a coordinate pair.
   *
   * @param {object} place - normalised place from geocodeCity()
   * @param {AbortSignal} signal
   * @returns {Promise<object>} the raw nested payload
   */
  async function fetchForecast(place, signal) {
    var url = FORECAST_URL +
      '?latitude=' + place.latitude +
      '&longitude=' + place.longitude +
      '&current=' + CURRENT_FIELDS +
      '&hourly=' + HOURLY_FIELDS +
      '&daily=' + DAILY_FIELDS +
      '&timezone=' + encodeURIComponent(place.timezone || 'auto') +
      '&forecast_days=2';

    var data = await fetchJSON(url, signal);

    /* Validate the shape we are about to destructure. Without this, a
       changed upstream contract surfaces as "Cannot read properties of
       undefined" deep inside the renderer. */
    if (!data || typeof data !== 'object' || !data.current) {
      throw new ApiError(
        'The weather service returned an unexpected data shape.',
        'bad-payload'
      );
    }

    return data;
  }

  /**
   * The full pipeline for one search: geocode -> forecast -> render.
   * Every await can throw an ApiError; this function catches them all and
   * routes them to the error UI. This is the single place the UI learns
   * that a request failed.
   */
  async function loadWeather(cityName) {
    var query = String(cityName || '').trim();

    if (!query) {
      showError('Please enter a city name.', 'Nothing to search for.');
      el.input.focus();
      return;
    }

    /* Cancel any request still in flight from a previous search. */
    if (state.controller) { state.controller.abort(); }
    state.controller = new AbortController();
    var signal = state.controller.signal;

    setLoading(true);
    clearError();
    setStatus('Fetching live weather for ' + query + '\u2026');

    try {
      /* Two sequential awaits, both over the network. Sequential is
         required — the forecast needs the coordinates from the geocode. */
      var place = await geocodeCity(query, signal);
      var payload = await fetchForecast(place, signal);

      /* The user may have searched again while this was resolving. */
      if (signal.aborted) { return; }

      state.place = place;
      renderWeather(place, payload);
      rememberCity(place);
      setLoading(false);
      setStatus('Showing live weather for ' + place.label + '.');
      scheduleRefresh();

    } catch (error) {
      /* A cancellation is expected behaviour, not a failure to report. */
      if (error && error.kind === 'aborted') { return; }

      setLoading(false);
      showError(errorTitleFor(error), error.message);

      /* Keep the user's text so they can correct a typo rather than retype. */
      if (error && error.kind === 'not-found') {
        el.input.select();
      }
    }
  }

  /**
   * Load weather for raw coordinates (used by "Use My Location", where the
   * geocoding step is replaced by reverse-geocoded browser coordinates).
   */
  async function loadWeatherByCoords(lat, lon, label) {
    if (state.controller) { state.controller.abort(); }
    state.controller = new AbortController();
    var signal = state.controller.signal;

    setLoading(true);
    clearError();
    setStatus('Fetching live weather for your location\u2026');

    var place = {
      name: label || 'My location',
      label: label || 'My location',
      country: '',
      countryCode: '',
      timezone: 'auto',
      latitude: lat,
      longitude: lon
    };

    try {
      var payload = await fetchForecast(place, signal);
      if (signal.aborted) { return; }

      state.place = place;
      renderWeather(place, payload);
      setLoading(false);
      setStatus('Showing live weather for ' + place.label + '.');
      scheduleRefresh();
    } catch (error) {
      if (error && error.kind === 'aborted') { return; }
      setLoading(false);
      showError(errorTitleFor(error), error.message);
    }
  }

  /** Map an error kind to a short heading. */
  function errorTitleFor(error) {
    var kind = error && error.kind;
    if (kind === 'network')    { return 'Connection problem'; }
    if (kind === 'timeout')    { return 'Request timed out'; }
    if (kind === 'not-found')  { return 'City not found'; }
    if (kind === 'rate-limit') { return 'Too many requests'; }
    if (kind === 'server')     { return 'Service unavailable'; }
    if (kind === 'parse' || kind === 'bad-payload') { return 'Unexpected data'; }
    return 'Something went wrong';
  }

  /* ========================================================================
     5. VIEW HELPERS — state toggles & formatting
     ======================================================================== */

  function setLoading(isLoading) {
    el.loading.hidden = !isLoading;
    el.panel.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    el.submit.disabled = isLoading;
    el.submit.textContent = isLoading ? 'Loading\u2026' : 'Get Weather';

    if (isLoading) {
      el.empty.hidden = true;
      el.result.hidden = true;
      el.error.hidden = true;
    }
  }

  function showError(title, detail) {
    el.errorTitle.textContent = title;
    el.errorDetail.textContent = detail;
    el.error.hidden = false;
    el.empty.hidden = true;
    el.result.hidden = true;
    el.loading.hidden = true;
    el.panel.setAttribute('aria-busy', 'false');

    /* Offer a retry only when retrying could plausibly help. */
    el.retry.hidden = !state.place && !el.input.value.trim();
  }

  function clearError() {
    el.error.hidden = true;
    el.errorDetail.textContent = '';
  }

  function setStatus(message) {
    el.status.textContent = message;
    el.status.classList.remove('is-error');
  }

  /* --- Formatters --------------------------------------------------------- */

  /** Round to a fixed number of decimals, tolerating null/undefined/NaN. */
  function num(value, decimals) {
    if (value === null || value === undefined) { return null; }
    var n = Number(value);
    if (!isFinite(n)) { return null; }
    return n.toFixed(decimals === undefined ? 1 : decimals);
  }

  /** "23.4 °C" or a dash when the value is missing. */
  function temp(value) {
    var v = num(value, 1);
    return v === null ? '\u2014' : v + '\u00A0\u00B0C';
  }

  function percent(value) {
    var v = num(value, 0);
    return v === null ? '\u2014' : v + '\u00A0%';
  }

  function kmh(value) {
    var v = num(value, 1);
    return v === null ? '\u2014' : v + '\u00A0km/h';
  }

  function mm(value) {
    var v = num(value, 2);
    return v === null ? '\u2014' : v + '\u00A0mm';
  }

  function hpa(value) {
    var v = num(value, 0);
    return v === null ? '\u2014' : v + '\u00A0hPa';
  }

  /** Compass point from a bearing in degrees. */
  function compass(degrees) {
    var d = Number(degrees);
    if (!isFinite(d)) { return ''; }
    var points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return points[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  }

  /** UV index -> descriptive band. */
  function uvBand(value) {
    var v = Number(value);
    if (!isFinite(v)) { return ''; }
    if (v < 3)  { return 'Low'; }
    if (v < 6)  { return 'Moderate'; }
    if (v < 8)  { return 'High'; }
    if (v < 11) { return 'Very high'; }
    return 'Extreme';
  }

  /** "6:12 AM" from an ISO local-time string like "2026-09-27T06:12". */
  function clockTime(isoString) {
    if (!isoString) { return '\u2014'; }
    var date = new Date(isoString);
    if (isNaN(date.getTime())) { return '\u2014'; }
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /** "7h 22m" between two ISO local-time strings. */
  function durationBetween(startIso, endIso) {
    var start = new Date(startIso);
    var end = new Date(endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) { return '\u2014'; }
    var minutes = Math.round((end - start) / 60000);
    if (minutes < 0) { return '\u2014'; }
    var hours = Math.floor(minutes / 60);
    return hours + 'h\u00A0' + (minutes % 60) + 'm';
  }

  /** Short hour label from an ISO local-time string, e.g. "14:00" -> "2 PM". */
  function hourLabel(isoString) {
    var date = new Date(isoString);
    if (isNaN(date.getTime())) { return '\u2014'; }
    return date.toLocaleTimeString([], { hour: 'numeric' });
  }

  /** Look up the WMO descriptor, falling back to a neutral entry. */
  function describeCode(code, isDay) {
    var entry = WMO_CODES[code] || { label: 'Unknown conditions', day: '\uD83C\uDF24\uFE0F', night: '\uD83C\uDF1F' };
    return {
      label: entry.label,
      glyph: isDay ? entry.day : entry.night
    };
  }

  /* ========================================================================
     6. RENDER — nested JSON in, DOM out
     ======================================================================== */

  /**
   * Take the deeply nested forecast payload and paint every metric.
   * All reads are defensive: a missing branch degrades to a dash instead of
   * throwing and blanking the whole dashboard.
   */
  function renderWeather(place, payload) {
    /* Nested path: payload.current.* — the headline metrics. */
    var current = payload.current || {};
    /* Nested path: payload.hourly.* — parallel arrays of the same length. */
    var hourly = payload.hourly || {};
    /* Nested path: payload.daily.* — arrays with one entry per day. */
    var daily = payload.daily || {};

    var isDay = current.is_day !== 0;
    var code = describeCode(current.weather_code, isDay);

    /* --- Location & condition ------------------------------------------- */
    el.place.textContent = place.label;
    el.meta.textContent =
      (place.latitude !== undefined
        ? Math.abs(place.latitude).toFixed(2) + '\u00B0 ' + (place.latitude >= 0 ? 'N' : 'S')
        : '\u2014') +
      ' \u00B7 ' +
      (place.longitude !== undefined
        ? Math.abs(place.longitude).toFixed(2) + '\u00B0 ' + (place.longitude >= 0 ? 'E' : 'W')
        : '\u2014') +
      (payload.timezone ? ' \u00B7 ' + payload.timezone : '');
    el.condition.textContent = code.label;

    /* --- Temperature ----------------------------------------------------- */
    el.emoji.textContent = code.glyph;
    el.temp.textContent = temp(current.temperature_2m);
    el.feels.textContent = 'Feels like ' + temp(current.apparent_temperature);

    /* --- Metric grid ------------------------------------------------------ */
    el.humidity.textContent = percent(current.relative_humidity_2m);
    el.humiditySub.textContent = humidityNote(current.relative_humidity_2m);

    el.wind.textContent = kmh(current.wind_speed_10m);
    el.windSub.textContent = current.wind_direction_10m !== undefined
      ? 'From ' + compass(current.wind_direction_10m) + ' (' + num(current.wind_direction_10m, 0) + '\u00B0)' +
        (current.wind_gusts_10m !== undefined ? ' \u00B7 gusts ' + kmh(current.wind_gusts_10m) : '')
      : '\u2014';

    el.precip.textContent = mm(current.precipitation);
    el.precipSub.textContent = precipNote(hourly, payload.current && payload.current.time);

    el.pressure.textContent = hpa(current.pressure_msl);
    el.pressureSub.textContent = pressureNote(current.pressure_msl);

    el.clouds.textContent = percent(current.cloud_cover);
    el.cloudsSub.textContent = cloudNote(current.cloud_cover);

    var uv = daily.uv_index_max && daily.uv_index_max.length ? daily.uv_index_max[0] : null;
    el.uv.textContent = uv === null || uv === undefined ? '\u2014' : num(uv, 1);
    el.uvSub.textContent = uvBand(uv) || '\u2014';

    /* --- Sun strip (daily arrays) ---------------------------------------- */
    var sunrise = daily.sunrise && daily.sunrise.length ? daily.sunrise[0] : null;
    var sunset = daily.sunset && daily.sunset.length ? daily.sunset[0] : null;

    el.sunrise.textContent = clockTime(sunrise);
    el.sunset.textContent = clockTime(sunset);
    el.daylight.textContent = durationBetween(sunrise, sunset);

    /* --- Hourly strip (parallel arrays zipped by index) ------------------- */
    renderHourly(hourly, current.time, isDay);

    /* --- Timestamp -------------------------------------------------------- */
    var now = new Date();
    el.updated.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.updated.setAttribute('datetime', now.toISOString());

    /* --- Reveal ----------------------------------------------------------- */
    el.empty.hidden = true;
    el.error.hidden = true;
    el.result.hidden = false;
    el.panel.setAttribute('aria-busy', 'false');
  }

  /**
   * Build the 24-hour strip by zipping `hourly.time[]` with the parallel
   * `hourly.temperature_2m[]` and `hourly.weather_code[]` arrays.
   * We start at the index matching the current observation time.
   */
  function renderHourly(hourly, currentTime, isDay) {
    el.hourly.textContent = '';

    var times = hourly.time;
    if (!Array.isArray(times) || times.length === 0) {
      var fallback = document.createElement('li');
      fallback.className = 'hourly-item hourly-item--empty';
      fallback.textContent = 'Hourly data unavailable.';
      el.hourly.appendChild(fallback);
      return;
    }

    /* Align the strip with "now" rather than the start of the day. */
    var startIndex = 0;
    if (currentTime) {
      var currentHour = String(currentTime).slice(0, 13); // "YYYY-MM-DDTHH"
      for (var i = 0; i < times.length; i++) {
        if (String(times[i]).slice(0, 13) === currentHour) {
          startIndex = i;
          break;
        }
      }
    }

    var fragment = document.createDocumentFragment();
    var end = Math.min(startIndex + 24, times.length);

    for (var index = startIndex; index < end; index++) {
      /* Parallel-array read: same index, different branch of the payload. */
      var temperature = hourly.temperature_2m ? hourly.temperature_2m[index] : null;
      var hourCode = hourly.weather_code ? hourly.weather_code[index] : null;
      var rainChance = hourly.precipitation_probability
        ? hourly.precipitation_probability[index]
        : null;

      var hourDate = new Date(times[index]);
      var hourIsDay = !isNaN(hourDate.getTime())
        ? (hourDate.getHours() >= 6 && hourDate.getHours() < 18)
        : isDay;
      var descriptor = describeCode(hourCode, hourIsDay);

      var item = document.createElement('li');
      item.className = 'hourly-item';
      if (index === startIndex) { item.classList.add('is-now'); }

      var timeSpan = document.createElement('span');
      timeSpan.className = 'hourly-time';
      timeSpan.textContent = index === startIndex ? 'Now' : hourLabel(times[index]);

      var glyphSpan = document.createElement('span');
      glyphSpan.className = 'hourly-glyph';
      glyphSpan.setAttribute('aria-hidden', 'true');
      glyphSpan.textContent = descriptor.glyph;

      var tempSpan = document.createElement('span');
      tempSpan.className = 'hourly-temp';
      tempSpan.textContent = temp(temperature);

      var rainSpan = document.createElement('span');
      rainSpan.className = 'hourly-rain';
      rainSpan.textContent = rainChance === null || rainChance === undefined
        ? ''
        : num(rainChance, 0) + '\u00A0% rain';

      /* The glyph is decorative, so the accessible name is assembled here. */
      item.setAttribute('aria-label',
        (index === startIndex ? 'Now' : hourLabel(times[index])) + ': ' +
        descriptor.label + ', ' + temp(temperature));

      item.appendChild(timeSpan);
      item.appendChild(glyphSpan);
      item.appendChild(tempSpan);
      item.appendChild(rainSpan);
      fragment.appendChild(item);
    }

    el.hourly.appendChild(fragment);
  }

  /* --- Small interpretive notes ------------------------------------------- */

  function humidityNote(value) {
    var v = Number(value);
    if (!isFinite(v)) { return '\u2014'; }
    if (v < 30) { return 'Dry air'; }
    if (v < 60) { return 'Comfortable'; }
    if (v < 80) { return 'Humid'; }
    return 'Very humid';
  }

  function pressureNote(value) {
    var v = Number(value);
    if (!isFinite(v)) { return '\u2014'; }
    if (v < 1000) { return 'Low \u2014 unsettled'; }
    if (v > 1020) { return 'High \u2014 settled'; }
    return 'Normal range';
  }

  function cloudNote(value) {
    var v = Number(value);
    if (!isFinite(v)) { return '\u2014'; }
    if (v < 20) { return 'Mostly clear'; }
    if (v < 60) { return 'Partly cloudy'; }
    if (v < 90) { return 'Mostly cloudy'; }
    return 'Overcast';
  }

  /** Peak rain chance across the next 12 hours, read from the hourly arrays. */
  function precipNote(hourly, currentTime) {
    var chances = hourly && hourly.precipitation_probability;
    var times = hourly && hourly.time;
    if (!Array.isArray(chances) || !Array.isArray(times) || chances.length === 0) {
      return '\u2014';
    }

    var startIndex = 0;
    if (currentTime) {
      var currentHour = String(currentTime).slice(0, 13);
      for (var i = 0; i < times.length; i++) {
        if (String(times[i]).slice(0, 13) === currentHour) { startIndex = i; break; }
      }
    }

    var peak = 0;
    var end = Math.min(startIndex + 12, chances.length);
    for (var j = startIndex; j < end; j++) {
      var value = Number(chances[j]);
      if (isFinite(value) && value > peak) { peak = value; }
    }
    return peak > 0 ? 'Peak ' + peak + '\u00A0% next 12h' : 'No rain expected';
  }

  /* ========================================================================
     7. RECENT CITIES (localStorage)
     ======================================================================== */

  function readRecent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      /* Corrupt or blocked storage must never break the app. */
      return [];
    }
  }

  function rememberCity(place) {
    var list = readRecent().filter(function (entry) {
      return entry.name.toLowerCase() !== place.name.toLowerCase();
    });
    list.unshift({ name: place.name, label: place.label });
    list = list.slice(0, MAX_RECENT);

    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (error) {}
    renderRecent(list);
  }

  function renderRecent(list) {
    var entries = list || readRecent();
    el.recentChips.textContent = '';

    if (entries.length === 0) {
      el.recentWrap.hidden = true;
      return;
    }

    entries.forEach(function (entry) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = entry.name;
      chip.title = entry.label || entry.name;
      chip.addEventListener('click', function () {
        el.input.value = entry.name;
        loadWeather(entry.name);
      });
      el.recentChips.appendChild(chip);
    });

    el.recentWrap.hidden = false;
  }

  /* ========================================================================
     8. AUTO-REFRESH
     Keeps the dashboard genuinely "real-time" without the user re-searching.
     ======================================================================== */

  function scheduleRefresh() {
    if (state.refreshTimer) { clearTimeout(state.refreshTimer); }
    if (!state.place) { return; }

    state.refreshTimer = setTimeout(function () {
      /* Silent background refresh: no loading spinner, so the dashboard
         never flashes. A failure here leaves the last good data on screen. */
      if (state.place) { loadWeather(state.place.name); }
    }, REFRESH_MS);
  }

  /* ========================================================================
     9. EVENTS
     ======================================================================== */

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    loadWeather(el.input.value);
  });

  /* Retry re-runs whichever search last had a target. */
  el.retry.addEventListener('click', function () {
    var target = el.input.value.trim() || (state.place && state.place.name);
    if (target) { loadWeather(target); }
  });

  /* Geolocation is optional and heavily permission-gated — every failure
     branch gets a plain-language message. */
  el.geo.addEventListener('click', function () {
    if (!navigator.geolocation) {
      showError('Location unavailable', 'This browser does not support geolocation. Please search by city name instead.');
      return;
    }

    setStatus('Requesting your location\u2026');
    el.geo.disabled = true;

    navigator.geolocation.getCurrentPosition(
      function (position) {
        el.geo.disabled = false;
        var coords = position.coords;
        loadWeatherByCoords(
          Number(coords.latitude.toFixed(4)),
          Number(coords.longitude.toFixed(4)),
          'My location'
        );
      },
      function (error) {
        el.geo.disabled = false;
        var message = 'Could not determine your location.';
        if (error && error.code === 1) {
          message = 'Location permission was denied. Search by city name instead.';
        } else if (error && error.code === 2) {
          message = 'Your location is currently unavailable. Try searching by city name.';
        } else if (error && error.code === 3) {
          message = 'Locating you took too long. Try searching by city name.';
        }
        showError('Location unavailable', message);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });

  /* Pause the refresh loop while the tab is hidden; refresh on return. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (state.refreshTimer) { clearTimeout(state.refreshTimer); state.refreshTimer = null; }
    } else if (state.place) {
      loadWeather(state.place.name);
    }
  });

  /* ========================================================================
     10. BOOT
     ======================================================================== */

  (function init() {
    renderRecent();

    /* Offer something immediately rather than an empty dashboard. */
    var lastCity = null;
    try { lastCity = localStorage.getItem('gagana.weather.last'); } catch (error) {}

    if (lastCity) {
      el.input.value = lastCity;
      loadWeather(lastCity);
    } else {
      el.empty.hidden = false;
      setStatus('Search for a city to begin.');
    }
  })();

  /* Remember the last city on a successful load, for the next visit. */
  var originalRender = renderWeather;
  renderWeather = function (place, payload) {
    originalRender(place, payload);
    try { localStorage.setItem('gagana.weather.last', place.name); } catch (error) {}
  };

})();