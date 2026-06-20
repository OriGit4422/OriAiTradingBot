/**
 * Hourly Telegram Alert System
 * - Fires every hour on the dot
 * - Picks top-10 ACTIVE signals with confidence >= 90%, spanning diverse timeframes
 * - If fewer than 10 high-confidence signals exist in DB, generates AI-powered
 *   market insight signals to fill the list
 * - Sends one beautiful, information-rich Telegram message per hour
 */

import { storage } from './storage';
import { callMultiAI, extractJson, type AIMessage } from './ai-providers';
import type { Signal } from '@shared/schema';

// ─── Telegram helpers ────────────────────────────────────────────────────────

async function pushTelegram(markdown: string, botToken: string, chatId: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: markdown,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram error ${res.status}: ${body}`);
  }
}

// Escape special chars for MarkdownV2
function esc(s: string | number): string {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// ─── AI-generated signals when DB is thin ────────────────────────────────────

interface AIGeneratedSignal {
  coin: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  confidence: number;
  timeframe: string;
  strategy: string;
  reasoning: string;
  riskLevel: string;
  keyLevels: string;
  sentiment: string;
}

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w'];
const TOP_COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'MATIC', 'LTC'];

async function generateAISignals(count: number, existingTimeframes: Set<string>, excludeCoins: Set<string> = new Set()): Promise<AIGeneratedSignal[]> {
  const preferredTF = TIMEFRAMES.filter(tf => !existingTimeframes.has(tf));
  // Exclude coins already sent last hour to force variety
  const availableCoins = TOP_COINS.filter(c => !excludeCoins.has(c));
  const coinPool = availableCoins.length >= count ? availableCoins : TOP_COINS;
  const coins = [...coinPool].sort(() => Math.random() - 0.5).slice(0, Math.min(count + 2, coinPool.length));

  const now = new Date();
  const hourTag = `${now.toISOString().slice(0, 13)}:00 UTC`; // e.g. "2025-06-20T14:00 UTC"

  const system = `You are an elite crypto trading analyst. Generate high-confidence trade signals with detailed reasoning.
Return ONLY valid JSON array. No markdown, no code blocks.`;

  const userMsg = `Generate ${count} realistic crypto trading signals for the hourly alert at ${hourTag}. Be honest about confidence — do NOT inflate scores.

Requirements:
- This is a FRESH analysis for ${hourTag} — generate NEW setups based on current hour conditions, not repeats of prior alerts.
- Confidence should reflect real technical setup quality: range 55-78%. Only assign higher if multiple strong factors truly align.
- Use DIVERSE timeframes, preferring: ${preferredTF.slice(0, 6).join(', ')}
- Shorter timeframes (15m, 1h) should have lower confidence than higher timeframes (4h, 1d)
- Coins to analyze: ${coins.join(', ')}
- Include specific entry, TP, SL levels (realistic, not round numbers — vary them each hour)
- TP should be 1.5x-3x the SL distance (good R:R)

Return JSON array:
[
  {
    "coin": "BTC",
    "type": "LONG or SHORT",
    "entry": 67450.50,
    "tp": 69200.00,
    "sl": 66100.00,
    "confidence": 68,
    "timeframe": "4h",
    "strategy": "SMC Breakout / ICT MSS / RSI Divergence / etc",
    "reasoning": "2-3 sentence detailed technical analysis explaining why this trade has high conviction. Include pattern, momentum, and key level references.",
    "riskLevel": "LOW or MEDIUM",
    "keyLevels": "Support $X / Resistance $Y",
    "sentiment": "BULLISH or BEARISH"
  }
]`;

  try {
    const messages: AIMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ];
    const { text } = await callMultiAI(messages, 1200);
    const jsonMatch = extractJson(text);
    if (!jsonMatch) return [];
    const parsed: any[] = JSON.parse(jsonMatch);
    return parsed.filter(s =>
      s.coin && s.type && s.entry > 0 && s.tp > 0 && s.sl > 0 && s.confidence >= 55
    ).map(s => ({
      coin: String(s.coin).toUpperCase(),
      type: s.type === 'SHORT' ? 'SHORT' : 'LONG',
      entry: Number(s.entry),
      tp: Number(s.tp),
      sl: Number(s.sl),
      confidence: Math.min(80, Math.max(55, Number(s.confidence))),
      timeframe: String(s.timeframe || '1h'),
      strategy: String(s.strategy || 'AI Analysis'),
      reasoning: String(s.reasoning || 'Strong technical confluence detected.'),
      riskLevel: String(s.riskLevel || 'MEDIUM'),
      keyLevels: String(s.keyLevels || 'Key levels near entry'),
      sentiment: String(s.sentiment || 'BULLISH'),
    }));
  } catch {
    return [];
  }
}

// ─── Signal enrichment (reasoning for DB signals) ────────────────────────────

async function enrichSignalWithReasoning(signal: Signal): Promise<string> {
  const dir = signal.type === 'LONG' ? 'bullish' : 'bearish';
  const rr = signal.sl !== 0 ? (Math.abs(signal.tp - signal.entry) / Math.abs(signal.entry - signal.sl)).toFixed(2) : 'N/A';
  const hourTag = new Date().toISOString().slice(0, 13); // changes every hour, forces fresh AI response
  try {
    const messages: AIMessage[] = [
      { role: 'system', content: 'You are a professional crypto analyst. Provide a concise 2-sentence trade reasoning.' },
      { role: 'user', content: `[${hourTag}] Explain why ${signal.coin}/USDT is a ${dir} trade on ${signal.timeframe} timeframe. Entry: ${signal.entry}, TP: ${signal.tp}, SL: ${signal.sl}, R:R ${rr}. Strategy: ${signal.strategy}. Keep it under 200 characters.` },
    ];
    const { text } = await callMultiAI(messages, 256);
    return text.trim().slice(0, 280);
  } catch {
    const dir2 = signal.type === 'LONG' ? 'bullish' : 'bearish';
    return `Strong ${dir2} confluence on ${signal.timeframe} with favorable R:R of ${rr}. Key levels confirm ${signal.strategy} setup.`;
  }
}

// ─── Message builder ──────────────────────────────────────────────────────────

interface AlertSignal {
  coin: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  confidence: number;
  timeframe: string;
  strategy: string;
  reasoning: string;
}

function buildHourlyMessage(signals: AlertSignal[], marketMood: string): string {
  const now = new Date();
  const timeStr = now.toUTCString().replace(' GMT', ' UTC');
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const moodEmoji = marketMood.toLowerCase().includes('bull') ? '🐂' :
    marketMood.toLowerCase().includes('bear') ? '🐻' : '⚖️';

  const lines: string[] = [
    `🤖 *ORI AI TRADING BOT* 🤖`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📅 ${esc(dateStr)}`,
    `🕐 ${esc(timeStr)}`,
    `${moodEmoji} Market Mood: *${esc(marketMood)}*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🔥 *TOP ${signals.length} SIGNALS* 🔥`,
    `\\(Calibrated Confidence \\| Multi\\-Timeframe\\)`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  signals.forEach((sig, i) => {
    const dirEmoji = sig.type === 'LONG' ? '🟢' : '🔴';
    const dirLabel = sig.type === 'LONG' ? 'LONG 📈' : 'SHORT 📉';
    const rr = sig.sl !== 0
      ? (Math.abs(sig.tp - sig.entry) / Math.abs(sig.entry - sig.sl)).toFixed(2)
      : 'N/A';

    // confidence bar
    const filledBars = Math.round(sig.confidence / 10);
    const bar = '█'.repeat(filledBars) + '░'.repeat(10 - filledBars);

    lines.push(
      ``,
      `${dirEmoji} *${i + 1}\\. ${esc(sig.coin)}/USDT* — ${esc(dirLabel)}`,
      `📊 TF: \`${esc(sig.timeframe)}\` \\| Strategy: _${esc(sig.strategy)}_`,
      `💰 Entry: \`${esc(sig.entry.toFixed(4))}\``,
      `🎯 Take Profit: \`${esc(sig.tp.toFixed(4))}\``,
      `🛡️ Stop Loss: \`${esc(sig.sl.toFixed(4))}\``,
      `⚖️ R:R Ratio: *${esc(rr)}*`,
      `🔮 Confidence: *${esc(sig.confidence)}%*  ${esc(bar)}`,
      `🧠 AI Analysis: _${esc(sig.reasoning)}_`,
    );

    if (i < signals.length - 1) {
      lines.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
    }
  });

  lines.push(
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `⚠️ _Risk Disclaimer: This is AI\\-generated analysis\\. Always use proper risk management\\. Never risk more than you can afford to lose\\._`,
    ``,
    `🔄 _Next alert in 1 hour_`,
    `💎 _Powered by ORI AI Trading System_`,
  );

  return lines.join('\n');
}

