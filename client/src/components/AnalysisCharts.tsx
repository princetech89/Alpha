/**
 * AnalysisCharts — Visual dashboards for AlphaSignal AI Brain Analysis.
 * All data comes from real OHLCV candles + live quote. Zero guessing.
 * Live prices update every 4 seconds via SSE; historical charts update every 60s.
 */
import { useEffect, useRef, useState } from "react";
import {
  ComposedChart, Area, Line, Bar, BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
  ReferenceLine,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, BarChart2,
  Activity, Target, Zap, Wifi,
} from "lucide-react";
import type { LivePrice } from "@/hooks/useLivePrices";

// ── Helpers ───────────────────────────────────────────────────────────────────
function sma(arr: number[], period: number): (number | null)[] {
  return arr.map((_, i) =>
    i + 1 < period ? null : arr.slice(i + 1 - period, i + 1).reduce((a, b) => a + b, 0) / period
  );
}

function fmt2(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtVol(v: number) {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function shortDate(d: string) {
  // d is "YYYY-MM-DD" from candle data — split directly to avoid UTC/local offset shifts
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}

// ── Section label ─────────────────────────────────────────────────────────────
function ChartLabel({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-6 w-6 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div>
        <div className="text-xs font-black uppercase tracking-wider text-foreground">{title}</div>
        {subtitle && <div className="text-[10px] text-muted-foreground font-medium">{subtitle}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRICE + SMA LINE CHART (60 days)
// ─────────────────────────────────────────────────────────────────────────────
function PriceSMAChart({ candles }: { candles: any[] }) {
  const closes = candles.map(c => c.price ?? c.close);
  const sma5v  = sma(closes, 5);
  const sma20v = sma(closes, 20);
  const sma50v = sma(closes, 50);

  const data = candles.slice(-60).map((c, i, arr) => {
    const absIdx = candles.length - arr.length + i;
    return {
      date:  shortDate(c.date),
      close: +(c.price ?? c.close).toFixed(2),
      sma5:  sma5v[absIdx]  !== null ? +sma5v[absIdx]!.toFixed(2)  : undefined,
      sma20: sma20v[absIdx] !== null ? +sma20v[absIdx]!.toFixed(2) : undefined,
      sma50: sma50v[absIdx] !== null ? +sma50v[absIdx]!.toFixed(2) : undefined,
    };
  });

  const min = Math.min(...data.map(d => d.close)) * 0.985;
  const max = Math.max(...data.map(d => d.close)) * 1.015;

  return (
    <div className="bg-card/60 rounded-2xl border border-border/30 p-4">
      <ChartLabel icon={Activity} title="Price & Moving Averages" subtitle="60-day close with SMA 5 / 20 / 50" />
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            interval={Math.floor(data.length / 6)} axisLine={false} tickLine={false} />
          <YAxis domain={[min, max]} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={v => `₹${v}`} width={58} axisLine={false} tickLine={false} />
          <RTooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 11 }}
            labelStyle={{ fontWeight: 700, color: "hsl(var(--foreground))" }}
            formatter={(v: any, name: string) => [`₹${fmt2(v)}`, name.toUpperCase()]}
          />
          <Area type="monotone" dataKey="close" fill="url(#priceGrad)"
            stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Price" />
          <Line type="monotone" dataKey="sma5"  stroke="#facc15" strokeWidth={1.5} dot={false} name="SMA5"  connectNulls />
          <Line type="monotone" dataKey="sma20" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="SMA20" connectNulls />
          <Line type="monotone" dataKey="sma50" stroke="#f97316" strokeWidth={1.5} dot={false} name="SMA50" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {[["Price","hsl(var(--primary))"],["SMA5","#facc15"],["SMA20","#60a5fa"],["SMA50","#f97316"]].map(([label, color]) => (
          <div key={label} className="flex items-center gap-1">
            <div className="h-0.5 w-4 rounded-full" style={{ background: color }} />
            <span className="text-[10px] font-bold text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. VOLUME BAR CHART (25 days)
// ─────────────────────────────────────────────────────────────────────────────
function VolumeChart({ candles }: { candles: any[] }) {
  const last25 = candles.slice(-25);
  const vols   = last25.map(c => c.volume ?? 0);
  const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;

  const data = last25.map(c => ({
    date:   shortDate(c.date),
    volume: c.volume ?? 0,
    up:     (c.price ?? c.close) >= (c.open ?? c.close),
  }));

  return (
    <div className="bg-card/60 rounded-2xl border border-border/30 p-4">
      <ChartLabel icon={BarChart2} title="Volume Analysis" subtitle={`25-day · avg ${fmtVol(Math.round(avgVol))}`} />
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
            interval={Math.floor(data.length / 5)} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtVol} tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
            width={40} axisLine={false} tickLine={false} />
          <RTooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 10 }}
            formatter={(v: any) => [fmtVol(v), "Volume"]}
          />
          <ReferenceLine y={avgVol} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
          <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.up ? "rgba(34,197,94,0.75)" : "rgba(239,68,68,0.75)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-3 mt-1.5">
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded-sm bg-green-500/75" /><span className="text-[9px] text-muted-foreground font-medium">Up day</span></div>
        <div className="flex items-center gap-1"><div className="h-2 w-2 rounded-sm bg-red-500/75" /><span className="text-[9px] text-muted-foreground font-medium">Down day</span></div>
        <div className="flex items-center gap-1"><div className="h-px w-4 border-t border-dashed border-slate-400" /><span className="text-[9px] text-muted-foreground font-medium">20d avg</span></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. KEY PRICE LEVELS — horizontal gauge
// ─────────────────────────────────────────────────────────────────────────────
function KeyLevelsChart({ stock, sma5, sma20, sma50 }: {
  stock: any; sma5: number | null; sma20: number | null; sma50: number | null;
}) {
  const price = stock.currentPrice;
  const w52h  = stock.week52High;
  const w52l  = stock.week52Low;

  type Level = { label: string; value: number; color: string };
  const rawLevels: Level[] = [
    w52l  ? { label: "52W Low",  value: w52l,  color: "#ef4444" } : null,
    sma50 ? { label: "SMA50",    value: sma50,  color: "#f97316" } : null,
    sma20 ? { label: "SMA20",    value: sma20,  color: "#60a5fa" } : null,
    sma5  ? { label: "SMA5",     value: sma5,   color: "#facc15" } : null,
    { label: "Price", value: price, color: "hsl(var(--primary))" },
    w52h  ? { label: "52W High", value: w52h,  color: "#22c55e" } : null,
  ].filter(Boolean) as Level[];

  const validLevels = rawLevels.filter(l => l.value > 0);
  if (validLevels.length < 2) return null;

  const minV = Math.min(...validLevels.map(l => l.value));
  const maxV = Math.max(...validLevels.map(l => l.value));
  const range = maxV - minV || 1;

  return (
    <div className="bg-card/60 rounded-2xl border border-border/30 p-4">
      <ChartLabel icon={Target} title="Key Price Levels" subtitle="Support, resistance & MA zones" />
      <div className="relative mt-2 space-y-2.5">
        {/* Track */}
        <div className="absolute left-24 right-4 top-0 bottom-0 flex items-stretch">
          <div className="w-full relative">
            <div className="absolute inset-y-0 left-0 right-0 flex items-center">
              <div className="w-full h-1.5 rounded-full bg-border/30" />
            </div>
          </div>
        </div>

        {validLevels.sort((a, b) => b.value - a.value).map((lvl) => {
          const pct = ((lvl.value - minV) / range) * 100;
          const isPrice = lvl.label === "Price";
          return (
            <div key={lvl.label} className="flex items-center gap-2 relative z-10">
              <span className="text-[10px] font-bold text-muted-foreground w-14 text-right flex-shrink-0">
                {lvl.label}
              </span>
              <div className="flex-1 relative h-5 flex items-center">
                {/* Background bar */}
                <div className="w-full h-1 rounded-full bg-border/20" />
                {/* Fill to level */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                  className="absolute left-0 h-1 rounded-full"
                  style={{ background: lvl.color, opacity: isPrice ? 1 : 0.5 }}
                />
                {/* Marker dot */}
                <motion.div
                  initial={{ left: 0 }}
                  animate={{ left: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                  className={`absolute -translate-x-1/2 ${isPrice ? "h-3 w-3" : "h-2 w-2"} rounded-full border-2 border-card`}
                  style={{ background: lvl.color, boxShadow: isPrice ? `0 0 6px ${lvl.color}` : "none" }}
                />
              </div>
              <span className="text-[10px] font-black tabular-nums w-16 flex-shrink-0" style={{ color: lvl.color }}>
                ₹{fmt2(lvl.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MOMENTUM DONUT — last 10 sessions up/down ratio
// ─────────────────────────────────────────────────────────────────────────────
function MomentumDonut({ candles }: { candles: any[] }) {
  const last10 = candles.slice(-11);
  let up = 0, down = 0, flat = 0;
  for (let i = 1; i < last10.length; i++) {
    const diff = (last10[i].price ?? last10[i].close) - (last10[i - 1].price ?? last10[i - 1].close);
    if (diff > 0.01) up++;
    else if (diff < -0.01) down++;
    else flat++;
  }
  const total = up + down + flat || 1;
  const score = Math.round((up / total) * 100);

  const pieData = [
    { name: "Up Days",   value: up,   fill: "#22c55e" },
    { name: "Down Days", value: down,  fill: "#ef4444" },
    flat > 0 ? { name: "Flat",   value: flat,  fill: "#94a3b8" } : null,
  ].filter(Boolean) as { name: string; value: number; fill: string }[];

  const label = score >= 70 ? "Strong Bull" : score >= 50 ? "Mild Bull" : score >= 30 ? "Mild Bear" : "Strong Bear";
  const labelColor = score >= 50 ? "#22c55e" : "#ef4444";

  return (
    <div className="bg-card/60 rounded-2xl border border-border/30 p-4">
      <ChartLabel icon={Zap} title="10-Session Momentum" subtitle="Up vs down days ratio" />
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <PieChart width={110} height={110}>
            <Pie data={pieData} cx={50} cy={50} innerRadius={32} outerRadius={50}
              dataKey="value" startAngle={90} endAngle={-270} strokeWidth={0}>
              {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
          </PieChart>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-lg font-black tabular-nums" style={{ color: labelColor }}>{score}%</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="text-sm font-black" style={{ color: labelColor }}>{label}</div>
          {pieData.map(d => (
            <div key={d.name} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ background: d.fill }} />
                <span className="text-[10px] font-medium text-muted-foreground">{d.name}</span>
              </div>
              <span className="text-[10px] font-black tabular-nums" style={{ color: d.fill }}>{d.value}d</span>
            </div>
          ))}
          <div className="text-[9px] text-muted-foreground/60 font-medium pt-1 border-t border-border/20">
            Last 10 trading sessions
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DAILY RETURN BAR CHART (20 days)
// ─────────────────────────────────────────────────────────────────────────────
function DailyReturnsChart({ candles }: { candles: any[] }) {
  const last21 = candles.slice(-21);
  const data: { date: string; ret: number }[] = [];
  for (let i = 1; i < last21.length; i++) {
    const prev = last21[i - 1].price ?? last21[i - 1].close;
    const curr = last21[i].price ?? last21[i].close;
    if (prev > 0) {
      data.push({
        date: shortDate(last21[i].date),
        ret:  +((( curr - prev) / prev) * 100).toFixed(2),
      });
    }
  }

  return (
    <div className="bg-card/60 rounded-2xl border border-border/30 p-4">
      <ChartLabel icon={TrendingUp} title="Daily Returns (%)" subtitle="20-day session-by-session change" />
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
            interval={Math.floor(data.length / 5)} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
            width={38} axisLine={false} tickLine={false} />
          <RTooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 10 }}
            formatter={(v: any) => [`${v > 0 ? "+" : ""}${v}%`, "Return"]}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
          <Bar dataKey="ret" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.ret >= 0 ? "rgba(34,197,94,0.8)" : "rgba(239,68,68,0.8)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. INTRADAY SNAPSHOT — O/H/L/C + 52W gauge — updates live every 4s
// ─────────────────────────────────────────────────────────────────────────────
function IntradaySnapshot({ stock, livePrice }: { stock: any; livePrice?: LivePrice }) {
  const price    = livePrice?.price    ?? stock.currentPrice;
  const open     = livePrice?.open     ?? stock.open;
  const high     = livePrice?.high     ?? stock.high;
  const low      = livePrice?.low      ?? stock.low;
  const prevClose = stock.prevClose ?? livePrice?.prevClose ?? price;
  const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : stock.changePercent ?? 0;
  const w52h = stock.week52High;
  const w52l = stock.week52Low;

  const dayRange = (high > low) ? high - low : 1;
  const pricePos = Math.max(0, Math.min(100, ((price - low) / dayRange) * 100));
  const openPos  = Math.max(0, Math.min(100, ((open  - low) / dayRange) * 100));
  const range52  = (w52h && w52l && w52h > w52l) ? ((price - w52l) / (w52h - w52l)) * 100 : null;
  const isUp = changePct >= 0;

  // Flash effect on live price change
  const prevPrice = useRef(price);
  const [flash, setFlash] = useState<"up"|"down"|null>(null);
  useEffect(() => {
    if (prevPrice.current !== price && prevPrice.current !== 0) {
      setFlash(price > prevPrice.current ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 700);
      prevPrice.current = price;
      return () => clearTimeout(t);
    }
    prevPrice.current = price;
  }, [price]);

  return (
    <div className="bg-card/60 rounded-2xl border border-border/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Activity className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-foreground">Today's Session</div>
            <div className="text-[10px] text-muted-foreground font-medium">Intraday O/H/L/C & 52W position</div>
          </div>
        </div>
        {/* Live indicator */}
        {livePrice && (
          <div className="flex items-center gap-1 text-[9px] font-bold text-green-600 dark:text-green-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
            </span>
            LIVE
          </div>
        )}
      </div>

      <div className="space-y-3 mt-1">
        {/* Live price with flash */}
        <div className={`flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors duration-500 ${
          flash === "up" ? "bg-green-500/15" : flash === "down" ? "bg-red-500/15" : "bg-muted/20"
        }`}>
          <span className="text-[10px] font-bold text-muted-foreground">Current Price</span>
          <div className="text-right">
            <div className={`text-base font-black tabular-nums ${isUp ? "text-green-500" : "text-red-500"}`}>
              ₹{fmt2(price)}
            </div>
            <div className={`text-[10px] font-bold tabular-nums ${isUp ? "text-green-500" : "text-red-500"}`}>
              {isUp ? "+" : ""}{fmt2(changePct)}%
            </div>
          </div>
        </div>

        {/* Day range bar */}
        <div>
          <div className="flex items-center justify-between text-[9px] text-muted-foreground font-bold mb-1">
            <span>Low ₹{fmt2(low)}</span>
            <span>High ₹{fmt2(high)}</span>
          </div>
          <div className="relative h-3 rounded-full bg-border/30">
            <div className="absolute inset-0 rounded-full overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-red-500/30 via-yellow-500/20 to-green-500/30" />
            </div>
            {/* Open marker */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-400/80 -translate-x-1/2" style={{ left: `${openPos}%` }} />
            {/* Price marker — moves live */}
            <motion.div
              animate={{ left: `${pricePos}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-2 border-card shadow-lg"
              style={{ background: isUp ? "#22c55e" : "#ef4444", boxShadow: `0 0 8px ${isUp ? "#22c55e80" : "#ef444480"}` }}
            />
          </div>
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-1">
            <div className="h-0.5 w-3 bg-yellow-400/80" /><span>Open ₹{fmt2(open)}</span>
          </div>
        </div>

        {/* 52W Range bar */}
        {range52 !== null && (
          <div>
            <div className="flex items-center justify-between text-[9px] text-muted-foreground font-bold mb-1">
              <span>52W Low ₹{fmt2(w52l)}</span>
              <span className={`font-black ${range52 >= 75 ? "text-green-500" : range52 <= 25 ? "text-red-400" : "text-amber-400"}`}>
                {range52.toFixed(0)}% of 52W range
              </span>
              <span>52W High ₹{fmt2(w52h)}</span>
            </div>
            <div className="relative h-2 rounded-full bg-border/30 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 via-yellow-500/20 to-green-500/30" />
              <motion.div
                animate={{ width: `${range52}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={`absolute h-full rounded-full ${range52 >= 75 ? "bg-green-500/70" : range52 <= 25 ? "bg-red-500/70" : "bg-yellow-500/70"}`}
              />
            </div>
          </div>
        )}

        {/* OHLC grid */}
        <div className="grid grid-cols-4 gap-2 pt-1 border-t border-border/20">
          {[
            ["Open",     open,      "text-foreground"],
            ["High",     high,      "text-green-500"],
            ["Low",      low,       "text-red-400"],
            ["Prev",     prevClose, "text-muted-foreground"],
          ].map(([label, val, cls]) => (
            <div key={label as string} className="text-center">
              <div className="text-[9px] text-muted-foreground/70 font-medium">{label}</div>
              <div className={`text-[10px] font-black tabular-nums ${cls}`}>₹{fmt2(val as number)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — layout of all 6 charts
// ─────────────────────────────────────────────────────────────────────────────
interface AnalysisChartsProps {
  stock: any;            // StockDetail shape (60-day OHLCV + quote)
  livePrice?: LivePrice; // SSE live price — updates every 4s
}

export function AnalysisCharts({ stock, livePrice }: AnalysisChartsProps) {
  const candles: any[] = Array.isArray(stock.chartData) ? stock.chartData : [];
  if (candles.length < 5) return null;

  const closes = candles.map(c => c.price ?? c.close);
  const n = closes.length;
  function smaLast(period: number): number | null {
    if (n < period) return null;
    const sl = closes.slice(n - period);
    return sl.reduce((a, b) => a + b, 0) / period;
  }
  const sma5v  = smaLast(5);
  const sma20v = smaLast(20);
  const sma50v = smaLast(50);

  const lastCandleDate = (() => {
    const d = candles[candles.length - 1]?.date;
    if (!d) return "—";
    const [, m, day] = d.split("-").map(Number);
    return `${String(day).padStart(2, "0")} ${MONTHS[m - 1]}`;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-3 mb-6"
    >
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-primary/40" />
          <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">Visual Analysis</span>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-bold text-muted-foreground/60">
          <span>{n} candles · last {lastCandleDate}</span>
          {livePrice && (
            <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Wifi className="h-3 w-3" />
              <span>Live · 4s refresh</span>
            </div>
          )}
        </div>
        <div className="h-px w-8 bg-gradient-to-l from-transparent to-primary/40" />
      </div>

      {/* Row 1: Full-width price chart */}
      <PriceSMAChart candles={candles} />

      {/* Row 2: 3 cols */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <VolumeChart candles={candles} />
        <MomentumDonut candles={candles} />
        <DailyReturnsChart candles={candles} />
      </div>

      {/* Row 3: 2 cols */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <KeyLevelsChart stock={stock} sma5={sma5v} sma20={sma20v} sma50={sma50v} />
        <IntradaySnapshot stock={stock} livePrice={livePrice} />
      </div>

      {/* Divider before AI text analysis */}
      <div className="flex items-center gap-2 px-1 pt-2">
        <div className="h-px flex-1 bg-gradient-to-r from-primary/30 to-transparent" />
        <span className="text-[10px] font-black uppercase tracking-widest text-primary/70 px-2">AI Text Report</span>
        <div className="h-px flex-1 bg-gradient-to-l from-primary/30 to-transparent" />
      </div>
    </motion.div>
  );
}
