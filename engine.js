// ============================================================
// OceanWatch AI — Intelligence Engine
// Anomaly detection, scoring, classification, forecasting, adaptive learning
// ============================================================

class IntelligenceEngine {
    constructor() {
        this.baselines = {};
        this.anomalyHistory = {};
        this.alertHistory = [];
        this.zoneSensitivity = {};
        this.alertCooldowns = {};

        ZONES.forEach(z => {
            this.zoneSensitivity[z.id] = 1.0;
            this.anomalyHistory[z.id] = {};
            Object.keys(SIGNALS).forEach(sig => {
                this.anomalyHistory[z.id][sig] = { count: 0, startTime: null, values: [] };
            });
        });
    }

    computeSlope(values) {
        const n = values.length;
        if (n < 2) return 0;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) { sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i; }
        const denom = n * sumX2 - sumX * sumX;
        return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    }

    zScore(value, mean, std) { return std === 0 ? 0 : (value - mean) / std; }

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
                const slope = this.computeSlope(history.slice(-84));
                const seasonalMean = SEASONAL_BASELINES[sig].mean[currentMonth] + ZONE_OFFSETS[zoneId][sig];
                const seasonalStd = SEASONAL_BASELINES[sig].std[currentMonth];

                this.baselines[zoneId][sig] = {
                    rollingMean: +mean.toFixed(3), rollingStd: +Math.sqrt(variance).toFixed(3),
                    seasonalMean: +seasonalMean.toFixed(3), seasonalStd: +seasonalStd.toFixed(3),
                    trend: +slope.toFixed(5), trendDirection: slope > 0.01 ? 'rising' : slope < -0.01 ? 'falling' : 'stable'
                };
            });
        });
    }

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
            const isAnomaly = absZ > 1.5;

            if (isAnomaly) {
                const ah = this.anomalyHistory[zoneId][sig];
                ah.count++; if (!ah.startTime) ah.startTime = new Date(); ah.values.push(value);
                anomalySignals.push(sig);
            } else {
                this.anomalyHistory[zoneId][sig] = { count: 0, startTime: null, values: [] };
            }

            const magnitude = Math.min(10, absZ * 2.5);
            const duration = this.anomalyHistory[zoneId][sig].count;
            const durationScore = Math.min(10, duration / 12);
            const signalScore = magnitude * 0.6 + durationScore * 0.4;
            const forecast3d = value + bl.trend * 36;

            analysis.signals[sig] = {
                value, unit: SIGNALS[sig].unit, rollingMean: bl.rollingMean, rollingStd: bl.rollingStd,
                seasonalMean: bl.seasonalMean, zScoreRolling: +rollingZ.toFixed(2), zScoreSeasonal: +seasonalZ.toFixed(2),
                effectiveZScore: +effectiveZ.toFixed(2), isAnomaly, anomalyDuration: duration,
                magnitude: +magnitude.toFixed(1), trend: bl.trendDirection, slope: bl.trend,
                forecast3d: +forecast3d.toFixed(2), signalScore: +signalScore.toFixed(1),
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
                    name: SIGNALS[s].shortName, value: a.signals[s].value, unit: a.signals[s].unit,
                    zScore: a.signals[s].effectiveZScore, trend: a.signals[s].trend
                })),
                action: this.getActionRec(a), validated: null
            };
            this.alertCooldowns[cooldownKey] = now;
            this.alertHistory.push(alert);
            alerts.push(alert);
        });
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

    validateAlert(alertId, isValid) {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (!alert) return;
        alert.validated = isValid;
        if (isValid) this.zoneSensitivity[alert.zoneId] = Math.min(1.5, this.zoneSensitivity[alert.zoneId] + 0.05);
        else this.zoneSensitivity[alert.zoneId] = Math.max(0.5, this.zoneSensitivity[alert.zoneId] - 0.1);
    }

    forecast(zoneId, signal, days = 3) {
        const bl = this.baselines[zoneId]?.[signal];
        if (!bl) return null;
        const projected = bl.rollingMean + bl.trend * days * 12;
        const confidence = Math.max(30, 95 - days * 12);
        const sig = SIGNALS[signal];
        let risk = 'LOW';
        if (projected > sig.dangerHigh || projected < sig.dangerLow) risk = 'HIGH';
        else if (projected > sig.dangerHigh * 0.9 || projected < sig.dangerLow * 1.1) risk = 'MODERATE';
        return { currentValue: bl.rollingMean, projectedValue: +projected.toFixed(2), direction: bl.trendDirection, confidence, risk, horizonDays: days };
    }

    getAdaptiveStats() {
        const stats = {};
        ZONES.forEach(z => {
            const za = this.alertHistory.filter(a => a.zoneId === z.id);
            const v = za.filter(a => a.validated === true).length;
            const f = za.filter(a => a.validated === false).length;
            const t = v + f;
            stats[z.id] = { totalAlerts: za.length, validated: v, falsePositives: f, accuracy: t > 0 ? +(v / t * 100).toFixed(1) : null, sensitivity: this.zoneSensitivity[z.id] };
        });
        return stats;
    }
}
