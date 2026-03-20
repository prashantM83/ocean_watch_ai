// ============================================================
// OceanWatch AI — Intelligent Query Interface
// Gemini LLM integration with fallback to pattern matching
// API key stored in localStorage only — never in source code
// ============================================================

const GEMINI_CONFIG = {
    model: 'gemini-2.5-flash',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/',
    maxTokens: 1024,
    temperature: 0.7,
    storageKey: 'oceanwatch_gemini_key'
};

class AIAssistant {
    constructor(engine) {
        this.engine = engine;
        this.history = [];
        this.geminiAvailable = false;
        this.checkGeminiKey();
    }

    // ---- API Key Management (localStorage only — never in code) ----

    checkGeminiKey() {
        const key = localStorage.getItem(GEMINI_CONFIG.storageKey);
        this.geminiAvailable = !!key && key.length > 10;
        return this.geminiAvailable;
    }

    setGeminiKey(key) {
        if (key && key.trim().length > 10) {
            localStorage.setItem(GEMINI_CONFIG.storageKey, key.trim());
            this.geminiAvailable = true;
            return true;
        }
        return false;
    }

    removeGeminiKey() {
        localStorage.removeItem(GEMINI_CONFIG.storageKey);
        this.geminiAvailable = false;
    }

    getGeminiKey() {
        return localStorage.getItem(GEMINI_CONFIG.storageKey);
    }

    // ---- Build context for Gemini ----

    buildSystemPrompt(analyses) {
        const zonesSummary = analyses.map(a => {
            const anomalousSignals = Object.entries(a.signals)
                .filter(([_, s]) => s.isAnomaly)
                .map(([k, s]) => `${SIGNALS[k].shortName}: ${s.value}${s.unit} (baseline: ${s.seasonalMean}${s.unit}, deviation: ${s.deviationPercent > 0 ? '+' : ''}${s.deviationPercent}%, trend: ${s.trend})`)
                .join('; ');

            return `- ${a.zone.name} [${a.zone.ecosystemType}, ${a.zone.region}]: Priority=${a.priority}, Score=${a.anomalyScore}/10, Classification=${a.classification.replace(/_/g, ' ')}, Detail="${a.classificationDetail}"${anomalousSignals ? `, Anomalous Signals: ${anomalousSignals}` : ''}`;
        }).join('\n');

        const alertsSummary = this.engine.alertHistory.slice(-5).reverse()
            .map(a => `- [${a.priority}] ${a.zoneName}: ${a.classification.replace(/_/g, ' ')} (Score: ${a.score}) — ${a.detail}`)
            .join('\n');

        return `You are OceanWatch AI, an expert marine environmental intelligence assistant monitoring ${ZONES.length} ocean zones around India. You analyze real-time ocean data from Open-Meteo APIs (SST, wind, waves) with scientifically derived chlorophyll and dissolved oxygen values.

CURRENT STATUS (live data):
${zonesSummary}

RECENT ALERTS:
${alertsSummary || 'No alerts yet.'}

DATA SOURCES:
- Sea Surface Temperature, Wind Speed: Real-time from Open-Meteo Weather API
- Wave Height: Real-time from Open-Meteo Marine API
- Chlorophyll-a: Derived from SST using oceanographic relationships
- Dissolved Oxygen: Derived from SST using Henry's Law

RESPONSE GUIDELINES:
- Be concise but informative, like a marine scientist briefing an operator
- Reference specific zone data, values, and trends when relevant
- Explain WHY anomalies matter (ecological impact on marine life, fisheries, coral)
- Suggest practical actions when relevant
- Use markdown-style formatting: **bold** for emphasis, numbers for lists
- Keep responses under 200 words unless the question demands more detail
- If asked about data sources, explain they're real APIs, not simulated`;
    }

    // ---- Gemini API Call ----

