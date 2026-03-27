import { ReactNode, useState, useEffect, useRef, createContext, useContext, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Search, Bell, BellRing, Menu, X,
  PanelLeftClose, PanelLeftOpen,
  RefreshCw, Clock, Wifi, WifiOff, TrendingUp, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Exchange } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AlphaSignalLogo } from "@/components/AlphaSignalLogo";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ChatBot } from "@/components/ChatBot";
import { ProfilePanel } from "@/components/ProfilePanel";
import { useAuth } from "@/contexts/AuthContext";

interface LayoutProps {
  children: ReactNode;
}

// ── Layout state context (shared across layout and pages) ───────────────────
interface LayoutCtx {
  collapsed: boolean;
  toggleSidebar: () => void;
  exchange: Exchange;
  setExchange: (e: Exchange) => void;
  mobileOpen: boolean;
  setMobileOpen: (o: boolean) => void;
  // Header controls
  refresh: (() => void) | null;
  setRefresh: (fn: (() => void) | null) => void;
  isFetching: boolean;
  setIsFetching: (f: boolean) => void;
  lastUpdated: string | null;
  setLastUpdated: (t: string | null) => void;
  // Alert badge
  alertCount: number;
  setAlertCount: (n: number) => void;
}

const LayoutContext = createContext<LayoutCtx>({
  collapsed: false,
  toggleSidebar: () => {},
  exchange: "NSE",
  setExchange: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  refresh: null,
  setRefresh: () => {},
  isFetching: false,
  setIsFetching: () => {},
  lastUpdated: null,
  setLastUpdated: () => {},
  alertCount: 0,
  setAlertCount: () => {},
});

export const useLayout = () => useContext(LayoutContext);

// ── Sidebar click sound (Web Audio API — no files needed) ──────────────────
function useSidebarClick() {
  return useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Layer 1: short high tick
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.45, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => ctx.close();
    } catch {}
  }, []);
}

// ── Alert notification sound (Web Audio API — 3-tone chime) ──────────────────
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Three ascending tones: pleasant chime
    const tones = [
      { freq: 523.25, start: 0,    dur: 0.18 },   // C5
      { freq: 659.25, start: 0.14, dur: 0.18 },   // E5
      { freq: 783.99, start: 0.28, dur: 0.32 },   // G5 — hold longer
    ];
    tones.forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });
    // Close context after last tone finishes
    setTimeout(() => ctx.close(), 800);
  } catch {}
}

