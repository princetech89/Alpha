/**
 * Upstox API Integration (V2 quotes + V3 historical candles)
 * ===========================================================
 * Auth: OAuth2 Authorization Code Flow
 *   1. User visits GET /api/upstox/auth  → redirected to Upstox login
 *   2. Upstox redirects back to GET /api/upstox/callback?code=XXX
 *   3. Server exchanges code for access_token, stored in memory
 *   4. Token is valid for 1 trading day; re-auth next day via same flow
 *
 * Instrument key format: "NSE_EQ|{ISIN}" or "BSE_EQ|{ISIN}"
 * e.g. "NSE_EQ|INE002A01018" (Reliance)
 *
 * V3 Historical Candles (launched April 17, 2025; V2 deprecated June 30, 2025):
 *   GET /v3/historical-candle/{instrument_key}/{unit}/{interval}/{to_date}/{from_date}
 */

const CLIENT_ID       = process.env.UPSTOX_CLIENT_ID       ?? "";
const CLIENT_SECRET   = process.env.UPSTOX_CLIENT_SECRET   ?? "";
const REDIRECT_URI    = process.env.UPSTOX_REDIRECT_URI    ?? "http://localhost:5000/upstox-callback";
const ANALYTICS_TOKEN = process.env.UPSTOX_ANALYTICS_TOKEN ?? "";
const BASE_V2         = "https://api.upstox.com/v2";
const BASE_V3         = "https://api.upstox.com/v3";

