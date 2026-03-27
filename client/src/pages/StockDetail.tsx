import { useParams, Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLayout } from "@/components/Layout";
import { fetchStockDetail } from "@/lib/api";
import type { Signal, Exchange } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, TrendingUp, TrendingDown, Target, ShieldAlert,
  BarChart2, Info, Languages, ArrowRight,
  RefreshCw, Clock, CheckCircle2, Volume2, AlertTriangle,
  ChevronUp, ChevronDown, Activity,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { AnalysisCharts } from "@/components/AnalysisCharts";
import { useLivePrices } from "@/hooks/useLivePrices";
import { useState, useEffect, useRef } from "react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMutation } from "@tanstack/react-query";

// ── Price value formatter: handles "Below 1215.10" → ["Below", "1215.10"] ────
function parsePriceValue(val: string): { prefix: string; num: string } {
  const match = val.match(/^([A-Za-z\s]+)\s+([\d.,]+)$/);
  if (match) return { prefix: match[1].trim(), num: match[2] };
  return { prefix: "", num: val };
}

function PriceDisplay({ value, className }: { value: string; className?: string }) {
  const { prefix, num } = parsePriceValue(value);
  return (
    <div className={`font-mono font-black text-sm ${className ?? ""}`}>
      {prefix && <span className="text-[10px] font-bold mr-0.5 opacity-80">{prefix} </span>}
      ₹{num}
    </div>
  );
}

// ── Category colours ──────────────────────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
  Breakout:    "bg-blue-500/15 text-blue-600",
  Reversal:    "bg-orange-500/15 text-orange-600",
  Momentum:    "bg-purple-500/15 text-purple-600",
  Candlestick: "bg-yellow-500/15 text-yellow-700",
  Divergence:  "bg-cyan-500/15 text-cyan-700",
};

const TF_DESC: Record<string, string> = {
  Intraday:   "Intraday (same session)",
  Swing:      "Swing (3–10 trading days)",
  Positional: "Positional (3–6 weeks)",
};

// ── Confidence ring ───────────────────────────────────────────────────────────
function ConfidenceRing({ score }: { score: number }) {
  const colour = score >= 80 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#ef4444";
  const r = 26, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative flex items-center justify-center w-16 h-16">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="4" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke={colour} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-black text-sm leading-none" style={{ color: colour }}>{score}</div>
        <div className="text-[8px] text-muted-foreground">/100</div>
      </div>
    </div>
  );
}