// ── Alert Toast ────────────────────────────────────────────────────────────────
interface AlertToastProps {
  count: number;
  onClose: () => void;
  onView: () => void;
}
function AlertToast({ count, onClose, onView }: AlertToastProps) {
  // Auto-dismiss after 6 seconds
  useEffect(() => {
    const id = setTimeout(onClose, 6000);
    return () => clearTimeout(id);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 80, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.92 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="fixed top-6 right-6 z-[999] w-[320px] rounded-2xl border border-primary/30 bg-card/95 backdrop-blur-xl shadow-2xl shadow-primary/20 overflow-hidden"
    >
      {/* Animated top progress bar */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: 6, ease: "linear" }}
        style={{ transformOrigin: "left" }}
        className="h-[2px] bg-gradient-to-r from-primary via-primary/80 to-transparent w-full"
      />

      {/* Gradient accent glow */}
      <div className="absolute inset-0 pointer-events-none rounded-2xl"
        style={{ background: "radial-gradient(ellipse at top right, hsl(var(--primary)/0.12), transparent 65%)" }}
      />

      <div className="relative p-4 flex gap-3 items-start">
        {/* Animated bell icon */}
        <motion.div
          animate={{ rotate: [0, -18, 18, -12, 12, -6, 6, 0] }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeInOut" }}
          className="flex-shrink-0 h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shadow-inner"
        >
          <BellRing className="h-5 w-5 text-primary" />
        </motion.div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Zap className="h-3 w-3 text-primary" />
            <span className="text-xs font-black text-foreground tracking-tight">New Signal Alert</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="font-black text-primary">{count}</span>{" "}
            new pattern signal{count !== 1 ? "s" : ""} detected across your watchlist.
          </p>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={onView}
              className="flex items-center gap-1.5 text-[11px] font-black px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-sm shadow-primary/20"
            >
              <TrendingUp className="h-3 w-3" />
              View Alerts
            </button>
            <button
              onClick={onClose}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex-shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors mt-0.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Sidebar Toggle Button ──────────────────────────────────────────────────
function SidebarToggle({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <div className="px-4 pb-2 mt-auto hidden md:block">
      <button
        onClick={onClick}
        className={`
          flex items-center gap-3 rounded-[1.25rem] transition-all duration-200 w-full group
          text-muted-foreground hover:text-foreground
          ${collapsed ? "justify-center p-3" : "px-4 py-3.5 hover:bg-muted/30"}
        `}
      >
        <div className="relative z-10 p-2 rounded-xl transition-colors bg-muted/50 group-hover:bg-primary/20 group-hover:text-primary flex-shrink-0">
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </div>
        <div className={`flex-1 min-w-0 relative z-10 text-left overflow-hidden ${collapsed ? "w-0 opacity-0" : "opacity-100"}`}>
          <div className="font-extrabold text-sm tracking-tight text-foreground group-hover:text-foreground transition-colors whitespace-nowrap">Collapse Panel</div>
        </div>
      </button>
    </div>
  );
}

// ── IST clock ─────────────────────────────────────────────────────────────────
function useISTClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function isMarketOpen(d: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const day  = parts.find(p => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find(p => p.type === "hour")?.value   ?? "0", 10);
  const min  = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  if (day === "Sun" || day === "Sat") return false;
  const hhmm = hour * 100 + min;
  return hhmm >= 915 && hhmm < 1530;
}

function fmtIST(d: Date, opts?: Intl.DateTimeFormatOptions) {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

export function Layout({ children }: LayoutProps) {
  const [, navigate] = useLocation();
  const [location]   = useLocation();
  const [mobileOpen, setMobileOpen]   = useState(false);
  const [collapsed, setCollapsed]     = useState(false);
  const [exchange, setExchange]       = useState<Exchange>("NSE");
  const [profileOpen, setProfileOpen] = useState(false);
  const { user } = useAuth();

  // Header dynamic state
  const [refresh, setRefresh]         = useState<(() => void) | null>(null);
  const [isFetching, setIsFetching]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [alertCount, setAlertCount]   = useState(0);

  // ── Alert toast state ──────────────────────────────────────────────────────
  const [toast, setToast]         = useState<{ count: number } | null>(null);
  const prevAlertCount            = useRef<number | null>(null);  // null = first load
  const toastTimeout              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  const now = useISTClock();
  const marketOpen = isMarketOpen(now);
  const playClick = useSidebarClick();

  useEffect(() => { setMobileOpen(false); }, [location]);

  // ── Background alert count — poll every 90 seconds ───────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchCount = () => {
      fetch(`/api/alerts?exchange=${exchange}`)
        .then(r => r.json())
        .then((data: any[]) => {
          if (cancelled || !Array.isArray(data)) return;
          let readIds: Set<string> = new Set();
          try {
            const stored = localStorage.getItem("alphasignal-alert-read-ids");
            if (stored) readIds = new Set(JSON.parse(stored));
          } catch {}
          let unread = 0;
          data.forEach((stock: any) => {
            (stock.signals ?? []).forEach((sig: any) => {
              if (!readIds.has(`${stock.symbol}-${sig.id}`)) unread++;
            });
          });

          setAlertCount(unread);

          // ── Trigger sound + toast when NEW alerts appear ─────────────────
          // Skip on first load (prevAlertCount.current === null)
          if (prevAlertCount.current !== null && unread > prevAlertCount.current) {
            const newCount = unread - prevAlertCount.current;
            playAlertSound();
            // Clear existing toast timeout before showing new one
            if (toastTimeout.current) clearTimeout(toastTimeout.current);
            setToast({ count: newCount });
          }
          prevAlertCount.current = unread;
        })
        .catch(() => {});
    };
    fetchCount();
    const id = setInterval(fetchCount, 90_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [exchange]);

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, desc: "Pattern signals" },
    { href: "/screener", label: "Screener", icon: Search, desc: "Power filters" },
    { href: "/alerts", label: "Alerts", icon: Bell, desc: "AI Insights" },
  ];


  return (
    <LayoutContext.Provider value={{
      collapsed,
      toggleSidebar: () => setCollapsed(!collapsed),
      exchange,
      setExchange,
      mobileOpen,
      setMobileOpen,
      refresh,
      setRefresh,
      isFetching,
      setIsFetching,
      lastUpdated,
      setLastUpdated,
      alertCount,
      setAlertCount,
    }}>
      <div className="min-h-screen bg-muted/20 flex font-sans selection:bg-primary/10 selection:text-primary">
        
        {/* ── Desktop Sidebar ──────────────────────────────────────────────── */}
        <aside
          style={{ width: collapsed ? 72 : 260, willChange: "width", transform: "translateZ(0)" }}
          className="hidden md:flex flex-col m-4 mr-0 rounded-[2.5rem] border border-border/50 bg-card h-[calc(100vh-2rem)] sticky top-4 z-40 shadow-xl shadow-primary/5 overflow-hidden flex-shrink-0 transition-[width] duration-[100ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
        >
          {/* Logo */}
          <div className={`h-20 flex items-center overflow-hidden whitespace-nowrap flex-shrink-0 ${collapsed ? "justify-center px-3" : "px-5"}`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0">
                <AlphaSignalLogo size={38} />
              </div>
              <div className={`flex flex-col overflow-hidden ${collapsed ? "opacity-0 w-0" : "opacity-100"}`}>
                <span className="font-black text-lg tracking-tight leading-none whitespace-nowrap">AlphaSignal</span>
              </div>
            </div>
          </div>

          <nav className="flex-1 py-10 space-y-2 overflow-y-auto overflow-x-hidden custom-scrollbar px-3">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href} asChild>
                  <a
                    onClick={playClick}
                    className={`
                      flex items-center gap-3 rounded-[1.25rem] transition-all duration-200 group relative
                      ${collapsed ? "justify-center p-3" : "px-4 py-3.5"}
                      ${isActive
                        ? "text-primary"
                        : "text-foreground/70 hover:text-foreground hover:translate-x-1"}
                    `}
                  >
                    {isActive && (
                      <div className="absolute inset-0 bg-primary/10 rounded-[1.25rem] border border-primary/20" />
                    )}

                    <div className={`relative z-10 p-2 rounded-xl transition-colors flex-shrink-0 ${isActive ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted/50 group-hover:bg-muted"}`}>
                      <item.icon className="h-5 w-5" />
                    </div>

                    <div className={`flex-1 min-w-0 relative z-10 overflow-hidden ${collapsed ? "w-0 opacity-0" : "opacity-100"}`}>
                      <div className="font-extrabold text-sm tracking-tight whitespace-nowrap">{item.label}</div>
                      <div className={`text-[11px] font-bold whitespace-nowrap ${isActive ? "text-primary/80" : "text-muted-foreground"}`}>
                        {item.desc}
                      </div>
                    </div>
                  </a>
                </Link>
              );
            })}
          </nav>

          <SidebarToggle collapsed={collapsed} onClick={() => { playClick(); setCollapsed(!collapsed); }} />

        </aside>

        {/* ── Main Content Container ───────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          
          {/* ── HEADER ────────────────────────────────────────────────────── */}
          <header className="h-20 border border-border/50 bg-card/60 backdrop-blur-md sticky top-4 z-30 mx-4 mt-4 mb-2 rounded-[2.5rem] px-4 md:px-6 flex flex-col justify-center shadow-xl shadow-primary/5">
            <div className="flex items-center gap-3">
              {/* Mobile Menu Button */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden rounded-xl border bg-muted/30 flex-shrink-0"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>

              {/* Clock — desktop only */}
              <div className="hidden lg:flex flex-col min-w-0 flex-shrink-0">
                <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 whitespace-nowrap">
                  <Clock className="h-3 w-3" />
                  {fmtIST(now, {
                    weekday: "short", day: "2-digit", month: "short",
                    hour: "2-digit", minute: "2-digit", hour12: true,
                  })} IST
                </p>
              </div>

              {/* ── Global Search Bar ─────────────────────────────────────── */}
              <GlobalSearch />

              {/* ── Right controls ───────────────────────────────────────── */}
              <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                {lastUpdated && (
                  <span className="text-[10px] text-muted-foreground hidden xl:block whitespace-nowrap">
                    Updated {lastUpdated}
                  </span>
                )}

                {refresh && (
                  <button
                    onClick={() => refresh()}
                    disabled={isFetching}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border bg-card hover:bg-accent transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
                    {isFetching ? "Fetching…" : "Refresh"}
                  </button>
                )}

                <div className={`hidden sm:flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg border ${marketOpen ? "bg-green-500/5 border-green-500/30" : "bg-card"}`}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${marketOpen ? "bg-green-500" : "bg-muted-foreground"}`} />
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${marketOpen ? "bg-green-500" : "bg-muted-foreground"}`} />
                  </span>
                  {marketOpen
                    ? <><Wifi className="h-3 w-3 text-green-500" /><span className="text-green-600 dark:text-green-400">{exchange} Live</span></>
                    : <><WifiOff className="h-3 w-3" /><span className="text-muted-foreground">{exchange} Closed</span></>
                  }
                </div>

                <div className="h-8 w-px bg-border/40 hidden sm:block" />

                {/* Exchange Switcher */}
                <div className="flex items-center bg-muted/50 p-1 rounded-xl border border-border/40">
                  {(["NSE", "BSE"] as Exchange[]).map(ex => (
                    <button
                      key={ex}
                      onClick={() => setExchange(ex)}
                      className={`
                        px-3 py-1 rounded-lg text-[10px] font-black tracking-widest transition-all
                        ${exchange === ex
                          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"}
                      `}
                    >
                      {ex}
                    </button>
                  ))}
                </div>

                <Link href="/alerts" asChild>
                  <button className="relative h-8 w-8 rounded-full hidden sm:flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <motion.div
                      animate={alertCount > 0 ? { rotate: [0, -18, 18, -12, 12, -6, 6, 0] } : {}}
                      transition={{ duration: 0.7, repeat: alertCount > 0 ? Infinity : 0, repeatDelay: 4 }}
                    >
                      {alertCount > 0
                        ? <BellRing className="h-4 w-4 text-primary" />
                        : <Bell className="h-4 w-4" />
                      }
                    </motion.div>
                    {alertCount > 0 && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] bg-primary text-primary-foreground text-[9px] font-black rounded-full flex items-center justify-center px-0.5 shadow-sm shadow-primary/30"
                      >
                        {alertCount > 99 ? "99+" : alertCount}
                      </motion.span>
                    )}
                  </button>
                </Link>

                {/* Profile icon */}
                <motion.button
                  onClick={() => setProfileOpen(true)}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.94 }}
                  title="My Profile"
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[13px] font-black text-primary-foreground bg-primary flex-shrink-0 shadow-sm"
                >
                  {user?.name?.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() ?? "?"}
                </motion.button>
              </div>
            </div>
          </header>

          {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
          <main className="flex-1 relative">
            <div className="p-4 md:p-8">
              {children}
            </div>
          </main>

          {/* ── FOOTER ────────────────────────────────────────────────────── */}
          <footer className="mt-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-border/50">
            <p className="text-[11px] font-bold text-muted-foreground text-center sm:text-left">
              For educational use only · Not SEBI investment advice · Past performance ≠ future results · Trading involves risk
            </p>
            <span className="text-[11px] font-bold text-muted-foreground tracking-widest whitespace-nowrap">
              © 2026 ALPHASIGNAL
            </span>
          </footer>

        </div>

        {/* ── Mobile Sidebar Overlay ───────────────────────────────────────── */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden"
                onClick={() => setMobileOpen(false)}
              />
              <motion.aside
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "tween", duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                className="fixed top-4 left-4 bottom-4 w-[calc(100%-2rem)] max-w-[320px] z-50 bg-card/95 backdrop-blur-md rounded-[2.5rem] border border-border/50 shadow-2xl flex flex-col md:hidden"
              >
                <div className="h-20 flex items-center justify-between px-6 border-b border-border/20">
                   <div className="flex items-center gap-3">
                    <AlphaSignalLogo size={38} />
                    <span className="font-black text-xl tracking-tighter">AlphaSignal</span>
                  </div>
                  <Button variant="ghost" size="icon" className="rounded-xl bg-muted/50" onClick={() => setMobileOpen(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                
                <nav className="flex-1 p-6 space-y-3 overflow-y-auto">
                  {navItems.map((item, idx) => {
                    const isActive = location === item.href;
                    return (
                      <Link key={item.href} href={item.href} asChild>
                        <motion.a
                          onClick={playClick}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className={`
                            flex items-center gap-4 p-4 rounded-[1.5rem] transition-all
                            ${isActive ? "bg-primary/10 text-primary border border-primary/20" : "text-muted-foreground active:bg-muted"}
                          `}
                        >
                          <div className={`p-2.5 rounded-xl ${isActive ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted/50"}`}>
                            <item.icon className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-bold text-base tracking-tight">{item.label}</div>
                            <div className={`text-xs opacity-70 font-medium ${isActive ? "text-primary/80" : ""}`}>{item.desc}</div>
                          </div>
                        </motion.a>
                      </Link>
                    );
                  })}
                </nav>


              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* ── Alert Toast Notification ─────────────────────────────────────── */}
        <AnimatePresence>
          {toast && (
            <AlertToast
              key="alert-toast"
              count={toast.count}
              onClose={dismissToast}
              onView={() => { dismissToast(); navigate("/alerts"); }}
            />
          )}
        </AnimatePresence>

        {/* ── AlphaSignal Bot — floating bottom-right, z-50 ─────────────────── */}
        <ChatBot />

        {/* ── Profile Panel ──────────────────────────────────────────────────── */}
        <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
      </div>
    </LayoutContext.Provider>
  );
}
