import { OpenAI } from "openai";

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set in .env");
    openai = new OpenAI({ apiKey: key });
  }
  return openai;
}

export async function explainPattern(opts: {
  patternName: string;
  stockSymbol: string;
  direction: "Bullish" | "Bearish";
  confidenceScore: number;
  timeframeClass: string;
}): Promise<{ en: string; hi: string }> {
  const { patternName, stockSymbol, direction, confidenceScore, timeframeClass } = opts;

  const prompt = `You are an elite institutional technical analyst covering the NSE for retail investors.

A ${direction} "${patternName}" pattern has been detected on ${stockSymbol} with a high algorithmic confidence score of ${confidenceScore}/100 for ${timeframeClass} trading.

Provide an elaborate, professional, and highly insightful explanation in TWO parts:
1. English explanation (4-5 sentences): Detail the psychology behind this pattern (who is in control: buyers or sellers), what institutional mechanics it implies, what technical action it suggests, and the critical risk management levels to monitor.
2. Hindi explanation (4-5 sentences in Devanagari script): Provide the exact same deep dive into market psychology, technical action, and risk management in clear, professional, yet understandable Hindi.

Format your response as JSON exactly like this:
{
  "en": "Elaborate English explanation here...",
  "hi": "विस्तृत हिंदी में व्याख्या यहाँ..."
}

Ensure the analysis feels institutional and highly valuable. Do not use markdown formatting inside the JSON strings.`;

  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const text = response.choices[0].message?.content?.trim() || "{}";
    const parsed = JSON.parse(text);
    return {
      en: parsed.en ?? "Pattern explanation not available.",
      hi: parsed.hi ?? "पैटर्न का विवरण उपलब्ध नहीं है।",
    };
  } catch (err: any) {
    console.error("[OpenAI] explainPattern error:", err.message);
    return {
      en: `A ${direction} ${patternName} pattern has been detected on ${stockSymbol}. This ${timeframeClass.toLowerCase()} pattern suggests ${direction === "Bullish" ? "potential upward price movement" : "potential downward price movement"}. Always use proper stop-loss to manage risk.`,
      hi: `${stockSymbol} पर एक ${direction === "Bullish" ? "तेजी" : "मंदी"} का ${patternName} पैटर्न देखा गया है। यह ${timeframeClass.toLowerCase()} पैटर्न ${direction === "Bullish" ? "कीमत में ऊपर जाने" : "कीमत में नीचे आने"} का संकेत देता है। हमेशा उचित स्टॉप-लॉस के साथ ट्रेड करें।`,
    };
  }
}

export async function generateMarketSummary(opts: {
  totalBull: number;
  totalBear: number;
  topPatterns: Array<{ symbol: string; pattern: string; confidence: number; direction: string }>;
}): Promise<string> {
  const { totalBull, totalBear, topPatterns } = opts;

  const prompt = `You are an institutional NSE macro-strategist. Based on the aggregate pattern detection results from the Indian market, construct a highly elaborate, professional, and detailed market breadth summary paragraph for retail investors.

Data to synthesize:
- Bullish signals detected: ${totalBull}
- Bearish signals detected: ${totalBear}
- Top high-confidence patterns: ${topPatterns.slice(0, 5).map(p => `${p.symbol} (${p.pattern}, ${p.direction}, ${p.confidence}% conf)`).join("; ")}

Write a single, comprehensive paragraph (4-6 sentences). Explain the overall market sentiment, what the ratio of bullish vs bearish signals implies about market breath, and highlight the most critical setups forming right now. Do not use markdown or bullet points. Use institutional, authoritative, yet plain language.`;

  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });
    return response.choices[0].message?.content?.trim() || "";
  } catch (err: any) {
    console.error("[OpenAI] marketSummary error:", err.message);
    const sentiment = totalBull > totalBear ? "bullish" : totalBull < totalBear ? "bearish" : "neutral";
    return `Market sentiment appears ${sentiment} with ${totalBull} bullish and ${totalBear} bearish patterns detected across NSE stocks. The top signal is ${topPatterns[0]?.symbol ?? "N/A"} showing a ${topPatterns[0]?.pattern ?? "strong"} pattern. Exercise proper risk management before entering any trades.`;
  }
}

