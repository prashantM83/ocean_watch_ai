// ============================================================
// OceanWatch AI — Intelligence Engine v2.0
// Anomaly detection, scoring, classification, forecasting,
// adaptive per-signal learning, cross-zone correlation,
// confidence intervals, persistence, IndexedDB anomaly memory
// ============================================================

// ---- IndexedDB Anomaly Memory ----
class AnomalyMemory {
    constructor() {
        this.db = null;
        this.ready = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('oceanwatch_anomaly_memory', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('anomalies')) {
                    const store = db.createObjectStore('anomalies', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('zoneId', 'zoneId', { unique: false });
                    store.createIndex('classification', 'classification', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('zone_class', ['zoneId', 'classification'], { unique: false });
                }
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = (e) => { console.warn('IndexedDB failed:', e); resolve(); };
        });
    }

    async store(anomaly) {
        await this.ready;
        if (!this.db) return;
        const tx = this.db.transaction('anomalies', 'readwrite');
        tx.objectStore('anomalies').add({
            zoneId: anomaly.zoneId,
            zoneName: anomaly.zoneName,
            classification: anomaly.classification,
            score: anomaly.score,
            priority: anomaly.priority,
            signals: anomaly.signals,
            detail: anomaly.detail,
            timestamp: Date.now()
        });
    }

    async hasSimilarPastEvent(zoneId, classification, withinDays = 30) {
        await this.ready;
        if (!this.db) return { found: false, count: 0, events: [] };
        return new Promise((resolve) => {
            const tx = this.db.transaction('anomalies', 'readonly');
            const index = tx.objectStore('anomalies').index('zone_class');
            const range = IDBKeyRange.only([zoneId, classification]);
            const req = index.getAll(range);
            req.onsuccess = () => {
                const cutoff = Date.now() - withinDays * 86400000;
                const events = (req.result || []).filter(e => e.timestamp > cutoff);
                resolve({ found: events.length > 0, count: events.length, events: events.slice(-5) });
            };
            req.onerror = () => resolve({ found: false, count: 0, events: [] });
        });
    }

