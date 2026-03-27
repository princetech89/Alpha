/**
 * BSE Symbol → Angel One symbolToken mapping
 * ===========================================
 * BSE tokens for the Sensex 30 + selected large-caps.
 * Tokens sourced from Angel One's OpenAPIScripMaster (exchange=BSE).
 *
 * For BSE, Angel One uses the BSE scrip code (6-digit) as the symboltoken.
 * The tradingSymbol format on BSE is e.g. "HDFCBANK" or "RELIANCE" etc.
 */
export const BSE_SYMBOLS: Array<{
  symbol: string;
  name: string;
  token: string;      // BSE scrip code
  nseToken: string;   // Corresponding NSE token (for historical data fallback)
  sector: string;
}> = [
  // ── Banking ──────────────────────────────────────────────────────────────
  { symbol: "HDFCBANK",   name: "HDFC Bank Ltd.",            token: "500180", nseToken: "1333",  sector: "Banking" },
  { symbol: "ICICIBANK",  name: "ICICI Bank Ltd.",            token: "532174", nseToken: "4963",  sector: "Banking" },
  { symbol: "SBIN",       name: "State Bank of India",        token: "500112", nseToken: "3045",  sector: "Banking" },
  { symbol: "KOTAKBANK",  name: "Kotak Mahindra Bank",        token: "500247", nseToken: "1922",  sector: "Banking" },
  { symbol: "AXISBANK",   name: "Axis Bank Ltd.",             token: "532215", nseToken: "5900",  sector: "Banking" },
  { symbol: "INDUSINDBK", name: "IndusInd Bank Ltd.",         token: "532187", nseToken: "5258",  sector: "Banking" },
  { symbol: "BANDHANBNK", name: "Bandhan Bank Ltd.",          token: "541153", nseToken: "2263",  sector: "Banking" },

  // ── IT ────────────────────────────────────────────────────────────────────
  { symbol: "TCS",        name: "Tata Consultancy Services",  token: "532540", nseToken: "11536", sector: "IT" },
  { symbol: "INFY",       name: "Infosys Ltd.",               token: "500209", nseToken: "1594",  sector: "IT" },
  { symbol: "WIPRO",      name: "Wipro Ltd.",                 token: "507685", nseToken: "3787",  sector: "IT" },
  { symbol: "HCLTECH",    name: "HCL Technologies",           token: "532281", nseToken: "7229",  sector: "IT" },
  { symbol: "TECHM",      name: "Tech Mahindra Ltd.",         token: "532755", nseToken: "13538", sector: "IT" },
  { symbol: "MPHASIS",    name: "Mphasis Ltd.",               token: "526299", nseToken: "4503",  sector: "IT" },

  // ── Energy & Oil ──────────────────────────────────────────────────────────
  { symbol: "RELIANCE",   name: "Reliance Industries",        token: "500325", nseToken: "2885",  sector: "Energy" },
  { symbol: "ONGC",       name: "ONGC Ltd.",                  token: "500312", nseToken: "2475",  sector: "Energy" },
  { symbol: "BPCL",       name: "BPCL Ltd.",                  token: "500547", nseToken: "526",   sector: "Energy" },
  { symbol: "IOC",        name: "Indian Oil Corporation",     token: "530965", nseToken: "1624",  sector: "Energy" },
  { symbol: "NTPC",       name: "NTPC Ltd.",                  token: "532555", nseToken: "11630", sector: "Power" },
  { symbol: "POWERGRID",  name: "Power Grid Corporation",     token: "532898", nseToken: "14977", sector: "Power" },
  { symbol: "COALINDIA",  name: "Coal India Ltd.",            token: "533278", nseToken: "20374", sector: "Mining" },
  { symbol: "ADANIGREEN", name: "Adani Green Energy",         token: "541450", nseToken: "25278", sector: "Power" },

  // ── FMCG ──────────────────────────────────────────────────────────────────
  { symbol: "ITC",        name: "ITC Ltd.",                   token: "500875", nseToken: "1660",  sector: "FMCG" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever",         token: "500696", nseToken: "1394",  sector: "FMCG" },
  { symbol: "NESTLEIND",  name: "Nestle India Ltd.",          token: "500790", nseToken: "17963", sector: "FMCG" },
  { symbol: "BRITANNIA",  name: "Britannia Industries",       token: "500825", nseToken: "547",   sector: "FMCG" },
  { symbol: "DABUR",      name: "Dabur India Ltd.",           token: "500096", nseToken: "772",   sector: "FMCG" },
  { symbol: "MARICO",     name: "Marico Ltd.",                token: "531642", nseToken: "4067",  sector: "FMCG" },

  // ── Telecom ───────────────────────────────────────────────────────────────
  { symbol: "BHARTIARTL", name: "Bharti Airtel Ltd.",         token: "532454", nseToken: "10604", sector: "Telecom" },

  // ── Finance ───────────────────────────────────────────────────────────────
  { symbol: "BAJFINANCE", name: "Bajaj Finance Ltd.",         token: "500034", nseToken: "317",   sector: "Finance" },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv Ltd.",         token: "532978", nseToken: "16675", sector: "Finance" },
  { symbol: "HDFCLIFE",   name: "HDFC Life Insurance",        token: "540777", nseToken: "467",   sector: "Insurance" },
  { symbol: "SBILIFE",    name: "SBI Life Insurance",         token: "540719", nseToken: "21808", sector: "Insurance" },
  { symbol: "CHOLAFIN",   name: "Cholamandalam Finance",      token: "500081", nseToken: "685",   sector: "Finance" },

  // ── Auto ──────────────────────────────────────────────────────────────────
  { symbol: "MARUTI",     name: "Maruti Suzuki India",        token: "532500", nseToken: "10999", sector: "Auto" },
  { symbol: "TATAMOTORS", name: "Tata Motors Ltd.",           token: "500570", nseToken: "3456",  sector: "Auto" },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp Ltd.",         token: "500182", nseToken: "1348",  sector: "Auto" },
  { symbol: "EICHERMOT",  name: "Eicher Motors Ltd.",         token: "505200", nseToken: "910",   sector: "Auto" },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto Ltd.",            token: "532977", nseToken: "16669", sector: "Auto" },
  { symbol: "M&M",        name: "Mahindra & Mahindra",        token: "500520", nseToken: "2031",  sector: "Auto" },

  // ── Pharma ────────────────────────────────────────────────────────────────
  { symbol: "SUNPHARMA",  name: "Sun Pharmaceutical",         token: "524715", nseToken: "3351",  sector: "Pharma" },
  { symbol: "DRREDDY",    name: "Dr. Reddy's Laboratories",   token: "500124", nseToken: "881",   sector: "Pharma" },
  { symbol: "CIPLA",      name: "Cipla Ltd.",                 token: "500087", nseToken: "694",   sector: "Pharma" },
  { symbol: "DIVISLAB",   name: "Divi's Laboratories",        token: "532488", nseToken: "10940", sector: "Pharma" },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma Ltd.",      token: "524804", nseToken: "275",   sector: "Pharma" },
  { symbol: "TORNTPHARM", name: "Torrent Pharmaceuticals",    token: "500420", nseToken: "3518",  sector: "Pharma" },

  // ── Metals & Materials ────────────────────────────────────────────────────
  { symbol: "HINDALCO",   name: "Hindalco Industries Ltd.",   token: "500440", nseToken: "1363",  sector: "Metals" },
  { symbol: "JSWSTEEL",   name: "JSW Steel Ltd.",             token: "500228", nseToken: "11723", sector: "Metals" },
  { symbol: "TATASTEEL",  name: "Tata Steel Ltd.",            token: "500470", nseToken: "3499",  sector: "Metals" },
  { symbol: "VEDL",       name: "Vedanta Ltd.",               token: "500295", nseToken: "3063",  sector: "Metals" },
  { symbol: "GRASIM",     name: "Grasim Industries Ltd.",     token: "500300", nseToken: "1232",  sector: "Cement" },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement Ltd.",      token: "532538", nseToken: "11532", sector: "Cement" },
  { symbol: "AMBUJACEMENT",name:"Ambuja Cements Ltd.",        token: "500425", nseToken: "1270",  sector: "Cement" },

  // ── Consumer & Retail ─────────────────────────────────────────────────────
  { symbol: "ASIANPAINT", name: "Asian Paints Ltd.",          token: "500820", nseToken: "236",   sector: "Consumer" },
  { symbol: "TITAN",      name: "Titan Company Ltd.",         token: "500114", nseToken: "3506",  sector: "Consumer" },
  { symbol: "TATACONSUM", name: "Tata Consumer Products",     token: "500800", nseToken: "3432",  sector: "FMCG" },
  { symbol: "GODREJCP",   name: "Godrej Consumer Products",   token: "532424", nseToken: "10099", sector: "FMCG" },

  // ── Infra & Conglomerates ─────────────────────────────────────────────────
  { symbol: "LT",         name: "Larsen & Toubro Ltd.",       token: "500510", nseToken: "11483", sector: "Infra" },
  { symbol: "ADANIPORTS", name: "Adani Ports & SEZ",          token: "532921", nseToken: "15083", sector: "Infra" },
  { symbol: "ADANIENT",   name: "Adani Enterprises",          token: "512599", nseToken: "25",    sector: "Conglomerate" },
  { symbol: "SIEMENS",    name: "Siemens Ltd.",               token: "500550", nseToken: "3280",  sector: "Infra" },

  // ── Healthcare ────────────────────────────────────────────────────────────
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals",           token: "508869", nseToken: "157",   sector: "Healthcare" },

  // ── Others ────────────────────────────────────────────────────────────────
  { symbol: "UPL",        name: "UPL Ltd.",                   token: "512070", nseToken: "11287", sector: "Agri" },
  { symbol: "PIDILITIND", name: "Pidilite Industries",        token: "500331", nseToken: "2664",  sector: "Chemicals" },
  { symbol: "BERGEPAINT", name: "Berger Paints India",        token: "509480", nseToken: "404",   sector: "Consumer" },
  { symbol: "HAVELLS",    name: "Havells India Ltd.",         token: "517354", nseToken: "9819",  sector: "Consumer" },
  { symbol: "DMART",      name: "Avenue Supermarts (DMart)",  token: "540376", nseToken: "11522", sector: "Retail" },
  { symbol: "TRENT",      name: "Trent Ltd.",                 token: "500251", nseToken: "3513",  sector: "Retail" },
];
