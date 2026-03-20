// ============================================================
// OceanWatch AI — Main Application v2.0
// Dashboard controller, map, charts, UI updates
// Toast notifications, sound alerts, CSV export,
// theme toggle, keyboard shortcuts, zone comparison
// ============================================================

let allData, engine, assistant, map, zoneMarkers = {}, zoneLayers = {}, currentAnalyses = [];
let selectedZone = null, tempChart = null, signalCharts = {};
const PRIORITY_COLORS = { CRITICAL: '#ef4444', WARNING: '#f59e0b', ADVISORY: '#3b82f6', NORMAL: '#10b981' };
const CLASSIFICATION_ICONS = {
    CORAL_BLEACHING_RISK: '🪸', HARMFUL_ALGAL_BLOOM: '🦠', ALGAL_BLOOM_PRECURSOR: '🌿',
    HYPOXIA_WARNING: '💀', STORM_SURGE_RISK: '🌪️', COMPOUND_STRESS: '⚠️',
    THERMAL_ANOMALY: '🌡️', SIGNAL_DEVIATION: '📡', NORMAL: '✅'
};

// ---- Sound Alert (Web Audio API — no file needed) ----
let audioCtx = null;
function playAlertSound(priority) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        if (priority === 'CRITICAL') {
            osc.frequency.value = 880; gain.gain.value = 0.15;
            osc.type = 'square';
        } else {
            osc.frequency.value = 660; gain.gain.value = 0.08;
            osc.type = 'sine';
        }
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) { /* Audio not available */ }
}

// ---- Toast Notification System ----
let toastCounter = 0;
function showToast(message, priority = 'NORMAL', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${priority.toLowerCase()} toast-enter`;
    toast.id = `toast-${++toastCounter}`;
    toast.innerHTML = `
        <div class="toast-content">
            <span class="toast-icon">${priority === 'CRITICAL' ? '🚨' : priority === 'WARNING' ? '⚠️' : 'ℹ️'}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('toast-enter'));

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 400);
    }, duration);

    // Max 5 toasts
    while (container.children.length > 5) container.removeChild(container.firstChild);
}

// ---- CSV Export ----
function triggerCSVExport(type = 'zones') {
    const exportData = engine.getExportData(currentAnalyses, allData);
    let csv, filename;

    if (type === 'alerts') {
        const rows = exportData.alerts;
        if (rows.length === 0) { showToast('No alerts to export', 'WARNING'); return; }
        const headers = Object.keys(rows[0]);
        csv = headers.join(',') + '\n' + rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
        filename = `oceanwatch_alerts_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
        const rows = exportData.zones;
        const headers = Object.keys(rows[0]);
        csv = headers.join(',') + '\n' + rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
        filename = `oceanwatch_zones_${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`📥 Exported ${type} data as CSV`, 'NORMAL', 3000);
}

// ---- Theme Toggle ----
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const newTheme = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('oceanwatch_theme', newTheme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = newTheme === 'light' ? '🌙' : '☀️';
}

function loadTheme() {
    const saved = localStorage.getItem('oceanwatch_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = saved === 'light' ? '🌙' : '☀️';
}

// ---- Keyboard Shortcuts ----
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't capture when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            if (e.key === 'Escape') e.target.blur();
            return;
        }

        switch (e.key) {
            case '?':
                toggleShortcutHelp();
                break;
            case '/':
                e.preventDefault();
                document.getElementById('chat-input')?.focus();
                break;
            case 'Escape':
                closeAllModals();
                break;
            case 'e': case 'E':
                triggerCSVExport('zones');
                break;
            case 't': case 'T':
                toggleTheme();
                break;
            case '1': case '2': case '3': case '4':
            case '5': case '6': case '7': case '8':
                selectZone(`zone-${e.key}`);
                break;
        }
    });
}

function toggleShortcutHelp() {
    const modal = document.getElementById('shortcut-modal');
    if (modal) modal.classList.toggle('visible');
}

function closeAllModals() {
    document.getElementById('shortcut-modal')?.classList.remove('visible');
    document.getElementById('zone-detail')?.classList.remove('visible');
}

// ---- Init ----
async function init() {
    showLoading(true);
    setDataSourceStatus('loading');
    loadTheme();

    engine = new IntelligenceEngine();
    assistant = new AIAssistant(engine);
    initMap();

    try {
        allData = await fetchAllZonesData((zoneName, completed, total, hadError) => {
            updateLoadingProgress(zoneName, completed, total, hadError);
        });
        setDataSourceStatus('live');
        console.log('✅ Real API data loaded successfully for all zones');
    } catch (error) {
        console.error('API fetch failed, trying cache:', error);
        const cached = loadAllCachedData();
        if (cached && Object.keys(cached).length === ZONES.length) {
            allData = cached;
            setDataSourceStatus('cached');
            console.log('🟡 Using cached data');
        } else {
            console.warn('🔴 No cache available, generating fallback data');
            allData = {};
            const month = new Date().getMonth();
            ZONES.forEach(zone => { allData[zone.id] = generateFallbackData(zone, month); });
            setDataSourceStatus('fallback');
        }
    }

    engine.computeBaselines(allData);

    // Detect cross-zone correlations
    engine.detectCrossZonePatterns(allData);

    runAnalysis();
    showLoading(false);

    // Refresh with real API data every 60 seconds
    setInterval(updateCycle, API_CONFIG.refreshInterval);

    setupChat();
    setupQuickQueries();
    setupKeyboardShortcuts();
    animateEntrance();
    updateLastUpdated();

    // Register service worker
    registerServiceWorker();
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
            console.warn(`Update failed for ${zone.name}:`, e.message);
        }
    });

    await Promise.all(updatePromises);

    if (anySuccess) {
        setDataSourceStatus('live');
        saveCachedData(allData);
    }

    engine.computeBaselines(allData);
    engine.detectCrossZonePatterns(allData);
    runAnalysis();
    updateLastUpdated();

    // Persist engine state every cycle
    engine.saveState();
}