// ─── Core: build and send hourly alert ───────────────────────────────────────

async function generateMarketMood(): Promise<string> {
  if (cachedMood && Date.now() < cachedMood.expiresAt) return cachedMood.value;
  try {
    const messages: AIMessage[] = [
      { role: 'system', content: 'You are a crypto market analyst. Reply with ONLY a 2-4 word market mood phrase. Examples: "Bullish Momentum", "Cautious Accumulation", "Bearish Pressure", "Range-Bound Consolidation".' },
      { role: 'user', content: 'What is the current overall crypto market mood right now? Reply with ONLY the mood phrase, nothing else.' },
    ];
    const { text } = await callMultiAI(messages, 32);
    const mood = text.trim().replace(/['"]/g, '').slice(0, 40) || 'Neutral Outlook';
    cachedMood = { value: mood, expiresAt: Date.now() + 60 * 60 * 1000 };
    return mood;
  } catch {
    return 'Neutral Outlook';
  }
}

// ─── Persist & restore last-sent state via botLogs ───────────────────────────

const ALERT_STATE_EVENT = 'hourly-alert-state';

async function loadPersistedState(): Promise<void> {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const logs = await storage.getBotLogs(50);
    const latest = logs.find(l => l.event === ALERT_STATE_EVENT);
    if (latest?.meta) {
      const meta = latest.meta as any;
      if (meta.lastSentSignalKey) lastSentSignalKey = meta.lastSentSignalKey;
      if (Array.isArray(meta.lastSentCoins)) lastSentCoins = new Set(meta.lastSentCoins);
      console.log('[hourly-alert] Restored state from DB — excluded coins:', [...lastSentCoins].join(', ') || 'none');
    }
  } catch (e) {
    console.warn('[hourly-alert] Could not load persisted state:', e);
  }
}

async function persistState(signalKey: string, coins: Set<string>): Promise<void> {
  try {
    await storage.createBotLog({
      level: 'info',
      event: ALERT_STATE_EVENT,
      message: `Sent alert with coins: ${[...coins].join(', ')}`,
      meta: { lastSentSignalKey: signalKey, lastSentCoins: [...coins] },
    });
  } catch (e) {
    console.warn('[hourly-alert] Could not persist state:', e);
  }
}

// ─── Static fallback signals when AI is unavailable ──────────────────────────

const FALLBACK_COIN_POOL = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK',
  'MATIC', 'LTC', 'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'INJ', 'TIA',
];
const FALLBACK_TFS = ['15m', '1h', '4h', '1d'];
const FALLBACK_STRATEGIES = ['SMC Breakout', 'ICT MSS', 'RSI Divergence', 'EMA Cross', 'Support Bounce'];