// ── Signal Card  (PRD Section 4.4 + 4.5 format) ──────────────────────────────
function SignalCard({
  signal, stockName, symbol, lang, exchange,
}: {
  signal: Signal;
  stockName: string;
  symbol: string;
  exchange: string;
  lang: "en" | "hi";
}) {
  const isBull = signal.type === "Bullish";
  const borderTop = isBull ? "hsl(var(--success))" : "hsl(var(--destructive))";

  const detectedIST = new Date(signal.detectedAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
    hour12: true,
  });

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Card className="shadow-2xl overflow-hidden border-t-4 rounded-2xl border-none ring-1 ring-border/40" style={{ borderTop: `4px solid ${borderTop}` }}>

      {/* ── Card header: PRD Section 4.5 format ── */}
      <CardHeader className="bg-muted/20 border-b pb-4">
        {/* Line 1: stock name + exchange + chart type */}
        <div className="text-xs text-muted-foreground font-medium mb-2">
          {stockName} ({symbol}) · {exchange} · Daily Chart
        </div>

        {/* Line 2: Pattern name + direction */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-lg font-black">{signal.patternName}</CardTitle>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAT_COLOR[signal.patternCategory] ?? ""}`}>
                {signal.patternCategory}
              </span>
              <Badge
                variant="outline"
                className={`text-xs font-bold border-none ${isBull ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}
              >
                {isBull ? "▲ Bullish" : "▼ Bearish"} Setup
              </Badge>
            </div>
          </div>
          <ConfidenceRing score={signal.confidenceScore} />
        </div>

        {/* Line 3: Meta info */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="flex items-center gap-1 hover:text-foreground transition-colors cursor-help">
                  <Activity className="h-3 w-3" />
                  Confidence Score: <strong className="text-foreground">{signal.confidenceScore} / 100</strong>
                  <Info className="h-2.5 w-2.5 opacity-50" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[200px] text-[10px] leading-tight p-2 font-mono">
                <div className="font-bold mb-1 border-b pb-1">Arithmetic Breakdown:</div>
                <div className="whitespace-pre-line">{signal.confidenceBreakdown}</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Timeframe: <strong className="text-foreground">{TF_DESC[signal.timeframeClass]}</strong>
          </span>
          <span className="text-border">·</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Detected: <strong className="text-foreground">{detectedIST} IST</strong>
          </span>
          {signal.volumeConfirmed && (
            <>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1 text-blue-500 font-semibold">
                <Volume2 className="h-3 w-3" /> Volume Confirmed
              </span>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-5">

        {/* ── "What is happening?" ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1">
              <Languages className="h-3 w-3" /> What is happening?
            </h4>
          </div>
          <p className={`text-sm leading-relaxed text-foreground/90 ${lang === "hi" ? "text-base" : ""}`}>
            {signal.explanation[lang]}
          </p>
        </div>

        {/* ── "What does history say?" ── */}
        <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1 mb-2">
            <BarChart2 className="h-3 w-3" /> What does history say?
          </h4>
          <p className="text-sm text-foreground/80 leading-relaxed">
            This pattern has resolved{" "}
            <span className={`font-black ${isBull ? "text-success" : "text-destructive"}`}>
              {isBull ? "bullishly" : "bearishly"}
            </span>{" "}
            <span className="font-black text-foreground">{signal.successRate}%</span> of the time
            on {stockName} over{" "}
            <span className="font-black text-foreground">{signal.historicalOccurrences}</span> historical occurrences
            in the back-test dataset.
          </p>

          {/* Progress bar for success rate */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${isBull ? "bg-success" : "bg-destructive"}`}
                style={{ width: `${signal.successRate}%` }}
              />
            </div>
            <span className="text-xs font-bold">{signal.successRate}%</span>
          </div>
        </div>

        {/* ── "Suggested Action Zone" ── */}
        <div>
          <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1">
            <Target className="h-3 w-3" />
            Suggested Action Zone{" "}
            <span className="normal-case font-normal text-muted-foreground/60">(not investment advice)</span>
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
              <span className="text-[9px] text-muted-foreground flex items-center gap-1 mb-1 uppercase font-bold">
                <ArrowRight className="h-3 w-3" /> Entry on Breakout
              </span>
              <PriceDisplay value={signal.entry} />
            </div>
            <div className="bg-destructive/5 p-3 rounded-lg border border-destructive/20">
              <span className="text-[9px] text-destructive flex items-center gap-1 mb-1 uppercase font-bold">
                <ShieldAlert className="h-3 w-3" /> Stop Loss
              </span>
              <PriceDisplay value={signal.stopLoss} className="text-destructive" />
            </div>
            <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
              <span className="text-[9px] text-muted-foreground flex items-center gap-1 mb-1 uppercase font-bold">
                <Target className="h-3 w-3" /> Target 1
              </span>
              <PriceDisplay value={signal.target1} />
            </div>
            <div className="bg-success/5 p-3 rounded-lg border border-success/20">
              <span className="text-[9px] text-success flex items-center gap-1 mb-1 uppercase font-bold">
                <Target className="h-3 w-3" /> Target 2
              </span>
              <PriceDisplay value={signal.target2} className="text-success" />
            </div>
          </div>
        </div>

      </CardContent>


      </Card>
    </motion.div>
  );
}


