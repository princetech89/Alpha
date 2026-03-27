/**
 * Screener Page — Advanced NSE Stock Pattern Screener
 * Filter stocks by pattern category, timeframe, direction, and confidence.
 * Powered by Angel One SmartAPI live data.
 */
import { useState, useMemo, useCallback, useEffect, useDeferredValue } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLayout } from "@/components/Layout";
import { fetchStocks, fetchBSEStocks } from "@/lib/api";
import type { Stock, Exchange } from "@/lib/api";
import { useLivePrices, LivePriceMap } from "@/hooks/useLivePrices";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Filter, TrendingUp, TrendingDown, ChevronUp, ChevronDown,
  ArrowRight, RefreshCw, AlertCircle, BarChart2, Clock, X,
  Activity, Zap,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────
const CATEGORY_COLOR: Record<string, string> = {
  Breakout:             "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  Reversal:             "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  Momentum:             "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20",
  Candlestick:          "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  Divergence:           "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  "Support/Resistance": "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/20",
};

const CATEGORY_ICON: Record<string, string> = {
  Breakout:             "📈",
  Reversal:             "🔄",
  Momentum:             "⚡",
  Candlestick:          "🕯️",
  Divergence:           "↕",
  "Support/Resistance": "🎯",
};

function fmtIST(d: Date, opts?: Intl.DateTimeFormatOptions) {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

function ConfBar({ score }: { score: number }) {
  const colour = score >= 80 ? "bg-green-500" : score >= 65 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colour} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold tabular-nums w-6 text-right ${
        score >= 80 ? "text-green-600 dark:text-green-400" :
        score >= 65 ? "text-amber-600 dark:text-amber-400" : "text-red-500"
      }`}>{score}</span>
    </div>
  );
}

interface SignalRowProps {
  stock: Stock;
  signalIndex?: number;
  livePrice?: LivePriceMap[string];
}

function SignalRow({ stock, signalIndex = 0, livePrice }: SignalRowProps) {
  const signal = stock.signals[signalIndex];
  if (!signal) return null;
  const isBull = signal.type === "Bullish";

  // Use live price if available, else fall back to screener data
  const price       = livePrice?.price       ?? stock.currentPrice;
  const change      = livePrice?.change      ?? stock.change;
  const changePct   = livePrice?.changePercent ?? stock.changePercent;
  const high        = livePrice?.high        ?? stock.high;
  const low         = livePrice?.low         ?? stock.low;
  const changePos   = change >= 0;
  const flashClass  = livePrice?.flash === "up"   ? "price-flash-up"
                    : livePrice?.flash === "down" ? "price-flash-down" : "";

  return (
    <div className="transition-transform duration-150 will-change-transform hover:scale-[1.005]">
      <Card className="bg-card hover:shadow-lg transition-shadow duration-150 group border-border/60 rounded-2xl overflow-hidden">
        <CardContent className="p-0">
          <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Stock info */}
            <div className="flex-shrink-0 sm:w-36">
              <div className="font-black text-base group-hover:text-primary transition-colors tracking-tighter">
                {stock.symbol}
              </div>
              <div className="text-xs text-muted-foreground truncate max-w-[130px] font-medium">{stock.name}</div>
              <div className="text-[10px] text-muted-foreground/50 mt-1 uppercase font-bold tracking-widest">{stock.sector}</div>
            </div>

            {/* Price — live updating with flash */}
            <div className="flex-shrink-0 sm:w-28">
              <div className={`font-mono font-bold text-sm tracking-tight text-foreground inline-block px-1 ${flashClass}`}>
                ₹{price.toFixed(2)}
              </div>
              <div className={`text-xs font-bold flex items-center gap-0.5 ${changePos ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                {changePos ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {Math.abs(changePct).toFixed(2)}%
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-1 font-medium">
                H {high?.toFixed(0)} / L {low?.toFixed(0)}
              </div>
            </div>

            {/* Pattern */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-sm ${CATEGORY_COLOR[signal.patternCategory] ?? ""}`}>
                  {CATEGORY_ICON[signal.patternCategory]} {signal.patternCategory}
                </span>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border border-transparent shadow-sm ${
                  isBull ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-500"
                }`}>
                  {isBull ? "▲ Bullish" : "▼ Bearish"}
                </span>
                <span className="text-[10px] font-bold text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full border border-border/40">
                  {signal.timeframeClass}
                </span>
                {signal.volumeConfirmed && (
                  <span className="text-[10px] font-bold text-blue-500 bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20">
                    Vol ✓
                  </span>
                )}
              </div>
              <div className="font-black text-sm tracking-tight">{signal.patternName}</div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-1 font-medium uppercase tracking-wide">
                <Clock className="h-3.5 w-3.5 opacity-50" />
                {fmtIST(new Date(signal.detectedAt), { hour: "2-digit", minute: "2-digit", hour12: true })} IST
              </div>
            </div>

            {/* Confidence */}
            <div className="flex-shrink-0 sm:w-28">
              <div className="text-[10px] text-muted-foreground/50 mb-1.5 font-black uppercase tracking-[0.2em]">Confidence</div>
              <ConfBar score={signal.confidenceScore} />
              <div className="text-[10px] text-muted-foreground/70 mt-1.5 font-bold">
                SR: {signal.successRate}% · {signal.historicalOccurrences} signals
              </div>
            </div>

            {/* Targets */}
            <div className="flex-shrink-0 sm:w-36 hidden lg:block border-l pl-4 border-border/40">
              <div className="text-[10px] text-muted-foreground/50 mb-1.5 font-black uppercase tracking-[0.2em]">AlphaSignal</div>
              <div className="text-xs font-mono font-bold flex justify-between"><span>ENT:</span> <span className="text-foreground">{signal.entry}</span></div>
              <div className="text-xs font-mono font-bold flex justify-between text-green-600 dark:text-green-400"><span>TG1:</span> <span>{signal.target1}</span></div>
              <div className="text-xs font-mono font-bold flex justify-between text-red-500"><span>STP:</span> <span>{signal.stopLoss}</span></div>
            </div>

            {/* Action */}
            <div className="flex-shrink-0">
              <Button asChild variant="outline" size="sm" className="text-xs font-black h-9 rounded-xl border-2 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all">
                <Link href={`/stock/${stock.symbol}?exchange=${stock.exchange ?? "NSE"}`}>
                  Analyze <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Link>
              </Button>
            </div>
          </div>

          {stock.signals.length > 1 && (
            <div className="px-4 py-2 border-t bg-muted/30 text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Activity className="h-3 w-3" />
              +{stock.signals.length - 1} more pattern{stock.signals.length > 2 ? "s" : ""} detected
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── SCREENER PAGE ─────────────────────────────────────────────────────────────
export default function ScreenerPage() {
  const { exchange, setRefresh, setIsFetching, setLastUpdated } = useLayout();

  // Live price stream — real-time updates every 4 seconds
  const { prices: livePrices, connected: liveConnected } = useLivePrices(exchange as "NSE" | "BSE");
  const [search, setSearch]           = useState("");
  const deferredSearch                = useDeferredValue(search);
  const [filterCategory, setCategory] = useState("All");
  const [filterTF, setFilterTF]       = useState("All");
  const [filterDir, setFilterDir]     = useState("All");
  const [minConf, setMinConf]         = useState("0");
  const [sortBy, setSortBy]           = useState("confidence");

  const nseQuery = useQuery({
    queryKey: ["stocks", "NSE"],
    queryFn: fetchStocks,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
    enabled: exchange === "NSE",
  });
  const bseQuery = useQuery({
    queryKey: ["stocks", "BSE"],
    queryFn: fetchBSEStocks,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
    enabled: exchange === "BSE",
  });

  const { data: stocks = [], isLoading, error, refetch, isFetching, dataUpdatedAt } =
    exchange === "BSE" ? bseQuery : nseQuery;

  // Flatten signals into rows
  const allRows = useMemo(() =>
    stocks.flatMap(stock =>
      stock.signals.map((sig, idx) => ({ stock, signal: sig, signalIndex: idx }))
    ), [stocks]);

  // Filter — uses deferredSearch so typing never blocks the UI
  const filtered = useMemo(() => {
    const minC = parseInt(minConf, 10) || 0;
    const q = deferredSearch.toLowerCase();
    return allRows.filter(({ stock, signal }) => {
      if (q && !stock.symbol.toLowerCase().includes(q) &&
                !stock.name.toLowerCase().includes(q) &&
                !signal.patternName.toLowerCase().includes(q)) return false;
      if (filterCategory !== "All" && signal.patternCategory !== filterCategory) return false;
      if (filterTF !== "All" && signal.timeframeClass !== filterTF) return false;
      if (filterDir !== "All" && signal.type !== filterDir) return false;
      if (signal.confidenceScore < minC) return false;
      return true;
    });
  }, [allRows, deferredSearch, filterCategory, filterTF, filterDir, minConf]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "confidence") return b.signal.confidenceScore - a.signal.confidenceScore;
      if (sortBy === "change") return Math.abs(b.stock.changePercent) - Math.abs(a.stock.changePercent);
      if (sortBy === "symbol") return a.stock.symbol.localeCompare(b.stock.symbol);
      return 0;
    });
  }, [filtered, sortBy]);

  const clearFilters = useCallback(() => {
    setSearch(""); setCategory("All"); setFilterTF("All");
    setFilterDir("All"); setMinConf("0");
  }, []);

  const hasFilters = search || filterCategory !== "All" || filterTF !== "All" || filterDir !== "All" || minConf !== "0";

  const lastUpdated = dataUpdatedAt
    ? fmtIST(new Date(dataUpdatedAt), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })
    : null;

  // Sync with Layout header
  useEffect(() => {
    setRefresh(() => refetch);
    setIsFetching(isFetching);
    setLastUpdated(lastUpdated);
    return () => {
      setRefresh(null);
      setIsFetching(false);
      setLastUpdated(null);
    };
  }, [refetch, isFetching, lastUpdated, setRefresh, setIsFetching, setLastUpdated]);

  const bullCount = filtered.filter(r => r.signal.type === "Bullish").length;
  const bearCount = filtered.filter(r => r.signal.type === "Bearish").length;

  return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto w-full space-y-5">


        {/* ── QUICK STATS */}
        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Detected Patterns", value: filtered.length, icon: <Filter className="h-5 w-5 text-primary" />, bg: "bg-primary/5" },
              { label: "Bullish Setups", value: bullCount, icon: <TrendingUp className="h-5 w-5 text-green-500" />, cls: "text-green-600 dark:text-green-400", bg: "bg-green-500/5" },
              { label: "Bearish Setups", value: bearCount, icon: <TrendingDown className="h-5 w-5 text-red-500" />, cls: "text-red-500", bg: "bg-red-500/5" },
              { label: "Avg Confidence", value: Math.round(filtered.reduce((acc, r) => acc + r.signal.confidenceScore, 0) / (filtered.length || 1)), icon: <Zap className="h-5 w-5 text-amber-500" />, bg: "bg-amber-500/5" },
            ].map((s) => (
              <Card key={s.label} className={`bg-card shadow-sm border-none ring-1 ring-border/50 overflow-hidden ${s.bg}`}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-card border border-border/40 shadow-sm">{s.icon}</div>
                  <div>
                    <div className={`text-2xl font-black ${s.cls}`}>{s.value}</div>
                    <div className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* ── FILTER BAR */}
        <div className="bg-card border rounded-xl p-4 space-y-3">

          {/* Row 1: title + live indicator + clear */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="text-sm font-bold">Filters</span>
              {hasFilters && (
                <Badge variant="secondary" className="text-[10px] h-5">Active</Badge>
              )}
              {/* Live stream indicator */}
              <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${liveConnected ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                <span className="relative flex h-1.5 w-1.5">
                  {liveConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${liveConnected ? "bg-green-500" : "bg-muted-foreground"}`} />
                </span>
                {liveConnected ? "LIVE" : "Connecting…"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {sorted.length} signal{sorted.length !== 1 ? "s" : ""}
              </span>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>
          </div>

          {/* Row 2: search full width */}
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              id="screener-search"
              placeholder="Symbol, name, or pattern…"
              className="pl-8 h-9 text-sm bg-background w-full"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Row 3: dropdowns — 2 cols on mobile, 4 on desktop */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Select value={filterCategory} onValueChange={setCategory}>
              <SelectTrigger className="h-9 text-xs bg-background w-full">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Categories</SelectItem>
                <SelectItem value="Breakout">📈 Breakout</SelectItem>
                <SelectItem value="Reversal">🔄 Reversal</SelectItem>
                <SelectItem value="Momentum">⚡ Momentum</SelectItem>
                <SelectItem value="Candlestick">🕯️ Candlestick</SelectItem>
                <SelectItem value="Divergence">↕ Divergence</SelectItem>
                <SelectItem value="Support/Resistance">🎯 Support/Resistance</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterTF} onValueChange={setFilterTF}>
              <SelectTrigger className="h-9 text-xs bg-background w-full">
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
              <SelectTrigger className="h-9 text-xs bg-background w-full">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Signals</SelectItem>
                <SelectItem value="Bullish">▲ Bullish Only</SelectItem>
                <SelectItem value="Bearish">▼ Bearish Only</SelectItem>
              </SelectContent>
            </Select>

            <Select value={minConf} onValueChange={setMinConf}>
              <SelectTrigger className="h-9 text-xs bg-background w-full">
                <SelectValue placeholder="Min Confidence" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any Confidence</SelectItem>
                <SelectItem value="60">60+ Score</SelectItem>
                <SelectItem value="70">70+ Score</SelectItem>
                <SelectItem value="80">80+ (High)</SelectItem>
                <SelectItem value="85">85+ (Very High)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Row 4: sort buttons */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-xs text-muted-foreground">Sort by:</span>
            {[
              { value: "confidence", label: "Confidence" },
              { value: "change", label: "% Change" },
              { value: "symbol", label: "Symbol" },
            ].map(s => (
              <button
                key={s.value}
                onClick={() => setSortBy(s.value)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  sortBy === s.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted border-border hover:bg-accent"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

        </div>

        {/* ── ERROR */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive p-4 rounded-xl flex items-center gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Failed to load data from Angel One.</p>
              <p className="text-sm mt-0.5 opacity-80">{(error as Error)?.message || "Unknown error occurred."}</p>
              <button className="text-sm underline mt-0.5" onClick={() => refetch()}>Retry now</button>
            </div>
          </div>
        )}

        {/* ── LOADING HINT */}
        {isLoading && (
          <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground text-sm bg-card/50 border border-dashed rounded-xl">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span>Scanning {exchange} symbols…</span>
          </div>
        )}

        {/* ── RESULTS */}
        <div className="space-y-2">
          {isLoading
            ? Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            : sorted.length === 0
            ? (
              <div className="py-20 text-center text-muted-foreground border border-dashed rounded-xl bg-card/50">
                <BarChart2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="font-semibold">
                  {error ? "Could not load signal data." : "No signals match the selected filters."}
                </p>
                {hasFilters && !error && (
                  <button
                    className="mt-2 text-sm underline text-primary"
                    onClick={clearFilters}
                  >
                    Clear all filters
                  </button>
                )}
                {!error && !hasFilters && stocks.length === 0 && !isLoading && (
                  <p className="text-xs mt-1">
                    No live data available. Check your Angel One credentials or try refreshing.
                  </p>
                )}
              </div>
            )
            : sorted.map(({ stock, signalIndex }, i) => (
              <SignalRow
                key={`${stock.symbol}-${signalIndex}-${i}`}
                stock={stock}
                signalIndex={signalIndex}
                livePrice={livePrices[stock.symbol]}
              />
            ))
          }
        </div>

      </div>
  );
}
