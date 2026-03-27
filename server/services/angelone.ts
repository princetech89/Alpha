/**
 * Angel One SmartAPI - Secure Server-Side Service
 * ================================================
 * All credentials are loaded from environment variables.
 * This file NEVER runs in the browser. It is server-side only.
 *
 * Angel One API Docs: https://smartapi.angelbroking.com/docs
 *
 * ACCURACY NOTE:
 * We use the /market/v1/quote/ FULL mode for live quotes because it returns
 * the actual previousClose, netChange, percentChange, tradeVolume etc.
 * which perfectly matches what Angel One's own app displays.
 * The older getLtpData endpoint only returns ltp+ohlc without previousClose.
 */

import "dotenv/config";
import { TOTP } from "otpauth";

// ── Credentials (from .env, never hard-coded) ──────────────────────────────
const API_KEY      = process.env.ANGEL_API_KEY!;
const CLIENT_ID    = process.env.ANGEL_CLIENT_ID!;
const PASSWORD     = process.env.ANGEL_PASSWORD!;
const TOTP_SECRET  = process.env.ANGEL_TOTP_SECRET!;

const BASE_URL = "https://apiconnect.angelbroking.com";

interface SessionData {
  jwtToken: string;
  refreshToken: string;
  feedToken: string;
  expiresAt: number; // unix ms
}

let cachedSession: SessionData | null = null;

// ── Helper: generate live TOTP from secret ─────────────────────────────────
function generateTOTP(): string {
  const totp = new TOTP({
    secret: TOTP_SECRET,
    digits: 6,
    algorithm: "SHA1",
    period: 30,
  });
  return totp.generate();
}

// ── Helper: common request headers ─────────────────────────────────────────
function buildHeaders(jwtToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type":     "application/json",
    Accept:             "application/json",
    "X-UserType":       "USER",
    "X-SourceID":       "WEB",
    "X-ClientLocalIP":  "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress":     "00:00:00:00:00:00",
    "X-PrivateKey":     API_KEY,
  };
  if (jwtToken) headers["Authorization"] = `Bearer ${jwtToken}`;
  return headers;
}

// ── Helper: raw POST fetch wrapper ──────────────────────────────────────────
async function angelPost(
  path: string,
  body: Record<string, unknown>,
  jwtToken?: string
): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(jwtToken),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error(`[AO] Failed to parse JSON from ${url}. Status: ${res.status}. Body:`, text.slice(0, 200));
    // Only clear session on auth errors (401), NOT on rate-limit 403s
    const isRateLimit = text.includes("exceeding access rate") || text.includes("rate limit");
    if (res.status === 401 || (res.status === 403 && !isRateLimit)) cachedSession = null;
    if (isRateLimit) throw new Error("RATE_LIMIT");
    throw new Error(`Invalid JSON response from Angel One (${res.status})`);
  }

  if (!data.status) {
    const msg = String(data.message || "").toLowerCase();
    // Common session expiry / invalid token errors
    if (msg.includes("invalid token") || msg.includes("expired") || data.errorCode === "AG8001") {
      console.warn("[AO] Session invalid (detected from error), clearing cache.");
      cachedSession = null;
    }
    throw new Error(data.message || "Angel One API error");
  }
  return data.data;
}

// ── Helper: raw GET fetch wrapper ───────────────────────────────────────────
async function angelGet(
  path: string,
  jwtToken: string
): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(jwtToken),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error(`[AO] Failed to parse JSON from ${url}. Status: ${res.status}. Body:`, text.slice(0, 200));
    const isRateLimit = text.includes("exceeding access rate") || text.includes("rate limit");
    if (res.status === 401 || (res.status === 403 && !isRateLimit)) cachedSession = null;
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

// ── generateSession ─────────────────────────────────────────────────────────
let sessionPromise: Promise<SessionData> | null = null;

