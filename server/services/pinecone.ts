/**
 * AlphaSignal Bot — Pinecone RAG + OpenAI Chat Backend
 *
 * Responsibilities:
 *  - Embed user queries with OpenAI text-embedding-3-small
 *  - Query Pinecone for relevant knowledge-base chunks
 *  - Generate answers with GPT-4o, grounding with Pinecone context
 *  - Ingest PDF documents into Pinecone (chunked, embedded, upserted)
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAI } from "openai";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");

// ── Eager-init clients (no cold-start on first request) ────────────────────────
const _openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const _pc = process.env.PINECONE_API_KEY
  ? new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
  : null;

function getOpenAI(): OpenAI {
  if (!_openai) throw new Error("OPENAI_API_KEY not set");
  return _openai;
}

function getPinecone(): Pinecone {
  if (!_pc) throw new Error("PINECONE_API_KEY not set in .env");
  return _pc;
}

function getPineconeIndex() {
  const indexName = process.env.PINECONE_INDEX ?? "alphasignal-kb";
  return getPinecone().index(indexName);
}


/** Returns true if Pinecone is configured */
export function isPineconeReady(): boolean {
  return !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX);
}

// ── Embedding with local cache ────────────────────────────────────────────────
const _embedCache = new Map<string, number[]>();

async function embed(text: string): Promise<number[]> {
  const key = text.slice(0, 200);
  if (_embedCache.has(key)) return _embedCache.get(key)!;
  const res = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 4000),
  });
  const vec = res.data[0].embedding;
  if (_embedCache.size > 200) _embedCache.delete(_embedCache.keys().next().value as string);
  _embedCache.set(key, vec);
  return vec;
}

// ── Query Pinecone ─────────────────────────────────────────────────────────────
export interface PineconeMatch {
  id: string;
  score: number;
  text: string;
  source?: string;
}

// ── Response cache (avoids repeated embed+Pinecone+OpenAI for same query) ──────
const _cache = new Map<string, { matches: PineconeMatch[]; answer: string }>();
const CACHE_MAX = 120;

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
function cacheGet(query: string) { return _cache.get(cacheKey(query)); }
function cacheSet(query: string, value: { matches: PineconeMatch[]; answer: string }) {
  const key = cacheKey(query);
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value as string);
  _cache.set(key, value);
}

export async function queryKnowledgeBase(
  query: string,
  topK = 3,
  minScore = 0.3
): Promise<PineconeMatch[]> {
  if (!isPineconeReady()) return [];
  try {
    const vector = await embed(query);
    const index  = getPineconeIndex();
    const result = await index.query({ vector, topK, includeMetadata: true });
    return (result.matches ?? [])
      .filter(m => (m.score ?? 0) >= minScore)
      .map(m => ({
        id:     m.id,
        score:  m.score ?? 0,
        text:   (m.metadata?.text as string) ?? "",
        source: (m.metadata?.source as string) ?? undefined,
      }));
  } catch (err) {
    console.error("[Pinecone] query error:", err);
    return [];
  }
}

// ── Ingest PDF ─────────────────────────────────────────────────────────────────
function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const words  = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + chunkSize).join(" ");
    if (slice.trim().length > 50) chunks.push(slice.trim());
    i += chunkSize - overlap;
  }
  return chunks;
}

export async function ingestPdfBuffer(
  buffer: Buffer,
  filename: string
): Promise<{ chunks: number; message: string }> {
  if (!isPineconeReady()) {
    return { chunks: 0, message: "Pinecone not configured (check .env)" };
  }

  // 1. Parse PDF
  const parsed = await pdfParse(buffer);
  const raw    = parsed.text.replace(/\s+/g, " ").trim();
  if (raw.length < 100) {
    return { chunks: 0, message: "PDF has no readable text" };
  }

  // 2. Chunk
  const chunks = chunkText(raw, 800, 120);
  console.log(`[Pinecone] Ingesting "${filename}" → ${chunks.length} chunks`);

  // 3. Embed + upsert in batches of 50
  const index   = getPineconeIndex();
  const batchSz = 50;
  const ts      = Date.now();

  for (let b = 0; b < chunks.length; b += batchSz) {
    const batch    = chunks.slice(b, b + batchSz);
    const vectors  = await Promise.all(
      batch.map(async (text, i) => ({
        id:       `${filename.replace(/[^a-z0-9]/gi, "_")}_${ts}_${b + i}`,
        values:   await embed(text),
        metadata: { text, source: filename, chunk: b + i },
      }))
    );
    await index.upsert(vectors as any);
  }

  return { chunks: chunks.length, message: `Ingested ${chunks.length} chunks from "${filename}"` };
}

