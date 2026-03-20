// ============================================================
// OceanWatch AI — Main Application
// Dashboard controller, map, charts, UI updates
// ============================================================

let allData, engine, assistant, map, zoneMarkers = {}, zoneLayers = {}, currentAnalyses = [];
let selectedZone = null, tempChart = null, signalCharts = {};
const PRIORITY_COLORS = { CRITICAL: '#ef4444', WARNING: '#f59e0b', ADVISORY: '#3b82f6', NORMAL: '#10b981' };
const CLASSIFICATION_ICONS = {
    CORAL_BLEACHING_RISK: '🪸', HARMFUL_ALGAL_BLOOM: '🦠', ALGAL_BLOOM_PRECURSOR: '🌿',
    HYPOXIA_WARNING: '💀', STORM_SURGE_RISK: '🌪️', COMPOUND_STRESS: '⚠️',
    THERMAL_ANOMALY: '🌡️', SIGNAL_DEVIATION: '📡', NORMAL: '✅'
};

async function init() {
    showLoading(true);
    setDataSourceStatus('loading');

    engine = new IntelligenceEngine();
    assistant = new AIAssistant(engine);
    initMap();

    try {
        // Fetch real data from Open-Meteo APIs
        allData = await fetchAllZonesData((zoneName, completed, total, hadError) => {
            updateLoadingProgress(zoneName, completed, total, hadError);
        });
        setDataSourceStatus('live');
        console.log('✅ Real API data loaded successfully for all zones');
    } catch (error) {
        console.error('API fetch failed, trying cache:', error);
        // Try cached data
        const cached = loadAllCachedData();
        if (cached && Object.keys(cached).length === ZONES.length) {
            allData = cached;
            setDataSourceStatus('cached');
            console.log('🟡 Using cached data');
        } else {
            // Last resort: generate fallback data
            console.warn('🔴 No cache available, generating fallback data');
            allData = {};
            const month = new Date().getMonth();
            ZONES.forEach(zone => { allData[zone.id] = generateFallbackData(zone, month); });
            setDataSourceStatus('fallback');
        }
    }

    engine.computeBaselines(allData);
    runAnalysis();
    showLoading(false);

    // Refresh with real API data every 60 seconds
    setInterval(updateCycle, API_CONFIG.refreshInterval);

    setupChat();
    setupQuickQueries();
    animateEntrance();
    updateLastUpdated();
}

function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

function updateLoadingProgress(zoneName, completed, total, hadError) {
    const textEl = document.getElementById('loader-text');
    if (textEl) {
        if (completed < total) {
            textEl.textContent = `Fetching ${zoneName}... (${completed}/${total} zones)`;
        } else {
            textEl.textContent = hadError ? 'Loaded with some fallbacks...' : 'All zones loaded! Starting dashboard...';
        }
    }
}

function updateLastUpdated() {
    const el = document.getElementById('last-updated');
    if (el) {
        const now = new Date();
        el.textContent = `Updated: ${now.toLocaleTimeString()}`;
    }
}

function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([14.5, 78], 5);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd'
    }).addTo(map);

    ZONES.forEach(zone => {
        const circle = L.circle([zone.lat, zone.lon], {
            radius: 80000, color: zone.color, fillColor: zone.color, fillOpacity: 0.15, weight: 2
        }).addTo(map);
        const marker = L.circleMarker([zone.lat, zone.lon], {
            radius: 10, color: '#fff', fillColor: zone.color, fillOpacity: 0.9, weight: 2
        }).addTo(map);
        marker.bindTooltip(zone.shortName, { permanent: true, direction: 'top', className: 'zone-tooltip', offset: [0, -12] });
        marker.on('click', () => selectZone(zone.id));
        circle.on('click', () => selectZone(zone.id));
        zoneMarkers[zone.id] = marker;
        zoneLayers[zone.id] = circle;
    });
}

function runAnalysis() {
    currentAnalyses = [];
    ZONES.forEach(zone => {
        if (!allData[zone.id]) return;
        const latest = {};
        Object.keys(SIGNALS).forEach(sig => {
            const hist = allData[zone.id].history[sig];
            if (hist && hist.length > 0) {
                latest[sig] = hist[hist.length - 1];
            }
        });
        if (Object.keys(latest).length === 0) return;
        const analysis = engine.analyzeZone(zone.id, latest, allData);
        if (analysis) currentAnalyses.push(analysis);
    });
    currentAnalyses.sort((a, b) => b.anomalyScore - a.anomalyScore);
    const alerts = engine.generateAlerts(currentAnalyses);
    updateUI(alerts);
}

