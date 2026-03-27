var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// api/index.ts
import "dotenv/config";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createServer } from "http";

// server/api/routes.ts
import multer from "multer";

// server/services/pinecone.ts
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAI } from "openai";
var _openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
var _pc = process.env.PINECONE_API_KEY ? new Pinecone({ apiKey: process.env.PINECONE_API_KEY }) : null;
function getOpenAI() {
  if (!_openai) throw new Error("OPENAI_API_KEY not set");
  return _openai;
}
function getPinecone() {
  if (!_pc) throw new Error("PINECONE_API_KEY not set in .env");
  return _pc;
}
function getPineconeIndex() {
  const indexName = process.env.PINECONE_INDEX ?? "alphasignal-kb";
  return getPinecone().index(indexName);
}
function isPineconeReady() {
  return !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX);
}
var _embedCache = /* @__PURE__ */ new Map();
async function embed(text2) {
  const key = text2.slice(0, 200);
  if (_embedCache.has(key)) return _embedCache.get(key);
  const res = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text2.slice(0, 4e3)
  });
  const vec = res.data[0].embedding;
  if (_embedCache.size > 200) _embedCache.delete(_embedCache.keys().next().value);
  _embedCache.set(key, vec);
  return vec;
}
var _cache = /* @__PURE__ */ new Map();
var CACHE_MAX = 120;
function cacheKey(query) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
function cacheGet(query) {
  return _cache.get(cacheKey(query));
}
function cacheSet(query, value) {
  const key = cacheKey(query);
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, value);
}
async function queryKnowledgeBase(query, topK = 3, minScore = 0.3) {
  if (!isPineconeReady()) return [];
  try {
    const vector = await embed(query);
    const index = getPineconeIndex();
    const result = await index.query({ vector, topK, includeMetadata: true });
    return (result.matches ?? []).filter((m) => (m.score ?? 0) >= minScore).map((m) => ({
      id: m.id,
      score: m.score ?? 0,
      text: m.metadata?.text ?? "",
      source: m.metadata?.source ?? void 0
    }));
  } catch (err) {
    console.error("[Pinecone] query error:", err);
    return [];
  }
}
function chunkText(text2, chunkSize = 800, overlap = 100) {
  const words = text2.split(/\s+/);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + chunkSize).join(" ");
    if (slice.trim().length > 50) chunks.push(slice.trim());
    i += chunkSize - overlap;
  }
  return chunks;
}
async function ingestPdfBuffer(buffer, filename) {
  if (!isPineconeReady()) {
    return { chunks: 0, message: "Pinecone not configured (check .env)" };
  }
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default ?? pdfParseModule;
  const parsed = await pdfParse(buffer);
  const raw = parsed.text.replace(/\s+/g, " ").trim();
  if (raw.length < 100) {
    return { chunks: 0, message: "PDF has no readable text" };
  }
  const chunks = chunkText(raw, 800, 120);
  console.log(`[Pinecone] Ingesting "${filename}" \u2192 ${chunks.length} chunks`);
  const index = getPineconeIndex();
  const batchSz = 50;
  const ts = Date.now();
  for (let b = 0; b < chunks.length; b += batchSz) {
    const batch = chunks.slice(b, b + batchSz);
    const vectors = await Promise.all(
      batch.map(async (text2, i) => ({
        id: `${filename.replace(/[^a-z0-9]/gi, "_")}_${ts}_${b + i}`,
        values: await embed(text2),
        metadata: { text: text2, source: filename, chunk: b + i }
      }))
    );
    await index.upsert(vectors);
  }
  return { chunks: chunks.length, message: `Ingested ${chunks.length} chunks from "${filename}"` };
}
var ALLOWED_TOPICS = [
  "stock",
  "share",
  "equity",
  "market",
  "trading",
  "trade",
  "invest",
  "nse",
  "bse",
  "sensex",
  "nifty",
  "index",
  "exchange",
  "technical analysis",
  "chart",
  "pattern",
  "signal",
  "indicator",
  "rsi",
  "macd",
  "bollinger",
  "ema",
  "sma",
  "moving average",
  "candlestick",
  "volume",
  "breakout",
  "reversal",
  "momentum",
  "bullish",
  "bearish",
  "support",
  "resistance",
  "trend",
  "head and shoulders",
  "double top",
  "double bottom",
  "flag",
  "wedge",
  "fibonacci",
  "retracement",
  "pivot",
  "swing",
  "screener",
  "alert",
  "alphasignal",
  "alphagenius",
  "angel one",
  "upstox",
  "portfolio",
  "position",
  "stop loss",
  "target",
  "risk",
  "reward",
  "sector",
  "fundamental",
  "earnings",
  "dividend",
  "ipo",
  "intraday",
  "swing trade",
  "delivery",
  "futures",
  "options",
  "f&o"
];
function isAllowedQuery(query) {
  const lower = query.toLowerCase();
  return ALLOWED_TOPICS.some((topic) => lower.includes(topic));
}
var OFF_TOPIC_REPLY = "I'm **AlphaSignal Bot**, specialized in stock markets, technical analysis, and trading. I can only answer questions related to:\n\n- \u{1F4C8} **Stock patterns** (Head & Shoulders, MACD, RSI, Bollinger Bands, etc.)\n- \u{1F3E6} **NSE / BSE markets**, Nifty, Sensex, indices\n- \u{1F514} **AlphaSignal features** \u2014 screener, alerts, AI Brain Analysis\n- \u{1F4B9} **Trading concepts** \u2014 support/resistance, breakouts, risk management\n\nPlease ask me something related to stocks or trading and I'll be happy to help!";
async function generateChatAnswer(messages, pineconeMatches) {
  const hasKBContext = pineconeMatches.length > 0;
  const latestUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!hasKBContext && !isAllowedQuery(latestUserMsg)) {
    return OFF_TOPIC_REPLY;
  }
  const contextBlock = hasKBContext ? pineconeMatches.map((m, i) => `[${i + 1}] ${m.text}`).join("\n\n") : "";
  const systemPrompt = hasKBContext ? `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The following are the ONLY pieces of information you are allowed to use to answer the user's question. They come from the official AlphaSignal knowledge base document:

--- KNOWLEDGE BASE ---
${contextBlock}
--- END OF KNOWLEDGE BASE ---

STRICT RULES \u2014 follow these without exception:
1. Answer ONLY using the information explicitly stated in the knowledge base above.
2. Do NOT add, invent, or infer any information that is not directly stated in those chunks.
3. Do NOT use your own training data to supplement the answer.
4. If the knowledge base chunks above do not fully answer the question, say exactly: "I only have partial information on this. Based on the knowledge base: [what you found]."
5. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural.
6. Keep the answer concise and accurate \u2014 do not pad with general knowledge.` : `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The user's question was searched in the knowledge base but NO relevant document was found.

You may answer ONLY if the question is about a well-established, factual concept in stock market technical analysis (e.g., what RSI is, how MACD works, what a candlestick pattern means).

STRICT RULES \u2014 follow these without exception:
1. Answer ONLY from well-established, universally accepted facts about stock markets and technical analysis.
2. Do NOT guess, speculate, or generate plausible-sounding but unverified information.
3. Do NOT answer questions about specific stock prices, future predictions, news, or company-specific data.
4. If you are not 100% certain of the answer, respond with: "This specific information is not available in my knowledge base. Please refer to the AlphaSignal platform or consult a SEBI-registered adviser."
5. If the question is about AlphaSignal-specific features or settings not covered in your knowledge, say: "I don't have that specific information. Please use the app directly or contact support."
6. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural. Keep responses concise (under 250 words).
7. Never fabricate \u2014 accuracy over completeness.`;
  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    // zero temperature = no randomness, no hallucination
    max_tokens: 400,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content }))
    ]
  });
  return completion.choices[0]?.message?.content ?? "I'm sorry, I couldn't generate a response. Please try again.";
}
async function streamChatAnswer(messages, pineconeMatches, onChunk) {
  const hasKBContext = pineconeMatches.length > 0;
  const latestUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!hasKBContext && !isAllowedQuery(latestUserMsg)) {
    onChunk(OFF_TOPIC_REPLY);
    return;
  }
  const contextBlock = hasKBContext ? pineconeMatches.map((m, i) => `[${i + 1}] ${m.text}`).join("\n\n") : "";
  const systemPrompt = hasKBContext ? `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The following are the ONLY pieces of information you are allowed to use to answer the user's question. They come from the official AlphaSignal knowledge base document:

--- KNOWLEDGE BASE ---
${contextBlock}
--- END OF KNOWLEDGE BASE ---

STRICT RULES \u2014 follow these without exception:
1. Answer ONLY using the information explicitly stated in the knowledge base above.
2. Do NOT add, invent, or infer any information that is not directly stated in those chunks.
3. Do NOT use your own training data to supplement the answer.
4. If the knowledge base chunks above do not fully answer the question, say exactly: "I only have partial information on this. Based on the knowledge base: [what you found]."
5. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural.
6. Keep the answer concise and accurate \u2014 do not pad with general knowledge.` : `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The user's question was searched in the knowledge base but NO relevant document was found.

You may answer ONLY if the question is about a well-established, factual concept in stock market technical analysis (e.g., what RSI is, how MACD works, what a candlestick pattern means).

STRICT RULES \u2014 follow these without exception:
1. Answer ONLY from well-established, universally accepted facts about stock markets and technical analysis.
2. Do NOT guess, speculate, or generate plausible-sounding but unverified information.
3. Do NOT answer questions about specific stock prices, future predictions, news, or company-specific data.
4. If you are not 100% certain of the answer, respond with: "This specific information is not available in my knowledge base. Please refer to the AlphaSignal platform or consult a SEBI-registered adviser."
5. If the question is about AlphaSignal-specific features or settings not covered in your knowledge, say: "I don't have that specific information. Please use the app directly or contact support."
6. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural. Keep responses concise (under 250 words).
7. Never fabricate \u2014 accuracy over completeness.`;
  const cached = cacheGet(latestUserMsg);
  if (cached) {
    onChunk(cached.answer);
    return;
  }
  const stream = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 250,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content }))
    ]
  });
  let fullAnswer = "";
  for await (const chunk of stream) {
    const text2 = chunk.choices[0]?.delta?.content ?? "";
    if (text2) {
      onChunk(text2);
      fullAnswer += text2;
    }
  }
  if (fullAnswer) cacheSet(latestUserMsg, { matches: pineconeMatches, answer: fullAnswer });
}