// ── STOCK DETAIL PAGE ─────────────────────────────────────────────────────────
export default function StockDetail() {
  const { setRefresh, setIsFetching, setLastUpdated } = useLayout();
  const { symbol } = useParams();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const exchange = (params.get("exchange")?.toUpperCase() === "BSE" ? "BSE" : "NSE") as Exchange;

  const [isWatchlisted, setIsWatchlisted] = useState(false);
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [showAI, setShowAI] = useState(false);
  const [analysisStale, setAnalysisStale] = useState(false);
  const prevPriceRef = useRef<number | null>(null);

  // Live prices via SSE (every 4 seconds)
  const { prices: livePrices } = useLivePrices(exchange);
  const livePrice = symbol ? livePrices[symbol] : undefined;

  const { data: stock, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["stock", symbol, exchange],
    queryFn:  () => fetchStockDetail(symbol || "", exchange),
    enabled:  !!symbol,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const analyzeMutation = useMutation({
    mutationFn: async (stockData: any) => {
      const res = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stockData),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.markdown;
    }
  });

  const chartColour = (stock?.change ?? 0) >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))";
  const lastUpdatedIST = stock?.lastUpdated
    ? new Date(stock.lastUpdated).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short", second: "2-digit", hour12: true,
      })
    : null;

  // Sync with Layout header
  useEffect(() => {
    if (stock) {
      setRefresh(() => refetch);
      setIsFetching(isFetching);
      setLastUpdated(lastUpdatedIST);
    }
    return () => {
      setRefresh(null);
      setIsFetching(false);
      setLastUpdated(null);
    };
  }, [refetch, isFetching, lastUpdatedIST, setRefresh, setIsFetching, setLastUpdated, stock]);

  // Mark AI analysis as stale when stock data refetches and price moved >0.3%
  useEffect(() => {
    if (!stock) return;
    const price = livePrice?.price ?? stock.currentPrice;
    if (prevPriceRef.current !== null && analyzeMutation.data) {
      const pct = Math.abs((price - prevPriceRef.current) / prevPriceRef.current) * 100;
      if (pct >= 0.3) setAnalysisStale(true);
    }
    prevPriceRef.current = price;
  }, [stock?.lastUpdated, livePrice?.price]);

  if (isLoading) {
    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
          <div className="flex items-center gap-3 py-6 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            Loading live data for <strong>{symbol}</strong> from Angel One SmartAPI…
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-[420px] rounded-xl" />
              <div className="grid grid-cols-4 gap-3">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
              </div>
            </div>
            <div className="space-y-4">
              {Array(2).fill(0).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
            </div>
          </div>
        </div>
    );
  }

  if (error || !stock) {
    return (
        <div className="p-8 text-center max-w-lg mx-auto mt-20">
          <ShieldAlert className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Data unavailable</h2>
          <p className="text-muted-foreground mb-6">
            Could not fetch live data for <strong>{symbol}</strong> from Angel One. The symbol may not be in the tracked universe or Angel One may be temporarily unreachable.
          </p>
          <Button asChild>
            <Link href="/">
              <><ArrowLeft className="mr-2 h-4 w-4" /> Back to Screener</>
            </Link>
          </Button>
        </div>
    );
  }

  return (
      <div className="p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">

        {/* ── Navigation ── */}
        <Link 
          href="/"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors font-medium mb-2"
        >
          <>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Screener
          </>
        </Link>

        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-5"
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-4xl font-black tracking-tight">{stock.symbol}</h1>
              <Badge variant="secondary" className="text-xs uppercase font-bold">{stock.sector}</Badge>
              {stock.signals.length > 0 && (
                <Badge className="text-xs bg-primary/10 text-primary border-primary/20 font-bold">
                  {stock.signals.length} Pattern{stock.signals.length > 1 ? "s" : ""} Active
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-base">{stock.name} · <span className={`font-bold ${exchange === "BSE" ? "text-orange-500" : "text-blue-500"}`}>{stock.exchange ?? exchange}</span></p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last updated: {lastUpdatedIST}
              </span>
              {stock.exchFeedTime && (
                <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-black border border-border text-[9px] uppercase tracking-wider">
                  {stock.exchFeedTime}
                </span>
              )}
              {isFetching && <RefreshCw className="h-3 w-3 animate-spin text-primary" />}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              {/* Price: live from SSE (every 4s) or fallback to query data */}
              <div className={`text-4xl font-black tracking-tighter font-mono transition-colors duration-300 ${
                livePrice?.flash === "up" ? "text-green-500" : livePrice?.flash === "down" ? "text-red-500" : ""
              }`}>
                ₹{(livePrice?.price ?? stock.currentPrice).toFixed(2)}
              </div>
              <div className={`text-base font-bold flex items-center justify-end mt-1 ${
                (livePrice?.changePercent ?? stock.changePercent) >= 0 ? "text-success" : "text-destructive"
              }`}>
                {(livePrice?.changePercent ?? stock.changePercent) >= 0
                  ? <ChevronUp className="h-5 w-5 stroke-[3]" />
                  : <ChevronDown className="h-5 w-5 stroke-[3]" />}
                {Math.abs(livePrice?.change ?? stock.change).toFixed(2)} ({Math.abs(livePrice?.changePercent ?? stock.changePercent).toFixed(2)}%)
              </div>
              {livePrice && (
                <div className="flex items-center justify-end gap-1 mt-0.5 text-[9px] font-bold text-green-600 dark:text-green-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                  </span>
                  LIVE
                </div>
              )}
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left: Chart + OHLCV ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Price Chart */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3 flex flex-row items-center justify-between border-b">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-primary" />
                  Price Action — Live Daily OHLCV (120 Days)
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs bg-muted/40">Daily</Badge>
                  <Badge variant="outline" className="text-xs text-muted-foreground">Vol: {stock.volume}</Badge>
                  <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="text-xs px-2 py-1 rounded border bg-card hover:bg-accent transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="h-[380px] p-4">
                  {stock.chartData.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                      <BarChart2 className="h-8 w-8 opacity-20" />
                      No chart data available. Market may be closed or data unavailable.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stock.chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={chartColour} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={chartColour} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={v => {
                            const parts = String(v).split("-").map(Number);
                            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                            return parts.length >= 3 ? `${parts[2]} ${months[parts[1] - 1]}` : v;
                          }}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={11}
                          tickMargin={8}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          domain={["auto", "auto"]}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={11}
                          tickFormatter={v => `₹${v.toFixed(0)}`}
                          width={68}
                          axisLine={false}
                          tickLine={false}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            borderColor: "hsl(var(--border))",
                            borderRadius: "8px",
                            boxShadow: "0 4px 12px -2px rgba(0,0,0,0.15)",
                            fontSize: "12px",
                          }}
                          labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}
                          formatter={(v: number) => [`₹${v.toFixed(2)}`, "Close"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="price"
                          stroke={chartColour}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#chartGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: "Open",      value: stock.open?.toFixed(2)      ?? "—" },
                { label: "High",      value: stock.high?.toFixed(2)      ?? "—", cls: "text-green-600 dark:text-green-400" },
                { label: "Low",       value: stock.low?.toFixed(2)       ?? "—", cls: "text-red-500" },
                { label: "LTP",       value: stock.currentPrice.toFixed(2) },
                { label: "Prev Close",value: stock.prevClose?.toFixed(2) ?? "—", cls: "text-muted-foreground" },
                { label: "Volume",    value: stock.volume },
              ].map(({ label, value, cls }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className="bg-card shadow-sm border-none ring-1 ring-border/50">
                    <CardContent className="p-3 flex flex-col items-center text-center">
                      <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 opacity-50">{label}</span>
                      <span className={`text-sm font-mono font-black ${cls ?? ""}`}>
                        {label === "Volume" ? value : `₹${value}`}
                      </span>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {/* ── AI Brain Analysis Section ── */}
            <div className="mt-4">
              <Card className="border-primary/20 bg-primary/5 shadow-lg overflow-hidden">
                <CardHeader className="border-b border-primary/10 bg-card/50 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl font-black flex items-center gap-2">
                        AlphaSignal AI Brain Analysis
                      </CardTitle>
                    </div>
                    <Button 
                      onClick={() => {
                        setShowAI(true);
                        if (!analyzeMutation.data && !analyzeMutation.isPending) {
                          analyzeMutation.mutate(stock);
                        }
                      }}
                      disabled={analyzeMutation.isPending}
                      className="font-bold shadow-lg shadow-primary/20"
                    >
                      {analyzeMutation.isPending ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Analyzing Chart...</> : "Generate Analysis"}
                    </Button>
                  </div>
                </CardHeader>
                <AnimatePresence>
                  {showAI && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }}>
                      <CardContent className="pt-6">
                        {analyzeMutation.isPending && (
                          <div className="space-y-4">
                            <Skeleton className="h-6 w-1/3 mb-4" />
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <Skeleton className="h-[200px] w-full rounded-2xl col-span-full" />
                              <Skeleton className="h-[180px] w-full rounded-2xl" />
                              <Skeleton className="h-[180px] w-full rounded-2xl" />
                              <Skeleton className="h-[180px] w-full rounded-2xl" />
                            </div>
                            <Skeleton className="h-8 w-3/4 mt-4" />
                            <Skeleton className="h-24 w-full" />
                            <Skeleton className="h-24 w-full" />
                          </div>
                        )}
                        {analyzeMutation.error && (
                          <div className="text-destructive p-4 bg-destructive/10 rounded border border-destructive/20">
                            Failed to generate analysis: {(analyzeMutation.error as Error).message}
                          </div>
                        )}
                        {analyzeMutation.data && (
                          <>
                            {/* ── Stale analysis banner ── */}
                            {analysisStale && (
                              <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex items-center justify-between gap-3 mb-4 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30"
                              >
                                <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Price has moved — analysis may be outdated
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs font-black border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                                  onClick={() => { setAnalysisStale(false); analyzeMutation.mutate(stock); }}
                                >
                                  Regenerate
                                </Button>
                              </motion.div>
                            )}
                            {/* ── Visual Charts (from real chartData, live via SSE) ── */}
                            <AnalysisCharts stock={stock} livePrice={livePrice} />

                            {/* ── AI Text Report ── */}
                            <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:text-justify prose-li:leading-relaxed prose-li:text-justify prose-headings:font-black prose-h2:text-base prose-h2:mt-6 prose-h2:mb-2 prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-1 prose-ul:my-2 prose-li:my-0.5 [&_p]:text-justify [&_li]:text-justify">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  strong: ({ children }) => (
                                    <strong className="text-green-500 dark:text-green-400 font-bold bg-green-500/10 px-1 py-0.5 rounded not-italic">
                                      {children}
                                    </strong>
                                  ),
                                }}
                              >
                                {analyzeMutation.data}
                              </ReactMarkdown>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            </div>

          </div>

          {/* ── Right: Signal Cards ── */}
          <div className="space-y-5">
            {/* Language toggle */}
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-primary" />
                Active Signals ({stock.signals.length})
              </h3>
              <div className="flex items-center bg-muted p-1 rounded-lg">
                {(["en", "hi"] as const).map(l => (
                  <Button
                    key={l}
                    variant={lang === l ? "default" : "ghost"}
                    size="sm"
                    className={`h-7 px-3 text-xs font-bold ${lang === l ? "shadow-sm" : ""}`}
                    onClick={() => setLang(l)}
                  >
                    {l === "en" ? "EN" : "हिं"}
                  </Button>
                ))}
              </div>
            </div>

            {stock.signals.length === 0 ? (
              <Card className="border-dashed bg-card/50">
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                  <Activity className="h-10 w-10 mx-auto mb-3 opacity-15" />
                  <p className="font-semibold mb-1">No patterns detected today</p>
                  <p className="text-xs">
                    No chart patterns were identified for {stock.symbol} in today's session.
                    Pattern detection runs on confirmed daily candles.
                  </p>
                </CardContent>
              </Card>
            ) : (
              stock.signals.map(signal => (
                <SignalCard
                  key={signal.id}
                  signal={signal}
                  stockName={stock.name}
                  symbol={stock.symbol}
                  exchange={stock.exchange ?? exchange}
                  lang={lang}
                />
              ))
            )}
          </div>

        </div>


      </div>
  );
}