// ── ISIN map: NSE symbol → Upstox instrument key ──────────────────────────────
// Format used by Upstox: "NSE_EQ|{ISIN}"
export const NSE_ISIN_MAP: Record<string, string> = {
  // Banking
  HDFCBANK:    "NSE_EQ|INE040A01034",
  ICICIBANK:   "NSE_EQ|INE090A01021",
  SBIN:        "NSE_EQ|INE062A01020",
  KOTAKBANK:   "NSE_EQ|INE237A01028",
  AXISBANK:    "NSE_EQ|INE238A01034",
  INDUSINDBK:  "NSE_EQ|INE095A01012",
  BANDHANBNK:  "NSE_EQ|INE545U01014",
  BANKBARODA:  "NSE_EQ|INE028A01039",
  PNB:         "NSE_EQ|INE160A01022",
  CANBK:       "NSE_EQ|INE476A01022",
  FEDERALBNK:  "NSE_EQ|INE171A01029",
  IDFCFIRSTB:  "NSE_EQ|INE092T01019",
  RBLBANK:     "NSE_EQ|INE976G01028",

  // IT
  TCS:         "NSE_EQ|INE467B01029",
  INFY:        "NSE_EQ|INE009A01021",
  WIPRO:       "NSE_EQ|INE075A01022",
  HCLTECH:     "NSE_EQ|INE860A01027",
  TECHM:       "NSE_EQ|INE669C01036",
  MPHASIS:     "NSE_EQ|INE356A01018",
  LTI:         "NSE_EQ|INE214T01019",
  PERSISTENT:  "NSE_EQ|INE262H01021",
  COFORGE:     "NSE_EQ|INE350H01014",
  OFSS:        "NSE_EQ|INE881D01027",
  KPITTECH:    "NSE_EQ|INE04I401011",

  // Energy & Oil
  RELIANCE:    "NSE_EQ|INE002A01018",
  ONGC:        "NSE_EQ|INE213A01029",
  BPCL:        "NSE_EQ|INE029A01011",
  IOC:         "NSE_EQ|INE242A01010",
  NTPC:        "NSE_EQ|INE733E01010",
  POWERGRID:   "NSE_EQ|INE752E01010",
  COALINDIA:   "NSE_EQ|INE522F01014",
  ADANIGREEN:  "NSE_EQ|INE364U01010",

  // FMCG
  ITC:         "NSE_EQ|INE154A01025",
  HINDUNILVR:  "NSE_EQ|INE030A01027",
  NESTLEIND:   "NSE_EQ|INE239A01024",
  BRITANNIA:   "NSE_EQ|INE216A01030",
  DABUR:       "NSE_EQ|INE016A01026",
  MARICO:      "NSE_EQ|INE196A01026",

  // Telecom
  BHARTIARTL:  "NSE_EQ|INE397D01024",

  // Finance
  BAJFINANCE:  "NSE_EQ|INE296A01024",
  BAJAJFINSV:  "NSE_EQ|INE918I01026",
  HDFCLIFE:    "NSE_EQ|INE795G01014",
  SBILIFE:     "NSE_EQ|INE123W01016",
  CHOLAFIN:    "NSE_EQ|INE121A01024",
  POLICYBZR:   "NSE_EQ|INE417T01026",
  PAYTM:       "NSE_EQ|INE982J01020",

  // Auto
  MARUTI:      "NSE_EQ|INE585B01010",
  TATAMOTORS:  "NSE_EQ|INE155A01022",
  HEROMOTOCO:  "NSE_EQ|INE158A01026",
  EICHERMOT:   "NSE_EQ|INE066A01021",
  "BAJAJ-AUTO":"NSE_EQ|INE917I01010",
  "M&M":       "NSE_EQ|INE101A01026",

  // Pharma
  SUNPHARMA:   "NSE_EQ|INE044A01036",
  DRREDDY:     "NSE_EQ|INE089A01023",
  CIPLA:       "NSE_EQ|INE059A01026",
  DIVISLAB:    "NSE_EQ|INE361B01024",
  AUROPHARMA:  "NSE_EQ|INE406A01037",
  TORNTPHARM:  "NSE_EQ|INE685A01028",
  LUPIN:       "NSE_EQ|INE326A01037",
  ALKEM:       "NSE_EQ|INE540L01014",
  IPCALAB:     "NSE_EQ|INE571A01020",
  GLENMARK:    "NSE_EQ|INE935A01035",

  // Metals & Materials
  HINDALCO:    "NSE_EQ|INE038A01020",
  JSWSTEEL:    "NSE_EQ|INE019A01038",
  TATASTEEL:   "NSE_EQ|INE081A01012",
  VEDL:        "NSE_EQ|INE205A01025",
  GRASIM:      "NSE_EQ|INE047A01021",
  ULTRACEMCO:  "NSE_EQ|INE481G01011",
  AMBUJACEMENT:"NSE_EQ|INE079A01024",

  // Consumer & Retail
  ASIANPAINT:  "NSE_EQ|INE021A01026",
  TITAN:       "NSE_EQ|INE280A01028",
  TATACONSUM:  "NSE_EQ|INE192A01025",
  GODREJCP:    "NSE_EQ|INE102D01028",
  BERGEPAINT:  "NSE_EQ|INE463A01038",
  HAVELLS:     "NSE_EQ|INE176B01034",
  DIXON:       "NSE_EQ|INE935N01020",
  DMART:       "NSE_EQ|INE192R01011",
  TRENT:       "NSE_EQ|INE849A01020",
  ZOMATO:      "NSE_EQ|INE758T01015",
  NYKAA:       "NSE_EQ|INE388Y01014",

  // Infra & Conglomerates
  LT:          "NSE_EQ|INE018A01030",
  ADANIPORTS:  "NSE_EQ|INE742F01042",
  ADANIENT:    "NSE_EQ|INE423A01024",
  SIEMENS:     "NSE_EQ|INE003A01024",
  ABB:         "NSE_EQ|INE117A01022",

  // Healthcare
  APOLLOHOSP:  "NSE_EQ|INE437A01024",
  MAXHEALTH:   "NSE_EQ|INE027H01010",

  // Chemicals
  UPL:         "NSE_EQ|INE628A01036",
  PIDILITIND:  "NSE_EQ|INE318A01026",
  AARTI:       "NSE_EQ|INE769A01020",
  DEEPAKNTR:   "NSE_EQ|INE196B01031",
  NAVINFLUOR:  "NSE_EQ|INE048G01026",
  SRF:         "NSE_EQ|INE647A01010",
  TATACHEM:    "NSE_EQ|INE110A01019",

  // PSU / Defence
  HAL:         "NSE_EQ|INE066F01012",
  BEL:         "NSE_EQ|INE263A01024",
  BHEL:        "NSE_EQ|INE257A01026",
  GAIL:        "NSE_EQ|INE129A01019",
  NMDC:        "NSE_EQ|INE584A01023",
  SAIL:        "NSE_EQ|INE114A01011",
  IRCTC:       "NSE_EQ|INE335Y01020",
  RVNL:        "NSE_EQ|INE415G01027",
  COCHINSHIP:  "NSE_EQ|INE704P01017",
  DRDO:        "NSE_EQ|INE737H01014",
};

