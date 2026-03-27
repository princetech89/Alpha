# AlphaSignal — AI-Powered Stock Pattern Detection Platform

AlphaSignal is a full-stack web application that detects 28 technical chart patterns across NSE & BSE stocks in real time. It combines live market data from Angel One SmartAPI and Upstox with OpenAI GPT-4o-mini and Pinecone RAG to deliver AI-powered pattern signals, plain-English explanations, historical back-tested success rates, and an intelligent stock assistant.

---

## Features

- **Live Pattern Screener** — Detects 28 technical patterns across NSE & BSE stocks with confidence scores and historical back-tested success rates per stock per pattern
- **Real-time Price Streaming** — Live quotes streamed via Server-Sent Events (SSE) from Angel One (Upstox as fallback)
- **AI Pattern Explanations** — Per-pattern plain-English analysis using OpenAI GPT-4o-mini with entry, stop-loss, and target levels
- **Market Summary** — AI-generated market overview across the scanned universe
- **AlphaSignal Bot** — RAG-powered chat assistant grounded in a Pinecone knowledge base with streaming responses
- **Alerts System** — High-confidence pattern alerts filterable by exchange and pattern type
- **Stock Screener** — Filter by pattern, direction, exchange, sector, and confidence score
- **Stock Detail** — Full technical analysis with interactive charts (SMA, volume, volatility, indicators)
- **Global Search** — Instant symbol and company name lookup across NSE & BSE universe
- **User Authentication** — Secure session-based register/login with bcrypt password hashing
- **Profile Management** — Edit name, email, and phone from the in-app profile panel

---

## 28 Pattern Detectors

| # | Pattern | Category | Timeframe |
|---|---|---|---|
| 1 | Golden Cross / Death Cross | Momentum | Positional |
| 2 | RSI Bullish Divergence | Divergence | Swing |
| 3 | Bearish RSI Divergence | Divergence | Swing |
| 4 | MACD Crossover | Momentum | Swing |
| 5 | Double Bottom | Reversal | Swing |
| 6 | Double Top | Reversal | Swing |
| 7 | Head & Shoulders | Reversal | Positional |
| 8 | Inverted Head & Shoulders | Reversal | Positional |
| 9 | Rising Wedge | Reversal | Swing |
| 10 | Falling Wedge | Reversal | Swing |
| 11 | Cup & Handle | Breakout | Positional |
| 12 | Ascending Triangle | Breakout | Swing |
| 13 | Descending Triangle | Breakout | Swing |
| 14 | 52-Week High Breakout | Breakout | Positional |
| 15 | Bull Flag | Breakout | Swing |
| 16 | Bear Flag | Breakout | Swing |
| 17 | Bollinger Band Squeeze | Breakout | Swing |
| 18 | Support Bounce | Support/Resistance | Swing |
| 19 | Resistance Rejection | Support/Resistance | Swing |
| 20 | Hammer | Candlestick | Intraday |
| 21 | Shooting Star | Candlestick | Intraday |
| 22 | Bullish Engulfing | Candlestick | Swing |
| 23 | Bearish Engulfing | Candlestick | Swing |
| 24 | Three White Soldiers | Candlestick | Swing |
| 25 | Three Black Crows | Candlestick | Swing |
| 26 | Morning Star | Candlestick | Swing |
| 27 | Evening Star | Candlestick | Swing |
| 28 | Doji Variants | Candlestick | Swing |

Each pattern runs a walk-forward backtest on that stock's own 120-day history to compute a real success rate. A research-backed static rate is used as a fallback when historical data is insufficient.

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 19 + TypeScript | UI framework |
| Vite 7 | Build tool and dev server |
| Tailwind CSS v4 + Radix UI | Styling and design system |
| Framer Motion | Animations |
| TanStack React Query v5 | Server state management |
| Recharts | Charts and visualisations |
| Wouter | Client-side routing |

### Backend
| Technology | Purpose |
|---|---|
| Node.js + Express 5 | HTTP server |
| TypeScript + tsx | Runtime (no compile step in dev) |
| express-session + memorystore | Session management |
| bcrypt | Password hashing |
| Multer | PDF file uploads for knowledge base |
| Drizzle ORM | Database ORM |
| PostgreSQL (Neon) | Cloud database |

