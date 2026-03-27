/**
 * One-time script: Ingest AlphaSignal Q&A knowledge base into Pinecone
 * Run: node scripts/ingest-kb.mjs
 */

import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { config } from "dotenv";

config(); // load .env

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index    = pinecone.index(process.env.PINECONE_INDEX ?? "alphasignal-kb");

// ── Full Q&A text extracted from alphasignal_qa_pinecone.pdf ─────────────────
const QA_PAIRS = [
  {
    q: "What is AlphaSignal?",
    a: "AlphaSignal is an AI-powered chart analysis platform built for Indian retail investors. It reads real NSE stock data, detects chart patterns, computes technical indicators, and explains everything in simple plain English — like a mentor sitting next to you. It is designed for investors who want to understand their charts without needing years of experience."
  },
  {
    q: "Who is AlphaSignal for?",
    a: "AlphaSignal is for any Indian investor who trades or invests in NSE stocks. Whether you just opened your first demat account or you have been investing for a few years, AlphaSignal translates complex chart behaviour into language anyone can understand."
  },
  {
    q: "How do I start using AlphaSignal?",
    a: "Enter your Upstox access token in the first field, type a stock symbol like RELIANCE or INFY, and click Run Analysis. The app will fetch real market data and generate a full plain-English analysis in about 10 to 20 seconds."
  },
  {
    q: "Where do I get my access token?",
    a: "Log into your Upstox account, go to the Developer section, open your app, and generate a token. Paste that token into AlphaSignal. The token is valid for one trading day."
  },
  {
    q: "My access token is not working. What should I do?",
    a: "Access tokens expire every day. Generate a new token from your Upstox developer account and paste the fresh token into the app. If the error says HTTP 401 it almost always means the token has expired."
  },
  {
    q: "Which stocks can I analyse?",
    a: "You can analyse any NSE equity stock. Popular ones like RELIANCE, TCS, INFY, HDFCBANK, ICICIBANK, SBIN, WIPRO, AXISBANK, TATAMOTORS, BAJFINANCE, KOTAKBANK, SUNPHARMA, ITC, LT, MARUTI, TITAN, HCLTECH, BHARTIARTL, ONGC, COALINDIA, DIVISLAB, CIPLA, DRREDDY, ADANIENT, and 30 more are pre-loaded and work instantly. For any other NSE stock, enter the instrument key manually."
  },
  {
    q: "What is an instrument key?",
    a: "An instrument key is a unique code Upstox uses to identify each stock. For NSE equities it looks like NSE_EQ followed by the stock's ISIN code. For example, RELIANCE has the instrument key NSE_EQ|INE002A01018. You only need this if your stock is not in the pre-loaded list."
  },
  {
    q: "What does the analysis show me?",
    a: "The analysis shows a headline summary, a confidence score from 0 to 100, detected chart patterns with their status, plain-English explanations of RSI, MACD, Moving Averages, Bollinger Bands, and Volume, key support and resistance price levels, a 52-week high and low comparison, the single most important observation from all the data, and an honest list of what the analysis cannot tell you."
  },
  {
    q: "What is the confidence score?",
    a: "The confidence score is a number from 0 to 100 that shows how many independent signals are pointing in the same direction. It is calculated from five things — pattern quality, volume confirmation, RSI alignment, moving average trend alignment, and MACD alignment. A score of 70 or above means high confidence. A score of 50 to 69 means moderate confidence. Below 50 means low confidence."
  },
  {
    q: "What does a high confidence score mean?",
    a: "A high confidence score of 70 or above means multiple independent signals are aligned. It means the pattern is well-formed, volume is confirming, and indicators support the direction. It does not guarantee an outcome — it means the technical picture is clear and consistent."
  },
  {
    q: "What does a low confidence score mean?",
    a: "A low confidence score below 50 means there is not enough alignment between signals. The pattern may be only partially formed or indicators may be contradicting each other. Treat low confidence results as stocks to watch rather than confirmed signals."
  },
  {
    q: "What is a chart pattern?",
    a: "A chart pattern is a shape that forms on a price chart over time. Patterns repeat across different stocks because they reflect how groups of buyers and sellers behave — fear, greed, hesitation, and conviction all show up as recognisable shapes. Common patterns include Cup and Handle, Head and Shoulders, Double Top, Double Bottom, and Golden Cross."
  },
  {
    q: "What is a Cup and Handle pattern?",
    a: "Cup and Handle is a bullish pattern. The price falls gradually, curves back up like the round bottom of a cup, returns near where it started, then dips slightly again — that small dip is the handle — before potentially breaking upward. The key level to watch is when the price breaks above the rim of the cup with strong volume."
  },
  {
    q: "What is Head and Shoulders?",
    a: "Head and Shoulders is a bearish pattern that signals the end of an uptrend. The price makes three peaks — the middle one is tallest (the head) and the two on either side are shorter (the shoulders). When the price falls below the line connecting the lows between these peaks (the neckline), it often signals the upward trend is ending."
  },
  {
    q: "What is a Double Top?",
    a: "Double Top is a bearish pattern. The price reaches approximately the same high twice but cannot break above it. When the price then falls below the low point between the two peaks, it confirms the pattern and often leads to a downward move."
  },
  {
    q: "What is a Double Bottom?",
    a: "Double Bottom is a bullish pattern. The price touches approximately the same low twice and bounces back both times. When the price breaks above the high point between the two lows, it confirms the pattern and often signals an upward move."
  },
  {
    q: "What is RSI?",
    a: "RSI stands for Relative Strength Index. It is a number between 0 and 100 that measures whether a stock has been bought too much or sold too much recently. Think of it like a speedometer for buying and selling pressure. Above 70 means the stock may be overbought. Below 30 means it may be oversold. Between 45 and 55 is neutral."
  },
  {
    q: "What does RSI above 70 mean?",
    a: "RSI above 70 means the stock has been bought heavily and quickly in recent sessions. It does not mean the price will fall, but it does mean the stock has stretched significantly and may need to pause or pull back before its next move. This zone is called overbought territory."
  },
  {
    q: "What does RSI below 30 mean?",
    a: "RSI below 30 means the stock has been sold heavily in recent sessions. It does not mean the price will rise, but value-focused buyers sometimes start watching stocks in this zone. This is called oversold territory."
  },
  {
    q: "What is RSI divergence?",
    a: "RSI divergence happens when the price and RSI move in opposite directions. Bearish divergence is when price makes new highs but RSI makes lower highs — the momentum is secretly weakening. Bullish divergence is when price makes new lows but RSI makes higher lows — selling pressure is quietly weakening. Divergence is a warning signal, not a confirmed pattern on its own."
  },
  {
    q: "What is MACD?",
    a: "MACD stands for Moving Average Convergence Divergence. It shows whether a stock's momentum is building up or slowing down by comparing two moving averages. The histogram is the most useful part — when it is positive and growing, momentum is accelerating upward. When it is negative and growing more negative, downward pressure is increasing."
  },
  {
    q: "What is a MACD crossover?",
    a: "A bullish MACD crossover happens when the MACD line crosses above the signal line. This often marks the beginning of a new upward phase. A bearish crossover is when the MACD line crosses below the signal line, which can signal the start of downward momentum."
  },
  {
    q: "What are moving averages?",
    a: "Moving averages smooth out daily price changes to show the general direction of a stock. AlphaSignal computes the 20-day, 50-day, and 200-day simple moving averages. When the price is above all three, the stock is in an uptrend across all timeframes. When below all three, it is in a downtrend."
  },
  {
    q: "What is a Golden Cross?",
    a: "A Golden Cross happens when the 50-day moving average crosses above the 200-day moving average. It is widely watched as a signal that the long-term trend may be turning positive. AlphaSignal only labels it as a Golden Cross if the crossover happened recently — not months ago."
  },
  {
    q: "What is a Death Cross?",
    a: "A Death Cross is the opposite of a Golden Cross. It happens when the 50-day moving average crosses below the 200-day moving average. It is watched as a warning that a sustained downtrend may be developing."
  },
  {
    q: "What are Bollinger Bands?",
    a: "Bollinger Bands are three lines around the price — a middle average line and an upper and lower band. When price stretches to the upper band, it has moved far above its average. When it is near the lower band, it has dropped far below. Think of it like a rubber band — the further it stretches, the more likely it snaps back toward the middle."
  },
  {
    q: "What is a Bollinger Band Squeeze?",
    a: "A Bollinger Band Squeeze happens when the upper and lower bands come very close together, much narrower than normal. This means the stock's volatility has compressed. Like squeezing a spring, this stored energy often leads to a sharp move in one direction soon after — though the squeeze alone does not tell you which direction."
  },
  {
    q: "What is volume and why does it matter?",
    a: "Volume is the number of shares traded in a session. It matters because it shows how much conviction is behind a price move. A breakout on high volume is more trustworthy than one on low volume. AlphaSignal compares today's volume to the 20-day average. A ratio above 1.5 times the average is considered strong confirmation."
  },
  {
    q: "What is support?",
    a: "Support is a price level where buyers have historically stepped in and pushed the price back up. Think of it as a floor. When the stock approaches this price, buyers tend to defend it. AlphaSignal identifies support levels from real swing lows in the historical data."
  },
  {
    q: "What is resistance?",
    a: "Resistance is a price level where sellers have historically appeared and pushed the price back down. Think of it as a ceiling. When the stock approaches this price, selling tends to increase. AlphaSignal identifies resistance levels from real swing highs in the historical data."
  },
  {
    q: "What is ATR?",
    a: "ATR stands for Average True Range. It measures how much a stock typically moves in a single day. If the ATR is ₹40, the stock moves roughly ₹40 per day on average. A higher ATR means the stock is more volatile. AlphaSignal uses ATR to give context around key price levels."
  },
  {
    q: "What does Confirmed mean for a pattern?",
    a: "Confirmed means all the conditions required for the pattern are fully met in the data. The pattern has completed and the trigger condition has been satisfied. A confirmed pattern carries more weight than one that is forming."
  },
  {
    q: "What does Forming mean for a pattern?",
    a: "Forming means the pattern is partially visible in the data but has not yet met all confirmation criteria. It is a signal to watch and monitor, not necessarily to act on immediately. The pattern may still complete or it may fail."
  },
  {
    q: "What does Failed mean for a pattern?",
    a: "Failed means the pattern started forming but a key level was broken, making the pattern invalid. For example if a Cup and Handle forms but the price falls below the handle low, the pattern fails. A failed signal is honest information — the setup did not work out."
  },
  {
    q: "What if no pattern is detected?",
    a: "If no pattern is detected, AlphaSignal will say so clearly and still provide useful information — where the stock sits relative to support and resistance, what RSI and MACD are showing, and what price action would be worth watching. No pattern is a valid and useful answer. It means the stock is in consolidation and may form a clearer signal later."
  },
  {
    q: "Is AlphaSignal giving me investment advice?",
    a: "No. AlphaSignal is not a SEBI-registered investment adviser. Everything it provides is for educational and informational purposes only. It explains what the chart is showing — it does not tell you to buy or sell. Always consult a SEBI-registered investment adviser before making financial decisions."
  },
  {
    q: "Can AlphaSignal predict where a stock will go?",
    a: "No. AlphaSignal cannot predict future prices. It identifies patterns and explains what has historically happened when those patterns appeared on similar stocks. Past behaviour does not guarantee the same outcome in the future. Markets change and no pattern works 100 percent of the time."
  },
  {
    q: "Does AlphaSignal consider company news or earnings?",
    a: "No. AlphaSignal analyses only the price and volume chart. It does not have access to earnings dates, company announcements, management news, or fundamental financial data. This is listed in the Limitations section of every analysis."
  },
  {
    q: "Is the data in AlphaSignal real or simulated?",
    a: "All data is real. Candle data comes directly from Upstox which sources it from the NSE official feed. Every indicator — RSI, MACD, Moving Averages, Bollinger Bands, ATR, Support and Resistance levels — is computed from real historical candle data. Nothing is estimated or simulated."
  },
  {
    q: "Why does the analysis take 10 to 20 seconds?",
    a: "The app fetches up to 200 days of real candle data from Upstox, computes 8 indicators, detects patterns, calculates the confidence score, builds the data payload, and sends it to the AI engine — all in sequence. Each step takes a few seconds. The loading screen shows you exactly which step is running."
  },
  {
    q: "Can AlphaSignal compare two stocks?",
    a: "Not currently. AlphaSignal analyses one stock at a time. Run a separate analysis for each stock you want to understand and compare the confidence scores and pattern signals manually."
  },
  {
    q: "What timeframe does AlphaSignal use?",
    a: "AlphaSignal uses the daily chart by default. Each candle represents one full trading day. This timeframe is most useful for swing trading (3 to 15 days) and positional trading (several weeks). Daily patterns filter out intraday noise and show the bigger picture of what a stock is doing."
  },
  {
    q: "I entered a stock symbol but it says not found. What do I do?",
    a: "If your symbol is not in the pre-loaded list, enter the instrument key manually. The instrument key for any NSE equity stock follows the format NSE_EQ followed by the stock's ISIN code. You can find any stock's ISIN on the NSE website or through your broker's platform."
  },
  {
    q: "What is the 52-week context section?",
    a: "The 52-week context shows the highest price and lowest price the stock has traded at over the past year, and how far the current price is from the 52-week high. This helps you understand whether the stock is near historical highs, near lows, or somewhere in between — giving useful context to the pattern signals."
  },
  {
    q: "What is the Key Insight?",
    a: "The Key Insight is a single most important observation pulled from all the data in the analysis — pattern, indicators, volume, and price levels combined. It is the one thing you should take away from the full analysis if you only have time to read one section."
  },
  {
    q: "What does the Limitations section tell me?",
    a: "The Limitations section honestly tells you what the analysis cannot account for — upcoming earnings, news events, behaviour on other timeframes, and fundamental factors. It is there so you always understand the boundaries of what a technical chart analysis can and cannot tell you."
  },
  {
    q: "Can the chatbot run an analysis for me?",
    a: "No. The chatbot can answer questions about how AlphaSignal works, explain indicators and patterns, and help you understand the analysis results. To run an actual stock analysis you need to use the AlphaSignal application directly by entering your access token and stock symbol."
  },
  {
    q: "Is my data safe on AlphaSignal?",
    a: "AlphaSignal does not store your access token or any personal information. The token is used only to fetch market data during your session and is never saved or transmitted to any server other than Upstox."
  },
];