/** Returns the Upstox instrument key for an NSE symbol, or null if not mapped. */
export function getNseInstrumentKey(symbol: string): string | null {
  return NSE_ISIN_MAP[symbol] ?? null;
}

// ── Dynamic instrument master (full NSE + BSE universe) ───────────────────────
export interface DynamicSymbol {
  symbol:    string;
  name:      string;
  token:     string;    // Angel One token ("" for Upstox-only)
  sector:    string;
  instrKey:  string;    // Upstox instrument key "NSE_EQ|{ISIN}" or "BSE_EQ|{ISIN}"
  isin:      string;
}

let _dynamicNse: DynamicSymbol[] = [];
let _dynamicBse: DynamicSymbol[] = [];
let _masterLoaded = false;

export function getDynamicNseSymbols(): DynamicSymbol[] { return _dynamicNse; }
export function getDynamicBseSymbols(): DynamicSymbol[] { return _dynamicBse; }
export function isMasterLoaded(): boolean { return _masterLoaded; }

/**
 * Download the full instrument master from Upstox's public asset URL.
 * Returns all equity (EQ) instruments for the given exchange.
 * URL: https://assets.upstox.com/market-quote/instruments/exchange/{exchange}.json.gz
 * No authentication required — this is a public static file.
 */
async function downloadInstrumentMaster(exchange: "NSE" | "BSE"): Promise<DynamicSymbol[]> {
  const url = `https://assets.upstox.com/market-quote/instruments/exchange/${exchange}.json.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${exchange} master (${res.status})`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const decompressed = await gunzipAsync(buffer);
  const raw: any[] = JSON.parse(decompressed.toString("utf-8"));
  const equity = raw.filter((i: any) => i.instrument_type === "EQ" && i.tradingsymbol && i.isin);

  return equity.map((i: any) => ({
    symbol:   (i.tradingsymbol as string).toUpperCase(),
    name:     i.name ?? i.tradingsymbol,
    token:    "",          // AO token unknown for dynamic stocks
    sector:   "Various",
    instrKey: i.instrument_key ?? `${exchange}_EQ|${i.isin}`,
    isin:     i.isin,
  }));
}

/**
 * Initialize dynamic symbol lists from Upstox instrument master.
 * Called once at server startup. Merges with static symbols to preserve
 * known Angel One tokens and sector information.
 */
