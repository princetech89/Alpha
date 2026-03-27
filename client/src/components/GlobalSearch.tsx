import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, TrendingUp, TrendingDown, Minus, X, Loader2, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SearchResult {
  symbol: string;
  name: string;
  sector: string;
  exchange: "NSE" | "BSE";
  currentPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  score: number;
  dataSource: string;
}

function fmt(n: number) {
  if (!n || isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// ── Animated shimmer placeholder ───────────────────────────────────────────────
const PLACEHOLDERS = [
  "Search any stock…",
  "Try RELIANCE, HDFC…",
  "Find TCS, INFY…",
  "Search by name…",
  "BSE or NSE stocks…",
];

function useCyclePlaceholder() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx(i => (i + 1) % PLACEHOLDERS.length), 3000);
    return () => clearInterval(id);
  }, []);
  return PLACEHOLDERS[idx];
}

export function GlobalSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [focused, setFocused]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [error, setError]       = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef  = useRef<HTMLDivElement>(null);
  const debRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const placeholder = useCyclePlaceholder();

  // ── Debounced search ─────────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); setLoading(false); return; }
    try { abortRef.current?.abort(); } catch {}
    abortRef.current = new AbortController();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchResult[] = await res.json();
      setResults(data);
      setOpen(true);
      setActiveIdx(-1);
    } catch (e: any) {
      if (e.name === "AbortError") return;
      setError("Search failed. Try again.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!query.trim()) { setResults([]); setOpen(false); setLoading(false); return; }
    setLoading(true);
    debRef.current = setTimeout(() => doSearch(query), 320);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [query, doSearch]);

  // ── Keyboard nav ─────────────────────────────────────────────────────────────
  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown")  { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp")  { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const idx = activeIdx >= 0 ? activeIdx : 0;
      if (results[idx]) goToStock(results[idx]);
    } else if (e.key === "Escape") {
      setOpen(false); setFocused(false); inputRef.current?.blur();
    }
  }, [open, results, activeIdx]);

  const goToStock = useCallback((r: SearchResult) => {
    navigate(`/stock/${r.symbol}?exchange=${r.exchange}`);
    setQuery(""); setOpen(false); setResults([]);
  }, [navigate]);

  // ── Outside click ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        dropRef.current  && !dropRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.closest("[data-search-root]")?.contains(e.target as Node)
      ) { setOpen(false); setFocused(false); }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // ── Ctrl+K shortcut ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        if (results.length > 0) setOpen(true);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [results]);

  const isActive = focused || open;

  return (
    <div
      data-search-root
      className="relative flex-1 max-w-[440px]"
      style={{ minWidth: 0 }}
    >
      {/* ── Animated glow ring ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="absolute -inset-[3px] rounded-[14px] z-0 pointer-events-none"
            style={{
              background: "linear-gradient(135deg, hsl(var(--primary)/0.5), hsl(var(--primary)/0.15), hsl(var(--primary)/0.4))",
              filter: "blur(6px)",
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Input box ────────────────────────────────────────────────────────── */}
      <motion.div
        animate={{
          scale: isActive ? 1.01 : 1,
          boxShadow: isActive
            ? "0 0 0 1.5px hsl(var(--primary)/0.5), 0 4px 20px hsl(var(--primary)/0.15)"
            : "none",
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className={`
          relative z-10 flex items-center gap-2 px-3 h-10 rounded-[12px] border transition-colors duration-200
          ${isActive
            ? "bg-card border-primary/40"
            : "bg-muted/40 border-border/40 hover:bg-muted/60 hover:border-border/60"}
        `}
      >
        {/* Icon: spinner or search */}
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="spinner"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
              transition={{ duration: 0.15 }}
            >
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin flex-shrink-0" />
            </motion.div>
          ) : (
            <motion.div
              key="searchicon"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
            >
              <Search className={`h-3.5 w-3.5 flex-shrink-0 transition-colors duration-200 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <div className="flex-1 relative min-w-0 overflow-hidden">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true); }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKey}
            className="w-full bg-transparent text-xs font-semibold outline-none text-foreground min-w-0"
            autoComplete="off"
            spellCheck={false}
          />
          {/* Animated placeholder */}
          {!query && (
            <AnimatePresence mode="wait">
              <motion.span
                key={placeholder}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute inset-0 pointer-events-none text-xs font-medium text-muted-foreground/50 flex items-center"
              >
                {placeholder}
              </motion.span>
            </AnimatePresence>
          )}
        </div>

        {/* Clear button */}
        <AnimatePresence>
          {query && (
            <motion.button
              initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
              transition={{ duration: 0.15 }}
              onMouseDown={e => { e.preventDefault(); setQuery(""); setResults([]); setOpen(false); }}
              className="flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center bg-muted/80 text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Ctrl+K badge */}
        {!query && (
          <motion.kbd
            animate={{ opacity: isActive ? 0 : 1 }}
            transition={{ duration: 0.15 }}
            className="hidden sm:flex items-center gap-0.5 text-[9px] font-bold text-muted-foreground/40 bg-muted/60 border border-border/30 rounded-md px-1.5 py-0.5 flex-shrink-0 pointer-events-none"
          >
            ⌘K
          </motion.kbd>
        )}
      </motion.div>

      {/* ── Dropdown ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={dropRef}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="absolute top-[calc(100%+10px)] left-0 right-0 z-[200] rounded-2xl border border-border/50 bg-card/96 backdrop-blur-xl shadow-2xl shadow-black/25 overflow-hidden"
            style={{ minWidth: 360 }}
          >
            {/* Gradient top accent */}
            <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

            {/* Header bar */}
            {results.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.05 }}
                className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between bg-muted/20"
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {results.length} result{results.length !== 1 ? "s" : ""} · NSE & BSE
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                  </span>
                  <span className="text-[9px] font-black text-green-600 dark:text-green-400 uppercase tracking-wider">Live</span>
                </div>
              </motion.div>
            )}

            {/* No results */}
            {results.length === 0 && !loading && query.trim() && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="px-4 py-8 text-center"
              >
                <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No results for <span className="font-bold text-foreground">"{query}"</span>
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Try a different symbol or company name</p>
              </motion.div>
            )}

            {error && (
              <div className="px-4 py-3 text-xs text-destructive font-medium">{error}</div>
            )}

            {/* Results list */}
            <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
              {results.map((r, idx) => {
                const isUp     = r.changePercent > 0;
                const isDown   = r.changePercent < 0;
                const isRowActive = idx === activeIdx;
                const rangePos = r.high > r.low
                  ? Math.max(5, Math.min(100, ((r.currentPrice - r.low) / (r.high - r.low)) * 100))
                  : 50;

                return (
                  <motion.button
                    key={`${r.symbol}-${r.exchange}`}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18, delay: idx * 0.04, ease: "easeOut" }}
                    onMouseDown={e => { e.preventDefault(); goToStock(r); }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={`
                      w-full text-left px-4 py-3.5 flex items-center gap-3
                      border-b border-border/15 last:border-0
                      transition-colors duration-100 relative overflow-hidden
                      ${isRowActive ? "bg-primary/8" : "hover:bg-muted/30"}
                    `}
                  >
                    {/* Active highlight bar */}
                    <AnimatePresence>
                      {isRowActive && (
                        <motion.div
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          exit={{ scaleY: 0 }}
                          className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r-full"
                        />
                      )}
                    </AnimatePresence>

                    {/* Symbol avatar */}
                    <div className={`
                      h-9 w-9 rounded-xl flex-shrink-0 flex items-center justify-center font-black text-[10px] tracking-tight
                      ${isUp   ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
                      : isDown ? "bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20"
                               : "bg-muted/60 text-muted-foreground border border-border/30"}
                    `}>
                      {r.symbol.slice(0, 3)}
                    </div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-sm text-foreground tracking-tight">{r.symbol}</span>
                        <span className={`
                          text-[8px] font-black px-1.5 py-0.5 rounded-md tracking-wider border
                          ${r.exchange === "NSE"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                            : "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"}
                        `}>
                          {r.exchange}
                        </span>
                        {r.dataSource === "Upstox" && (
                          <span className="text-[8px] font-black px-1 py-0.5 rounded border bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20">
                            UPSTOX
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-medium truncate mt-0.5">{r.name}</div>
                      {/* Range bar */}
                      {r.high > 0 && r.low > 0 && r.high !== r.low && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[8px] text-muted-foreground/50 tabular-nums">{fmt(r.low)}</span>
                          <div className="flex-1 h-1 rounded-full bg-border/40 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${rangePos}%` }}
                              transition={{ duration: 0.5, delay: idx * 0.04 + 0.1, ease: "easeOut" }}
                              className={`h-full rounded-full ${isUp ? "bg-green-500" : isDown ? "bg-red-500" : "bg-muted-foreground"}`}
                            />
                          </div>
                          <span className="text-[8px] text-muted-foreground/50 tabular-nums">{fmt(r.high)}</span>
                        </div>
                      )}
                    </div>

                    {/* Price + change */}
                    <div className="text-right flex-shrink-0 ml-1">
                      {r.currentPrice > 0 ? (
                        <>
                          <div className="font-black text-sm tabular-nums text-foreground">
                            ₹{fmt(r.currentPrice)}
                          </div>
                          <div className={`
                            inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums mt-0.5
                            px-1.5 py-0.5 rounded-md
                            ${isUp
                              ? "bg-green-500/10 text-green-600 dark:text-green-400"
                              : isDown
                              ? "bg-red-500/10 text-red-500 dark:text-red-400"
                              : "bg-muted/60 text-muted-foreground"}
                          `}>
                            {isUp   ? <TrendingUp   className="h-2.5 w-2.5" /> :
                             isDown ? <TrendingDown className="h-2.5 w-2.5" /> :
                                      <Minus        className="h-2.5 w-2.5" />}
                            {isUp ? "+" : ""}{fmt(r.changePercent)}%
                          </div>
                        </>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/60">—</span>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* Footer */}
            {results.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="px-4 py-2 border-t border-border/20 bg-muted/10 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 text-[9px] text-muted-foreground/40 font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1"><kbd className="bg-muted/60 border border-border/30 rounded px-1">↑↓</kbd> Navigate</span>
                  <span className="flex items-center gap-1"><kbd className="bg-muted/60 border border-border/30 rounded px-1">↵</kbd> Open</span>
                  <span className="flex items-center gap-1"><kbd className="bg-muted/60 border border-border/30 rounded px-1">Esc</kbd> Close</span>
                </div>
                <span className="text-[9px] text-muted-foreground/30 font-bold">⌘K</span>
              </motion.div>
            )}

            {/* Gradient bottom accent */}
            <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