// server/services/angelone.ts
import "dotenv/config";
import { TOTP } from "otpauth";
var API_KEY = process.env.ANGEL_API_KEY;
var CLIENT_ID = process.env.ANGEL_CLIENT_ID;
var PASSWORD = process.env.ANGEL_PASSWORD;
var TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;
var BASE_URL = "https://apiconnect.angelbroking.com";
var cachedSession = null;
function generateTOTP() {
  const totp = new TOTP({
    secret: TOTP_SECRET,
    digits: 6,
    algorithm: "SHA1",
    period: 30
  });
  return totp.generate();
}
function buildHeaders(jwtToken) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": API_KEY
  };
  if (jwtToken) headers["Authorization"] = `Bearer ${jwtToken}`;
  return headers;
}
async function angelPost(path3, body, jwtToken) {
  const url = `${BASE_URL}${path3}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(jwtToken),
    body: JSON.stringify(body)
  });
  const text2 = await res.text();
  let data;
  try {
    data = JSON.parse(text2);
  } catch (err) {
    console.error(`[AO] Failed to parse JSON from ${url}. Status: ${res.status}. Body:`, text2.slice(0, 200));
    const isRateLimit = text2.includes("exceeding access rate") || text2.includes("rate limit");
    if (res.status === 401 || res.status === 403 && !isRateLimit) cachedSession = null;
    if (isRateLimit) throw new Error("RATE_LIMIT");
    throw new Error(`Invalid JSON response from Angel One (${res.status})`);
  }
  if (!data.status) {
    const msg = String(data.message || "").toLowerCase();
    if (msg.includes("invalid token") || msg.includes("expired") || data.errorCode === "AG8001") {
      console.warn("[AO] Session invalid (detected from error), clearing cache.");
      cachedSession = null;
    }
    throw new Error(data.message || "Angel One API error");
  }
  return data.data;
}
async function angelGet(path3, jwtToken) {
  const url = `${BASE_URL}${path3}`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(jwtToken)
  });
  const text2 = await res.text();
  let data;
  try {
    data = JSON.parse(text2);
  } catch (err) {
    console.error(`[AO] Failed to parse JSON from ${url}. Status: ${res.status}. Body:`, text2.slice(0, 200));
    const isRateLimit = text2.includes("exceeding access rate") || text2.includes("rate limit");
    if (res.status === 401 || res.status === 403 && !isRateLimit) cachedSession = null;
    if (isRateLimit) throw new Error("RATE_LIMIT");
    throw new Error(`Invalid JSON response from Angel One (${res.status})`);
  }
  if (!data.status) {
    const msg = String(data.message || "").toLowerCase();
    if (msg.includes("invalid token") || msg.includes("expired") || data.errorCode === "AG8001") {
      console.warn("[AO] Session invalid (detected from error), clearing cache.");
      cachedSession = null;
    }
    throw new Error(data.message || "Angel One API error");
  }
  return data.data;
}
var sessionPromise = null;
async function generateSession() {
  if (cachedSession && cachedSession.expiresAt - Date.now() > 5 * 60 * 1e3) {
    return cachedSession;
  }
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    try {
      const totp = generateTOTP();
      const data = await angelPost("/rest/auth/angelbroking/user/v1/loginByPassword", {
        clientcode: CLIENT_ID,
        password: PASSWORD,
        totp
      });
      cachedSession = {
        jwtToken: data.jwtToken,
        refreshToken: data.refreshToken,
        feedToken: data.feedToken,
        // Angel One JWTs expire in 24 hours; cache for 23 h
        expiresAt: Date.now() + 23 * 60 * 60 * 1e3
      };
      return cachedSession;
    } finally {
      sessionPromise = null;
    }
  })();
  return sessionPromise;
}
async function getProfile() {
  const { jwtToken } = await generateSession();
  return angelGet(
    "/rest/secure/angelbroking/user/v1/getProfile",
    jwtToken
  );
}
async function getMarketQuote(exchangeTokens, mode = "FULL") {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/market/v1/quote",
    { mode, exchangeTokens },
    jwtToken
  );
  const result = {};
  const fetched = data?.fetched ?? [];
  for (const item of fetched) {
    const exch = item.exchType || item.exchange || "NSE";
    if (!result[exch]) result[exch] = [];
    result[exch].push(item);
  }
  return result;
}
async function getMarketQuoteSingle(exchange, symbolToken) {
  try {
    const map = await getMarketQuote({ [exchange]: [symbolToken] }, "FULL");
    const arr = map[exchange] ?? Object.values(map).flat();
    return arr[0] ?? null;
  } catch (err) {
    console.warn(`[AO] getMarketQuoteSingle(${exchange}:${symbolToken}) failed:`, err.message);
    return null;
  }
}
async function getLTP(exchange, tradingSymbol, symbolToken) {
  const { jwtToken } = await generateSession();
  return angelPost(
    "/rest/secure/angelbroking/order/v1/getLtpData",
    { exchange, tradingsymbol: tradingSymbol, symboltoken: symbolToken },
    jwtToken
  );
}
async function getHistoricalData(exchange, symbolToken, interval, fromDate, toDate) {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/historical/v1/getCandleData",
    {
      exchange,
      symboltoken: symbolToken,
      interval,
      fromdate: fromDate,
      todate: toDate
    },
    jwtToken
  );
  return data;
}
async function getAllHoldings() {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/portfolio/v1/getAllHolding",
    {},
    jwtToken
  );
  return data.holdings ?? [];
}
async function searchScrip(exchange, searchScripStr) {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/order/v1/searchScrip",
    { exchange, searchscrip: searchScripStr },
    jwtToken
  );
  return data.scrips ?? [];
}

// server/data/nse-symbols.ts
var NSE_SYMBOLS = [
  // ── Banking ──────────────────────────────────────────────────────────────
  { symbol: "HDFCBANK", name: "HDFC Bank Ltd.", token: "1333", sector: "Banking" },
  { symbol: "ICICIBANK", name: "ICICI Bank Ltd.", token: "4963", sector: "Banking" },
  { symbol: "SBIN", name: "State Bank of India", token: "3045", sector: "Banking" },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", token: "1922", sector: "Banking" },
  { symbol: "AXISBANK", name: "Axis Bank Ltd.", token: "5900", sector: "Banking" },
  { symbol: "INDUSINDBK", name: "IndusInd Bank Ltd.", token: "5258", sector: "Banking" },
  { symbol: "BANDHANBNK", name: "Bandhan Bank Ltd.", token: "2263", sector: "Banking" },
  { symbol: "BANKBARODA", name: "Bank of Baroda", token: "4668", sector: "Banking" },
  { symbol: "PNB", name: "Punjab National Bank", token: "10666", sector: "Banking" },
  { symbol: "CANBK", name: "Canara Bank", token: "10794", sector: "Banking" },
  { symbol: "FEDERALBNK", name: "Federal Bank Ltd.", token: "1023", sector: "Banking" },
  { symbol: "IDFCFIRSTB", name: "IDFC First Bank Ltd.", token: "11184", sector: "Banking" },
  { symbol: "RBLBANK", name: "RBL Bank Ltd.", token: "18391", sector: "Banking" },
  { symbol: "AUBANK", name: "AU Small Finance Bank", token: "11879", sector: "Banking" },
  { symbol: "YESBANK", name: "Yes Bank Ltd.", token: "11915", sector: "Banking" },
  { symbol: "DCBBANK", name: "DCB Bank Ltd.", token: "12550", sector: "Banking" },
  { symbol: "SOUTHBANK", name: "South Indian Bank", token: "3151", sector: "Banking" },
  { symbol: "IDBI", name: "IDBI Bank Ltd.", token: "4650", sector: "Banking" },
  { symbol: "KARURVYSYA", name: "Karur Vysya Bank", token: "590", sector: "Banking" },
  { symbol: "J&KBANK", name: "Jammu & Kashmir Bank", token: "1514", sector: "Banking" },
  { symbol: "CSBBANK", name: "CSB Bank Ltd.", token: "2637", sector: "Banking" },
  { symbol: "UJJIVANSFB", name: "Ujjivan Small Finance Bank", token: "3720", sector: "Banking" },
  { symbol: "EQUITASBNK", name: "Equitas Small Finance Bank", token: "5055", sector: "Banking" },
  { symbol: "SURYODAYBNK", name: "Suryoday Small Finance Bank", token: "5552", sector: "Banking" },
  { symbol: "KARNATAKA", name: "Karnataka Bank", token: "2300", sector: "Banking" },
  // ── IT & Technology ───────────────────────────────────────────────────────
  { symbol: "TCS", name: "Tata Consultancy Services", token: "11536", sector: "IT" },
  { symbol: "INFY", name: "Infosys Ltd.", token: "1594", sector: "IT" },
  { symbol: "WIPRO", name: "Wipro Ltd.", token: "3787", sector: "IT" },
  { symbol: "HCLTECH", name: "HCL Technologies", token: "7229", sector: "IT" },
  { symbol: "TECHM", name: "Tech Mahindra Ltd.", token: "13538", sector: "IT" },
  { symbol: "MPHASIS", name: "Mphasis Ltd.", token: "4503", sector: "IT" },
  { symbol: "LTI", name: "LTIMindtree Ltd.", token: "17818", sector: "IT" },
  { symbol: "PERSISTENT", name: "Persistent Systems", token: "18365", sector: "IT" },
  { symbol: "COFORGE", name: "Coforge Ltd.", token: "11543", sector: "IT" },
  { symbol: "OFSS", name: "Oracle Financial Services", token: "2466", sector: "IT" },
  { symbol: "KPITTECH", name: "KPIT Technologies", token: "13055", sector: "IT" },
  { symbol: "LTTS", name: "L&T Technology Services", token: "18073", sector: "IT" },
  { symbol: "TATAELXSI", name: "Tata Elxsi Ltd.", token: "3549", sector: "IT" },
  { symbol: "BIRLASOFT", name: "Birlasoft Ltd.", token: "11403", sector: "IT" },
  { symbol: "MASTEK", name: "Mastek Ltd.", token: "4137", sector: "IT" },
  { symbol: "SONATASOFTW", name: "Sonata Software", token: "9549", sector: "IT" },
  { symbol: "TANLA", name: "Tanla Platforms", token: "14850", sector: "IT" },
  { symbol: "NAUKRI", name: "Info Edge (India) Ltd.", token: "13983", sector: "IT" },
  { symbol: "HAPPYMINDS", name: "Happiest Minds Technologies", token: "6373", sector: "IT" },
  { symbol: "CYIENT", name: "Cyient Ltd.", token: "11259", sector: "IT" },
  { symbol: "INTELLECT", name: "Intellect Design Arena", token: "14404", sector: "IT" },
  { symbol: "ROUTE", name: "Route Mobile Ltd.", token: "16272", sector: "IT" },
  { symbol: "INDIAMART", name: "IndiaMART InterMESH Ltd.", token: "13714", sector: "IT" },
  { symbol: "ZENSARTECH", name: "Zensar Technologies", token: "3900", sector: "IT" },
  { symbol: "TATATECH", name: "Tata Technologies Ltd.", token: "3561", sector: "IT" },
  { symbol: "ECLERX", name: "eClerx Services Ltd.", token: "11357", sector: "IT" },
  { symbol: "RATEGAIN", name: "RateGain Travel Technologies", token: "2752", sector: "IT" },
  { symbol: "NEWGEN", name: "Newgen Software Technologies", token: "11524", sector: "IT" },
  // ── Energy & Oil ──────────────────────────────────────────────────────────
  { symbol: "RELIANCE", name: "Reliance Industries", token: "2885", sector: "Energy" },
  { symbol: "ONGC", name: "ONGC Ltd.", token: "2475", sector: "Energy" },
  { symbol: "BPCL", name: "BPCL Ltd.", token: "526", sector: "Energy" },
  { symbol: "IOC", name: "Indian Oil Corporation", token: "1624", sector: "Energy" },
  { symbol: "HINDPETRO", name: "Hindustan Petroleum Corporation", token: "1283", sector: "Energy" },
  { symbol: "PETRONET", name: "Petronet LNG Ltd.", token: "9030", sector: "Energy" },
  { symbol: "IGL", name: "Indraprastha Gas Ltd.", token: "14254", sector: "Energy" },
  { symbol: "MGL", name: "Mahanagar Gas Ltd.", token: "10152", sector: "Energy" },
  { symbol: "ATGL", name: "Adani Total Gas Ltd.", token: "6733", sector: "Energy" },
  { symbol: "GSPL", name: "Gujarat State Petronet", token: "2168", sector: "Energy" },
  { symbol: "NTPC", name: "NTPC Ltd.", token: "11630", sector: "Power" },
  { symbol: "POWERGRID", name: "Power Grid Corporation", token: "14977", sector: "Power" },
  { symbol: "COALINDIA", name: "Coal India Ltd.", token: "20374", sector: "Mining" },
  { symbol: "ADANIGREEN", name: "Adani Green Energy", token: "25278", sector: "Power" },
  { symbol: "TATAPOWER", name: "Tata Power Company", token: "3426", sector: "Power" },
  { symbol: "TORNTPOWER", name: "Torrent Power Ltd.", token: "13585", sector: "Power" },
  { symbol: "CESC", name: "CESC Ltd.", token: "651", sector: "Power" },
  { symbol: "ADANITRANS", name: "Adani Energy Solutions Ltd.", token: "20936", sector: "Power" },
  // ── FMCG ──────────────────────────────────────────────────────────────────
  { symbol: "ITC", name: "ITC Ltd.", token: "1660", sector: "FMCG" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", token: "1394", sector: "FMCG" },
  { symbol: "NESTLEIND", name: "Nestle India Ltd.", token: "17963", sector: "FMCG" },
  { symbol: "BRITANNIA", name: "Britannia Industries", token: "547", sector: "FMCG" },
  { symbol: "DABUR", name: "Dabur India Ltd.", token: "772", sector: "FMCG" },
  { symbol: "MARICO", name: "Marico Ltd.", token: "4067", sector: "FMCG" },
  { symbol: "COLPAL", name: "Colgate-Palmolive (India)", token: "699", sector: "FMCG" },
  { symbol: "EMAMILTD", name: "Emami Ltd.", token: "934", sector: "FMCG" },
  { symbol: "PGHH", name: "Procter & Gamble Hygiene", token: "2744", sector: "FMCG" },
  { symbol: "JYOTHYLAB", name: "Jyothy Labs Ltd.", token: "15087", sector: "FMCG" },
  { symbol: "RADICO", name: "Radico Khaitan Ltd.", token: "2750", sector: "FMCG" },
  { symbol: "UNITEDSPIR", name: "United Spirits Ltd.", token: "3082", sector: "FMCG" },
  { symbol: "GODREJIND", name: "Godrej Industries Ltd.", token: "1080", sector: "FMCG" },
  // ── Telecom ───────────────────────────────────────────────────────────────
  { symbol: "BHARTIARTL", name: "Bharti Airtel Ltd.", token: "10604", sector: "Telecom" },
  { symbol: "IDEA", name: "Vodafone Idea Ltd.", token: "14427", sector: "Telecom" },
  { symbol: "TATACOMM", name: "Tata Communications Ltd.", token: "2517", sector: "Telecom" },
  { symbol: "INDUSTOWER", name: "Indus Towers Ltd.", token: "13752", sector: "Telecom" },
  // ── Finance & NBFC ────────────────────────────────────────────────────────
  { symbol: "BAJFINANCE", name: "Bajaj Finance Ltd.", token: "317", sector: "Finance" },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv Ltd.", token: "16675", sector: "Finance" },
  { symbol: "HDFCLIFE", name: "HDFC Life Insurance", token: "467", sector: "Insurance" },
  { symbol: "SBILIFE", name: "SBI Life Insurance", token: "21808", sector: "Insurance" },
  { symbol: "CHOLAFIN", name: "Cholamandalam Finance", token: "685", sector: "Finance" },
  { symbol: "POLICYBZR", name: "PB Fintech (Policybazaar)", token: "21238", sector: "Finance" },
  { symbol: "PAYTM", name: "One97 Communications", token: "16547", sector: "Finance" },
  { symbol: "ICICIPRULI", name: "ICICI Prudential Life Insurance", token: "18179", sector: "Insurance" },
  { symbol: "ICICIGI", name: "ICICI Lombard General Insurance", token: "18010", sector: "Insurance" },
  { symbol: "HDFCAMC", name: "HDFC Asset Management Co.", token: "4244", sector: "Finance" },
  { symbol: "NIPPONLIFE", name: "Nippon India AMC", token: "22059", sector: "Finance" },
  { symbol: "LICHSGFIN", name: "LIC Housing Finance", token: "1147", sector: "Finance" },
  { symbol: "RECLTD", name: "REC Limited", token: "11861", sector: "Finance" },
  { symbol: "PFC", name: "Power Finance Corporation", token: "14299", sector: "Finance" },
  { symbol: "IRFC", name: "Indian Railway Finance Corp.", token: "4306", sector: "Finance" },
  { symbol: "MUTHOOTFIN", name: "Muthoot Finance Ltd.", token: "17908", sector: "Finance" },
  { symbol: "MANAPPURAM", name: "Manappuram Finance", token: "4018", sector: "Finance" },
  { symbol: "SHRIRAMFIN", name: "Shriram Finance Ltd.", token: "14611", sector: "Finance" },
  { symbol: "M&MFIN", name: "Mahindra & Mahindra Financial", token: "2043", sector: "Finance" },
  { symbol: "SUNDARMFIN", name: "Sundaram Finance Ltd.", token: "3337", sector: "Finance" },
  { symbol: "CANFINHOME", name: "Can Fin Homes Ltd.", token: "690", sector: "Finance" },
  { symbol: "ABCAPITAL", name: "Aditya Birla Capital Ltd.", token: "13769", sector: "Finance" },
  { symbol: "PNBHOUSING", name: "PNB Housing Finance", token: "14672", sector: "Finance" },
  { symbol: "LICI", name: "Life Insurance Corporation", token: "20224", sector: "Insurance" },
  { symbol: "SBICARD", name: "SBI Cards and Payment Services", token: "20989", sector: "Finance" },
  { symbol: "MOTILALOFS", name: "Motilal Oswal Financial Services", token: "14657", sector: "Finance" },
  { symbol: "ISEC", name: "ICICI Securities Ltd.", token: "5697", sector: "Finance" },
  { symbol: "CDSL", name: "Central Depository Services", token: "21307", sector: "Finance" },
  { symbol: "IEX", name: "Indian Energy Exchange", token: "12770", sector: "Finance" },
  { symbol: "MCX", name: "Multi Commodity Exchange", token: "17234", sector: "Finance" },
  { symbol: "ANGELONE", name: "Angel One Ltd.", token: "14432", sector: "Finance" },
  { symbol: "IIFL", name: "IIFL Finance Ltd.", token: "4687", sector: "Finance" },
  { symbol: "REPCO", name: "Repco Home Finance", token: "2794", sector: "Finance" },
  { symbol: "AAVAS", name: "Aavas Financiers Ltd.", token: "5126", sector: "Finance" },
  { symbol: "CREDITACC", name: "CreditAccess Grameen Ltd.", token: "5730", sector: "Finance" },
  { symbol: "HOMEFIRST", name: "Home First Finance Company", token: "5252", sector: "Finance" },
  // ── Auto & Auto Ancillaries ────────────────────────────────────────────────
  { symbol: "MARUTI", name: "Maruti Suzuki India", token: "10999", sector: "Auto" },
  { symbol: "TATAMOTORS", name: "Tata Motors Ltd.", token: "3456", sector: "Auto" },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp Ltd.", token: "1348", sector: "Auto" },
  { symbol: "EICHERMOT", name: "Eicher Motors Ltd.", token: "910", sector: "Auto" },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto Ltd.", token: "16669", sector: "Auto" },
  { symbol: "M&M", name: "Mahindra & Mahindra", token: "2031", sector: "Auto" },
  { symbol: "ASHOKLEY", name: "Ashok Leyland Ltd.", token: "212", sector: "Auto" },
  { symbol: "TVSMOTOR", name: "TVS Motor Company", token: "2520", sector: "Auto" },
  { symbol: "BOSCHLTD", name: "Bosch Ltd.", token: "2181", sector: "Auto" },
  { symbol: "MOTHERSON", name: "Samvardhana Motherson Intl.", token: "4204", sector: "Auto" },
  { symbol: "APOLLOTYRE", name: "Apollo Tyres Ltd.", token: "162", sector: "Auto" },
  { symbol: "BHARATFORG", name: "Bharat Forge Ltd.", token: "460", sector: "Auto" },
  { symbol: "EXIDEIND", name: "Exide Industries Ltd.", token: "940", sector: "Auto" },
  { symbol: "AMARARAJA", name: "Amara Raja Energy & Mobility", token: "3752", sector: "Auto" },
  { symbol: "MRF", name: "MRF Ltd.", token: "22", sector: "Auto" },
  { symbol: "ESCORTS", name: "Escorts Kubota Ltd.", token: "1087", sector: "Auto" },
  { symbol: "TIINDIA", name: "Tube Investments of India", token: "3534", sector: "Auto" },
  { symbol: "BALKRISIND", name: "Balkrishna Industries", token: "3788", sector: "Auto" },
  { symbol: "SUNDRMFAST", name: "Sundram Fasteners Ltd.", token: "3334", sector: "Auto" },
  { symbol: "LUMAXTECH", name: "Lumax Auto Technologies", token: "2946", sector: "Auto" },
  // ── Pharma ────────────────────────────────────────────────────────────────
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", token: "3351", sector: "Pharma" },
  { symbol: "DRREDDY", name: "Dr. Reddy's Laboratories", token: "881", sector: "Pharma" },
  { symbol: "CIPLA", name: "Cipla Ltd.", token: "694", sector: "Pharma" },
  { symbol: "DIVISLAB", name: "Divi's Laboratories", token: "10940", sector: "Pharma" },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma Ltd.", token: "275", sector: "Pharma" },
  { symbol: "TORNTPHARM", name: "Torrent Pharmaceuticals", token: "3518", sector: "Pharma" },
  { symbol: "LUPIN", name: "Lupin Ltd.", token: "10440", sector: "Pharma" },
  { symbol: "ALKEM", name: "Alkem Laboratories", token: "26300", sector: "Pharma" },
  { symbol: "IPCALAB", name: "IPCA Laboratories", token: "1563", sector: "Pharma" },
  { symbol: "GLENMARK", name: "Glenmark Pharmaceuticals", token: "1102", sector: "Pharma" },
  { symbol: "BIOCON", name: "Biocon Ltd.", token: "541", sector: "Pharma" },
  { symbol: "ABBOTINDIA", name: "Abbott India Ltd.", token: "101", sector: "Pharma" },
  { symbol: "PFIZER", name: "Pfizer Ltd.", token: "2622", sector: "Pharma" },
  { symbol: "GLAXO", name: "GSK Pharmaceuticals India", token: "1148", sector: "Pharma" },
  { symbol: "LAURUSLABS", name: "Laurus Labs Ltd.", token: "14512", sector: "Pharma" },
  { symbol: "ZYDUSLIFE", name: "Zydus Lifesciences Ltd.", token: "5342", sector: "Pharma" },
  { symbol: "GRANULES", name: "Granules India Ltd.", token: "12413", sector: "Pharma" },
  { symbol: "NATCOPHARM", name: "Natco Pharma Ltd.", token: "20098", sector: "Pharma" },
  { symbol: "AJANTPHARM", name: "Ajanta Pharma Ltd.", token: "3975", sector: "Pharma" },
  { symbol: "ALEMBICLTD", name: "Alembic Pharmaceuticals", token: "508", sector: "Pharma" },
  { symbol: "ERIS", name: "Eris Lifesciences Ltd.", token: "13745", sector: "Pharma" },
  { symbol: "NEULANDLAB", name: "Neuland Laboratories", token: "7207", sector: "Pharma" },
  { symbol: "CAPLIPOINT", name: "Caplin Point Laboratories", token: "14523", sector: "Pharma" },
  { symbol: "JUBLPHARMA", name: "Jubilant Pharmova Ltd.", token: "3021", sector: "Pharma" },
  { symbol: "STRIDES", name: "Strides Pharma Science", token: "2248", sector: "Pharma" },
  // ── Metals & Mining ───────────────────────────────────────────────────────
  { symbol: "HINDALCO", name: "Hindalco Industries Ltd.", token: "1363", sector: "Metals" },
  { symbol: "JSWSTEEL", name: "JSW Steel Ltd.", token: "11723", sector: "Metals" },
  { symbol: "TATASTEEL", name: "Tata Steel Ltd.", token: "3499", sector: "Metals" },
  { symbol: "VEDL", name: "Vedanta Ltd.", token: "3063", sector: "Metals" },
  { symbol: "NATIONALUM", name: "National Aluminium Company", token: "17606", sector: "Metals" },
  { symbol: "HINDCOPPER", name: "Hindustan Copper Ltd.", token: "14494", sector: "Metals" },
  { symbol: "WELCORP", name: "Welspun Corp Ltd.", token: "3784", sector: "Metals" },
  { symbol: "MOIL", name: "MOIL Ltd.", token: "13583", sector: "Mining" },
  // ── Cement & Building Materials ───────────────────────────────────────────
  { symbol: "GRASIM", name: "Grasim Industries Ltd.", token: "1232", sector: "Cement" },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement Ltd.", token: "11532", sector: "Cement" },
  { symbol: "AMBUJACEMENT", name: "Ambuja Cements Ltd.", token: "1270", sector: "Cement" },
  { symbol: "JKCEMENT", name: "JK Cement Ltd.", token: "2288", sector: "Cement" },
  { symbol: "RAMCOCEM", name: "Ramco Cements Ltd.", token: "2672", sector: "Cement" },
  { symbol: "DALMIA", name: "Dalmia Bharat Ltd.", token: "13947", sector: "Cement" },
  { symbol: "HEIDELBERG", name: "HeidelbergCement India", token: "3553", sector: "Cement" },
  { symbol: "BIRLACORPN", name: "Birla Corporation Ltd.", token: "501", sector: "Cement" },
  { symbol: "STARCEMENT", name: "Star Cement Ltd.", token: "6285", sector: "Cement" },
  // ── Consumer & Retail ─────────────────────────────────────────────────────
  { symbol: "ASIANPAINT", name: "Asian Paints Ltd.", token: "236", sector: "Consumer" },
  { symbol: "TITAN", name: "Titan Company Ltd.", token: "3506", sector: "Consumer" },
  { symbol: "TATACONSUM", name: "Tata Consumer Products", token: "3432", sector: "FMCG" },
  { symbol: "GODREJCP", name: "Godrej Consumer Products", token: "10099", sector: "FMCG" },
  { symbol: "BERGEPAINT", name: "Berger Paints India", token: "404", sector: "Consumer" },
  { symbol: "HAVELLS", name: "Havells India Ltd.", token: "9819", sector: "Consumer" },
  { symbol: "DIXON", name: "Dixon Technologies", token: "19913", sector: "Consumer" },
  { symbol: "DMART", name: "Avenue Supermarts (DMart)", token: "11522", sector: "Retail" },
  { symbol: "TRENT", name: "Trent Ltd.", token: "3513", sector: "Retail" },
  { symbol: "ZOMATO", name: "Zomato Ltd.", token: "5097", sector: "Consumer" },
  { symbol: "NYKAA", name: "FSN E-Commerce (Nykaa)", token: "13751", sector: "Retail" },
  { symbol: "BATAINDIA", name: "Bata India Ltd.", token: "339", sector: "Consumer" },
  { symbol: "PAGEIND", name: "Page Industries Ltd.", token: "14413", sector: "Consumer" },
  { symbol: "ABFRL", name: "Aditya Birla Fashion Retail", token: "14992", sector: "Retail" },
  { symbol: "SHOPERSTOP", name: "Shoppers Stop Ltd.", token: "5533", sector: "Retail" },
  { symbol: "VMART", name: "V-Mart Retail Ltd.", token: "16735", sector: "Retail" },
  { symbol: "VEDANT", name: "Vedant Fashions Ltd. (Manyavar)", token: "5378", sector: "Retail" },
  { symbol: "RELAXO", name: "Relaxo Footwear Ltd.", token: "3773", sector: "Consumer" },
  { symbol: "METRO", name: "Metro Brands Ltd.", token: "5437", sector: "Retail" },
  { symbol: "KAJARIACER", name: "Kajaria Ceramics Ltd.", token: "2072", sector: "Consumer" },
  { symbol: "SYMPHONY", name: "Symphony Ltd.", token: "3306", sector: "Consumer" },
  { symbol: "VOLTAS", name: "Voltas Ltd.", token: "3129", sector: "Consumer" },
  { symbol: "WHIRLPOOL", name: "Whirlpool of India Ltd.", token: "3082", sector: "Consumer" },
  { symbol: "CROMPTON", name: "Crompton Greaves Consumer Elect.", token: "20878", sector: "Consumer" },
  { symbol: "BLUESTAR", name: "Blue Star Ltd.", token: "1077", sector: "Consumer" },
  { symbol: "RAYMOND", name: "Raymond Ltd.", token: "2746", sector: "Consumer" },
  { symbol: "ARVIND", name: "Arvind Ltd.", token: "215", sector: "Textiles" },
  { symbol: "TRIDENT", name: "Trident Ltd.", token: "5340", sector: "Textiles" },
  // ── Infra & Conglomerates ─────────────────────────────────────────────────
  { symbol: "LT", name: "Larsen & Toubro Ltd.", token: "11483", sector: "Infra" },
  { symbol: "ADANIPORTS", name: "Adani Ports & SEZ", token: "15083", sector: "Infra" },
  { symbol: "ADANIENT", name: "Adani Enterprises", token: "25", sector: "Conglomerate" },
  { symbol: "SIEMENS", name: "Siemens Ltd.", token: "3280", sector: "Infra" },
  { symbol: "ABB", name: "ABB India Ltd.", token: "13", sector: "Infra" },
  { symbol: "THERMAX", name: "Thermax Ltd.", token: "3481", sector: "Capital Goods" },
  { symbol: "CGPOWER", name: "CG Power & Industrial Solutions", token: "534", sector: "Capital Goods" },
  { symbol: "CUMMINSIND", name: "Cummins India Ltd.", token: "736", sector: "Capital Goods" },
  { symbol: "KEC", name: "KEC International Ltd.", token: "1858", sector: "Infra" },
  { symbol: "AIAENG", name: "AIA Engineering Ltd.", token: "3524", sector: "Capital Goods" },
  { symbol: "SKFINDIA", name: "SKF India Ltd.", token: "2992", sector: "Capital Goods" },
  { symbol: "NCC", name: "NCC Ltd.", token: "14550", sector: "Infra" },
  { symbol: "KALPATPOWR", name: "Kalpataru Projects International", token: "1893", sector: "Infra" },
  { symbol: "GRINDWELL", name: "Grindwell Norton Ltd.", token: "1141", sector: "Capital Goods" },
  { symbol: "APAR", name: "APAR Industries Ltd.", token: "2020", sector: "Capital Goods" },
  { symbol: "ELGIEQUIP", name: "Elgi Equipments Ltd.", token: "912", sector: "Capital Goods" },
  { symbol: "TRITURBINE", name: "Triveni Turbine Ltd.", token: "5543", sector: "Capital Goods" },
  { symbol: "TITAGARH", name: "Titagarh Rail Systems", token: "3541", sector: "Capital Goods" },
  // ── Healthcare & Diagnostics ──────────────────────────────────────────────
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", token: "157", sector: "Healthcare" },
  { symbol: "MAXHEALTH", name: "Max Healthcare Institute", token: "27913", sector: "Healthcare" },
  { symbol: "NARAYANA", name: "Narayana Hrudayalaya Ltd.", token: "21229", sector: "Healthcare" },
  { symbol: "FORTIS", name: "Fortis Healthcare Ltd.", token: "15108", sector: "Healthcare" },
  { symbol: "LALPATHLAB", name: "Dr. Lal PathLabs Ltd.", token: "9467", sector: "Healthcare" },
  { symbol: "METROPOLIS", name: "Metropolis Healthcare Ltd.", token: "11520", sector: "Healthcare" },
  { symbol: "KIMS", name: "KIMS Health Care Management", token: "21503", sector: "Healthcare" },
  { symbol: "RAINBOW", name: "Rainbow Children's Medicare", token: "5290", sector: "Healthcare" },
  // ── Chemicals & Agri ──────────────────────────────────────────────────────
  { symbol: "UPL", name: "UPL Ltd.", token: "11287", sector: "Agri" },
  { symbol: "PIDILITIND", name: "Pidilite Industries", token: "2664", sector: "Chemicals" },
  { symbol: "AARTI", name: "Aarti Industries Ltd.", token: "7", sector: "Chemicals" },
  { symbol: "DEEPAKNTR", name: "Deepak Nitrite Ltd.", token: "15044", sector: "Chemicals" },
  { symbol: "NAVINFLUOR", name: "Navin Fluorine Intl.", token: "22248", sector: "Chemicals" },
  { symbol: "SRF", name: "SRF Ltd.", token: "3273", sector: "Chemicals" },
  { symbol: "TATACHEM", name: "Tata Chemicals Ltd.", token: "3442", sector: "Chemicals" },
  { symbol: "PIIND", name: "PI Industries Ltd.", token: "13374", sector: "Chemicals" },
  { symbol: "NOCIL", name: "NOCIL Ltd.", token: "3033", sector: "Chemicals" },
  { symbol: "COROMANDEL", name: "Coromandel International", token: "706", sector: "Agri" },
  { symbol: "CHAMBALL", name: "Chambal Fertilizers", token: "636", sector: "Agri" },
  { symbol: "GNFC", name: "Gujarat Narmada Valley Fertilizers", token: "1186", sector: "Chemicals" },
  { symbol: "RALLIS", name: "Rallis India Ltd.", token: "2765", sector: "Agri" },
  { symbol: "ALKYLAMINE", name: "Alkyl Amines Chemicals", token: "24513", sector: "Chemicals" },
  { symbol: "VINATIORGA", name: "Vinati Organics Ltd.", token: "3083", sector: "Chemicals" },
  { symbol: "GALAXYSURF", name: "Galaxy Surfactants Ltd.", token: "13733", sector: "Chemicals" },
  { symbol: "CLEAN", name: "Clean Science and Technology", token: "5048", sector: "Chemicals" },
  { symbol: "FINEORG", name: "Fine Organic Industries", token: "5022", sector: "Chemicals" },
  { symbol: "KRBL", name: "KRBL Ltd. (India Gate Rice)", token: "1988", sector: "Agri" },
  { symbol: "AVANTIFEED", name: "Avanti Feeds Ltd.", token: "14423", sector: "Agri" },
  { symbol: "KAVERI", name: "Kaveri Seed Company", token: "20070", sector: "Agri" },
  // ── PSU / Defence / Railways ──────────────────────────────────────────────
  { symbol: "HAL", name: "Hindustan Aeronautics Ltd.", token: "2303", sector: "Defence" },
  { symbol: "BEL", name: "Bharat Electronics Ltd.", token: "383", sector: "Defence" },
  { symbol: "BHEL", name: "Bharat Heavy Electricals", token: "438", sector: "PSU" },
  { symbol: "GAIL", name: "GAIL (India) Ltd.", token: "1098", sector: "PSU" },
  { symbol: "NMDC", name: "NMDC Ltd.", token: "15332", sector: "PSU" },
  { symbol: "SAIL", name: "Steel Authority of India", token: "2963", sector: "PSU" },
  { symbol: "IRCTC", name: "Indian Railway Catering", token: "13611", sector: "PSU" },
  { symbol: "RVNL", name: "Rail Vikas Nigam Ltd.", token: "9552", sector: "PSU" },
  { symbol: "COCHINSHIP", name: "Cochin Shipyard Ltd.", token: "18143", sector: "Defence" },
  { symbol: "DRDO", name: "Data Patterns (India)", token: "633455", sector: "Defence" },
  { symbol: "BEML", name: "BEML Ltd.", token: "386", sector: "Defence" },
  { symbol: "CONCOR", name: "Container Corporation of India", token: "12024", sector: "Logistics" },
  { symbol: "MAZAGON", name: "Mazagon Dock Shipbuilders", token: "26670", sector: "Defence" },
  { symbol: "MIDHANI", name: "Mishra Dhatu Nigam Ltd.", token: "3791", sector: "Defence" },
  { symbol: "GRSE", name: "Garden Reach Shipbuilders", token: "3814", sector: "Defence" },
  { symbol: "ITI", name: "ITI Ltd.", token: "1566", sector: "PSU" },
  { symbol: "NBCC", name: "NBCC (India) Ltd.", token: "15124", sector: "PSU" },
  { symbol: "IRCON", name: "IRCON International Ltd.", token: "11260", sector: "PSU" },
  // ── Real Estate ───────────────────────────────────────────────────────────
  { symbol: "DLF", name: "DLF Ltd.", token: "14366", sector: "Real Estate" },
  { symbol: "GODREJPROP", name: "Godrej Properties Ltd.", token: "10786", sector: "Real Estate" },
  { symbol: "PRESTIGE", name: "Prestige Estates Projects", token: "14416", sector: "Real Estate" },
  { symbol: "PHOENIXLTD", name: "Phoenix Mills Ltd.", token: "14626", sector: "Real Estate" },
  { symbol: "MACROTECH", name: "Macrotech Developers (Lodha)", token: "5431", sector: "Real Estate" },
  { symbol: "SOBHA", name: "Sobha Ltd.", token: "18200", sector: "Real Estate" },
  { symbol: "BRIGADE", name: "Brigade Enterprises Ltd.", token: "11096", sector: "Real Estate" },
  { symbol: "SUNTECKREALTY", name: "Sunteck Realty Ltd.", token: "3467", sector: "Real Estate" },
  // ── Hospitality & Travel ──────────────────────────────────────────────────
  { symbol: "INDHOTEL", name: "Indian Hotels Company Ltd.", token: "1555", sector: "Hospitality" },
  { symbol: "LEMONTREE", name: "Lemon Tree Hotels Ltd.", token: "15148", sector: "Hospitality" },
  { symbol: "JUBLFOOD", name: "Jubilant FoodWorks (Dominos)", token: "2977", sector: "Consumer" },
  { symbol: "DEVYANI", name: "Devyani International Ltd.", token: "5281", sector: "Consumer" },
  // ── Media & Entertainment ─────────────────────────────────────────────────
  { symbol: "ZEEL", name: "Zee Entertainment Enterprises", token: "1522", sector: "Media" },
  { symbol: "SUNTV", name: "Sun TV Network Ltd.", token: "3463", sector: "Media" },
  { symbol: "PVRINOX", name: "PVR INOX Ltd.", token: "13553", sector: "Media" },
  { symbol: "DISHTV", name: "Dish TV India Ltd.", token: "13776", sector: "Media" },
  { symbol: "NETWORK18", name: "Network18 Media & Investments", token: "13896", sector: "Media" },
  // ── Consumer Electronics / Others ─────────────────────────────────────────
  { symbol: "BERGEPAINT", name: "Berger Paints India Ltd.", token: "404", sector: "Consumer" },
  { symbol: "KANSAINER", name: "Kansai Nerolac Paints", token: "1864", sector: "Consumer" },
  { symbol: "INDIGO", name: "IndiGo (InterGlobe Aviation)", token: "11195", sector: "Aviation" },
  // ── Logistics & Supply Chain ──────────────────────────────────────────────
  { symbol: "ALLCARGO", name: "Allcargo Logistics Ltd.", token: "75", sector: "Logistics" },
  { symbol: "DELHIVERY", name: "Delhivery Ltd.", token: "4977", sector: "Logistics" },
  { symbol: "VRLLOGISTIC", name: "VRL Logistics Ltd.", token: "11356", sector: "Logistics" },
  { symbol: "BLUEDART", name: "Blue Dart Express Ltd.", token: "5960", sector: "Logistics" },
  { symbol: "MAHINDCIE", name: "Mahindra CIE Automotive", token: "15251", sector: "Auto" }
];

// server/data/bse-symbols.ts
var BSE_SYMBOLS = [
  // ── Banking ──────────────────────────────────────────────────────────────
  { symbol: "HDFCBANK", name: "HDFC Bank Ltd.", token: "500180", nseToken: "1333", sector: "Banking" },
  { symbol: "ICICIBANK", name: "ICICI Bank Ltd.", token: "532174", nseToken: "4963", sector: "Banking" },
  { symbol: "SBIN", name: "State Bank of India", token: "500112", nseToken: "3045", sector: "Banking" },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", token: "500247", nseToken: "1922", sector: "Banking" },
  { symbol: "AXISBANK", name: "Axis Bank Ltd.", token: "532215", nseToken: "5900", sector: "Banking" },
  { symbol: "INDUSINDBK", name: "IndusInd Bank Ltd.", token: "532187", nseToken: "5258", sector: "Banking" },
  { symbol: "BANDHANBNK", name: "Bandhan Bank Ltd.", token: "541153", nseToken: "2263", sector: "Banking" },
  // ── IT ────────────────────────────────────────────────────────────────────
  { symbol: "TCS", name: "Tata Consultancy Services", token: "532540", nseToken: "11536", sector: "IT" },
  { symbol: "INFY", name: "Infosys Ltd.", token: "500209", nseToken: "1594", sector: "IT" },
  { symbol: "WIPRO", name: "Wipro Ltd.", token: "507685", nseToken: "3787", sector: "IT" },
  { symbol: "HCLTECH", name: "HCL Technologies", token: "532281", nseToken: "7229", sector: "IT" },
  { symbol: "TECHM", name: "Tech Mahindra Ltd.", token: "532755", nseToken: "13538", sector: "IT" },
  { symbol: "MPHASIS", name: "Mphasis Ltd.", token: "526299", nseToken: "4503", sector: "IT" },
  // ── Energy & Oil ──────────────────────────────────────────────────────────
  { symbol: "RELIANCE", name: "Reliance Industries", token: "500325", nseToken: "2885", sector: "Energy" },
  { symbol: "ONGC", name: "ONGC Ltd.", token: "500312", nseToken: "2475", sector: "Energy" },
  { symbol: "BPCL", name: "BPCL Ltd.", token: "500547", nseToken: "526", sector: "Energy" },
  { symbol: "IOC", name: "Indian Oil Corporation", token: "530965", nseToken: "1624", sector: "Energy" },
  { symbol: "NTPC", name: "NTPC Ltd.", token: "532555", nseToken: "11630", sector: "Power" },
  { symbol: "POWERGRID", name: "Power Grid Corporation", token: "532898", nseToken: "14977", sector: "Power" },
  { symbol: "COALINDIA", name: "Coal India Ltd.", token: "533278", nseToken: "20374", sector: "Mining" },
  { symbol: "ADANIGREEN", name: "Adani Green Energy", token: "541450", nseToken: "25278", sector: "Power" },
  // ── FMCG ──────────────────────────────────────────────────────────────────
  { symbol: "ITC", name: "ITC Ltd.", token: "500875", nseToken: "1660", sector: "FMCG" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", token: "500696", nseToken: "1394", sector: "FMCG" },
  { symbol: "NESTLEIND", name: "Nestle India Ltd.", token: "500790", nseToken: "17963", sector: "FMCG" },
  { symbol: "BRITANNIA", name: "Britannia Industries", token: "500825", nseToken: "547", sector: "FMCG" },
  { symbol: "DABUR", name: "Dabur India Ltd.", token: "500096", nseToken: "772", sector: "FMCG" },
  { symbol: "MARICO", name: "Marico Ltd.", token: "531642", nseToken: "4067", sector: "FMCG" },
  // ── Telecom ───────────────────────────────────────────────────────────────
  { symbol: "BHARTIARTL", name: "Bharti Airtel Ltd.", token: "532454", nseToken: "10604", sector: "Telecom" },
  // ── Finance ───────────────────────────────────────────────────────────────
  { symbol: "BAJFINANCE", name: "Bajaj Finance Ltd.", token: "500034", nseToken: "317", sector: "Finance" },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv Ltd.", token: "532978", nseToken: "16675", sector: "Finance" },
  { symbol: "HDFCLIFE", name: "HDFC Life Insurance", token: "540777", nseToken: "467", sector: "Insurance" },
  { symbol: "SBILIFE", name: "SBI Life Insurance", token: "540719", nseToken: "21808", sector: "Insurance" },
  { symbol: "CHOLAFIN", name: "Cholamandalam Finance", token: "500081", nseToken: "685", sector: "Finance" },
  // ── Auto ──────────────────────────────────────────────────────────────────
  { symbol: "MARUTI", name: "Maruti Suzuki India", token: "532500", nseToken: "10999", sector: "Auto" },
  { symbol: "TATAMOTORS", name: "Tata Motors Ltd.", token: "500570", nseToken: "3456", sector: "Auto" },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp Ltd.", token: "500182", nseToken: "1348", sector: "Auto" },
  { symbol: "EICHERMOT", name: "Eicher Motors Ltd.", token: "505200", nseToken: "910", sector: "Auto" },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto Ltd.", token: "532977", nseToken: "16669", sector: "Auto" },
  { symbol: "M&M", name: "Mahindra & Mahindra", token: "500520", nseToken: "2031", sector: "Auto" },
  // ── Pharma ────────────────────────────────────────────────────────────────
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", token: "524715", nseToken: "3351", sector: "Pharma" },
  { symbol: "DRREDDY", name: "Dr. Reddy's Laboratories", token: "500124", nseToken: "881", sector: "Pharma" },
  { symbol: "CIPLA", name: "Cipla Ltd.", token: "500087", nseToken: "694", sector: "Pharma" },
  { symbol: "DIVISLAB", name: "Divi's Laboratories", token: "532488", nseToken: "10940", sector: "Pharma" },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma Ltd.", token: "524804", nseToken: "275", sector: "Pharma" },
  { symbol: "TORNTPHARM", name: "Torrent Pharmaceuticals", token: "500420", nseToken: "3518", sector: "Pharma" },
  // ── Metals & Materials ────────────────────────────────────────────────────
  { symbol: "HINDALCO", name: "Hindalco Industries Ltd.", token: "500440", nseToken: "1363", sector: "Metals" },
  { symbol: "JSWSTEEL", name: "JSW Steel Ltd.", token: "500228", nseToken: "11723", sector: "Metals" },
  { symbol: "TATASTEEL", name: "Tata Steel Ltd.", token: "500470", nseToken: "3499", sector: "Metals" },
  { symbol: "VEDL", name: "Vedanta Ltd.", token: "500295", nseToken: "3063", sector: "Metals" },
  { symbol: "GRASIM", name: "Grasim Industries Ltd.", token: "500300", nseToken: "1232", sector: "Cement" },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement Ltd.", token: "532538", nseToken: "11532", sector: "Cement" },
  { symbol: "AMBUJACEMENT", name: "Ambuja Cements Ltd.", token: "500425", nseToken: "1270", sector: "Cement" },
  // ── Consumer & Retail ─────────────────────────────────────────────────────
  { symbol: "ASIANPAINT", name: "Asian Paints Ltd.", token: "500820", nseToken: "236", sector: "Consumer" },
  { symbol: "TITAN", name: "Titan Company Ltd.", token: "500114", nseToken: "3506", sector: "Consumer" },
  { symbol: "TATACONSUM", name: "Tata Consumer Products", token: "500800", nseToken: "3432", sector: "FMCG" },
  { symbol: "GODREJCP", name: "Godrej Consumer Products", token: "532424", nseToken: "10099", sector: "FMCG" },
  // ── Infra & Conglomerates ─────────────────────────────────────────────────
  { symbol: "LT", name: "Larsen & Toubro Ltd.", token: "500510", nseToken: "11483", sector: "Infra" },
  { symbol: "ADANIPORTS", name: "Adani Ports & SEZ", token: "532921", nseToken: "15083", sector: "Infra" },
  { symbol: "ADANIENT", name: "Adani Enterprises", token: "512599", nseToken: "25", sector: "Conglomerate" },
  { symbol: "SIEMENS", name: "Siemens Ltd.", token: "500550", nseToken: "3280", sector: "Infra" },
  // ── Healthcare ────────────────────────────────────────────────────────────
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", token: "508869", nseToken: "157", sector: "Healthcare" },
  // ── Others ────────────────────────────────────────────────────────────────
  { symbol: "UPL", name: "UPL Ltd.", token: "512070", nseToken: "11287", sector: "Agri" },
  { symbol: "PIDILITIND", name: "Pidilite Industries", token: "500331", nseToken: "2664", sector: "Chemicals" },
  { symbol: "BERGEPAINT", name: "Berger Paints India", token: "509480", nseToken: "404", sector: "Consumer" },
  { symbol: "HAVELLS", name: "Havells India Ltd.", token: "517354", nseToken: "9819", sector: "Consumer" },
  { symbol: "DMART", name: "Avenue Supermarts (DMart)", token: "540376", nseToken: "11522", sector: "Retail" },
  { symbol: "TRENT", name: "Trent Ltd.", token: "500251", nseToken: "3513", sector: "Retail" }
];

// server/data/pattern-engine.ts
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
var DISCLAIMER = "This signal is generated by an automated technical analysis algorithm and is for educational and informational purposes only. It does not constitute investment advice. Consult a SEBI-registered investment advisor before making any investment decisions. Past pattern performance does not guarantee future results.";
function sma(candles, period) {
  const result = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    const slice = candles.slice(i - period + 1, i + 1);
    result.push(slice.reduce((s, c) => s + c.close, 0) / period);
  }
  return result;
}
function avgVolume(candles, period = 20) {
  const slice = candles.slice(-period - 1, -1);
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}
function rsiSeries(candles, period = 14) {
  const closes = candles.map((c) => c.close);
  const result = new Array(period).fill(NaN);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-4)));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-4)));
  }
  return result;
}
function atr(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    trs.push(Math.max(hl, hc, lc));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}
function calculateArithmeticScore(baseScore, candles, isBullish, indicators, backtestCount) {
  let score = 25;
  let breakdown = ["- Pattern pivots present (+25)"];
  const n = candles.length - 1;
  const volRatio = candles[n].volume / indicators.vol20Avg;
  if (volRatio > 1.5) {
    score += 20;
    breakdown.push(`- High volume confirmation ${volRatio.toFixed(1)}x (+20)`);
  } else if (volRatio > 1.1) {
    score += 10;
    breakdown.push("- Moderate volume buildup (+10)");
  }
  const r = indicators.rsi;
  if (isBullish) {
    if (r < 40) {
      score += 15;
      breakdown.push("- Oversold RSI strength (+15)");
    } else if (r > 60) {
      score += 15;
      breakdown.push("- Bullish momentum RSI (+15)");
    }
  } else {
    if (r > 60) {
      score += 15;
      breakdown.push("- Overbought RSI weakness (+15)");
    }
  }
  if (isBullish && indicators.sma20 > indicators.sma50) {
    score += 15;
    breakdown.push("- SMA Trend alignment (+15)");
  } else if (!isBullish && indicators.sma20 < indicators.sma50) {
    score += 15;
    breakdown.push("- SMA Trend alignment (+15)");
  }
  if (isBullish && indicators.macd.histogram > 0) {
    score += 15;
    breakdown.push("- MACD Histogram bullish (+15)");
  } else if (!isBullish && indicators.macd.histogram < 0) {
    score += 15;
    breakdown.push("- MACD Histogram bearish (+15)");
  }
  if (backtestCount > 10) {
    score += 10;
    breakdown.push("- High historical statistical reliability (+10)");
  }
  return {
    score: Math.min(100, score),
    breakdown: breakdown.join("\n")
  };
}
function calculateIndicators(candles) {
  const n = candles.length - 1;
  const sma20Series = sma(candles, 20);
  const sma50Series = sma(candles, 50);
  const rsi = rsiSeries(candles);
  const atrVal = atr(candles);
  const volAvg = avgVolume(candles, 20);
  const ema12 = calculateEMA(candles.map((c) => c.close), 12);
  const ema26 = calculateEMA(candles.map((c) => c.close), 26);
  const macdVal = ema12[n] - ema26[n];
  const signalSeries = calculateEMA(ema12.map((v, i) => v - ema26[i]), 9);
  const signalVal = signalSeries[n];
  const std = calculateStdDev(candles.map((c) => c.close).slice(-20), sma20Series[n] || 0);
  const upper = (sma20Series[n] || 0) + std * 2;
  const lower = (sma20Series[n] || 0) - std * 2;
  return {
    rsi: rsi[n] || 50,
    rsiDivergence: false,
    // will be updated if detectRSIDivergence is used
    sma20: sma20Series[n] || 0,
    sma50: sma50Series[n] || 0,
    macd: { macd: macdVal, signal: signalVal, histogram: macdVal - signalVal },
    bollinger: { upper, middle: sma20Series[n] || 0, lower },
    atr: atrVal,
    vol20Avg: volAvg
  };
}
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const results = [data[0]];
  for (let i = 1; i < data.length; i++) {
    results.push(data[i] * k + results[i - 1] * (1 - k));
  }
  return results;
}
function calculateStdDev(data, mean) {
  if (data.length === 0) return 0;
  const variance = data.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / data.length;
  return Math.sqrt(variance);
}
async function computeIndicators(candles) {
  const input = JSON.stringify({ candles });
  try {
    const venvPath = path.join(process.cwd(), "python", ".venv", "Scripts", "python.exe");
    const pythonPath = fs.existsSync(venvPath) ? `"${venvPath}"` : "python";
    const scriptPath = path.join(process.cwd(), "python", "engine.py");
    const result = execSync(`${pythonPath} "${scriptPath}"`, {
      input,
      encoding: "utf-8",
      timeout: 1e4
    });
    const data = JSON.parse(result);
    if (data.error) throw new Error(data.error);
    return data;
  } catch (err) {
    console.warn("[PythonEngine] Fallback to TS indicators:", err.message);
    return calculateIndicators(candles);
  }
}
function detectMACross(candles, indicators) {
  if (candles.length < 55) return null;
  const sma20 = sma(candles, 20);
  const sma50 = sma(candles, 50);
  const n = candles.length - 1;
  if (isNaN(sma20[n - 1]) || isNaN(sma50[n - 1])) return null;
  const crossedUp = sma20[n - 1] < sma50[n - 1] && sma20[n] > sma50[n];
  const crossedDown = sma20[n - 1] > sma50[n - 1] && sma20[n] < sma50[n];
  if (!crossedUp && !crossedDown) return null;
  const ltp = candles[n].close;
  const isBullish = crossedUp;
  const { score, breakdown } = calculateArithmeticScore(80, candles, isBullish, indicators, 0);
  const volConfirmed = candles[n].volume > indicators.vol20Avg * 1.5;
  return {
    id: `mac_${Date.now()}`,
    patternName: isBullish ? "Golden Cross" : "Death Cross",
    type: isBullish ? "Bullish" : "Bearish",
    patternCategory: "Momentum",
    timeframeClass: "Positional",
    explanation: {
      en: isBullish ? `The 20-day moving average has crossed above the 50-day moving average, forming a Golden Cross on the daily chart. This indicates that short-term momentum has shifted decisively upward.` : `The 20-day moving average has crossed below the 50-day moving average, forming a Death Cross on the daily chart. This indicates that short-term momentum has shifted downward.`,
      hi: isBullish ? `20-\u0926\u093F\u0935\u0938\u0940\u092F \u092E\u0942\u0935\u093F\u0902\u0917 \u090F\u0935\u0930\u0947\u091C, 50-\u0926\u093F\u0935\u0938\u0940\u092F \u092E\u0942\u0935\u093F\u0902\u0917 \u090F\u0935\u0930\u0947\u091C \u0938\u0947 \u090A\u092A\u0930 \u0915\u094D\u0930\u0949\u0938 \u0939\u0941\u0908 \u0939\u0948\u0964 \u092F\u0939 \u0938\u0902\u0915\u0947\u0924 \u0926\u0947\u0924\u093E \u0939\u0948 \u0915\u093F \u0905\u0932\u094D\u092A\u0915\u093E\u0932\u093F\u0915 \u0917\u0924\u093F \u090A\u092A\u0930 \u0915\u0940 \u0913\u0930 \u092C\u0926\u0932 \u0917\u0908 \u0939\u0948\u0964` : `20-\u0926\u093F\u0935\u0938\u0940\u092F \u092E\u0942\u0935\u093F\u0902\u0917 \u090F\u0935\u0930\u0947\u091C, 50-\u0926\u093F\u0935\u0938\u0940\u092F \u092E\u0942\u0935\u093F\u0902\u0917 \u090F\u0935\u0930\u0947\u091C \u0938\u0947 \u0928\u0940\u091A\u0947 \u0915\u094D\u0930\u0949\u0938 \u0939\u0941\u0908 \u0939\u0948\u0964 \u092F\u0939 \u0938\u0902\u0915\u0947\u0924 \u0926\u0947\u0924\u093E \u0939\u0948 \u0915\u093F \u0905\u0932\u094D\u092A\u0915\u093E\u0932\u093F\u0915 \u0917\u0924\u093F \u0928\u0940\u091A\u0947 \u0915\u0940 \u0913\u0930 \u092C\u0926\u0932 \u0917\u0908 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: isBullish ? 73.2 : 70.8,
    historicalOccurrences: 0,
    entry: isBullish ? `${ltp.toFixed(2)} \u2013 ${(ltp * 1.005).toFixed(2)}` : `Below ${ltp.toFixed(2)}`,
    stopLoss: isBullish ? `${(ltp * 0.95).toFixed(2)}` : `${(ltp * 1.05).toFixed(2)}`,
    target1: isBullish ? `${(ltp * 1.07).toFixed(2)}` : `${(ltp * 0.93).toFixed(2)}`,
    target2: isBullish ? `${(ltp * 1.13).toFixed(2)}` : `${(ltp * 0.87).toFixed(2)}`,
    riskReward: `1:${(ltp * 0.13 / (ltp * 0.05)).toFixed(1)}`,
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectRSIDivergence(candles, indicators) {
  if (candles.length < 35) return null;
  const rsi = rsiSeries(candles);
  const n = candles.length - 1;
  const windowSize = 20;
  const priceSlice = candles.slice(n - windowSize, n + 1);
  const rsiSlice = rsi.slice(n - windowSize, n + 1);
  let t1 = -1, t2 = -1;
  for (let i = 2; i < priceSlice.length - 2; i++) {
    if (priceSlice[i].low < priceSlice[i - 1].low && priceSlice[i].low < priceSlice[i + 1].low) {
      if (t1 === -1) {
        t1 = i;
      } else if (i - t1 > 5) {
        t2 = i;
      }
    }
  }
  if (t1 === -1 || t2 === -1) return null;
  const priceMakesLowerLow = priceSlice[t2].low < priceSlice[t1].low;
  const rsiMakesHigherLow = rsiSlice[t2] > rsiSlice[t1];
  if (!priceMakesLowerLow || !rsiMakesHigherLow) return null;
  const rsiNow = indicators.rsi;
  if (isNaN(rsiNow) || rsiNow > 55) return null;
  const ltp = candles[n].close;
  const atrVal = indicators.atr;
  const { score, breakdown } = calculateArithmeticScore(70, candles, true, indicators, 0);
  const volConfirmed = candles[n].volume > indicators.vol20Avg * 1.1;
  return {
    id: `rsi_${Date.now()}`,
    patternName: "RSI Divergence",
    type: "Bullish",
    patternCategory: "Divergence",
    timeframeClass: "Swing",
    explanation: {
      en: `Bullish RSI divergence has been detected. While the price made a lower low, the RSI oscillator simultaneously made a higher low. This indicates weakening downward momentum.`,
      hi: `\u092C\u0941\u0932\u093F\u0936 RSI \u0921\u093E\u0907\u0935\u0930\u094D\u091C\u0947\u0902\u0938 \u092E\u093F\u0932\u093E \u0939\u0948\u0964 \u0915\u0940\u092E\u0924 \u0928\u0947 \u0915\u092E \u0928\u093F\u091A\u0932\u093E \u0938\u094D\u0924\u0930 \u092C\u0928\u093E\u092F\u093E \u091C\u092C\u0915\u093F RSI \u0928\u0947 \u090A\u0901\u091A\u093E \u0928\u093F\u091A\u0932\u093E \u0938\u094D\u0924\u0930 \u092C\u0928\u093E\u092F\u093E\u0964 \u092F\u0939 \u0928\u0940\u091A\u0947 \u0915\u0940 \u0917\u0924\u093F \u0915\u0947 \u0915\u092E\u091C\u094B\u0930 \u0939\u094B\u0928\u0947 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 68.5,
    historicalOccurrences: 0,
    entry: `${ltp.toFixed(2)} \u2013 ${(ltp + atrVal * 0.3).toFixed(2)}`,
    stopLoss: `${(priceSlice[t2].low * 0.98).toFixed(2)}`,
    target1: `${(ltp + atrVal * 2).toFixed(2)}`,
    target2: `${(ltp + atrVal * 3.5).toFixed(2)}`,
    riskReward: (() => {
      const riskAmt = Math.abs(ltp - priceSlice[t2].low * 0.98);
      const rewardAmt = atrVal * 3.5;
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectDoubleBottom(candles, indicators) {
  if (candles.length < 45) return null;
  const slice = candles.slice(-45);
  const lows = slice.map((c) => c.low);
  const avgLow = lows.reduce((a, b) => a + b, 0) / lows.length;
  let t1 = -1, t2 = -1;
  for (let i = 4; i < lows.length - 4; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1] && lows[i] < avgLow) {
      if (t1 === -1) t1 = i;
      else if (i - t1 > 8 && Math.abs(lows[i] - lows[t1]) / lows[t1] < 0.04) {
        t2 = i;
        break;
      }
    }
  }
  if (t1 === -1 || t2 === -1) return null;
  const ltp = candles[candles.length - 1].close;
  const neckline = Math.max(...slice.slice(t1, t2 + 1).map((c) => c.high));
  if (ltp < neckline * 0.97) return null;
  const { score, breakdown } = calculateArithmeticScore(75, candles, true, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.15;
  return {
    id: `dbl_${Date.now()}`,
    patternName: "Double Bottom",
    type: "Bullish",
    patternCategory: "Reversal",
    timeframeClass: "Swing",
    explanation: {
      en: `A Double Bottom has formed. The stock tested support twice near \u20B9${lows[t1].toFixed(2)}.`,
      hi: `\u0921\u092C\u0932 \u092C\u0949\u091F\u092E \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0938\u094D\u091F\u0949\u0915 \u0928\u0947 \u20B9${lows[t1].toFixed(2)} \u0915\u0947 \u092A\u093E\u0938 \u0926\u094B \u092C\u093E\u0930 \u0938\u092A\u094B\u0930\u094D\u091F \u0932\u093F\u092F\u093E\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 71.4,
    historicalOccurrences: 0,
    entry: `Above ${neckline.toFixed(2)}`,
    stopLoss: `${(lows[t1] * 0.97).toFixed(2)}`,
    target1: `${(neckline + (neckline - lows[t1])).toFixed(2)}`,
    target2: `${(neckline + (neckline - lows[t1]) * 1.6).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = lows[t1] * 0.97;
      const target2Price = neckline + (neckline - lows[t1]) * 1.6;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectDoubleTop(candles, indicators) {
  if (candles.length < 45) return null;
  const slice = candles.slice(-45);
  const highs = slice.map((c) => c.high);
  const avgHigh = highs.reduce((a, b) => a + b, 0) / highs.length;
  let p1 = -1, p2 = -1;
  for (let i = 4; i < highs.length - 4; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1] && highs[i] > avgHigh * 1.01) {
      if (p1 === -1) p1 = i;
      else if (i - p1 > 8 && Math.abs(highs[i] - highs[p1]) / highs[p1] < 0.04) {
        p2 = i;
        break;
      }
    }
  }
  if (p1 === -1 || p2 === -1) return null;
  const ltp = candles[candles.length - 1].close;
  const neckline = Math.min(...slice.slice(p1, p2 + 1).map((c) => c.low));
  if (ltp > neckline * 1.03) return null;
  const { score, breakdown } = calculateArithmeticScore(72, candles, false, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.1;
  return {
    id: `dbt_${Date.now()}`,
    patternName: "Double Top",
    type: "Bearish",
    patternCategory: "Reversal",
    timeframeClass: "Swing",
    explanation: {
      en: `A Double Top has formed. The stock failed to break above \u20B9${highs[p1].toFixed(2)} twice.`,
      hi: `\u0921\u092C\u0932 \u091F\u0949\u092A \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0938\u094D\u091F\u0949\u0915 \u20B9${highs[p1].toFixed(2)} \u0938\u0947 \u090A\u092A\u0930 \u091C\u093E\u0928\u0947 \u092E\u0947\u0902 \u0926\u094B \u092C\u093E\u0930 \u0935\u093F\u092B\u0932 \u0930\u0939\u093E\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 69.8,
    historicalOccurrences: 0,
    entry: `Below ${neckline.toFixed(2)}`,
    stopLoss: `${(highs[p1] * 1.02).toFixed(2)}`,
    target1: `${(neckline - (highs[p1] - neckline)).toFixed(2)}`,
    target2: `${(neckline - (highs[p1] - neckline) * 1.6).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = highs[p1] * 1.02;
      const target2Price = neckline - (highs[p1] - neckline) * 1.6;
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectHeadAndShoulders(candles, indicators) {
  if (candles.length < 60) return null;
  const slice = candles.slice(-60);
  const highs = slice.map((c) => c.high);
  const closes = slice.map((c) => c.close);
  const headIdx = highs.reduce((mi, v, i) => v > highs[mi] ? i : mi, 0);
  if (headIdx < 10 || headIdx > slice.length - 10) return null;
  let lsIdx = -1;
  for (let i = 5; i < headIdx - 3; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
      if (lsIdx === -1 || highs[i] > highs[lsIdx]) lsIdx = i;
    }
  }
  let rsIdx = -1;
  for (let i = headIdx + 3; i < slice.length - 5; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
      if (rsIdx === -1 || highs[i] > highs[rsIdx]) rsIdx = i;
    }
  }
  if (lsIdx === -1 || rsIdx === -1) return null;
  const head = highs[headIdx];
  const ls = highs[lsIdx];
  const rs = highs[rsIdx];
  if (head <= ls * 1.02 || head <= rs * 1.02) return null;
  if (Math.abs(ls - rs) / Math.max(ls, rs) > 0.08) return null;
  const leftTroughIdx = slice.slice(lsIdx, headIdx + 1).reduce((mi, c, i) => c.low < slice[lsIdx + mi].low ? i : mi, 0) + lsIdx;
  const rightTroughIdx = slice.slice(headIdx, rsIdx + 1).reduce((mi, c, i) => c.low < slice[headIdx + mi].low ? i : mi, 0) + headIdx;
  const neckline = (slice[leftTroughIdx].low + slice[rightTroughIdx].low) / 2;
  const ltp = closes[closes.length - 1];
  if (ltp > neckline * 1.03) return null;
  const { score, breakdown } = calculateArithmeticScore(75, candles, false, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.1;
  return {
    id: `hs_${Date.now()}`,
    patternName: "Head & Shoulders",
    type: "Bearish",
    patternCategory: "Reversal",
    timeframeClass: "Positional",
    explanation: {
      en: `A bearish Head & Shoulders pattern has formed over the past ${Math.round(slice.length * 0.8)} trading days. The stock created three peaks \u2014 a left shoulder (\u20B9${ls.toFixed(2)}), a higher head (\u20B9${head.toFixed(2)}), and a right shoulder (\u20B9${rs.toFixed(2)}) \u2014 with the middle peak being the highest. This pattern signals exhaustion of buyers and a potential major trend reversal from bullish to bearish. A decisive breakdown below the neckline at \u20B9${neckline.toFixed(2)} would confirm the pattern.`,
      hi: `\u092E\u0902\u0926\u0940 \u0935\u093E\u0932\u093E \u0939\u0947\u0921 \u090F\u0902\u0921 \u0936\u094B\u0932\u094D\u0921\u0930 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0924\u0940\u0928 \u0936\u0940\u0930\u094D\u0937 \u092C\u0928\u0947 \u0939\u0948\u0902 \u2014 \u092C\u093E\u092F\u093E \u0915\u0902\u0927\u093E (\u20B9${ls.toFixed(2)}), \u0938\u093F\u0930 (\u20B9${head.toFixed(2)}), \u0914\u0930 \u0926\u093E\u092F\u093E \u0915\u0902\u0927\u093E (\u20B9${rs.toFixed(2)})\u0964 \u0928\u0947\u0915\u0932\u093E\u0907\u0928 \u20B9${neckline.toFixed(2)} \u0938\u0947 \u0928\u0940\u091A\u0947 \u092C\u0902\u0926 \u0939\u094B\u0928\u093E \u092E\u0902\u0926\u0940 \u0915\u0940 \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0947\u0917\u093E\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 74.2,
    historicalOccurrences: 0,
    entry: `Below ${neckline.toFixed(2)}`,
    stopLoss: `${(rs * 1.03).toFixed(2)}`,
    target1: `${(neckline - (head - neckline) * 0.6).toFixed(2)}`,
    target2: `${(neckline - (head - neckline)).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = rs * 1.03;
      const target2Price = neckline - (head - neckline);
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectCupAndHandle(candles, indicators) {
  if (candles.length < 65) return null;
  const slice = candles.slice(-65);
  const q1End = Math.floor(slice.length * 0.15);
  const q3Start = Math.floor(slice.length * 0.65);
  const leftMin = slice.slice(0, q1End).reduce((mi, c, i) => c.high > slice[i < mi ? i : mi].high ? i : mi, 0);
  const leftPeak = slice[leftMin].high;
  const cupSection = slice.slice(q1End, q3Start);
  const cupBottomLocal = cupSection.reduce((mi, c, i) => c.low < cupSection[mi].low ? i : mi, 0);
  const cupBottom = cupSection[cupBottomLocal].low;
  const cupDepth = (leftPeak - cupBottom) / leftPeak;
  if (cupDepth < 0.1 || cupDepth > 0.45) return null;
  const rightSection = slice.slice(q3Start);
  const rightPeak = Math.max(...rightSection.map((c) => c.high));
  if (Math.abs(rightPeak - leftPeak) / leftPeak > 0.1) return null;
  const handleSection = slice.slice(-12);
  const handleLow = Math.min(...handleSection.map((c) => c.low));
  const handleHigh = Math.max(...handleSection.map((c) => c.high));
  const handleDepth = (handleHigh - handleLow) / handleHigh;
  if (handleDepth > 0.15 || handleDepth < 0.02) return null;
  const ltp = slice[slice.length - 1].close;
  if (ltp < handleLow * 0.96 || ltp > rightPeak * 1.02) return null;
  const { score, breakdown } = calculateArithmeticScore(80, candles, true, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.4;
  return {
    id: `cah_${Date.now()}`,
    patternName: "Cup & Handle",
    type: "Bullish",
    patternCategory: "Breakout",
    timeframeClass: "Positional",
    explanation: {
      en: `A Cup & Handle pattern has formed. The stock recovered from a cup bottom at \u20B9${cupBottom.toFixed(2)} and is consolidating.`,
      hi: `\u0915\u092A \u0914\u0930 \u0939\u0948\u0902\u0921\u0932 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0938\u094D\u091F\u0949\u0915 \u20B9${cupBottom.toFixed(2)} \u0915\u0947 \u0928\u093F\u091A\u0932\u0947 \u0938\u094D\u0924\u0930 \u0938\u0947 \u0909\u092C\u0930\u0928\u0947 \u0915\u0947 \u092C\u093E\u0926 \u0938\u092E\u0947\u0915\u093F\u0924 \u0939\u094B \u0930\u0939\u093E \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 68.9,
    historicalOccurrences: 0,
    entry: `${rightPeak.toFixed(2)} \u2013 ${(rightPeak * 1.008).toFixed(2)}`,
    stopLoss: `${handleLow.toFixed(2)}`,
    target1: `${(rightPeak + (rightPeak - cupBottom) * 0.5).toFixed(2)}`,
    target2: `${(rightPeak + (rightPeak - cupBottom)).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = handleLow;
      const target2Price = rightPeak + (rightPeak - cupBottom);
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectAscendingTriangle(candles, indicators) {
  if (candles.length < 35) return null;
  const slice = candles.slice(-35);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const maxHigh = Math.max(...highs);
  const touchesResistance = highs.filter((h) => h > maxHigh * 0.98).length;
  if (touchesResistance < 3) return null;
  const firstLow = Math.min(...lows.slice(0, 8));
  const lastLow = Math.min(...lows.slice(-8));
  if (lastLow <= firstLow * 1.02) return null;
  const ltp = candles[candles.length - 1].close;
  if (ltp < maxHigh * 0.96) return null;
  const { score, breakdown } = calculateArithmeticScore(70, candles, true, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.15;
  return {
    id: `tri_${Date.now()}`,
    patternName: "Ascending Triangle",
    type: "Bullish",
    patternCategory: "Breakout",
    timeframeClass: "Swing",
    explanation: {
      en: `An Ascending Triangle is forming. Higher lows are being made against a flat resistance at \u20B9${maxHigh.toFixed(2)}.`,
      hi: `\u0906\u0930\u094B\u0939\u0940 \u0924\u094D\u0930\u093F\u092D\u0941\u091C \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928 \u0930\u0939\u093E \u0939\u0948\u0964 \u20B9${maxHigh.toFixed(2)} \u092A\u0930 \u092A\u094D\u0930\u0924\u093F\u0930\u094B\u0927 \u0915\u0947 \u0916\u093F\u0932\u093E\u092B \u090A\u0901\u091A\u0947 \u0928\u093F\u091A\u0932\u0947 \u0938\u094D\u0924\u0930 \u092C\u0928 \u0930\u0939\u0947 \u0939\u0948\u0902\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 72.3,
    historicalOccurrences: 0,
    entry: `Above ${maxHigh.toFixed(2)}`,
    stopLoss: `${lastLow.toFixed(2)}`,
    target1: `${(maxHigh + (maxHigh - firstLow) * 0.5).toFixed(2)}`,
    target2: `${(maxHigh + (maxHigh - firstLow)).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = lastLow;
      const target2Price = maxHigh + (maxHigh - firstLow);
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectHammer(candles, indicators) {
  if (candles.length < 20) return null;
  const c = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = Math.abs(c.close - c.open);
  const lowerWick = c.open < c.close ? c.open - c.low : c.close - c.low;
  const upperWick = c.open < c.close ? c.high - c.close : c.high - c.open;
  if (body === 0) return null;
  const isHammer = lowerWick >= body * 2 && upperWick <= body * 0.35;
  if (!isHammer) return null;
  const priorTrend = candles.slice(-10, -1);
  const trendDown = priorTrend[0].close > priorTrend[priorTrend.length - 1].close;
  if (!trendDown) return null;
  const ltp = c.close;
  const { score, breakdown } = calculateArithmeticScore(67, candles, true, indicators, 0);
  const volConfirmed = c.volume > indicators.vol20Avg * 1.3;
  return {
    id: `hmr_${Date.now()}`,
    patternName: "Hammer",
    type: "Bullish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `A Hammer candlestick has formed after a sustained downtrend. The candle has a small real body near the top of the day's range (open: \u20B9${c.open.toFixed(2)}, close: \u20B9${c.close.toFixed(2)}) and a long lower shadow reaching \u20B9${c.low.toFixed(2)}, indicating that sellers drove prices lower during the session but buyers stepped in aggressively to push prices back up. This is a classic single-candle bullish reversal signal at potential support.`,
      hi: `\u0917\u093F\u0930\u093E\u0935\u091F \u0915\u0947 \u092C\u093E\u0926 \u0939\u0948\u092E\u0930 \u0915\u0948\u0902\u0921\u0932 \u092C\u0928\u093E \u0939\u0948\u0964 \u0932\u0902\u092C\u0940 \u0928\u093F\u091A\u0932\u0940 \u091B\u093E\u092F\u093E (\u20B9${c.low.toFixed(2)}) \u0914\u0930 \u091B\u094B\u091F\u093E \u0930\u093F\u092F\u0932 \u092C\u0949\u0921\u0940 \u0926\u0930\u094D\u0936\u093E\u0924\u0940 \u0939\u0948 \u0915\u093F \u092C\u093F\u0915\u0935\u093E\u0932\u094B\u0902 \u0928\u0947 \u0915\u0940\u092E\u0924 \u0928\u0940\u091A\u0947 \u0927\u0915\u0947\u0932\u0940 \u0932\u0947\u0915\u093F\u0928 \u0916\u0930\u0940\u0926\u093E\u0930\u094B\u0902 \u0928\u0947 \u0915\u0940\u092E\u0924 \u0935\u093E\u092A\u0938 \u090A\u092A\u0930 \u0915\u0930 \u0926\u0940\u0964 \u092F\u0939 \u090F\u0915 \u0924\u0947\u091C\u0940 \u0915\u0947 \u0909\u0932\u091F\u093E\u0935 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 60.1,
    historicalOccurrences: 0,
    entry: `${(ltp * 1.001).toFixed(2)} \u2013 ${(ltp * 1.005).toFixed(2)}`,
    stopLoss: `${(c.low * 0.99).toFixed(2)}`,
    target1: `${(ltp * 1.04).toFixed(2)}`,
    target2: `${(ltp * 1.08).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = c.low * 0.99;
      const target2Price = ltp * 1.08;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectShootingStar(candles, indicators) {
  if (candles.length < 20) return null;
  const c = candles[candles.length - 1];
  const body = Math.abs(c.close - c.open);
  const upperWick = c.open > c.close ? c.high - c.open : c.high - c.close;
  const lowerWick = c.open > c.close ? c.close - c.low : c.open - c.low;
  if (body === 0) return null;
  const isStar = upperWick >= body * 2 && lowerWick <= body * 0.35 && c.close < c.open;
  if (!isStar) return null;
  const priorTrend = candles.slice(-10, -1);
  const trendUp = priorTrend[0].close < priorTrend[priorTrend.length - 1].close;
  if (!trendUp) return null;
  const ltp = c.close;
  const { score, breakdown } = calculateArithmeticScore(65, candles, false, indicators, 0);
  const volConfirmed = c.volume > indicators.vol20Avg * 1.3;
  return {
    id: `shs_${Date.now()}`,
    patternName: "Shooting Star",
    type: "Bearish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `A Shooting Star candlestick has formed after a sustained uptrend. The candle has a small real body near the bottom of the day's range and a long upper shadow reaching \u20B9${c.high.toFixed(2)}, indicating that buyers attempted to push prices higher during the session but were overwhelmed by sellers. This bearish reversal candle at potential resistance suggests the rally may be losing momentum and a pullback could follow.`,
      hi: `\u0924\u0947\u091C\u0940 \u0915\u0947 \u092C\u093E\u0926 \u0936\u0942\u091F\u093F\u0902\u0917 \u0938\u094D\u091F\u093E\u0930 \u0915\u0948\u0902\u0921\u0932 \u092C\u0928\u093E \u0939\u0948\u0964 \u0932\u0902\u092C\u0940 \u090A\u092A\u0930\u0940 \u091B\u093E\u092F\u093E (\u20B9${c.high.toFixed(2)}) \u0914\u0930 \u091B\u094B\u091F\u093E \u0930\u093F\u092F\u0932 \u092C\u0949\u0921\u0940 \u0926\u0930\u094D\u0936\u093E\u0924\u0940 \u0939\u0948 \u0915\u093F \u0916\u0930\u0940\u0926\u093E\u0930 \u0915\u092E\u091C\u094B\u0930 \u092A\u0921\u093C \u0930\u0939\u0947 \u0939\u0948\u0902\u0964 \u092F\u0939 \u090F\u0915 \u092E\u0902\u0926\u0940 \u0915\u0947 \u0909\u0932\u091F\u093E\u0935 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 58.4,
    historicalOccurrences: 0,
    entry: `Below ${ltp.toFixed(2)}`,
    stopLoss: `${(c.high * 1.01).toFixed(2)}`,
    target1: `${(ltp * 0.96).toFixed(2)}`,
    target2: `${(ltp * 0.92).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = c.high * 1.01;
      const target2Price = ltp * 0.92;
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectBullishEngulfing(candles, indicators) {
  if (candles.length < 20) return null;
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  const prevBearish = prev.close < prev.open;
  const currBullish = curr.close > curr.open;
  const engulfs = curr.open < prev.close && curr.close > prev.open;
  if (!prevBearish || !currBullish || !engulfs) return null;
  const priorTrend = candles.slice(-12, -2);
  const trendDown = priorTrend[0].close > priorTrend[priorTrend.length - 1].close;
  if (!trendDown) return null;
  const ltp = curr.close;
  const { score, breakdown } = calculateArithmeticScore(70, candles, true, indicators, 0);
  const volConfirmed = curr.volume > indicators.vol20Avg * 1.4;
  return {
    id: `bue_${Date.now()}`,
    patternName: "Bullish Engulfing",
    type: "Bullish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `A Bullish Engulfing pattern has formed, one of the strongest single-session reversal signals. Today's bullish candle (open: \u20B9${curr.open.toFixed(2)}, close: \u20B9${curr.close.toFixed(2)}) completely engulfs yesterday's bearish candle (open: \u20B9${prev.open.toFixed(2)}, close: \u20B9${prev.close.toFixed(2)}). This decisive shift from selling to buying pressure, particularly after the recent downtrend, signals a potential reversal. Confirmation on the next session would strengthen the signal.`,
      hi: `\u092C\u0941\u0932\u093F\u0936 \u090F\u0902\u0917\u0932\u094D\u092B\u093F\u0902\u0917 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0906\u091C \u0915\u093E \u0939\u0930\u093E \u0915\u0948\u0902\u0921\u0932 (\u0915\u094D\u0932\u094B\u091C: \u20B9${curr.close.toFixed(2)}) \u0915\u0932 \u0915\u0947 \u0932\u093E\u0932 \u0915\u0948\u0902\u0921\u0932 (\u0915\u094D\u0932\u094B\u091C: \u20B9${prev.close.toFixed(2)}) \u0915\u094B \u092A\u0942\u0930\u0940 \u0924\u0930\u0939 \u0922\u0915 \u0932\u0947\u0924\u093E \u0939\u0948\u0964 \u092F\u0939 \u092C\u093F\u0915\u0935\u093E\u0932\u0940 \u0938\u0947 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0915\u0940 \u0913\u0930 \u092E\u091C\u092C\u0942\u0924 \u092C\u0926\u0932\u093E\u0935 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 63.7,
    historicalOccurrences: 0,
    entry: `${ltp.toFixed(2)} \u2013 ${(ltp * 1.003).toFixed(2)}`,
    stopLoss: `${(curr.low * 0.99).toFixed(2)}`,
    target1: `${(ltp * 1.05).toFixed(2)}`,
    target2: `${(ltp * 1.09).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = curr.low * 0.99;
      const target2Price = ltp * 1.09;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectBearishEngulfing(candles, indicators) {
  if (candles.length < 20) return null;
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  const prevBullish = prev.close > prev.open;
  const currBearish = curr.close < curr.open;
  const engulfs = curr.open > prev.close && curr.close < prev.open;
  if (!prevBullish || !currBearish || !engulfs) return null;
  const priorTrend = candles.slice(-12, -2);
  const trendUp = priorTrend[0].close < priorTrend[priorTrend.length - 1].close;
  if (!trendUp) return null;
  const ltp = curr.close;
  const { score, breakdown } = calculateArithmeticScore(68, candles, false, indicators, 0);
  const volConfirmed = curr.volume > indicators.vol20Avg * 1.4;
  return {
    id: `bee_${Date.now()}`,
    patternName: "Bearish Engulfing",
    type: "Bearish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `A Bearish Engulfing pattern has formed after the recent uptrend. Today's bearish candle (open: \u20B9${curr.open.toFixed(2)}, close: \u20B9${curr.close.toFixed(2)}) completely engulfs yesterday's bullish candle, indicating a decisive shift in sentiment from buying to selling. This pattern at potential resistance zones often marks the end of an upswing and the beginning of a correction.`,
      hi: `\u0924\u0947\u091C\u0940 \u0915\u0947 \u092C\u093E\u0926 \u092C\u0947\u092F\u0930\u093F\u0936 \u090F\u0902\u0917\u0932\u094D\u092B\u093F\u0902\u0917 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0906\u091C \u0915\u093E \u0932\u093E\u0932 \u0915\u0948\u0902\u0921\u0932 (\u0915\u094D\u0932\u094B\u091C: \u20B9${curr.close.toFixed(2)}) \u0915\u0932 \u0915\u0947 \u0939\u0930\u0947 \u0915\u0948\u0902\u0921\u0932 \u0915\u094B \u092A\u0942\u0930\u0940 \u0924\u0930\u0939 \u0922\u0915 \u0932\u0947\u0924\u093E \u0939\u0948\u0964 \u092F\u0939 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0938\u0947 \u092C\u093F\u0915\u0935\u093E\u0932\u0940 \u0915\u0940 \u0913\u0930 \u092E\u091C\u092C\u0942\u0924 \u092C\u0926\u0932\u093E\u0935 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 61.2,
    historicalOccurrences: 0,
    entry: `Below ${ltp.toFixed(2)}`,
    stopLoss: `${(curr.high * 1.01).toFixed(2)}`,
    target1: `${(ltp * 0.95).toFixed(2)}`,
    target2: `${(ltp * 0.91).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = curr.high * 1.01;
      const target2Price = ltp * 0.91;
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectHighBreakout(candles, indicators) {
  if (candles.length < 60) return null;
  const yearSlice = candles.slice(-252);
  const historicHigh = Math.max(...yearSlice.slice(0, -5).map((c) => c.high));
  const recent = candles.slice(-3);
  const currentHigh = Math.max(...recent.map((c) => c.high));
  if (currentHigh < historicHigh * 1.005) return null;
  const ltp = candles[candles.length - 1].close;
  if (indicators.rsi < 55) return null;
  const { score, breakdown } = calculateArithmeticScore(80, candles, true, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.5;
  return {
    id: `nhb_${Date.now()}`,
    patternName: "52-Week High Breakout",
    type: "Bullish",
    patternCategory: "Breakout",
    timeframeClass: "Positional",
    explanation: {
      en: `The stock has broken out to a new high at \u20B9${currentHigh.toFixed(2)}, surpassing \u20B9${historicHigh.toFixed(2)}.`,
      hi: `\u0938\u094D\u091F\u0949\u0915 \u20B9${currentHigh.toFixed(2)} \u092A\u0930 \u0928\u090F \u0909\u091A\u094D\u091A \u0938\u094D\u0924\u0930 \u092A\u0930 \u092C\u094D\u0930\u0947\u0915\u0906\u0909\u091F \u0939\u0941\u0906 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 67.3,
    historicalOccurrences: 0,
    entry: `${ltp.toFixed(2)} \u2013 ${(currentHigh * 1.005).toFixed(2)}`,
    stopLoss: `${(historicHigh * 0.97).toFixed(2)}`,
    target1: `${(currentHigh * 1.06).toFixed(2)}`,
    target2: `${(currentHigh * 1.12).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = historicHigh * 0.97;
      const target2Price = currentHigh * 1.12;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectBearishRSIDivergence(candles, indicators) {
  if (candles.length < 35) return null;
  const rsi = rsiSeries(candles);
  const n = candles.length - 1;
  const windowSize = 20;
  const priceSlice = candles.slice(n - windowSize, n + 1);
  const rsiSlice = rsi.slice(n - windowSize, n + 1);
  let p1 = -1, p2 = -1;
  for (let i = 2; i < priceSlice.length - 2; i++) {
    if (priceSlice[i].high > priceSlice[i - 1].high && priceSlice[i].high > priceSlice[i + 1].high) {
      if (p1 === -1) {
        p1 = i;
      } else if (i - p1 > 5) {
        p2 = i;
      }
    }
  }
  if (p1 === -1 || p2 === -1) return null;
  const priceMakesHigherHigh = priceSlice[p2].high > priceSlice[p1].high;
  const rsiMakesLowerHigh = rsiSlice[p2] < rsiSlice[p1];
  if (!priceMakesHigherHigh || !rsiMakesLowerHigh) return null;
  const rsiNow = indicators.rsi;
  if (isNaN(rsiNow) || rsiNow < 50) return null;
  const ltp = candles[n].close;
  const atrVal = indicators.atr;
  const { score, breakdown } = calculateArithmeticScore(68, candles, false, indicators, 0);
  const volConfirmed = candles[n].volume > indicators.vol20Avg * 1.1;
  return {
    id: `brsi_${Date.now()}`,
    patternName: "Bearish RSI Divergence",
    type: "Bearish",
    patternCategory: "Divergence",
    timeframeClass: "Swing",
    explanation: {
      en: `Bearish RSI divergence has been detected. While the price made a higher high (\u20B9${priceSlice[p2].high.toFixed(2)} vs \u20B9${priceSlice[p1].high.toFixed(2)}), the RSI oscillator simultaneously made a lower high (${rsiSlice[p2].toFixed(1)} vs ${rsiSlice[p1].toFixed(1)}). This weakening upward momentum warns that the rally may be exhausting itself even as price grinds higher \u2014 a classic signal that smart money may be distributing.`,
      hi: `\u092E\u0902\u0926\u0940 \u0935\u093E\u0932\u093E RSI \u0921\u093E\u0907\u0935\u0930\u094D\u091C\u0947\u0902\u0938 \u092E\u093F\u0932\u093E \u0939\u0948\u0964 \u0915\u0940\u092E\u0924 \u0928\u0947 \u090A\u0901\u091A\u093E \u0936\u0940\u0930\u094D\u0937 (\u20B9${priceSlice[p2].high.toFixed(2)}) \u092C\u0928\u093E\u092F\u093E \u091C\u092C\u0915\u093F RSI \u0928\u0947 \u0928\u0940\u091A\u0947 \u0936\u0940\u0930\u094D\u0937 (${rsiSlice[p2].toFixed(1)}) \u092C\u0928\u093E\u092F\u093E\u0964 \u092F\u0939 \u090A\u092A\u0930 \u0915\u0940 \u0917\u0924\u093F \u0915\u0947 \u0915\u092E\u091C\u094B\u0930 \u0939\u094B\u0928\u0947 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 66.2,
    historicalOccurrences: 0,
    entry: `Below ${ltp.toFixed(2)}`,
    stopLoss: `${(priceSlice[p2].high * 1.02).toFixed(2)}`,
    target1: `${(ltp - atrVal * 2).toFixed(2)}`,
    target2: `${(ltp - atrVal * 3.5).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = priceSlice[p2].high * 1.02;
      const target2Price = ltp - atrVal * 3.5;
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectInvertedHeadAndShoulders(candles, indicators) {
  if (candles.length < 60) return null;
  const slice = candles.slice(-60);
  const lows = slice.map((c) => c.low);
  const closes = slice.map((c) => c.close);
  const headIdx = lows.reduce((mi, v, i) => v < lows[mi] ? i : mi, 0);
  if (headIdx < 10 || headIdx > slice.length - 10) return null;
  let lsIdx = -1;
  for (let i = 5; i < headIdx - 3; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
      if (lsIdx === -1 || lows[i] < lows[lsIdx]) lsIdx = i;
    }
  }
  let rsIdx = -1;
  for (let i = headIdx + 3; i < slice.length - 5; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
      if (rsIdx === -1 || lows[i] < lows[rsIdx]) rsIdx = i;
    }
  }
  if (lsIdx === -1 || rsIdx === -1) return null;
  const head = lows[headIdx];
  const ls = lows[lsIdx];
  const rs = lows[rsIdx];
  if (head >= ls * 0.98 || head >= rs * 0.98) return null;
  if (Math.abs(ls - rs) / Math.min(ls, rs) > 0.08) return null;
  const leftPeakSlice = slice.slice(lsIdx, headIdx + 1);
  const rightPeakSlice = slice.slice(headIdx, rsIdx + 1);
  const leftPeak = Math.max(...leftPeakSlice.map((c) => c.high));
  const rightPeak = Math.max(...rightPeakSlice.map((c) => c.high));
  const neckline = (leftPeak + rightPeak) / 2;
  const ltp = closes[closes.length - 1];
  if (ltp < neckline * 0.97) return null;
  const { score, breakdown } = calculateArithmeticScore(76, candles, true, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.2;
  return {
    id: `ihs_${Date.now()}`,
    patternName: "Inverted Head & Shoulders",
    type: "Bullish",
    patternCategory: "Reversal",
    timeframeClass: "Positional",
    explanation: {
      en: `A bullish Inverted Head & Shoulders pattern has formed over the past ${Math.round(slice.length * 0.8)} trading sessions. Three troughs were created \u2014 a left shoulder (\u20B9${ls.toFixed(2)}), a deeper head (\u20B9${head.toFixed(2)}), and a right shoulder (\u20B9${rs.toFixed(2)}) at a similar level. The neckline sits at \u20B9${neckline.toFixed(2)}, and a breakout above this level would confirm the pattern, targeting the head-to-neckline distance projected upward.`,
      hi: `\u092C\u0941\u0932\u093F\u0936 \u0909\u0932\u094D\u091F\u093E \u0939\u0947\u0921 \u090F\u0902\u0921 \u0936\u094B\u0932\u094D\u0921\u0930 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0924\u0940\u0928 \u0928\u093F\u091A\u0932\u0947 \u092C\u093F\u0902\u0926\u0941 \u2014 \u092C\u093E\u092F\u093E\u0901 \u0915\u0902\u0927\u093E (\u20B9${ls.toFixed(2)}), \u0938\u093F\u0930 (\u20B9${head.toFixed(2)}), \u0914\u0930 \u0926\u093E\u092F\u093E\u0901 \u0915\u0902\u0927\u093E (\u20B9${rs.toFixed(2)}) \u2014 \u0928\u0947\u0915\u0932\u093E\u0907\u0928 \u20B9${neckline.toFixed(2)} \u0938\u0947 \u090A\u092A\u0930 \u092C\u094D\u0930\u0947\u0915\u0906\u0909\u091F \u0915\u0940 \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0947\u0917\u093E\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 73.5,
    historicalOccurrences: 0,
    entry: `Above ${neckline.toFixed(2)}`,
    stopLoss: `${(rs * 0.97).toFixed(2)}`,
    target1: `${(neckline + (neckline - head) * 0.6).toFixed(2)}`,
    target2: `${(neckline + (neckline - head)).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = rs * 0.97;
      const target2Price = neckline + (neckline - head);
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectDescendingTriangle(candles, indicators) {
  if (candles.length < 35) return null;
  const slice = candles.slice(-35);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const minLow = Math.min(...lows);
  const touchesSupport = lows.filter((l) => l < minLow * 1.02).length;
  if (touchesSupport < 3) return null;
  const firstHalfHigh = Math.max(...highs.slice(0, 15));
  const lastHalfHigh = Math.max(...highs.slice(-15));
  if (lastHalfHigh >= firstHalfHigh * 0.97) return null;
  const ltp = candles[candles.length - 1].close;
  if (ltp > minLow * 1.03) return null;
  const { score, breakdown } = calculateArithmeticScore(68, candles, false, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.1;
  return {
    id: `dtri_${Date.now()}`,
    patternName: "Descending Triangle",
    type: "Bearish",
    patternCategory: "Breakout",
    timeframeClass: "Swing",
    explanation: {
      en: `A Descending Triangle is forming \u2014 a bearish continuation pattern. The resistance line has been falling from \u20B9${firstHalfHigh.toFixed(2)} to \u20B9${lastHalfHigh.toFixed(2)}, while the flat support at \u20B9${minLow.toFixed(2)} is being tested repeatedly (${touchesSupport} touches). Sellers are becoming more aggressive at progressively lower levels, increasing the probability of a downside breakdown below support.`,
      hi: `\u0905\u0935\u0930\u094B\u0939\u0940 \u0924\u094D\u0930\u093F\u092D\u0941\u091C \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928 \u0930\u0939\u093E \u0939\u0948 \u2014 \u090F\u0915 \u092E\u0902\u0926\u0940 \u0928\u093F\u0930\u0902\u0924\u0930\u0924\u093E \u092A\u0948\u091F\u0930\u094D\u0928\u0964 \u092A\u094D\u0930\u0924\u093F\u0930\u094B\u0927 \u20B9${firstHalfHigh.toFixed(2)} \u0938\u0947 \u0918\u091F\u0915\u0930 \u20B9${lastHalfHigh.toFixed(2)} \u0939\u094B \u0917\u092F\u093E \u0939\u0948, \u091C\u092C\u0915\u093F \u20B9${minLow.toFixed(2)} \u092A\u0930 \u0938\u092A\u094B\u0930\u094D\u091F \u092C\u093E\u0930-\u092C\u093E\u0930 \u091F\u0947\u0938\u094D\u091F \u0939\u094B \u0930\u0939\u093E \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 71.6,
    historicalOccurrences: 0,
    entry: `Below ${minLow.toFixed(2)}`,
    stopLoss: `${lastHalfHigh.toFixed(2)}`,
    target1: `${(minLow - (firstHalfHigh - minLow) * 0.5).toFixed(2)}`,
    target2: `${(minLow - (firstHalfHigh - minLow)).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = lastHalfHigh;
      const target2Price = minLow - (firstHalfHigh - minLow);
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectThreeWhiteSoldiers(candles, indicators) {
  if (candles.length < 25) return null;
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];
  if (c1.close <= c1.open || c2.close <= c2.open || c3.close <= c3.open) return null;
  if (c2.open < c1.open || c2.open > c1.close) return null;
  if (c3.open < c2.open || c3.open > c2.close) return null;
  if (c2.close <= c1.close || c3.close <= c2.close) return null;
  const body1 = (c1.close - c1.open) / (c1.high - c1.low || 1);
  const body2 = (c2.close - c2.open) / (c2.high - c2.low || 1);
  const body3 = (c3.close - c3.open) / (c3.high - c3.low || 1);
  if (body1 < 0.55 || body2 < 0.55 || body3 < 0.55) return null;
  const priorTrend = candles.slice(-12, -3);
  const trendDown = priorTrend[0].close >= priorTrend[priorTrend.length - 1].close;
  if (!trendDown) return null;
  const ltp = c3.close;
  const { score, breakdown } = calculateArithmeticScore(72, candles, true, indicators, 0);
  const volConfirmed = c3.volume > indicators.vol20Avg * 1.3;
  return {
    id: `tws_${Date.now()}`,
    patternName: "Three White Soldiers",
    type: "Bullish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `Three White Soldiers have formed \u2014 three consecutive large bullish candles (closes: \u20B9${c1.close.toFixed(2)} \u2192 \u20B9${c2.close.toFixed(2)} \u2192 \u20B9${c3.close.toFixed(2)}), each opening within the previous candle's body and closing at new highs. This pattern after a downtrend reflects a powerful and sustained shift of control from sellers to buyers, often signaling the start of a new uptrend.`,
      hi: `\u0924\u0940\u0928 \u0938\u092B\u0947\u0926 \u0938\u0948\u0928\u093F\u0915 \u2014 \u0924\u0940\u0928 \u0932\u0917\u093E\u0924\u093E\u0930 \u092C\u0921\u093C\u0947 \u0939\u0930\u0947 \u0915\u0948\u0902\u0921\u0932 (\u20B9${c1.close.toFixed(2)} \u2192 \u20B9${c2.close.toFixed(2)} \u2192 \u20B9${c3.close.toFixed(2)}) \u2014 \u0917\u093F\u0930\u093E\u0935\u091F \u0915\u0947 \u092C\u093E\u0926 \u0924\u0947\u091C\u0940 \u0915\u0940 \u0936\u0941\u0930\u0941\u0906\u0924 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0926\u0947\u0924\u0947 \u0939\u0948\u0902\u0964 \u0916\u0930\u0940\u0926\u093E\u0930\u094B\u0902 \u0928\u0947 \u0928\u093F\u092F\u0902\u0924\u094D\u0930\u0923 \u0905\u092A\u0928\u0947 \u0939\u093E\u0925 \u092E\u0947\u0902 \u0932\u0947 \u0932\u093F\u092F\u093E \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 78.4,
    historicalOccurrences: 0,
    entry: `${ltp.toFixed(2)} \u2013 ${(ltp * 1.005).toFixed(2)}`,
    stopLoss: `${(c1.open * 0.98).toFixed(2)}`,
    target1: `${(ltp * 1.06).toFixed(2)}`,
    target2: `${(ltp * 1.11).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = c1.open * 0.98;
      const target2Price = ltp * 1.11;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectThreeBlackCrows(candles, indicators) {
  if (candles.length < 25) return null;
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];
  if (c1.close >= c1.open || c2.close >= c2.open || c3.close >= c3.open) return null;
  if (c2.open > c1.open || c2.open < c1.close) return null;
  if (c3.open > c2.open || c3.open < c2.close) return null;
  if (c2.close >= c1.close || c3.close >= c2.close) return null;
  const body1 = (c1.open - c1.close) / (c1.high - c1.low || 1);
  const body2 = (c2.open - c2.close) / (c2.high - c2.low || 1);
  const body3 = (c3.open - c3.close) / (c3.high - c3.low || 1);
  if (body1 < 0.55 || body2 < 0.55 || body3 < 0.55) return null;
  const priorTrend = candles.slice(-12, -3);
  const trendUp = priorTrend[0].close <= priorTrend[priorTrend.length - 1].close;
  if (!trendUp) return null;
  const ltp = c3.close;
  const { score, breakdown } = calculateArithmeticScore(70, candles, false, indicators, 0);
  const volConfirmed = c3.volume > indicators.vol20Avg * 1.3;
  return {
    id: `tbc_${Date.now()}`,
    patternName: "Three Black Crows",
    type: "Bearish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `Three Black Crows have formed \u2014 three consecutive large bearish candles (closes: \u20B9${c1.close.toFixed(2)} \u2192 \u20B9${c2.close.toFixed(2)} \u2192 \u20B9${c3.close.toFixed(2)}), each opening within the previous candle's body and closing at new lows. This pattern after an uptrend signals a powerful and sustained shift from buying to selling pressure, often marking the start of a significant downtrend.`,
      hi: `\u0924\u0940\u0928 \u0915\u093E\u0932\u0947 \u0915\u094C\u090F \u2014 \u0924\u0940\u0928 \u0932\u0917\u093E\u0924\u093E\u0930 \u092C\u0921\u093C\u0947 \u0932\u093E\u0932 \u0915\u0948\u0902\u0921\u0932 (\u20B9${c1.close.toFixed(2)} \u2192 \u20B9${c2.close.toFixed(2)} \u2192 \u20B9${c3.close.toFixed(2)}) \u2014 \u0924\u0947\u091C\u0940 \u0915\u0947 \u092C\u093E\u0926 \u092E\u0902\u0926\u0940 \u0915\u0940 \u0936\u0941\u0930\u0941\u0906\u0924 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0926\u0947\u0924\u0947 \u0939\u0948\u0902\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 76.1,
    historicalOccurrences: 0,
    entry: `Below ${ltp.toFixed(2)}`,
    stopLoss: `${(c1.open * 1.02).toFixed(2)}`,
    target1: `${(ltp * 0.94).toFixed(2)}`,
    target2: `${(ltp * 0.89).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = c1.open * 1.02;
      const target2Price = ltp * 0.89;
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectMorningStar(candles, indicators) {
  if (candles.length < 20) return null;
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];
  const body1 = Math.abs(c1.close - c1.open);
  const body2 = Math.abs(c2.close - c2.open);
  const body3 = Math.abs(c3.close - c3.open);
  if (c1.close >= c1.open) return null;
  if (body1 < (c1.high - c1.low) * 0.4) return null;
  if (body2 > body1 * 0.35) return null;
  if (c2.high >= c1.close * 1.005) return null;
  if (c3.close <= c3.open) return null;
  if (body3 < body1 * 0.5) return null;
  if (c3.close < (c1.open + c1.close) / 2) return null;
  const ltp = c3.close;
  const { score, breakdown } = calculateArithmeticScore(73, candles, true, indicators, 0);
  const volConfirmed = c3.volume > indicators.vol20Avg * 1.3;
  return {
    id: `mstr_${Date.now()}`,
    patternName: "Morning Star",
    type: "Bullish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `A Morning Star pattern has emerged \u2014 a classic 3-candle bullish reversal. First, a large bearish candle (close: \u20B9${c1.close.toFixed(2)}) showed strong selling. Then a small indecision candle (close: \u20B9${c2.close.toFixed(2)}) gapped lower, signaling seller exhaustion. Finally, a strong bullish candle (close: \u20B9${c3.close.toFixed(2)}) confirmed buyers taking control. This sequence at potential support levels is a high-reliability reversal signal.`,
      hi: `\u092E\u0949\u0930\u094D\u0928\u093F\u0902\u0917 \u0938\u094D\u091F\u093E\u0930 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948 \u2014 \u0924\u0940\u0928 \u0915\u0948\u0902\u0921\u0932 \u0915\u093E \u092C\u0941\u0932\u093F\u0936 \u0909\u0932\u091F\u093E\u0935\u0964 \u092C\u093F\u0915\u0935\u093E\u0932\u0940 \u0915\u0940 \u0925\u0915\u093E\u0928 \u0915\u0947 \u092C\u093E\u0926 \u0916\u0930\u0940\u0926\u093E\u0930\u094B\u0902 \u0928\u0947 \u0928\u093F\u092F\u0902\u0924\u094D\u0930\u0923 \u0938\u0902\u092D\u093E\u0932 \u0932\u093F\u092F\u093E \u0939\u0948\u0964 \u0915\u094D\u0932\u094B\u091C: \u20B9${c3.close.toFixed(2)} \u090F\u0915 \u092E\u091C\u092C\u0942\u0924 \u0924\u0947\u091C\u0940 \u0915\u0940 \u0936\u0941\u0930\u0941\u0906\u0924 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 76.8,
    historicalOccurrences: 0,
    entry: `${ltp.toFixed(2)} \u2013 ${(ltp * 1.005).toFixed(2)}`,
    stopLoss: `${(c2.low * 0.99).toFixed(2)}`,
    target1: `${(ltp * 1.05).toFixed(2)}`,
    target2: `${(ltp * 1.09).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = c2.low * 0.99;
      const target2Price = ltp * 1.09;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectEveningStar(candles, indicators) {
  if (candles.length < 20) return null;
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];
  const body1 = Math.abs(c1.close - c1.open);
  const body2 = Math.abs(c2.close - c2.open);
  const body3 = Math.abs(c3.close - c3.open);
  if (c1.close <= c1.open) return null;
  if (body1 < (c1.high - c1.low) * 0.4) return null;
  if (body2 > body1 * 0.35) return null;
  if (c2.low <= c1.close * 0.995) return null;
  if (c3.close >= c3.open) return null;
  if (body3 < body1 * 0.5) return null;
  if (c3.close > (c1.open + c1.close) / 2) return null;
  const ltp = c3.close;
  const { score, breakdown } = calculateArithmeticScore(71, candles, false, indicators, 0);
  const volConfirmed = c3.volume > indicators.vol20Avg * 1.3;
  return {
    id: `estr_${Date.now()}`,
    patternName: "Evening Star",
    type: "Bearish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: {
      en: `An Evening Star pattern has formed \u2014 a 3-candle bearish reversal at potential resistance. A large bullish candle (close: \u20B9${c1.close.toFixed(2)}) showed strong buying, but a small indecision star (close: \u20B9${c2.close.toFixed(2)}) gapped higher and stalled. Finally, a large bearish candle (close: \u20B9${c3.close.toFixed(2)}) confirmed sellers have overwhelmed buyers. This is a high-reliability reversal signal after an uptrend.`,
      hi: `\u0907\u0935\u0928\u093F\u0902\u0917 \u0938\u094D\u091F\u093E\u0930 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948 \u2014 \u0924\u0940\u0928 \u0915\u0948\u0902\u0921\u0932 \u0915\u093E \u092E\u0902\u0926\u0940 \u0909\u0932\u091F\u093E\u0935\u0964 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0915\u0940 \u0925\u0915\u093E\u0928 \u0915\u0947 \u092C\u093E\u0926 \u092C\u093F\u0915\u0935\u093E\u0932\u094B\u0902 \u0928\u0947 \u0928\u093F\u092F\u0902\u0924\u094D\u0930\u0923 \u0932\u0947 \u0932\u093F\u092F\u093E \u0939\u0948\u0964 \u0915\u094D\u0932\u094B\u091C: \u20B9${c3.close.toFixed(2)} \u092E\u0902\u0926\u0940 \u0915\u0940 \u0936\u0941\u0930\u0941\u0906\u0924 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 74.3,
    historicalOccurrences: 0,
    entry: `Below ${ltp.toFixed(2)}`,
    stopLoss: `${(c2.high * 1.01).toFixed(2)}`,
    target1: `${(ltp * 0.95).toFixed(2)}`,
    target2: `${(ltp * 0.91).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = c2.high * 1.01;
      const target2Price = ltp * 0.91;
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectMACDCrossover(candles, indicators) {
  if (candles.length < 40) return null;
  const closes = candles.map((c) => c.close);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);
  const n = candles.length - 1;
  if (n < 1) return null;
  const prevHist = macdLine[n - 1] - signalLine[n - 1];
  const currHist = macdLine[n] - signalLine[n];
  const bullCross = prevHist < 0 && currHist > 0;
  const bearCross = prevHist > 0 && currHist < 0;
  if (!bullCross && !bearCross) return null;
  const ltp = candles[n].close;
  const isBullish = bullCross;
  const { score, breakdown } = calculateArithmeticScore(70, candles, isBullish, indicators, 0);
  const volConfirmed = candles[n].volume > indicators.vol20Avg * 1.1;
  return {
    id: `macdx_${Date.now()}`,
    patternName: isBullish ? "MACD Bullish Crossover" : "MACD Bearish Crossover",
    type: isBullish ? "Bullish" : "Bearish",
    patternCategory: "Momentum",
    timeframeClass: "Swing",
    explanation: {
      en: isBullish ? `The MACD line has crossed above its signal line, generating a bullish momentum crossover. The MACD histogram turned positive (${currHist.toFixed(3)}) after being negative, indicating a shift in momentum from bearish to bullish. This is one of the most widely watched momentum indicators, particularly reliable when the crossover occurs below the zero line.` : `The MACD line has crossed below its signal line, generating a bearish momentum crossover. The MACD histogram turned negative (${currHist.toFixed(3)}) after being positive, indicating a shift in momentum from bullish to bearish. This is particularly significant when the crossover occurs above the zero line.`,
      hi: isBullish ? `MACD \u0932\u093E\u0907\u0928 \u0938\u093F\u0917\u094D\u0928\u0932 \u0932\u093E\u0907\u0928 \u0938\u0947 \u090A\u092A\u0930 \u0915\u094D\u0930\u0949\u0938 \u0939\u0941\u0908 \u0939\u0948\u0964 \u0939\u093F\u0938\u094D\u091F\u094B\u0917\u094D\u0930\u093E\u092E (${currHist.toFixed(3)}) \u0938\u0915\u093E\u0930\u093E\u0924\u094D\u092E\u0915 \u0939\u094B \u0917\u092F\u093E \u0939\u0948, \u091C\u094B \u0917\u0924\u093F \u092E\u0947\u0902 \u092C\u0926\u0932\u093E\u0935 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964` : `MACD \u0932\u093E\u0907\u0928 \u0938\u093F\u0917\u094D\u0928\u0932 \u0932\u093E\u0907\u0928 \u0938\u0947 \u0928\u0940\u091A\u0947 \u0915\u094D\u0930\u0949\u0938 \u0939\u0941\u0908 \u0939\u0948\u0964 \u0939\u093F\u0938\u094D\u091F\u094B\u0917\u094D\u0930\u093E\u092E (${currHist.toFixed(3)}) \u0928\u0915\u093E\u0930\u093E\u0924\u094D\u092E\u0915 \u0939\u094B \u0917\u092F\u093E \u0939\u0948, \u091C\u094B \u092E\u0902\u0926\u0940 \u0915\u0940 \u0917\u0924\u093F \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: isBullish ? 61.4 : 59.9,
    historicalOccurrences: 0,
    entry: isBullish ? `${ltp.toFixed(2)} \u2013 ${(ltp * 1.005).toFixed(2)}` : `Below ${ltp.toFixed(2)}`,
    stopLoss: isBullish ? `${(ltp * 0.96).toFixed(2)}` : `${(ltp * 1.04).toFixed(2)}`,
    target1: isBullish ? `${(ltp * 1.06).toFixed(2)}` : `${(ltp * 0.94).toFixed(2)}`,
    target2: isBullish ? `${(ltp * 1.1).toFixed(2)}` : `${(ltp * 0.9).toFixed(2)}`,
    riskReward: isBullish ? `1:${(ltp * 0.1 / (ltp * 0.04)).toFixed(1)}` : `1:${(ltp * 0.1 / (ltp * 0.04)).toFixed(1)}`,
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectBollingerSqueeze(candles, indicators) {
  if (candles.length < 30) return null;
  const bb = indicators.bollinger;
  const ltp = candles[candles.length - 1].close;
  const bandWidth = (bb.upper - bb.lower) / bb.middle;
  if (bandWidth > 0.06) return null;
  const pastCandles = candles.slice(-25, -5);
  const pastIndicators = calculateIndicators(pastCandles);
  const pastBB = pastIndicators.bollinger;
  const pastBandWidth = (pastBB.upper - pastBB.lower) / (pastBB.middle || 1);
  if (pastBandWidth <= bandWidth * 1.3) return null;
  const recentClose = candles.slice(-5).map((c) => c.close);
  const isBullish = recentClose[recentClose.length - 1] > recentClose[0];
  const { score, breakdown } = calculateArithmeticScore(65, candles, isBullish, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.2;
  return {
    id: `bbs_${Date.now()}`,
    patternName: "Bollinger Band Squeeze",
    type: isBullish ? "Bullish" : "Bearish",
    patternCategory: "Breakout",
    timeframeClass: "Swing",
    explanation: {
      en: `A Bollinger Band Squeeze is in progress \u2014 the bands have contracted to just ${(bandWidth * 100).toFixed(1)}% of price (upper: \u20B9${bb.upper.toFixed(2)}, lower: \u20B9${bb.lower.toFixed(2)}), compared to ${(pastBandWidth * 100).toFixed(1)}% width 20 days ago. This low-volatility compression period typically precedes a sharp directional move. Recent momentum suggests the breakout could be ${isBullish ? "upward" : "downward"}, but the actual direction should be confirmed by a candle closing decisively outside the bands.`,
      hi: `\u092C\u094B\u0932\u093F\u0902\u0917\u0930 \u092C\u0948\u0902\u0921 \u0938\u094D\u0915\u094D\u0935\u0940\u091C \u0939\u094B \u0930\u0939\u093E \u0939\u0948 \u2014 \u092C\u0948\u0902\u0921 \u0915\u0940 \u091A\u094C\u0921\u093C\u093E\u0908 \u0918\u091F\u0915\u0930 ${(bandWidth * 100).toFixed(1)}% \u0939\u094B \u0917\u0908 \u0939\u0948\u0964 \u0915\u092E \u0905\u0938\u094D\u0925\u093F\u0930\u0924\u093E \u0915\u0940 \u092F\u0939 \u0905\u0935\u0927\u093F \u0906\u092E\u0924\u094C\u0930 \u092A\u0930 \u090F\u0915 \u0924\u0947\u091C \u0926\u093F\u0936\u093E\u0924\u094D\u092E\u0915 \u091A\u093E\u0932 \u0938\u0947 \u092A\u0939\u0932\u0947 \u0906\u0924\u0940 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: isBullish ? 62 : 60.5,
    historicalOccurrences: 0,
    entry: isBullish ? `Above ${bb.upper.toFixed(2)}` : `Below ${bb.lower.toFixed(2)}`,
    stopLoss: isBullish ? `${bb.middle.toFixed(2)}` : `${bb.middle.toFixed(2)}`,
    target1: isBullish ? `${(ltp * 1.05).toFixed(2)}` : `${(ltp * 0.95).toFixed(2)}`,
    target2: isBullish ? `${(ltp * 1.09).toFixed(2)}` : `${(ltp * 0.91).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = bb.middle;
      const target2Price = isBullish ? ltp * 1.09 : ltp * 0.91;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectSupportBounce(candles, indicators) {
  if (candles.length < 40) return null;
  const slice = candles.slice(-60);
  const pivotLows = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i].low < slice[i - 1].low && slice[i].low < slice[i + 1].low && slice[i].low < slice[i - 2].low && slice[i].low < slice[i + 2].low) {
      pivotLows.push(slice[i].low);
    }
  }
  if (pivotLows.length < 2) return null;
  let supportLevel = 0;
  let maxCluster = 0;
  for (const pivot of pivotLows) {
    const cluster = pivotLows.filter((p) => Math.abs(p - pivot) / pivot < 0.015).length;
    if (cluster > maxCluster) {
      maxCluster = cluster;
      supportLevel = pivot;
    }
  }
  if (maxCluster < 2) return null;
  const ltp = candles[candles.length - 1].close;
  const distFromSupport = (ltp - supportLevel) / supportLevel;
  if (distFromSupport < 0 || distFromSupport > 0.04) return null;
  const lastCandle = candles[candles.length - 1];
  if (lastCandle.close <= lastCandle.open) return null;
  const { score, breakdown } = calculateArithmeticScore(70, candles, true, indicators, maxCluster * 8);
  const volConfirmed = lastCandle.volume > indicators.vol20Avg * 1.2;
  return {
    id: `sb_${Date.now()}`,
    patternName: "Support Bounce",
    type: "Bullish",
    patternCategory: "Support/Resistance",
    timeframeClass: "Swing",
    explanation: {
      en: `The stock is bouncing off a well-tested support zone at \u20B9${supportLevel.toFixed(2)}, which has been respected ${maxCluster} times over the past 60 sessions. The current price (\u20B9${ltp.toFixed(2)}) is ${(distFromSupport * 100).toFixed(1)}% above this support, with a bullish candle confirming the bounce. The more times a support level is tested and holds, the stronger the eventual bounce tends to be.`,
      hi: `\u0938\u094D\u091F\u0949\u0915 \u20B9${supportLevel.toFixed(2)} \u0915\u0947 \u092E\u091C\u092C\u0942\u0924 \u0938\u092A\u094B\u0930\u094D\u091F \u091C\u093C\u094B\u0928 \u0938\u0947 \u0909\u091B\u093E\u0932 \u0930\u0939\u093E \u0939\u0948, \u091C\u094B \u092A\u093F\u091B\u0932\u0947 60 \u0938\u0924\u094D\u0930\u094B\u0902 \u092E\u0947\u0902 ${maxCluster} \u092C\u093E\u0930 \u091F\u0947\u0938\u094D\u091F \u0939\u094B \u091A\u0941\u0915\u093E \u0939\u0948\u0964 \u0939\u0930\u093E \u0915\u0948\u0902\u0921\u0932 \u092C\u093E\u0909\u0902\u0938 \u0915\u0940 \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0924\u093E \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 64.9,
    historicalOccurrences: maxCluster * 8,
    entry: `${ltp.toFixed(2)} \u2013 ${(supportLevel * 1.02).toFixed(2)}`,
    stopLoss: `${(supportLevel * 0.975).toFixed(2)}`,
    target1: `${(ltp * 1.05).toFixed(2)}`,
    target2: `${(ltp * 1.1).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = supportLevel * 0.975;
      const target2Price = ltp * 1.1;
      const riskAmt = Math.abs(ltp - stopLossPrice);
      const rewardAmt = Math.abs(target2Price - ltp);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectResistanceRejection(candles, indicators) {
  if (candles.length < 40) return null;
  const slice = candles.slice(-60);
  const pivotHighs = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i].high > slice[i - 1].high && slice[i].high > slice[i + 1].high && slice[i].high > slice[i - 2].high && slice[i].high > slice[i + 2].high) {
      pivotHighs.push(slice[i].high);
    }
  }
  if (pivotHighs.length < 2) return null;
  let resistanceLevel = 0;
  let maxCluster = 0;
  for (const pivot of pivotHighs) {
    const cluster = pivotHighs.filter((p) => Math.abs(p - pivot) / pivot < 0.015).length;
    if (cluster > maxCluster) {
      maxCluster = cluster;
      resistanceLevel = pivot;
    }
  }
  if (maxCluster < 2) return null;
  const ltp = candles[candles.length - 1].close;
  const distFromResistance = (resistanceLevel - ltp) / resistanceLevel;
  if (distFromResistance < 0 || distFromResistance > 0.04) return null;
  const lastCandle = candles[candles.length - 1];
  const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
  const body = Math.abs(lastCandle.close - lastCandle.open);
  const rejectionCandle = lastCandle.close < lastCandle.open || upperWick > body * 0.5;
  if (!rejectionCandle) return null;
  const { score, breakdown } = calculateArithmeticScore(67, candles, false, indicators, maxCluster * 7);
  const volConfirmed = lastCandle.volume > indicators.vol20Avg * 1.1;
  return {
    id: `rr_${Date.now()}`,
    patternName: "Resistance Rejection",
    type: "Bearish",
    patternCategory: "Support/Resistance",
    timeframeClass: "Swing",
    explanation: {
      en: `The stock has been rejected at a major resistance zone of \u20B9${resistanceLevel.toFixed(2)}, which has acted as a ceiling ${maxCluster} times in the past 60 sessions. The current price (\u20B9${ltp.toFixed(2)}) is showing a reversal candle near this level \u2014 sellers have repeatedly stepped in at this price zone, creating a strong overhead supply. A decisive close above \u20B9${(resistanceLevel * 1.015).toFixed(2)} would invalidate this bearish signal.`,
      hi: `\u0938\u094D\u091F\u0949\u0915 \u20B9${resistanceLevel.toFixed(2)} \u0915\u0947 \u092E\u091C\u092C\u0942\u0924 \u092A\u094D\u0930\u0924\u093F\u0930\u094B\u0927 \u091C\u093C\u094B\u0928 \u0938\u0947 \u0905\u0938\u094D\u0935\u0940\u0915\u0943\u0924 \u0939\u094B \u0930\u0939\u093E \u0939\u0948, \u091C\u094B \u092A\u093F\u091B\u0932\u0947 60 \u0938\u0924\u094D\u0930\u094B\u0902 \u092E\u0947\u0902 ${maxCluster} \u092C\u093E\u0930 \u091B\u0924 \u0915\u093E \u0915\u093E\u092E \u0915\u0930 \u091A\u0941\u0915\u093E \u0939\u0948\u0964 \u092C\u093F\u0915\u0935\u093E\u0932\u0940 \u0915\u093E \u0926\u092C\u093E\u0935 \u0939\u093E\u0935\u0940 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 63.4,
    historicalOccurrences: maxCluster * 7,
    entry: `Below ${ltp.toFixed(2)}`,
    stopLoss: `${(resistanceLevel * 1.02).toFixed(2)}`,
    target1: `${(ltp * 0.95).toFixed(2)}`,
    target2: `${(ltp * 0.91).toFixed(2)}`,
    riskReward: (() => {
      const stopLossPrice = resistanceLevel * 1.02;
      const target2Price = ltp * 0.91;
      const riskAmt = Math.abs(stopLossPrice - ltp);
      const rewardAmt = Math.abs(ltp - target2Price);
      const rr = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
      return `1:${rr}`;
    })(),
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectBullFlag(candles, indicators) {
  if (candles.length < 30) return null;
  const poleSlice = candles.slice(-25, -8);
  const poleStart = poleSlice[0].close;
  const poleEnd = Math.max(...poleSlice.map((c) => c.high));
  const poleGain = (poleEnd - poleStart) / poleStart;
  if (poleGain < 0.06) return null;
  const flagSlice = candles.slice(-8);
  const flagHigh = Math.max(...flagSlice.map((c) => c.high));
  const flagLow = Math.min(...flagSlice.map((c) => c.low));
  const flagRetracement = (flagHigh - flagSlice[flagSlice.length - 1].close) / flagHigh;
  const poleRetrace = (poleEnd - flagSlice[flagSlice.length - 1].close) / (poleEnd - poleStart);
  if (poleRetrace > 0.5) return null;
  if (flagRetracement < 5e-3) return null;
  const flagFirstHigh = Math.max(...flagSlice.slice(0, 4).map((c) => c.high));
  const flagLastHigh = Math.max(...flagSlice.slice(4).map((c) => c.high));
  if (flagLastHigh >= flagFirstHigh * 1.01) return null;
  const ltp = candles[candles.length - 1].close;
  const stopLossPrice = flagLow * 0.99;
  const target1Price = ltp + (poleEnd - poleStart) * 0.5;
  const target2Price = ltp + (poleEnd - poleStart);
  const riskAmt = ltp - stopLossPrice;
  const rewardAmt = target2Price - ltp;
  const rrRatio = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
  const { score, breakdown } = calculateArithmeticScore(72, candles, true, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.1;
  return {
    id: `bf_${Date.now()}`,
    patternName: "Bull Flag",
    type: "Bullish",
    patternCategory: "Breakout",
    timeframeClass: "Swing",
    explanation: {
      en: `A Bull Flag pattern has formed. The stock surged ${(poleGain * 100).toFixed(1)}% (pole: \u20B9${poleStart.toFixed(2)} \u2192 \u20B9${poleEnd.toFixed(2)}) and is now consolidating in a tight declining channel (flag: \u20B9${flagLow.toFixed(2)}\u2013\u20B9${flagHigh.toFixed(2)}). This pullback represents healthy profit-taking before the next leg up. A breakout above \u20B9${flagHigh.toFixed(2)} would signal continuation of the original trend, with a measured target of \u20B9${target2Price.toFixed(2)} (equal to the pole length projected from the breakout point).`,
      hi: `\u092C\u0941\u0932 \u092B\u094D\u0932\u0948\u0917 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0938\u094D\u091F\u0949\u0915 ${(poleGain * 100).toFixed(1)}% \u090A\u092A\u0930 \u0917\u092F\u093E \u0914\u0930 \u0905\u092C \u20B9${flagLow.toFixed(2)}\u2013\u20B9${flagHigh.toFixed(2)} \u092E\u0947\u0902 \u0938\u092E\u0947\u0915\u093F\u0924 \u0939\u094B \u0930\u0939\u093E \u0939\u0948\u0964 \u20B9${flagHigh.toFixed(2)} \u0938\u0947 \u090A\u092A\u0930 \u092C\u094D\u0930\u0947\u0915\u0906\u0909\u091F \u0924\u0947\u091C\u0940 \u091C\u093E\u0930\u0940 \u0930\u0939\u0928\u0947 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u094B\u0917\u093E\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 67.8,
    historicalOccurrences: 0,
    entry: `Above ${flagHigh.toFixed(2)}`,
    stopLoss: stopLossPrice.toFixed(2),
    target1: target1Price.toFixed(2),
    target2: target2Price.toFixed(2),
    riskReward: `1:${rrRatio}`,
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectBearFlag(candles, indicators) {
  if (candles.length < 30) return null;
  const poleSlice = candles.slice(-25, -8);
  const poleStart = poleSlice[0].close;
  const poleEnd = Math.min(...poleSlice.map((c) => c.low));
  const poleDrop = (poleStart - poleEnd) / poleStart;
  if (poleDrop < 0.06) return null;
  const flagSlice = candles.slice(-8);
  const flagHigh = Math.max(...flagSlice.map((c) => c.high));
  const flagLow = Math.min(...flagSlice.map((c) => c.low));
  const poleRetrace = (flagSlice[flagSlice.length - 1].close - poleEnd) / (poleStart - poleEnd);
  if (poleRetrace > 0.5) return null;
  const flagFirstLow = Math.min(...flagSlice.slice(0, 4).map((c) => c.low));
  const flagLastLow = Math.min(...flagSlice.slice(4).map((c) => c.low));
  if (flagLastLow <= flagFirstLow * 0.99) return null;
  const ltp = candles[candles.length - 1].close;
  const stopLossPrice = flagHigh * 1.01;
  const target1Price = ltp - (poleStart - poleEnd) * 0.5;
  const target2Price = ltp - (poleStart - poleEnd);
  const riskAmt = stopLossPrice - ltp;
  const rewardAmt = ltp - target2Price;
  const rrRatio = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
  const { score, breakdown } = calculateArithmeticScore(70, candles, false, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.1;
  return {
    id: `bearf_${Date.now()}`,
    patternName: "Bear Flag",
    type: "Bearish",
    patternCategory: "Breakout",
    timeframeClass: "Swing",
    explanation: {
      en: `A Bear Flag pattern has formed. The stock dropped ${(poleDrop * 100).toFixed(1)}% (pole: \u20B9${poleStart.toFixed(2)} \u2192 \u20B9${poleEnd.toFixed(2)}) and is now consolidating in a slight upward channel (flag: \u20B9${flagLow.toFixed(2)}\u2013\u20B9${flagHigh.toFixed(2)}). This counter-trend bounce represents short-covering and weak buying before the next leg down. A breakdown below \u20B9${flagLow.toFixed(2)} would confirm continuation of the downtrend, with a measured target of \u20B9${target2Price.toFixed(2)}.`,
      hi: `\u092C\u0947\u092F\u0930 \u092B\u094D\u0932\u0948\u0917 \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928\u093E \u0939\u0948\u0964 \u0938\u094D\u091F\u0949\u0915 ${(poleDrop * 100).toFixed(1)}% \u0917\u093F\u0930\u093E \u0914\u0930 \u0905\u092C \u20B9${flagLow.toFixed(2)}\u2013\u20B9${flagHigh.toFixed(2)} \u092E\u0947\u0902 \u0938\u092E\u0947\u0915\u093F\u0924 \u0939\u094B \u0930\u0939\u093E \u0939\u0948\u0964 \u20B9${flagLow.toFixed(2)} \u0938\u0947 \u0928\u0940\u091A\u0947 \u092C\u094D\u0930\u0947\u0915\u0921\u093E\u0909\u0928 \u0917\u093F\u0930\u093E\u0935\u091F \u091C\u093E\u0930\u0940 \u0930\u0939\u0928\u0947 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u094B\u0917\u093E\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 65.2,
    historicalOccurrences: 0,
    entry: `Below ${flagLow.toFixed(2)}`,
    stopLoss: stopLossPrice.toFixed(2),
    target1: target1Price.toFixed(2),
    target2: target2Price.toFixed(2),
    riskReward: `1:${rrRatio}`,
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectRisingWedge(candles, indicators) {
  if (candles.length < 30) return null;
  const slice = candles.slice(-30);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const highsSlope = (Math.max(...highs.slice(-8)) - Math.max(...highs.slice(0, 8))) / Math.max(...highs.slice(0, 8));
  const lowsSlope = (Math.min(...lows.slice(-8)) - Math.min(...lows.slice(0, 8))) / Math.min(...lows.slice(0, 8));
  if (highsSlope <= 0 || lowsSlope <= 0) return null;
  if (lowsSlope <= highsSlope * 1.2) return null;
  const patternRange = Math.max(...highs) - Math.min(...lows);
  const currentRange = Math.max(...highs.slice(-8)) - Math.min(...lows.slice(-8));
  if (currentRange >= patternRange * 0.7) return null;
  const ltp = candles[candles.length - 1].close;
  const wedgeLow = Math.min(...lows.slice(-5));
  const wedgeHigh = Math.max(...highs);
  const stopLossPrice = Math.max(...highs.slice(-5)) * 1.015;
  const target1Price = ltp * 0.95;
  const target2Price = ltp - (wedgeHigh - Math.min(...lows));
  const riskAmt = stopLossPrice - ltp;
  const rewardAmt = ltp - target2Price;
  const rrRatio = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
  const { score, breakdown } = calculateArithmeticScore(66, candles, false, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume < indicators.vol20Avg * 0.9;
  return {
    id: `rw_${Date.now()}`,
    patternName: "Rising Wedge",
    type: "Bearish",
    patternCategory: "Reversal",
    timeframeClass: "Swing",
    explanation: {
      en: `A Rising Wedge pattern is forming \u2014 a bearish reversal signal. Both the highs (rising ${(highsSlope * 100).toFixed(1)}%) and lows (rising ${(lowsSlope * 100).toFixed(1)}%) are trending upward, but the lows are rising faster, causing the trading range to compress into a wedge shape (current range: \u20B9${currentRange.toFixed(2)} vs earlier: \u20B9${patternRange.toFixed(2)}). This compression on declining volume indicates weakening buying pressure despite higher prices. Rising wedges typically resolve to the downside.`,
      hi: `\u0930\u093E\u0907\u091C\u093F\u0902\u0917 \u0935\u0947\u091C \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928 \u0930\u0939\u093E \u0939\u0948 \u2014 \u090F\u0915 \u092E\u0902\u0926\u0940 \u0909\u0932\u091F\u093E\u0935 \u0938\u0902\u0915\u0947\u0924\u0964 \u090A\u0901\u091A\u0947 \u0914\u0930 \u0928\u093F\u091A\u0932\u0947 \u0938\u094D\u0924\u0930 \u0926\u094B\u0928\u094B\u0902 \u092C\u0922\u093C \u0930\u0939\u0947 \u0939\u0948\u0902, \u0932\u0947\u0915\u093F\u0928 \u0930\u0947\u0902\u091C \u0938\u093F\u0915\u0941\u0921\u093C \u0930\u0939\u0940 \u0939\u0948\u0964 \u092F\u0939 \u0915\u092E\u091C\u094B\u0930 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948 \u0914\u0930 \u0906\u092E\u0924\u094C\u0930 \u092A\u0930 \u0928\u0940\u091A\u0947 \u0915\u0940 \u0913\u0930 \u092C\u094D\u0930\u0947\u0915\u0921\u093E\u0909\u0928 \u0939\u094B\u0924\u093E \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 69.3,
    historicalOccurrences: 0,
    entry: `Below ${wedgeLow.toFixed(2)}`,
    stopLoss: stopLossPrice.toFixed(2),
    target1: target1Price.toFixed(2),
    target2: target2Price.toFixed(2),
    riskReward: `1:${rrRatio}`,
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectFallingWedge(candles, indicators) {
  if (candles.length < 30) return null;
  const slice = candles.slice(-30);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const highsSlope = (Math.max(...highs.slice(-8)) - Math.max(...highs.slice(0, 8))) / Math.max(...highs.slice(0, 8));
  const lowsSlope = (Math.min(...lows.slice(-8)) - Math.min(...lows.slice(0, 8))) / Math.min(...lows.slice(0, 8));
  if (highsSlope >= 0 || lowsSlope >= 0) return null;
  if (Math.abs(highsSlope) <= Math.abs(lowsSlope) * 1.2) return null;
  const patternRange = Math.max(...highs) - Math.min(...lows);
  const currentRange = Math.max(...highs.slice(-8)) - Math.min(...lows.slice(-8));
  if (currentRange >= patternRange * 0.7) return null;
  const ltp = candles[candles.length - 1].close;
  const wedgeHigh = Math.max(...highs.slice(-5));
  const startHigh = Math.max(...highs.slice(0, 8));
  const stopLossPrice = Math.min(...lows.slice(-5)) * 0.985;
  const target1Price = ltp * 1.05;
  const target2Price = ltp + (startHigh - Math.min(...lows));
  const riskAmt = ltp - stopLossPrice;
  const rewardAmt = target2Price - ltp;
  const rrRatio = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
  const { score, breakdown } = calculateArithmeticScore(67, candles, true, indicators, 0);
  const volConfirmed = candles[candles.length - 1].volume > indicators.vol20Avg * 1.1;
  return {
    id: `fw_${Date.now()}`,
    patternName: "Falling Wedge",
    type: "Bullish",
    patternCategory: "Reversal",
    timeframeClass: "Swing",
    explanation: {
      en: `A Falling Wedge pattern is forming \u2014 a bullish reversal signal. Both highs (falling ${(Math.abs(highsSlope) * 100).toFixed(1)}%) and lows are declining, but the highs are falling faster, compressing the range from \u20B9${patternRange.toFixed(2)} to \u20B9${currentRange.toFixed(2)}. This tightening despite the downtrend indicates sellers are losing momentum. Falling wedges typically break upward when the upper resistance line is breached. Look for a close above \u20B9${wedgeHigh.toFixed(2)} with expanding volume.`,
      hi: `\u092B\u0949\u0932\u093F\u0902\u0917 \u0935\u0947\u091C \u092A\u0948\u091F\u0930\u094D\u0928 \u092C\u0928 \u0930\u0939\u093E \u0939\u0948 \u2014 \u090F\u0915 \u0924\u0947\u091C\u0940 \u0909\u0932\u091F\u093E\u0935 \u0938\u0902\u0915\u0947\u0924\u0964 \u090A\u0901\u091A\u093E\u0908 \u0924\u0947\u091C\u0940 \u0938\u0947 \u0918\u091F \u0930\u0939\u0940 \u0939\u0948 \u091C\u092C\u0915\u093F \u0928\u093F\u091A\u0932\u0947 \u0938\u094D\u0924\u0930 \u0927\u0940\u0930\u0947 \u0918\u091F \u0930\u0939\u0947 \u0939\u0948\u0902, \u091C\u093F\u0938\u0938\u0947 \u0930\u0947\u0902\u091C \u0938\u093F\u0915\u0941\u0921\u093C \u0930\u0939\u0940 \u0939\u0948\u0964 \u092F\u0939 \u092C\u093F\u0915\u0935\u093E\u0932\u0940 \u0915\u0940 \u0915\u092E\u091C\u094B\u0930\u0940 \u0914\u0930 \u0938\u0902\u092D\u093E\u0935\u093F\u0924 \u090A\u092A\u0930\u0940 \u092C\u094D\u0930\u0947\u0915\u0906\u0909\u091F \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
    },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: 72.1,
    historicalOccurrences: 0,
    entry: `Above ${wedgeHigh.toFixed(2)}`,
    stopLoss: stopLossPrice.toFixed(2),
    target1: target1Price.toFixed(2),
    target2: target2Price.toFixed(2),
    riskReward: `1:${rrRatio}`,
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectDoji(candles, indicators) {
  if (candles.length < 20) return null;
  const c = candles[candles.length - 1];
  const body = Math.abs(c.close - c.open);
  const totalRange = c.high - c.low;
  if (totalRange === 0) return null;
  const bodyRatio = body / totalRange;
  if (bodyRatio > 0.1) return null;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const isDragonfly = upperWick < totalRange * 0.1 && lowerWick > totalRange * 0.6;
  const isGravestone = lowerWick < totalRange * 0.1 && upperWick > totalRange * 0.6;
  const priorCandles = candles.slice(-11, -1);
  const priorChange = priorCandles[priorCandles.length - 1].close - priorCandles[0].close;
  const trendWasUp = priorChange > 0;
  const trendWasDown = priorChange < 0;
  const isBullish = isDragonfly || !isGravestone && trendWasDown;
  const patternName = isDragonfly ? "Dragonfly Doji" : isGravestone ? "Gravestone Doji" : "Doji";
  if (patternName === "Doji" && Math.abs(priorChange) / priorCandles[0].close < 0.02) return null;
  const ltp = c.close;
  const atrVal = indicators.atr;
  const stopLossPrice = isBullish ? c.low * 0.99 : c.high * 1.01;
  const target1Price = isBullish ? ltp + atrVal * 1.5 : ltp - atrVal * 1.5;
  const target2Price = isBullish ? ltp + atrVal * 2.5 : ltp - atrVal * 2.5;
  const riskAmt = Math.abs(ltp - stopLossPrice);
  const rewardAmt = Math.abs(target2Price - ltp);
  const rrRatio = riskAmt > 0 ? (rewardAmt / riskAmt).toFixed(1) : "\u2014";
  const { score, breakdown } = calculateArithmeticScore(62, candles, isBullish, indicators, 0);
  const volConfirmed = c.volume > indicators.vol20Avg * 1;
  const enExpl = isDragonfly ? `A Dragonfly Doji has formed after a ${trendWasDown ? "downtrend" : "sideways phase"}. The candle opened and closed near \u20B9${ltp.toFixed(2)} but dipped to \u20B9${c.low.toFixed(2)} intraday \u2014 sellers pushed prices lower but buyers absorbed every unit, closing at the open. This is a powerful single-candle reversal signal at potential support, especially after a sustained decline.` : isGravestone ? `A Gravestone Doji has formed after an ${trendWasUp ? "uptrend" : "sideways phase"}. The candle opened and closed near \u20B9${ltp.toFixed(2)} but reached \u20B9${c.high.toFixed(2)} intraday \u2014 buyers initially pushed prices higher but sellers overwhelmed them, closing at the open. This is a single-candle bearish reversal signal at potential resistance.` : `A Doji has formed (open \u2248 close at \u20B9${ltp.toFixed(2)}, range: \u20B9${c.low.toFixed(2)}\u2013\u20B9${c.high.toFixed(2)}). This indecision candle after a ${trendWasUp ? "rally" : "decline"} signals that the market has reached a balance point \u2014 the prior trend may be exhausting. Confirmation from the next session's direction is critical.`;
  const hiExpl = isDragonfly ? `\u0921\u094D\u0930\u0948\u0917\u0928\u092B\u094D\u0932\u093E\u0908 \u0921\u094B\u091C\u0940 \u092C\u0928\u093E \u0939\u0948\u0964 \u0932\u0902\u092C\u0940 \u0928\u093F\u091A\u0932\u0940 \u091B\u093E\u092F\u093E (\u20B9${c.low.toFixed(2)}) \u0914\u0930 \u0913\u092A\u0928-\u0915\u094D\u0932\u094B\u091C \u092C\u0930\u093E\u092C\u0930 (\u20B9${ltp.toFixed(2)}) \u2014 \u092C\u093F\u0915\u0935\u093E\u0932\u094B\u0902 \u0928\u0947 \u0915\u0940\u092E\u0924 \u0928\u0940\u091A\u0947 \u0927\u0915\u0947\u0932\u0940 \u0932\u0947\u0915\u093F\u0928 \u0916\u0930\u0940\u0926\u093E\u0930\u094B\u0902 \u0928\u0947 \u0935\u093E\u092A\u0938 \u0932\u093E \u0926\u0940\u0964 \u0924\u0947\u091C\u0940 \u0915\u0947 \u0909\u0932\u091F\u093E\u0935 \u0915\u093E \u092E\u091C\u092C\u0942\u0924 \u0938\u0902\u0915\u0947\u0924\u0964` : isGravestone ? `\u0917\u094D\u0930\u0947\u0935\u0938\u094D\u091F\u094B\u0928 \u0921\u094B\u091C\u0940 \u092C\u0928\u093E \u0939\u0948\u0964 \u0932\u0902\u092C\u0940 \u090A\u092A\u0930\u0940 \u091B\u093E\u092F\u093E (\u20B9${c.high.toFixed(2)}) \u0914\u0930 \u0913\u092A\u0928-\u0915\u094D\u0932\u094B\u091C \u092C\u0930\u093E\u092C\u0930 (\u20B9${ltp.toFixed(2)}) \u2014 \u0916\u0930\u0940\u0926\u093E\u0930 \u0915\u092E\u091C\u094B\u0930 \u092A\u0921\u093C \u0917\u090F\u0964 \u092E\u0902\u0926\u0940 \u0915\u0947 \u0909\u0932\u091F\u093E\u0935 \u0915\u093E \u0938\u0902\u0915\u0947\u0924\u0964` : `\u0921\u094B\u091C\u0940 \u092C\u0928\u093E \u0939\u0948 \u2014 \u092C\u093E\u091C\u093E\u0930 \u092E\u0947\u0902 \u0905\u0928\u093F\u0936\u094D\u091A\u093F\u0924\u0924\u093E\u0964 \u0913\u092A\u0928 \u2248 \u0915\u094D\u0932\u094B\u091C (\u20B9${ltp.toFixed(2)}) \u0932\u0947\u0915\u093F\u0928 \u0930\u0947\u0902\u091C \u20B9${c.low.toFixed(2)}\u2013\u20B9${c.high.toFixed(2)}\u0964 \u0905\u0917\u0932\u0947 \u0938\u0924\u094D\u0930 \u0915\u0940 \u0926\u093F\u0936\u093E \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0947\u0917\u0940\u0964`;
  return {
    id: `doji_${Date.now()}`,
    patternName,
    type: isBullish ? "Bullish" : "Bearish",
    patternCategory: "Candlestick",
    timeframeClass: "Swing",
    explanation: { en: enExpl, hi: hiExpl },
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    timeframe: "1D",
    successRate: isDragonfly ? 61.4 : isGravestone ? 59.8 : 55.3,
    historicalOccurrences: 0,
    entry: isBullish ? `${(ltp * 1.002).toFixed(2)} \u2013 ${(ltp * 1.007).toFixed(2)}` : `Below ${ltp.toFixed(2)}`,
    stopLoss: stopLossPrice.toFixed(2),
    target1: target1Price.toFixed(2),
    target2: target2Price.toFixed(2),
    riskReward: `1:${rrRatio}`,
    volumeConfirmed: volConfirmed,
    disclaimer: DISCLAIMER,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var btCache = /* @__PURE__ */ new Map();
function backtestPattern(candles, detectorFn, holdPeriod = 10, minMove = 0.03) {
  const cacheKey2 = `${candles[0]?.date}_${candles[candles.length - 1]?.date}_${detectorFn.name}_${holdPeriod}`;
  const cached = btCache.get(cacheKey2);
  if (cached && cached.expires > Date.now()) return cached.result;
  const startIdx = 65;
  if (candles.length < startIdx + holdPeriod + 5) {
    return { successRate: 0, occurrences: 0 };
  }
  let wins = 0;
  let total = 0;
  for (let i = startIdx; i < candles.length - holdPeriod - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const indicators = calculateIndicators(slice);
    let sig = null;
    try {
      sig = detectorFn(slice, indicators);
    } catch {
      continue;
    }
    if (!sig) continue;
    total++;
    const entryPrice = candles[i].close;
    const isBullish = sig.type === "Bullish";
    let hit = false;
    for (let j = i + 1; j <= i + holdPeriod && j < candles.length; j++) {
      const move = (candles[j].close - entryPrice) / entryPrice;
      if (isBullish && move >= minMove) {
        hit = true;
        break;
      }
      if (!isBullish && move <= -minMove) {
        hit = true;
        break;
      }
    }
    if (hit) wins++;
  }
  const result = total === 0 ? { successRate: 0, occurrences: 0 } : { successRate: Math.round(wins / total * 100 * 10) / 10, occurrences: total };
  btCache.set(cacheKey2, { result, expires: Date.now() + 24 * 60 * 60 * 1e3 });
  return result;
}
async function detectPatterns(candles) {
  const indicators = await computeIndicators(candles);
  const detectors = [
    detectMACross,
    detectRSIDivergence,
    detectBearishRSIDivergence,
    detectDoubleBottom,
    detectDoubleTop,
    detectHeadAndShoulders,
    detectInvertedHeadAndShoulders,
    detectCupAndHandle,
    detectAscendingTriangle,
    detectDescendingTriangle,
    detectHighBreakout,
    detectHammer,
    detectShootingStar,
    detectBullishEngulfing,
    detectBearishEngulfing,
    detectThreeWhiteSoldiers,
    detectThreeBlackCrows,
    detectMorningStar,
    detectEveningStar,
    detectMACDCrossover,
    detectBollingerSqueeze,
    detectSupportBounce,
    detectResistanceRejection,
    detectBullFlag,
    detectBearFlag,
    detectRisingWedge,
    detectFallingWedge,
    detectDoji
  ];
  const holdPeriods = {
    Intraday: 3,
    Swing: 10,
    Positional: 20
  };
  const signals = [];
  for (const detectFunc of detectors) {
    try {
      const sig = detectFunc(candles, indicators);
      if (sig) {
        if (candles.length >= 120) {
          const hp = holdPeriods[sig.timeframeClass] ?? 10;
          const bt = backtestPattern(candles, detectFunc, hp);
          if (bt.occurrences >= 1) {
            sig.successRate = bt.successRate;
            sig.historicalOccurrences = bt.occurrences;
          }
        }
        signals.push(sig);
      }
    } catch (err) {
      console.warn(`[PatternEngine] Detector error: ${err.message}`);
    }
  }
  return {
    signals: signals.sort((a, b) => b.confidenceScore - a.confidenceScore),
    indicators
  };
}
function parseAngelCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => Array.isArray(row) && row.length >= 6).map((row) => ({
    date: new Date(row[0]).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  })).filter((c) => c.close > 0 && c.high > 0);
}

// server/services/gemini.ts
import { OpenAI as OpenAI2 } from "openai";
var openai = null;
function getClient() {
  if (!openai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set in .env");
    openai = new OpenAI2({ apiKey: key });
  }
  return openai;
}
async function explainPattern(opts) {
  const { patternName, stockSymbol, direction, confidenceScore, timeframeClass } = opts;
  const prompt = `You are an elite institutional technical analyst covering the NSE for retail investors.

A ${direction} "${patternName}" pattern has been detected on ${stockSymbol} with a high algorithmic confidence score of ${confidenceScore}/100 for ${timeframeClass} trading.

Provide an elaborate, professional, and highly insightful explanation in TWO parts:
1. English explanation (4-5 sentences): Detail the psychology behind this pattern (who is in control: buyers or sellers), what institutional mechanics it implies, what technical action it suggests, and the critical risk management levels to monitor.
2. Hindi explanation (4-5 sentences in Devanagari script): Provide the exact same deep dive into market psychology, technical action, and risk management in clear, professional, yet understandable Hindi.

Format your response as JSON exactly like this:
{
  "en": "Elaborate English explanation here...",
  "hi": "\u0935\u093F\u0938\u094D\u0924\u0943\u0924 \u0939\u093F\u0902\u0926\u0940 \u092E\u0947\u0902 \u0935\u094D\u092F\u093E\u0916\u094D\u092F\u093E \u092F\u0939\u093E\u0901..."
}

Ensure the analysis feels institutional and highly valuable. Do not use markdown formatting inside the JSON strings.`;
  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });
    const text2 = response.choices[0].message?.content?.trim() || "{}";
    const parsed = JSON.parse(text2);
    return {
      en: parsed.en ?? "Pattern explanation not available.",
      hi: parsed.hi ?? "\u092A\u0948\u091F\u0930\u094D\u0928 \u0915\u093E \u0935\u093F\u0935\u0930\u0923 \u0909\u092A\u0932\u092C\u094D\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964"
    };
  } catch (err) {
    console.error("[OpenAI] explainPattern error:", err.message);
    return {
      en: `A ${direction} ${patternName} pattern has been detected on ${stockSymbol}. This ${timeframeClass.toLowerCase()} pattern suggests ${direction === "Bullish" ? "potential upward price movement" : "potential downward price movement"}. Always use proper stop-loss to manage risk.`,
      hi: `${stockSymbol} \u092A\u0930 \u090F\u0915 ${direction === "Bullish" ? "\u0924\u0947\u091C\u0940" : "\u092E\u0902\u0926\u0940"} \u0915\u093E ${patternName} \u092A\u0948\u091F\u0930\u094D\u0928 \u0926\u0947\u0916\u093E \u0917\u092F\u093E \u0939\u0948\u0964 \u092F\u0939 ${timeframeClass.toLowerCase()} \u092A\u0948\u091F\u0930\u094D\u0928 ${direction === "Bullish" ? "\u0915\u0940\u092E\u0924 \u092E\u0947\u0902 \u090A\u092A\u0930 \u091C\u093E\u0928\u0947" : "\u0915\u0940\u092E\u0924 \u092E\u0947\u0902 \u0928\u0940\u091A\u0947 \u0906\u0928\u0947"} \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0926\u0947\u0924\u093E \u0939\u0948\u0964 \u0939\u092E\u0947\u0936\u093E \u0909\u091A\u093F\u0924 \u0938\u094D\u091F\u0949\u092A-\u0932\u0949\u0938 \u0915\u0947 \u0938\u093E\u0925 \u091F\u094D\u0930\u0947\u0921 \u0915\u0930\u0947\u0902\u0964`
    };
  }
}
async function generateMarketSummary(opts) {
  const { totalBull, totalBear, topPatterns } = opts;
  const prompt = `You are an institutional NSE macro-strategist. Based on the aggregate pattern detection results from the Indian market, construct a highly elaborate, professional, and detailed market breadth summary paragraph for retail investors.

Data to synthesize:
- Bullish signals detected: ${totalBull}
- Bearish signals detected: ${totalBear}
- Top high-confidence patterns: ${topPatterns.slice(0, 5).map((p) => `${p.symbol} (${p.pattern}, ${p.direction}, ${p.confidence}% conf)`).join("; ")}

Write a single, comprehensive paragraph (4-6 sentences). Explain the overall market sentiment, what the ratio of bullish vs bearish signals implies about market breath, and highlight the most critical setups forming right now. Do not use markdown or bullet points. Use institutional, authoritative, yet plain language.`;
  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });
    return response.choices[0].message?.content?.trim() || "";
  } catch (err) {
    console.error("[OpenAI] marketSummary error:", err.message);
    const sentiment = totalBull > totalBear ? "bullish" : totalBull < totalBear ? "bearish" : "neutral";
    return `Market sentiment appears ${sentiment} with ${totalBull} bullish and ${totalBear} bearish patterns detected across NSE stocks. The top signal is ${topPatterns[0]?.symbol ?? "N/A"} showing a ${topPatterns[0]?.pattern ?? "strong"} pattern. Exercise proper risk management before entering any trades.`;
  }
}
async function generateFullAnalysis(payload) {
  const candles = Array.isArray(payload.chartData) ? payload.chartData : [];
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const n = closes.length;
  function sma2(arr, period) {
    if (arr.length < period) return null;
    const slice = arr.slice(arr.length - period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }
  const sma5 = sma2(closes, 5);
  const sma20 = sma2(closes, 20);
  const sma50 = sma2(closes, 50);
  const last20High = n >= 20 ? Math.max(...candles.slice(n - 20).map((c) => c.high)) : null;
  const last20Low = n >= 20 ? Math.min(...candles.slice(n - 20).map((c) => c.low)) : null;
  const last5VolAvg = sma2(volumes, 5);
  const last20VolAvg = sma2(volumes, 20);
  const volRatio = last5VolAvg && last20VolAvg && last20VolAvg > 0 ? last5VolAvg / last20VolAvg : null;
  const last10Closes = closes.slice(Math.max(0, n - 10));
  let upDays = 0, downDays = 0;
  for (let i = 1; i < last10Closes.length; i++) {
    if (last10Closes[i] > last10Closes[i - 1]) upDays++;
    else if (last10Closes[i] < last10Closes[i - 1]) downDays++;
  }
  const recentCloses = closes.slice(Math.max(0, n - 20));
  const rLen = recentCloses.length;
  let slope = 0;
  if (rLen >= 5) {
    const xMean = (rLen - 1) / 2;
    const yMean = recentCloses.reduce((a, b) => a + b, 0) / rLen;
    let num = 0, den = 0;
    recentCloses.forEach((y, x) => {
      num += (x - xMean) * (y - yMean);
      den += (x - xMean) ** 2;
    });
    slope = den !== 0 ? num / den : 0;
  }
  const trendDir = slope > 0.3 ? "Uptrend" : slope < -0.3 ? "Downtrend" : "Sideways/Consolidation";
  const w52h = payload.week52High ?? null;
  const w52l = payload.week52Low ?? null;
  const rangePos = w52h && w52l && w52h > w52l ? Math.round((payload.currentPrice - w52l) / (w52h - w52l) * 100) : null;
  const intradayRange = payload.high && payload.low && payload.high !== payload.low ? Math.round((payload.currentPrice - payload.low) / (payload.high - payload.low) * 100) : null;
  const stats = {
    symbol: payload.symbol,
    name: payload.name,
    exchange: payload.exchange ?? "NSE",
    currentPrice: payload.currentPrice,
    dayOpen: payload.open,
    dayHigh: payload.high,
    dayLow: payload.low,
    prevClose: payload.prevClose,
    change: payload.change,
    changePercent: payload.changePercent,
    volume: payload.volume,
    week52High: w52h,
    week52Low: w52l,
    rangePosition: rangePos !== null ? `${rangePos}% of 52-week range (0=at 52W Low, 100=at 52W High)` : "N/A",
    intradayPosition: intradayRange !== null ? `${intradayRange}% of today's range (0=at day Low, 100=at day High)` : "N/A",
    sma5: sma5 !== null ? +sma5.toFixed(2) : "N/A",
    sma20: sma20 !== null ? +sma20.toFixed(2) : "N/A",
    sma50: sma50 !== null ? +sma50.toFixed(2) : "N/A",
    priceVsSMA5: sma5 ? payload.currentPrice > sma5 ? "ABOVE" : "BELOW" : "N/A",
    priceVsSMA20: sma20 ? payload.currentPrice > sma20 ? "ABOVE (bullish)" : "BELOW (bearish)" : "N/A",
    priceVsSMA50: sma50 ? payload.currentPrice > sma50 ? "ABOVE (long-term bullish)" : "BELOW (long-term bearish)" : "N/A",
    recentTrend: `${trendDir} \u2014 ${upDays} up-days vs ${downDays} down-days in last 10 sessions`,
    slopePer1Day: +slope.toFixed(3),
    volumeTrend: volRatio !== null ? `5-day avg volume is ${volRatio.toFixed(2)}x the 20-day avg (${volRatio >= 1.5 ? "HIGH \u2014 strong participation" : volRatio <= 0.7 ? "LOW \u2014 weak participation" : "NORMAL"})` : "N/A",
    last20DayHigh: last20High !== null ? +last20High.toFixed(2) : "N/A",
    last20DayLow: last20Low !== null ? +last20Low.toFixed(2) : "N/A",
    candlesAvailable: n,
    detectedPatterns: (payload.signals ?? []).map((s) => ({
      patternName: s.patternName,
      type: s.type,
      category: s.patternCategory,
      confidence: s.confidenceScore,
      timeframe: s.timeframeClass,
      entry: s.entry,
      stopLoss: s.stopLoss,
      target1: s.target1,
      target2: s.target2,
      riskReward: s.riskReward,
      volumeConfirmed: s.volumeConfirmed,
      successRate: s.successRate,
      occurrences: s.historicalOccurrences
    })),
    lastUpdated: payload.lastUpdated
  };
  const prompt = `You are AlphaSignal's senior technical analyst. Produce a grounded, accurate technical analysis report for retail investors.

STRICT RULES \u2014 NEVER BREAK:
1. Use ONLY the numbers in the STOCK DATA block below. Do NOT invent or assume any figure not explicitly given.
2. If a value is "N/A", state it is unavailable \u2014 never substitute a guess.
3. If candlesAvailable < 20, explicitly note that historical data is limited.
4. No hallucination. Every claim must directly reference a number from the data.
5. Do NOT write generic market commentary. Only analyse THIS specific stock using THIS data.
6. Wrap every key number, price level, and critical insight in **double asterisks** so it renders highlighted.
7. Be elaborative where it adds value, but skip padding. Each section should be 3\u20135 sentences.
8. No emojis. Professional tone.

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
STOCK DATA:
${JSON.stringify(stats, null, 2)}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

Write the report using EXACTLY this structure:

# ${stats.symbol} \u2014 Technical Analysis Report
*${stats.name} | ${stats.exchange} | Generated ${(/* @__PURE__ */ new Date()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST*

---

## 1. Current Price Action
Describe today's session using the exact dayOpen, dayHigh, dayLow, currentPrice, change, and changePercent values. Calculate and state whether the stock closed in the upper, middle, or lower third of today's range using intradayPosition. Comment on what that intraday close position implies about buyer/seller control. Mention the volume trend and what it says about participation.

## 2. Trend & Moving Average Analysis
State the recentTrend direction and slope. Compare currentPrice against SMA5, SMA20, and SMA50 using the exact values \u2014 state clearly whether price is ABOVE or BELOW each. Explain what the combination of SMA alignment means: full bullish stack (price > SMA5 > SMA20 > SMA50), mixed signals, or full bearish stack. Reference the last 10 session up/down day count to confirm or challenge the SMA picture.

## 3. Key Price Levels to Watch
Present as bullet points with exact numbers:
- **Immediate Support:** last20DayLow and SMA20 value \u2014 which is stronger?
- **Immediate Resistance:** last20DayHigh \u2014 distance from current price in %
- **52-Week Context:** rangePosition \u2014 is the stock near yearly highs (>75%), mid-range (25\u201375%), or near lows (<25%)? What does that imply?
- **Critical Pivot:** if currentPrice is near SMA20 or SMA50, name the exact level as the key pivot

## 4. Detected Chart Patterns
If no patterns detected: state exactly "No high-confidence chart patterns were identified in the current dataset."
For EACH detected pattern: state the patternName, type (Bullish/Bearish), confidence score, and timeframe. Explain in 2 sentences what price behaviour triggered this pattern based on recent candles. List the exact entry, stop-loss, target1, target2, and risk:reward. State whether volume confirmed the pattern (volumeConfirmed field). Mention the historical success rate and occurrences.

## 5. Summary & Key Level to Watch
Synthesise sections 1\u20134 into a clear directional view: **Bullish**, **Bearish**, or **Neutral/Sideways**, with a one-sentence justification referencing the data. State one specific price level that, if breached, would invalidate the current view. Keep this section to 3\u20134 sentences maximum.

---
*Data source: Angel One SmartAPI | Not investment advice | Past performance does not guarantee future results*`;
  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }]
    });
    const rawContent = response.choices[0].message?.content?.trim() || "";
    return rawContent.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");
  } catch (err) {
    console.error("[OpenAI] generateFullAnalysis error:", err.message);
    throw new Error("Failed to generate analysis: " + err.message);
  }
}

// server/services/upstox.ts
import fs2 from "fs";
import path2 from "path";
import { gunzip } from "zlib";
import { promisify } from "util";
var CLIENT_ID2 = process.env.UPSTOX_CLIENT_ID ?? "";
var CLIENT_SECRET = process.env.UPSTOX_CLIENT_SECRET ?? "";
var REDIRECT_URI = process.env.UPSTOX_REDIRECT_URI ?? "http://localhost:5000/upstox-callback";
var ANALYTICS_TOKEN = process.env.UPSTOX_ANALYTICS_TOKEN ?? "";
var BASE_V2 = "https://api.upstox.com/v2";
var BASE_V3 = "https://api.upstox.com/v3";
var NSE_ISIN_MAP = {
  // Banking
  HDFCBANK: "NSE_EQ|INE040A01034",
  ICICIBANK: "NSE_EQ|INE090A01021",
  SBIN: "NSE_EQ|INE062A01020",
  KOTAKBANK: "NSE_EQ|INE237A01028",
  AXISBANK: "NSE_EQ|INE238A01034",
  INDUSINDBK: "NSE_EQ|INE095A01012",
  BANDHANBNK: "NSE_EQ|INE545U01014",
  BANKBARODA: "NSE_EQ|INE028A01039",
  PNB: "NSE_EQ|INE160A01022",
  CANBK: "NSE_EQ|INE476A01022",
  FEDERALBNK: "NSE_EQ|INE171A01029",
  IDFCFIRSTB: "NSE_EQ|INE092T01019",
  RBLBANK: "NSE_EQ|INE976G01028",
  // IT
  TCS: "NSE_EQ|INE467B01029",
  INFY: "NSE_EQ|INE009A01021",
  WIPRO: "NSE_EQ|INE075A01022",
  HCLTECH: "NSE_EQ|INE860A01027",
  TECHM: "NSE_EQ|INE669C01036",
  MPHASIS: "NSE_EQ|INE356A01018",
  LTI: "NSE_EQ|INE214T01019",
  PERSISTENT: "NSE_EQ|INE262H01021",
  COFORGE: "NSE_EQ|INE350H01014",
  OFSS: "NSE_EQ|INE881D01027",
  KPITTECH: "NSE_EQ|INE04I401011",
  // Energy & Oil
  RELIANCE: "NSE_EQ|INE002A01018",
  ONGC: "NSE_EQ|INE213A01029",
  BPCL: "NSE_EQ|INE029A01011",
  IOC: "NSE_EQ|INE242A01010",
  NTPC: "NSE_EQ|INE733E01010",
  POWERGRID: "NSE_EQ|INE752E01010",
  COALINDIA: "NSE_EQ|INE522F01014",
  ADANIGREEN: "NSE_EQ|INE364U01010",
  // FMCG
  ITC: "NSE_EQ|INE154A01025",
  HINDUNILVR: "NSE_EQ|INE030A01027",
  NESTLEIND: "NSE_EQ|INE239A01024",
  BRITANNIA: "NSE_EQ|INE216A01030",
  DABUR: "NSE_EQ|INE016A01026",
  MARICO: "NSE_EQ|INE196A01026",
  // Telecom
  BHARTIARTL: "NSE_EQ|INE397D01024",
  // Finance
  BAJFINANCE: "NSE_EQ|INE296A01024",
  BAJAJFINSV: "NSE_EQ|INE918I01026",
  HDFCLIFE: "NSE_EQ|INE795G01014",
  SBILIFE: "NSE_EQ|INE123W01016",
  CHOLAFIN: "NSE_EQ|INE121A01024",
  POLICYBZR: "NSE_EQ|INE417T01026",
  PAYTM: "NSE_EQ|INE982J01020",
  // Auto
  MARUTI: "NSE_EQ|INE585B01010",
  TATAMOTORS: "NSE_EQ|INE155A01022",
  HEROMOTOCO: "NSE_EQ|INE158A01026",
  EICHERMOT: "NSE_EQ|INE066A01021",
  "BAJAJ-AUTO": "NSE_EQ|INE917I01010",
  "M&M": "NSE_EQ|INE101A01026",
  // Pharma
  SUNPHARMA: "NSE_EQ|INE044A01036",
  DRREDDY: "NSE_EQ|INE089A01023",
  CIPLA: "NSE_EQ|INE059A01026",
  DIVISLAB: "NSE_EQ|INE361B01024",
  AUROPHARMA: "NSE_EQ|INE406A01037",
  TORNTPHARM: "NSE_EQ|INE685A01028",
  LUPIN: "NSE_EQ|INE326A01037",
  ALKEM: "NSE_EQ|INE540L01014",
  IPCALAB: "NSE_EQ|INE571A01020",
  GLENMARK: "NSE_EQ|INE935A01035",
  // Metals & Materials
  HINDALCO: "NSE_EQ|INE038A01020",
  JSWSTEEL: "NSE_EQ|INE019A01038",
  TATASTEEL: "NSE_EQ|INE081A01012",
  VEDL: "NSE_EQ|INE205A01025",
  GRASIM: "NSE_EQ|INE047A01021",
  ULTRACEMCO: "NSE_EQ|INE481G01011",
  AMBUJACEMENT: "NSE_EQ|INE079A01024",
  // Consumer & Retail
  ASIANPAINT: "NSE_EQ|INE021A01026",
  TITAN: "NSE_EQ|INE280A01028",
  TATACONSUM: "NSE_EQ|INE192A01025",
  GODREJCP: "NSE_EQ|INE102D01028",
  BERGEPAINT: "NSE_EQ|INE463A01038",
  HAVELLS: "NSE_EQ|INE176B01034",
  DIXON: "NSE_EQ|INE935N01020",
  DMART: "NSE_EQ|INE192R01011",
  TRENT: "NSE_EQ|INE849A01020",
  ZOMATO: "NSE_EQ|INE758T01015",
  NYKAA: "NSE_EQ|INE388Y01014",
  // Infra & Conglomerates
  LT: "NSE_EQ|INE018A01030",
  ADANIPORTS: "NSE_EQ|INE742F01042",
  ADANIENT: "NSE_EQ|INE423A01024",
  SIEMENS: "NSE_EQ|INE003A01024",
  ABB: "NSE_EQ|INE117A01022",
  // Healthcare
  APOLLOHOSP: "NSE_EQ|INE437A01024",
  MAXHEALTH: "NSE_EQ|INE027H01010",
  // Chemicals
  UPL: "NSE_EQ|INE628A01036",
  PIDILITIND: "NSE_EQ|INE318A01026",
  AARTI: "NSE_EQ|INE769A01020",
  DEEPAKNTR: "NSE_EQ|INE196B01031",
  NAVINFLUOR: "NSE_EQ|INE048G01026",
  SRF: "NSE_EQ|INE647A01010",
  TATACHEM: "NSE_EQ|INE110A01019",
  // PSU / Defence
  HAL: "NSE_EQ|INE066F01012",
  BEL: "NSE_EQ|INE263A01024",
  BHEL: "NSE_EQ|INE257A01026",
  GAIL: "NSE_EQ|INE129A01019",
  NMDC: "NSE_EQ|INE584A01023",
  SAIL: "NSE_EQ|INE114A01011",
  IRCTC: "NSE_EQ|INE335Y01020",
  RVNL: "NSE_EQ|INE415G01027",
  COCHINSHIP: "NSE_EQ|INE704P01017",
  DRDO: "NSE_EQ|INE737H01014"
};
function getNseInstrumentKey(symbol) {
  return NSE_ISIN_MAP[symbol] ?? null;
}
var _dynamicNse = [];
var _dynamicBse = [];
var _masterLoaded = false;
function getDynamicNseSymbols() {
  return _dynamicNse;
}
function getDynamicBseSymbols() {
  return _dynamicBse;
}
async function downloadInstrumentMaster(exchange) {
  const url = `https://assets.upstox.com/market-quote/instruments/exchange/${exchange}.json.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${exchange} master (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const decompressed = await gunzipAsync(buffer);
  const raw = JSON.parse(decompressed.toString("utf-8"));
  const equity = raw.filter((i) => i.instrument_type === "EQ" && i.tradingsymbol && i.isin);
  return equity.map((i) => ({
    symbol: i.tradingsymbol.toUpperCase(),
    name: i.name ?? i.tradingsymbol,
    token: "",
    // AO token unknown for dynamic stocks
    sector: "Various",
    instrKey: i.instrument_key ?? `${exchange}_EQ|${i.isin}`,
    isin: i.isin
  }));
}
async function initDynamicSymbols(staticNse, staticBse) {
  try {
    console.log("[Upstox] Downloading NSE instrument master...");
    const [nseRaw, bseRaw] = await Promise.allSettled([
      downloadInstrumentMaster("NSE"),
      downloadInstrumentMaster("BSE")
    ]);
    const staticNseMap = new Map(staticNse.map((s) => [s.symbol, s]));
    const staticBseMap = new Map(staticBse.map((s) => [s.symbol, s]));
    const nseIsinMap = {};
    if (nseRaw.status === "fulfilled") {
      const dynamic = nseRaw.value;
      for (const d of dynamic) nseIsinMap[d.symbol] = d.instrKey;
      const merged = /* @__PURE__ */ new Map();
      for (const s of staticNse) {
        merged.set(s.symbol, {
          symbol: s.symbol,
          name: s.name,
          token: s.token,
          sector: s.sector,
          instrKey: NSE_ISIN_MAP[s.symbol] ?? nseIsinMap[s.symbol] ?? "",
          isin: (NSE_ISIN_MAP[s.symbol] ?? "").replace("NSE_EQ|", "")
        });
      }
      for (const d of dynamic) {
        if (!merged.has(d.symbol)) merged.set(d.symbol, d);
      }
      _dynamicNse = Array.from(merged.values()).filter((s) => s.instrKey);
      console.log(`[Upstox] NSE master loaded: ${_dynamicNse.length} equity stocks`);
    } else {
      console.warn("[Upstox] NSE master download failed:", nseRaw.reason?.message);
      _dynamicNse = staticNse.map((s) => ({
        ...s,
        instrKey: NSE_ISIN_MAP[s.symbol] ?? "",
        isin: (NSE_ISIN_MAP[s.symbol] ?? "").replace("NSE_EQ|", "")
      }));
    }
    if (bseRaw.status === "fulfilled") {
      const dynamic = bseRaw.value;
      const merged = /* @__PURE__ */ new Map();
      for (const s of staticBse) {
        merged.set(s.symbol, {
          symbol: s.symbol,
          name: s.name,
          token: s.token,
          sector: s.sector,
          instrKey: `BSE_EQ|${s.isin ?? ""}`,
          isin: s.isin ?? ""
        });
      }
      for (const d of dynamic) {
        if (!merged.has(d.symbol)) merged.set(d.symbol, d);
      }
      _dynamicBse = Array.from(merged.values()).filter((s) => s.instrKey && s.instrKey !== "BSE_EQ|");
      console.log(`[Upstox] BSE master loaded: ${_dynamicBse.length} equity stocks`);
    } else {
      console.warn("[Upstox] BSE master download failed:", bseRaw.reason?.message);
      _dynamicBse = staticBse.map((s) => ({
        ...s,
        instrKey: getNseInstrumentKey(s.symbol)?.replace("NSE_EQ|", "BSE_EQ|") ?? "",
        isin: ""
      }));
    }
    _masterLoaded = true;
  } catch (e) {
    console.error("[Upstox] initDynamicSymbols failed:", e.message);
  }
}
var gunzipAsync = promisify(gunzip);
var TOKEN_FILE = path2.resolve(process.cwd(), ".upstox-token.json");
var _accessToken = null;
var _tokenExpiry = 0;
(function loadTokenFromDisk() {
  try {
    if (fs2.existsSync(TOKEN_FILE)) {
      const raw = JSON.parse(fs2.readFileSync(TOKEN_FILE, "utf8"));
      if (raw.token && raw.expiry && Date.now() < raw.expiry) {
        _accessToken = raw.token;
        _tokenExpiry = raw.expiry;
        console.log("[Upstox] Token restored from disk. Valid until", new Date(raw.expiry).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), "IST");
      } else {
        console.log("[Upstox] Saved token expired \u2014 re-auth required.");
      }
    }
  } catch (e) {
    console.warn("[Upstox] Could not load saved token:", e);
  }
})();
function isUpstoxReady() {
  if (_accessToken && Date.now() < _tokenExpiry) return true;
  return !!ANALYTICS_TOKEN;
}
function setAccessToken(token) {
  _accessToken = token;
  _tokenExpiry = Date.now() + 23 * 60 * 60 * 1e3;
  try {
    fs2.writeFileSync(TOKEN_FILE, JSON.stringify({ token, expiry: _tokenExpiry }), "utf8");
    console.log("[Upstox] Token saved to disk. Valid until", new Date(_tokenExpiry).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), "IST");
  } catch (e) {
    console.warn("[Upstox] Could not save token to disk:", e);
  }
}
function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID2,
    redirect_uri: REDIRECT_URI,
    response_type: "code"
  });
  return `https://api.upstox.com/v2/login/authorization/dialog?${params}`;
}
async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID2,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code"
  });
  const res = await fetch(`${BASE_V2}/login/authorization/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: body.toString()
  });
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`Upstox token exchange failed (${res.status}): ${text2}`);
  }
  const data = await res.json();
  const token = data.access_token;
  if (!token) throw new Error("No access_token in Upstox response");
  setAccessToken(token);
  return token;
}
async function upstoxGet(baseUrl, path3, params) {
  if (!isUpstoxReady()) throw new Error("Upstox not authenticated. Visit /api/upstox/auth to login.");
  const token = _accessToken && Date.now() < _tokenExpiry ? _accessToken : ANALYTICS_TOKEN;
  const url = new URL(`${baseUrl}${path3}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    }
  });
  if (res.status === 401) {
    _accessToken = null;
    throw new Error("Upstox token expired. Visit /api/upstox/auth to re-login.");
  }
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`Upstox API error (${res.status}): ${text2}`);
  }
  return res.json();
}
function v2Get(path3, params) {
  return upstoxGet(BASE_V2, path3, params);
}
function v3Get(path3, params) {
  return upstoxGet(BASE_V3, path3, params);
}
async function getUpstoxQuotes(instrumentKeys) {
  if (instrumentKeys.length === 0) return {};
  const BATCH = 200;
  const result = {};
  for (let i = 0; i < instrumentKeys.length; i += BATCH) {
    const batch = instrumentKeys.slice(i, i + BATCH);
    const instrument_key = batch.join(",");
    try {
      const data = await v2Get("/market-quote/quotes", { instrument_key });
      if (data?.data) Object.assign(result, data.data);
    } catch (e) {
      console.warn(`[Upstox] Quote batch ${i}\u2013${i + BATCH} failed: ${e.message}`);
    }
  }
  return result;
}
async function getUpstoxHistoricalCandles(instrumentKey, fromDate, toDate) {
  const encoded = encodeURIComponent(instrumentKey);
  try {
    const data = await v3Get(`/historical-candle/${encoded}/days/1/${toDate}/${fromDate}`);
    return data?.data?.candles ?? [];
  } catch (e) {
    console.warn(`[Upstox] V3 historical candles for ${instrumentKey} failed: ${e.message}`);
    return [];
  }
}
function normalizeUpstoxQuote(instrumentKey, quote, meta) {
  const ltp = quote.last_price ?? 0;
  const ohlc = quote.ohlc ?? {};
  const prevClose = ohlc.close ?? 0;
  const open = ohlc.open ?? ltp;
  const high = ohlc.high ?? ltp;
  const low = ohlc.low ?? ltp;
  const tradeVol = quote.volume ?? quote.total_buy_quantity ?? 0;
  if (ltp === 0) return null;
  const netChange = ltp - prevClose;
  const changePct = prevClose > 0 ? netChange / prevClose * 100 : 0;
  const w52h = quote["52_week_high"] ?? quote.upper_circuit_limit ?? null;
  const w52l = quote["52_week_low"] ?? quote.lower_circuit_limit ?? null;
  let volumeStr = "\u2014";
  if (tradeVol >= 1e7) volumeStr = `${(tradeVol / 1e7).toFixed(2)}Cr`;
  else if (tradeVol >= 1e5) volumeStr = `${(tradeVol / 1e5).toFixed(2)}L`;
  else if (tradeVol >= 1e3) volumeStr = `${(tradeVol / 1e3).toFixed(1)}K`;
  else if (tradeVol > 0) volumeStr = String(tradeVol);
  const exch = instrumentKey.startsWith("BSE") ? "BSE" : "NSE";
  return {
    symbol: meta.symbol,
    name: meta.name,
    sector: meta.sector,
    exchange: exch,
    currentPrice: ltp,
    prevClose,
    open,
    high,
    low,
    change: parseFloat(netChange.toFixed(2)),
    changePercent: parseFloat(changePct.toFixed(2)),
    volume: volumeStr,
    week52High: w52h,
    week52Low: w52l,
    ltp,
    tradeVol
  };
}
function parseUpstoxCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    if (!Array.isArray(c) || c.length < 6) return null;
    const date = String(c[0]).split("T")[0];
    return {
      date,
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5])
    };
  }).filter(Boolean).reverse();
}

// server/api/routes.ts
function istDateStr(d = /* @__PURE__ */ new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function fmtDate(d) {
  return `${istDateStr(d)} 09:00`;
}
function fmtNow(d) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}
function daysAgo(n) {
  return new Date(Date.now() - n * 864e5);
}
var cache = {};
function cacheGet2(key) {
  const e = cache[key];
  return e && e.expires > Date.now() ? e.data : null;
}
function cacheSet2(key, data, ttlMs) {
  cache[key] = { data, expires: Date.now() + ttlMs };
}
async function fetchStockFromUpstox(sym, instrKey, exchange = "NSE") {
  try {
    const today = istDateStr();
    const from120 = istDateStr(daysAgo(120));
    const [quotesMap, rawCandles] = await Promise.all([
      getUpstoxQuotes([instrKey]),
      getUpstoxHistoricalCandles(instrKey, from120, today)
    ]);
    const quote = quotesMap[instrKey];
    if (!quote) return null;
    const normalized = normalizeUpstoxQuote(instrKey, quote, sym);
    if (!normalized) return null;
    const candles = parseUpstoxCandles(rawCandles);
    let signals = [];
    let chartData = [];
    if (candles.length >= 20) {
      const liveCandle = {
        date: today,
        open: normalized.open || normalized.currentPrice,
        high: normalized.high || normalized.currentPrice,
        low: normalized.low || normalized.currentPrice,
        close: normalized.currentPrice,
        volume: normalized.tradeVol
      };
      const lastIdx = candles.length - 1;
      if (candles[lastIdx]?.date === today) candles[lastIdx] = liveCandle;
      else candles.push(liveCandle);
      const result = await detectPatterns(candles);
      signals = result.signals;
      chartData = candles.map((c) => ({
        date: c.date,
        price: c.close,
        open: c.open,
        high: c.high,
        low: c.low,
        volume: c.volume
      }));
    }
    return {
      symbol: sym.symbol,
      name: sym.name,
      sector: sym.sector,
      exchange,
      currentPrice: normalized.currentPrice,
      prevClose: normalized.prevClose || void 0,
      open: normalized.open,
      high: normalized.high,
      low: normalized.low,
      change: normalized.change,
      changePercent: normalized.changePercent,
      volume: normalized.volume,
      week52High: normalized.week52High,
      week52Low: normalized.week52Low,
      exchFeedTime: null,
      signals,
      chartData,
      dataSource: "Upstox",
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (e) {
    console.warn(`[Upstox] Full fetch failed for ${sym.symbol}: ${e.message}`);
    return null;
  }
}
async function fetchStockDataAccurate(sym, exchange = "NSE", prefetchedQuote) {
  const today = fmtNow(/* @__PURE__ */ new Date());
  const from = fmtDate(daysAgo(120));
  const histExch = exchange === "BSE" && sym.nseToken ? "NSE" : exchange;
  const histToken = exchange === "BSE" && sym.nseToken ? sym.nseToken : sym.token;
  const [quoteResult, rawCandles] = await Promise.allSettled([
    prefetchedQuote ? Promise.resolve(prefetchedQuote) : getMarketQuoteSingle(exchange, sym.token),
    getHistoricalData(histExch, histToken, "ONE_DAY", from, today)
  ]);
  let ltp = 0, prevClose = 0, open = 0, high = 0, low = 0;
  let netChange = 0, changePct = 0, tradeVolume = 0;
  let upperCircuit = null, lowerCircuit = null;
  let week52High = null, week52Low = null;
  let exchFeedTime = null;
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  if (quote) {
    ltp = parseFloat(quote.ltp ?? quote.lastPrice ?? "0") || 0;
    prevClose = parseFloat(quote.close ?? quote.prevClose ?? quote.previousClose ?? "0") || 0;
    open = parseFloat(quote.open ?? "0") || 0;
    high = parseFloat(quote.high ?? "0") || 0;
    low = parseFloat(quote.low ?? "0") || 0;
    netChange = parseFloat(quote.netChange ?? quote.change ?? "0") || 0;
    changePct = parseFloat(quote.percentChange ?? quote.pChange ?? "0") || 0;
    tradeVolume = parseInt(quote.tradeVolume ?? quote.totalTradedVolume ?? quote.tradedQuantity ?? "0", 10) || 0;
    upperCircuit = quote.upperCircuit ? parseFloat(quote.upperCircuit) : null;
    lowerCircuit = quote.lowerCircuit ? parseFloat(quote.lowerCircuit) : null;
    week52High = quote.fiftyTwoWeekHighPrice ? parseFloat(quote.fiftyTwoWeekHighPrice) : null;
    week52Low = quote.fiftyTwoWeekLowPrice ? parseFloat(quote.fiftyTwoWeekLowPrice) : null;
    exchFeedTime = quote.exchFeedTime || quote.exchTradeTime || null;
  }
  let candles = [];
  let signals = [];
  let chartData = [];
  let volumeStr = "\u2014";
  if (tradeVolume > 0) {
    if (tradeVolume >= 1e7) volumeStr = `${(tradeVolume / 1e7).toFixed(2)}Cr`;
    else if (tradeVolume >= 1e5) volumeStr = `${(tradeVolume / 1e5).toFixed(2)}L`;
    else if (tradeVolume >= 1e3) volumeStr = `${(tradeVolume / 1e3).toFixed(1)}K`;
    else volumeStr = String(tradeVolume);
  }
  if (ltp === 0) return null;
  if (rawCandles.status === "fulfilled" && Array.isArray(rawCandles.value)) {
    candles = parseAngelCandles(rawCandles.value);
    if (ltp > 0) {
      const liveDate = istDateStr();
      const lastIdx = candles.length - 1;
      const liveCandle = {
        date: liveDate,
        open: open || ltp,
        high: high || ltp,
        low: low || ltp,
        close: ltp,
        volume: tradeVolume
      };
      if (lastIdx >= 0 && candles[lastIdx].date === liveDate) {
        candles[lastIdx] = liveCandle;
      } else {
        candles.push(liveCandle);
      }
    }
    const result = await detectPatterns(candles);
    signals = result.signals;
    chartData = candles.map((c) => ({
      date: c.date,
      price: c.close,
      open: c.open,
      high: c.high,
      low: c.low,
      volume: c.volume
    }));
  }
  if (signals.length === 0 && ltp > 0) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const tkId = sym.token;
    const dayRange = high > 0 && low > 0 ? high - low : 0;
    const gapPct = prevClose > 0 ? (open - prevClose) / prevClose * 100 : 0;
    const closePos = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
    const aboveMid = closePos > 0.6;
    if (week52High && ltp >= week52High * 0.99) {
      const atHigh = ltp >= week52High;
      signals.push({ id: `52wh_${tkId}`, patternName: atHigh ? "52-Week High Breakout" : "52-Week High Resistance Test", type: "Bullish", patternCategory: "Breakout", timeframeClass: "Swing", explanation: { en: `${sym.symbol} is ${atHigh ? "trading at" : "within 1% of"} its 52-week high of \u20B9${week52High.toFixed(2)}, currently at \u20B9${ltp.toFixed(2)}.`, hi: `52-\u0938\u092A\u094D\u0924\u093E\u0939 \u0909\u091A\u094D\u091A \u0915\u0947 \u092A\u093E\u0938\u0964` }, confidenceScore: atHigh ? 88 : 80, confidenceBreakdown: "52-week high proximity", timeframe: "5\u201315 trading days", successRate: 71, historicalOccurrences: 14, entry: ltp.toFixed(2), stopLoss: (week52High * 0.94).toFixed(2), target1: (ltp * 1.08).toFixed(2), target2: (ltp * 1.15).toFixed(2), riskReward: "1:2.5", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (week52Low && ltp <= week52Low * 1.04 && changePct > 0 && aboveMid) {
      signals.push({ id: `52wl_${tkId}`, patternName: "52-Week Low Reversal", type: "Bullish", patternCategory: "Reversal", timeframeClass: "Swing", explanation: { en: `${sym.symbol} reversing off its 52-week low of \u20B9${week52Low.toFixed(2)}, +${changePct.toFixed(2)}% today.`, hi: `52-\u0938\u092A\u094D\u0924\u093E\u0939 \u0928\u093F\u092E\u094D\u0928 \u0938\u0947 \u0935\u093E\u092A\u0938\u0940\u0964` }, confidenceScore: 74, confidenceBreakdown: "52-week low support", timeframe: "7\u201321 trading days", successRate: 65, historicalOccurrences: 9, entry: ltp.toFixed(2), stopLoss: (week52Low * 0.97).toFixed(2), target1: (ltp * 1.07).toFixed(2), target2: (ltp * 1.14).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (gapPct >= 1.5 && ltp >= open) {
      const conf = gapPct >= 3 ? 84 : gapPct >= 2 ? 76 : 68;
      signals.push({ id: `gapup_${tkId}`, patternName: `Gap Up \u2014 ${gapPct.toFixed(1)}% Opening`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${gapPct.toFixed(1)}% higher at \u20B9${open.toFixed(2)} and is holding the gap (current: \u20B9${ltp.toFixed(2)}).`, hi: `\u0917\u0948\u092A \u0905\u092A\u0964` }, confidenceScore: conf, confidenceBreakdown: `Gap ${gapPct.toFixed(1)}%`, timeframe: "Same day to 3 trading days", successRate: 68, historicalOccurrences: 16, entry: ltp.toFixed(2), stopLoss: (open * 0.985).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.08).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (gapPct <= -1.5 && ltp <= open) {
      const absPct = Math.abs(gapPct);
      const conf = absPct >= 3 ? 82 : absPct >= 2 ? 74 : 66;
      signals.push({ id: `gapdn_${tkId}`, patternName: `Gap Down \u2014 ${absPct.toFixed(1)}% Opening`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${absPct.toFixed(1)}% lower at \u20B9${open.toFixed(2)} and cannot recover (current: \u20B9${ltp.toFixed(2)}).`, hi: `\u0917\u0948\u092A \u0921\u093E\u0909\u0928\u0964` }, confidenceScore: conf, confidenceBreakdown: `Gap \u2212${absPct.toFixed(1)}%`, timeframe: "Same day to 3 trading days", successRate: 66, historicalOccurrences: 14, entry: ltp.toFixed(2), stopLoss: (open * 1.015).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.92).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (changePct >= 3) {
      const conf = changePct >= 5 ? 86 : changePct >= 4 ? 78 : 70;
      signals.push({ id: `bull_mom_${tkId}`, patternName: `Bullish Momentum +${changePct.toFixed(1)}%`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is up ${changePct.toFixed(2)}% today (\u20B9${ltp.toFixed(2)}).`, hi: `\u092C\u0941\u0932\u093F\u0936 \u092E\u094B\u092E\u0947\u0902\u091F\u092E\u0964` }, confidenceScore: conf, confidenceBreakdown: `Momentum ${changePct.toFixed(1)}%`, timeframe: "1\u20133 trading days", successRate: 63, historicalOccurrences: 21, entry: ltp.toFixed(2), stopLoss: (low * 0.99).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.07).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (changePct <= -3) {
      const absPct = Math.abs(changePct);
      const conf = absPct >= 5 ? 84 : absPct >= 4 ? 76 : 68;
      signals.push({ id: `bear_mom_${tkId}`, patternName: `Bearish Momentum \u2212${absPct.toFixed(1)}%`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is down ${absPct.toFixed(2)}% today (\u20B9${ltp.toFixed(2)}).`, hi: `\u092C\u0947\u092F\u0930\u093F\u0936 \u092E\u094B\u092E\u0947\u0902\u091F\u092E\u0964` }, confidenceScore: conf, confidenceBreakdown: `Momentum \u2212${absPct.toFixed(1)}%`, timeframe: "1\u20133 trading days", successRate: 61, historicalOccurrences: 19, entry: ltp.toFixed(2), stopLoss: (high * 1.01).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.93).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (upperCircuit && ltp >= upperCircuit * 0.995) {
      signals.push({ id: `uCkt_${tkId}`, patternName: "Upper Circuit Hit", type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} has hit the upper circuit limit of \u20B9${upperCircuit.toFixed(2)}.`, hi: `\u0905\u092A\u0930 \u0938\u0930\u094D\u0915\u093F\u091F\u0964` }, confidenceScore: 92, confidenceBreakdown: "Circuit hit: +60 | Extreme demand: +32", timeframe: "1\u20132 trading days", successRate: 78, historicalOccurrences: 8, entry: ltp.toFixed(2), stopLoss: (ltp * 0.95).toFixed(2), target1: (ltp * 1.05).toFixed(2), target2: (ltp * 1.1).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (lowerCircuit && ltp <= lowerCircuit * 1.005) {
      signals.push({ id: `lCkt_${tkId}`, patternName: "Lower Circuit Hit", type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} has hit the lower circuit limit of \u20B9${lowerCircuit.toFixed(2)}.`, hi: `\u0932\u094B\u0905\u0930 \u0938\u0930\u094D\u0915\u093F\u091F\u0964` }, confidenceScore: 90, confidenceBreakdown: "Circuit hit: +58 | Extreme supply: +32", timeframe: "1\u20132 trading days", successRate: 74, historicalOccurrences: 7, entry: ltp.toFixed(2), stopLoss: (ltp * 1.05).toFixed(2), target1: (ltp * 0.95).toFixed(2), target2: (ltp * 0.9).toFixed(2), riskReward: "1:2.0", volumeConfirmed: tradeVolume > 0, disclaimer: "Not investment advice.", detectedAt: now });
    }
    if (signals.length === 0) {
      const rangeHigh = week52High ?? (upperCircuit ? upperCircuit / 1.2 : null);
      const rangeLow = week52Low ?? (lowerCircuit ? lowerCircuit * 1.2 : null);
      if (rangeHigh && rangeLow && rangeHigh > rangeLow) {
        const rangePos = Math.max(0, Math.min(1, (ltp - rangeLow) / (rangeHigh - rangeLow)));
        signals.push({ id: `range_${tkId}`, patternName: rangePos >= 0.7 ? "Near Annual High \u2014 Relative Strength" : rangePos <= 0.3 ? "Near Annual Low \u2014 Watch for Reversal" : "Mid-Range \u2014 Awaiting Breakout", type: rangePos >= 0.7 ? "Bullish" : "Neutral", patternCategory: "Support/Resistance", timeframeClass: "Swing", explanation: { en: `${sym.symbol} at \u20B9${ltp.toFixed(2)}, in the ${Math.round(rangePos * 100)}th percentile of its annual range.`, hi: `\u0935\u093E\u0930\u094D\u0937\u093F\u0915 \u0930\u0947\u0902\u091C \u092E\u0947\u0902 \u0938\u094D\u0925\u093F\u0924\u093F\u0964` }, confidenceScore: Math.round(40 + rangePos * 20), confidenceBreakdown: `Range position ${Math.round(rangePos * 100)}%`, timeframe: "5\u201315 trading days", successRate: 55, historicalOccurrences: 10, entry: ltp.toFixed(2), stopLoss: (ltp * 0.96).toFixed(2), target1: (ltp * 1.05).toFixed(2), target2: (ltp * 1.1).toFixed(2), riskReward: "1:2.0", volumeConfirmed: false, disclaimer: "Not investment advice.", detectedAt: now });
      }
    }
  }
  return {
    symbol: sym.symbol,
    name: sym.name,
    sector: sym.sector,
    exchange,
    currentPrice: ltp,
    prevClose: prevClose || void 0,
    open,
    high,
    low,
    change: parseFloat(netChange.toFixed(2)),
    changePercent: parseFloat(changePct.toFixed(2)),
    volume: volumeStr,
    upperCircuit,
    lowerCircuit,
    week52High,
    week52Low,
    exchFeedTime,
    signals,
    chartData,
    lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function registerRoutes(httpServer2, app2) {
  app2.get("/api/upstox/auth", (_req, res) => {
    res.redirect(getAuthUrl());
  });
  app2.get("/upstox-callback", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect("/");
    try {
      await exchangeCodeForToken(code);
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff">
          <h2 style="color:#22c55e">\u2705 Upstox Connected!</h2>
          <p>Access token saved. Live data from Upstox is now active.</p>
          <p>You can close this tab and return to <a href="http://localhost:5005" style="color:#22c55e">the app</a>.</p>
          <script>setTimeout(()=>{ window.location.href="http://localhost:5005"; },3000)</script>
        </body></html>
      `);
    } catch (e) {
      res.status(500).send(`<pre>Token exchange failed: ${e.message}</pre>`);
    }
  });
  app2.get("/api/upstox/callback", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code parameter from Upstox.");
    try {
      await exchangeCodeForToken(code);
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff">
          <h2 style="color:#22c55e">\u2705 Upstox Connected!</h2>
          <p>Access token saved. Live data from Upstox is now active.</p>
          <p>You can close this tab and return to the app.</p>
          <script>setTimeout(()=>window.close(),3000)</script>
        </body></html>
      `);
    } catch (e) {
      res.status(500).send(`<pre>Token exchange failed: ${e.message}</pre>`);
    }
  });
  app2.get("/api/upstox/status", (_req, res) => {
    res.json({
      connected: isUpstoxReady(),
      authUrl: isUpstoxReady() ? null : "/api/upstox/auth",
      message: isUpstoxReady() ? "Upstox is authenticated and active." : "Upstox not authenticated. Open /api/upstox/auth in your browser to login."
    });
  });
  app2.get("/api/prices/stream", async (req, res) => {
    const exchange = req.query.exchange?.toUpperCase() === "BSE" ? "BSE" : "NSE";
    const symbols = exchange === "BSE" ? BSE_SYMBOLS : NSE_SYMBOLS;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();
    function fmtVol(v) {
      if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
      if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
      if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
      return String(v);
    }
    async function pushPrices() {
      try {
        const tokens = symbols.map((s) => s.token);
        const BATCH = 50;
        const updates = [];
        for (let i = 0; i < tokens.length; i += BATCH) {
          const batch = tokens.slice(i, i + BATCH);
          const symBatch = symbols.slice(i, i + BATCH);
          try {
            const quoteMap = await getMarketQuote({ [exchange]: batch }, "FULL");
            const quotes = quoteMap[exchange] ?? Object.values(quoteMap).flat();
            for (const q of quotes) {
              const token = q.symbolToken ?? q.token;
              const sym = symBatch.find((s) => s.token === token);
              if (!sym) continue;
              const price = parseFloat(q.ltp ?? q.lastPrice ?? "0") || 0;
              const prevClose = parseFloat(q.close ?? q.prevClose ?? "0") || 0;
              const open = parseFloat(q.open ?? "0") || 0;
              const high = parseFloat(q.high ?? "0") || 0;
              const low = parseFloat(q.low ?? "0") || 0;
              const change = parseFloat(q.netChange ?? q.change ?? "0") || 0;
              const changePct = parseFloat(q.percentChange ?? q.pChange ?? "0") || 0;
              const vol = parseInt(q.tradeVolume ?? q.totalTradedVolume ?? "0", 10) || 0;
              if (price === 0) continue;
              updates.push({
                symbol: sym.symbol,
                exchange,
                price,
                prevClose,
                open,
                high,
                low,
                change: parseFloat(change.toFixed(2)),
                changePercent: parseFloat(changePct.toFixed(2)),
                volume: fmtVol(vol),
                ts: Date.now()
              });
            }
          } catch (e) {
            console.error("[Route] silent error:", e?.message ?? e);
          }
        }
        if (updates.length > 0 && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(updates)}

`);
        }
      } catch (err) {
        console.warn("[SSE] pushPrices error:", err.message);
      }
    }
    await pushPrices();
    const interval = setInterval(pushPrices, 4e3);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": heartbeat\n\n");
    }, 25e3);
    req.on("close", () => {
      clearInterval(interval);
      clearInterval(heartbeat);
    });
  });
  app2.get("/api/stocks/search-local", (req, res) => {
    try {
      const { exchange = "NSE", q = "" } = req.query;
      const query = q.trim().toLowerCase();
      if (!query || query.length < 1) return res.json([]);
      const list = exchange === "BSE" ? BSE_SYMBOLS : NSE_SYMBOLS;
      const matches = list.filter(
        (s) => s.symbol.toLowerCase().includes(query) || s.name.toLowerCase().includes(query)
      ).sort((a, b) => {
        const aSym = a.symbol.toLowerCase();
        const bSym = b.symbol.toLowerCase();
        if (aSym === query) return -1;
        if (bSym === query) return 1;
        if (aSym.startsWith(query) && !bSym.startsWith(query)) return -1;
        if (bSym.startsWith(query) && !aSym.startsWith(query)) return 1;
        return aSym.localeCompare(bSym);
      }).slice(0, 15).map((s) => ({
        tradingsymbol: s.symbol,
        symbol: s.symbol,
        // UI might use either
        name: s.name,
        symboltoken: s.token,
        exchange,
        series: "EQ",
        sector: s.sector
      }));
      res.json(matches);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/search", async (req, res) => {
    try {
      let score2 = function(sym, name) {
        const s = sym.toLowerCase();
        const n = name.toLowerCase();
        if (s === query || n === query) return 100;
        if (s.startsWith(query)) return 90;
        if (n.startsWith(query)) return 85;
        if (s.includes(query)) return 75;
        if (n.includes(query)) return 65;
        const words = n.split(/[\s\-\.&]+/);
        if (words.some((w) => w.startsWith(query))) return 55;
        let qi = 0;
        for (let ci = 0; ci < s.length && qi < query.length; ci++) {
          if (s[ci] === query[qi]) qi++;
        }
        if (qi === query.length && query.length >= 3) return 30;
        return 0;
      };
      var score = score2;
      const { q = "" } = req.query;
      const raw = q.trim();
      if (!raw || raw.length < 1) return res.json([]);
      const query = raw.toLowerCase();
      const nseMatches = NSE_SYMBOLS.map((s) => ({ ...s, exchange: "NSE", score: score2(s.symbol, s.name) })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
      const bseMatches = BSE_SYMBOLS.map((s) => ({ ...s, exchange: "BSE", score: score2(s.symbol, s.name) })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
      const seen = /* @__PURE__ */ new Set();
      const combined = [];
      for (const m of [...nseMatches, ...bseMatches]) {
        if (!seen.has(m.symbol)) {
          seen.add(m.symbol);
          combined.push(m);
        }
      }
      combined.sort((a, b) => b.score - a.score);
      const top = combined.slice(0, 10);
      const nseTokens = top.filter((m) => m.exchange === "NSE").map((m) => m.token);
      const bseTokens = top.filter((m) => m.exchange === "BSE").map((m) => m.token);
      const [nseRes, bseRes] = await Promise.allSettled([
        nseTokens.length ? getMarketQuote({ NSE: nseTokens }, "FULL") : Promise.resolve({}),
        bseTokens.length ? getMarketQuote({ BSE: bseTokens }, "FULL") : Promise.resolve({})
      ]);
      const qMap = {};
      if (nseRes.status === "fulfilled") {
        const arr = nseRes.value?.NSE ?? Object.values(nseRes.value).flat();
        for (const q2 of arr) {
          const t = q2.symbolToken || q2.token;
          if (t) qMap[`NSE:${t}`] = q2;
        }
      }
      if (bseRes.status === "fulfilled") {
        const arr = bseRes.value?.BSE ?? Object.values(bseRes.value).flat();
        for (const q2 of arr) {
          const t = q2.symbolToken || q2.token;
          if (t) qMap[`BSE:${t}`] = q2;
        }
      }
      const results = top.map((m) => {
        const q2 = qMap[`${m.exchange}:${m.token}`];
        const price = q2 ? parseFloat(q2.ltp ?? q2.lastPrice ?? "0") || 0 : 0;
        const prevClose = q2 ? parseFloat(q2.close ?? q2.prevClose ?? "0") || 0 : 0;
        const change = q2 ? parseFloat(q2.netChange ?? q2.change ?? "0") || 0 : 0;
        const changePct = q2 ? parseFloat(q2.percentChange ?? q2.pChange ?? "0") || 0 : 0;
        const open = q2 ? parseFloat(q2.open ?? "0") || 0 : 0;
        const high = q2 ? parseFloat(q2.high ?? "0") || 0 : 0;
        const low = q2 ? parseFloat(q2.low ?? "0") || 0 : 0;
        const vol = q2 ? parseInt(q2.tradeVolume ?? q2.totalTradedVolume ?? "0", 10) || 0 : 0;
        return {
          symbol: m.symbol,
          name: m.name,
          sector: m.sector,
          exchange: m.exchange,
          token: m.token,
          currentPrice: price,
          prevClose,
          open,
          high,
          low,
          change: parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePct.toFixed(2)),
          volume: vol,
          score: m.score,
          dataSource: "AngelOne"
        };
      });
      if (isUpstoxReady()) {
        await Promise.allSettled(
          results.filter((r) => r.currentPrice === 0 && r.exchange === "NSE").map(async (r) => {
            try {
              const instrKey = getNseInstrumentKey(r.symbol);
              if (!instrKey) return;
              const upMap = await getUpstoxQuotes([instrKey]);
              const uq = upMap[instrKey];
              if (!uq) return;
              const norm = normalizeUpstoxQuote(instrKey, uq, r);
              if (!norm) return;
              Object.assign(r, {
                currentPrice: norm.currentPrice,
                prevClose: norm.prevClose,
                open: norm.open,
                high: norm.high,
                low: norm.low,
                change: norm.change,
                changePercent: norm.changePercent,
                dataSource: "Upstox"
              });
            } catch (e) {
              console.error("[Route] silent error:", e?.message ?? e);
            }
          })
        );
      }
      const filtered = results.filter((r) => r.currentPrice > 0 || r.score >= 85);
      res.json(filtered.slice(0, 10));
    } catch (e) {
      console.error("[Search] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/angelone/session", async (_req, res) => {
    try {
      const s = await generateSession();
      res.json({ status: "active", feedToken: s.feedToken });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/angelone/profile", async (_req, res) => {
    try {
      res.json(await getProfile());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/angelone/quote", async (req, res) => {
    try {
      const { exchange = "NSE", tokens, mode = "FULL" } = req.query;
      if (!tokens) return res.status(400).json({ error: "Missing param: tokens (comma-separated)" });
      const tokenList = tokens.split(",").map((t) => t.trim()).filter(Boolean);
      const result = await getMarketQuote({ [exchange]: tokenList }, mode);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/angelone/ltp", async (req, res) => {
    try {
      const { exchange, tradingSymbol, symbolToken } = req.query;
      if (!exchange || !tradingSymbol || !symbolToken)
        return res.status(400).json({ error: "Missing required params: exchange, tradingSymbol, symbolToken" });
      res.json(await getLTP(exchange, tradingSymbol, symbolToken));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/angelone/historical", async (req, res) => {
    try {
      const { exchange, symbolToken, interval, fromDate, toDate } = req.query;
      if (!exchange || !symbolToken || !interval || !fromDate || !toDate)
        return res.status(400).json({ error: "Missing required params: exchange, symbolToken, interval, fromDate, toDate" });
      res.json(await getHistoricalData(exchange, symbolToken, interval, fromDate, toDate));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/angelone/holdings", async (_req, res) => {
    try {
      res.json(await getAllHoldings());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/angelone/search", async (req, res) => {
    try {
      const { exchange = "NSE", q } = req.query;
      if (!q) return res.status(400).json({ error: "Missing param: q" });
      const raw = await searchScrip(exchange, q);
      res.json(raw);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/stocks/screener", async (_req, res) => {
    const CACHE_KEY = "screener_nse";
    const cached = cacheGet2(CACHE_KEY);
    if (cached) return res.json(cached);
    try {
      const nseSymbols = getDynamicNseSymbols().length > 0 ? getDynamicNseSymbols() : NSE_SYMBOLS.map((s) => ({ ...s, instrKey: "", isin: "" }));
      console.log(`[NSE] Using ${nseSymbols.length} symbols for screener`);
      const aoSymbols = nseSymbols.filter((s) => s.token);
      const tokenList = aoSymbols.map((s) => s.token);
      const allQuotesMap = {};
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
        } catch (e) {
          console.warn(`[NSE] AO batch ${i} failed: ${e.message}`);
        }
      }
      const results = [];
      const PROCESS_BATCH = 20;
      for (let i = 0; i < aoSymbols.length; i += PROCESS_BATCH) {
        const batch = aoSymbols.slice(i, i + PROCESS_BATCH);
        const settled = await Promise.allSettled(
          batch.map((sym) => fetchStockDataAccurate(sym, "NSE", allQuotesMap[sym.token]))
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        if (i + PROCESS_BATCH < aoSymbols.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (isUpstoxReady()) {
        const loadedSymbols = new Set(results.map((s) => s.symbol));
        const today = istDateStr();
        const from365 = istDateStr(daysAgo(120));
        const failedSyms = nseSymbols.filter((s) => !loadedSymbols.has(s.symbol));
        if (failedSyms.length > 0) {
          console.log(`[Upstox/NSE] Full fetch for ${failedSyms.length} symbols (AO failures + Upstox-only)`);
          await Promise.allSettled(failedSyms.map(async (sym) => {
            const instrKey = sym.instrKey || getNseInstrumentKey(sym.symbol);
            if (!instrKey) return;
            const stock = await fetchStockFromUpstox(sym, instrKey, "NSE");
            if (stock) results.push(stock);
          }));
        }
        const noSignals = results.filter((s) => s.signals.length === 0);
        if (noSignals.length > 0) {
          await Promise.allSettled(noSignals.map(async (stock) => {
            try {
              const dynSym = nseSymbols.find((s) => s.symbol === stock.symbol);
              const instrKey = dynSym?.instrKey || getNseInstrumentKey(stock.symbol);
              if (!instrKey) return;
              const rawCandles = await getUpstoxHistoricalCandles(instrKey, from365, today);
              const candles = parseUpstoxCandles(rawCandles);
              if (candles.length < 20) return;
              candles.push({ date: today, open: stock.open || stock.currentPrice, high: stock.high || stock.currentPrice, low: stock.low || stock.currentPrice, close: stock.currentPrice, volume: 0 });
              const { signals } = await detectPatterns(candles);
              if (signals.length > 0) {
                stock.signals = signals;
                stock.dataSource = "Upstox+AngelOne";
              }
            } catch (e) {
              console.error("[Route] silent error:", e?.message ?? e);
            }
          }));
        }
      }
      const withSignals = results.filter((s) => s.signals.length > 0);
      const payload = withSignals.length > 0 ? withSignals : results;
      cacheSet2(CACHE_KEY, payload, 5 * 60 * 1e3);
      res.json(payload);
    } catch (e) {
      console.error("[AO/NSE] Screener error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/stocks/screener/bse", async (_req, res) => {
    const CACHE_KEY = "screener_bse";
    const cached = cacheGet2(CACHE_KEY);
    if (cached) return res.json(cached);
    try {
      const dynBse = getDynamicBseSymbols();
      const staticSymbols = new Set(BSE_SYMBOLS.map((s) => s.symbol));
      const upstoxOnlyBse = dynBse.filter((s) => !staticSymbols.has(s.symbol));
      console.log(`[BSE] ${BSE_SYMBOLS.length} static + ${upstoxOnlyBse.length} Upstox-only symbols`);
      const allQuotesMap = {};
      const BATCH_SIZE = 50;
      const bseTokenList = BSE_SYMBOLS.filter((s) => s.token).map((s) => s.token);
      for (let i = 0; i < bseTokenList.length; i += BATCH_SIZE) {
        const batch = bseTokenList.slice(i, i + BATCH_SIZE);
        try {
          const quotes = await getMarketQuote({ "BSE": batch }, "FULL");
          const fetched = Object.values(quotes).flat();
          for (const q of fetched) {
            const t = q.symbolToken || q.token;
            if (t) allQuotesMap[t] = q;
          }
        } catch (e) {
          console.warn(`[BSE] BSE batch ${i} failed: ${e.message}`);
        }
      }
      if (Object.keys(allQuotesMap).length === 0) {
        console.log("[BSE] Falling back to NSE tokens for live quotes");
        const nseTokenList = BSE_SYMBOLS.filter((s) => s.nseToken).map((s) => s.nseToken);
        for (let i = 0; i < nseTokenList.length; i += BATCH_SIZE) {
          const batch = nseTokenList.slice(i, i + BATCH_SIZE);
          try {
            const quotes = await getMarketQuote({ "NSE": batch }, "FULL");
            const fetched = quotes["NSE"] || Object.values(quotes).flat();
            for (const q of fetched) {
              const t = q.symbolToken || q.token;
              if (t) allQuotesMap[t] = q;
            }
          } catch (e) {
            console.warn(`[BSE\u2192NSE] NSE fallback batch ${i} failed: ${e.message}`);
          }
        }
      }
      console.log(`[BSE] allQuotesMap: ${Object.keys(allQuotesMap).length} entries`);
      const results = [];
      const PROCESS_BATCH = 20;
      for (let i = 0; i < BSE_SYMBOLS.length; i += PROCESS_BATCH) {
        const batch = BSE_SYMBOLS.slice(i, i + PROCESS_BATCH);
        const settled = await Promise.allSettled(
          batch.map((sym) => {
            const prefetchedQuote = allQuotesMap[sym.token] ?? allQuotesMap[sym.nseToken];
            return fetchStockDataAccurate(sym, "BSE", prefetchedQuote);
          })
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        if (i + PROCESS_BATCH < BSE_SYMBOLS.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (isUpstoxReady()) {
        const loadedSymbols = new Set(results.map((s) => s.symbol));
        const today = istDateStr();
        const from365 = istDateStr(daysAgo(120));
        const failedStatic = BSE_SYMBOLS.filter((s) => !loadedSymbols.has(s.symbol));
        const upstoxFetchList = [
          ...failedStatic.map((s) => ({ symbol: s.symbol, name: s.name, token: s.token, sector: s.sector ?? "BSE", instrKey: "", isin: "" })),
          ...upstoxOnlyBse.filter((s) => !loadedSymbols.has(s.symbol))
        ];
        if (upstoxFetchList.length > 0) {
          console.log(`[Upstox/BSE] Full fetch for ${upstoxFetchList.length} symbols`);
          await Promise.allSettled(upstoxFetchList.map(async (sym) => {
            const instrKey = sym.instrKey || getNseInstrumentKey(sym.symbol);
            if (!instrKey) return;
            const stock = await fetchStockFromUpstox(sym, instrKey, "BSE");
            if (stock) results.push(stock);
          }));
        }
        const noSignals = results.filter((s) => s.signals.length === 0);
        if (noSignals.length > 0) {
          await Promise.allSettled(noSignals.map(async (stock) => {
            try {
              const dynSym = dynBse.find((s) => s.symbol === stock.symbol);
              const instrKey = dynSym?.instrKey || getNseInstrumentKey(stock.symbol);
              if (!instrKey) return;
              const rawCandles = await getUpstoxHistoricalCandles(instrKey, from365, today);
              const candles = parseUpstoxCandles(rawCandles);
              if (candles.length < 20) return;
              candles.push({ date: today, open: stock.open || stock.currentPrice, high: stock.high || stock.currentPrice, low: stock.low || stock.currentPrice, close: stock.currentPrice, volume: 0 });
              const { signals } = await detectPatterns(candles);
              if (signals.length > 0) {
                stock.signals = signals;
                stock.dataSource = "Upstox+AngelOne";
              }
            } catch (e) {
              console.error("[Route] silent error:", e?.message ?? e);
            }
          }));
        }
      }
      const withSignals = results.filter((s) => s.signals.length > 0);
      const payload = withSignals.length > 0 ? withSignals : results;
      cacheSet2(CACHE_KEY, payload, 5 * 60 * 1e3);
      res.json(payload);
    } catch (e) {
      console.error("[AO/BSE] Screener error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/stocks/dynamic", async (req, res) => {
    const { symbol, exchange = "NSE" } = req.query;
    if (!symbol) return res.status(400).json({ error: "symbol param required" });
    const sym = symbol.toUpperCase().trim();
    const exch = exchange.toUpperCase().trim() === "BSE" ? "BSE" : "NSE";
    const CACHE_KEY = `dyn_${exch}_${sym}`;
    const cached = cacheGet2(CACHE_KEY);
    if (cached) return res.json(cached);
    try {
      const scrips = await searchScrip(exch, sym);
      if (!scrips || scrips.length === 0)
        return res.status(404).json({ error: `No Angel One results for symbol: ${sym} on ${exch}` });
      const match = scrips.find(
        (s) => s.tradingsymbol?.toUpperCase() === sym || s.symbol?.toUpperCase() === sym
      ) ?? scrips[0];
      const token = match.symboltoken ?? match.token ?? match.scripToken;
      const name = match.name ?? match.companyname ?? sym;
      if (!token) {
        return res.status(404).json({ error: `symbolToken not found for ${sym} on ${exch}` });
      }
      console.log(`[AO] Dynamic fetch: ${sym} (${exch}) token=${token} name="${name}"`);
      const symInfo = { symbol: sym, name: String(name), token: String(token), sector: exch };
      const data = await fetchStockDataAccurate(symInfo, exch);
      cacheSet2(CACHE_KEY, data, 60 * 1e3);
      res.json(data);
    } catch (e) {
      console.error(`[AO] Dynamic error (${sym}/${exch}):`, e.message);
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/stocks/:symbol", async (req, res) => {
    const sym = req.params.symbol.toUpperCase();
    const exch = (req.query.exchange ?? "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE";
    const CACHE_KEY = `stock_${exch}_${sym}`;
    const cached = cacheGet2(CACHE_KEY);
    if (cached) return res.json(cached);
    try {
      let data;
      if (exch === "BSE") {
        const bseSym = BSE_SYMBOLS.find((s) => s.symbol === sym);
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
          const match = scrips.find(
            (s) => s.tradingsymbol?.toUpperCase() === sym || s.symbol?.toUpperCase() === sym
          ) ?? scrips[0];
          const token = match.symboltoken ?? match.token ?? match.scripToken;
          if (!token) return res.status(404).json({ error: `BSE token not found for ${sym}` });
          const info = { symbol: sym, name: match.name ?? match.companyname ?? sym, token: String(token), sector: "BSE" };
          data = await fetchStockDataAccurate(info, "BSE");
        }
      } else {
        const nseSym = NSE_SYMBOLS.find((s) => s.symbol === sym);
        if (nseSym) {
          data = await fetchStockDataAccurate(nseSym, "NSE");
        } else {
          const scrips = await searchScrip("NSE", sym);
          if (!scrips || scrips.length === 0)
            return res.status(404).json({ error: `Symbol ${sym} not found on NSE` });
          const match = scrips.find(
            (s) => s.tradingsymbol?.toUpperCase() === sym || s.symbol?.toUpperCase() === sym
          ) ?? scrips[0];
          const token = match.symboltoken ?? match.token ?? match.scripToken;
          if (!token) return res.status(404).json({ error: `NSE token not found for ${sym}` });
          const info = { symbol: sym, name: match.name ?? match.companyname ?? sym, token: String(token), sector: "NSE" };
          data = await fetchStockDataAccurate(info, "NSE");
        }
      }
      cacheSet2(CACHE_KEY, data, 60 * 1e3);
      res.json(data);
    } catch (e) {
      console.error(`[AO] Stock detail error (${sym}/${exch}):`, e.message);
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/alerts", async (req, res) => {
    const exch = (req.query.exchange ?? "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE";
    const CACHE_KEY = `alerts_live_${exch}`;
    const cached = cacheGet2(CACHE_KEY);
    if (cached) return res.json(cached);
    try {
      const symbols = exch === "BSE" ? BSE_SYMBOLS : NSE_SYMBOLS;
      const allQuotesMap = {};
      const BATCH_SIZE = 50;
      const tokenList = symbols.map((s) => s.token);
      for (let i = 0; i < tokenList.length; i += BATCH_SIZE) {
        const batch = tokenList.slice(i, i + BATCH_SIZE);
        try {
          const quotes = await getMarketQuote({ [exch]: batch }, "FULL");
          const fetched = quotes[exch] || Object.values(quotes).flat();
          for (const q of fetched) {
            const t = q.symbolToken || q.token;
            if (t) allQuotesMap[t] = q;
          }
        } catch (e) {
          console.warn(`[Alerts/${exch}] batch ${i} failed: ${e.message}`);
        }
      }
      if (exch === "BSE" && Object.keys(allQuotesMap).length === 0) {
        console.log("[Alerts/BSE] BSE quotes empty \u2014 falling back to NSE tokens");
        const nseTokenList = BSE_SYMBOLS.map((s) => s.nseToken).filter(Boolean);
        for (let i = 0; i < nseTokenList.length; i += BATCH_SIZE) {
          const batch = nseTokenList.slice(i, i + BATCH_SIZE);
          try {
            const quotes = await getMarketQuote({ "NSE": batch }, "FULL");
            const fetched = quotes["NSE"] || Object.values(quotes).flat();
            for (const q of fetched) {
              const t = q.symbolToken || q.token;
              if (t) allQuotesMap[t] = q;
            }
          } catch (e) {
            console.warn(`[Alerts/BSE\u2192NSE] batch ${i} failed: ${e.message}`);
          }
        }
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const alerts = [];
      for (const sym of symbols) {
        const q = allQuotesMap[sym.token] ?? (exch === "BSE" ? allQuotesMap[sym.nseToken] : void 0);
        if (!q) continue;
        const rawLtp = parseFloat(q.ltp ?? "0") || 0;
        const prevClose = parseFloat(q.close ?? q.prevClose ?? "0") || 0;
        const ltp = rawLtp > 0 ? rawLtp : prevClose;
        const open = parseFloat(q.open ?? "0") || ltp;
        const high = parseFloat(q.high ?? "0") || ltp;
        const low = parseFloat(q.low ?? "0") || ltp;
        const netChange = rawLtp > 0 ? parseFloat(q.netChange ?? "0") || 0 : 0;
        const changePct = rawLtp > 0 ? parseFloat(q.percentChange ?? "0") || 0 : 0;
        const tradeVol = parseInt(q.tradeVolume ?? q.totalTradedVolume ?? "0", 10) || 0;
        const w52h = q.fiftyTwoWeekHighPrice ? parseFloat(q.fiftyTwoWeekHighPrice) : null;
        const w52l = q.fiftyTwoWeekLowPrice ? parseFloat(q.fiftyTwoWeekLowPrice) : null;
        const uCkt = q.upperCircuit ? parseFloat(q.upperCircuit) : null;
        const lCkt = q.lowerCircuit ? parseFloat(q.lowerCircuit) : null;
        if (ltp === 0) continue;
        const dayRange = high > 0 && low > 0 ? high - low : 0;
        const gapPct = prevClose > 0 ? (open - prevClose) / prevClose * 100 : 0;
        const closePos = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
        const aboveMid = closePos > 0.6;
        const signals = [];
        if (w52h && ltp >= w52h * 0.99) {
          const atHigh = ltp >= w52h;
          const conf = atHigh ? 88 : 80;
          signals.push({
            id: `52wh_${sym.token}`,
            patternName: atHigh ? "52-Week High Breakout" : "52-Week High Resistance Test",
            type: "Bullish",
            patternCategory: "Breakout",
            timeframeClass: "Swing",
            explanation: {
              en: `${sym.symbol} is ${atHigh ? "trading at" : "within 1% of"} its 52-week high of \u20B9${w52h.toFixed(2)}, currently at \u20B9${ltp.toFixed(2)}. A sustained close above this level signals institutional accumulation and the potential start of a new leg higher. The 52-week high is one of the most reliable breakout triggers tracked by professional desks.`,
              hi: `${sym.symbol} \u0905\u092A\u0928\u0947 52-\u0938\u092A\u094D\u0924\u093E\u0939 \u0915\u0947 \u0909\u091A\u094D\u091A\u0924\u092E \u0938\u094D\u0924\u0930 \u20B9${w52h.toFixed(2)} ${atHigh ? "\u092A\u0930" : "\u0915\u0947 \u092C\u0939\u0941\u0924 \u0915\u0930\u0940\u092C"} \u0939\u0948\u0964 \u092F\u0939 \u0938\u094D\u0924\u0930 \u0938\u0902\u0938\u094D\u0925\u093E\u0917\u0924 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0914\u0930 \u092C\u094D\u0930\u0947\u0915\u0906\u0909\u091F \u0915\u093E \u092E\u091C\u092C\u0942\u0924 \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
            },
            confidenceScore: conf,
            confidenceBreakdown: `52-week high: +40 | Intraday position (close vs range): +${Math.round(closePos * 20)} | Momentum: +${conf - 40 - Math.round(closePos * 20)}`,
            timeframe: "5\u201315 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (w52h * 0.94).toFixed(2),
            target1: (ltp * 1.08).toFixed(2),
            target2: (ltp * 1.15).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Not investment advice. For educational purposes only.",
            detectedAt: now
          });
        }
        if (w52l && ltp <= w52l * 1.04 && changePct > 0 && aboveMid) {
          signals.push({
            id: `52wl_${sym.token}`,
            patternName: "52-Week Low Reversal",
            type: "Bullish",
            patternCategory: "Reversal",
            timeframeClass: "Swing",
            explanation: {
              en: `${sym.symbol} is reversing off its 52-week low of \u20B9${w52l.toFixed(2)}, currently at \u20B9${ltp.toFixed(2)} (+${changePct.toFixed(2)}% today). The stock is closing in the upper half of its day range, suggesting buying absorption at this support level. Reversals at yearly lows often mark the end of a bearish phase as smart money accumulates.`,
              hi: `${sym.symbol} \u0905\u092A\u0928\u0947 52-\u0938\u092A\u094D\u0924\u093E\u0939 \u0915\u0947 \u0928\u093F\u091A\u0932\u0947 \u0938\u094D\u0924\u0930 \u20B9${w52l.toFixed(2)} \u0938\u0947 \u0935\u093E\u092A\u0938\u0940 \u0915\u0930 \u0930\u0939\u093E \u0939\u0948\u0964 \u0906\u091C +${changePct.toFixed(2)}% \u0915\u0940 \u0924\u0947\u091C\u0940 \u0914\u0930 \u0926\u093F\u0928 \u0915\u0940 \u090A\u092A\u0930\u0940 \u0930\u0947\u0902\u091C \u092E\u0947\u0902 \u0915\u094D\u0932\u094B\u091C\u093F\u0902\u0917 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0915\u0940 \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0924\u0940 \u0939\u0948\u0964`
            },
            confidenceScore: 74,
            confidenceBreakdown: "52-week low support: +35 | Positive close: +20 | Upper-half day close: +19",
            timeframe: "7\u201321 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (w52l * 0.97).toFixed(2),
            target1: (ltp * 1.07).toFixed(2),
            target2: (ltp * 1.14).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Not investment advice. For educational purposes only.",
            detectedAt: now
          });
        }
        if (gapPct >= 1.5 && ltp >= open) {
          const conf = gapPct >= 3 ? 84 : gapPct >= 2 ? 76 : 68;
          signals.push({
            id: `gapup_${sym.token}`,
            patternName: `Gap Up \u2014 ${gapPct.toFixed(1)}% Opening`,
            type: "Bullish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} opened ${gapPct.toFixed(1)}% higher at \u20B9${open.toFixed(2)} vs yesterday's close of \u20B9${prevClose.toFixed(2)} and is holding the gap (current: \u20B9${ltp.toFixed(2)}). A gap that holds intraday confirms strong overnight demand. Unfilled gaps are a bullish structural signal \u2014 they act as support on any retest.`,
              hi: `${sym.symbol} \u0906\u091C \u20B9${prevClose.toFixed(2)} \u0938\u0947 ${gapPct.toFixed(1)}% \u090A\u092A\u0930 \u20B9${open.toFixed(2)} \u092A\u0930 \u0916\u0941\u0932\u093E \u0914\u0930 \u0917\u0948\u092A \u0939\u094B\u0932\u094D\u0921 \u0915\u0930 \u0930\u0939\u093E \u0939\u0948\u0964 \u092F\u0939 \u092E\u091C\u092C\u0942\u0924 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
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
            detectedAt: now
          });
        }
        if (gapPct <= -1.5 && ltp <= open) {
          const absPct = Math.abs(gapPct);
          const conf = absPct >= 3 ? 82 : absPct >= 2 ? 74 : 66;
          signals.push({
            id: `gapdn_${sym.token}`,
            patternName: `Gap Down \u2014 ${absPct.toFixed(1)}% Opening`,
            type: "Bearish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} opened ${absPct.toFixed(1)}% lower at \u20B9${open.toFixed(2)} vs yesterday's close of \u20B9${prevClose.toFixed(2)} and is unable to recover (current: \u20B9${ltp.toFixed(2)}). A gap down that fails to fill intraday signals sustained selling pressure. Avoid fresh longs until price reclaims the gap zone above \u20B9${open.toFixed(2)}.`,
              hi: `${sym.symbol} \u0906\u091C \u20B9${prevClose.toFixed(2)} \u0938\u0947 ${absPct.toFixed(1)}% \u0928\u0940\u091A\u0947 \u20B9${open.toFixed(2)} \u092A\u0930 \u0916\u0941\u0932\u093E \u0914\u0930 \u0917\u0948\u092A \u0928\u0939\u0940\u0902 \u092D\u0930 \u0930\u0939\u093E\u0964 \u092F\u0939 \u092C\u093F\u0915\u0935\u093E\u0932\u0940 \u0915\u093E \u0926\u092C\u093E\u0935 \u091C\u093E\u0930\u0940 \u0930\u0939\u0928\u0947 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
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
            detectedAt: now
          });
        }
        if (changePct >= 3) {
          const conf = changePct >= 5 ? 86 : changePct >= 4 ? 78 : 70;
          signals.push({
            id: `bull_mom_${sym.token}`,
            patternName: `Bullish Momentum +${changePct.toFixed(1)}%`,
            type: "Bullish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} is up ${changePct.toFixed(2)}% today (\u20B9${prevClose.toFixed(2)} \u2192 \u20B9${ltp.toFixed(2)}), showing strong real-time demand. High momentum moves often attract further volume on the breakout.`,
              hi: `${sym.symbol} \u0906\u091C ${changePct.toFixed(2)}% \u090A\u092A\u0930 \u0939\u0948\u0964 \u092F\u0939 \u092E\u091C\u092C\u0942\u0924 \u0916\u0930\u0940\u0926\u093E\u0930\u0940 \u0915\u0940 \u0917\u0924\u093F \u0915\u094B \u0926\u0930\u094D\u0936\u093E\u0924\u093E \u0939\u0948\u0964`
            },
            confidenceScore: conf,
            confidenceBreakdown: `Bullish momentum: +${Math.min(45, Math.round(changePct * 7))} | Close vs Range: +${Math.round(closePos * 15)}`,
            timeframe: "1\u20133 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (low * 0.99).toFixed(2),
            target1: (ltp * 1.04).toFixed(2),
            target2: (ltp * 1.07).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Real-time quote analysis.",
            detectedAt: now
          });
        }
        if (changePct <= -3) {
          const absPct = Math.abs(changePct);
          const conf = absPct >= 5 ? 84 : absPct >= 4 ? 76 : 68;
          signals.push({
            id: `bear_mom_${sym.token}`,
            patternName: `Bearish Momentum \u2212${absPct.toFixed(1)}%`,
            type: "Bearish",
            patternCategory: "Momentum",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} is down ${absPct.toFixed(2)}% today (\u20B9${prevClose.toFixed(2)} \u2192 \u20B9${ltp.toFixed(2)}). Sustained selling pressure in a single session indicates distribution.`,
              hi: `${sym.symbol} \u0906\u091C ${absPct.toFixed(2)}% \u0928\u0940\u091A\u0947 \u0939\u0948\u0964 \u092F\u0939 \u092C\u093F\u0915\u0935\u093E\u0932\u0940 \u0915\u0947 \u0926\u092C\u093E\u0935 \u0915\u093E \u0938\u0902\u0915\u0947\u0924 \u0939\u0948\u0964`
            },
            confidenceScore: conf,
            confidenceBreakdown: `Decline magnitude: +${Math.min(43, Math.round(absPct * 7))} | Close position: +${Math.round((1 - closePos) * 15)}`,
            timeframe: "1\u20133 trading days",
            entry: ltp.toFixed(2),
            stopLoss: (high * 1.01).toFixed(2),
            target1: (ltp * 0.96).toFixed(2),
            target2: (ltp * 0.93).toFixed(2),
            volumeConfirmed: tradeVol > 0,
            liveQuoteSource: "AngelOne-FULL",
            disclaimer: "Real-time quote analysis.",
            detectedAt: now
          });
        }
        if (uCkt && ltp >= uCkt * 0.98) {
          const atCircuit = ltp >= uCkt;
          signals.push({
            id: `uckt_${sym.token}`,
            patternName: atCircuit ? "Upper Circuit Hit" : "Upper Circuit Approach",
            type: "Bullish",
            patternCategory: "Breakout",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} ${atCircuit ? "has hit" : "is near"} its upper circuit limit (\u20B9${uCkt.toFixed(2)}). Demand completely exceeds available supply at this level.`,
              hi: `${sym.symbol} ${atCircuit ? "\u0905\u092A\u0930 \u0938\u0930\u094D\u0915\u093F\u091F \u092A\u0930 \u0939\u0948" : "\u0905\u092A\u0930 \u0938\u0930\u094D\u0915\u093F\u091F \u0915\u0947 \u092A\u093E\u0938 \u0939\u0948"} (\u20B9${uCkt.toFixed(2)})\u0964`
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
            detectedAt: now
          });
        }
        if (lCkt && ltp <= lCkt * 1.02) {
          const atCircuit = ltp <= lCkt;
          signals.push({
            id: `lckt_${sym.token}`,
            patternName: atCircuit ? "Lower Circuit Hit" : "Lower Circuit Approach",
            type: "Bearish",
            patternCategory: "Reversal",
            timeframeClass: "Intraday",
            explanation: {
              en: `${sym.symbol} ${atCircuit ? "has hit" : "is near"} its lower circuit limit (\u20B9${lCkt.toFixed(2)}). Selling pressure has exhausted all buyers at this level.`,
              hi: `${sym.symbol} ${atCircuit ? "\u0932\u094B\u0905\u0930 \u0938\u0930\u094D\u0915\u093F\u091F \u092A\u0930 \u0939\u0948" : "\u0932\u094B\u0905\u0930 \u0938\u0930\u094D\u0915\u093F\u091F \u0915\u0947 \u092A\u093E\u0938 \u0939\u0948"} (\u20B9${lCkt.toFixed(2)})\u0964`
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
            detectedAt: now
          });
        }
        if (signals.length === 0) continue;
        let volumeStr = "\u2014";
        if (tradeVol > 0) {
          if (tradeVol >= 1e7) volumeStr = `${(tradeVol / 1e7).toFixed(2)}Cr`;
          else if (tradeVol >= 1e5) volumeStr = `${(tradeVol / 1e5).toFixed(2)}L`;
          else if (tradeVol >= 1e3) volumeStr = `${(tradeVol / 1e3).toFixed(1)}K`;
          else volumeStr = String(tradeVol);
        }
        alerts.push({
          symbol: sym.symbol,
          name: sym.name,
          sector: sym.sector,
          exchange: exch,
          currentPrice: ltp,
          prevClose: prevClose || void 0,
          open,
          high,
          low,
          change: parseFloat(netChange.toFixed(2)),
          changePercent: parseFloat(changePct.toFixed(2)),
          volume: volumeStr,
          upperCircuit: uCkt,
          lowerCircuit: lCkt,
          week52High: w52h,
          week52Low: w52l,
          signals,
          isWatchlisted: false,
          lastUpdated: now
        });
      }
      if (isUpstoxReady() && exch === "NSE") {
        const loadedSymbols = new Set(alerts.map((a) => a.symbol));
        const missedSyms = NSE_SYMBOLS.filter((s) => !allQuotesMap[s.token] && !loadedSymbols.has(s.symbol));
        if (missedSyms.length > 0) {
          console.log(`[Alerts/Upstox] Gap-filling ${missedSyms.length} stocks missed by Angel One`);
          const instrKeys = missedSyms.map((s) => getNseInstrumentKey(s.symbol)).filter(Boolean);
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
                const ltp = norm.currentPrice;
                const prevClose = norm.prevClose || ltp;
                const open = norm.open || ltp;
                const high = norm.high || ltp;
                const low = norm.low || ltp;
                const changePct = norm.changePercent || 0;
                const netChange = norm.change || 0;
                const tradeVol = norm.tradeVol || 0;
                const w52h = norm.week52High || null;
                const w52l = norm.week52Low || null;
                const dayRange = high > 0 && low > 0 ? high - low : 0;
                const gapPct = prevClose > 0 ? (open - prevClose) / prevClose * 100 : 0;
                const closePos = dayRange > 0 ? (ltp - low) / dayRange : 0.5;
                const aboveMid = closePos > 0.6;
                const upSignals = [];
                if (w52h && ltp >= w52h * 0.99) {
                  const atHigh = ltp >= w52h;
                  upSignals.push({ id: `52wh_up_${sym.token}`, patternName: atHigh ? "52-Week High Breakout" : "52-Week High Resistance Test", type: "Bullish", patternCategory: "Breakout", timeframeClass: "Swing", explanation: { en: `${sym.symbol} is ${atHigh ? "at" : "within 1% of"} its 52-week high of \u20B9${w52h.toFixed(2)}, currently \u20B9${ltp.toFixed(2)}.`, hi: `${sym.symbol} 52-\u0938\u092A\u094D\u0924\u093E\u0939 \u0915\u0947 \u0909\u091A\u094D\u091A \u20B9${w52h.toFixed(2)} \u0915\u0947 \u092A\u093E\u0938 \u0939\u0948\u0964` }, confidenceScore: atHigh ? 88 : 80, confidenceBreakdown: "52-week high proximity via Upstox", timeframe: "5\u201315 trading days", entry: ltp.toFixed(2), stopLoss: (ltp * 0.94).toFixed(2), target1: (ltp * 1.08).toFixed(2), target2: (ltp * 1.15).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (w52l && ltp <= w52l * 1.04 && changePct > 0 && aboveMid) {
                  upSignals.push({ id: `52wl_up_${sym.token}`, patternName: "52-Week Low Reversal", type: "Bullish", patternCategory: "Reversal", timeframeClass: "Swing", explanation: { en: `${sym.symbol} is reversing off its 52-week low of \u20B9${w52l.toFixed(2)}, currently \u20B9${ltp.toFixed(2)} (+${changePct.toFixed(2)}%).`, hi: `${sym.symbol} 52-\u0938\u092A\u094D\u0924\u093E\u0939 \u0915\u0947 \u0928\u093F\u091A\u0932\u0947 \u0938\u094D\u0924\u0930 \u0938\u0947 \u0935\u093E\u092A\u0938\u0940 \u0915\u0930 \u0930\u0939\u093E \u0939\u0948\u0964` }, confidenceScore: 74, confidenceBreakdown: "52-week low reversal via Upstox", timeframe: "7\u201321 trading days", entry: ltp.toFixed(2), stopLoss: (ltp * 0.97).toFixed(2), target1: (ltp * 1.07).toFixed(2), target2: (ltp * 1.14).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (gapPct >= 1.5 && ltp >= open) {
                  const conf = gapPct >= 3 ? 84 : gapPct >= 2 ? 76 : 68;
                  upSignals.push({ id: `gapup_up_${sym.token}`, patternName: `Gap Up \u2014 ${gapPct.toFixed(1)}% Opening`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${gapPct.toFixed(1)}% higher at \u20B9${open.toFixed(2)} vs \u20B9${prevClose.toFixed(2)} prev close, gap holding at \u20B9${ltp.toFixed(2)}.`, hi: `${sym.symbol} ${gapPct.toFixed(1)}% \u0917\u0948\u092A-\u0905\u092A \u0915\u0947 \u0938\u093E\u0925 \u0916\u0941\u0932\u093E \u0914\u0930 \u0917\u0948\u092A \u0939\u094B\u0932\u094D\u0921 \u0915\u0930 \u0930\u0939\u093E \u0939\u0948\u0964` }, confidenceScore: conf, confidenceBreakdown: `Gap ${gapPct.toFixed(1)}% via Upstox`, timeframe: "Same day to 3 days", entry: ltp.toFixed(2), stopLoss: (open * 0.985).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.08).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (gapPct <= -1.5 && ltp <= open) {
                  const absPct = Math.abs(gapPct);
                  const conf = absPct >= 3 ? 82 : absPct >= 2 ? 74 : 66;
                  upSignals.push({ id: `gapdn_up_${sym.token}`, patternName: `Gap Down \u2014 ${absPct.toFixed(1)}% Opening`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} opened ${absPct.toFixed(1)}% lower at \u20B9${open.toFixed(2)} vs \u20B9${prevClose.toFixed(2)} prev close, not recovering.`, hi: `${sym.symbol} ${absPct.toFixed(1)}% \u0917\u0948\u092A-\u0921\u093E\u0909\u0928 \u0915\u0947 \u0938\u093E\u0925 \u0916\u0941\u0932\u093E \u0914\u0930 \u0917\u0948\u092A \u0928\u0939\u0940\u0902 \u092D\u0930 \u0930\u0939\u093E\u0964` }, confidenceScore: conf, confidenceBreakdown: `Gap-down ${absPct.toFixed(1)}% via Upstox`, timeframe: "Same day to 3 days", entry: ltp.toFixed(2), stopLoss: (open * 1.015).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.92).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (changePct >= 3) {
                  const conf = changePct >= 5 ? 86 : changePct >= 4 ? 78 : 70;
                  upSignals.push({ id: `bull_up_${sym.token}`, patternName: `Bullish Momentum +${changePct.toFixed(1)}%`, type: "Bullish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is up ${changePct.toFixed(2)}% today (\u20B9${prevClose.toFixed(2)} \u2192 \u20B9${ltp.toFixed(2)}) per Upstox.`, hi: `${sym.symbol} \u0906\u091C ${changePct.toFixed(2)}% \u090A\u092A\u0930 \u0939\u0948\u0964` }, confidenceScore: conf, confidenceBreakdown: `Momentum +${changePct.toFixed(1)}% via Upstox`, timeframe: "1\u20133 trading days", entry: ltp.toFixed(2), stopLoss: (low * 0.99).toFixed(2), target1: (ltp * 1.04).toFixed(2), target2: (ltp * 1.07).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (changePct <= -3) {
                  const absPct = Math.abs(changePct);
                  const conf = absPct >= 5 ? 84 : absPct >= 4 ? 76 : 68;
                  upSignals.push({ id: `bear_up_${sym.token}`, patternName: `Bearish Momentum \u2212${absPct.toFixed(1)}%`, type: "Bearish", patternCategory: "Momentum", timeframeClass: "Intraday", explanation: { en: `${sym.symbol} is down ${absPct.toFixed(2)}% today per Upstox.`, hi: `${sym.symbol} \u0906\u091C ${absPct.toFixed(2)}% \u0928\u0940\u091A\u0947 \u0939\u0948\u0964` }, confidenceScore: conf, confidenceBreakdown: `Decline ${absPct.toFixed(1)}% via Upstox`, timeframe: "1\u20133 trading days", entry: ltp.toFixed(2), stopLoss: (high * 1.01).toFixed(2), target1: (ltp * 0.96).toFixed(2), target2: (ltp * 0.93).toFixed(2), volumeConfirmed: tradeVol > 0, liveQuoteSource: "Upstox", disclaimer: "Not investment advice.", detectedAt: now });
                }
                if (upSignals.length === 0) continue;
                let volumeStr = "\u2014";
                if (tradeVol > 0) {
                  if (tradeVol >= 1e7) volumeStr = `${(tradeVol / 1e7).toFixed(2)}Cr`;
                  else if (tradeVol >= 1e5) volumeStr = `${(tradeVol / 1e5).toFixed(2)}L`;
                  else if (tradeVol >= 1e3) volumeStr = `${(tradeVol / 1e3).toFixed(1)}K`;
                  else volumeStr = String(tradeVol);
                }
                alerts.push({
                  symbol: sym.symbol,
                  name: sym.name,
                  sector: sym.sector,
                  exchange: "NSE",
                  currentPrice: ltp,
                  prevClose,
                  open,
                  high,
                  low,
                  change: parseFloat(netChange.toFixed(2)),
                  changePercent: parseFloat(changePct.toFixed(2)),
                  volume: volumeStr,
                  upperCircuit: null,
                  lowerCircuit: null,
                  week52High: w52h,
                  week52Low: w52l,
                  signals: upSignals,
                  isWatchlisted: false,
                  lastUpdated: now,
                  dataSource: "Upstox"
                });
              }
            } catch (e) {
              console.warn(`[Alerts/Upstox] Gap-fill failed: ${e.message}`);
            }
          }
        }
      }
      alerts.sort((a, b) => {
        const aMax = Math.max(...a.signals.map((s) => s.confidenceScore));
        const bMax = Math.max(...b.signals.map((s) => s.confidenceScore));
        return bMax - aMax;
      });
      console.log(`[Alerts/${exch}] ${alerts.length} stocks with signals from ${Object.keys(allQuotesMap).length} quotes fetched`);
      cacheSet2(CACHE_KEY, alerts, 60 * 1e3);
      res.json(alerts);
    } catch (e) {
      console.error("[Alerts] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
  app2.post("/api/gemini/explain", async (req, res) => {
    try {
      const { patternName, stockSymbol, direction, confidenceScore, timeframeClass } = req.body;
      if (!patternName || !stockSymbol || !direction)
        return res.status(400).json({ error: "Missing required fields" });
      const result = await explainPattern({ patternName, stockSymbol, direction, confidenceScore: confidenceScore ?? 70, timeframeClass: timeframeClass ?? "Swing" });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.post("/api/gemini/market-summary", async (req, res) => {
    try {
      const { totalBull, totalBear, topPatterns } = req.body;
      const summary = await generateMarketSummary({ totalBull: totalBull ?? 0, totalBear: totalBear ?? 0, topPatterns: topPatterns ?? [] });
      res.json({ summary });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.post("/api/gemini/analyze", async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Missing payload" });
      }
      const markdown = await generateFullAnalysis(req.body);
      res.json({ markdown });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.post("/api/chat", async (req, res) => {
    try {
      const { messages, query } = req.body;
      if (!query?.trim()) {
        return res.status(400).json({ error: "query is required" });
      }
      const pineconeMatches = await queryKnowledgeBase(query, 4, 0.35);
      const fullMessages = [
        ...messages ?? [],
        { role: "user", content: query }
      ];
      const answer = await generateChatAnswer(fullMessages, pineconeMatches);
      res.json({
        answer,
        sources: pineconeMatches.map((m) => ({
          text: m.text.slice(0, 200) + (m.text.length > 200 ? "\u2026" : ""),
          source: m.source,
          score: Math.round(m.score * 100)
        })),
        fromKnowledgeBase: pineconeMatches.length > 0
      });
    } catch (e) {
      console.error("[Chat] error:", e.message);
      res.status(500).json({ error: e.message ?? "Chat error" });
    }
  });
  app2.post("/api/chat/stream", async (req, res) => {
    try {
      const { messages, query } = req.body;
      if (!query?.trim()) return res.status(400).json({ error: "query is required" });
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      const pineconeMatches = await queryKnowledgeBase(query, 3, 0.3);
      const fullMessages = [...messages ?? [], { role: "user", content: query }];
      res.write(`data: ${JSON.stringify({
        type: "meta",
        fromKnowledgeBase: pineconeMatches.length > 0,
        sources: pineconeMatches.map((m) => ({
          text: m.text.slice(0, 200) + (m.text.length > 200 ? "\u2026" : ""),
          source: m.source,
          score: Math.round(m.score * 100)
        }))
      })}

`);
      await streamChatAnswer(fullMessages, pineconeMatches, (text2) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", text: text2 })}

`);
      });
      res.write(`data: ${JSON.stringify({ type: "done" })}

`);
      res.end();
    } catch (e) {
      console.error("[Chat/Stream] error:", e.message);
      res.write(`data: ${JSON.stringify({ type: "error", error: e.message })}

`);
      res.end();
    }
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    // 20 MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === "application/pdf") cb(null, true);
      else cb(new Error("Only PDF files are accepted"));
    }
  });
  app2.post("/api/chat/upload", upload.single("pdf"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No PDF file provided" });
      if (!isPineconeReady()) {
        return res.status(503).json({ error: "Pinecone is not configured. Add PINECONE_API_KEY and PINECONE_INDEX to .env" });
      }
      const result = await ingestPdfBuffer(req.file.buffer, req.file.originalname);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app2.get("/api/chat/status", (_req, res) => {
    res.json({
      pineconeReady: isPineconeReady(),
      index: process.env.PINECONE_INDEX ?? null
    });
  });
  initDynamicSymbols(NSE_SYMBOLS, BSE_SYMBOLS).catch(
    (e) => console.warn("[Upstox] initDynamicSymbols failed:", e?.message ?? e)
  );
  setTimeout(async () => {
    try {
      console.log("[PreWarm] Starting NSE screener cache warm-up...");
      await fetch(`http://localhost:${process.env.PORT ?? 5e3}/api/stocks/screener`).catch((e) => console.warn("[PreWarm] NSE fetch failed:", e.message));
      console.log("[PreWarm] NSE done.");
    } catch (e) {
      console.error("[Route] silent error:", e?.message ?? e);
    }
  }, 2e3);
  setTimeout(async () => {
    try {
      console.log("[PreWarm] Starting BSE screener cache warm-up...");
      await fetch(`http://localhost:${process.env.PORT ?? 5e3}/api/stocks/screener/bse`).catch((e) => console.warn("[PreWarm] BSE fetch failed:", e.message));
      console.log("[PreWarm] BSE done.");
    } catch (e) {
      console.error("[Route] silent error:", e?.message ?? e);
    }
  }, 2e4);
  return httpServer2;
}

// server/db/profileStore.ts
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

// server/db/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  profileUsers: () => profileUsers
});
import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
var profileUsers = pgTable("profile_users", {
  loginId: serial("login_id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

// server/db/db.ts
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
var pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10
});
var db = drizzle(pool, { schema: schema_exports });

// server/db/profileStore.ts
var SALT_ROUNDS = 10;
function toProfileUser(row) {
  return {
    loginId: row.loginId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function getUserById(id) {
  const rows = await db.select().from(profileUsers).where(eq(profileUsers.loginId, id)).limit(1);
  return rows[0] ? toProfileUser(rows[0]) : void 0;
}
async function getUserByEmail(email) {
  const rows = await db.select().from(profileUsers).where(eq(profileUsers.email, email.trim().toLowerCase())).limit(1);
  return rows[0];
}
async function createUser(data) {
  const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
  const rows = await db.insert(profileUsers).values({
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    phone: data.phone.trim(),
    password: hashed
  }).returning();
  return toProfileUser(rows[0]);
}
async function verifyPassword(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}
async function updateUser(id, data) {
  const updates = {};
  if (data.name) updates.name = data.name.trim();
  if (data.email) updates.email = data.email.trim().toLowerCase();
  if (data.phone) updates.phone = data.phone.trim();
  if (data.password) updates.password = await bcrypt.hash(data.password, SALT_ROUNDS);
  if (Object.keys(updates).length === 0) return null;
  const rows = await db.update(profileUsers).set(updates).where(eq(profileUsers.loginId, id)).returning();
  return rows[0] ? toProfileUser(rows[0]) : null;
}

// server/api/auth.ts
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function registerAuthRoutes(app2) {
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const { name, phone, password } = req.body;
      const email = req.body.email?.trim().toLowerCase();
      if (!name?.trim()) return res.status(400).json({ error: "Full name is required" });
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email address" });
      if (!phone?.trim()) return res.status(400).json({ error: "Phone number is required" });
      if (phone.replace(/\D/g, "").length < 10)
        return res.status(400).json({ error: "Phone must be at least 10 digits" });
      if (!password || password.length < 6)
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      const existing = await getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "An account with this email already exists" });
      const user = await createUser({ name, email, phone, password });
      req.session.loginId = user.loginId;
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Session error. Please try again." });
        res.json(user);
      });
    } catch (e) {
      console.error("[Auth] register error:", e.message);
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const { password } = req.body;
      const email = req.body.email?.trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!password?.trim()) return res.status(400).json({ error: "Password is required" });
      const row = await getUserByEmail(email);
      if (!row) return res.status(401).json({ error: "No account found with this email" });
      const ok = await verifyPassword(password, row.password);
      if (!ok) return res.status(401).json({ error: "Incorrect password" });
      req.session.loginId = row.loginId;
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Session error. Please try again." });
        res.json({
          loginId: row.loginId,
          name: row.name,
          email: row.email,
          phone: row.phone,
          createdAt: row.createdAt.toISOString()
        });
      });
    } catch (e) {
      console.error("[Auth] login error:", e.message);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });
  app2.get("/api/auth/me", async (req, res) => {
    try {
      const id = req.session.loginId;
      if (!id) return res.status(401).json({ error: "Not authenticated" });
      const user = await getUserById(id);
      if (!user) return res.status(401).json({ error: "Session expired" });
      res.json(user);
    } catch (e) {
      res.status(500).json({ error: "Server error" });
    }
  });
  app2.put("/api/auth/profile", async (req, res) => {
    try {
      const id = req.session.loginId;
      if (!id) return res.status(401).json({ error: "Not authenticated" });
      const { name, phone, newPassword } = req.body;
      const email = req.body.email?.trim().toLowerCase();
      if (!name?.trim()) return res.status(400).json({ error: "Full name is required" });
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!phone?.trim()) return res.status(400).json({ error: "Phone is required" });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email address" });
      if (newPassword && newPassword.length < 6)
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      const updated = await updateUser(id, {
        name,
        email,
        phone,
        ...newPassword ? { password: newPassword } : {}
      });
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json(updated);
    } catch (e) {
      console.error("[Auth] profile update error:", e.message);
      res.status(500).json({ error: "Update failed. Please try again." });
    }
  });
}

// api/index.ts
var app = express();
var httpServer = createServer(app);
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
var PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: "session",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET ?? "alphasignal-dev-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1e3,
    httpOnly: true,
    secure: true,
    sameSite: "none"
  }
}));
var initPromise = null;
function ensureReady() {
  if (!initPromise) {
    initPromise = (async () => {
      registerAuthRoutes(app);
      await registerRoutes(httpServer, app);
      app.use((req, res) => {
        if (req.path.startsWith("/api")) {
          res.status(404).json({ message: "API endpoint not found" });
        } else {
          res.status(404).send("Not Found");
        }
      });
      app.use((err, _req, res, next) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        if (res.headersSent) return next(err);
        res.status(status).json({ message });
      });
    })();
  }
  return initPromise;
}
ensureReady().catch(console.error);
var index_default = app;
export {
  index_default as default
};