export async function initDynamicSymbols(
  staticNse: Array<{ symbol: string; name: string; token: string; sector: string }>,
  staticBse: Array<{ symbol: string; name: string; token: string; sector: string; nseToken?: string }>
): Promise<void> {
  try {
    console.log("[Upstox] Downloading NSE instrument master...");
    const [nseRaw, bseRaw] = await Promise.allSettled([
      downloadInstrumentMaster("NSE"),
      downloadInstrumentMaster("BSE"),
    ]);

    const staticNseMap  = new Map(staticNse.map(s => [s.symbol, s]));
    const staticBseMap  = new Map(staticBse.map(s => [s.symbol, s]));
    const nseIsinMap: Record<string, string> = {};

    if (nseRaw.status === "fulfilled") {
      const dynamic = nseRaw.value;
      // Update NSE_ISIN_MAP in memory for all dynamic symbols
      for (const d of dynamic) nseIsinMap[d.symbol] = d.instrKey;

      // Merge: static stocks keep their AO tokens + sector; new stocks are Upstox-only
      const merged = new Map<string, DynamicSymbol>();
      for (const s of staticNse) {
        merged.set(s.symbol, {
          symbol:   s.symbol,
          name:     s.name,
          token:    s.token,
          sector:   s.sector,
          instrKey: NSE_ISIN_MAP[s.symbol] ?? nseIsinMap[s.symbol] ?? "",
          isin:     (NSE_ISIN_MAP[s.symbol] ?? "").replace("NSE_EQ|", ""),
        });
      }
      for (const d of dynamic) {
        if (!merged.has(d.symbol)) merged.set(d.symbol, d);
      }
      _dynamicNse = Array.from(merged.values()).filter(s => s.instrKey);
      console.log(`[Upstox] NSE master loaded: ${_dynamicNse.length} equity stocks`);
    } else {
      console.warn("[Upstox] NSE master download failed:", nseRaw.reason?.message);
      _dynamicNse = staticNse.map(s => ({
        ...s,
        instrKey: NSE_ISIN_MAP[s.symbol] ?? "",
        isin:     (NSE_ISIN_MAP[s.symbol] ?? "").replace("NSE_EQ|", ""),
      }));
    }

    if (bseRaw.status === "fulfilled") {
      const dynamic = bseRaw.value;
      const merged = new Map<string, DynamicSymbol>();
      for (const s of staticBse) {
        merged.set(s.symbol, {
          symbol:   s.symbol,
          name:     s.name,
          token:    s.token,
          sector:   s.sector,
          instrKey: `BSE_EQ|${(s as any).isin ?? ""}`,
          isin:     (s as any).isin ?? "",
        });
      }
      for (const d of dynamic) {
        if (!merged.has(d.symbol)) merged.set(d.symbol, d);
      }
      _dynamicBse = Array.from(merged.values()).filter(s => s.instrKey && s.instrKey !== "BSE_EQ|");
      console.log(`[Upstox] BSE master loaded: ${_dynamicBse.length} equity stocks`);
    } else {
      console.warn("[Upstox] BSE master download failed:", bseRaw.reason?.message);
      _dynamicBse = staticBse.map(s => ({
        ...s,
        instrKey: getNseInstrumentKey(s.symbol)?.replace("NSE_EQ|", "BSE_EQ|") ?? "",
        isin:     "",
      }));
    }

    _masterLoaded = true;
  } catch (e: any) {
    console.error("[Upstox] initDynamicSymbols failed:", e.message);
  }
}

// ── Persistent token store (survives server restarts) ─────────────────────────
import fs from "fs";
import path from "path";
import { gunzip } from "zlib";
import { promisify } from "util";

const gunzipAsync = promisify(gunzip);

const TOKEN_FILE = path.resolve(process.cwd(), ".upstox-token.json");

let _accessToken: string | null = null;
let _tokenExpiry: number        = 0;

// Load token from disk on startup
(function loadTokenFromDisk() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
      if (raw.token && raw.expiry && Date.now() < raw.expiry) {
        _accessToken = raw.token;
        _tokenExpiry = raw.expiry;
        console.log("[Upstox] Token restored from disk. Valid until", new Date(raw.expiry).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), "IST");
      } else {
        console.log("[Upstox] Saved token expired — re-auth required.");
      }
    }
  } catch (e) {
    console.warn("[Upstox] Could not load saved token:", e);
  }
})();

export function isUpstoxReady(): boolean {
  if (_accessToken && Date.now() < _tokenExpiry) return true;
  return !!ANALYTICS_TOKEN; // analytics token is always valid
}