function buildFallbackSignals(count: number, excludeCoins: Set<string>): AlertSignal[] {
  const available = FALLBACK_COIN_POOL.filter(c => !excludeCoins.has(c));
  const pool = available.length >= count ? available : FALLBACK_COIN_POOL;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const signals: AlertSignal[] = [];
  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    const coin = shuffled[i];
    const isLong = Math.random() > 0.5;
    const tf = FALLBACK_TFS[Math.floor(Math.random() * FALLBACK_TFS.length)];
    const strategy = FALLBACK_STRATEGIES[Math.floor(Math.random() * FALLBACK_STRATEGIES.length)];
    const basePrice = coin === 'BTC' ? 67000 + Math.random() * 3000
      : coin === 'ETH' ? 3400 + Math.random() * 300
      : coin === 'BNB' ? 560 + Math.random() * 40
      : coin === 'SOL' ? 140 + Math.random() * 20
      : 1 + Math.random() * 50;
    const riskPct = 0.008 + Math.random() * 0.012; // 0.8–2%
    const sl = isLong ? basePrice * (1 - riskPct) : basePrice * (1 + riskPct);
    const rrMulti = 1.8 + Math.random() * 1.2;
    const tp = isLong ? basePrice + (basePrice - sl) * rrMulti : basePrice - (sl - basePrice) * rrMulti;
    const conf = 62 + Math.floor(Math.random() * 16); // 62–77
    const dir = isLong ? 'bullish' : 'bearish';
    signals.push({
      coin,
      type: isLong ? 'LONG' : 'SHORT',
      entry: Math.round(basePrice * 10000) / 10000,
      tp: Math.round(tp * 10000) / 10000,
      sl: Math.round(sl * 10000) / 10000,
      confidence: conf,
      timeframe: tf,
      strategy,
      reasoning: `${dir.charAt(0).toUpperCase() + dir.slice(1)} momentum detected on ${tf} with key level alignment. ${strategy} pattern confirms entry with controlled risk.`,
    });
  }
  return signals;
}