    async callGemini(query, analyses) {
        const key = this.getGeminiKey();
        if (!key) throw new Error('No API key');

        const systemPrompt = this.buildSystemPrompt(analyses);

        // Build conversation context (last 4 messages for continuity)
        const recentHistory = this.history.slice(-4).map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof h.content === 'string' ? h.content : (h.content.summary || h.content.title || '') }]
        }));

        const contents = [
            ...recentHistory,
            { role: 'user', parts: [{ text: query }] }
        ];

        const url = `${GEMINI_CONFIG.apiUrl}${GEMINI_CONFIG.model}:generateContent?key=${key}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: contents,
                generationConfig: {
                    temperature: GEMINI_CONFIG.temperature,
                    maxOutputTokens: GEMINI_CONFIG.maxTokens
                }
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty response from Gemini');

        return text;
    }

    // ---- Main Query Processing ----

    async processQuery(query, analyses) {
        const q = query.toLowerCase().trim();
        this.history.push({ role: 'user', content: query, time: new Date() });

        let resp;

        // Handle settings/key commands locally
        if (q === 'set api key' || q === 'settings' || q === 'api key') {
            resp = this.settingsAnswer();
        }
        // For structured data views, always use local (faster + better formatted)
        else if (this.matchesPattern(q, ['rank', 'compare', 'worst', 'best'])) {
            resp = this.ranking(analyses);
        }
        else if (this.matchesPattern(q, ['sensitivity', 'accuracy', 'adaptive', 'learning', 'false positive'])) {
            resp = this.adaptiveAnswer();
        }
        else if (this.matchesPattern(q, ['help', 'can you', 'what can'])) {
            resp = this.helpAnswer();
        }
        // For everything else, try Gemini first
        else if (this.geminiAvailable) {
            try {
                const geminiText = await this.callGemini(query, analyses);
                // Convert markdown to HTML-safe display
                const htmlText = this.markdownToHtml(geminiText);
                resp = this.fmt('🧠 OceanWatch AI', htmlText, []);
            } catch (error) {
                console.warn('Gemini call failed, falling back to local:', error.message);
                // Fallback to local pattern matching
                resp = this.localProcessQuery(q, analyses);

                // If it's an auth error, add a note
                if (error.message.includes('API_KEY') || error.message.includes('401') || error.message.includes('403')) {
                    resp.summary = `⚠️ AI key issue: ${error.message}<br><br>` + (resp.summary || '');
                }
            }
        }
        // No Gemini key — use local pattern matching
        else {
            resp = this.localProcessQuery(q, analyses);
        }

        this.history.push({ role: 'assistant', content: resp, time: new Date() });
        return resp;
    }

    // ---- Simple Markdown → HTML ----

    markdownToHtml(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
            .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');
    }

    // ---- Local Pattern Matching (Fallback) ----

    localProcessQuery(q, analyses) {
        if (this.matchesPattern(q, ['what needs attention', 'priority', 'urgent', 'critical', 'right now', 'overview', 'focus', 'important'])) return this.attention(analyses);
        else if (this.matchesPattern(q, ['forecast', 'predict', 'next', 'coming', 'future', 'trend', 'expect'])) return this.forecastAnswer(analyses);
        else if (this.matchesPattern(q, ['alert', 'notification', 'warning'])) return this.alertsAnswer();
        else if (this.matchesPattern(q, ['bleach', 'coral'])) return this.topicAnswer(analyses, 'CORAL_BLEACHING_RISK', 'THERMAL_ANOMALY', 'Coral Bleaching');
        else if (this.matchesPattern(q, ['bloom', 'algal', 'chlorophyll'])) return this.topicAnswer(analyses, 'HARMFUL_ALGAL_BLOOM', 'ALGAL_BLOOM_PRECURSOR', 'Algal Bloom');
        else if (this.matchesPattern(q, ['oxygen', 'hypoxia'])) return this.topicAnswer(analyses, 'HYPOXIA_WARNING', null, 'Hypoxia');
        else if (this.matchesPattern(q, ['zone', 'tell me', 'status', 'how is', 'about'])) {
            const zid = this.extractZone(q);
            return zid ? this.zoneAnswer(zid, analyses) : this.attention(analyses);
        }
        return this.generalAnswer(analyses);
    }

    matchesPattern(q, patterns) { return patterns.some(p => q.includes(p)); }

    extractZone(q) {
        for (const z of ZONES) {
            if (q.includes(z.name.toLowerCase()) || q.includes(z.shortName.toLowerCase())) return z.id;
        }
        const m = q.match(/zone\s*(\d+)/);
        if (m) { const n = parseInt(m[1]); if (n >= 1 && n <= ZONES.length) return `zone-${n}`; }
        return null;
    }

    // ---- Settings / Key Management ----

    settingsAnswer() {
        const hasKey = this.geminiAvailable;
        return this.fmt('⚙️ AI Settings', hasKey
            ? '✅ Gemini AI is active. Your API key is stored safely in your browser only.'
            : '⚠️ No Gemini API key set. Using basic pattern matching.',
            [`<div class="ai-zone-item">
                <strong>Gemini API Key</strong><br>
                <small>Stored in browser localStorage only — never in source code or sent anywhere except Google's Gemini API.</small><br><br>
                <input type="password" id="gemini-key-input" placeholder="Paste your Gemini API key..." 
                    value="${hasKey ? '••••••••••••••••••••' : ''}"
                    style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-glass);color:var(--text-primary);font-family:monospace;font-size:12px;">
                <div style="margin-top:8px;display:flex;gap:8px;">
                    <button onclick="saveGeminiKey()" style="padding:6px 14px;border-radius:6px;border:1px solid var(--normal);background:rgba(16,185,129,0.15);color:var(--normal);cursor:pointer;font-size:11px;">💾 Save Key</button>
                    <button onclick="removeGeminiKey()" style="padding:6px 14px;border-radius:6px;border:1px solid var(--critical);background:rgba(239,68,68,0.15);color:var(--critical);cursor:pointer;font-size:11px;">🗑️ Remove Key</button>
                </div>
                <small style="color:var(--text-muted);margin-top:8px;display:block;">Get a free key: <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--accent);">aistudio.google.com/app/apikey</a></small>
            </div>`]);
    }

    // ---- Structured Response Methods (unchanged) ----

    attention(analyses) {
        const sorted = [...analyses].sort((a, b) => b.anomalyScore - a.anomalyScore);
        const critical = sorted.filter(a => a.priority !== 'NORMAL');
        if (critical.length === 0) return this.fmt('✅ All Clear', 'All monitoring zones within normal parameters. No action required.', []);

        const items = critical.slice(0, 3).map((a, i) => {
            const sigs = Object.entries(a.signals).filter(([_, s]) => s.isAnomaly)
                .sort(([_, x], [__, y]) => Math.abs(y.effectiveZScore) - Math.abs(x.effectiveZScore))
                .slice(0, 2).map(([k, s]) => `${SIGNALS[k].icon} ${SIGNALS[k].shortName}: ${s.value}${s.unit} (${s.deviationPercent > 0 ? '+' : ''}${s.deviationPercent}%, ${s.trend})`);
            return `<div class="ai-zone-item priority-${a.priority.toLowerCase()}">
                <span class="ai-rank">#${i + 1}</span>
                <span class="ai-badge badge-${a.priority.toLowerCase()}">${a.priority}</span>
                <strong>${a.zone.name}</strong> — ${a.classification.replace(/_/g, ' ')} <span class="ai-score">Score: ${a.anomalyScore}/10</span>
                <div class="ai-signals">${sigs.join('<br>')}</div>
                <div class="ai-detail">${a.classificationDetail}</div>
                <div class="ai-action">📋 ${this.engine.getActionRec(a)}</div>
            </div>`;
        });
        return this.fmt(`🚨 ${critical.length} Zone(s) Require Attention`, `Top priority: <strong>${critical[0].zone.name}</strong> — ${critical[0].classification.replace(/_/g, ' ')}`, items);
    }

    zoneAnswer(zid, analyses) {
        const a = analyses.find(x => x.zoneId === zid);
        if (!a) return this.fmt('❓ Zone Not Found', 'Could not find the requested zone.', []);
        const rows = Object.entries(a.signals).map(([k, s]) =>
            `<tr class="${s.isAnomaly ? 'anomaly-row' : ''}"><td>${SIGNALS[k].icon} ${SIGNALS[k].shortName}</td><td>${s.value} ${s.unit}</td><td>${s.seasonalMean} ${s.unit}</td><td>${s.deviationPercent > 0 ? '+' : ''}${s.deviationPercent}%</td><td>${s.effectiveZScore > 0 ? '+' : ''}${s.effectiveZScore}σ</td><td>${s.trend} ${s.trend === 'rising' ? '📈' : s.trend === 'falling' ? '📉' : '➡️'}</td></tr>`
        );
        const table = `<table class="ai-table"><thead><tr><th>Signal</th><th>Current</th><th>Baseline</th><th>Deviation</th><th>Z-Score</th><th>Trend</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
        return this.fmt(
            `${a.zone.name} — <span class="ai-badge badge-${a.priority.toLowerCase()}">${a.priority}</span>`,
            `${a.classificationDetail}<br>Anomaly Score: <strong>${a.anomalyScore}/10</strong> | Converging Signals: <strong>${a.convergenceCount}/5</strong>`,
            [table, `<div class="ai-action">📋 ${this.engine.getActionRec(a)}</div>`]
        );
    }

    forecastAnswer(analyses) {
        const top = [...analyses].sort((a, b) => b.anomalyScore - a.anomalyScore).slice(0, 3);
        const items = top.map(a => {
            const fcs = Object.keys(SIGNALS).map(sig => {
                const fc = this.engine.forecast(a.zoneId, sig, 3);
                return fc && fc.risk !== 'LOW' ? `${SIGNALS[sig].icon} ${SIGNALS[sig].shortName}: ${fc.currentValue} → ${fc.projectedValue} ${SIGNALS[sig].unit} (${fc.direction}, ${fc.confidence}% confidence, risk: ${fc.risk})` : null;
            }).filter(Boolean);
            if (fcs.length === 0) return null;
            return `<div class="ai-zone-item"><strong>${a.zone.name}</strong> (Current Score: ${a.anomalyScore}/10)<div class="ai-signals">${fcs.join('<br>')}</div></div>`;
        }).filter(Boolean);
        return this.fmt('📈 3-Day Forecast', 'Projected trajectories for zones of concern:', items.length > 0 ? items : ['<p>No significant trend deviations projected in the next 72 hours.</p>']);
    }

    alertsAnswer() {
        const recent = this.engine.alertHistory.slice(-8).reverse();
        if (recent.length === 0) return this.fmt('🔔 Alert History', 'No alerts generated yet.', []);
        const items = recent.map(a =>
            `<div class="ai-zone-item priority-${a.priority.toLowerCase()}"><span class="ai-badge badge-${a.priority.toLowerCase()}">${a.priority}</span> <strong>${a.zoneName}</strong> — ${a.classification.replace(/_/g, ' ')} <span class="ai-score">Score: ${a.score}</span><div class="ai-detail">${a.detail}</div><small>${a.timestamp.toLocaleString()}</small></div>`
        );
        return this.fmt(`🔔 Recent Alerts (${this.engine.alertHistory.length} total)`, `${this.engine.alertHistory.filter(a => a.priority === 'CRITICAL').length} critical, ${this.engine.alertHistory.filter(a => a.priority === 'WARNING').length} warnings`, items);
    }

    topicAnswer(analyses, cls1, cls2, topic) {
        const matched = analyses.filter(a => a.classification === cls1 || (cls2 && a.classification === cls2));
        const items = matched.map(a => `<div class="ai-zone-item priority-${a.priority.toLowerCase()}"><strong>${a.zone.name}</strong> — Score: ${a.anomalyScore}/10<br>${a.classificationDetail}</div>`);
        return this.fmt(`${topic} Assessment`, matched.length > 0 ? `${matched.length} zone(s) showing ${topic.toLowerCase()} indicators.` : `No ${topic.toLowerCase()} risk currently detected.`, items);
    }

    ranking(analyses) {
        const sorted = [...analyses].sort((a, b) => b.anomalyScore - a.anomalyScore);
        const rows = sorted.map((a, i) =>
            `<tr class="priority-row-${a.priority.toLowerCase()}"><td>#${i + 1}</td><td>${a.zone.name}</td><td><span class="ai-badge badge-${a.priority.toLowerCase()}">${a.priority}</span></td><td>${a.anomalyScore}/10</td><td>${a.classification.replace(/_/g, ' ')}</td><td>${a.convergenceCount}/5</td></tr>`
        );
        return this.fmt('📊 Zone Rankings', 'All zones ranked by anomaly severity:',
            [`<table class="ai-table"><thead><tr><th>Rank</th><th>Zone</th><th>Status</th><th>Score</th><th>Classification</th><th>Converging</th></tr></thead><tbody>${rows.join('')}</tbody></table>`]);
    }

    adaptiveAnswer() {
        const stats = this.engine.getAdaptiveStats();
        const rows = Object.entries(stats).map(([zid, s]) => {
            const z = ZONES.find(x => x.id === zid);
            return `<tr><td>${z.name}</td><td>${s.totalAlerts}</td><td>${s.validated}</td><td>${s.falsePositives}</td><td>${s.accuracy !== null ? s.accuracy + '%' : 'N/A'}</td><td>${s.sensitivity.toFixed(2)}x</td></tr>`;
        });
        return this.fmt('🧠 Adaptive Intelligence Stats', 'System learns from validated/rejected alerts to adjust zone sensitivity:',
            [`<table class="ai-table"><thead><tr><th>Zone</th><th>Total</th><th>Validated</th><th>False +</th><th>Accuracy</th><th>Sensitivity</th></tr></thead><tbody>${rows.join('')}</tbody></table>`]);
    }

    helpAnswer() {
        const geminiStatus = this.geminiAvailable
            ? '<li>🧠 <strong>Gemini AI active</strong> — Ask me anything in natural language!</li>'
            : '<li>⚠️ <strong>Basic mode</strong> — Type "settings" to add Gemini API key for smarter AI</li>';
        return this.fmt('💡 How to Use OceanWatch AI', 'Ask me anything about the marine environment:', [
            `<ul class="ai-help-list">${geminiStatus}<li>"What needs attention right now?"</li><li>"Tell me about Zone 2" or "Status of Gulf of Mannar"</li><li>"What's the forecast?"</li><li>"Show me alerts"</li><li>"Coral bleaching risk?"</li><li>"Algal bloom status?"</li><li>"Oxygen levels?"</li><li>"Rank all zones"</li><li>"System accuracy?"</li><li>"Settings" — manage Gemini API key</li></ul>`
        ]);
    }

    generalAnswer(analyses) {
        const top = [...analyses].sort((a, b) => b.anomalyScore - a.anomalyScore)[0];
        return this.fmt('🌊 OceanWatch AI', `Monitoring ${ZONES.length} zones. Top concern: <strong>${top.zone.name}</strong> (Score: ${top.anomalyScore}/10). Try asking "What needs attention?" or "Tell me about Zone 2".`, []);
    }

    fmt(title, summary, items) {
        return { title, summary, items: items || [] };
    }
}

// ---- Global helper functions for the settings UI ----

function saveGeminiKey() {
    const input = document.getElementById('gemini-key-input');
    if (input && input.value && !input.value.includes('•')) {
        const success = assistant.setGeminiKey(input.value);
        if (success) {
            input.value = '••••••••••••••••••••';
            appendChatMessage('assistant', { title: '✅ API Key Saved', summary: 'Gemini AI is now active! Your key is stored in your browser only — it will never appear in source code.', items: [] });
        } else {
            appendChatMessage('assistant', { title: '❌ Invalid Key', summary: 'Please enter a valid Gemini API key.', items: [] });
        }
    }
}

function removeGeminiKey() {
    assistant.removeGeminiKey();
    const input = document.getElementById('gemini-key-input');
    if (input) input.value = '';
    appendChatMessage('assistant', { title: '🗑️ Key Removed', summary: 'Gemini API key has been removed. Using basic pattern matching mode.', items: [] });
}