export function setAccessToken(token: string): void {
  _accessToken = token;
  // Upstox tokens expire at midnight IST — use 23h to be safe
  _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  // Persist to disk so restarts don't require re-auth
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, expiry: _tokenExpiry }), "utf8");
    console.log("[Upstox] Token saved to disk. Valid until", new Date(_tokenExpiry).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), "IST");
  } catch (e) {
    console.warn("[Upstox] Could not save token to disk:", e);
  }
}

export function getAccessToken(): string | null {
  return _accessToken ?? (ANALYTICS_TOKEN || null);
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────
export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: "code",
  });
  return `https://api.upstox.com/v2/login/authorization/dialog?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    "authorization_code",
  });

  const res = await fetch(`${BASE_V2}/login/authorization/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstox token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json() as any;
  const token = data.access_token;
  if (!token) throw new Error("No access_token in Upstox response");

  setAccessToken(token);
  return token;
}

// ── Authenticated request helpers ─────────────────────────────────────────────
async function upstoxGet(baseUrl: string, path: string, params?: Record<string, string>): Promise<any> {
  if (!isUpstoxReady()) throw new Error("Upstox not authenticated. Visit /api/upstox/auth to login.");

  // Use OAuth token if valid, else fall back to analytics token
  const token = (_accessToken && Date.now() < _tokenExpiry) ? _accessToken : ANALYTICS_TOKEN;

  const url = new URL(`${baseUrl}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept":        "application/json",
    },
  });

  if (res.status === 401) {
    _accessToken = null;
    throw new Error("Upstox token expired. Visit /api/upstox/auth to re-login.");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstox API error (${res.status}): ${text}`);
  }

  return res.json();
}

function v2Get(path: string, params?: Record<string, string>) { return upstoxGet(BASE_V2, path, params); }
function v3Get(path: string, params?: Record<string, string>) { return upstoxGet(BASE_V3, path, params); }

// ── Market Quotes (V2) ────────────────────────────────────────────────────────
/**
 * Fetch live FULL quotes for up to 500 instrument keys.
 * instrumentKeys: array of "NSE_EQ|{ISIN}" or "BSE_EQ|{ISIN}"
 * Returns map: { "NSE_EQ|INE002A01018": { last_price, ohlc, volume, ... } }
 */
export async function getUpstoxQuotes(
  instrumentKeys: string[]
): Promise<Record<string, any>> {
  if (instrumentKeys.length === 0) return {};

  const BATCH = 200;
  const result: Record<string, any> = {};

  for (let i = 0; i < instrumentKeys.length; i += BATCH) {
    const batch        = instrumentKeys.slice(i, i + BATCH);
    const instrument_key = batch.join(",");
    try {
      const data = await v2Get("/market-quote/quotes", { instrument_key });
      if (data?.data) Object.assign(result, data.data);
    } catch (e: any) {
      console.warn(`[Upstox] Quote batch ${i}–${i + BATCH} failed: ${e.message}`);
    }
  }

  return result;
}

/**
 * Fetch OHLC for a large batch. Faster for screener use.
 * Returns same structure as getUpstoxQuotes but with less detail.
 */
export async function getUpstoxOHLC(
  instrumentKeys: string[]
): Promise<Record<string, any>> {
  if (instrumentKeys.length === 0) return {};

  const BATCH = 500;
  const result: Record<string, any> = {};

  for (let i = 0; i < instrumentKeys.length; i += BATCH) {
    const batch        = instrumentKeys.slice(i, i + BATCH);
    const instrument_key = batch.join(",");
    try {
      const data = await v2Get("/market-quote/ohlc", { instrument_key, interval: "1d" });
      if (data?.data) Object.assign(result, data.data);
    } catch (e: any) {
      console.warn(`[Upstox] OHLC batch ${i}–${i + BATCH} failed: ${e.message}`);
    }
  }

  return result;
}

// ── Historical Candles (V3) ───────────────────────────────────────────────────
/**
 * Fetch historical daily candles using the V3 API.
 * V3 format: GET /v3/historical-candle/{instrument_key}/{unit}/{interval}/{to_date}/{from_date}
 * Returns raw Upstox candle arrays: [timestamp, open, high, low, close, volume, oi]
 */
