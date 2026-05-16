/**
 * Multi-AI Provider System
 * Supports: OpenAI-compatible custom APIs + Google Gemini
 * Replaces all Anthropic/Claude connections
 */
import { storage } from './storage';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIProviderConfig {
  name: string;
  type: 'custom' | 'gemini';
  baseUrl?: string;
  apiKey: string;
  model: string;
}

export interface AIResponse {
  text: string;
  provider: string;
  model: string;
}

// ── OpenAI-compatible API call ────────────────────────────────────────────────

async function callOpenAICompatible(
  config: AIProviderConfig,
  messages: AIMessage[],
  maxTokens = 1024,
): Promise<AIResponse> {
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const formatted = messages.map(m => ({ role: m.role, content: m.content }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      messages: formatted,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`${config.name} API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  return { text, provider: config.name, model: config.model };
}

// ── Google Gemini API call ────────────────────────────────────────────────────

async function callGemini(
  config: AIProviderConfig,
  messages: AIMessage[],
  maxTokens = 1024,
): Promise<AIResponse> {
  const model = config.model || 'gemini-1.5-pro';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  // Merge system message into first user turn if present
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages.filter(m => m.role !== 'system');

  const contents = chatMsgs.map((m, i) => {
    let text = m.content;
    if (i === 0 && systemMsg) text = `${systemMsg.content}\n\n${text}`;
    return {
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text }],
    };
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { text, provider: 'Gemini', model };
}

// ── Unified caller ────────────────────────────────────────────────────────────

export async function callAIProvider(
  config: AIProviderConfig,
  messages: AIMessage[],
  maxTokens = 1024,
): Promise<AIResponse> {
  if (config.type === 'gemini') return callGemini(config, messages, maxTokens);
  return callOpenAICompatible(config, messages, maxTokens);
}

// ── Load active providers from DB settings ────────────────────────────────────

export async function getActiveProviders(): Promise<AIProviderConfig[]> {
  const s = await storage.getSettings();
  if (!s) return [];
  const ss = s as any;
  const providers: AIProviderConfig[] = [];

  if (ss.customAi1Enabled && ss.customAi1ApiKey) {
    providers.push({
      name: ss.customAi1Name || 'Custom AI 1',
      type: 'custom',
      baseUrl: ss.customAi1BaseUrl || 'https://api.openai.com/v1',
      apiKey: ss.customAi1ApiKey,
      model: ss.customAi1Model || 'gpt-4o',
    });
  }

  if (ss.customAi2Enabled && ss.customAi2ApiKey) {
    providers.push({
      name: ss.customAi2Name || 'Custom AI 2',
      type: 'custom',
      baseUrl: ss.customAi2BaseUrl || 'https://api.openai.com/v1',
      apiKey: ss.customAi2ApiKey,
      model: ss.customAi2Model || 'gpt-4o',
    });
  }

  if (ss.geminiEnabled && ss.geminiApiKey) {
    providers.push({
      name: 'Gemini',
      type: 'gemini',
      apiKey: ss.geminiApiKey,
      model: ss.geminiModel || 'gemini-1.5-pro',
    });
  }

  return providers;
}

// ── Multi-AI: run all providers in parallel, aggregate JSON numeric fields ────

function aggregateJsonResponses(texts: string[]): string {
  const parsed: any[] = [];
  for (const t of texts) {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try { parsed.push(JSON.parse(m[0])); } catch { /* skip */ }
  }
  if (parsed.length === 0) return texts[0] ?? '';
  if (parsed.length === 1) return JSON.stringify(parsed[0]);

  const keys = [...new Set(parsed.flatMap(p => Object.keys(p)))];
  const merged: any = {};

  for (const key of keys) {
    const vals = parsed.map(p => p[key]).filter(v => v !== undefined);
    if (!vals.length) continue;

    if (typeof vals[0] === 'number') {
      merged[key] = Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 100) / 100;
    } else if (typeof vals[0] === 'boolean') {
      merged[key] = vals.filter(Boolean).length > vals.length / 2;
    } else if (typeof vals[0] === 'object' && vals[0] !== null) {
      const subKeys = [...new Set(vals.flatMap((v: any) => Object.keys(v)))];
      const sub: any = {};
      for (const sk of subKeys) {
        const sv = vals.map((v: any) => v[sk]).filter((v: any) => v !== undefined);
        if (sv.length && typeof sv[0] === 'number') {
          sub[sk] = Math.round((sv.reduce((a: number, b: number) => a + b, 0) / sv.length) * 100) / 100;
        } else { sub[sk] = sv[0]; }
      }
      merged[key] = sub;
    } else {
      // majority vote for strings
      const freq: Record<string, number> = {};
      for (const v of vals) freq[String(v)] = (freq[String(v)] || 0) + 1;
      merged[key] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  return JSON.stringify(merged);
}

export async function callMultiAI(
  messages: AIMessage[],
  maxTokens = 1024,
): Promise<{ text: string; providers: string[] }> {
  const providers = await getActiveProviders();
  if (providers.length === 0) {
    throw new Error('No AI providers configured. Add API keys in Settings → AI Agents.');
  }

  if (providers.length === 1) {
    const r = await callAIProvider(providers[0], messages, maxTokens);
    return { text: r.text, providers: [r.provider] };
  }

  // Run all in parallel
  const results = await Promise.allSettled(
    providers.map(p => callAIProvider(p, messages, maxTokens)),
  );
  const ok = results
    .filter((r): r is PromiseFulfilledResult<AIResponse> => r.status === 'fulfilled')
    .map(r => r.value);

  if (ok.length === 0) throw new Error('All AI providers failed');
  if (ok.length === 1) return { text: ok[0].text, providers: [ok[0].provider] };

  const aggregatedText = aggregateJsonResponses(ok.map(r => r.text));
  return { text: aggregatedText, providers: ok.map(r => r.provider) };
}

// ── Streaming helper for chat (SSE) ──────────────────────────────────────────
// Returns text chunks via callback; uses first available provider

export async function streamChatResponse(
  messages: AIMessage[],
  onChunk: (chunk: string) => void,
): Promise<void> {
  const providers = await getActiveProviders();
  if (providers.length === 0) {
    throw new Error('No AI providers configured. Add API keys in Settings → AI Agents.');
  }

  const config = providers[0];

  if (config.type === 'gemini') {
    // Gemini doesn't support streaming in the same way; get full response then stream
    const r = await callGemini(config, messages, 4096);
    // Emit in chunks to simulate streaming
    const words = r.text.split(' ');
    for (const word of words) {
      onChunk(word + ' ');
    }
    return;
  }

  // OpenAI-compatible streaming
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`${config.name} streaming error ${response.status}: ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content ?? '';
        if (chunk) onChunk(chunk);
      } catch { /* skip malformed */ }
    }
  }
}