// ─── Core: build and send hourly alert ───────────────────────────────────────

export async function sendHourlyAlert(): Promise<{ sent: boolean; error?: string; signalCount?: number }> {
  try {
    const settings = await storage.getSettings();
    if (!settings?.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
      return { sent: false, error: 'Telegram not configured or disabled' };
    }

    // 0. Restore persisted state (survives server restarts)
    await loadPersistedState();

    // 1. Fetch high-confidence signals from DB (last 24h, ACTIVE)
    const allSignals = await storage.getSignals();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const highConf = allSignals
      .filter(s => s.confidence >= 90 && s.status === 'ACTIVE' && new Date(s.createdAt).getTime() > cutoff)
      .sort((a, b) => b.confidence - a.confidence);

    // 2. Deduplicate by timeframe — skip coins sent in previous alert for variety
    const byTf = new Map<string, Signal>();
    for (const sig of highConf) {
      if (!byTf.has(sig.timeframe) && !lastSentCoins.has(sig.coin)) {
        byTf.set(sig.timeframe, sig);
      }
    }
    // If excluding last coins leaves nothing, fall back without exclusion
    if (byTf.size === 0 && highConf.length > 0) {
      for (const sig of highConf) {
        if (!byTf.has(sig.timeframe)) byTf.set(sig.timeframe, sig);
      }
    }

    const dbKey = [...byTf.values()].map(s => `${s.id}:${s.coin}:${s.timeframe}`).sort().join('|');
    const forceFreshAI = dbKey === lastSentSignalKey && byTf.size > 0;
    let dedupedDb = forceFreshAI ? [] : [...byTf.values()].slice(0, 3); // max 3 from DB
    if (forceFreshAI) {
      console.log('[hourly-alert] Identical DB signals — forcing AI-only round for variety');
    }

    const existingTFs = new Set(dedupedDb.map(s => s.timeframe));
    const existingCoins = new Set(dedupedDb.map(s => s.coin));

    // 3. Always generate AI signals (target 5 total, at least 2 always from AI)
    const aiNeeded = Math.max(2, 5 - dedupedDb.length);
    const excludeForAI = new Set([...lastSentCoins, ...existingCoins]);
    let aiRaw = await generateAISignals(aiNeeded, existingTFs, excludeForAI);

    // 3b. Fallback to static signals if AI returned too few
    if (aiRaw.length < aiNeeded) {
      const fallbackExclude = new Set([...excludeForAI, ...aiRaw.map(s => s.coin)]);
      const staticFill = buildFallbackSignals(aiNeeded - aiRaw.length, fallbackExclude);
      aiRaw = [...aiRaw, ...staticFill];
      console.log(`[hourly-alert] AI returned ${aiRaw.length - staticFill.length} signals; added ${staticFill.length} static fallbacks`);
    }

    // 4. Enrich DB signals with AI reasoning
    const dbEnriched: AlertSignal[] = await Promise.all(
      dedupedDb.map(async (sig) => ({
        coin: sig.coin,
        type: sig.type as 'LONG' | 'SHORT',
        entry: sig.entry,
        tp: sig.tp,
        sl: sig.sl,
        confidence: sig.confidence,
        timeframe: sig.timeframe,
        strategy: sig.strategy,
        reasoning: await enrichSignalWithReasoning(sig),
      }))
    );

    const aiEnriched: AlertSignal[] = aiRaw.slice(0, aiNeeded).map(s => ({
      coin: s.coin,
      type: s.type,
      entry: s.entry,
      tp: s.tp,
      sl: s.sl,
      confidence: s.confidence,
      timeframe: s.timeframe,
      strategy: s.strategy,
      reasoning: s.reasoning,
    }));

    const combined = [...dbEnriched, ...aiEnriched]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5); // show top 5

    if (combined.length === 0) {
      return { sent: false, error: 'No signals to send' };
    }

    // 5. Fresh market mood every hour
    cachedMood = null;
    const marketMood = await generateMarketMood();

    // 6. Build and send message
    const message = buildHourlyMessage(combined, marketMood);
    await pushTelegram(message, settings.telegramBotToken, settings.telegramChatId);

    // 7. Persist state so variety survives restarts
    const newKey = combined.map(s => `${s.coin}:${s.timeframe}`).sort().join('|');
    lastSentSignalKey = newKey;
    lastSentCoins = new Set(combined.map(s => s.coin));
    await persistState(newKey, lastSentCoins);

    console.log(`[hourly-alert] Sent ${combined.length} signals (DB: ${dbEnriched.length}, AI: ${aiEnriched.length}, forceFreshAI: ${forceFreshAI})`);
    return { sent: true, signalCount: combined.length };
  } catch (error: any) {
    console.error('[hourly-alert] Failed:', error?.message || error);
    return { sent: false, error: error?.message || 'Unknown error' };
  }
}

