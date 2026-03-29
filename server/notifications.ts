import type { Signal } from '@shared/schema';
import { storage } from './storage';

function signalRiskReward(signal: Pick<Signal, 'entry' | 'tp' | 'sl'>): number {
  const risk = Math.abs(signal.entry - signal.sl);
  const reward = Math.abs(signal.tp - signal.entry);
  return risk === 0 ? 0 : reward / risk;
}

function buildSignalMessage(signal: Signal): { text: string; markdown: string } {
  const rr = signalRiskReward(signal).toFixed(2);
  const directionEmoji = signal.type === 'LONG' ? '🟢' : '🔴';
  const text = `${directionEmoji} ${signal.coin}/USDT ${signal.type}\n` +
    `Entry: ${signal.entry.toFixed(4)} | TP: ${signal.tp.toFixed(4)} | SL: ${signal.sl.toFixed(4)}\n` +
    `Timeframe: ${signal.timeframe} | Confidence: ${signal.confidence}% | R:R ${rr}`;

  const markdown =
`*${directionEmoji} ${signal.coin}/USDT ${signal.type}*\n` +
`Entry: \`${signal.entry.toFixed(4)}\`  TP: \`${signal.tp.toFixed(4)}\`  SL: \`${signal.sl.toFixed(4)}\`\n` +
`TF: *${signal.timeframe}* | Confidence: *${signal.confidence}%* | R:R *${rr}*`;

  return { text, markdown };
}

async function pushTelegram(markdown: string, botToken: string, chatId: string) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: markdown,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram error ${res.status}: ${text}`);
  }
}

async function pushDiscord(text: string, webhookUrl: string) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: text,
      username: 'WINM Signals Bot',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord error ${res.status}: ${body}`);
  }
}

export async function notifySignal(signal: Signal): Promise<void> {
  try {
    const settings = await storage.getSettings();
    if (!settings || !settings.notifyOnSignal) return;

    if (settings.notifyOnHighConfidence && signal.confidence < settings.minNotifyConfidence) {
      return;
    }

    const { text, markdown } = buildSignalMessage(signal);
    const tasks: Promise<unknown>[] = [];

    if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      tasks.push(pushTelegram(markdown, settings.telegramBotToken, settings.telegramChatId));
    }

    if (settings.discordEnabled && settings.discordWebhookUrl) {
      tasks.push(pushDiscord(text, settings.discordWebhookUrl));
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  } catch (error) {
    console.error('Signal notification failed:', error);
  }
}

export async function sendTestNotifications() {
  const settings = await storage.getSettings();
  if (!settings) {
    return { ok: false, message: 'Settings not found', telegram: null, discord: null };
  }

  const telegramState: any = {
    enabled: settings.telegramEnabled,
    configured: !!(settings.telegramBotToken && settings.telegramChatId),
    sent: false,
    error: null as string | null,
  };
  const discordState: any = {
    enabled: settings.discordEnabled,
    configured: !!settings.discordWebhookUrl,
    sent: false,
    error: null as string | null,
  };

  const testText = '🧪 WINM test notification: channel connectivity verified.';
  const testMarkdown = '*🧪 WINM test notification*: channel connectivity verified.';

  if (telegramState.enabled && telegramState.configured) {
    try {
      await pushTelegram(testMarkdown, settings.telegramBotToken!, settings.telegramChatId!);
      telegramState.sent = true;
    } catch (e: any) {
      telegramState.error = e?.message || 'Unknown telegram error';
    }
  }

  if (discordState.enabled && discordState.configured) {
    try {
      await pushDiscord(testText, settings.discordWebhookUrl!);
      discordState.sent = true;
    } catch (e: any) {
      discordState.error = e?.message || 'Unknown discord error';
    }
  }

  const ok = (!!telegramState.sent || !telegramState.enabled) && (!!discordState.sent || !discordState.enabled);
  return {
    ok,
    message: ok ? 'Notification test completed' : 'Notification test failed for one or more channels',
    telegram: telegramState,
    discord: discordState,
  };
}

export function validateSignalBestPractice(signal: {
  type: string;
  entry: number;
  tp: number;
  sl: number;
  confidence: number;
}) {
  const rr = signalRiskReward(signal as any);

  const isDirectionValid = signal.type === 'LONG'
    ? signal.tp > signal.entry && signal.sl < signal.entry
    : signal.tp < signal.entry && signal.sl > signal.entry;

  const issues: string[] = [];
  if (!isDirectionValid) issues.push('TP/SL placement is inconsistent with trade direction');
  if (rr < 1.5) issues.push('Risk/reward is below 1:1.5 best-practice threshold');
  if (signal.confidence < 60) issues.push('Confidence below minimum quality threshold (60%)');

  return {
    isValid: issues.length === 0,
    riskReward: rr,
    issues,
  };
}
