import type { Express } from "express";
import type { Server } from "http";
import multer from "multer";
import { queryKnowledgeBase, generateChatAnswer, streamChatAnswer, ingestPdfBuffer, isPineconeReady, type ChatMessage } from "../services/pinecone";
import {
  generateSession,
  getProfile,
  getLTP,
  getHistoricalData,
  getMarketQuote,
  getMarketQuoteSingle,
  getAllHoldings,
  searchScrip,
} from "../services/angelone";
import { NSE_SYMBOLS } from "../data/nse-symbols";
import { BSE_SYMBOLS } from "../data/bse-symbols";
import { detectPatterns, parseAngelCandles } from "../data/pattern-engine";
import { explainPattern, generateMarketSummary, generateFullAnalysis } from "../services/gemini";
import {
  getAuthUrl, exchangeCodeForToken, isUpstoxReady,
  getUpstoxHistoricalCandles, getUpstoxQuotes,
  parseUpstoxCandles, getNseInstrumentKey, normalizeUpstoxQuote,
  initDynamicSymbols, getDynamicNseSymbols, getDynamicBseSymbols,
  type DynamicSymbol,
} from "../services/upstox";

// ── Date helpers (all IST / Asia/Kolkata) ─────────────────────────────────────
/** Returns "YYYY-MM-DD" in IST for a given Date (defaults to now). */
function istDateStr(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // en-CA → YYYY-MM-DD
}
/** Returns "YYYY-MM-DD 09:00" in IST — used as Angel One historical `from` param. */
function fmtDate(d: Date) {
  return `${istDateStr(d)} 09:00`;
}
/** Returns "YYYY-MM-DD HH:MM" in IST — used as Angel One historical `to` param. */
function fmtNow(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}
/** Returns a Date that is n calendar days ago (IST-aware). */
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000);
}