// ── Topic classifier — allowed topics for OpenAI fallback ─────────────────────
// When Pinecone has no match, OpenAI is ONLY allowed to answer these topics.
const ALLOWED_TOPICS = [
  "stock", "share", "equity", "market", "trading", "trade", "invest",
  "nse", "bse", "sensex", "nifty", "index", "exchange",
  "technical analysis", "chart", "pattern", "signal", "indicator",
  "rsi", "macd", "bollinger", "ema", "sma", "moving average",
  "candlestick", "volume", "breakout", "reversal", "momentum",
  "bullish", "bearish", "support", "resistance", "trend",
  "head and shoulders", "double top", "double bottom", "flag", "wedge",
  "fibonacci", "retracement", "pivot", "swing",
  "screener", "alert", "alphasignal", "alphagenius", "angel one", "upstox",
  "portfolio", "position", "stop loss", "target", "risk", "reward",
  "sector", "fundamental", "earnings", "dividend", "ipo",
  "intraday", "swing trade", "delivery", "futures", "options", "f&o",
];

function isAllowedQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return ALLOWED_TOPICS.some(topic => lower.includes(topic));
}

// ── Off-topic refusal message ──────────────────────────────────────────────────
const OFF_TOPIC_REPLY =
  "I'm **AlphaSignal Bot**, specialized in stock markets, technical analysis, and trading. " +
  "I can only answer questions related to:\n\n" +
  "- 📈 **Stock patterns** (Head & Shoulders, MACD, RSI, Bollinger Bands, etc.)\n" +
  "- 🏦 **NSE / BSE markets**, Nifty, Sensex, indices\n" +
  "- 🔔 **AlphaSignal features** — screener, alerts, AI Brain Analysis\n" +
  "- 💹 **Trading concepts** — support/resistance, breakouts, risk management\n\n" +
  "Please ask me something related to stocks or trading and I'll be happy to help!";

// ── Generate Chat Answer ───────────────────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function generateChatAnswer(
  messages: ChatMessage[],
  pineconeMatches: PineconeMatch[]
): Promise<string> {
  const hasKBContext = pineconeMatches.length > 0;

  // Extract the latest user query for topic check
  const latestUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";

  // If Pinecone has no context AND the query is off-topic → refuse without calling OpenAI
  if (!hasKBContext && !isAllowedQuery(latestUserMsg)) {
    return OFF_TOPIC_REPLY;
  }

  const contextBlock = hasKBContext
    ? pineconeMatches.map((m, i) => `[${i + 1}] ${m.text}`).join("\n\n")
    : "";

  // ── CASE 1: Pinecone has relevant chunks — answer STRICTLY from KB only ──────
  const systemPrompt = hasKBContext
    ? `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The following are the ONLY pieces of information you are allowed to use to answer the user's question. They come from the official AlphaSignal knowledge base document:

--- KNOWLEDGE BASE ---
${contextBlock}
--- END OF KNOWLEDGE BASE ---

STRICT RULES — follow these without exception:
1. Answer ONLY using the information explicitly stated in the knowledge base above.
2. Do NOT add, invent, or infer any information that is not directly stated in those chunks.
3. Do NOT use your own training data to supplement the answer.
4. If the knowledge base chunks above do not fully answer the question, say exactly: "I only have partial information on this. Based on the knowledge base: [what you found]."
5. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural.
6. Keep the answer concise and accurate — do not pad with general knowledge.`

  // ── CASE 2: Not in KB but on-topic — OpenAI with strict anti-hallucination ───
    : `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The user's question was searched in the knowledge base but NO relevant document was found.

You may answer ONLY if the question is about a well-established, factual concept in stock market technical analysis (e.g., what RSI is, how MACD works, what a candlestick pattern means).

STRICT RULES — follow these without exception:
1. Answer ONLY from well-established, universally accepted facts about stock markets and technical analysis.
2. Do NOT guess, speculate, or generate plausible-sounding but unverified information.
3. Do NOT answer questions about specific stock prices, future predictions, news, or company-specific data.
4. If you are not 100% certain of the answer, respond with: "This specific information is not available in my knowledge base. Please refer to the AlphaSignal platform or consult a SEBI-registered adviser."
5. If the question is about AlphaSignal-specific features or settings not covered in your knowledge, say: "I don't have that specific information. Please use the app directly or contact support."
6. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural. Keep responses concise (under 250 words).
7. Never fabricate — accuracy over completeness.`;

  const completion = await getOpenAI().chat.completions.create({
    model:       "gpt-4o-mini",
    temperature: 0,           // zero temperature = no randomness, no hallucination
    max_tokens:  400,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  });

  return completion.choices[0]?.message?.content ?? "I'm sorry, I couldn't generate a response. Please try again.";
}

