# 🌊 OceanWatch AI — Marine Environmental Intelligence Engine

An AI-powered geospatial intelligence engine for real-time marine environmental monitoring across 8 Indian Ocean zones. Uses live ocean data from Open-Meteo APIs and Google Gemini for intelligent natural language analysis.

> 📡 **Real-time data** — No simulated values. All SST, wind, and wave readings come from live weather APIs.  
> 🧠 **Gemini AI chat** — Ask questions in natural language and get expert marine analysis.  
> 💰 **$0 cost** — All APIs used are free with no credit card required.

---

## 🚀 Quick Start

### 1. Clone & Run
```bash
git clone https://github.com/prashantM83/ocean_watch_ai.git
cd ocean_watch_ai

# Option A: Use any static server
npx -y http-server -p 8080 -c-1

# Option B: VS Code Live Server
# Right-click index.html → "Open with Live Server"
```

### 2. Open in Browser
Navigate to `http://localhost:8080` — the dashboard loads automatically with live ocean data.

### 3. (Optional) Enable AI Chat
To get intelligent, conversational AI responses:
1. Get a free Gemini API key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Open the dashboard → type **"settings"** in the AI chat
3. Paste your key → click **"Save Key"**
4. Done! The AI now answers any ocean question intelligently.

> ⚠️ Without a Gemini key, the chat still works using built-in keyword matching — just less conversational.

---

## 📊 How It Works

### Data Flow
```
Open-Meteo Weather API ──→ SST (temperature_2m), Wind Speed
Open-Meteo Marine API  ──→ Wave Height, Wave Period, Ocean Currents
                              ↓
                    ┌─────────────────────┐
                    │   api.js (fetcher)   │
                    │  • Fetches 8 zones   │
                    │  • 7-day history     │
                    │  • Derives Chl & DO  │
                    └─────────┬───────────┘
                              ↓
                    ┌─────────────────────┐
                    │  engine.js (brain)   │
                    │  • Z-score analysis  │
                    │  • Pattern classify  │
                    │  • Adaptive learning │
                    │  • 3-day forecast    │
                    └─────────┬───────────┘
                              ↓
                    ┌─────────────────────┐
                    │   app.js (UI layer)  │
                    │  • Zone cards        │
                    │  • Leaflet map       │
                    │  • Chart.js graphs   │
                    │  • Alert feed        │
                    └─────────┬───────────┘
                              ↓
                    ┌─────────────────────┐
                    │  chat.js (AI chat)   │
                    │  • Gemini 2.5 Flash  │
                    │  • System prompt w/  │
                    │    live ocean context │
                    │  • Local fallback    │
                    └─────────────────────┘
```

### Data Sources

