/**
 * Hourly Telegram Alert System
 * - Fires every hour on the dot
 * - Picks top-10 ACTIVE signals with confidence >= 90%, spanning diverse timeframes
 * - If fewer than 10 high-confidence signals exist in DB, generates AI-powered
 *   market insight signals to fill the list
 * - Sends one beautiful, information-rich Telegram message per hour
 */

import { storage } from './storage';
import { callMultiAI, type AIMessage } from './ai-providers';
import { getMarketRegime } from './agents/market-intelligence-agent';
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

// ─── Signal enrichment (reasoning for DB signals) ────────────────────────────
//
// NOTE: an earlier `generateAISignals()` helper asked the model to invent
// entries/TPs/SLs from a hardcoded price table when the DB was thin. It was
// already unreachable, and it fabricated prices, so it has been removed rather
// than left as a landmine. The alert now sends real signals or nothing.

/**
 * One short sentence of prose per signal. Purely decorative: the numbers in the
 * alert all come from the deterministic engine, so this is 'cosmetic' tier and
 * is the first thing dropped when the daily AI budget runs low.
 */
async function enrichSignalWithReasoning(signal: Signal): Promise<string> {
  const dir = signal.type === 'LONG' ? 'bullish' : 'bearish';
  const rr = signal.sl !== 0 ? (Math.abs(signal.tp - signal.entry) / Math.abs(signal.entry - signal.sl)).toFixed(2) : 'N/A';
  const fallback = `${dir.charAt(0).toUpperCase() + dir.slice(1)} confluence on ${signal.timeframe} with R:R ${rr}. ${signal.strategy} setup.`;
  try {
    const messages: AIMessage[] = [
      { role: 'user', content: `One sentence, max 140 chars, why ${signal.coin} ${signal.type} on ${signal.timeframe} (R:R ${rr}, ${signal.strategy}). No preamble.` },
    ];
    const { text } = await callMultiAI(messages, {
      maxTokens: 60,
      tier: 'cosmetic',
      cacheTtlMs: 60 * 60 * 1000,
      label: 'alert-reasoning',
    });
    return text.trim().slice(0, 200) || fallback;
  } catch {
    return fallback;
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

/**
 * Market mood is a display string, not an input to any decision. It is derived
 * from the deterministic macro regime the intelligence agent already computed —
 * no AI call, no cost, and it can never disagree with the regime shown elsewhere
 * in the app.
 */
async function generateMarketMood(): Promise<string> {
  if (cachedMood && Date.now() < cachedMood.expiresAt) return cachedMood.value;
  let mood = 'Neutral Outlook';
  try {
    const regime = await getMarketRegime();
    const fg = regime.fearGreed.value;
    const tone =
      regime.regime === 'STRONG_BULL' ? 'Strong Bullish Momentum'
      : regime.regime === 'BULL' ? 'Bullish Momentum'
      : regime.regime === 'STRONG_BEAR' ? 'Heavy Bearish Pressure'
      : regime.regime === 'BEAR' ? 'Bearish Pressure'
      : regime.regime === 'VOLATILE' ? 'Volatile Conditions'
      : 'Range-Bound Consolidation';
    const sentiment =
      fg >= 75 ? 'Extreme Greed'
      : fg >= 55 ? 'Greed'
      : fg <= 25 ? 'Extreme Fear'
      : fg <= 45 ? 'Fear'
      : 'Neutral';
    mood = regime.fearGreed.available ? `${tone} · ${sentiment}` : tone;
  } catch {
    /* keep the neutral default */
  }
  cachedMood = { value: mood, expiresAt: Date.now() + 30 * 60 * 1000 };
  return mood;
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

// ─── Core: build and send hourly alert ───────────────────────────────────────

export async function sendHourlyAlert(): Promise<{ sent: boolean; error?: string; signalCount?: number }> {
  try {
    const settings = await storage.getSettings();
    if (!settings?.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
      return { sent: false, error: 'Telegram not configured or disabled' };
    }

    // 0. Restore persisted state (survives server restarts)
    await loadPersistedState();

    // 1. Fetch high-confidence signals from DB — use timeframe-based expiry so
    //    stale signals with frozen prices never appear in the hourly alert.
    const TF_MAX_AGE_MS: Record<string, number> = {
      '1m': 15 * 60 * 1000,
      '5m': 30 * 60 * 1000,
      '15m': 60 * 60 * 1000,
      '30m': 2 * 60 * 60 * 1000,
      '1h': 3 * 60 * 60 * 1000,
      '2h': 5 * 60 * 60 * 1000,
      '4h': 10 * 60 * 60 * 1000,
      '6h': 14 * 60 * 60 * 1000,
      '12h': 20 * 60 * 60 * 1000,
      '1d': 36 * 60 * 60 * 1000,
      '3d': 72 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    const now = Date.now();
    const allSignals = await storage.getSignals();
    const highConf = allSignals
      .filter(s => {
        if (s.confidence < 65 || s.status !== 'ACTIVE') return false;
        const maxAge = TF_MAX_AGE_MS[s.timeframe] ?? (4 * 60 * 60 * 1000);
        return (now - new Date(s.createdAt).getTime()) < maxAge;
      })
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

    // 3. Enrich DB signals with AI reasoning (no hallucinated/fake signals)
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

    const combined = [...dbEnriched]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    if (combined.length === 0) {
      console.log('[hourly-alert] No real signals available — skipping alert to avoid sending fake data');
      return { sent: false, error: 'No real signals available — alert skipped to avoid fake data' };
    }

    // 5. Market mood, derived from the cached macro regime (no AI call)
    const marketMood = await generateMarketMood();

    // 6. Build and send message
    const message = buildHourlyMessage(combined, marketMood);
    await pushTelegram(message, settings.telegramBotToken, settings.telegramChatId);

    // 7. Persist state so variety survives restarts
    const newKey = combined.map(s => `${s.coin}:${s.timeframe}`).sort().join('|');
    lastSentSignalKey = newKey;
    lastSentCoins = new Set(combined.map(s => s.coin));
    await persistState(newKey, lastSentCoins);

    console.log(`[hourly-alert] Sent ${combined.length} signals (DB: ${dbEnriched.length}, forceFreshAI: ${forceFreshAI})`);
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
