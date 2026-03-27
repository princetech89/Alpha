/**
 * Dashboard — Chart Pattern Intelligence
 * All data is live from Angel One SmartAPI via the Express backend.
 * Zero mock data. Fully real-time. Supports NSE and BSE.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLayout } from "@/components/Layout";
import { fetchStocks, fetchBSEStocks, searchStock } from "@/lib/api";
import type { Stock, Signal, Exchange } from "@/lib/api";
import { useLivePrices } from "@/hooks/useLivePrices";
import { Card, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, Clock, ArrowRight, Activity,
  Filter, Search, AlertCircle, RefreshCw, Wifi, WifiOff,
  Zap, BarChart2, ChevronUp, ChevronDown, Loader2, Globe,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function fmtIST(d: Date, opts?: Intl.DateTimeFormatOptions) {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

// ── Category colours ───────────────────────────────────────────────────────────
const CATEGORY_COLOR: Record<string, string> = {
  Breakout:             "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  Reversal:             "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  Momentum:             "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  Candlestick:          "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  Divergence:           "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  "Support/Resistance": "bg-teal-500/15 text-teal-700 dark:text-teal-400",
};

const TIMEFRAME_LABEL: Record<string, string> = {
  Intraday:   "Intraday",
  Swing:      "Swing",
  Positional: "Positional",
};


// ── Confidence bar ─────────────────────────────────────────────────────────────
function ConfBar({ score }: { score: number }) {
  const colour = score >= 80 ? "bg-green-500" : score >= 65 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden min-w-0">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono font-bold tabular-nums flex-shrink-0 w-5 text-right">{score}</span>
    </div>
  );
}


// ── Market Pulse card ─────────────────────────────────────────────────────────
function PulseCard({ stock, signal, livePrice }: { stock: Stock; signal: Signal; livePrice?: any }) {
  const isBull    = signal.type === "Bullish";
  const price     = livePrice?.price       ?? stock.currentPrice;
  const changePct = livePrice?.changePercent ?? stock.changePercent;
  const change    = livePrice?.change      ?? stock.change;
  const flashClass = livePrice?.flash === "up" ? "price-flash-up" : livePrice?.flash === "down" ? "price-flash-down" : "";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -4, scale: 1.02 }}
      className="h-full"
    >
      <Link
        href={`/stock/${stock.symbol}?exchange=${stock.exchange ?? "NSE"}`}
        className="block group h-full"
      >
      <div
        className="rounded-xl border p-3 cursor-pointer transition-all duration-200
          hover:shadow-lg hover:-translate-y-0.5 bg-card border-l-4 h-full
          overflow-hidden flex flex-col gap-2"
        style={{ borderLeftColor: isBull ? "hsl(142.1, 76.2%, 36.3%)" : "hsl(0, 84.2%, 60.2%)" }}
      >
        {/* Symbol + price row */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="font-black text-base group-hover:text-primary transition-colors tracking-tight truncate">
                {stock.symbol}
              </div>
              <span className={`text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0 ${
                stock.exchange === "BSE"
                  ? "bg-orange-500/15 text-orange-600"
                  : "bg-blue-500/15 text-blue-600"
              }`}>
                {stock.exchange ?? "NSE"}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground truncate leading-tight">{stock.name}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`font-mono font-bold text-sm leading-tight inline-block px-1 ${flashClass}`}>
              ₹{price >= 10000 ? price.toFixed(0) : price.toFixed(1)}
            </div>
            <div className={`text-[10px] font-semibold flex items-center justify-end gap-0.5 ${change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
              {change >= 0 ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
              {Math.abs(changePct).toFixed(2)}%
            </div>
            {stock.prevClose && (
              <div className="text-[9px] text-muted-foreground">
                PC: ₹{stock.prevClose.toFixed(1)}
              </div>
            )}
          </div>
        </div>

        {/* Pattern tags */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full truncate max-w-full ${CATEGORY_COLOR[signal.patternCategory] ?? ""}`}>
            {signal.patternCategory}
          </span>
        </div>

        {/* Pattern name */}
        <div className="font-semibold text-xs truncate">{signal.patternName}</div>

        {/* Confidence bar */}
        <ConfBar score={signal.confidenceScore} />

        {/* Success rate */}
        {signal.successRate > 0 && (
          <div className="text-[9px] text-muted-foreground flex items-center gap-1">
            <span className={`font-bold ${signal.successRate >= 65 ? "text-green-600 dark:text-green-400" : "text-amber-500"}`}>
              {signal.successRate}% success
            </span>
            <span>· {signal.historicalOccurrences} occurrences</span>
          </div>
        )}

        {/* AI explanation preview */}
        {signal.explanation?.en && (
          <div className="text-[9px] text-muted-foreground/80 leading-tight line-clamp-2 italic">
            {signal.explanation.en}
          </div>
        )}

        {/* Badges row */}
        <div className="flex items-center justify-between gap-1">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${isBull ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-red-500/10 text-red-600"}`}>
            {isBull ? "▲ Bull" : "▼ Bear"}
          </span>
          <span className="text-[9px] text-muted-foreground truncate text-right">
            {TIMEFRAME_LABEL[signal.timeframeClass]}
          </span>
        </div>

        {/* Time */}
        <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-auto">
          <Clock className="h-2.5 w-2.5 flex-shrink-0" />
          <span className="truncate">
            {stock.exchFeedTime || (fmtIST(new Date(signal.detectedAt), { hour: "2-digit", minute: "2-digit", hour12: true }) + " IST")}
          </span>
        </div>
      </div>
      </Link>
    </motion.div>
  );
}

