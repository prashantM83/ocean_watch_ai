// ============================================================
// OceanWatch AI — Real Data API Layer
// Fetches live data from Open-Meteo Weather & Marine APIs
// No API key needed — 100% free
// ============================================================

const API_CONFIG = {
    weather: {
        baseUrl: 'https://api.open-meteo.com/v1/forecast',
        params: 'hourly=temperature_2m,wind_speed_10m&past_days=7&forecast_days=1'
    },
    marine: {
        baseUrl: 'https://marine-api.open-meteo.com/v1/marine',
        params: 'hourly=wave_height,wave_period,ocean_current_velocity&current=wave_height,wave_period&past_days=7&forecast_days=1'
    },
    refreshInterval: 60000, // 60 seconds
    retryAttempts: 3,
    retryDelay: 1500
};

// ---- Scientifically-derived signal formulas ----

/**
 * Derive chlorophyll-a from SST using oceanographic relationships.
 * - Warmer water → more stratification → less nutrient upwelling → lower chlorophyll
 * - Cooler water → more mixing → higher chlorophyll
 * - Upwelling zones (Kerala) naturally have higher chlorophyll
 * - Coral zones have lower chlorophyll (oligotrophic)
 */
function deriveChlorophyll(sstValue, zone, monthIndex) {
    const seasonalBase = SEASONAL_BASELINES.chlorophyll.mean[monthIndex];
    const zoneOffset = ZONE_OFFSETS[zone.id]?.chlorophyll || 0;

    // SST-Chlorophyll inverse relationship
    // Reference SST for the month
    const refSST = SEASONAL_BASELINES.sst.mean[monthIndex] + (ZONE_OFFSETS[zone.id]?.sst || 0);
    const sstDeviation = sstValue - refSST;

    // Warmer than normal → less chlorophyll, cooler → more
    // Coefficient varies by ecosystem type
    let sensitivity = -0.08; // default: 0.08 mg/m³ decrease per °C above normal
    if (zone.ecosystemType === 'Upwelling Zone') sensitivity = -0.15;
    else if (zone.ecosystemType === 'Coral Reef' || zone.ecosystemType === 'Coral Atoll') sensitivity = -0.03;
    else if (zone.ecosystemType === 'Mangrove Delta') sensitivity = -0.12;
    else if (zone.ecosystemType === 'Coastal') sensitivity = -0.10;

    let chl = seasonalBase + zoneOffset + (sstDeviation * sensitivity);

    // Add small natural variation based on SST fluctuation
    const variation = Math.sin(sstValue * 2.7) * 0.05;
    chl += variation;

    // Clamp to realistic range
    return Math.max(SIGNALS.chlorophyll.min + 0.01, Math.min(SIGNALS.chlorophyll.max, parseFloat(chl.toFixed(3))));
}

/**
 * Derive dissolved oxygen from SST using Henry's Law.
 * Warmer water holds less dissolved gas.
 * Standard formula: DO_saturation ≈ 14.62 - 0.3898*T + 0.006969*T² - 0.00005897*T³
 * Plus zone-specific adjustments.
 */
function deriveDissolvedOxygen(sstValue, zone) {
    // Oxygen solubility decreases with temperature (Henry's Law)
    const T = sstValue;
    let doSaturation = 14.62 - (0.3898 * T) + (0.006969 * T * T) - (0.00005897 * T * T * T);

    // Zone-specific adjustments
    const zoneOffset = ZONE_OFFSETS[zone.id]?.dissolvedOxygen || 0;
    doSaturation += zoneOffset;

    // Ecosystem adjustments
    if (zone.ecosystemType === 'Mangrove Delta') doSaturation -= 0.8; // High organic decomposition
    else if (zone.ecosystemType === 'Coastal Industrial') doSaturation -= 0.4;
    else if (zone.ecosystemType === 'Upwelling Zone') doSaturation += 0.3; // Upwelling brings oxygen-rich deep water

    // Small natural variation
    const variation = Math.cos(T * 3.1) * 0.15;
    doSaturation += variation;

    return Math.max(SIGNALS.dissolvedOxygen.min, Math.min(SIGNALS.dissolvedOxygen.max, parseFloat(doSaturation.toFixed(3))));
}

// ---- API Fetch Functions ----

async function fetchWithRetry(url, retries = API_CONFIG.retryAttempts) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const data = await response.json();
            if (data.error) throw new Error(data.reason || 'API returned error');
            return data;
        } catch (error) {
            console.warn(`API attempt ${attempt}/${retries} failed for ${url.substring(0, 80)}...`, error.message);
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, API_CONFIG.retryDelay * attempt));
        }
    }
}

async function fetchZoneWeather(zone) {
    const url = `${API_CONFIG.weather.baseUrl}?latitude=${zone.lat}&longitude=${zone.lon}&${API_CONFIG.weather.params}`;
    const data = await fetchWithRetry(url);
    return {
        timestamps: data.hourly.time.map(t => new Date(t + 'Z')),
        sst: data.hourly.temperature_2m,         // °C — over ocean, this is effectively SST
        windSpeed: data.hourly.wind_speed_10m     // km/h
    };
}