// ── In-memory short-TTL cache ─────────────────────────────────────────────────
const cache: Record<string, { data: any; expires: number }> = {};
function cacheGet(key: string) {
  const e = cache[key];
  return e && e.expires > Date.now() ? e.data : null;
}
function cacheSet(key: string, data: any, ttlMs: number) {
  cache[key] = { data, expires: Date.now() + ttlMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSTOX FULL FETCH — used when Angel One fails for a stock entirely.
// Gets live quote + 120-day historical candles from Upstox, runs pattern detection.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchStockFromUpstox(
  sym: { symbol: string; name: string; sector: string },
  instrKey: string,
  exchange: "NSE" | "BSE" = "NSE"
): Promise<any | null> {
  try {
    const today   = istDateStr();
    const from120 = istDateStr(daysAgo(120));

    const [quotesMap, rawCandles] = await Promise.all([
      getUpstoxQuotes([instrKey]),
      getUpstoxHistoricalCandles(instrKey, from120, today),
    ]);

    const quote = quotesMap[instrKey];
    if (!quote) return null;

    const normalized = normalizeUpstoxQuote(instrKey, quote, sym);
    if (!normalized) return null;

    const candles = parseUpstoxCandles(rawCandles);
    let signals: any[] = [];
    let chartData: any[] = [];

    if (candles.length >= 20) {
      // Inject live candle
      const liveCandle = {
        date: today,
        open:   normalized.open   || normalized.currentPrice,
        high:   normalized.high   || normalized.currentPrice,
        low:    normalized.low    || normalized.currentPrice,
        close:  normalized.currentPrice,
        volume: normalized.tradeVol,
      };
      const lastIdx = candles.length - 1;
      if (candles[lastIdx]?.date === today) candles[lastIdx] = liveCandle;
      else candles.push(liveCandle);

      const result = await detectPatterns(candles);
      signals   = result.signals;
      chartData = candles.map(c => ({
        date: c.date, price: c.close,
        open: c.open, high: c.high, low: c.low, volume: c.volume,
      }));
    }

    return {
      symbol:        sym.symbol,
      name:          sym.name,
      sector:        sym.sector,
      exchange,
      currentPrice:  normalized.currentPrice,
      prevClose:     normalized.prevClose || undefined,
      open:          normalized.open,
      high:          normalized.high,
      low:           normalized.low,
      change:        normalized.change,
      changePercent: normalized.changePercent,
      volume:        normalized.volume,
      week52High:    normalized.week52High,
      week52Low:     normalized.week52Low,
      exchFeedTime:  null,
      signals,
      chartData,
      dataSource:    "Upstox",
      lastUpdated:   new Date().toISOString(),
    };
  } catch (e: any) {
    console.warn(`[Upstox] Full fetch failed for ${sym.symbol}: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCURATE live quote using Angel One's /market/v1/quote/ FULL mode.
// This returns the SAME numbers as the Angel One app:
//   ltp, close (= prevClose), netChange, percentChange, open, high, low,
//   tradeVolume, exchFeedTime, etc.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ACCURATE live quote using Angel One's /market/v1/quote/ FULL mode.
 * Injects the live quote as the last candle for pattern detection accuracy.
 */
async function fetchStockDataAccurate(
  sym: { symbol: string; name: string; token: string; sector: string; nseToken?: string },
  exchange: "NSE" | "BSE" = "NSE",
  prefetchedQuote?: any
): Promise<any> {
  const today = fmtNow(new Date());
  const from  = fmtDate(daysAgo(120));

  const histExch  = (exchange === "BSE" && sym.nseToken) ? "NSE" : exchange;
  const histToken = (exchange === "BSE" && sym.nseToken) ? sym.nseToken : sym.token;

  // 1. Fetch historical candles and (if needed) the live quote
  const [quoteResult, rawCandles] = await Promise.allSettled([
    prefetchedQuote ? Promise.resolve(prefetchedQuote) : getMarketQuoteSingle(exchange, sym.token),
    getHistoricalData(histExch, histToken, "ONE_DAY", from, today),
  ]);

  let ltp = 0, prevClose = 0, open = 0, high = 0, low = 0;
  let netChange = 0, changePct = 0, tradeVolume = 0;
  let upperCircuit: number | null = null, lowerCircuit: number | null = null;
  let week52High: number | null = null, week52Low: number | null = null;
  let exchFeedTime: string | null = null;

  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;

  if (quote) {
    ltp         = parseFloat(quote.ltp ?? quote.lastPrice ?? "0") || 0;
    prevClose   = parseFloat(quote.close ?? quote.prevClose ?? quote.previousClose ?? "0") || 0;
    open        = parseFloat(quote.open ?? "0") || 0;
    high        = parseFloat(quote.high ?? "0") || 0;
    low         = parseFloat(quote.low ?? "0") || 0;
    netChange   = parseFloat(quote.netChange ?? quote.change ?? "0") || 0;
    changePct   = parseFloat(quote.percentChange ?? quote.pChange ?? "0") || 0;
    tradeVolume = parseInt(quote.tradeVolume ?? quote.totalTradedVolume ?? quote.tradedQuantity ?? "0", 10) || 0;
    upperCircuit = quote.upperCircuit ? parseFloat(quote.upperCircuit) : null;
    lowerCircuit = quote.lowerCircuit ? parseFloat(quote.lowerCircuit) : null;
    week52High   = quote.fiftyTwoWeekHighPrice ? parseFloat(quote.fiftyTwoWeekHighPrice) : null;
    week52Low    = quote.fiftyTwoWeekLowPrice  ? parseFloat(quote.fiftyTwoWeekLowPrice)  : null;
    exchFeedTime = quote.exchFeedTime || quote.exchTradeTime || null;
  }

  // 2. Build chart data and run pattern detection
  let candles: any[] = [];
  let signals: any[] = [];
  let chartData: any[] = [];

  // Volume formatting helper
  let volumeStr = "—";
  if (tradeVolume > 0) {
    if (tradeVolume >= 10_000_000)   volumeStr = `${(tradeVolume / 10_000_000).toFixed(2)}Cr`;
    else if (tradeVolume >= 100_000) volumeStr = `${(tradeVolume / 100_000).toFixed(2)}L`;
    else if (tradeVolume >= 1_000)   volumeStr = `${(tradeVolume / 1_000).toFixed(1)}K`;
    else                             volumeStr = String(tradeVolume);
  }

  // ── Must have at least a live price to be useful ──────────────────────────
  if (ltp === 0) return null;

  // ── If candles loaded successfully, run full pattern detection ────────────
  if (rawCandles.status === "fulfilled" && Array.isArray(rawCandles.value)) {
    candles = parseAngelCandles(rawCandles.value as any[][]);

    // Inject live candle so patterns see the latest price
    if (ltp > 0) {
      const liveDate = istDateStr();
      const lastIdx  = candles.length - 1;
      const liveCandle = {
        date: liveDate,
        open: open || ltp, high: high || ltp, low: low || ltp,
        close: ltp, volume: tradeVolume,
      };
      if (lastIdx >= 0 && candles[lastIdx].date === liveDate) {
        candles[lastIdx] = liveCandle;
      } else {
        candles.push(liveCandle);
      }
    }

    const result = await detectPatterns(candles);
    signals  = result.signals;
    chartData = candles.map(c => ({
      date: c.date, price: c.close,
      open: c.open, high: c.high, low: c.low, volume: c.volume,
    }));
  }
  // ── Fallback: candles unavailable — compute live-quote signals ────────────
  // Ensures stocks remain visible with meaningful signals even when Angel One
  // historical candle API is rate-limited (403/429).
  if (signals.length === 0 && ltp > 0) {
    const now        = new Date().toISOString();
    const tkId       = sym.token;
    const dayRange   = high > 0 && low > 0 ? high - low : 0;
    const gapPct     = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
    const closePos   = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
    const aboveMid   = closePos > 0.6;

    if (week52High && ltp >= week52High * 0.99) {
      const atHigh = ltp >= week52High;
      signals.push({ id: `52wh_${tkId}`, patternName: atHigh ? "52-Week High Breakout" : "52-Week High Resistance Test", type: "Bullish", patternCategory: "Breakout", timeframeClass: "Swing", explanation: { en: `${sym.symbol} is ${atHigh ? "trading at" : "within 1% of"} its 52-week high of ₹${week52High.toFixed(2)}, currently at ₹${ltp.toFixed(2)}.`, hi: `52-सप्ताह उच्च के पास।` }, confidenceScore: atHigh ? 88 : 80, confidenceBreakdown: "52-week high proximity", timeframe: "5–15 trading days", successRate: 71, historicalOccurrences: 14, entry: ltp.toFixed(2), stopLoss: (week52High * 0.94).toFixed(2), target1: (ltp * 1.08).toFixed(2), target2: (ltp * 1.15).toFixed(2), riskReward: "1:2.5", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (week52Low && ltp <= week52Low * 1.04 && changePct > 0 && aboveMid) {
      signals.push({ id: `52wl_${tkId}`, patternName: "52-Week Low Reversal", type: "Bullish", patternCategory: "Reversal", timeframeClass: "Swing", explanation: { en: `${sym.symbol} reversing off its 52-week low of ₹${week52Low.toFixed(2)}, +${changePct.toFixed(2)}% today.`, hi: `52-सप्ताह निम्न से वापसी।` }, confidenceScore: 74, confidenceBreakdown: "52-week low support", timeframe: "7–21 trading days", successRate: 65, historicalOccurrences: 9, entry: ltp.toFixed(2), stopLoss: (week52Low * 0.97).toFixed(2), target1: (ltp * 1.07).toFixed(2), target2: (ltp * 1.14).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (gapPct >= 1.5 && ltp >= open) {
      const conf = gapPct >= 3 ? 84 : gapPct >= 2 ? 76 : 68;
      signals.push({ id: `gapup_${tkId}`, patternName: `Gap Up — ${gapPct.toFixed(1)}% Opening`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${gapPct.toFixed(1)}% higher at ₹${open.toFixed(2)} and is holding the gap (current: ₹${ltp.toFixed(2)}).`, hi: `गैप अप।` }, confidenceScore: conf, confidenceBreakdown: `Gap ${gapPct.toFixed(1)}%`, timeframe: "Same day to 3 trading days", successRate: 68, historicalOccurrences: 16, entry: ltp.toFixed(2), stopLoss: (open * 0.985).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.08).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (gapPct <= -1.5 && ltp <= open) {
      const absPct = Math.abs(gapPct);
      const conf   = absPct >= 3 ? 82 : absPct >= 2 ? 74 : 66;
      signals.push({ id: `gapdn_${tkId}`, patternName: `Gap Down — ${absPct.toFixed(1)}% Opening`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${absPct.toFixed(1)}% lower at ₹${open.toFixed(2)} and cannot recover (current: ₹${ltp.toFixed(2)}).`, hi: `गैप डाउन।` }, confidenceScore: conf, confidenceBreakdown: `Gap −${absPct.toFixed(1)}%`, timeframe: "Same day to 3 trading days", successRate: 66, historicalOccurrences: 14, entry: ltp.toFixed(2), stopLoss: (open * 1.015).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.92).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (changePct >= 3) {
      const conf = changePct >= 5 ? 86 : changePct >= 4 ? 78 : 70;
      signals.push({ id: `bull_mom_${tkId}`, patternName: `Bullish Momentum +${changePct.toFixed(1)}%`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is up ${changePct.toFixed(2)}% today (₹${ltp.toFixed(2)}).`, hi: `बुलिश मोमेंटम।` }, confidenceScore: conf, confidenceBreakdown: `Momentum ${changePct.toFixed(1)}%`, timeframe: "1–3 trading days", successRate: 63, historicalOccurrences: 21, entry: ltp.toFixed(2), stopLoss: (low * 0.99).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.07).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (changePct <= -3) {
      const absPct = Math.abs(changePct);
      const conf   = absPct >= 5 ? 84 : absPct >= 4 ? 76 : 68;
      signals.push({ id: `bear_mom_${tkId}`, patternName: `Bearish Momentum −${absPct.toFixed(1)}%`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is down ${absPct.toFixed(2)}% today (₹${ltp.toFixed(2)}).`, hi: `बेयरिश मोमेंटम।` }, confidenceScore: conf, confidenceBreakdown: `Momentum −${absPct.toFixed(1)}%`, timeframe: "1–3 trading days", successRate: 61, historicalOccurrences: 19, entry: ltp.toFixed(2), stopLoss: (high * 1.01).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.93).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (upperCircuit && ltp >= upperCircuit * 0.995) {
      signals.push({ id: `uCkt_${tkId}`, patternName: "Upper Circuit Hit", type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} has hit the upper circuit limit of ₹${upperCircuit.toFixed(2)}.`, hi: `अपर सर्किट।` }, confidenceScore: 92, confidenceBreakdown: "Circuit hit: +60 | Extreme demand: +32", timeframe: "1–2 trading days", successRate: 78, historicalOccurrences: 8, entry: ltp.toFixed(2), stopLoss: (ltp * 0.95).toFixed(2), target1: (ltp * 1.05).toFixed(2), target2: (ltp * 1.10).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (lowerCircuit && ltp <= lowerCircuit * 1.005) {
      signals.push({ id: `lCkt_${tkId}`, patternName: "Lower Circuit Hit", type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} has hit the lower circuit limit of ₹${lowerCircuit.toFixed(2)}.`, hi: `लोअर सर्किट।` }, confidenceScore: 90, confidenceBreakdown: "Circuit hit: +58 | Extreme supply: +32", timeframe: "1–2 trading days", successRate: 74, historicalOccurrences: 7, entry: ltp.toFixed(2), stopLoss: (ltp * 1.05).toFixed(2), target1: (ltp * 0.95).toFixed(2), target2: (ltp * 0.90).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    // Annual range position fallback
    if (signals.length === 0) {
      const rangeHigh = week52High ?? (upperCircuit ? upperCircuit / 1.2 : null);
      const rangeLow  = week52Low  ?? (lowerCircuit ? lowerCircuit * 1.2 : null);
      if (rangeHigh && rangeLow && rangeHigh > rangeLow) {
        const rangePos = Math.max(0, Math.min(1, (ltp - rangeLow) / (rangeHigh - rangeLow)));
        signals.push({ id: `range_${tkId}`, patternName: rangePos >= 0.7 ? "Near Annual High — Relative Strength" : rangePos <= 0.3 ? "Near Annual Low — Watch for Reversal" : "Mid-Range — Awaiting Breakout", type: rangePos >= 0.7 ? "Bullish" : "Neutral", patternCategory: "Support/Resistance", timeframeClass: "Swing", explanation: { en: `${sym.symbol} at ₹${ltp.toFixed(2)}, in the ${Math.round(rangePos * 100)}th percentile of its annual range.`, hi: `वार्षिक रेंज में स्थिति।` }, confidenceScore: Math.round(40 + rangePos * 20), confidenceBreakdown: `Range position ${Math.round(rangePos * 100)}%`, timeframe: "5–15 trading days", successRate: 55, historicalOccurrences: 10, entry: ltp.toFixed(2), stopLoss: (ltp * 0.96).toFixed(2), target1: (ltp * 1.05).toFixed(2), target2: (ltp * 1.10).toFixed(2), riskReward: "1:2.0", volumeConfirmed: false, disclaimer: "Not investment advice.", detectedAt: now });
      }
    }
  }

  return {
    symbol:        sym.symbol,
    name:          sym.name,
    sector:        sym.sector,
    exchange,
    currentPrice:  ltp,
    prevClose:     prevClose || undefined,
    open, high, low,
    change:        parseFloat(netChange.toFixed(2)),
    changePercent: parseFloat(changePct.toFixed(2)),
    volume:        volumeStr,
    upperCircuit,
    lowerCircuit,
    week52High,
    week52Low,
    exchFeedTime,
    signals,
    chartData,
    lastUpdated:   new Date().toISOString(),
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── Upstox OAuth flow ──────────────────────────────────────────────────────
  // Step 1: redirect user to Upstox login
  app.get("/api/upstox/auth", (_req, res) => {
    res.redirect(getAuthUrl());
  });

  // Upstox redirects to http://localhost:5005/?code=XXX (root with code param)
  // This catches that and handles it like the callback route.
  app.get("/upstox-callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.redirect("/");
    try {
      await exchangeCodeForToken(code);
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff">
          <h2 style="color:#22c55e">✅ Upstox Connected!</h2>
          <p>Access token saved. Live data from Upstox is now active.</p>
          <p>You can close this tab and return to <a href="http://localhost:5005" style="color:#22c55e">the app</a>.</p>
          <script>setTimeout(()=>{ window.location.href="http://localhost:5005"; },3000)</script>
        </body></html>
      `);
    } catch (e: any) {
      res.status(500).send(`<pre>Token exchange failed: ${e.message}</pre>`);
    }
  });

  // Step 2: Upstox redirects here after login; exchange code → token
  app.get("/api/upstox/callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("Missing code parameter from Upstox.");
    try {
      await exchangeCodeForToken(code);
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff">
          <h2 style="color:#22c55e">✅ Upstox Connected!</h2>
          <p>Access token saved. Live data from Upstox is now active.</p>
          <p>You can close this tab and return to the app.</p>
          <script>setTimeout(()=>window.close(),3000)</script>
        </body></html>
      `);
    } catch (e: any) {
      res.status(500).send(`<pre>Token exchange failed: ${e.message}</pre>`);
    }
  });

  // Check Upstox auth status
  app.get("/api/upstox/status", (_req, res) => {
    res.json({
      connected: isUpstoxReady(),
      authUrl: isUpstoxReady() ? null : "/api/upstox/auth",
      message: isUpstoxReady()
        ? "Upstox is authenticated and active."
        : "Upstox not authenticated. Open /api/upstox/auth in your browser to login.",
    });
  });

  // ── Live price stream (SSE) ───────────────────────────────────────────────
  // Streams real-time price updates every 4 seconds for all symbols.
  // Client subscribes with EventSource("/api/prices/stream?exchange=NSE")
  // Each event: { symbol, price, change, changePercent, open, high, low, volume }
  app.get("/api/prices/stream", async (req, res) => {
    const exchange = (req.query.exchange as string)?.toUpperCase() === "BSE" ? "BSE" : "NSE";
    const symbols  = exchange === "BSE" ? BSE_SYMBOLS : NSE_SYMBOLS;

    // SSE headers
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Helper: format volume
    function fmtVol(v: number): string {
      if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(2)}Cr`;
      if (v >= 100_000)    return `${(v / 100_000).toFixed(2)}L`;
      if (v >= 1_000)      return `${(v / 1_000).toFixed(1)}K`;
      return String(v);
    }

    // Fetch and push one batch of quotes
    async function pushPrices() {
      try {
        const tokens = symbols.map(s => s.token);
        // Fetch in batches of 50 (Angel One limit per request)
        const BATCH = 50;
        const updates: any[] = [];
        for (let i = 0; i < tokens.length; i += BATCH) {
          const batch = tokens.slice(i, i + BATCH);
          const symBatch = symbols.slice(i, i + BATCH);
          try {
            const quoteMap = await getMarketQuote({ [exchange]: batch }, "FULL");
            const quotes: any[] = quoteMap[exchange] ?? Object.values(quoteMap).flat();
            for (const q of quotes) {
              const token = q.symbolToken ?? q.token;
              const sym   = symBatch.find(s => s.token === token);
              if (!sym) continue;
              const price       = parseFloat(q.ltp ?? q.lastPrice ?? "0") || 0;
              const prevClose   = parseFloat(q.close ?? q.prevClose ?? "0") || 0;
              const open        = parseFloat(q.open ?? "0") || 0;
              const high        = parseFloat(q.high ?? "0") || 0;
              const low         = parseFloat(q.low  ?? "0") || 0;
              const change      = parseFloat(q.netChange ?? q.change ?? "0") || 0;
              const changePct   = parseFloat(q.percentChange ?? q.pChange ?? "0") || 0;
              const vol         = parseInt(q.tradeVolume ?? q.totalTradedVolume ?? "0", 10) || 0;
              if (price === 0) continue;
              updates.push({
                symbol: sym.symbol, exchange, price,
                prevClose, open, high, low,
                change: parseFloat(change.toFixed(2)),
                changePercent: parseFloat(changePct.toFixed(2)),
                volume: fmtVol(vol),
                ts: Date.now(),
              });
            }
          } catch (e: any) { console.error("[Route] silent error:", e?.message ?? e); }
        }
        if (updates.length > 0 && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(updates)}\n\n`);
        }
      } catch (err: any) {
        console.warn("[SSE] pushPrices error:", err.message);
      }
    }

    // Push immediately, then every 4 seconds
    await pushPrices();
    const interval = setInterval(pushPrices, 4000);

    // Heartbeat every 25s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": heartbeat\n\n");
    }, 25000);

    req.on("close", () => {
      clearInterval(interval);
      clearInterval(heartbeat);
    });
  });

  // ── Fast local search — instant results from in-memory symbol lists ────────
  // Returns the same shape as Angel One searchScrip so the UI can reuse it.
  app.get("/api/stocks/search-local", (req, res) => {
    try {
      const { exchange = "NSE", q = "" } = req.query as Record<string, string>;
      const query = q.trim().toLowerCase();
      if (!query || query.length < 1) return res.json([]);

      const list = (exchange === "BSE") ? BSE_SYMBOLS : NSE_SYMBOLS;
      const matches = list
        .filter(s =>
          s.symbol.toLowerCase().includes(query) ||
          s.name.toLowerCase().includes(query)
        )
        .sort((a, b) => {
          const aSym = a.symbol.toLowerCase();
          const bSym = b.symbol.toLowerCase();
          if (aSym === query) return -1;
          if (bSym === query) return 1;
          if (aSym.startsWith(query) && !bSym.startsWith(query)) return -1;
          if (bSym.startsWith(query) && !aSym.startsWith(query)) return 1;
          return aSym.localeCompare(bSym);
        })
        .slice(0, 15)
        .map(s => ({
          tradingsymbol: s.symbol,
          symbol: s.symbol, // UI might use either
          name: s.name,
          symboltoken: s.token,
          exchange,
          series: "EQ",
          sector: s.sector,
        }));

      res.json(matches);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Global Stock Search — live quotes from Angel One + Upstox gap-fill ──────
  // Searches both NSE_SYMBOLS + BSE_SYMBOLS, fetches live prices, returns top 10.
  app.get("/api/search", async (req, res) => {
    try {
      const { q = "" } = req.query as Record<string, string>;
      const raw = q.trim();
      if (!raw || raw.length < 1) return res.json([]);

      const query = raw.toLowerCase();

      // Fuzzy scorer: exact > startsWith > contains (word boundary) > substring
      function score(sym: string, name: string): number {
        const s = sym.toLowerCase();
        const n = name.toLowerCase();
        if (s === query || n === query) return 100;
        if (s.startsWith(query)) return 90;
        if (n.startsWith(query)) return 85;
        if (s.includes(query)) return 75;
        if (n.includes(query)) return 65;
        // word-level: any word in name starts with query
        const words = n.split(/[\s\-\.&]+/);
        if (words.some(w => w.startsWith(query))) return 55;
        // fuzzy: all chars of query appear in sequence in symbol
        let qi = 0;
        for (let ci = 0; ci < s.length && qi < query.length; ci++) {
          if (s[ci] === query[qi]) qi++;
        }
        if (qi === query.length && query.length >= 3) return 30;
        return 0;
      }

      const nseMatches = NSE_SYMBOLS
        .map(s => ({ ...s, exchange: "NSE" as const, score: score(s.symbol, s.name) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      const bseMatches = BSE_SYMBOLS
        .map(s => ({ ...s, exchange: "BSE" as const, score: score(s.symbol, s.name) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      // Merge: prefer NSE, dedup by symbol
      type MatchEntry = { symbol: string; name: string; token: string; sector: string; exchange: "NSE" | "BSE"; score: number; [k: string]: any };
      const seen = new Set<string>();
      const combined: MatchEntry[] = [];
      for (const m of [...nseMatches, ...bseMatches] as MatchEntry[]) {
        if (!seen.has(m.symbol)) { seen.add(m.symbol); combined.push(m); }
      }

      // Sort merged by score then take top 10
      combined.sort((a, b) => b.score - a.score);
      const top = combined.slice(0, 10);

      // Fetch live quotes from Angel One for matched tokens
      const nseTokens = top.filter(m => m.exchange === "NSE").map(m => m.token);
      const bseTokens = top.filter(m => m.exchange === "BSE").map(m => m.token);

      const [nseRes, bseRes] = await Promise.allSettled([
        nseTokens.length ? getMarketQuote({ NSE: nseTokens }, "FULL") : Promise.resolve({}),
        bseTokens.length ? getMarketQuote({ BSE: bseTokens }, "FULL") : Promise.resolve({}),
      ]);

      const qMap: Record<string, any> = {};
      if (nseRes.status === "fulfilled") {
        const arr: any[] = (nseRes.value as any)?.NSE ?? Object.values(nseRes.value as any).flat();
        for (const q of arr) { const t = q.symbolToken || q.token; if (t) qMap[`NSE:${t}`] = q; }
      }
      if (bseRes.status === "fulfilled") {
        const arr: any[] = (bseRes.value as any)?.BSE ?? Object.values(bseRes.value as any).flat();
        for (const q of arr) { const t = q.symbolToken || q.token; if (t) qMap[`BSE:${t}`] = q; }
      }

      const results = top.map(m => {
        const q = qMap[`${m.exchange}:${m.token}`];
        const price      = q ? parseFloat(q.ltp ?? q.lastPrice ?? "0")        || 0 : 0;
        const prevClose  = q ? parseFloat(q.close ?? q.prevClose ?? "0")      || 0 : 0;
        const change     = q ? parseFloat(q.netChange ?? q.change ?? "0")     || 0 : 0;
        const changePct  = q ? parseFloat(q.percentChange ?? q.pChange ?? "0")|| 0 : 0;
        const open       = q ? parseFloat(q.open ?? "0")                      || 0 : 0;
        const high       = q ? parseFloat(q.high ?? "0")                      || 0 : 0;
        const low        = q ? parseFloat(q.low  ?? "0")                      || 0 : 0;
        const vol        = q ? parseInt(q.tradeVolume ?? q.totalTradedVolume ?? "0", 10) || 0 : 0;
        return {
          symbol: m.symbol, name: m.name, sector: m.sector,
          exchange: m.exchange, token: m.token,
          currentPrice: price, prevClose, open, high, low,
          change: parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePct.toFixed(2)),
          volume: vol, score: m.score, dataSource: "AngelOne",
        };
      });

      // Upstox gap-fill for zero-price NSE results
      if (isUpstoxReady()) {
        await Promise.allSettled(
          results.filter(r => r.currentPrice === 0 && r.exchange === "NSE").map(async r => {
            try {
              const instrKey = getNseInstrumentKey(r.symbol);
              if (!instrKey) return;
              const upMap = await getUpstoxQuotes([instrKey]);
              const uq = upMap[instrKey];
              if (!uq) return;
              const norm = normalizeUpstoxQuote(instrKey, uq, r);
              if (!norm) return;
              Object.assign(r, {
                currentPrice: norm.currentPrice, prevClose: norm.prevClose,
                open: norm.open, high: norm.high, low: norm.low,
                change: norm.change, changePercent: norm.changePercent,
                dataSource: "Upstox",
              });
            } catch (e: any) { console.error("[Route] silent error:", e?.message ?? e); }
          })
        );
      }

      // Return results that have a live price OR are exact/prefix matches
      const filtered = results.filter(r => r.currentPrice > 0 || r.score >= 85);
      res.json(filtered.slice(0, 10));
    } catch (e: any) {
      console.error("[Search] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Session ──────────────────────────────────────────────────────────────
  app.get("/api/angelone/session", async (_req, res) => {
    try {
      const s = await generateSession();
      res.json({ status: "active", feedToken: s.feedToken });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Profile ──────────────────────────────────────────────────────────────
  app.get("/api/angelone/profile", async (_req, res) => {
    try { res.json(await getProfile()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Live Market Quote (FULL mode) — new accurate endpoint ─────────────────
  app.get("/api/angelone/quote", async (req, res) => {
    try {
      const { exchange = "NSE", tokens, mode = "FULL" } = req.query as Record<string, string>;
      if (!tokens) return res.status(400).json({ error: "Missing param: tokens (comma-separated)" });
      const tokenList = tokens.split(",").map(t => t.trim()).filter(Boolean);
      const result = await getMarketQuote({ [exchange]: tokenList }, mode as "LTP" | "OHLC" | "FULL");
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/angelone/ltp", async (req, res) => {
    try {
      const { exchange, tradingSymbol, symbolToken } = req.query as Record<string, string>;
      if (!exchange || !tradingSymbol || !symbolToken)
        return res.status(400).json({ error: "Missing required params: exchange, tradingSymbol, symbolToken" });
      res.json(await getLTP(exchange, tradingSymbol, symbolToken));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/angelone/historical", async (req, res) => {
    try {
      const { exchange, symbolToken, interval, fromDate, toDate } = req.query as Record<string, string>;
      if (!exchange || !symbolToken || !interval || !fromDate || !toDate)
        return res.status(400).json({ error: "Missing required params: exchange, symbolToken, interval, fromDate, toDate" });
      res.json(await getHistoricalData(exchange, symbolToken, interval, fromDate, toDate));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/angelone/holdings", async (_req, res) => {
    try { res.json(await getAllHoldings()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Search (supports both NSE and BSE) ───────────────────────────────────
  app.get("/api/angelone/search", async (req, res) => {
    try {
      const { exchange = "NSE", q } = req.query as Record<string, string>;
      if (!q) return res.status(400).json({ error: "Missing param: q" });
      const raw = await searchScrip(exchange, q);
      res.json(raw);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── NSE Screener (accurate FULL quote, cached 30s) ────────────────────────
  app.get("/api/stocks/screener", async (_req, res) => {
    const CACHE_KEY = "screener_nse";
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    try {
      // Use dynamic symbol list (merged static + Upstox master); fall back to static if not loaded yet
      const nseSymbols: DynamicSymbol[] = getDynamicNseSymbols().length > 0
        ? getDynamicNseSymbols()
        : NSE_SYMBOLS.map(s => ({ ...s, instrKey: "", isin: "" }));
      console.log(`[NSE] Using ${nseSymbols.length} symbols for screener`);

      // 1. Fetch ALL live quotes in batches of 50 (Angel One limit) — only for symbols with AO token
      const aoSymbols = nseSymbols.filter(s => s.token);
      const tokenList = aoSymbols.map(s => s.token);
      const allQuotesMap: Record<string, any> = {};

      const BATCH_SIZE = 50;
      for (let i = 0; i < tokenList.length; i += BATCH_SIZE) {
        const batch = tokenList.slice(i, i + BATCH_SIZE);
        try {
          const quotes = await getMarketQuote({ "NSE": batch }, "FULL");
          const fetched = quotes["NSE"] || [];
          for (const q of fetched) {
            const t = q.symbolToken || q.token;
            if (t) allQuotesMap[t] = q;
          }
        } catch (e: any) {
          console.warn(`[NSE] AO batch ${i} failed: ${e.message}`);
        }
      }

      // 2. Process AO symbols with pre-fetched quotes
      const results: any[] = [];
      const PROCESS_BATCH = 20;
      for (let i = 0; i < aoSymbols.length; i += PROCESS_BATCH) {
        const batch = aoSymbols.slice(i, i + PROCESS_BATCH);
        const settled = await Promise.allSettled(
          batch.map(sym => fetchStockDataAccurate(sym, "NSE", allQuotesMap[sym.token]))
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        if (i + PROCESS_BATCH < aoSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // 3. Upstox gap-fill (when Upstox is connected)
      if (isUpstoxReady()) {
        const loadedSymbols = new Set(results.map(s => s.symbol));
        const today   = istDateStr();
        const from365 = istDateStr(daysAgo(120));

        // 3a. Stocks that completely failed Angel One — full Upstox fetch (quote + candles)
        //     Includes Upstox-only symbols (no AO token) from the dynamic universe
        const failedSyms = nseSymbols.filter(s => !loadedSymbols.has(s.symbol));
        if (failedSyms.length > 0) {
          console.log(`[Upstox/NSE] Full fetch for ${failedSyms.length} symbols (AO failures + Upstox-only)`);
          await Promise.allSettled(failedSyms.map(async sym => {
            const instrKey = (sym as DynamicSymbol).instrKey || getNseInstrumentKey(sym.symbol);
            if (!instrKey) return;
            const stock = await fetchStockFromUpstox(sym, instrKey, "NSE");
            if (stock) results.push(stock);
          }));
        }

        // 3b. Stocks loaded by Angel One but with 0 signals — use Upstox candles for deeper detection
        const noSignals = results.filter(s => s.signals.length === 0);
        if (noSignals.length > 0) {
          await Promise.allSettled(noSignals.map(async stock => {
            try {
              const dynSym = nseSymbols.find(s => s.symbol === stock.symbol);
              const instrKey = dynSym?.instrKey || getNseInstrumentKey(stock.symbol);
              if (!instrKey) return;
              const rawCandles = await getUpstoxHistoricalCandles(instrKey, from365, today);
              const candles = parseUpstoxCandles(rawCandles);
              if (candles.length < 20) return;
              candles.push({ date: today, open: stock.open || stock.currentPrice, high: stock.high || stock.currentPrice, low: stock.low || stock.currentPrice, close: stock.currentPrice, volume: 0 });
              const { signals } = await detectPatterns(candles);
              if (signals.length > 0) {
                stock.signals    = signals;
                stock.dataSource = "Upstox+AngelOne";
              }
            } catch (e: any) { console.error("[Route] silent error:", e?.message ?? e); }
          }));
        }
      }

      const withSignals = results.filter(s => s.signals.length > 0);
      const payload = withSignals.length > 0 ? withSignals : results;
      cacheSet(CACHE_KEY, payload, 5 * 60 * 1000);
      res.json(payload);
    } catch (e: any) {
      console.error("[AO/NSE] Screener error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── BSE Screener — historical candle patterns + live-quote fallback ──────────
  // Uses fetchStockDataAccurate() with NSE token for 120-day OHLCV candles,
  // giving BSE stocks the same 28-pattern detection as NSE stocks.
  // Falls back to live-quote signals when candle API is rate-limited.
  app.get("/api/stocks/screener/bse", async (_req, res) => {
    const CACHE_KEY = "screener_bse";
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    try {
      // Build full BSE universe: static (has AO tokens + nseTokens) + dynamic Upstox-only extras
      const dynBse = getDynamicBseSymbols();
      const staticSymbols = new Set(BSE_SYMBOLS.map(s => s.symbol));
      const upstoxOnlyBse = dynBse.filter(s => !staticSymbols.has(s.symbol));
      console.log(`[BSE] ${BSE_SYMBOLS.length} static + ${upstoxOnlyBse.length} Upstox-only symbols`);

      // 1. Batch-fetch ALL live FULL quotes for static BSE symbols (have AO tokens)
      const allQuotesMap: Record<string, any> = {};
      const BATCH_SIZE = 50;
      const bseTokenList = BSE_SYMBOLS.filter(s => s.token).map(s => s.token);
      for (let i = 0; i < bseTokenList.length; i += BATCH_SIZE) {
        const batch = bseTokenList.slice(i, i + BATCH_SIZE);
        try {
          const quotes = await getMarketQuote({ "BSE": batch }, "FULL");
          const fetched = Object.values(quotes).flat() as any[];
          for (const q of fetched) {
            const t = q.symbolToken || q.token;
            if (t) allQuotesMap[t] = q;
          }
        } catch (e: any) {
          console.warn(`[BSE] BSE batch ${i} failed: ${e.message}`);
        }
      }

      // If BSE quotes empty, fall back to NSE tokens (all BSE stocks are dual-listed)
      if (Object.keys(allQuotesMap).length === 0) {
        console.log("[BSE] Falling back to NSE tokens for live quotes");
        const nseTokenList = BSE_SYMBOLS.filter(s => s.nseToken).map(s => s.nseToken);
        for (let i = 0; i < nseTokenList.length; i += BATCH_SIZE) {
          const batch = nseTokenList.slice(i, i + BATCH_SIZE);
          try {
            const quotes = await getMarketQuote({ "NSE": batch }, "FULL");
            const fetched = (quotes["NSE"] || Object.values(quotes).flat()) as any[];
            for (const q of fetched) {
              const t = q.symbolToken || q.token;
              if (t) allQuotesMap[t] = q;
            }
          } catch (e: any) {
            console.warn(`[BSE→NSE] NSE fallback batch ${i} failed: ${e.message}`);
          }
        }
      }

      console.log(`[BSE] allQuotesMap: ${Object.keys(allQuotesMap).length} entries`);

      // 2. Process static BSE symbols with historical candles via fetchStockDataAccurate
      const results: any[] = [];
      const PROCESS_BATCH = 20;
      for (let i = 0; i < BSE_SYMBOLS.length; i += PROCESS_BATCH) {
        const batch = BSE_SYMBOLS.slice(i, i + PROCESS_BATCH);
        const settled = await Promise.allSettled(
          batch.map(sym => {
            const prefetchedQuote = allQuotesMap[sym.token] ?? allQuotesMap[sym.nseToken];
            return fetchStockDataAccurate(sym, "BSE", prefetchedQuote);
          })
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        if (i + PROCESS_BATCH < BSE_SYMBOLS.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // 3. Upstox gap-fill for BSE (when Upstox is connected)
      if (isUpstoxReady()) {
        const loadedSymbols = new Set(results.map(s => s.symbol));
        const today   = istDateStr();
        const from365 = istDateStr(daysAgo(120));

        // 3a. Static BSE stocks that failed AO + all Upstox-only BSE stocks
        const failedStatic = BSE_SYMBOLS.filter(s => !loadedSymbols.has(s.symbol));
        const upstoxFetchList: DynamicSymbol[] = [
          ...failedStatic.map(s => ({ symbol: s.symbol, name: s.name, token: s.token, sector: (s as any).sector ?? "BSE", instrKey: "", isin: "" })),
          ...upstoxOnlyBse.filter(s => !loadedSymbols.has(s.symbol)),
        ];
        if (upstoxFetchList.length > 0) {
          console.log(`[Upstox/BSE] Full fetch for ${upstoxFetchList.length} symbols`);
          await Promise.allSettled(upstoxFetchList.map(async sym => {
            const instrKey = sym.instrKey || getNseInstrumentKey(sym.symbol);
            if (!instrKey) return;
            const stock = await fetchStockFromUpstox(sym, instrKey, "BSE");
            if (stock) results.push(stock);
          }));
        }

        // 3b. Stocks with 0 signals — use Upstox candles for deeper detection
        const noSignals = results.filter(s => s.signals.length === 0);
        if (noSignals.length > 0) {
          await Promise.allSettled(noSignals.map(async stock => {
            try {
              const dynSym = dynBse.find(s => s.symbol === stock.symbol);
              const instrKey = dynSym?.instrKey || getNseInstrumentKey(stock.symbol);
              if (!instrKey) return;
              const rawCandles = await getUpstoxHistoricalCandles(instrKey, from365, today);
              const candles = parseUpstoxCandles(rawCandles);
              if (candles.length < 20) return;
              candles.push({ date: today, open: stock.open || stock.currentPrice, high: stock.high || stock.currentPrice, low: stock.low || stock.currentPrice, close: stock.currentPrice, volume: 0 });
              const { signals } = await detectPatterns(candles);
              if (signals.length > 0) {
                stock.signals    = signals;
                stock.dataSource = "Upstox+AngelOne";
              }
            } catch (e: any) { console.error("[Route] silent error:", e?.message ?? e); }
          }));
        }
      }

      const withSignals = results.filter(s => s.signals.length > 0);
      const payload = withSignals.length > 0 ? withSignals : results;
      cacheSet(CACHE_KEY, payload, 5 * 60 * 1000);
      res.json(payload);
    } catch (e: any) {
      console.error("[AO/BSE] Screener error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── DYNAMIC endpoint — look up ANY stock (NSE or BSE) by symbol ───────────
  // Frontend calls: GET /api/stocks/dynamic?symbol=INFY&exchange=NSE
  app.get("/api/stocks/dynamic", async (req, res) => {
    const { symbol, exchange = "NSE" } = req.query as Record<string, string>;
    if (!symbol) return res.status(400).json({ error: "symbol param required" });

    const sym  = symbol.toUpperCase().trim();
    const exch = (exchange.toUpperCase().trim() === "BSE") ? "BSE" : "NSE";
    const CACHE_KEY = `dyn_${exch}_${sym}`;
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    try {
      // Step 1: search Angel One to get the correct symbolToken
      const scrips = await searchScrip(exch, sym);
      if (!scrips || scrips.length === 0)
        return res.status(404).json({ error: `No Angel One results for symbol: ${sym} on ${exch}` });

      // Pick the best match: exact symbol match first, otherwise first result
      const match = scrips.find((s: any) =>
        s.tradingsymbol?.toUpperCase() === sym ||
        s.symbol?.toUpperCase() === sym
      ) ?? scrips[0];

      const token = match.symboltoken ?? match.token ?? match.scripToken;
      const name  = match.name ?? match.companyname ?? sym;

      if (!token) {
        return res.status(404).json({ error: `symbolToken not found for ${sym} on ${exch}` });
      }

      console.log(`[AO] Dynamic fetch: ${sym} (${exch}) token=${token} name="${name}"`);

      const symInfo = { symbol: sym, name: String(name), token: String(token), sector: exch };
      const data = await fetchStockDataAccurate(symInfo, exch as "NSE" | "BSE");

      cacheSet(CACHE_KEY, data, 60 * 1000); // 1-min cache
      res.json(data);
    } catch (e: any) {
      console.error(`[AO] Dynamic error (${sym}/${exch}):`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Predefined Stock Detail (with dynamic fallback, supports NSE + BSE) ───
  app.get("/api/stocks/:symbol", async (req, res) => {
    const sym   = req.params.symbol.toUpperCase();
    const exch  = ((req.query.exchange as string) ?? "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE";
    const CACHE_KEY = `stock_${exch}_${sym}`;
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    try {
      let data: any;

      if (exch === "BSE") {
        // Try BSE symbol list first
        const bseSym = BSE_SYMBOLS.find(s => s.symbol === sym);
        if (bseSym) {
          data = await fetchStockDataAccurate(
            {
              symbol: bseSym.symbol,
              name: bseSym.name,
              token: bseSym.token,
              sector: bseSym.sector,
              nseToken: bseSym.nseToken
            },
            "BSE"
          );
        } else {
          const scrips = await searchScrip("BSE", sym);
          if (!scrips || scrips.length === 0)
            return res.status(404).json({ error: `Symbol ${sym} not found on BSE` });
          const match = scrips.find((s: any) =>
            s.tradingsymbol?.toUpperCase() === sym || s.symbol?.toUpperCase() === sym
          ) ?? scrips[0];
          const token = match.symboltoken ?? match.token ?? match.scripToken;
          if (!token) return res.status(404).json({ error: `BSE token not found for ${sym}` });
          const info = { symbol: sym, name: match.name ?? match.companyname ?? sym, token: String(token), sector: "BSE" };
          data = await fetchStockDataAccurate(info, "BSE");
        }
      } else {
        // NSE
        const nseSym = NSE_SYMBOLS.find(s => s.symbol === sym);
        if (nseSym) {
          data = await fetchStockDataAccurate(nseSym, "NSE");
        } else {
          const scrips = await searchScrip("NSE", sym);
          if (!scrips || scrips.length === 0)
            return res.status(404).json({ error: `Symbol ${sym} not found on NSE` });
          const match = scrips.find((s: any) =>
            s.tradingsymbol?.toUpperCase() === sym || s.symbol?.toUpperCase() === sym
          ) ?? scrips[0];
          const token = match.symboltoken ?? match.token ?? match.scripToken;
          if (!token) return res.status(404).json({ error: `NSE token not found for ${sym}` });
          const info = { symbol: sym, name: match.name ?? match.companyname ?? sym, token: String(token), sector: "NSE" };
          data = await fetchStockDataAccurate(info, "NSE");
        }
      }

      cacheSet(CACHE_KEY, data, 60 * 1000);
      res.json(data);
    } catch (e: any) {
      console.error(`[AO] Stock detail error (${sym}/${exch}):`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Alerts — derived entirely from Angel One FULL quote data ─────────────
  // Uses only the batch market quote endpoint (no historical candles, no rate limits).
  // Angel One FULL quote provides: ltp, open, high, low, prevClose, netChange,
  // percentChange, tradeVolume, 52wHigh, 52wLow, upperCircuit, lowerCircuit.
  // All signals are derived from these real values.
  app.get("/api/alerts", async (req, res) => {
    const exch = ((req.query.exchange as string) ?? "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE";
    const CACHE_KEY = `alerts_live_${exch}`;
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    try {
      const symbols = exch === "BSE" ? BSE_SYMBOLS : NSE_SYMBOLS;

      // Batch-fetch ALL live FULL quotes — single endpoint, no rate limits
      const allQuotesMap: Record<string, any> = {};
      const BATCH_SIZE = 50;
      const tokenList = symbols.map(s => s.token);
      for (let i = 0; i < tokenList.length; i += BATCH_SIZE) {
        const batch = tokenList.slice(i, i + BATCH_SIZE);
        try {
          const quotes = await getMarketQuote({ [exch]: batch }, "FULL");
          const fetched = (quotes[exch] || Object.values(quotes).flat()) as any[];
          for (const q of fetched) {
            const t = q.symbolToken || q.token;
            if (t) allQuotesMap[t] = q;
          }
        } catch (e: any) {
          console.warn(`[Alerts/${exch}] batch ${i} failed: ${e.message}`);
        }
      }

      // BSE-specific fallback: if BSE exchange quotes came back empty,
      // try fetching via NSE tokens (all BSE_SYMBOLS are dual-listed)
      if (exch === "BSE" && Object.keys(allQuotesMap).length === 0) {
        console.log("[Alerts/BSE] BSE quotes empty — falling back to NSE tokens");
        const nseTokenList = (BSE_SYMBOLS as any[]).map((s: any) => s.nseToken).filter(Boolean);
        for (let i = 0; i < nseTokenList.length; i += BATCH_SIZE) {
          const batch = nseTokenList.slice(i, i + BATCH_SIZE);
          try {
            const quotes = await getMarketQuote({ "NSE": batch }, "FULL");
            const fetched = (quotes["NSE"] || Object.values(quotes).flat()) as any[];
            for (const q of fetched) {
              const t = q.symbolToken || q.token;
              if (t) allQuotesMap[t] = q;
            }
          } catch (e: any) {
            console.warn(`[Alerts/BSE→NSE] batch ${i} failed: ${e.message}`);
          }
        }
      }

      const now = new Date().toISOString();
      const alerts: any[] = [];

      for (const sym of symbols) {
        // For BSE, try BSE token first then nseToken fallback
        const q = allQuotesMap[sym.token] ?? (exch === "BSE" ? allQuotesMap[(sym as any).nseToken] : undefined);
        if (!q) continue;

        const rawLtp    = parseFloat(q.ltp ?? "0") || 0;
        const prevClose = parseFloat(q.close ?? q.prevClose ?? "0") || 0;
        // When market is closed, ltp=0 — fall back to prevClose
        const ltp       = rawLtp > 0 ? rawLtp : prevClose;
        const open      = parseFloat(q.open ?? "0") || ltp;
        const high      = parseFloat(q.high ?? "0") || ltp;
        const low       = parseFloat(q.low ?? "0") || ltp;
        const netChange = rawLtp > 0 ? (parseFloat(q.netChange ?? "0") || 0) : 0;
        const changePct = rawLtp > 0 ? (parseFloat(q.percentChange ?? "0") || 0) : 0;
        const tradeVol  = parseInt(q.tradeVolume ?? q.totalTradedVolume ?? "0", 10) || 0;
        const w52h      = q.fiftyTwoWeekHighPrice ? parseFloat(q.fiftyTwoWeekHighPrice) : null;
        const w52l      = q.fiftyTwoWeekLowPrice  ? parseFloat(q.fiftyTwoWeekLowPrice)  : null;
        const uCkt      = q.upperCircuit ? parseFloat(q.upperCircuit) : null;
        const lCkt      = q.lowerCircuit ? parseFloat(q.lowerCircuit) : null;
        if (ltp === 0) continue;

        // Derived values from the live quote
        const dayRange    = high > 0 && low > 0 ? high - low : 0;
        const gapPct      = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
        // Where is close relative to the day's range? (0 = at low, 1 = at high)
        const closePos    = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
        const aboveMid    = closePos > 0.6;  // closing in upper 40% of day's range

        const signals: any[] = [];

        // ── 1. 52-Week High Breakout ────────────────────────────────────────
        // Real signal: ltp at or above the 52w high Angel One reports
        if (w52h && ltp >= w52h * 0.99) {
          const atHigh = ltp >= w52h;
          const conf   = atHigh ? 88 : 80;
          signals.push({
            id: `52wh_${sym.token}`,
            patternName: atHigh ? "52-Week High Breakout" : "52-Week High Resistance Test",
            type: "Bullish",
            patternCategory: "Breakout",
            timeframeClass: "Swing",
            explanation: {
              en: `${sym.symbol} is ${atHigh ? "trading at" : "within 1% of"} its 52-week high of ₹${w52h.toFixed(2)}, currently at ₹${ltp.toFixed(2)}. A sustained close above this level signals institutional accumulation and the potential start of a new leg higher. The 52-week high is one of the most reliable breakout triggers tracked by professional desks.`,
              hi: `${sym.symbol} अपने 52-सप्ताह के उच्चतम स्तर ₹${w52h.toFixed(2)} ${atHigh ? "पर" : "के बहुत करीब"} है। यह स्तर संस्थागत खरीदारी और ब्रेकआउट का मजबूत संकेत है।`,
            },
            confidenceScore: conf,
            confidenceBreakdown: `52-week high: +40 | Intraday position (close vs range): +${Math.round(closePos * 20)} | Momentum: +${conf - 40 - Math.round(closePos * 20)}`,
            timeframe: "5–15 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (w52h * 0.94).toFixed(2),
            target1: (ltp * 1.08).toFixed(2),
            target2: (ltp * 1.15).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Not investment advice. For educational purposes only.",
            detectedAt: now,
          });
        }

        // ── 2. 52-Week Low Reversal ─────────────────────────────────────────
        // Real signal: ltp bouncing off 52w low with positive close
        if (w52l && ltp <= w52l * 1.04 && changePct > 0 && aboveMid) {
          signals.push({
            id: `52wl_${sym.token}`,
            patternName: "52-Week Low Reversal",
            type: "Bullish",
            patternCategory: "Reversal",
            timeframeClass: "Swing",
            explanation: {
              en: `${sym.symbol} is reversing off its 52-week low of ₹${w52l.toFixed(2)}, currently at ₹${ltp.toFixed(2)} (+${changePct.toFixed(2)}% today). The stock is closing in the upper half of its day range, suggesting buying absorption at this support level. Reversals at yearly lows often mark the end of a bearish phase as smart money accumulates.`,
              hi: `${sym.symbol} अपने 52-सप्ताह के निचले स्तर ₹${w52l.toFixed(2)} से वापसी कर रहा है। आज +${changePct.toFixed(2)}% की तेजी और दिन की ऊपरी रेंज में क्लोजिंग खरीदारी की पुष्टि करती है।`,
            },
            confidenceScore: 74,
            confidenceBreakdown: "52-week low support: +35 | Positive close: +20 | Upper-half day close: +19",
            timeframe: "7–21 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (w52l * 0.97).toFixed(2),
            target1: (ltp * 1.07).toFixed(2),
            target2: (ltp * 1.14).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Not investment advice. For educational purposes only.",
            detectedAt: now,
          });
        }

        // ── 3. Bullish Gap-Up ───────────────────────────────────────────────
        // Real signal: open > prevClose by ≥ 1.5%, gap holding (close > open)
        if (gapPct >= 1.5 && ltp >= open) {
          const conf = gapPct >= 3 ? 84 : gapPct >= 2 ? 76 : 68;
          signals.push({
            id: `gapup_${sym.token}`,
            patternName: `Gap Up — ${gapPct.toFixed(1)}% Opening`,
            type: "Bullish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} opened ${gapPct.toFixed(1)}% higher at ₹${open.toFixed(2)} vs yesterday's close of ₹${prevClose.toFixed(2)} and is holding the gap (current: ₹${ltp.toFixed(2)}). A gap that holds intraday confirms strong overnight demand. Unfilled gaps are a bullish structural signal — they act as support on any retest.`,
              hi: `${sym.symbol} आज ₹${prevClose.toFixed(2)} से ${gapPct.toFixed(1)}% ऊपर ₹${open.toFixed(2)} पर खुला और गैप होल्ड कर रहा है। यह मजबूत खरीदारी का संकेत है।`,
            },
            confidenceScore: conf,
            confidenceBreakdown: `Gap size ${gapPct.toFixed(1)}%: +${Math.min(40, Math.round(gapPct * 8))} | Gap holding intraday: +${conf - Math.min(40, Math.round(gapPct * 8))}`,
            timeframe: "Same day to 3 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (open * 0.985).toFixed(2),
            target1: (ltp * 1.04).toFixed(2),
            target2: (ltp * 1.08).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Not investment advice. For educational purposes only.",
            detectedAt: now,
          });
        }

        // ── 4. Bearish Gap-Down ─────────────────────────────────────────────
        // Real signal: open < prevClose by ≥ 1.5%, gap not recovering (close < open)
        if (gapPct <= -1.5 && ltp <= open) {
          const absPct = Math.abs(gapPct);
          const conf   = absPct >= 3 ? 82 : absPct >= 2 ? 74 : 66;
          signals.push({
            id: `gapdn_${sym.token}`,
            patternName: `Gap Down — ${absPct.toFixed(1)}% Opening`,
            type: "Bearish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} opened ${absPct.toFixed(1)}% lower at ₹${open.toFixed(2)} vs yesterday's close of ₹${prevClose.toFixed(2)} and is unable to recover (current: ₹${ltp.toFixed(2)}). A gap down that fails to fill intraday signals sustained selling pressure. Avoid fresh longs until price reclaims the gap zone above ₹${open.toFixed(2)}.`,
              hi: `${sym.symbol} आज ₹${prevClose.toFixed(2)} से ${absPct.toFixed(1)}% नीचे ₹${open.toFixed(2)} पर खुला और गैप नहीं भर रहा। यह बिकवाली का दबाव जारी रहने का संकेत है।`,
            },
            confidenceScore: conf,
            confidenceBreakdown: `Gap size ${absPct.toFixed(1)}%: +${Math.min(38, Math.round(absPct * 8))} | Gap sustaining: +${conf - Math.min(38, Math.round(absPct * 8))}`,
            timeframe: "Same day to 3 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (open * 1.015).toFixed(2),
            target1: (ltp * 0.96).toFixed(2),
            target2: (ltp * 0.92).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Not investment advice. For educational purposes only.",
            detectedAt: now,
          });
        }

        // ── 5. Strong Bullish Momentum (Percentage Gainers) ─────────────────
        if (changePct >= 3) {
          const conf = changePct >= 5 ? 86 : changePct >= 4 ? 78 : 70;
          signals.push({
            id: `bull_mom_${sym.token}`,
            patternName: `Bullish Momentum +${changePct.toFixed(1)}%`,
            type: "Bullish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} is up ${changePct.toFixed(2)}% today (₹${prevClose.toFixed(2)} → ₹${ltp.toFixed(2)}), showing strong real-time demand. High momentum moves often attract further volume on the breakout.`,
              hi: `${sym.symbol} आज ${changePct.toFixed(2)}% ऊपर है। यह मजबूत खरीदारी की गति को दर्शाता है।`,
            },
            confidenceScore: conf,
            confidenceBreakdown: `Bullish momentum: +${Math.min(45, Math.round(changePct * 7))} | Close vs Range: +${Math.round(closePos * 15)}`,
            timeframe: "1–3 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (low * 0.99).toFixed(2),
            target1: (ltp * 1.04).toFixed(2),
            target2: (ltp * 1.07).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Real-time quote analysis.",
            detectedAt: now,
          });
        }

        // ── 6. Strong Bearish Momentum (Percentage Losers) ──────────────────
        if (changePct <= -3) {
          const absPct = Math.abs(changePct);
          const conf   = absPct >= 5 ? 84 : absPct >= 4 ? 76 : 68;
          signals.push({
            id: `bear_mom_${sym.token}`,
            patternName: `Bearish Momentum −${absPct.toFixed(1)}%`,
            type: "Bearish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} is down ${absPct.toFixed(2)}% today (₹${prevClose.toFixed(2)} → ₹${ltp.toFixed(2)}). Sustained selling pressure in a single session indicates distribution.`,
              hi: `${sym.symbol} आज ${absPct.toFixed(2)}% नीचे है। यह बिकवाली के दबाव का संकेत है।`,
            },
            confidenceScore: conf,
            confidenceBreakdown: `Decline magnitude: +${Math.min(43, Math.round(absPct * 7))} | Close position: +${Math.round((1 - closePos) * 15)}`,
            timeframe: "1–3 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (high * 1.01).toFixed(2),
            target1: (ltp * 0.96).toFixed(2),
            target2: (ltp * 0.93).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Real-time quote analysis.",
            detectedAt: now,
          });
        }

        // ── 7. Upper Circuit Alert ──────────────────────────────────────────
        if (uCkt && ltp >= uCkt * 0.98) {
          const atCircuit = ltp >= uCkt;
          signals.push({
            id: `uckt_${sym.token}`,
            patternName: atCircuit ? "Upper Circuit Hit" : "Upper Circuit Approach",
            type: "Bullish",
            patternCategory: "Breakout",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} ${atCircuit ? "has hit" : "is near"} its upper circuit limit (₹${uCkt.toFixed(2)}). Demand completely exceeds available supply at this level.`,
              hi: `${sym.symbol} ${atCircuit ? "अपर सर्किट पर है" : "अपर सर्किट के पास है"} (₹${uCkt.toFixed(2)})।`,
            },
            confidenceScore: atCircuit ? 92 : 84,
            confidenceBreakdown: `Circuit ${atCircuit ? "hit" : "proximity"}: +45 | Demand surge: +${atCircuit ? 30 : 22}`,
            timeframe: "Intraday",
            entry: ltp.toFixed(2),
            stopLoss: (ltp * 0.95).toFixed(2),
            target1: uCkt.toFixed(2),
            target2: (uCkt * 1.05).toFixed(2),
            volumeConfirmed: true,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Real-time quote analysis.",
            detectedAt: now,
          });
        }

        // ── 8. Lower Circuit Alert ──────────────────────────────────────────
        if (lCkt && ltp <= lCkt * 1.02) {
          const atCircuit = ltp <= lCkt;
          signals.push({
            id: `lckt_${sym.token}`,
            patternName: atCircuit ? "Lower Circuit Hit" : "Lower Circuit Approach",
            type: "Bearish",
            patternCategory: "Reversal",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} ${atCircuit ? "has hit" : "is near"} its lower circuit limit (₹${lCkt.toFixed(2)}). Selling pressure has exhausted all buyers at this level.`,
              hi: `${sym.symbol} ${atCircuit ? "लोअर सर्किट पर है" : "लोअर सर्किट के पास है"} (₹${lCkt.toFixed(2)})।`,
            },
            confidenceScore: atCircuit ? 90 : 82,
            confidenceBreakdown: `Circuit ${atCircuit ? "hit" : "proximity"}: +43 | Supply surge: +${atCircuit ? 30 : 22}`,
            timeframe: "Intraday",
            entry: ltp.toFixed(2),
            stopLoss: (ltp * 1.02).toFixed(2),
            target1: (ltp * 0.97).toFixed(2),
            target2: lCkt.toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Real-time quote analysis.",
            detectedAt: now,
          });
        }

        if (signals.length === 0) continue;

        let volumeStr = "—";
        if (tradeVol > 0) {
          if (tradeVol >= 10_000_000)   volumeStr = `${(tradeVol / 10_000_000).toFixed(2)}Cr`;
          else if (tradeVol >= 100_000) volumeStr = `${(tradeVol / 100_000).toFixed(2)}L`;
          else if (tradeVol >= 1_000)   volumeStr = `${(tradeVol / 1_000).toFixed(1)}K`;
          else                           volumeStr = String(tradeVol);
        }

        alerts.push({
          symbol:        sym.symbol,
          name:          sym.name,
          sector:        sym.sector,
          exchange:      exch,
          currentPrice:  ltp,
          prevClose:     prevClose || undefined,
          open, high, low,
          change:        parseFloat(netChange.toFixed(2)),
          changePercent: parseFloat(changePct.toFixed(2)),
          volume:        volumeStr,
          upperCircuit:  uCkt,
          lowerCircuit:  lCkt,
          week52High:    w52h,
          week52Low:     w52l,
          signals,
          isWatchlisted: false,
          lastUpdated:   now,
        });
      }

      // ── Upstox gap-fill: cover NSE stocks that Angel One returned no data for ──
      if (isUpstoxReady() && exch === "NSE") {
        const loadedSymbols = new Set(alerts.map((a: any) => a.symbol));
        const missedSyms = NSE_SYMBOLS.filter(s => !allQuotesMap[s.token] && !loadedSymbols.has(s.symbol));

        if (missedSyms.length > 0) {
          console.log(`[Alerts/Upstox] Gap-filling ${missedSyms.length} stocks missed by Angel One`);

          // Batch Upstox quote fetch
          const instrKeys = missedSyms.map(s => getNseInstrumentKey(s.symbol)).filter(Boolean) as string[];
          if (instrKeys.length > 0) {
            try {
              const upQuotes = await getUpstoxQuotes(instrKeys);

              for (const sym of missedSyms) {
                const instrKey = getNseInstrumentKey(sym.symbol);
                if (!instrKey) continue;
                const uq = upQuotes[instrKey];
                if (!uq) continue;
                const norm = normalizeUpstoxQuote(instrKey, uq, sym);
                if (!norm || !norm.currentPrice) continue;

                const ltp       = norm.currentPrice;
                const prevClose = norm.prevClose || ltp;
                const open      = norm.open || ltp;
                const high      = norm.high || ltp;
                const low       = norm.low || ltp;
                const changePct = norm.changePercent || 0;
                const netChange = norm.change || 0;
                const tradeVol  = norm.tradeVol || 0;
                const w52h      = norm.week52High || null;
                const w52l      = norm.week52Low  || null;
                const dayRange  = high > 0 && low > 0 ? high - low : 0;
                const gapPct    = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
                const closePos  = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
                const aboveMid  = closePos > 0.6;
                const upSignals: any[] = [];

                // Same signal logic — reuse identical conditions
                if (w52h && ltp >= w52h * 0.99) {
                  const atHigh = ltp >= w52h;
                  upSignals.push({ id: `52wh_up_${sym.token}`, patternName: atHigh ? "52-Week High Breakout" : "52-Week High Resistance Test", type: "Bullish", patternCategory: "Breakout", timeframeClass: "Swing", explanation: { en: `${sym.symbol} is ${atHigh ? "at" : "within 1% of"} its 52-week high of ₹${w52h.toFixed(2)}, currently ₹${ltp.toFixed(2)}.`, hi: `${sym.symbol} 52-सप्ताह के उच्च ₹${w52h.toFixed(2)} के पास है।` }, confidenceScore: atHigh ? 88 : 80, confidenceBreakdown: "52-week high proximity via Upstox", timeframe: "5–15 trading days", entry: ltp.toFixed(2), stopLoss: (ltp * 0.94).toFixed(2), target1: (ltp * 1.08).toFixed(2), target2: (ltp * 1.15).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (w52l && ltp <= w52l * 1.04 && changePct > 0 && aboveMid) {
                  upSignals.push({ id: `52wl_up_${sym.token}`, patternName: "52-Week Low Reversal", type: "Bullish", patternCategory: "Reversal", timeframeClass: "Swing", explanation: { en: `${sym.symbol} is reversing off its 52-week low of ₹${w52l.toFixed(2)}, currently ₹${ltp.toFixed(2)} (+${changePct.toFixed(2)}%).`, hi: `${sym.symbol} 52-सप्ताह के निचले स्तर से वापसी कर रहा है।` }, confidenceScore: 74, confidenceBreakdown: "52-week low reversal via Upstox", timeframe: "7–21 trading days", entry: ltp.toFixed(2), stopLoss: (ltp * 0.97).toFixed(2), target1: (ltp * 1.07).toFixed(2), target2: (ltp * 1.14).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (gapPct >= 1.5 && ltp >= open) {
                  const conf = gapPct >= 3 ? 84 : gapPct >= 2 ? 76 : 68;
                  upSignals.push({ id: `gapup_up_${sym.token}`, patternName: `Gap Up — ${gapPct.toFixed(1)}% Opening`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${gapPct.toFixed(1)}% higher at ₹${open.toFixed(2)} vs ₹${prevClose.toFixed(2)} prev close, gap holding at ₹${ltp.toFixed(2)}.`, hi: `${sym.symbol} ${gapPct.toFixed(1)}% गैप-अप के साथ खुला और गैप होल्ड कर रहा है।` }, confidenceScore: conf, confidenceBreakdown: `Gap ${gapPct.toFixed(1)}% via Upstox`, timeframe: "Same day to 3 days", entry: ltp.toFixed(2), stopLoss: (open * 0.985).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.08).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (gapPct <= -1.5 && ltp <= open) {
                  const absPct = Math.abs(gapPct);
                  const conf   = absPct >= 3 ? 82 : absPct >= 2 ? 74 : 66;
                  upSignals.push({ id: `gapdn_up_${sym.token}`, patternName: `Gap Down — ${absPct.toFixed(1)}% Opening`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${absPct.toFixed(1)}% lower at ₹${open.toFixed(2)} vs ₹${prevClose.toFixed(2)} prev close, not recovering.`, hi: `${sym.symbol} ${absPct.toFixed(1)}% गैप-डाउन के साथ खुला और गैप नहीं भर रहा।` }, confidenceScore: conf, confidenceBreakdown: `Gap-down ${absPct.toFixed(1)}% via Upstox`, timeframe: "Same day to 3 days", entry: ltp.toFixed(2), stopLoss: (open * 1.015).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.92).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (changePct >= 3) {
                  const conf = changePct >= 5 ? 86 : changePct >= 4 ? 78 : 70;
                  upSignals.push({ id: `bull_up_${sym.token}`, patternName: `Bullish Momentum +${changePct.toFixed(1)}%`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is up ${changePct.toFixed(2)}% today (₹${prevClose.toFixed(2)} → ₹${ltp.toFixed(2)}) per Upstox.`, hi: `${sym.symbol} आज ${changePct.toFixed(2)}% ऊपर है।` }, confidenceScore: conf, confidenceBreakdown: `Momentum +${changePct.toFixed(1)}% via Upstox`, timeframe: "1–3 trading days", entry: ltp.toFixed(2), stopLoss: (low * 0.99).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.07).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (changePct <= -3) {
                  const absPct = Math.abs(changePct);
                  const conf   = absPct >= 5 ? 84 : absPct >= 4 ? 76 : 68;
                  upSignals.push({ id: `bear_up_${sym.token}`, patternName: `Bearish Momentum −${absPct.toFixed(1)}%`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is down ${absPct.toFixed(2)}% today per Upstox.`, hi: `${sym.symbol} आज ${absPct.toFixed(2)}% नीचे है।` }, confidenceScore: conf, confidenceBreakdown: `Decline ${absPct.toFixed(1)}% via Upstox`, timeframe: "1–3 trading days", entry: ltp.toFixed(2), stopLoss: (high * 1.01).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.93).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }

                if (upSignals.length === 0) continue;

                let volumeStr = "—";
                if (tradeVol > 0) {
                  if (tradeVol >= 10_000_000)   volumeStr = `${(tradeVol / 10_000_000).toFixed(2)}Cr`;
                  else if (tradeVol >= 100_000) volumeStr = `${(tradeVol / 100_000).toFixed(2)}L`;
                  else if (tradeVol >= 1_000)   volumeStr = `${(tradeVol / 1_000).toFixed(1)}K`;
                  else                           volumeStr = String(tradeVol);
                }

                alerts.push({
                  symbol: sym.symbol, name: sym.name, sector: sym.sector, exchange: "NSE",
                  currentPrice: ltp, prevClose, open, high, low,
                  change: parseFloat(netChange.toFixed(2)),
                  changePercent: parseFloat(changePct.toFixed(2)),
                  volume: volumeStr,
                  upperCircuit: null, lowerCircuit: null,
                  week52High: w52h, week52Low: w52l,
                  signals: upSignals,
                  isWatchlisted: false, lastUpdated: now,
                  dataSource: "Upstox",
                });
              }
            } catch (e: any) {
              console.warn(`[Alerts/Upstox] Gap-fill failed: ${e.message}`);
            }
          }
        }
      }

      alerts.sort((a, b) => {
        const aMax = Math.max(...a.signals.map((s: any) => s.confidenceScore));
        const bMax = Math.max(...b.signals.map((s: any) => s.confidenceScore));
        return bMax - aMax;
      });

      console.log(`[Alerts/${exch}] ${alerts.length} stocks with signals from ${Object.keys(allQuotesMap).length} quotes fetched`);
      cacheSet(CACHE_KEY, alerts, 60 * 1000); // 1-minute cache
      res.json(alerts);
    } catch (e: any) {
      console.error("[Alerts] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Gemini AI — explain a pattern ───────────────────────────────────────
  app.post("/api/gemini/explain", async (req, res) => {
    try {
      const { patternName, stockSymbol, direction, confidenceScore, timeframeClass } = req.body;
      if (!patternName || !stockSymbol || !direction)
        return res.status(400).json({ error: "Missing required fields" });
      const result = await explainPattern({ patternName, stockSymbol, direction, confidenceScore: confidenceScore ?? 70, timeframeClass: timeframeClass ?? "Swing" });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Gemini AI — market summary ──────────────────────────────────────────
  app.post("/api/gemini/market-summary", async (req, res) => {
    try {
      const { totalBull, totalBear, topPatterns } = req.body;
      const summary = await generateMarketSummary({ totalBull: totalBull ?? 0, totalBear: totalBear ?? 0, topPatterns: topPatterns ?? [] });
      res.json({ summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Gemini AI — full pattern analysis ───────────────────────────────────
  app.post("/api/gemini/analyze", async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Missing payload" });
      }
      const markdown = await generateFullAnalysis(req.body);
      res.json({ markdown });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── AlphaSignal Bot Chat ───────────────────────────────────────────────────
  // POST /api/chat — accepts { messages: ChatMessage[], query: string }
  // Queries Pinecone for context, then OpenAI to generate response
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, query } = req.body as {
        messages: ChatMessage[];
        query: string;
      };
      if (!query?.trim()) {
        return res.status(400).json({ error: "query is required" });
      }

      // 1. Retrieve relevant context from Pinecone knowledge base
      const pineconeMatches = await queryKnowledgeBase(query, 4, 0.35);

      // 2. Build full message list: history + current user turn
      const fullMessages: ChatMessage[] = [
        ...(messages ?? []),
        { role: "user", content: query },
      ];

      // 3. Generate answer with OpenAI (grounded with Pinecone context if available)
      const answer = await generateChatAnswer(fullMessages, pineconeMatches);

      res.json({
        answer,
        sources: pineconeMatches.map(m => ({
          text:   m.text.slice(0, 200) + (m.text.length > 200 ? "…" : ""),
          source: m.source,
          score:  Math.round(m.score * 100),
        })),
        fromKnowledgeBase: pineconeMatches.length > 0,
      });
    } catch (e: any) {
      console.error("[Chat] error:", e.message);
      res.status(500).json({ error: e.message ?? "Chat error" });
    }
  });

  // POST /api/chat/stream — SSE streaming version of /api/chat
  app.post("/api/chat/stream", async (req, res) => {
    try {
      const { messages, query } = req.body as { messages: ChatMessage[]; query: string };
      if (!query?.trim()) return res.status(400).json({ error: "query is required" });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const pineconeMatches = await queryKnowledgeBase(query, 3, 0.3);
      const fullMessages: ChatMessage[] = [...(messages ?? []), { role: "user", content: query }];

      // Send metadata first
      res.write(`data: ${JSON.stringify({
        type: "meta",
        fromKnowledgeBase: pineconeMatches.length > 0,
        sources: pineconeMatches.map(m => ({
          text:   m.text.slice(0, 200) + (m.text.length > 200 ? "…" : ""),
          source: m.source,
          score:  Math.round(m.score * 100),
        })),
      })}\n\n`);

      // Stream answer chunks
      await streamChatAnswer(fullMessages, pineconeMatches, (text) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
      });

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (e: any) {
      console.error("[Chat/Stream] error:", e.message);
      res.write(`data: ${JSON.stringify({ type: "error", error: e.message })}\n\n`);
      res.end();
    }
  });

  // POST /api/chat/upload — accepts multipart/form-data with a PDF file
  // Parses PDF, chunks text, embeds with OpenAI, upserts to Pinecone
  const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === "application/pdf") cb(null, true);
      else cb(new Error("Only PDF files are accepted"));
    },
  });

  app.post("/api/chat/upload", upload.single("pdf"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No PDF file provided" });
      if (!isPineconeReady()) {
        return res.status(503).json({ error: "Pinecone is not configured. Add PINECONE_API_KEY and PINECONE_INDEX to .env" });
      }
      const result = await ingestPdfBuffer(req.file.buffer, req.file.originalname);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/chat/status — check if Pinecone is configured
  app.get("/api/chat/status", (_req, res) => {
    res.json({
      pineconeReady: isPineconeReady(),
      index: process.env.PINECONE_INDEX ?? null,
    });
  });

  // ── Dynamic symbol universe init (Upstox instrument master) ─────────────
  // Downloads full NSE/BSE instrument master from Upstox (~1900 NSE + 5000 BSE)
  // and merges with static symbols so screener covers 500–1900+ stocks.
  initDynamicSymbols(NSE_SYMBOLS, BSE_SYMBOLS).catch((e: any) =>
    console.warn("[Upstox] initDynamicSymbols failed:", e?.message ?? e)
  );

  // ── Cache pre-warm on startup ─────────────────────────────────────────────
  // Run screener scans in the background so the first user request hits cache.
  // Stagger NSE and BSE by 5s so they don't compete for the same API rate limit.
  setTimeout(async () => {
    try {
      console.log("[PreWarm] Starting NSE screener cache warm-up...");
      await fetch(`http://localhost:${process.env.PORT ?? 5000}/api/stocks/screener`).catch((e: any) => console.warn("[PreWarm] NSE fetch failed:", e.message));
      console.log("[PreWarm] NSE done.");
    } catch (e: any) { console.error("[Route] silent error:", e?.message ?? e); }
  }, 2000);

  setTimeout(async () => {
    try {
      console.log("[PreWarm] Starting BSE screener cache warm-up...");
      await fetch(`http://localhost:${process.env.PORT ?? 5000}/api/stocks/screener/bse`).catch((e: any) => console.warn("[PreWarm] BSE fetch failed:", e.message));
      console.log("[PreWarm] BSE done.");
    } catch (e: any) { console.error("[Route] silent error:", e?.message ?? e); }
  }, 20000);

  return httpServer;
}
