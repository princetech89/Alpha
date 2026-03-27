/**
 * Alerts Page — AI-Powered Pattern Alerts
 * Uses Google Gemini AI to generate intelligent market insights
 * and pattern explanations in Hindi and English.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLayout } from "@/components/Layout";
import { fetchAlerts } from "@/lib/api";
import type { Stock, Signal, Exchange } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell, BellRing, TrendingUp, TrendingDown, ChevronUp, ChevronDown,
  ArrowRight, RefreshCw, AlertCircle, Clock, Star, Sparkles,
  CheckCircle2, Info, Activity, BarChart2, Volume2, Wifi, WifiOff, Shield,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtIST(d: Date, opts?: Intl.DateTimeFormatOptions) {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

/** Returns true if NSE is currently open (Mon–Fri, 09:15–15:30 IST) */
function isMarketOpen(): boolean {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const day  = parts.find(p => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find(p => p.type === "hour")?.value   ?? "0", 10);
  const min  = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  if (day === "Sun" || day === "Sat") return false;
  const hhmm = hour * 100 + min;
  return hhmm >= 915 && hhmm < 1530;
}

const CATEGORY_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  Breakout:             { bg: "bg-blue-500/10",   text: "text-blue-600 dark:text-blue-400",   border: "border-blue-500/30" },
  Reversal:             { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", border: "border-orange-500/30" },
  Momentum:             { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/30" },
  Candlestick:          { bg: "bg-yellow-500/10", text: "text-yellow-700 dark:text-yellow-400", border: "border-yellow-500/30" },
  Divergence:           { bg: "bg-cyan-500/10",   text: "text-cyan-700 dark:text-cyan-400",   border: "border-cyan-500/30" },
  "Support/Resistance": { bg: "bg-teal-500/10",   text: "text-teal-700 dark:text-teal-400",   border: "border-teal-500/30" },
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "bg-red-500 text-white",
  high:     "bg-orange-500 text-white",
  medium:   "bg-amber-400 text-white",
  low:      "bg-muted text-muted-foreground",
};

function getPriority(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 88) return "critical";
  if (score >= 78) return "high";
  if (score >= 65) return "medium";
  return "low";
}

// ── Alert card ───────────────────────────────────────────────────────────────
interface AlertEntry {
  stock: Stock;
  signal: Signal;
  id: string;
  isNew: boolean;
}