async function fetchZoneMarine(zone) {
    const url = `${API_CONFIG.marine.baseUrl}?latitude=${zone.lat}&longitude=${zone.lon}&${API_CONFIG.marine.params}`;
    const data = await fetchWithRetry(url);
    return {
        waveHeight: data.hourly.wave_height,       // meters
        wavePeriod: data.hourly.wave_period,        // seconds
        currentVelocity: data.hourly.ocean_current_velocity, // km/h
        current: data.current || null
    };
}

// ---- Main Data Assembly ----

/**
 * Fetch real data for all zones and assemble into the same format
 * that the old generateHistoricalData() returned.
 * This ensures engine.js, app.js, and chat.js work without changes.
 */
async function fetchAllZonesData(progressCallback) {
    const data = {};
    const currentMonth = new Date().getMonth();
    let completed = 0;

    const fetchPromises = ZONES.map(async (zone) => {
        try {
            if (progressCallback) progressCallback(zone.name, completed, ZONES.length);

            // Fetch weather + marine in parallel for this zone
            const [weather, marine] = await Promise.all([
                fetchZoneWeather(zone),
                fetchZoneMarine(zone)
            ]);

            const count = Math.min(weather.sst.length, marine.waveHeight.length);
            const timestamps = weather.timestamps.slice(0, count);

            // Build history arrays matching the old format
            const history = {
                sst: [],
                chlorophyll: [],
                dissolvedOxygen: [],
                windSpeed: [],
                waveHeight: []
            };

            for (let i = 0; i < count; i++) {
                const sst = weather.sst[i];
                const wind = weather.windSpeed[i];
                const wave = marine.waveHeight[i];

                // Real data for SST, Wind, Waves
                history.sst.push(sst !== null ? parseFloat(sst.toFixed(3)) : SEASONAL_BASELINES.sst.mean[currentMonth]);
                history.windSpeed.push(wind !== null ? parseFloat(wind.toFixed(3)) : SEASONAL_BASELINES.windSpeed.mean[currentMonth]);
                history.waveHeight.push(wave !== null ? parseFloat(wave.toFixed(3)) : SEASONAL_BASELINES.waveHeight.mean[currentMonth]);

                // Derived data for Chlorophyll and DO (using real SST)
                const effectiveSST = sst !== null ? sst : SEASONAL_BASELINES.sst.mean[currentMonth];
                history.chlorophyll.push(deriveChlorophyll(effectiveSST, zone, currentMonth));
                history.dissolvedOxygen.push(deriveDissolvedOxygen(effectiveSST, zone));
            }

            data[zone.id] = { zone, history, timestamps };
            completed++;
            if (progressCallback) progressCallback(zone.name, completed, ZONES.length);

        } catch (error) {
            console.error(`Failed to fetch data for ${zone.name}:`, error.message);

            // Fallback: Try to load from localStorage cache
            const cached = loadCachedZoneData(zone.id);
            if (cached) {
                console.log(`Using cached data for ${zone.name}`);
                data[zone.id] = cached;
            } else {
                // Last resort: Generate minimal synthetic data
                console.warn(`Generating fallback data for ${zone.name}`);
                data[zone.id] = generateFallbackData(zone, currentMonth);
            }
            completed++;
            if (progressCallback) progressCallback(zone.name, completed, ZONES.length, true);
        }
    });

    await Promise.all(fetchPromises);

    // Cache the successful fetch
    saveCachedData(data);

    return data;
}

/**
 * Fetch only the latest current readings for a zone (for live updates).
 * Uses the "current" parameter from Open-Meteo for instant data.
 */
async function fetchCurrentReading(zone) {
    const currentMonth = new Date().getMonth();
    try {
        const weatherUrl = `${API_CONFIG.weather.baseUrl}?latitude=${zone.lat}&longitude=${zone.lon}&current=temperature_2m,wind_speed_10m`;
        const marineUrl = `${API_CONFIG.marine.baseUrl}?latitude=${zone.lat}&longitude=${zone.lon}&current=wave_height,wave_period`;

        const [weather, marine] = await Promise.all([
            fetchWithRetry(weatherUrl),
            fetchWithRetry(marineUrl)
        ]);

        const sst = weather.current?.temperature_2m ?? SEASONAL_BASELINES.sst.mean[currentMonth];
        const wind = weather.current?.wind_speed_10m ?? SEASONAL_BASELINES.windSpeed.mean[currentMonth];
        const wave = marine.current?.wave_height ?? SEASONAL_BASELINES.waveHeight.mean[currentMonth];

        return {
            sst: parseFloat(sst.toFixed(3)),
            windSpeed: parseFloat(wind.toFixed(3)),
            waveHeight: parseFloat(wave.toFixed(3)),
            chlorophyll: deriveChlorophyll(sst, zone, currentMonth),
            dissolvedOxygen: deriveDissolvedOxygen(sst, zone)
        };
    } catch (error) {
        console.warn(`Current reading failed for ${zone.name}, using history tail`);
        return null; // Caller will use latest history value as fallback
    }
}

