/**
 * Frontend API Layer — 100% live Angel One data via Express backend.
 * Zero mock data, zero stored data.
 * Supports both NSE and BSE.
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type PatternCategory = "Breakout" | "Reversal" | "Momentum" | "Candlestick" | "Divergence" | "Support/Resistance";
export type TimeframeClass  = "Intraday" | "Swing" | "Positional";
export type Exchange        = "NSE" | "BSE";

export interface Signal {
  id: string;
  patternName: string;
  type: "Bullish" | "Bearish";
  patternCategory: PatternCategory;
  timeframeClass: TimeframeClass;
  explanation: { en: string; hi: string };
  confidenceScore: number;
  confidenceBreakdown: string;
  timeframe: string;
  entry: string;
  stopLoss: string;
  target1: string;
  target2: string;
  riskReward?: string;
  successRate: number;
  historicalOccurrences: number;
  volumeConfirmed: boolean;
  liveQuoteSource?: string;
  disclaimer: string;
  detectedAt: string;
}

export interface Stock {
  symbol: string;
  name: string;
  sector: string;
  exchange: Exchange;
  currentPrice: number;
  open: number;
  high: number;
  low: number;
  prevClose?: number;
  change: number;
  changePercent: number;
  volume: string;
  upperCircuit?: number | null;
  lowerCircuit?: number | null;
  week52High?: number | null;
  week52Low?: number | null;
  signals: Signal[];
  isWatchlisted: boolean;
  lastUpdated: string;
  exchFeedTime?: string | null;
}

export interface StockDetail extends Stock {
  chartData: Array<{
    date: string;
    price: number;
    open: number;
    high: number;
    low: number;
    volume: number;
  }>;
}

// ── Helper ───────────────────────────────────────────────────────────────────
async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── NSE Live screener ─────────────────────────────────────────────────────────
export async function fetchStocks(): Promise<Stock[]> {
  return apiFetch<Stock[]>("/api/stocks/screener");
}

// ── Alerts — live-quote-based pattern signals (no historical rate limits) ─────
export async function fetchAlerts(exchange: Exchange = "NSE"): Promise<Stock[]> {
  return apiFetch<Stock[]>(`/api/alerts?exchange=${exchange}`);
}

// ── BSE Live screener ─────────────────────────────────────────────────────────
export async function fetchBSEStocks(): Promise<Stock[]> {
  return apiFetch<Stock[]>("/api/stocks/screener/bse");
}

// ── Single stock detail ───────────────────────────────────────────────────────
export async function fetchStockDetail(symbol: string, exchange: Exchange = "NSE"): Promise<StockDetail | null> {
  try {
    return await apiFetch<StockDetail>(`/api/stocks/${symbol}?exchange=${exchange}`);
  } catch (err: any) {
    if (err.message?.includes("not found")) return null;
    throw err;
  }
}

// ── Live Market Quote (FULL mode — same as Angel One app) ────────────────────
export async function fetchMarketQuote(
  exchange: Exchange,
  tokens: string[],
  mode: "LTP" | "OHLC" | "FULL" = "FULL"
): Promise<any> {
  try {
    const p = new URLSearchParams({ exchange, tokens: tokens.join(","), mode });
    return await apiFetch(`/api/angelone/quote?${p}`);
  } catch { return {}; }
}

// ── LTP pass-through (legacy) ─────────────────────────────────────────────────
export async function fetchLTP(exchange: string, tradingSymbol: string, symbolToken: string): Promise<any | null> {
  try {
    return await apiFetch(`/api/angelone/ltp?exchange=${exchange}&tradingSymbol=${tradingSymbol}&symbolToken=${symbolToken}`);
  } catch { return null; }
}

// ── Historical candles ────────────────────────────────────────────────────────
export async function fetchHistoricalData(exchange: string, symbolToken: string, interval: string, fromDate: string, toDate: string): Promise<any[]> {
  try {
    const p = new URLSearchParams({ exchange, symbolToken, interval, fromDate, toDate });
    return await apiFetch(`/api/angelone/historical?${p}`);
  } catch { return []; }
}

// ── Holdings ──────────────────────────────────────────────────────────────────
export async function fetchHoldings(): Promise<any[]> {
  try { return await apiFetch("/api/angelone/holdings"); }
  catch { return []; }
}

// ── Scrip search (NSE or BSE) ─────────────────────────────────────────────────
export async function searchStock(query: string, exchange: Exchange = "NSE"): Promise<any[]> {
  try { return await apiFetch(`/api/angelone/search?exchange=${exchange}&q=${encodeURIComponent(query)}`); }
  catch { return []; }
}

// ── Session status ────────────────────────────────────────────────────────────
export async function checkAngelOneSession(): Promise<{ active: boolean; feedToken?: string }> {
  try {
    const data = await apiFetch<{ status: string; feedToken: string }>("/api/angelone/session");
    return { active: data.status === "active", feedToken: data.feedToken };
  } catch { return { active: false }; }
}