async function embed(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

async function main() {
  console.log(`\n🚀 Ingesting ${QA_PAIRS.length} Q&A pairs into Pinecone index "${process.env.PINECONE_INDEX}"...\n`);

  const vectors = [];
  for (let i = 0; i < QA_PAIRS.length; i++) {
    const { q, a } = QA_PAIRS[i];
    // Embed the full Q+A together for best semantic retrieval
    const text   = `Q: ${q}\nA: ${a}`;
    const values = await embed(text);

    vectors.push({
      id:       `qa_${String(i).padStart(3, "0")}`,
      values,
      metadata: {
        text,
        question: q,
        source:   "alphasignal_qa_pinecone.pdf",
        chunk:    i,
      },
    });

    process.stdout.write(`  [${i + 1}/${QA_PAIRS.length}] Embedded: ${q.slice(0, 60)}...\r`);
  }

  console.log("\n\n📤 Upserting all vectors to Pinecone...");
  console.log(`  Total vectors ready: ${vectors.length}`);

  // Pinecone SDK v7 — upsert takes array directly
  const batchSize = 50;
  for (let b = 0; b < vectors.length; b += batchSize) {
    const batch = vectors.slice(b, b + batchSize);
    console.log(`  Upserting batch of ${batch.length}...`);
    // Try both formats for compatibility
    try {
      await index.upsert(batch);
    } catch {
      await index.upsert({ records: batch });
    }
    console.log(`  ✓ Batch ${Math.floor(b / batchSize) + 1} done`);
  }

  console.log(`\n✅ Done! ${vectors.length} Q&A pairs are now in Pinecone.\n`);
  console.log("The chatbot will now answer from this knowledge base first.");
}

main().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