// ── Streaming Chat Answer ──────────────────────────────────────────────────────
export async function streamChatAnswer(
  messages: ChatMessage[],
  pineconeMatches: PineconeMatch[],
  onChunk: (text: string) => void
): Promise<void> {
  const hasKBContext = pineconeMatches.length > 0;
  const latestUserMsg = [...messages].reverse().find(m => m.role === "user")?.content ?? "";

  if (!hasKBContext && !isAllowedQuery(latestUserMsg)) {
    onChunk(OFF_TOPIC_REPLY);
    return;
  }

  const contextBlock = hasKBContext
    ? pineconeMatches.map((m, i) => `[${i + 1}] ${m.text}`).join("\n\n")
    : "";

  const systemPrompt = hasKBContext
    ? `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The following are the ONLY pieces of information you are allowed to use to answer the user's question. They come from the official AlphaSignal knowledge base document:

--- KNOWLEDGE BASE ---
${contextBlock}
--- END OF KNOWLEDGE BASE ---

STRICT RULES — follow these without exception:
1. Answer ONLY using the information explicitly stated in the knowledge base above.
2. Do NOT add, invent, or infer any information that is not directly stated in those chunks.
3. Do NOT use your own training data to supplement the answer.
4. If the knowledge base chunks above do not fully answer the question, say exactly: "I only have partial information on this. Based on the knowledge base: [what you found]."
5. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural.
6. Keep the answer concise and accurate — do not pad with general knowledge.`
    : `You are AlphaSignal Bot, an AI assistant for the AlphaSignal stock analysis platform.

The user's question was searched in the knowledge base but NO relevant document was found.

You may answer ONLY if the question is about a well-established, factual concept in stock market technical analysis (e.g., what RSI is, how MACD works, what a candlestick pattern means).

STRICT RULES — follow these without exception:
1. Answer ONLY from well-established, universally accepted facts about stock markets and technical analysis.
2. Do NOT guess, speculate, or generate plausible-sounding but unverified information.
3. Do NOT answer questions about specific stock prices, future predictions, news, or company-specific data.
4. If you are not 100% certain of the answer, respond with: "This specific information is not available in my knowledge base. Please refer to the AlphaSignal platform or consult a SEBI-registered adviser."
5. If the question is about AlphaSignal-specific features or settings not covered in your knowledge, say: "I don't have that specific information. Please use the app directly or contact support."
6. Format with markdown: use **bold** for key terms, ### for section headers, bullet points where natural. Keep responses concise (under 250 words).
7. Never fabricate — accuracy over completeness.`;

  // Check cache first — return instantly for repeated queries
  const cached = cacheGet(latestUserMsg);
  if (cached) {
    onChunk(cached.answer);
    return;
  }

  const stream = await getOpenAI().chat.completions.create({
    model:       "gpt-4o-mini",
    temperature: 0,
    max_tokens:  250,
    stream:      true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ],
  });

  let fullAnswer = "";
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) { onChunk(text); fullAnswer += text; }
  }

  // Store in cache for instant future responses
  if (fullAnswer) cacheSet(latestUserMsg, { matches: pineconeMatches, answer: fullAnswer });
}