async function updateCycle() {
    let anySuccess = false;
    const updatePromises = ZONES.map(async (zone) => {
        try {
            const reading = await fetchCurrentReading(zone);
            if (reading) {
                Object.keys(reading).forEach(sig => {
                    if (allData[zone.id]?.history[sig]) {
                        allData[zone.id].history[sig].push(reading[sig]);
                        if (allData[zone.id].history[sig].length > 400) allData[zone.id].history[sig].shift();
                    }
                });
                allData[zone.id].timestamps.push(new Date());
                if (allData[zone.id].timestamps.length > 400) allData[zone.id].timestamps.shift();
                anySuccess = true;
            }
        } catch (e) {
            // Silent fail for individual zone updates — use existing data
            console.warn(`Update failed for ${zone.name}:`, e.message);
        }
    });

    await Promise.all(updatePromises);

    if (anySuccess) {
        setDataSourceStatus('live');
        saveCachedData(allData);
    }

    engine.computeBaselines(allData);
    runAnalysis();
    updateLastUpdated();
}

function updateUI(newAlerts) {
    updateZoneCards();
    updateMapMarkers();
    updateStatsBar();
    if (newAlerts.length > 0) updateAlertFeed(newAlerts);
    if (selectedZone) updateZoneDetail(selectedZone);
}

function updateZoneCards() {
    const container = document.getElementById('zone-cards');
    container.innerHTML = currentAnalyses.map(a => `
        <div class="zone-card ${selectedZone === a.zoneId ? 'selected' : ''} priority-${a.priority.toLowerCase()}" onclick="selectZone('${a.zoneId}')">
            <div class="zone-card-header">
                <span class="zone-icon">${CLASSIFICATION_ICONS[a.classification] || '📡'}</span>
                <span class="zone-name">${a.zone.shortName}</span>
                <span class="priority-badge badge-${a.priority.toLowerCase()}">${a.priority}</span>
            </div>
            <div class="zone-score-bar"><div class="score-fill" style="width:${a.anomalyScore * 10}%;background:${PRIORITY_COLORS[a.priority]}"></div></div>
            <div class="zone-score-label">Score: ${a.anomalyScore}/10</div>
            <div class="zone-classification">${a.classification.replace(/_/g, ' ')}</div>
            <div class="zone-signals-mini">${Object.entries(a.signals).filter(([_, s]) => s.isAnomaly).map(([k, s]) => `<span class="signal-tag">${SIGNALS[k].icon}${s.deviationPercent > 0 ? '+' : ''}${s.deviationPercent}%</span>`).join('')}</div>
        </div>
    `).join('');
}

function updateMapMarkers() {
    currentAnalyses.forEach(a => {
        const marker = zoneMarkers[a.zoneId];
        const layer = zoneLayers[a.zoneId];
        if (marker) {
            marker.setStyle({ fillColor: PRIORITY_COLORS[a.priority], color: a.priority === 'CRITICAL' ? '#ef4444' : '#fff' });
            if (a.priority === 'CRITICAL') marker.setRadius(14); else marker.setRadius(10);
        }
        if (layer) {
            layer.setStyle({ color: PRIORITY_COLORS[a.priority], fillColor: PRIORITY_COLORS[a.priority], fillOpacity: a.priority === 'NORMAL' ? 0.08 : 0.2 });
        }
    });
}

function updateStatsBar() {
    const crit = currentAnalyses.filter(a => a.priority === 'CRITICAL').length;
    const warn = currentAnalyses.filter(a => a.priority === 'WARNING').length;
    const adv = currentAnalyses.filter(a => a.priority === 'ADVISORY').length;
    const norm = currentAnalyses.filter(a => a.priority === 'NORMAL').length;
    document.getElementById('stat-critical').textContent = crit;
    document.getElementById('stat-warning').textContent = warn;
    document.getElementById('stat-advisory').textContent = adv;
    document.getElementById('stat-normal').textContent = norm;
    document.getElementById('stat-total-alerts').textContent = engine.alertHistory.length;
    document.getElementById('stat-zones').textContent = ZONES.length;
}