export async function generateFullAnalysis(payload: any): Promise<string> {
  // ── Pre-compute real chart statistics from OHLCV data ──────────────────────
  // Grounds the AI strictly in actual numbers — prevents hallucination.
  const candles: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> =
    Array.isArray(payload.chartData) ? payload.chartData : [];

  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const n       = closes.length;

  function sma(arr: number[], period: number): number | null {
    if (arr.length < period) return null;
    const slice = arr.slice(arr.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  const sma5  = sma(closes, 5);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);

  const last20High = n >= 20 ? Math.max(...candles.slice(n - 20).map(c => c.high)) : null;
  const last20Low  = n >= 20 ? Math.min(...candles.slice(n - 20).map(c => c.low))  : null;
  const last5VolAvg  = sma(volumes, 5);
  const last20VolAvg = sma(volumes, 20);
  const volRatio = last5VolAvg && last20VolAvg && last20VolAvg > 0
    ? last5VolAvg / last20VolAvg
    : null;

  // Count up/down days in last 10 sessions
  const last10Closes = closes.slice(Math.max(0, n - 10));
  let upDays = 0, downDays = 0;
  for (let i = 1; i < last10Closes.length; i++) {
    if (last10Closes[i] > last10Closes[i - 1]) upDays++;
    else if (last10Closes[i] < last10Closes[i - 1]) downDays++;
  }

  // Linear regression slope on last 20 closes → trend direction
  const recentCloses = closes.slice(Math.max(0, n - 20));
  const rLen = recentCloses.length;
  let slope = 0;
  if (rLen >= 5) {
    const xMean = (rLen - 1) / 2;
    const yMean = recentCloses.reduce((a, b) => a + b, 0) / rLen;
    let num = 0, den = 0;
    recentCloses.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
    slope = den !== 0 ? num / den : 0;
  }
  const trendDir = slope > 0.3 ? "Uptrend" : slope < -0.3 ? "Downtrend" : "Sideways/Consolidation";

  const w52h = payload.week52High ?? null;
  const w52l = payload.week52Low  ?? null;
  const rangePos = (w52h && w52l && w52h > w52l)
    ? Math.round(((payload.currentPrice - w52l) / (w52h - w52l)) * 100)
    : null;

  // Today's intraday range position: where does LTP sit between day's low and high?
  const intradayRange = payload.high && payload.low && payload.high !== payload.low
    ? Math.round(((payload.currentPrice - payload.low) / (payload.high - payload.low)) * 100)
    : null;

  // Build clean structured data to send — NO raw 120-candle array
  const stats = {
    symbol:           payload.symbol,
    name:             payload.name,
    exchange:         payload.exchange ?? "NSE",
    currentPrice:     payload.currentPrice,
    dayOpen:          payload.open,
    dayHigh:          payload.high,
    dayLow:           payload.low,
    prevClose:        payload.prevClose,
    change:           payload.change,
    changePercent:    payload.changePercent,
    volume:           payload.volume,
    week52High:       w52h,
    week52Low:        w52l,
    rangePosition:    rangePos !== null ? `${rangePos}% of 52-week range (0=at 52W Low, 100=at 52W High)` : "N/A",
    intradayPosition: intradayRange !== null ? `${intradayRange}% of today's range (0=at day Low, 100=at day High)` : "N/A",
    sma5:             sma5  !== null ? +sma5.toFixed(2)  : "N/A",
    sma20:            sma20 !== null ? +sma20.toFixed(2) : "N/A",
    sma50:            sma50 !== null ? +sma50.toFixed(2) : "N/A",
    priceVsSMA5:      sma5  ? (payload.currentPrice > sma5  ? "ABOVE" : "BELOW") : "N/A",
    priceVsSMA20:     sma20 ? (payload.currentPrice > sma20 ? "ABOVE (bullish)" : "BELOW (bearish)") : "N/A",
    priceVsSMA50:     sma50 ? (payload.currentPrice > sma50 ? "ABOVE (long-term bullish)" : "BELOW (long-term bearish)") : "N/A",
    recentTrend:      `${trendDir} — ${upDays} up-days vs ${downDays} down-days in last 10 sessions`,
    slopePer1Day:     +slope.toFixed(3),
    volumeTrend:      volRatio !== null
      ? `5-day avg volume is ${volRatio.toFixed(2)}x the 20-day avg (${volRatio >= 1.5 ? "HIGH — strong participation" : volRatio <= 0.7 ? "LOW — weak participation" : "NORMAL"})`
      : "N/A",
    last20DayHigh:    last20High !== null ? +last20High.toFixed(2) : "N/A",
    last20DayLow:     last20Low  !== null ? +last20Low.toFixed(2)  : "N/A",
    candlesAvailable: n,
    detectedPatterns: (payload.signals ?? []).map((s: any) => ({
      patternName:  s.patternName,
      type:         s.type,
      category:     s.patternCategory,
      confidence:   s.confidenceScore,
      timeframe:    s.timeframeClass,
      entry:        s.entry,
      stopLoss:     s.stopLoss,
      target1:      s.target1,
      target2:      s.target2,
      riskReward:   s.riskReward,
      volumeConfirmed: s.volumeConfirmed,
      successRate:  s.successRate,
      occurrences:  s.historicalOccurrences,
    })),
    lastUpdated: payload.lastUpdated,
  };

  const prompt = `You are AlphaSignal's senior technical analyst. Produce a grounded, accurate technical analysis report for retail investors.

STRICT RULES — NEVER BREAK:
1. Use ONLY the numbers in the STOCK DATA block below. Do NOT invent or assume any figure not explicitly given.
2. If a value is "N/A", state it is unavailable — never substitute a guess.
3. If candlesAvailable < 20, explicitly note that historical data is limited.
4. No hallucination. Every claim must directly reference a number from the data.
5. Do NOT write generic market commentary. Only analyse THIS specific stock using THIS data.
6. Wrap every key number, price level, and critical insight in **double asterisks** so it renders highlighted.
7. Be elaborative where it adds value, but skip padding. Each section should be 3–5 sentences.
8. No emojis. Professional tone.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STOCK DATA:
${JSON.stringify(stats, null, 2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write the report using EXACTLY this structure:

# ${stats.symbol} — Technical Analysis Report
*${stats.name} | ${stats.exchange} | Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST*

---

## 1. Current Price Action
Describe today's session using the exact dayOpen, dayHigh, dayLow, currentPrice, change, and changePercent values. Calculate and state whether the stock closed in the upper, middle, or lower third of today's range using intradayPosition. Comment on what that intraday close position implies about buyer/seller control. Mention the volume trend and what it says about participation.

## 2. Trend & Moving Average Analysis
State the recentTrend direction and slope. Compare currentPrice against SMA5, SMA20, and SMA50 using the exact values — state clearly whether price is ABOVE or BELOW each. Explain what the combination of SMA alignment means: full bullish stack (price > SMA5 > SMA20 > SMA50), mixed signals, or full bearish stack. Reference the last 10 session up/down day count to confirm or challenge the SMA picture.

## 3. Key Price Levels to Watch
Present as bullet points with exact numbers:
- **Immediate Support:** last20DayLow and SMA20 value — which is stronger?
- **Immediate Resistance:** last20DayHigh — distance from current price in %
- **52-Week Context:** rangePosition — is the stock near yearly highs (>75%), mid-range (25–75%), or near lows (<25%)? What does that imply?
- **Critical Pivot:** if currentPrice is near SMA20 or SMA50, name the exact level as the key pivot

## 4. Detected Chart Patterns
If no patterns detected: state exactly "No high-confidence chart patterns were identified in the current dataset."
For EACH detected pattern: state the patternName, type (Bullish/Bearish), confidence score, and timeframe. Explain in 2 sentences what price behaviour triggered this pattern based on recent candles. List the exact entry, stop-loss, target1, target2, and risk:reward. State whether volume confirmed the pattern (volumeConfirmed field). Mention the historical success rate and occurrences.

## 5. Summary & Key Level to Watch
Synthesise sections 1–4 into a clear directional view: **Bullish**, **Bearish**, or **Neutral/Sideways**, with a one-sentence justification referencing the data. State one specific price level that, if breached, would invalidate the current view. Keep this section to 3–4 sentences maximum.

---
*Data source: Angel One SmartAPI | Not investment advice | Past performance does not guarantee future results*`;

  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    });
    const rawContent = response.choices[0].message?.content?.trim() || "";
    return rawContent.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");
  } catch (err: any) {
    console.error("[OpenAI] generateFullAnalysis error:", err.message);
    throw new Error("Failed to generate analysis: " + err.message);
  }
}
