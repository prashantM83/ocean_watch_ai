// ============================================================
// OceanWatch AI — Data Layer
// Zone definitions, seasonal baselines, historical data generation
// ============================================================

const ZONES = [
    { id: 'zone-1', name: 'Arabian Sea North', shortName: 'Arabian N', lat: 18.92, lon: 67.53, region: 'Arabian Sea', depth: 'Deep Ocean', ecosystemType: 'Pelagic', sensitivity: 1.0, color: '#00b4d8' },
    { id: 'zone-2', name: 'Gulf of Mannar', shortName: 'Mannar', lat: 8.97, lon: 78.14, region: 'Indian Ocean', depth: 'Shallow Reef', ecosystemType: 'Coral Reef', sensitivity: 1.0, color: '#ff6b6b' },
    { id: 'zone-3', name: 'Bay of Bengal West', shortName: 'Bengal W', lat: 13.08, lon: 80.76, region: 'Bay of Bengal', depth: 'Continental Shelf', ecosystemType: 'Coastal', sensitivity: 1.0, color: '#ffd166' },
    { id: 'zone-4', name: 'Lakshadweep Sea', shortName: 'Lakshadweep', lat: 10.57, lon: 72.64, region: 'Arabian Sea', depth: 'Shallow Atoll', ecosystemType: 'Coral Atoll', sensitivity: 1.0, color: '#06d6a0' },
    { id: 'zone-5', name: 'Andaman Sea', shortName: 'Andaman', lat: 11.68, lon: 92.72, region: 'Andaman Sea', depth: 'Deep Ocean', ecosystemType: 'Tropical Marine', sensitivity: 1.0, color: '#118ab2' },
    { id: 'zone-6', name: 'Kerala Coastal', shortName: 'Kerala', lat: 9.49, lon: 75.87, region: 'Arabian Sea', depth: 'Nearshore', ecosystemType: 'Upwelling Zone', sensitivity: 1.0, color: '#ef476f' },
    { id: 'zone-7', name: 'Sundarbans Delta', shortName: 'Sundarbans', lat: 21.94, lon: 89.18, region: 'Bay of Bengal', depth: 'Estuarine', ecosystemType: 'Mangrove Delta', sensitivity: 1.0, color: '#7209b7' },
    { id: 'zone-8', name: 'Gujarat Coast', shortName: 'Gujarat', lat: 21.63, lon: 69.61, region: 'Arabian Sea', depth: 'Continental Shelf', ecosystemType: 'Coastal Industrial', sensitivity: 1.0, color: '#f72585' }
];

const SIGNALS = {
    sst: { name: 'Sea Surface Temperature', shortName: 'SST', unit: '°C', icon: '🌡️', min: 20, max: 35, dangerHigh: 30.5, dangerLow: 23 },
    chlorophyll: { name: 'Chlorophyll-a', shortName: 'Chl-a', unit: 'mg/m³', icon: '🌿', min: 0, max: 5, dangerHigh: 2.5, dangerLow: 0.05 },
    dissolvedOxygen: { name: 'Dissolved Oxygen', shortName: 'DO', unit: 'mg/L', icon: '💧', min: 2, max: 10, dangerHigh: 10, dangerLow: 4 },
    windSpeed: { name: 'Wind Speed', shortName: 'Wind', unit: 'km/h', icon: '💨', min: 0, max: 60, dangerHigh: 40, dangerLow: 0 },
    waveHeight: { name: 'Wave Height', shortName: 'Waves', unit: 'm', icon: '🌊', min: 0, max: 8, dangerHigh: 4, dangerLow: 0 }
};

const SEASONAL_BASELINES = {
    sst:              { mean: [26.5,26.0,27.0,28.5,29.5,28.5,27.5,27.0,27.5,28.0,27.5,27.0], std: [0.8,0.7,0.8,0.9,1.0,0.9,0.8,0.8,0.8,0.9,0.8,0.7] },
    chlorophyll:      { mean: [0.30,0.25,0.20,0.15,0.20,0.80,1.20,0.90,0.50,0.30,0.25,0.30], std: [0.10,0.08,0.07,0.05,0.07,0.25,0.35,0.25,0.15,0.10,0.08,0.10] },
    dissolvedOxygen:  { mean: [6.5,6.5,6.3,6.0,5.8,5.5,5.3,5.5,5.8,6.0,6.2,6.4], std: [0.4,0.4,0.4,0.3,0.3,0.4,0.5,0.4,0.3,0.3,0.4,0.4] },
    windSpeed:        { mean: [12,10,8,7,8,18,25,22,14,10,8,10], std: [3,2.5,2,2,2,5,6,5,3,2.5,2,2.5] },
    waveHeight:       { mean: [1.5,1.2,1.0,0.8,1.0,2.5,3.5,3.0,2.0,1.2,1.0,1.3], std: [0.3,0.2,0.2,0.15,0.2,0.5,0.7,0.5,0.4,0.2,0.2,0.3] }
};

const ZONE_OFFSETS = {
    'zone-1': { sst: 0,    chlorophyll: 0,    dissolvedOxygen: 0,    windSpeed: 2,  waveHeight: 0.2 },
    'zone-2': { sst: 1.5,  chlorophyll: 0.1,  dissolvedOxygen:-0.3,  windSpeed:-3,  waveHeight:-0.3 },
    'zone-3': { sst: 0.5,  chlorophyll: 0.05, dissolvedOxygen:-0.2,  windSpeed: 0,  waveHeight: 0 },
    'zone-4': { sst: 1.0,  chlorophyll: 0.08, dissolvedOxygen: 0,    windSpeed:-2,  waveHeight:-0.2 },
    'zone-5': { sst: 1.2,  chlorophyll: 0.15, dissolvedOxygen: 0.2,  windSpeed:-1,  waveHeight: 0.1 },
    'zone-6': { sst: 0.3,  chlorophyll: 0.3,  dissolvedOxygen:-0.5,  windSpeed: 1,  waveHeight: 0 },
    'zone-7': { sst: 0.8,  chlorophyll: 0.5,  dissolvedOxygen:-1.0,  windSpeed:-2,  waveHeight:-0.5 },
    'zone-8': { sst:-0.5,  chlorophyll: 0.2,  dissolvedOxygen:-0.3,  windSpeed: 3,  waveHeight: 0.3 }
};

// NOTE: Random data generation has been removed.
// Real data is now fetched by api.js using Open-Meteo Weather & Marine APIs.
// Chlorophyll and Dissolved Oxygen are derived from real SST using scientific formulas.
// ZONES, SIGNALS, SEASONAL_BASELINES, and ZONE_OFFSETS are still used by
// the engine (engine.js) and the API layer (api.js).