// ── Stock screener card ────────────────────────────────────────────────────────
function ScreenerCard({ stock, livePrice }: { stock: Stock; livePrice?: any }) {
  const price      = livePrice?.price        ?? stock.currentPrice;
  const change     = livePrice?.change       ?? stock.change;
  const changePct  = livePrice?.changePercent ?? stock.changePercent;
  const high       = livePrice?.high         ?? stock.high;
  const low        = livePrice?.low          ?? stock.low;
  const changePos  = change >= 0;
  const flashClass = livePrice?.flash === "up" ? "price-flash-up" : livePrice?.flash === "down" ? "price-flash-down" : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
    >
      <Card className="bg-card hover:shadow-2xl transition-all duration-300 group border-border/80 overflow-hidden rounded-2xl">
      <CardContent className="p-0">
        {/* Price header */}
        <div className="p-3 border-b flex justify-between items-center gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="font-black text-base group-hover:text-primary transition-colors tracking-tight truncate">{stock.symbol}</div>
              <span className={`text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0 ${
                stock.exchange === "BSE"
                  ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                  : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
              }`}>
                {stock.exchange ?? "NSE"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate">{stock.name}</div>
            <div className="text-[10px] text-muted-foreground/70 truncate">{stock.sector}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`font-mono font-bold text-sm inline-block px-1 ${flashClass}`}>
              ₹{price >= 10000 ? price.toFixed(0) : price.toFixed(2)}
            </div>
            <div className={`text-xs font-semibold flex items-center justify-end ${changePos ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
              {changePos ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {Math.abs(changePct).toFixed(2)}%
              <span className="text-[10px] text-muted-foreground ml-1 font-normal">
                ({changePos ? "+" : ""}{change.toFixed(1)})
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              H ₹{high?.toFixed(0)} · L ₹{low?.toFixed(0)}
            </div>
            {stock.prevClose && (
              <div className="text-[10px] text-muted-foreground/70">
                Prev: ₹{stock.prevClose.toFixed(1)}
              </div>
            )}
          </div>
        </div>

        {/* Signals */}
        <div className="p-3 space-y-2 min-h-[80px]">
          {stock.signals.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center pt-3 opacity-60">No pattern detected today</p>
          ) : stock.signals.slice(0, 2).map(s => (
            <div key={s.id} className="flex items-start justify-between gap-2 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-xs truncate">{s.patternName}</div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${CATEGORY_COLOR[s.patternCategory] ?? ""}`}>
                    {s.patternCategory}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{s.timeframeClass}</span>
                  {s.volumeConfirmed && (
                    <span className="text-[9px] text-blue-500 font-semibold">Vol✓</span>
                  )}
                  {s.riskReward && (
                    <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">R:R {s.riskReward}</span>
                  )}
                  {s.successRate > 0 && (
                    <span className={`text-[9px] font-bold ${s.successRate >= 65 ? "text-green-600 dark:text-green-400" : "text-amber-500"}`}>
                      {s.successRate}% win
                    </span>
                  )}
                </div>
                {s.explanation?.en && (
                  <div className="text-[9px] text-muted-foreground/70 leading-tight line-clamp-1 italic mt-0.5">
                    {s.explanation.en}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0">
                <Badge
                  variant="outline"
                  className={`text-[9px] h-4 px-1.5 border-transparent ${s.type === "Bullish" ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-red-500/15 text-red-600"}`}
                >
                  {s.type === "Bullish" ? "▲" : "▼"} {s.confidenceScore}
                </Badge>
              </div>
            </div>
          ))}
          {stock.signals.length > 2 && (
            <div className="text-[10px] text-muted-foreground text-center">
              +{stock.signals.length - 2} more signal{stock.signals.length - 2 > 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t flex justify-between items-center gap-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-muted-foreground truncate">Vol: {stock.volume}</span>
            {stock.exchFeedTime && (
              <span className="text-[8px] text-muted-foreground truncate">
                {stock.exchFeedTime}
              </span>
            )}
          </div>
          <Button asChild variant="ghost" size="sm" className="text-xs h-7 text-primary hover:bg-primary/10 flex-shrink-0">
            <Link href={`/stock/${stock.symbol}?exchange=${stock.exchange ?? "NSE"}`}>
              Analyze <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
      </Card>
    </motion.div>
  );
}

// ── DASHBOARD PAGE ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { exchange, setRefresh, setIsFetching, setLastUpdated } = useLayout();

  // Live price stream — real-time updates every 4 seconds
  const { prices: livePrices } = useLivePrices(exchange as "NSE" | "BSE");

  const [search, setSearch]             = useState("");
  const [filterCategory, setCategory]   = useState("All");
  const [filterTF, setFilterTF]         = useState("All");
  const [filterDir, setFilterDir]       = useState("All");
  const [minConf, setMinConf]           = useState("0");
  const [filterSector, setFilterSector] = useState("All");

  // NSE query
  const nseQuery = useQuery({
    queryKey: ["stocks", "NSE"],
    queryFn: fetchStocks,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
    enabled: exchange === "NSE",
  });

  // BSE query
  const bseQuery = useQuery({
    queryKey: ["stocks", "BSE"],
    queryFn: fetchBSEStocks,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
    enabled: exchange === "BSE",
  });

  const activeQuery = exchange === "BSE" ? bseQuery : nseQuery;
  const { data: stocks = [], isLoading, error, refetch, isFetching, dataUpdatedAt } = activeQuery;

  // Reset filters when exchange changes
  useEffect(() => {
    setSearch("");
    setCategory("All");
    setFilterTF("All");
    setFilterDir("All");
    setMinConf("0");
    setFilterSector("All");
  }, [exchange]);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const allSignals = useMemo(() =>
    stocks.flatMap(s => s.signals.map(sig => ({ stock: s, signal: sig }))),
    [stocks]
  );

  const bullCount = allSignals.filter(x => x.signal.type === "Bullish").length;
  const bearCount = allSignals.filter(x => x.signal.type === "Bearish").length;
  const avgConf   = allSignals.length
    ? Math.round(allSignals.reduce((s, x) => s + x.signal.confidenceScore, 0) / allSignals.length)
    : 0;

  const topSignals = useMemo(() =>
    [...allSignals]
      .sort((a, b) => b.signal.confidenceScore - a.signal.confidenceScore)
      .slice(0, 6),
    [allSignals]
  );

  const sectors = useMemo(() => ["All", ...Array.from(new Set(stocks.map(s => s.sector))).sort()], [stocks]);

  // ── Filtered screener ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const minC = parseInt(minConf, 10) || 0;
    return stocks.filter(stock => {
      const matchSearch = stock.symbol.toLowerCase().includes(search.toLowerCase()) ||
        stock.name.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (filterSector !== "All" && stock.sector !== filterSector) return false;
      const sigs = stock.signals.filter(s => {
        if (filterCategory !== "All" && s.patternCategory !== filterCategory) return false;
        if (filterTF !== "All" && s.timeframeClass !== filterTF) return false;
        if (filterDir !== "All" && s.type !== filterDir) return false;
        if (s.confidenceScore < minC) return false;
        return true;
      });
      return sigs.length > 0 || (minC === 0 && filterCategory === "All" && filterTF === "All" && filterDir === "All");
    });
  }, [stocks, search, filterSector, filterCategory, filterTF, filterDir, minConf]);

  const lastUpdated = dataUpdatedAt
    ? fmtIST(new Date(dataUpdatedAt), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })
    : null;

  // Sync with Layout header
  useEffect(() => {
    setRefresh(() => refetch);
    setIsFetching(isFetching);
    setLastUpdated(lastUpdated);
    // Cleanup on unmount
    return () => {
      setRefresh(null);
      setIsFetching(false);
      setLastUpdated(null);
    };
  }, [refetch, isFetching, lastUpdated, setRefresh, setIsFetching, setLastUpdated]);

  return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6 overflow-x-hidden">


        {/* ── LIVE SCANNER ────────────────────────────────────────────────────── */}

        {/* ── ERROR ──────────────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 p-4 rounded-xl flex items-center gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Failed to fetch live {exchange} data from Angel One.</p>
              <p className="text-sm mt-0.5 opacity-80 truncate">{(error as Error)?.message}</p>
              <button className="text-sm underline mt-0.5" onClick={() => refetch()}>Retry now</button>
            </div>
          </div>
        )}

        {/* ── LOADING HINT ────────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground text-sm bg-card/50 border border-dashed rounded-xl">
            <RefreshCw className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
            <span>Scanning {exchange} symbols…</span>
          </div>
        )}

        {/* ── STATS BAR ──────────────────────────────────────────────────────── */}
        {!isLoading && stocks.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: "Patterns Detected",
                value: allSignals.length,
                icon: <Activity className="h-5 w-5 text-primary" />,
                sub: `across ${stocks.length} ${exchange} stocks`,
                bg: "bg-primary/5",
              },
              {
                label: "Bullish Setups",
                value: bullCount,
                icon: <TrendingUp className="h-5 w-5 text-green-500" />,
                sub: "active today",
                valueClass: "text-green-600 dark:text-green-400",
                bg: "bg-green-500/5",
              },
              {
                label: "Bearish Setups",
                value: bearCount,
                icon: <TrendingDown className="h-5 w-5 text-red-500" />,
                sub: "active today",
                valueClass: "text-red-500",
                bg: "bg-red-500/5",
              },
              {
                label: "Avg Confidence",
                value: `${avgConf}/100`,
                icon: <Zap className="h-5 w-5 text-amber-500" />,
                sub: "composite score",
                bg: "bg-amber-500/5",
              },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ scale: 1.02 }}
              >
                <Card className={`bg-card shadow-sm border-none ring-1 ring-border/50 overflow-hidden ${stat.bg}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-2">
                      {stat.icon}
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground truncate">{stat.label}</span>
                    </div>
                    <div className={`text-3xl font-black ${(stat as any).valueClass ?? ""}`}>{stat.value}</div>
                    <div className="text-[11px] font-medium text-muted-foreground/80 mt-1">{stat.sub}</div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* ── MARKET PULSE — TOP SIGNALS ─────────────────────────────────────── */}
        <div>
          <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground mb-4">
            <Zap className="h-4 w-4 text-amber-500" />
            Highest Confidence {exchange} Signals
          </h2>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
            </div>
          ) : topSignals.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm border border-dashed rounded-xl bg-card/50">
              <BarChart2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
              No high-confidence patterns detected right now.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {topSignals.map(({ stock, signal }, i) => (
                <PulseCard key={`pulse-${i}`} stock={stock} signal={signal} livePrice={livePrices[stock.symbol]} />
              ))}
            </div>
          )}
        </div>

        {/* ── LIVE SIGNAL SCREENER ──────────────────────────────────────────── */}
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {/* Search */}
              <div className="relative col-span-2 sm:col-span-2 lg:col-span-2">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search symbol or name…"
                  className="pl-8 h-9 text-sm bg-background"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              {/* Sector filter */}
              <Select value={filterSector} onValueChange={setFilterSector}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="Sector" />
                </SelectTrigger>
                <SelectContent className="max-h-64 overflow-y-auto">
                  {sectors.map(s => (
                    <SelectItem key={s} value={s}>{s === "All" ? "All Sectors" : s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterCategory} onValueChange={setCategory}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Categories</SelectItem>
                  <SelectItem value="Breakout">📈 Breakout</SelectItem>
                  <SelectItem value="Reversal">🔄 Reversal</SelectItem>
                  <SelectItem value="Momentum">⚡ Momentum</SelectItem>
                  <SelectItem value="Candlestick">🕯️ Candlestick</SelectItem>
                  <SelectItem value="Divergence">↕ Divergence</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterTF} onValueChange={setFilterTF}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="Timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Timeframes</SelectItem>
                  <SelectItem value="Intraday">Intraday</SelectItem>
                  <SelectItem value="Swing">Swing (3–10D)</SelectItem>
                  <SelectItem value="Positional">Positional (3–6W)</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterDir} onValueChange={setFilterDir}>
                <SelectTrigger className="h-9 text-xs bg-background">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Signals</SelectItem>
                  <SelectItem value="Bullish">▲ Bullish Only</SelectItem>
                  <SelectItem value="Bearish">▼ Bearish Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {isLoading
              ? Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)
              : filtered.length === 0
              ? (
                <div className="col-span-full py-16 text-center text-muted-foreground border border-dashed rounded-xl bg-card/50">
                  <Filter className="h-8 w-8 mx-auto mb-3 opacity-20" />
                  <p>No stocks match the selected filters.</p>
                  <button
                    className="mt-2 text-xs underline text-primary"
                    onClick={() => { setSearch(""); setCategory("All"); setFilterTF("All"); setFilterDir("All"); setMinConf("0"); setFilterSector("All"); }}
                  >
                    Clear all filters
                  </button>
                </div>
              )
              : filtered.map(stock => <ScreenerCard key={`${stock.exchange}-${stock.symbol}`} stock={stock} livePrice={livePrices[stock.symbol]} />)
            }
          </div>
        </div>
  );
}