| Signal | Source | Type |
|--------|--------|------|
| Sea Surface Temperature | Open-Meteo Weather API | ✅ Real API |
| Wind Speed | Open-Meteo Weather API | ✅ Real API |
| Wave Height | Open-Meteo Marine API | ✅ Real API |
| Chlorophyll-a | Derived from real SST | 🔬 Scientific model |
| Dissolved Oxygen | Derived from real SST (Henry's Law) | 🔬 Scientific model |

> **Why derive Chlorophyll & DO?** There are no free real-time APIs for these biogeochemical signals. Instead, we derive them using established oceanographic relationships with real SST data — warmer water holds less oxygen (Henry's Law), and SST affects nutrient upwelling which controls chlorophyll.

---

## 🧠 Features

### 1. Real-Time Ocean Data (`api.js`)
- Fetches live SST, wind speed, wave height from Open-Meteo APIs
- 7 days of historical hourly data + 1 day forecast
- Derives chlorophyll-a and dissolved oxygen from real SST
- LocalStorage caching with 6-hour expiry
- Automatic fallback: API → Cache → Generated baseline data
- Retry logic with exponential backoff (3 attempts)

### 2. Intelligent Anomaly Detection (`engine.js`)
- Z-score based anomaly detection against rolling + seasonal baselines
- Multi-factor scoring: Magnitude × Duration × Signal Convergence
- Zones ranked by composite severity score (0–10)
- Event classification (coral bleaching, algal blooms, hypoxia, storms, etc.)

### 3. Adaptive Intelligence & Self-Correction
- Validate/Reject buttons on every alert
- Zone sensitivity auto-adjusts based on feedback
- False positive rate tracking per zone
- System learns to discount noisy zones over time

### 4. AI Chat Assistant (`chat.js`)
- **Gemini 2.5 Flash** integration for natural language analysis
- System prompt includes all real-time zone data as context
- Conversation history for follow-up questions
- Falls back to keyword matching if no API key/offline
- Typing indicator with animated dots
- Settings UI to manage API key

### 5. Interactive Dashboard (`app.js`)
- Zone cards ranked by anomaly severity
- Leaflet.js map with clickable zone markers
- Chart.js signal history graphs with baseline bands
- Smart alert feed with validate/reject workflow
- Quick-query buttons for common questions
- Data source badge: 🟢 LIVE / 🟡 CACHED / 🔴 OFFLINE
- Last-updated timestamp

---

## 🗂️ Project Structure

```
ocean_watch_ai/
├── index.html          → Dashboard UI (layout, panels, structure)
├── style.css           → Styling (dark theme, animations, responsive)
├── data.js             → Zone definitions, signal configs, seasonal baselines
├── api.js              → Real API data fetcher (Open-Meteo + derived signals)
├── engine.js           → Intelligence engine (anomaly detection, forecasting)
├── chat.js             → AI chat (Gemini integration + local fallback)
├── app.js              → Main controller (UI updates, map, charts, events)
├── .env.example        → API key documentation (for reference only)
├── .gitignore          → Protects sensitive files from GitHub
├── README.md           → This file
└── IMPLEMENTATION_PLAN.md → Full improvement plan (all phases)
```

---

## 🌊 Monitored Zones (Indian Ocean)

| # | Zone | Ecosystem | Coordinates |
|---|------|-----------|-------------|
| 1 | Arabian Sea North | Open Ocean | 18.92°N, 67.53°E |
| 2 | Gulf of Mannar | Coral Reef | 8.97°N, 78.14°E |
| 3 | Bay of Bengal West | Deep Ocean | 13.08°N, 80.76°E |
| 4 | Lakshadweep Sea | Coral Atoll | 10.57°N, 72.64°E |
| 5 | Andaman Sea | Coastal | 11.68°N, 92.72°E |
| 6 | Kerala Coastal | Upwelling Zone | 9.49°N, 75.87°E |
| 7 | Sundarbans Delta | Mangrove | 21.94°N, 89.18°E |
| 8 | Gujarat Coast | Coastal Industrial | 21.63°N, 69.61°E |

---

## 🏷️ Event Classifications

| Icon | Classification | Trigger Conditions |
|------|---------------|-------------------|
| 🪸 | CORAL_BLEACHING_RISK | High SST + low/declining chlorophyll |
| 🦠 | HARMFUL_ALGAL_BLOOM | High chlorophyll + declining DO |
| 🌿 | ALGAL_BLOOM_PRECURSOR | Elevated chlorophyll trending up |
| 💀 | HYPOXIA_WARNING | Critically low dissolved oxygen |
| 🌪️ | STORM_SURGE_RISK | High wind + high waves |
| ⚠️ | COMPOUND_STRESS | 3+ signals anomalous simultaneously |
| 🌡️ | THERMAL_ANOMALY | Significant SST deviation |

---

## 🔒 Privacy & Security

- **API keys are NEVER stored in source code** — they live in browser `localStorage` only
- `.gitignore` prevents accidental commits of `.env` files
- Gemini API key is sent ONLY to Google's API endpoint
- Ocean data APIs require no authentication at all

---

## 🛠️ Tech Stack

| Category | Technology | Cost |
|----------|-----------|------|
| Frontend | HTML5, CSS3, Vanilla JavaScript | Free |
| Map | Leaflet.js (CartoDB dark tiles) | Free |
| Charts | Chart.js | Free |
| Ocean Data | Open-Meteo Weather + Marine APIs | Free, no key |
| AI Chat | Google Gemini 2.5 Flash | Free tier (15 req/min) |
| Hosting | Any static server / GitHub Pages | Free |

**Total cost: $0** — This entire project runs on free APIs with no backend required.

---

## 📚 API Documentation

### Open-Meteo Weather API
- **URL**: `https://api.open-meteo.com/v1/forecast`
- **Docs**: [open-meteo.com/en/docs](https://open-meteo.com/en/docs)
- **Parameters used**: `temperature_2m`, `wind_speed_10m`
- **Rate limit**: None (fair use)

### Open-Meteo Marine API
- **URL**: `https://marine-api.open-meteo.com/v1/marine`
- **Docs**: [open-meteo.com/en/docs/marine-weather-api](https://open-meteo.com/en/docs/marine-weather-api)
- **Parameters used**: `wave_height`, `wave_period`, `ocean_current_velocity`
- **Rate limit**: None (fair use)

### Google Gemini API
- **URL**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash`
- **Docs**: [ai.google.dev/docs](https://ai.google.dev/docs)
- **Free tier**: 15 requests/minute, ~1,500/day
- **Get key**: [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

---

## 📜 License

MIT License — Free to use, modify, and distribute.