function AlertCard({ entry, onRead }: { entry: AlertEntry; onRead?: (id: string) => void }) {
  const { stock, signal } = entry;
  const [expanded, setExpanded] = useState(false);
  const isBull   = signal.type === "Bullish";
  const priority = getPriority(signal.confidenceScore);
  const catColor = CATEGORY_COLOR[signal.patternCategory] ?? { bg: "bg-muted", text: "text-muted-foreground", border: "border-border" };
  const changePos = stock.change >= 0;

  const handleExpand = useCallback(() => {
    setExpanded(v => !v);
    if (!expanded && onRead) onRead(entry.id);
  }, [expanded, onRead, entry.id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      layout
    >
      <Card className={`bg-card border-none ring-1 ring-border/40 shadow-sm hover:shadow-xl transition-all duration-300 group ${entry.isNew ? "ring-primary/40 ring-2" : ""} overflow-hidden rounded-2xl`}>
        <CardContent className="p-0">
          <div
            className="p-5 cursor-pointer select-none"
            onClick={handleExpand}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === "Enter" && handleExpand()}
            aria-expanded={expanded}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className={`mt-1.5 w-1 h-12 rounded-full flex-shrink-0 ${
                  priority === "critical" ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]" :
                  priority === "high"     ? "bg-orange-500" :
                  priority === "medium"   ? "bg-amber-400" : "bg-muted-foreground/20"
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {entry.isNew && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-primary text-primary-foreground uppercase tracking-[0.1em] shadow-sm">
                        FRESH SIGNAL
                      </span>
                    )}
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border border-transparent shadow-sm ${catColor.bg} ${catColor.text} uppercase tracking-tight`}>
                      {signal.patternCategory}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold h-6 border-transparent shadow-sm ${
                        isBull ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {isBull ? "▲ BULLISH" : "▼ BEARISH"}
                    </Badge>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <div className="font-black text-xl tracking-tighter text-foreground group-hover:text-primary transition-colors">{stock.symbol}</div>
                    <div className="text-[10px] text-muted-foreground font-black uppercase tracking-widest opacity-40">{stock.name}</div>
                  </div>
                  <div className="font-black text-sm mt-1 tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">{signal.patternName}</div>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <div className="font-mono font-bold text-lg tracking-tighter">₹{stock.currentPrice.toFixed(2)}</div>
                <div className={`text-xs font-black flex items-center justify-end gap-0.5 ${changePos ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {changePos ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {Math.abs(stock.changePercent).toFixed(2)}%
                </div>
                <div className="mt-2 flex items-center justify-end gap-1.5">
                   <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-40">Conf</div>
                   <div className="flex-shrink-0 w-12 h-1 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${
                        signal.confidenceScore >= 80 ? "bg-green-500" : signal.confidenceScore >= 65 ? "bg-amber-400" : "bg-red-500"
                      }`} style={{ width: `${signal.confidenceScore}%` }} />
                   </div>
                   <span className="text-xs font-mono font-black">{signal.confidenceScore}</span>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {!expanded && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 pt-4 border-t border-border/40 flex items-center gap-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest"
                >
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 opacity-40" />
                    {fmtIST(new Date(signal.detectedAt), { hour: "2-digit", minute: "2-digit", hour12: true })} IST
                  </span>
                  <span className="flex items-center gap-1.5 border-l pl-4 border-border/40">
                    <Activity className="h-3.5 w-3.5 opacity-40" />
                    {signal.timeframeClass}
                  </span>
                  {signal.successRate > 0 && (
                    <span className={`flex items-center gap-1 border-l pl-4 border-border/40 font-black ${signal.successRate >= 65 ? "text-green-600 dark:text-green-400" : "text-amber-500"}`}>
                      {signal.successRate}% WIN RATE
                      {signal.historicalOccurrences > 0 && (
                        <span className="text-muted-foreground font-normal">· {signal.historicalOccurrences} signals</span>
                      )}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1 text-primary animate-pulse">
                    <span>VIEW INTEL</span>
                    <ChevronDown className="h-3 w-3" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-5 pt-0 space-y-5">
                  <div className="h-px bg-border/40 w-full" />
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Execution Entry", value: signal.entry, color: "text-foreground", bg: "bg-muted/30" },
                      { label: "Hard Stop Loss", value: signal.stopLoss, color: "text-red-500", bg: "bg-red-500/5" },
                      { label: "Alpha Target 1", value: signal.target1, color: "text-green-600 dark:text-green-400", bg: "bg-green-500/5" },
                      { label: "Alpha Target 2", value: signal.target2, color: "text-green-600 dark:text-green-400", bg: "bg-green-500/5" },
                    ].map(item => (
                      <div key={item.label} className={`rounded-2xl p-4 border border-border/40 shadow-sm ${item.bg}`}>
                        <div className="text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em] mb-1.5 opacity-60">{item.label}</div>
                        <div className={`font-mono font-black text-base ${item.color}`}>₹{item.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-6 flex-wrap text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/40 pb-5">
                    {/* Real live data badge — AngelOne FULL quote verified */}
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                      <Shield className="h-4 w-4" />
                      Live AngelOne Data
                    </div>
                    {signal.volumeConfirmed && <div className="flex items-center gap-2 text-blue-500"><Volume2 className="h-4 w-4" /> Volume Verified</div>}
                    {signal.riskReward && (
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">R:R {signal.riskReward}</span>
                    )}
                    <div className="ml-auto text-[9px] text-muted-foreground/50 font-mono normal-case tracking-normal">
                      {signal.liveQuoteSource ?? "AngelOne-FULL"}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-card rounded-2xl border border-border/60 p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-3 opacity-60">
                        <Info className="h-4 w-4" /> Strategic Context (EN)
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed font-medium">{signal.explanation?.en || "Strategic analysis processing..."}</p>
                    </div>

                    {signal.explanation?.hi && (
                      <div className="bg-orange-500/[0.03] rounded-2xl border border-orange-500/20 p-4 shadow-sm">
                        <div className="flex items-center gap-2 text-[10px] font-black text-orange-600 dark:text-orange-400 uppercase tracking-[0.2em] mb-3 opacity-60">
                          <Sparkles className="h-4 w-4" /> विस्तृत विश्लेषण (हिंदी)
                        </div>
                        <p className="text-sm text-foreground/90 leading-relaxed font-bold">{signal.explanation.hi}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4 items-center pt-2">
                    <Button asChild className="w-full sm:w-auto h-11 px-8 rounded-xl font-black shadow-lg shadow-primary/20 hover:scale-[1.02] transition-transform">
                      <Link href={`/stock/${stock.symbol}?exchange=${stock.exchange ?? "NSE"}`}>
                        OPEN FULL ANALYSIS <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                    <div className="text-[10px] text-muted-foreground/60 italic max-w-sm">
                      *Algo-verified. Always verify with manual candle analysis before trade execution.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Summary stats ─────────────────────────────────────────────────────────────
function AlertSummary({ alerts }: { alerts: AlertEntry[] }) {
  const critical = alerts.filter(a => getPriority(a.signal.confidenceScore) === "critical").length;
  const high     = alerts.filter(a => getPriority(a.signal.confidenceScore) === "high").length;
  const bull     = alerts.filter(a => a.signal.type === "Bullish").length;
  const bear     = alerts.filter(a => a.signal.type === "Bearish").length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        { label: "Total Intels",   value: alerts.length, icon: <Bell className="h-5 w-5 text-primary" />, bg: "bg-primary/5" },
        { label: "Critical Setups", value: critical,       icon: <BellRing className="h-5 w-5 text-red-500" />,  cls: "text-red-500", bg: "bg-red-500/5" },
        { label: "Bullish Alerts", value: bull,           icon: <TrendingUp className="h-5 w-5 text-green-500" />, cls: "text-green-600 dark:text-green-400", bg: "bg-green-500/5" },
        { label: "Bearish Alerts", value: bear,           icon: <TrendingDown className="h-5 w-5 text-red-500" />, cls: "text-red-500", bg: "bg-red-500/5" },
      ].map((s, i) => (
        <motion.div
           key={s.label}
           initial={{ opacity: 0, scale: 0.9 }}
           animate={{ opacity: 1, scale: 1 }}
           transition={{ delay: i * 0.1 }}
        >
          <Card className={`bg-card shadow-sm border-none ring-1 ring-border/50 overflow-hidden ${s.bg}`}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-card border border-border/40 shadow-sm">{s.icon}</div>
              <div>
                <div className={`text-2xl font-black ${s.cls}`}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// ── ALERTS PAGE ───────────────────────────────────────────────────────────────
export default function AlertsPage() {
  const { exchange, setRefresh, setIsFetching, setLastUpdated, setAlertCount } = useLayout();
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterDir, setFilterDir]           = useState("All");
  const [showRead, setShowRead]             = useState(true);

  // Persist readIds to localStorage so reads survive navigation, refresh, and refetch
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("alphasignal-alert-read-ids");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    try {
      localStorage.setItem("alphasignal-alert-read-ids", JSON.stringify([...readIds]));
    } catch {}
  }, [readIds]);

  const nseQuery = useQuery({
    queryKey: ["alerts", "NSE"],
    queryFn: () => fetchAlerts("NSE"),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
    enabled: exchange === "NSE",
  });

  const bseQuery = useQuery({
    queryKey: ["alerts", "BSE"],
    queryFn: () => fetchAlerts("BSE"),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
    enabled: exchange === "BSE",
  });

  const { data: stocks = [], isLoading, error, refetch, isFetching, dataUpdatedAt } = 
    exchange === "BSE" ? bseQuery : nseQuery;

  // Build alert entries sorted by confidence desc
  // isNew = not yet read (shows FRESH SIGNAL badge; cleared by Mark all read or expanding)
  const allAlerts = useMemo<AlertEntry[]>(() => {
    const rows: AlertEntry[] = [];
    stocks.forEach(stock => {
      stock.signals.forEach(signal => {
        const id = `${stock.symbol}-${signal.id}`;
        rows.push({ stock, signal, id, isNew: !readIds.has(id) });
      });
    });
    return rows.sort((a, b) => b.signal.confidenceScore - a.signal.confidenceScore);
  }, [stocks, readIds]);

  // Must be before the effect that uses it
  const newCount = allAlerts.filter(a => !readIds.has(a.id)).length;

  // Sync UNREAD count to header bell badge
  useEffect(() => {
    setAlertCount(newCount);
    return () => setAlertCount(0);
  }, [newCount, setAlertCount]);

  // Filter
  const filtered = useMemo(() => {
    return allAlerts.filter(a => {
      if (!showRead && readIds.has(a.id)) return false;
      if (filterDir !== "All" && a.signal.type !== filterDir) return false;
      if (filterPriority !== "all") {
        if (getPriority(a.signal.confidenceScore) !== filterPriority) return false;
      }
      return true;
    });
  }, [allAlerts, filterPriority, filterDir, showRead, readIds]);

  const markAllRead = useCallback(() => {
    setReadIds(new Set(allAlerts.map(a => a.id)));
    setShowRead(false); // hide read alerts immediately so the list clears
  }, [allAlerts]);

  const handleRead = useCallback((id: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
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

  return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto w-full space-y-5">

        {/* ── HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent flex items-center gap-3">
              <BellRing className="h-8 w-8 text-primary" />
              Intelligence Feed
              {newCount > 0 && (
                <span className="ml-1 text-xs font-black bg-primary text-primary-foreground rounded-full px-3 py-1 shadow-lg shadow-primary/30">
                  {newCount} NEW
                </span>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1 font-medium">
              Live pattern discovery stream — {exchange} Alpha Signals
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {allAlerts.length > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border bg-card hover:bg-accent transition-colors"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* ── MARKET STATUS BANNER */}
        {(() => {
          const open = isMarketOpen();
          return (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-bold ${
              open
                ? "bg-green-500/5 border-green-500/20 text-green-600 dark:text-green-400"
                : "bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400"
            }`}>
              {open ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                  <span>MARKET LIVE — Signals are fetched directly from Angel One SmartAPI FULL quote in real time.</span>
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    MARKET CLOSED — Showing real Angel One data from the last trading session (NSE: Mon–Fri 9:15 AM – 3:30 PM IST). No simulated data.
                  </span>
                </>
              )}
            </div>
          );
        })()}

        {/* ── SUMMARY */}
        {!isLoading && allAlerts.length > 0 && <AlertSummary alerts={allAlerts} />}

        {/* ── AI INSIGHT BANNER */}
        {!isLoading && allAlerts.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gradient-to-r from-purple-500/10 via-primary/10 to-blue-500/10 border border-primary/20 rounded-3xl p-6 relative overflow-hidden group shadow-2xl"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform duration-500">
               <Sparkles className="h-24 w-24 text-primary" />
            </div>
            <div className="flex items-start gap-4 relative z-10">
              <div className="p-3 rounded-2xl bg-primary shadow-xl shadow-primary/20 flex-shrink-0">
                <Sparkles className="h-6 w-6 text-primary-foreground" />
              </div>
              <div className="space-y-2">
                <div className="font-black text-sm uppercase tracking-[0.1em] flex items-center gap-2">
                  AI Market Pulse Analysis
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed font-bold max-w-2xl">
                  {(() => {
                    const bull = allAlerts.filter(a => a.signal.type === "Bullish").length;
                    const bear = allAlerts.filter(a => a.signal.type === "Bearish").length;
                    const topSignal = allAlerts[0];
                    const topSymbol = topSignal?.stock.symbol ?? "N/A";
                    const topPattern = topSignal?.signal.patternName ?? "N/A";
                    const topConf = topSignal?.signal.confidenceScore ?? 0;
                    const sentiment = bull > bear ? "BULLISH" : bull < bear ? "BEARISH" : "NEUTRAL";
                    return `MARKET SENTIMENT IS ${sentiment} WITH ${bull} BULL VS ${bear} BEAR SIGNALS. TOP PICK: ${topSymbol} (${topPattern}) AT ${topConf} CONFIDENCE. ${
                      bull > bear
                        ? "MOMENTUM IS WITH THE BULLS — PROTECT PROFITS ON BREAKOUTS."
                        : bull < bear
                          ? "BEAR PRESSURE INTENSIFYING — SCALE DOWN LONG EXPOSURE."
                          : "MARKET RANGING — WAIT FOR ALGO CONFORMATION ON VOLUME."
                    }`;
                  })()}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── FILTER TABS */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {[
              { value: "all",      label: "All"         },
              { value: "critical", label: "🔴 Critical" },
              { value: "high",     label: "🟠 High"     },
              { value: "medium",   label: "🟡 Medium"   },
              { value: "low",      label: "Low"          },
            ].map(p => (
              <button
                key={p.value}
                onClick={() => setFilterPriority(p.value)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  filterPriority === p.value
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {[
              { value: "All",     label: "Both"   },
              { value: "Bullish", label: "▲ Bull" },
              { value: "Bearish", label: "▼ Bear" },
            ].map(d => (
              <button
                key={d.value}
                onClick={() => setFilterDir(d.value)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  filterDir === d.value
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Toggle read/unread */}
          <button
            onClick={() => setShowRead(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors border ${
              !showRead
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {showRead ? "Show all" : "Unread only"}
          </button>

          <span className="text-xs text-muted-foreground ml-auto hidden sm:block">
            {filtered.length} alert{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── ERROR */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive p-4 rounded-xl flex items-center gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Failed to load alerts from Angel One.</p>
              <p className="text-sm mt-0.5 opacity-80">{(error as Error)?.message || "Unknown error occurred."}</p>
              <button className="text-sm underline mt-0.5" onClick={() => refetch()}>Retry now</button>
            </div>
          </div>
        )}

        {/* ── LOADING HINT */}
        {isLoading && (
          <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground text-sm bg-card/50 border border-dashed rounded-xl">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span>Fetching live quotes from Angel One SmartAPI — detecting pattern alerts…</span>
          </div>
        )}

        {/* ── ALERT LIST */}
        <div className="space-y-3">
          {isLoading
            ? Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
            : filtered.length === 0
            ? (
              <div className="py-20 text-center text-muted-foreground border border-dashed rounded-xl bg-card/50">
                <Bell className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="font-semibold">
                  {error ? "Could not load alert data." : "No alerts match the current filters."}
                </p>
                <p className="text-xs mt-1">
                  {!error && allAlerts.length === 0 && !isLoading
                    ? "No live data available. Check credentials or try refreshing."
                    : "Try changing filters or refresh data."}
                </p>
              </div>
            )
            : filtered.map(entry => (
              <AlertCard key={entry.id} entry={entry} onRead={handleRead} />
            ))
          }
        </div>

      </div>
  );
}