### AI & Market Data
| Service | Purpose |
|---|---|
| OpenAI GPT-4o-mini | Pattern explanations, market summary, full analysis |
| OpenAI text-embedding-3-small | Vector embeddings for RAG chatbot |
| Pinecone | Vector database for AlphaSignal Bot knowledge base |
| Angel One SmartAPI | Primary live quotes (FULL mode) and historical candles |
| Upstox Analytics API | Instrument master download + fallback historical candles |

### Python (Optional)
| Component | Purpose |
|---|---|
| `python/engine.py` | Alternative indicator computation (TA-Lib); TypeScript `calculateIndicators()` is the primary path; Python runs as a subprocess fallback |

---

## Project Structure

```
alphasignal/
├── client/                      # React frontend
│   ├── index.html
│   ├── public/                  # Static assets (favicon.svg, opengraph.jpg)
│   └── src/
│       ├── App.tsx              # Route definitions
│       ├── main.tsx             # React entry point
│       ├── index.css            # Global styles
│       ├── components/          # Shared UI components
│       │   ├── AlphaSignalLogo.tsx
│       │   ├── AnalysisCharts.tsx
│       │   ├── ChatBot.tsx
│       │   ├── GlobalSearch.tsx
│       │   ├── Layout.tsx       # App shell with collapsible sidebar
│       │   ├── ProfilePanel.tsx
│       │   └── ui/              # Radix UI base components (button, card, badge…)
│       ├── contexts/
│       │   └── AuthContext.tsx  # Session auth context
│       ├── hooks/
│       │   ├── useLivePrices.ts # SSE price subscription hook
│       │   └── useToast.ts
│       ├── lib/
│       │   ├── api.ts           # Typed fetch wrappers
│       │   ├── queryClient.ts   # React Query setup
│       │   └── utils.ts
│       └── pages/
│           ├── Dashboard.tsx    # Market overview + top signals
│           ├── Screener.tsx     # NSE / BSE pattern screener
│           ├── Alerts.tsx       # High-confidence alerts feed
│           ├── StockDetail.tsx  # Full stock analysis view
│           ├── Login.tsx        # Register / sign-in page
│           └── NotFound.tsx
├── server/                      # Express backend
│   ├── index.ts                 # Server entry point
│   ├── api/
│   │   ├── routes.ts            # All stock / AI / market API routes
│   │   └── auth.ts              # Auth routes (register, login, logout, profile)
│   ├── middleware/
│   │   ├── vite.ts              # Vite dev-server integration
│   │   └── static.ts            # Production static file serving
│   ├── services/
│   │   ├── angelone.ts          # Angel One SmartAPI client
│   │   ├── upstox.ts            # Upstox API client + dynamic symbol universe
│   │   ├── gemini.ts            # OpenAI GPT-4o-mini client (pattern AI)
│   │   └── pinecone.ts          # Pinecone RAG + OpenAI streaming chat
│   ├── db/
│   │   ├── db.ts                # Drizzle + pg connection pool
│   │   └── profileStore.ts      # User CRUD operations
│   └── data/
│       ├── pattern-engine.ts    # 28 pattern detectors + walk-forward backtest
│       ├── nse-symbols.ts       # Static NSE symbol list (304 symbols)
│       └── bse-symbols.ts       # Static BSE symbol list (67 symbols)
├── shared/
│   └── schema.ts                # Drizzle database schema (profileUsers table)
├── python/
│   └── engine.py                # Optional Python indicator engine (subprocess fallback)
├── scripts/
│   ├── build.ts                 # Production build script (esbuild + Vite)
│   └── ingest-kb.mjs            # Pinecone knowledge base PDF ingestion script
├── config/
│   └── vite-plugin-meta-images.ts
├── docs/                        # Project documentation PDFs
├── .env                         # Environment variables (never commit)
├── drizzle.config.ts
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database (Neon recommended — free tier works)
- API keys: Angel One SmartAPI, Upstox, OpenAI, Pinecone
- Python 3.10+ only if you want the optional Python indicator engine

### 1. Clone and install

```bash
git clone <repo-url>
cd alphasignal
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root with the following variables:

```env
# ── Angel One SmartAPI ────────────────────────────────────────────────────────
ANGEL_API_KEY=your_angel_api_key
ANGEL_CLIENT_ID=your_client_id
ANGEL_PASSWORD=your_login_password
ANGEL_TOTP_SECRET=your_totp_secret

# ── Upstox ────────────────────────────────────────────────────────────────────
# Used for instrument master download and fallback historical candles
UPSTOX_CLIENT_ID=your_upstox_client_id
UPSTOX_CLIENT_SECRET=your_upstox_client_secret
UPSTOX_REDIRECT_URI=http://localhost:5005/upstox-callback
UPSTOX_ANALYTICS_TOKEN=your_upstox_analytics_jwt_token

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...

# ── Pinecone (AlphaSignal Bot knowledge base) ─────────────────────────────────
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX=alphasignal-kb

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# ── Server ────────────────────────────────────────────────────────────────────
PORT=5005
SESSION_SECRET=your_random_secret_string
NODE_ENV=development
```

### 3. Push database schema

```bash
npm run db:push
```

This creates the `profileUsers` table in your PostgreSQL database.

### 4. (Optional) Ingest knowledge base documents

Place PDF files in the `docs/` folder, then run:

```bash
node scripts/ingest-kb.mjs
```

This indexes the PDFs into Pinecone so the AlphaSignal Bot can answer questions from them.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:5005](http://localhost:5005) in your browser.

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server (Express + Vite HMR on the same port) |
| `npm run build` | Build for production (esbuild server + Vite client) |
| `npm start` | Run the production build |
| `npm run check` | TypeScript type check (zero-error requirement) |
| `npm run db:push` | Push Drizzle schema changes to the database |

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create a new account |
| `POST` | `/api/auth/login` | Sign in with email + password |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET` | `/api/auth/me` | Get current session user |
| `PUT` | `/api/auth/profile` | Update profile (name, email, phone, optional new password) |

### Market Data & Pattern Screener
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stocks/screener` | NSE live pattern screener (cached 5 min) |
| `GET` | `/api/stocks/screener/bse` | BSE live pattern screener (cached 5 min) |
| `GET` | `/api/stocks/:symbol` | Full stock analysis for a single symbol |
| `GET` | `/api/alerts` | High-confidence pattern alert signals |
| `GET` | `/api/alerts/bse` | BSE-specific alert signals |
| `GET` | `/api/search` | Global stock search (NSE + BSE) |
| `GET` | `/api/prices/stream` | SSE live price stream |

### AI & Chat
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat/stream` | Streaming RAG chat (AlphaSignal Bot) |
| `POST` | `/api/gemini/explain` | AI explanation for a detected pattern |
| `POST` | `/api/gemini/market-summary` | AI-generated market summary |
| `POST` | `/api/gemini/analyze` | Full technical analysis for a stock |
| `POST` | `/api/kb/ingest` | Upload PDF to Pinecone knowledge base |

### Broker Integration
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/upstox/auth` | Initiate Upstox OAuth flow |
| `GET` | `/upstox-callback` | Upstox OAuth redirect handler |
| `GET` | `/api/upstox/status` | Upstox connection status |
| `GET` | `/api/angelone/session` | Angel One session status |

---

## How Pattern Detection Works

1. **Quote fetch** — Angel One SmartAPI batch-fetches live FULL quotes (up to 50 symbols per call) for all NSE/BSE symbols at scan time.
2. **Historical candles** — For each symbol, 120 days of daily candles are fetched from Angel One historical API. Upstox is used as a fallback if Angel One fails.
3. **Indicator computation** — TypeScript `calculateIndicators()` computes RSI, MACD, Bollinger Bands, SMA-20, SMA-50, ATR, and volume metrics. A Python subprocess (`engine.py`) is an optional fallback.
4. **28 detectors run** — Each of the 28 pattern functions evaluates the candle + indicator data and returns a `Signal` (or `null`).
5. **Walk-forward backtest** — For each detected pattern on each stock, `backtestPattern()` scans the stock's own history to compute a real historical success rate. Research-backed static rates are used when fewer than 1 occurrence is found.
6. **AI enrichment** — OpenAI GPT-4o-mini generates a plain-English explanation per pattern with context, entry/stop/target guidance.
7. **Cache** — Results are cached for 5 minutes. The server pre-warms both NSE and BSE caches on startup.

---

## Notes

- Market hours: **09:15 – 15:30 IST, Monday – Friday**
- All prices are in **INR (₹)**
- Pattern detection operates on **daily candles** (120-day lookback)
- The AlphaSignal Bot only answers **stock market and trading topics**
- For educational and research purposes only — **not SEBI-registered investment advice**

---

## License

MIT