export async function generateSession(): Promise<SessionData> {
  // 1. Return cached session if valid
  if (cachedSession && (cachedSession.expiresAt - Date.now() > 5 * 60 * 1000)) {
    return cachedSession;
  }

  // 2. If a login is already in progress, wait for it
  if (sessionPromise) return sessionPromise;

  // 3. Start a new login
  sessionPromise = (async () => {
    try {
      const totp = generateTOTP();
      const data = await angelPost("/rest/auth/angelbroking/user/v1/loginByPassword", {
        clientcode: CLIENT_ID,
        password: PASSWORD,
        totp,
      });

      cachedSession = {
        jwtToken: data.jwtToken,
        refreshToken: data.refreshToken,
        feedToken: data.feedToken,
        // Angel One JWTs expire in 24 hours; cache for 23 h
        expiresAt: Date.now() + 23 * 60 * 60 * 1000,
      };
      return cachedSession;
    } finally {
      sessionPromise = null;
    }
  })();

  return sessionPromise;
}

// ── getProfile ──────────────────────────────────────────────────────────────
export async function getProfile(): Promise<any> {
  const { jwtToken } = await generateSession();
  return angelGet(
    "/rest/secure/angelbroking/user/v1/getProfile",
    jwtToken
  );
}

// ── getMarketQuote (FULL mode) ───────────────────────────────────────────────
// This is the ACCURATE live quote endpoint used by Angel One's own app.
// Returns: ltp, open, high, low, close (=prevClose), netChange, percentChange,
//          tradeVolume, upperCircuit, lowerCircuit, 52wHigh, 52wLow, etc.
//
// exchangeTokens format:
//   { "NSE": ["3045", "1333"], "BSE": ["500325", "532540"] }
export async function getMarketQuote(
  exchangeTokens: Record<string, string[]>,  // { "NSE": [...tokens] }
  mode: "LTP" | "OHLC" | "FULL" = "FULL"
): Promise<Record<string, any[]>> {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/market/v1/quote",
    { mode, exchangeTokens },
    jwtToken
  );
  // Response shape: { fetched: [...], unfetched: [...] }
  // We return the fetched array keyed by exchange
  const result: Record<string, any[]> = {};
  const fetched: any[] = (data as any)?.fetched ?? [];
  for (const item of fetched) {
    const exch = item.exchType || item.exchange || "NSE";
    if (!result[exch]) result[exch] = [];
    result[exch].push(item);
  }
  return result;
}

// ── getMarketQuoteSingle — convenience wrapper for one symbol ───────────────
export async function getMarketQuoteSingle(
  exchange: string,
  symbolToken: string
): Promise<any | null> {
  try {
    const map = await getMarketQuote({ [exchange]: [symbolToken] }, "FULL");
    const arr = map[exchange] ?? Object.values(map).flat();
    return arr[0] ?? null;
  } catch (err: any) {
    console.warn(`[AO] getMarketQuoteSingle(${exchange}:${symbolToken}) failed:`, err.message);
    return null;
  }
}

// ── getLTP (legacy — kept for backward compatibility) ───────────────────────
export async function getLTP(
  exchange: string,
  tradingSymbol: string,
  symbolToken: string
): Promise<any> {
  const { jwtToken } = await generateSession();
  return angelPost(
    "/rest/secure/angelbroking/order/v1/getLtpData",
    { exchange, tradingsymbol: tradingSymbol, symboltoken: symbolToken },
    jwtToken
  );
}

// ── getHistoricalData ───────────────────────────────────────────────────────
export async function getHistoricalData(
  exchange: string,
  symbolToken: string,
  interval: string, // "ONE_MINUTE" | "ONE_HOUR" | "ONE_DAY" etc.
  fromDate: string, // "YYYY-MM-DD HH:mm"
  toDate: string
): Promise<any[]> {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/historical/v1/getCandleData",
    {
      exchange,
      symboltoken: symbolToken,
      interval,
      fromdate: fromDate,
      todate: toDate,
    },
    jwtToken
  );
  return data as any[];
}

// ── getAllHoldings ──────────────────────────────────────────────────────────
export async function getAllHoldings(): Promise<any[]> {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/portfolio/v1/getAllHolding",
    {},
    jwtToken
  );
  return (data as any).holdings ?? [];
}

// ── searchScrip ─────────────────────────────────────────────────────────────
export async function searchScrip(
  exchange: string,
  searchScripStr: string
): Promise<any[]> {
  const { jwtToken } = await generateSession();
  const data = await angelPost(
    "/rest/secure/angelbroking/order/v1/searchScrip",
    { exchange, searchscrip: searchScripStr },
    jwtToken
  );
  return (data as any).scrips ?? [];
}