    async getRecentHistory(limit = 50) {
        await this.ready;
        if (!this.db) return [];
        return new Promise((resolve) => {
            const tx = this.db.transaction('anomalies', 'readonly');
            const req = tx.objectStore('anomalies').index('timestamp').openCursor(null, 'prev');
            const results = [];
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else resolve(results);
            };
            req.onerror = () => resolve([]);
        });
    }

    async getZoneHistory(zoneId) {
        await this.ready;
        if (!this.db) return [];
        return new Promise((resolve) => {
            const tx = this.db.transaction('anomalies', 'readonly');
            const index = tx.objectStore('anomalies').index('zoneId');
            const req = index.getAll(IDBKeyRange.only(zoneId));
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }
}

// ---- Intelligence Engine ----
class IntelligenceEngine {
    constructor() {
        this.baselines = {};
        this.anomalyHistory = {};
        this.alertHistory = [];
        this.zoneSensitivity = {};
        this.signalSensitivity = {}; // NEW: per-zone per-signal sensitivity
        this.alertCooldowns = {};
        this.crossZoneCorrelations = []; // NEW: cross-zone correlation results
        this.anomalyMemory = new AnomalyMemory(); // NEW: IndexedDB long-term memory

        ZONES.forEach(z => {
            this.zoneSensitivity[z.id] = 1.0;
            this.signalSensitivity[z.id] = {};
            this.anomalyHistory[z.id] = {};
            Object.keys(SIGNALS).forEach(sig => {
                this.anomalyHistory[z.id][sig] = { count: 0, startTime: null, values: [] };
                this.signalSensitivity[z.id][sig] = 1.0;
            });
        });

        // Load persisted state
        this.loadState();
    }

    // ---- Persistence (localStorage) ----
    saveState() {
        try {
            const state = {
                zoneSensitivity: this.zoneSensitivity,
                signalSensitivity: this.signalSensitivity,
                alertHistory: this.alertHistory.slice(-100).map(a => ({
                    ...a,
                    timestamp: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp
                })),
                anomalyHistory: this.anomalyHistory,
                savedAt: Date.now()
            };
            localStorage.setItem('oceanwatch_engine_state', JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save engine state:', e.message);
        }
    }

    loadState() {
        try {
            const saved = localStorage.getItem('oceanwatch_engine_state');
            if (!saved) return;
            const state = JSON.parse(saved);

            // Only restore if saved within 7 days
            if (Date.now() - state.savedAt > 7 * 86400000) {
                console.log('Engine state expired (>7 days), starting fresh');
                return;
            }

            if (state.zoneSensitivity) {
                Object.keys(state.zoneSensitivity).forEach(zid => {
                    if (this.zoneSensitivity[zid] !== undefined) {
                        this.zoneSensitivity[zid] = state.zoneSensitivity[zid];
                    }
                });
            }
            if (state.signalSensitivity) {
                Object.keys(state.signalSensitivity).forEach(zid => {
                    if (this.signalSensitivity[zid]) {
                        Object.keys(state.signalSensitivity[zid]).forEach(sig => {
                            if (this.signalSensitivity[zid][sig] !== undefined) {
                                this.signalSensitivity[zid][sig] = state.signalSensitivity[zid][sig];
                            }
                        });
                    }
                });
            }
            if (state.alertHistory) {
                this.alertHistory = state.alertHistory.map(a => ({
                    ...a,
                    timestamp: new Date(a.timestamp)
                }));
            }
            if (state.anomalyHistory) {
                Object.keys(state.anomalyHistory).forEach(zid => {
                    if (this.anomalyHistory[zid]) {
                        Object.keys(state.anomalyHistory[zid]).forEach(sig => {
                            if (this.anomalyHistory[zid][sig]) {
                                this.anomalyHistory[zid][sig] = state.anomalyHistory[zid][sig];
                            }
                        });
                    }
                });
            }
            console.log('✅ Engine state restored from localStorage');
        } catch (e) {
            console.warn('Failed to load engine state:', e.message);
        }
    }

    // ---- Statistical Helpers ----
    computeSlope(values) {
        const n = values.length;
        if (n < 2) return 0;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) { sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i; }
        const denom = n * sumX2 - sumX * sumX;
        return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    }

    zScore(value, mean, std) { return std === 0 ? 0 : (value - mean) / std; }

    // Pearson correlation coefficient between two arrays
    pearsonCorrelation(x, y) {
        const n = Math.min(x.length, y.length);
        if (n < 5) return 0;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
        for (let i = 0; i < n; i++) {
            sumX += x[i]; sumY += y[i];
            sumXY += x[i] * y[i];
            sumX2 += x[i] * x[i]; sumY2 += y[i] * y[i];
        }
        const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    }

    // ---- Baselines ----
    computeBaselines(allData) {
        const currentMonth = new Date().getMonth();
        Object.keys(allData).forEach(zoneId => {
            this.baselines[zoneId] = {};
            const zoneData = allData[zoneId];
            Object.keys(SIGNALS).forEach(sig => {
                const history = zoneData.history[sig];
                const recent = history.slice(-72);
                const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
                const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
                const std = Math.sqrt(variance);
                const slope = this.computeSlope(history.slice(-84));
                const seasonalMean = SEASONAL_BASELINES[sig].mean[currentMonth] + ZONE_OFFSETS[zoneId][sig];
                const seasonalStd = SEASONAL_BASELINES[sig].std[currentMonth];

                this.baselines[zoneId][sig] = {
                    rollingMean: +mean.toFixed(3), rollingStd: +std.toFixed(3),
                    seasonalMean: +seasonalMean.toFixed(3), seasonalStd: +seasonalStd.toFixed(3),
                    trend: +slope.toFixed(5), trendDirection: slope > 0.01 ? 'rising' : slope < -0.01 ? 'falling' : 'stable'
                };
            });
        });
    }

    // ---- Zone Analysis ----
    analyzeZone(zoneId, currentReadings, allData) {
        const baseline = this.baselines[zoneId];
        if (!baseline) return null;

        const analysis = {
            zoneId, zone: ZONES.find(z => z.id === zoneId),
            signals: {}, anomalyScore: 0, convergenceCount: 0,
            classification: 'NORMAL', classificationDetail: '', priority: 'NORMAL', timestamp: new Date()
        };

        let anomalySignals = [];
        Object.keys(SIGNALS).forEach(sig => {
            const value = currentReadings[sig];
            const bl = baseline[sig];
            const rollingZ = this.zScore(value, bl.rollingMean, bl.rollingStd);
            const seasonalZ = this.zScore(value, bl.seasonalMean, bl.seasonalStd);
            const effectiveZ = Math.abs(rollingZ) > Math.abs(seasonalZ) ? rollingZ : seasonalZ;
            const absZ = Math.abs(effectiveZ);

            // Apply per-signal sensitivity
            const sigSens = this.signalSensitivity[zoneId]?.[sig] ?? 1.0;
            const adjustedZ = absZ * sigSens;
            const isAnomaly = adjustedZ > 1.5;

            if (isAnomaly) {
                const ah = this.anomalyHistory[zoneId][sig];
                ah.count++; if (!ah.startTime) ah.startTime = new Date(); ah.values.push(value);
                if (ah.values.length > 200) ah.values.shift();
                anomalySignals.push(sig);
            } else {
                this.anomalyHistory[zoneId][sig] = { count: 0, startTime: null, values: [] };
            }

            const magnitude = Math.min(10, adjustedZ * 2.5);
            const duration = this.anomalyHistory[zoneId][sig].count;
            const durationScore = Math.min(10, duration / 12);
            const signalScore = magnitude * 0.6 + durationScore * 0.4;

            // Proper confidence interval forecast
            const stdError = bl.rollingStd * Math.sqrt(1 + 3 / 7);
            const forecast3d = value + bl.trend * 36;
            const forecastLower = forecast3d - 1.96 * stdError;
            const forecastUpper = forecast3d + 1.96 * stdError;
            const forecastConfidence = Math.max(20, Math.round(95 * Math.exp(-0.15 * 3)));

            analysis.signals[sig] = {
                value, unit: SIGNALS[sig].unit, rollingMean: bl.rollingMean, rollingStd: bl.rollingStd,
                seasonalMean: bl.seasonalMean, zScoreRolling: +rollingZ.toFixed(2), zScoreSeasonal: +seasonalZ.toFixed(2),
                effectiveZScore: +effectiveZ.toFixed(2), isAnomaly, anomalyDuration: duration,
                magnitude: +magnitude.toFixed(1), trend: bl.trendDirection, slope: bl.trend,
                signalSensitivity: +(sigSens).toFixed(2),
                forecast3d: +forecast3d.toFixed(2),
                forecastLower: +forecastLower.toFixed(2),
                forecastUpper: +forecastUpper.toFixed(2),
                forecastConfidence,
                signalScore: +signalScore.toFixed(1),
                deviationPercent: +((value - bl.seasonalMean) / Math.abs(bl.seasonalMean) * 100).toFixed(1)
            };
        });

        analysis.convergenceCount = anomalySignals.length;
        const scores = Object.values(analysis.signals).map(s => s.signalScore).sort((a, b) => b - a);
        let zoneScore = 0;
        if (scores.length > 0) {
            zoneScore = scores[0] * 0.5;
            if (scores.length > 1) zoneScore += scores[1] * 0.25;
            if (scores.length > 2) zoneScore += scores[2] * 0.15;
            zoneScore += analysis.convergenceCount * 0.8;
        }
        zoneScore *= this.zoneSensitivity[zoneId];
        analysis.anomalyScore = +Math.min(10, zoneScore).toFixed(1);
        analysis.classification = this.classifyEvent(analysis);
        analysis.priority = analysis.anomalyScore >= 7.5 ? 'CRITICAL' : analysis.anomalyScore >= 5.0 ? 'WARNING' : analysis.anomalyScore >= 2.5 ? 'ADVISORY' : 'NORMAL';
        return analysis;
    }

    classifyEvent(a) {
        const s = a.signals;
        if (s.sst?.isAnomaly && s.sst?.effectiveZScore > 2 && (!s.chlorophyll?.isAnomaly || s.chlorophyll?.effectiveZScore < 0)) {
            a.classificationDetail = 'Elevated SST above seasonal norm with sustained trajectory. Pattern consistent with coral thermal stress.'; return 'CORAL_BLEACHING_RISK';
        }
        if (s.chlorophyll?.isAnomaly && s.chlorophyll?.effectiveZScore > 2) {
            if (s.dissolvedOxygen?.isAnomaly && s.dissolvedOxygen?.effectiveZScore < -1) {
                a.classificationDetail = 'Chlorophyll surge coupled with DO depletion. High probability of harmful algal bloom.'; return 'HARMFUL_ALGAL_BLOOM';
            }
            a.classificationDetail = 'Significant chlorophyll elevation detected. May indicate developing algal bloom.'; return 'ALGAL_BLOOM_PRECURSOR';
        }
        if (s.dissolvedOxygen?.isAnomaly && s.dissolvedOxygen?.effectiveZScore < -2) {
            a.classificationDetail = 'Dissolved oxygen critically below baseline. Marine life at risk of hypoxic stress.'; return 'HYPOXIA_WARNING';
        }
        if (s.windSpeed?.isAnomaly && s.windSpeed?.effectiveZScore > 2 && s.waveHeight?.isAnomaly && s.waveHeight?.effectiveZScore > 2) {
            a.classificationDetail = 'Convergent wind and wave anomalies indicate severe marine weather.'; return 'STORM_SURGE_RISK';
        }
        if (a.convergenceCount >= 3) {
            a.classificationDetail = 'Multiple parameters deviating simultaneously. Compound ecosystem stress.'; return 'COMPOUND_STRESS';
        }
        if (s.sst?.isAnomaly) { a.classificationDetail = 'SST deviating from seasonal range.'; return 'THERMAL_ANOMALY'; }
        if (a.convergenceCount > 0) { a.classificationDetail = 'Signal deviation detected. Monitoring recommended.'; return 'SIGNAL_DEVIATION'; }
        a.classificationDetail = 'All parameters within expected seasonal ranges.'; return 'NORMAL';
    }

    // ---- Alert Generation ----
    generateAlerts(analyses) {
        const alerts = [], now = new Date();
        analyses.forEach(a => {
            if (a.priority === 'NORMAL') return;
            const cooldownKey = `${a.zoneId}_${a.classification}`;
            if (this.alertCooldowns[cooldownKey] && (now - this.alertCooldowns[cooldownKey]) < 1800000) return;
            if (a.anomalyScore < 3 && a.convergenceCount <= 1) return;

            const alert = {
                id: `alert-${Date.now()}-${a.zoneId}`, timestamp: now, zoneId: a.zoneId,
                zoneName: a.zone.name, priority: a.priority, score: a.anomalyScore,
                classification: a.classification, detail: a.classificationDetail,
                convergence: a.convergenceCount,
                signals: Object.keys(a.signals).filter(s => a.signals[s].isAnomaly).map(s => ({
                    name: SIGNALS[s].shortName, key: s, value: a.signals[s].value, unit: a.signals[s].unit,
                    zScore: a.signals[s].effectiveZScore, trend: a.signals[s].trend
                })),
                action: this.getActionRec(a), validated: null
            };
            this.alertCooldowns[cooldownKey] = now;
            this.alertHistory.push(alert);
            alerts.push(alert);

            // Store in IndexedDB for long-term memory
            this.anomalyMemory.store(alert);
        });

        // Auto-save state after generating alerts
        this.saveState();

        return alerts.sort((a, b) => b.score - a.score);
    }

    getActionRec(a) {
        const m = {
            'CORAL_BLEACHING_RISK': 'Deploy dive survey team. Notify coral reef monitoring authority.',
            'HARMFUL_ALGAL_BLOOM': 'Issue fisheries advisory. Deploy water sampling team.',
            'ALGAL_BLOOM_PRECURSOR': 'Increase sampling frequency. Alert fisheries board.',
            'HYPOXIA_WARNING': 'Alert fisheries operators. Monitor fish behavior.',
            'STORM_SURGE_RISK': 'Issue maritime advisory. Restrict small vessel operations.',
            'COMPOUND_STRESS': 'Convene multi-agency assessment. Deploy monitoring.',
            'THERMAL_ANOMALY': 'Increase SST monitoring frequency.',
            'SIGNAL_DEVIATION': 'Continue monitoring. Flag for assessment.'
        };
        return m[a.classification] || 'Monitor and reassess.';
    }

    // ---- Adaptive Learning (per-zone AND per-signal) ----
    validateAlert(alertId, isValid) {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (!alert) return;
        alert.validated = isValid;

        // Adjust zone-level sensitivity
        if (isValid) {
            this.zoneSensitivity[alert.zoneId] = Math.min(1.5, this.zoneSensitivity[alert.zoneId] + 0.05);
        } else {
            this.zoneSensitivity[alert.zoneId] = Math.max(0.5, this.zoneSensitivity[alert.zoneId] - 0.1);
        }

        // Adjust per-signal sensitivity for the specific signals that triggered this alert
        if (alert.signals && alert.signals.length > 0) {
            alert.signals.forEach(sig => {
                const sigKey = sig.key;
                if (sigKey && this.signalSensitivity[alert.zoneId]?.[sigKey] !== undefined) {
                    if (isValid) {
                        this.signalSensitivity[alert.zoneId][sigKey] = Math.min(1.5, this.signalSensitivity[alert.zoneId][sigKey] + 0.03);
                    } else {
                        // Larger reduction for false positives — this is the "learn to discount noise" behavior
                        this.signalSensitivity[alert.zoneId][sigKey] = Math.max(0.5, this.signalSensitivity[alert.zoneId][sigKey] - 0.08);
                    }
                }
            });
        }

        // Persist after validation
        this.saveState();
    }

    // ---- Forecasting with Confidence Intervals ----
    forecast(zoneId, signal, days = 3) {
        const bl = this.baselines[zoneId]?.[signal];
        if (!bl) return null;
        const projected = bl.rollingMean + bl.trend * days * 12;

        // Proper confidence interval using rolling standard deviation
        const stdError = bl.rollingStd * Math.sqrt(1 + days / 7);
        const lowerBound = projected - 1.96 * stdError;
        const upperBound = projected + 1.96 * stdError;

        // Confidence decays exponentially with forecast horizon
        const confidence = Math.max(20, Math.round(95 * Math.exp(-0.15 * days)));

        const sig = SIGNALS[signal];
        let risk = 'LOW';
        if (projected > sig.dangerHigh || projected < sig.dangerLow) risk = 'HIGH';
        else if (upperBound > sig.dangerHigh || lowerBound < sig.dangerLow) risk = 'MODERATE';

        return {
            currentValue: bl.rollingMean,
            projectedValue: +projected.toFixed(2),
            lowerBound: +lowerBound.toFixed(2),
            upperBound: +upperBound.toFixed(2),
            direction: bl.trendDirection,
            confidence,
            risk,
            horizonDays: days,
            stdError: +stdError.toFixed(3)
        };
    }

    // ---- Cross-Zone Correlation Detection ----
    detectCrossZonePatterns(allData) {
        const correlations = [];
        const zoneIds = Object.keys(allData);

        for (let i = 0; i < zoneIds.length; i++) {
            for (let j = i + 1; j < zoneIds.length; j++) {
                const z1 = zoneIds[i], z2 = zoneIds[j];
                const signalCorrelations = {};
                let highCorrCount = 0;

                Object.keys(SIGNALS).forEach(sig => {
                    const h1 = allData[z1].history[sig]?.slice(-72) || [];
                    const h2 = allData[z2].history[sig]?.slice(-72) || [];
                    const r = this.pearsonCorrelation(h1, h2);
                    signalCorrelations[sig] = +r.toFixed(3);
                    if (Math.abs(r) > 0.7) highCorrCount++;
                });

                // Only report if at least one signal has high correlation
                if (highCorrCount > 0) {
                    const avgCorr = Object.values(signalCorrelations).reduce((a, b) => a + Math.abs(b), 0) / Object.keys(SIGNALS).length;
                    correlations.push({
                        zone1: z1,
                        zone2: z2,
                        zone1Name: ZONES.find(z => z.id === z1)?.name,
                        zone2Name: ZONES.find(z => z.id === z2)?.name,
                        signals: signalCorrelations,
                        highCorrelationCount: highCorrCount,
                        averageCorrelation: +avgCorr.toFixed(3),
                        pattern: highCorrCount >= 3 ? 'Strong synchronized anomaly' :
                                 highCorrCount >= 2 ? 'Partial synchronization' : 'Signal-specific correlation'
                    });
                }
            }
        }

        this.crossZoneCorrelations = correlations.sort((a, b) => b.averageCorrelation - a.averageCorrelation);
        return this.crossZoneCorrelations;
    }

    // ---- Adaptive Stats ----
    getAdaptiveStats() {
        const stats = {};
        ZONES.forEach(z => {
            const za = this.alertHistory.filter(a => a.zoneId === z.id);
            const v = za.filter(a => a.validated === true).length;
            const f = za.filter(a => a.validated === false).length;
            const t = v + f;
            stats[z.id] = {
                totalAlerts: za.length, validated: v, falsePositives: f,
                accuracy: t > 0 ? +(v / t * 100).toFixed(1) : null,
                sensitivity: this.zoneSensitivity[z.id],
                signalSensitivity: { ...this.signalSensitivity[z.id] }
            };
        });
        return stats;
    }

    // ---- Data Export Helpers ----
    getExportData(analyses, allData) {
        return {
            zones: analyses.map(a => ({
                zone: a.zone.name, region: a.zone.region, ecosystem: a.zone.ecosystemType,
                priority: a.priority, score: a.anomalyScore, classification: a.classification,
                detail: a.classificationDetail,
                ...Object.fromEntries(Object.entries(a.signals).map(([k, s]) => [SIGNALS[k].shortName, `${s.value}${s.unit}`])),
                ...Object.fromEntries(Object.entries(a.signals).map(([k, s]) => [`${SIGNALS[k].shortName}_deviation`, `${s.deviationPercent}%`]))
            })),
            alerts: this.alertHistory.slice(-50).map(a => ({
                time: a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp,
                zone: a.zoneName, priority: a.priority, score: a.score,
                classification: a.classification, detail: a.detail,
                validated: a.validated === null ? 'Pending' : a.validated ? 'Yes' : 'No'
            }))
        };
    }
}