function updateAlertFeed(alerts) {
    const container = document.getElementById('alert-feed');
    alerts.forEach(alert => {
        const el = document.createElement('div');
        el.className = `alert-item priority-${alert.priority.toLowerCase()} alert-enter`;
        el.innerHTML = `
            <div class="alert-header">
                <span class="priority-badge badge-${alert.priority.toLowerCase()}">${alert.priority}</span>
                <span class="alert-zone">${alert.zoneName}</span>
                <span class="alert-score">Score: ${alert.score}</span>
                <span class="alert-time">${alert.timestamp.toLocaleTimeString()}</span>
            </div>
            <div class="alert-classification">${CLASSIFICATION_ICONS[alert.classification] || ''} ${alert.classification.replace(/_/g, ' ')}</div>
            <div class="alert-detail">${alert.detail}</div>
            <div class="alert-signals">${alert.signals.map(s => `${s.name}: ${s.value}${s.unit} (${s.zScore > 0 ? '+' : ''}${s.zScore}σ, ${s.trend})`).join(' | ')}</div>
            <div class="alert-action">📋 ${alert.action}</div>
            <div class="alert-validate">
                <button class="btn-validate" onclick="validateAlert('${alert.id}', true)">✅ Validate</button>
                <button class="btn-reject" onclick="validateAlert('${alert.id}', false)">❌ False Positive</button>
            </div>`;
        container.prepend(el);
        setTimeout(() => el.classList.remove('alert-enter'), 50);
    });
    // Keep max 20 alerts in feed
    while (container.children.length > 20) container.removeChild(container.lastChild);
}

function validateAlert(id, isValid) {
    engine.validateAlert(id, isValid);
    const btns = event.target.parentElement;
    btns.innerHTML = isValid ? '<span class="validated">✅ Validated — Sensitivity increased</span>' : '<span class="rejected">❌ Marked False Positive — Sensitivity reduced</span>';
}