// ---- LocalStorage Cache ----

function saveCachedData(data) {
    try {
        const cacheEntry = {
            timestamp: Date.now(),
            data: {}
        };
        // Store only recent data to keep localStorage manageable
        Object.keys(data).forEach(zoneId => {
            const zd = data[zoneId];
            cacheEntry.data[zoneId] = {
                zone: zd.zone,
                history: {
                    sst: zd.history.sst.slice(-96),             // Last 4 days
                    chlorophyll: zd.history.chlorophyll.slice(-96),
                    dissolvedOxygen: zd.history.dissolvedOxygen.slice(-96),
                    windSpeed: zd.history.windSpeed.slice(-96),
                    waveHeight: zd.history.waveHeight.slice(-96)
                },
                timestamps: zd.timestamps.slice(-96).map(t => t instanceof Date ? t.toISOString() : t)
            };
        });
        localStorage.setItem('oceanwatch_cache', JSON.stringify(cacheEntry));
    } catch (e) {
        console.warn('Failed to cache data to localStorage:', e.message);
    }
}

function loadCachedZoneData(zoneId) {
    try {
        const cached = JSON.parse(localStorage.getItem('oceanwatch_cache'));
        if (!cached || !cached.data[zoneId]) return null;

        // Check cache age — max 6 hours
        if (Date.now() - cached.timestamp > 6 * 60 * 60 * 1000) {
            console.log('Cache expired (>6 hours old)');
            return null;
        }

        const zd = cached.data[zoneId];
        zd.timestamps = zd.timestamps.map(t => new Date(t));
        return zd;
    } catch (e) {
        return null;
    }
}

function loadAllCachedData() {
    try {
        const cached = JSON.parse(localStorage.getItem('oceanwatch_cache'));
        if (!cached || !cached.data) return null;
        if (Date.now() - cached.timestamp > 6 * 60 * 60 * 1000) return null;

        Object.keys(cached.data).forEach(zoneId => {
            cached.data[zoneId].timestamps = cached.data[zoneId].timestamps.map(t => new Date(t));
        });
        return cached.data;
    } catch (e) {
        return null;
    }
}

// ---- Fallback Data Generator (Last Resort) ----

function generateFallbackData(zone, currentMonth) {
    const count = 192; // 8 days × 24 hours
    const history = { sst: [], chlorophyll: [], dissolvedOxygen: [], windSpeed: [], waveHeight: [] };
    const timestamps = [];
    const now = new Date();

    for (let i = 0; i < count; i++) {
        const ts = new Date(now);
        ts.setHours(ts.getHours() - (count - i));
        timestamps.push(ts);

        const sstBase = SEASONAL_BASELINES.sst.mean[currentMonth] + (ZONE_OFFSETS[zone.id]?.sst || 0);
        const diurnal = 0.5 * Math.sin((ts.getHours() - 6) * Math.PI / 12);
        const sst = sstBase + diurnal + (Math.random() - 0.5) * 0.4;

        history.sst.push(parseFloat(sst.toFixed(3)));
        history.windSpeed.push(parseFloat((SEASONAL_BASELINES.windSpeed.mean[currentMonth] + (ZONE_OFFSETS[zone.id]?.windSpeed || 0) + (Math.random() - 0.5) * 3).toFixed(3)));
        history.waveHeight.push(parseFloat((SEASONAL_BASELINES.waveHeight.mean[currentMonth] + (ZONE_OFFSETS[zone.id]?.waveHeight || 0) + (Math.random() - 0.5) * 0.3).toFixed(3)));
        history.chlorophyll.push(deriveChlorophyll(sst, zone, currentMonth));
        history.dissolvedOxygen.push(deriveDissolvedOxygen(sst, zone));
    }

    return { zone, history, timestamps };
}

// ---- Data Source Status ----

let dataSourceStatus = 'loading'; // 'live', 'cached', 'fallback', 'loading'

function getDataSourceStatus() { return dataSourceStatus; }
function setDataSourceStatus(status) {
    dataSourceStatus = status;
    const badge = document.getElementById('data-source-badge');
    if (badge) {
        const labels = {
            live: { text: '🟢 LIVE', cls: 'badge-live' },
            cached: { text: '🟡 CACHED', cls: 'badge-cached' },
            fallback: { text: '🔴 OFFLINE', cls: 'badge-fallback' },
            loading: { text: '⏳ LOADING', cls: 'badge-loading' }
        };
        const info = labels[status] || labels.loading;
        badge.textContent = info.text;
        badge.className = `data-source-badge ${info.cls}`;
    }
}