function updateUI(newAlerts) {
    updateZoneCards();
    updateMapMarkers();
    updateStatsBar();
    if (newAlerts.length > 0) {
        updateAlertFeed(newAlerts);
        // Toast + sound for new alerts
        newAlerts.forEach(alert => {
            showToast(`${CLASSIFICATION_ICONS[alert.classification] || '📡'} <strong>${alert.zoneName}</strong>: ${alert.classification.replace(/_/g, ' ')} (Score: ${alert.score})`, alert.priority, alert.priority === 'CRITICAL' ? 8000 : 5000);
            if (alert.priority === 'CRITICAL' || alert.priority === 'WARNING') {
                playAlertSound(alert.priority);
            }
        });
    }
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
                <button class="btn-validate" onclick="validateAlert('${alert.id}', true, this)">✅ Validate</button>
                <button class="btn-reject" onclick="validateAlert('${alert.id}', false, this)">❌ False Positive</button>
            </div>`;
        container.prepend(el);
        setTimeout(() => el.classList.remove('alert-enter'), 50);
    });
    while (container.children.length > 20) container.removeChild(container.lastChild);
}

function validateAlert(id, isValid, btn) {
    engine.validateAlert(id, isValid);
    const parent = btn.parentElement;
    if (isValid) {
        parent.innerHTML = '<span class="validated">✅ Validated — Zone + signal sensitivity increased</span>';
        showToast('Alert validated. Sensitivity calibrated.', 'NORMAL', 3000);
    } else {
        parent.innerHTML = '<span class="rejected">❌ False Positive — Zone + signal sensitivity reduced</span>';
        showToast('Marked as false positive. System will learn to discount similar signals.', 'ADVISORY', 4000);
    }
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

    document.getElementById('detail-zone-name').textContent = zone.name;
    document.getElementById('detail-zone-type').textContent = `${zone.ecosystemType} • ${zone.depth} • ${zone.region}`;
    document.getElementById('detail-priority').textContent = analysis.priority;
    document.getElementById('detail-priority').className = `detail-priority badge-${analysis.priority.toLowerCase()}`;
    document.getElementById('detail-score').textContent = `${analysis.anomalyScore}/10`;
    document.getElementById('detail-classification').textContent = `${CLASSIFICATION_ICONS[analysis.classification] || ''} ${analysis.classification.replace(/_/g, ' ')}`;
    document.getElementById('detail-explanation').textContent = analysis.classificationDetail;
    document.getElementById('detail-action').textContent = engine.getActionRec(analysis);

    // Signal cards with confidence intervals
    const sigContainer = document.getElementById('detail-signals');
    sigContainer.innerHTML = Object.entries(analysis.signals).map(([key, s]) => {
        const fc = engine.forecast(zoneId, key, 3);
        const trendIcon = s.trend === 'rising' ? '📈' : s.trend === 'falling' ? '📉' : '➡️';
        const sensLabel = s.signalSensitivity !== 1.0 ? `<div class="signal-sensitivity">Sens: ${s.signalSensitivity}x</div>` : '';
        return `<div class="signal-card ${s.isAnomaly ? 'signal-anomaly' : ''}">
            <div class="signal-header">${SIGNALS[key].icon} ${SIGNALS[key].shortName}</div>
            <div class="signal-value">${s.value} <small>${s.unit}</small></div>
            <div class="signal-baseline">Baseline: ${s.seasonalMean} ${s.unit}</div>
            <div class="signal-deviation ${s.deviationPercent > 0 ? 'dev-up' : 'dev-down'}">${s.deviationPercent > 0 ? '+' : ''}${s.deviationPercent}% ${trendIcon}</div>
            <div class="signal-zscore">Z-Score: ${s.effectiveZScore > 0 ? '+' : ''}${s.effectiveZScore}σ</div>
            ${fc ? `<div class="signal-forecast">3d: ${fc.projectedValue}${SIGNALS[key].unit} <small>[${fc.lowerBound}–${fc.upperBound}]</small><br><span class="risk-${fc.risk.toLowerCase()}">${fc.risk} risk</span> · ${fc.confidence}% conf</div>` : ''}
            ${sensLabel}
        </div>`;
    }).join('');

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
        const last72 = history.slice(-72);
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

    const geminiNote = assistant.geminiAvailable
        ? '🧠 <strong>Gemini AI active</strong> — I can answer any question about the ocean data!'
        : '💡 Type "settings" to activate Gemini AI for smarter responses.';
    appendChatMessage('assistant', assistant.fmt('🌊 OceanWatch AI Ready',
        `Monitoring ${ZONES.length} marine zones with <strong>real API data</strong>. ${geminiNote}<br>Try "What needs attention right now?" or press <kbd>/</kbd> to focus chat. <kbd>?</kbd> for shortcuts.`, []));
}

let isChatBusy = false;

async function sendChat() {
    const input = document.getElementById('chat-input');
    const query = input.value.trim();
    if (!query || isChatBusy) return;

    appendChatMessage('user', { title: '', summary: query, items: [] });
    input.value = '';

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

// ---- Service Worker Registration ----
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('✅ Service Worker registered', reg.scope);
        }).catch(err => {
            console.warn('SW registration failed:', err);
        });
    }
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
