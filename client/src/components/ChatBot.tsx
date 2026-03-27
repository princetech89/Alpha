/**
 * AlphaSignal Bot — Animated RAG Chatbot
 *
 * - Queries Pinecone knowledge base first (pre-stored docs)
 * - Falls back to OpenAI for stock/trading topics only if KB has no match
 * - Off-topic queries are politely declined
 * - No PDF upload UI — documents are pre-loaded server-side
 */

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X, Send, ChevronDown, Sparkles,
  User, AlertCircle, CheckCircle2, RotateCcw,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  sources?: { text: string; source?: string; score: number }[];
  fromKB?: boolean;
}

// ── Suggested quick prompts ────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  "What is a Head & Shoulders pattern?",
  "How do I read RSI divergence signals?",
  "Explain MACD crossover pattern",
  "What does bullish confidence score mean?",
  "How does the screener work?",
  "What is a Double Bottom pattern?",
];

// ── TypingDots animation ──────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-2 h-2 rounded-full bg-emerald-400"
          animate={{ y: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

// ── Bot avatar ────────────────────────────────────────────────────────────────
function BotAvatar({ size = 28 }: { size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden bg-[#0f172a]"
      style={{ width: size, height: size, boxShadow: "0 0 10px rgba(0,242,255,0.25)" }}
    >
      <img src="/favicon.svg" alt="AlphaSignal" style={{ width: size * 0.85, height: size * 0.85, objectFit: "contain" }} />
    </div>
  );
}

// ── Single message bubble — memoized so streaming doesn't re-render old msgs ──
const MessageBubble = memo(function MessageBubble({ msg, isNew }: { msg: Message; isNew: boolean }) {
  const isUser = msg.role === "user";
  const isErr  = msg.role === "error";

  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"} items-end`}
    >
      {/* Bot/error avatar */}
      {!isUser && (isErr
        ? <div className="w-7 h-7 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-red-400" />
          </div>
        : <BotAvatar size={28} />
      )}

      <div className={`flex flex-col gap-1 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
        {/* Bubble */}
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-emerald-500 text-black rounded-br-sm font-medium"
              : isErr
              ? "bg-red-500/10 border border-red-500/30 text-red-400 rounded-bl-sm"
              : "bg-zinc-800/90 border border-zinc-700/60 text-zinc-100 rounded-bl-sm"
          }`}
          style={!isUser && !isErr ? { boxShadow: "0 0 0 1px rgba(0,242,255,0.06) inset" } : undefined}
        >
          {isUser || isErr ? (
            <span>{msg.content}</span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p:      ({ children }) => <p className="mb-1.5 last:mb-0 text-justify leading-relaxed">{children}</p>,
                strong: ({ children }) => <strong className="text-emerald-300 font-bold">{children}</strong>,
                ul:     ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1.5">{children}</ul>,
                ol:     ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1.5">{children}</ol>,
                li:     ({ children }) => <li className="text-zinc-200 text-justify">{children}</li>,
                code:   ({ children }) => <code className="bg-zinc-700/60 rounded px-1 text-xs text-cyan-300 font-mono">{children}</code>,
                h1:     ({ children }) => <h1 className="font-bold text-white text-base mt-3 mb-1.5 border-b border-zinc-700 pb-1">{children}</h1>,
                h2:     ({ children }) => <h2 className="font-bold text-emerald-300 text-sm mt-2.5 mb-1">{children}</h2>,
                h3:     ({ children }) => <h3 className="font-bold text-emerald-400 text-sm mt-2 mb-1">{children}</h3>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {/* Knowledge base badge */}
        {msg.fromKB && msg.sources && msg.sources.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-emerald-500/70">
            <CheckCircle2 className="w-3 h-3" />
            <span>Answered from knowledge base</span>
          </div>
        )}
        {!msg.fromKB && msg.role === "assistant" && !isErr && (
          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
            <Sparkles className="w-3 h-3" />
            <span>Answered by AI</span>
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-emerald-400" />
        </div>
      )}
    </motion.div>
  );
});

// ── Main ChatBot component ────────────────────────────────────────────────────
export function ChatBot() {
  const [open, setOpen]               = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [showPrompts, setShowPrompts] = useState(true);
  const [pineconeOk, setPineconeOk]   = useState<boolean | null>(null);
  const [unread, setUnread]           = useState(0);

  const bottomRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);
  const msgCounter    = useRef(0);
  // Track which message IDs are "new" (should animate in)
  const newMsgIds     = useRef<Set<string>>(new Set());
  // Debounce scroll — don't scroll on every streaming chunk
  const scrollTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest open state accessible inside streaming callback without stale closure
  const openRef       = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  // Check Pinecone status on mount
  useEffect(() => {
    fetch("/api/chat/status")
      .then(r => r.json())
      .then(d => setPineconeOk(d.pineconeReady))
      .catch(() => setPineconeOk(false));
  }, []);

  // Debounced scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 80);
  }, []);

  // Scroll on new messages / loading state, but debounced
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Focus input and clear unread when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 120);
      setUnread(0);
    }
  }, [open]);

  // Cleanup scroll timer on unmount
  useEffect(() => () => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;

    const userMsgId = `msg-${++msgCounter.current}`;
    newMsgIds.current.add(userMsgId);

    // Capture history snapshot before state update
    setMessages(prev => {
      const history = prev.slice(-8)
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      // Fire fetch inside the setState callback to capture fresh history
      // Use async IIFE to not block setState
      (async () => {
        setInput("");
        setLoading(true);
        setShowPrompts(false);

        try {
          const res = await fetch("/api/chat/stream", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ query: q, messages: history }),
          });
          if (!res.ok || !res.body) throw new Error("Server error");

          const botId   = `msg-${++msgCounter.current}`;
          newMsgIds.current.add(botId);
          const reader  = res.body.getReader();
          const decoder = new TextDecoder();
          let   buffer  = "";
          let   started = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "meta") {
                  if (!started) {
                    started = true;
                    setMessages(p => [...p, { id: botId, role: "assistant", content: "", fromKB: ev.fromKnowledgeBase, sources: ev.sources }]);
                    setLoading(false);
                  }
                } else if (ev.type === "chunk") {
                  if (!started) {
                    started = true;
                    setMessages(p => [...p, { id: botId, role: "assistant", content: ev.text }]);
                    setLoading(false);
                  } else {
                    setMessages(p => p.map(m =>
                      m.id === botId ? { ...m, content: m.content + ev.text } : m
                    ));
                  }
                } else if (ev.type === "error") {
                  throw new Error(ev.error);
                }
              } catch { /* skip malformed lines */ }
            }
          }
          if (!openRef.current) setUnread(u => u + 1);
        } catch (err: any) {
          setLoading(false);
          const errId = `msg-${++msgCounter.current}`;
          newMsgIds.current.add(errId);
          setMessages(p => [...p, {
            id:      errId,
            role:    "error",
            content: err.message ?? "Something went wrong. Please try again.",
          }]);
        }
      })();

      return [...prev, { id: userMsgId, role: "user" as const, content: q }];
    });
  }, [loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    setMessages([]);
    newMsgIds.current.clear();
    setShowPrompts(true);
  };

  return (
    <>
      {/* ── Chat Panel ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "tween", duration: 0.15, ease: "easeOut" }}
            className="fixed bottom-20 right-4 z-50 flex flex-col rounded-2xl overflow-hidden shadow-2xl"
            style={{
              width: "min(360px, calc(100vw - 2rem))",
              maxHeight: "min(560px, calc(100vh - 6rem))",
              background: "linear-gradient(160deg, #0f172a 0%, #0c1424 100%)",
              border: "1px solid rgba(0,242,255,0.15)",
              boxShadow: "0 0 0 1px rgba(0,242,255,0.08) inset, 0 20px 60px rgba(0,0,0,0.7), 0 0 40px rgba(0,242,255,0.06)",
            }}
          >
            {/* ── Header ───────────────────────────────────────────────────── */}
            <div
              className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0"
              style={{
                background: "linear-gradient(90deg, rgba(0,242,255,0.07) 0%, rgba(16,185,129,0.07) 100%)",
                borderBottom: "1px solid rgba(0,242,255,0.12)",
              }}
            >
              <BotAvatar size={34} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white text-sm tracking-tight">AlphaSignal Bot</span>
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </div>
                <p className="text-[10px] text-zinc-400">Stock market AI assistant</p>
              </div>

              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    title="Clear chat"
                    className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Messages ─────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0 scrollbar-thin">
              {/* Welcome */}
              {messages.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className="text-center py-4"
                >
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center bg-[#0f172a]"
                    style={{ border: "1px solid rgba(0,242,255,0.2)" }}
                  >
                    <img src="/favicon.svg" alt="AlphaSignal" className="w-9 h-9 object-contain" />
                  </div>
                  <p className="text-white font-semibold text-sm">Hey, I'm AlphaSignal Bot!</p>
                  <p className="text-zinc-400 text-xs mt-1 px-4 leading-relaxed">
                    Ask me anything about stock patterns, signals, technical analysis, or how to use this platform.
                  </p>
                </motion.div>
              )}

              {/* Messages */}
              {messages.map(msg => {
                const isNew = newMsgIds.current.has(msg.id);
                if (isNew) newMsgIds.current.delete(msg.id);
                return <MessageBubble key={msg.id} msg={msg} isNew={isNew} />;
              })}

              {/* Typing indicator */}
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.1 }}
                  className="flex gap-2 items-end"
                >
                  <BotAvatar size={28} />
                  <div
                    className="rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-zinc-800/90 border border-zinc-700/60"
                    style={{ boxShadow: "0 0 0 1px rgba(0,242,255,0.06) inset" }}
                  >
                    <TypingDots />
                  </div>
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* ── Quick prompts ─────────────────────────────────────────────── */}
            <AnimatePresence>
              {showPrompts && messages.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="px-3 pb-2 flex-shrink-0"
                >
                  <p className="text-[10px] text-zinc-500 mb-1.5 px-1">Suggested questions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PROMPTS.map(p => (
                      <button
                        key={p}
                        onClick={() => sendMessage(p)}
                        className="text-[11px] px-2.5 py-1 rounded-full border border-zinc-700/60 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all duration-150"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Input bar ────────────────────────────────────────────────── */}
            <div
              className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
              style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about stocks, patterns, signals…"
                disabled={loading}
                className="flex-1 min-w-0 bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all disabled:opacity-50"
              />

              <motion.button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
                className="p-2 rounded-xl flex-shrink-0 disabled:opacity-30 transition-colors"
                style={{
                  background: input.trim() && !loading
                    ? "linear-gradient(135deg, #00f2ff 0%, #10b981 100%)"
                    : "rgba(255,255,255,0.06)",
                }}
              >
                <Send
                  className="w-4 h-4"
                  style={{ color: input.trim() && !loading ? "#000" : "#6b7280" }}
                />
              </motion.button>
            </div>

          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating Button ──────────────────────────────────────────────────── */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.94 }}
        className="fixed bottom-4 right-4 z-50 rounded-full flex items-center justify-center"
        style={{ width: 56, height: 56, background: "transparent" }}
        aria-label={open ? "Close AlphaSignal Bot" : "Open AlphaSignal Bot"}
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ type: "tween", duration: 0.15 }}
              className="w-14 h-14 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center shadow-lg"
            >
              <X className="w-5 h-5 text-zinc-300" />
            </motion.div>
          ) : (
            <motion.div
              key="bot"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ type: "tween", duration: 0.15 }}
            >
              <img src="/favicon.svg" alt="AlphaSignal" style={{ width: 56, height: 56, objectFit: "contain", filter: "drop-shadow(0 4px 12px rgba(0,242,255,0.4))" }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unread badge */}
        <AnimatePresence>
          {unread > 0 && !open && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"
              style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}
            >
              {unread}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}