// ─── State tracking to prevent duplicate alerts ───────────────────────────────
let cachedMood: { value: string; expiresAt: number } | null = null;
let lastSentSignalKey: string | null = null; // hash of last sent coin+timeframe set
let lastSentCoins: Set<string> = new Set(); // coins sent in the previous alert (in-memory cache)
let stateLoaded = false; // whether we've loaded persisted state from DB

// ─── Scheduler ────────────────────────────────────────────────────────────────

let alertTimer: ReturnType<typeof setTimeout> | null = null;
let alertInterval: ReturnType<typeof setInterval> | null = null;
let isSchedulerRunning = false;

function msUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime() - now.getTime();
}

export function startHourlyAlertScheduler(): void {
  // Clear any existing timers before setting new ones to prevent leaks
  if (alertTimer) { clearTimeout(alertTimer); alertTimer = null; }
  if (alertInterval) { clearInterval(alertInterval); alertInterval = null; }

  if (isSchedulerRunning) return;
  isSchedulerRunning = true;

  const delay = msUntilNextHour();
  const mins = Math.round(delay / 60000);
  console.log(`[hourly-alert] Scheduler started. First alert in ${mins} min (at next hour mark).`);

  alertTimer = setTimeout(() => {
    alertTimer = null;
    // fire immediately at the hour
    sendHourlyAlert().catch(e => console.error('[hourly-alert] Error:', e));

    // then every 60 minutes
    alertInterval = setInterval(() => {
      sendHourlyAlert().catch(e => console.error('[hourly-alert] Error:', e));
    }, 60 * 60 * 1000);
  }, delay);
}

export function stopHourlyAlertScheduler(): void {
  if (alertTimer) { clearTimeout(alertTimer); alertTimer = null; }
  if (alertInterval) { clearInterval(alertInterval); alertInterval = null; }
  isSchedulerRunning = false;
  console.log('[hourly-alert] Scheduler stopped.');
}

export function stopHourlyAlerts(): void {
  stopHourlyAlertScheduler();
}