function selectZone(zoneId) {
    selectedZone = zoneId;
    document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.zone-card[onclick*="${zoneId}"]`);
    if (card) card.classList.add('selected');
    const zone = ZONES.find(z => z.id === zoneId);
    if (zone) map.flyTo([zone.lat, zone.lon], 7, { duration: 1 });
    updateZoneDetail(zoneId);
    document.getElementById('zone-detail').classList.add('visible');
}

function updateZoneDetail(zoneId) {
    const analysis = currentAnalyses.find(a => a.zoneId === zoneId);
    if (!analysis) return;
    const zone = analysis.zone;
    const panel = document.getElementById('zone-detail');

    document.getElementById('detail-zone-name').textContent = zone.name;
    document.getElementById('detail-zone-type').textContent = `${zone.ecosystemType} • ${zone.depth} • ${zone.region}`;
    document.getElementById('detail-priority').textContent = analysis.priority;
    document.getElementById('detail-priority').className = `detail-priority badge-${analysis.priority.toLowerCase()}`;
    document.getElementById('detail-score').textContent = `${analysis.anomalyScore}/10`;
    document.getElementById('detail-classification').textContent = `${CLASSIFICATION_ICONS[analysis.classification] || ''} ${analysis.classification.replace(/_/g, ' ')}`;
    document.getElementById('detail-explanation').textContent = analysis.classificationDetail;
    document.getElementById('detail-action').textContent = engine.getActionRec(analysis);

    // Signal cards
    const sigContainer = document.getElementById('detail-signals');
    sigContainer.innerHTML = Object.entries(analysis.signals).map(([key, s]) => {
        const fc = engine.forecast(zoneId, key, 3);
        const trendIcon = s.trend === 'rising' ? '📈' : s.trend === 'falling' ? '📉' : '➡️';
        return `<div class="signal-card ${s.isAnomaly ? 'signal-anomaly' : ''}">
            <div class="signal-header">${SIGNALS[key].icon} ${SIGNALS[key].shortName}</div>
            <div class="signal-value">${s.value} <small>${s.unit}</small></div>
            <div class="signal-baseline">Baseline: ${s.seasonalMean} ${s.unit}</div>
            <div class="signal-deviation ${s.deviationPercent > 0 ? 'dev-up' : 'dev-down'}">${s.deviationPercent > 0 ? '+' : ''}${s.deviationPercent}% ${trendIcon}</div>
            <div class="signal-zscore">Z-Score: ${s.effectiveZScore > 0 ? '+' : ''}${s.effectiveZScore}σ</div>
            ${fc ? `<div class="signal-forecast">3-day: ${fc.projectedValue}${SIGNALS[key].unit} <span class="risk-${fc.risk.toLowerCase()}">${fc.risk} risk</span></div>` : ''}
        </div>`;
    }).join('');

    // Update charts
    updateSignalCharts(zoneId);
}

function updateSignalCharts(zoneId) {
    const chartContainer = document.getElementById('detail-charts');
    chartContainer.innerHTML = '';

    ['sst', 'chlorophyll', 'dissolvedOxygen'].forEach(sig => {
        const canvas = document.createElement('canvas');
        canvas.id = `chart-${sig}`;
        canvas.height = 120;
        chartContainer.appendChild(canvas);

        const history = allData[zoneId].history[sig];
        const last72 = history.slice(-72); // 6 days
        const baseline = engine.baselines[zoneId][sig];
        const labels = last72.map((_, i) => i % 12 === 0 ? `Day ${Math.floor(i / 12) + 1}` : '');

        if (signalCharts[sig]) signalCharts[sig].destroy();
        signalCharts[sig] = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: SIGNALS[sig].name, data: last72, borderColor: ZONES.find(z => z.id === zoneId)?.color || '#00b4d8', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                    { label: 'Baseline', data: Array(last72.length).fill(baseline.seasonalMean), borderColor: 'rgba(255,255,255,0.3)', borderDash: [5, 5], backgroundColor: 'transparent', borderWidth: 1, pointRadius: 0 },
                    { label: '+2σ', data: Array(last72.length).fill(baseline.seasonalMean + 2 * baseline.seasonalStd), borderColor: 'rgba(239,68,68,0.3)', borderDash: [3, 3], backgroundColor: 'transparent', borderWidth: 1, pointRadius: 0 },
                    { label: '-2σ', data: Array(last72.length).fill(baseline.seasonalMean - 2 * baseline.seasonalStd), borderColor: 'rgba(239,68,68,0.3)', borderDash: [3, 3], backgroundColor: 'transparent', borderWidth: 1, pointRadius: 0 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } },
                scales: {
                    x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    });
}

// ---- Chat Interface ----
function setupChat() {
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('chat-send');
    btn.addEventListener('click', () => sendChat());
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

    // Welcome message with Gemini status
    const geminiNote = assistant.geminiAvailable
        ? '🧠 <strong>Gemini AI active</strong> — I can answer any question about the ocean data!'
        : '💡 Type "settings" to activate Gemini AI for smarter responses.';
    appendChatMessage('assistant', assistant.fmt('🌊 OceanWatch AI Ready',
        `Monitoring ${ZONES.length} marine zones with <strong>real API data</strong>. ${geminiNote}<br>Try "What needs attention right now?" or click a zone on the map.`, []));
}

let isChatBusy = false;

async function sendChat() {
    const input = document.getElementById('chat-input');
    const query = input.value.trim();
    if (!query || isChatBusy) return;

    appendChatMessage('user', { title: '', summary: query, items: [] });
    input.value = '';

    // Show typing indicator
    isChatBusy = true;
    const typingId = showTypingIndicator();

    try {
        const response = await assistant.processQuery(query, currentAnalyses);
        removeTypingIndicator(typingId);
        appendChatMessage('assistant', response);
    } catch (error) {
        removeTypingIndicator(typingId);
        appendChatMessage('assistant', { title: '❌ Error', summary: `Something went wrong: ${error.message}`, items: [] });
    }

    isChatBusy = false;
}

function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    const id = 'typing-' + Date.now();
    msg.id = id;
    msg.className = 'chat-msg chat-assistant';
    msg.innerHTML = `<div class="chat-bubble ai-bubble typing-indicator">
        <div class="ai-title">🧠 Thinking...</div>
        <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>`;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function appendChatMessage(role, response) {
    const container = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = `chat-msg chat-${role}`;
    if (role === 'user') {
        msg.innerHTML = `<div class="chat-bubble user-bubble">${response.summary}</div>`;
    } else {
        let html = `<div class="chat-bubble ai-bubble">`;
        if (response.title) html += `<div class="ai-title">${response.title}</div>`;
        if (response.summary) html += `<div class="ai-summary">${response.summary}</div>`;
        if (response.items && response.items.length > 0) html += `<div class="ai-items">${response.items.join('')}</div>`;
        html += `</div>`;
        msg.innerHTML = html;
    }
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function setupQuickQueries() {
    document.querySelectorAll('.quick-query').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('chat-input').value = btn.dataset.query;
            sendChat();
        });
    });
}

function animateEntrance() {
    document.querySelectorAll('.panel').forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        setTimeout(() => {
            el.style.transition = 'all 0.6s ease';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, i * 100);
    });
}

document.addEventListener('DOMContentLoaded', init);