export async function getUpstoxHistoricalCandles(
  instrumentKey: string,  // e.g. "NSE_EQ|INE002A01018"
  fromDate: string,       // "YYYY-MM-DD"
  toDate:   string        // "YYYY-MM-DD"
): Promise<any[][]> {
  const encoded = encodeURIComponent(instrumentKey);
  try {
    // V3: unit="days", interval="1" for daily candles
    const data = await v3Get(`/historical-candle/${encoded}/days/1/${toDate}/${fromDate}`);
    return (data?.data?.candles ?? []) as any[][];
  } catch (e: any) {
    console.warn(`[Upstox] V3 historical candles for ${instrumentKey} failed: ${e.message}`);
    return [];
  }
}

// ── Normalize Upstox quote → our Stock shape ──────────────────────────────────
/**
 * Convert a single Upstox quote object to our internal stock format.
 */
export function normalizeUpstoxQuote(
  instrumentKey: string,
  quote: any,
  meta: { symbol: string; name: string; sector: string }
): {
  symbol: string; name: string; sector: string; exchange: string;
  currentPrice: number; prevClose: number; open: number;
  high: number; low: number; change: number; changePercent: number;
  volume: string; week52High: number | null; week52Low: number | null;
  ltp: number; tradeVol: number;
} | null {
  const ltp       = quote.last_price ?? 0;
  const ohlc      = quote.ohlc ?? {};
  const prevClose = ohlc.close ?? 0;
  const open      = ohlc.open  ?? ltp;
  const high      = ohlc.high  ?? ltp;
  const low       = ohlc.low   ?? ltp;
  const tradeVol  = quote.volume ?? quote.total_buy_quantity ?? 0;

  if (ltp === 0) return null;

  const netChange = ltp - prevClose;
  const changePct = prevClose > 0 ? (netChange / prevClose) * 100 : 0;

  const w52h = quote["52_week_high"] ?? quote.upper_circuit_limit ?? null;
  const w52l = quote["52_week_low"]  ?? quote.lower_circuit_limit ?? null;

  let volumeStr = "—";
  if (tradeVol >= 10_000_000)   volumeStr = `${(tradeVol / 10_000_000).toFixed(2)}Cr`;
  else if (tradeVol >= 100_000) volumeStr = `${(tradeVol / 100_000).toFixed(2)}L`;
  else if (tradeVol >= 1_000)   volumeStr = `${(tradeVol / 1_000).toFixed(1)}K`;
  else if (tradeVol > 0)        volumeStr = String(tradeVol);

  const exch = instrumentKey.startsWith("BSE") ? "BSE" : "NSE";

  return {
    symbol:        meta.symbol,
    name:          meta.name,
    sector:        meta.sector,
    exchange:      exch,
    currentPrice:  ltp,
    prevClose,
    open, high, low,
    change:        parseFloat(netChange.toFixed(2)),
    changePercent: parseFloat(changePct.toFixed(2)),
    volume:        volumeStr,
    week52High:    w52h,
    week52Low:     w52l,
    ltp,
    tradeVol,
  };
}

// ── Parse Upstox V3 historical candles → our Candle format ────────────────────
/**
 * Upstox V3 candle: [timestamp_str, open, high, low, close, volume, oi]
 * Our candle:       { date, open, high, low, close, volume }
 */
export function parseUpstoxCandles(
  raw: any[][]
): Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(c => {
      if (!Array.isArray(c) || c.length < 6) return null;
      const date = String(c[0]).split("T")[0]; // "2024-03-15T09:15:00+05:30" → "2024-03-15"
      return {
        date,
        open:   Number(c[1]),
        high:   Number(c[2]),
        low:    Number(c[3]),
        close:  Number(c[4]),
        volume: Number(c[5]),
      };
    })
    .filter(Boolean)
    .reverse() as any[]; // Upstox returns newest first → oldest first
}
