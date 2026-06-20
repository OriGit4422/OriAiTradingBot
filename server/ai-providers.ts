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
  type: 'custom' | 'gemini' | 'anthropic';
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
      temperature: 0.35,
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
  maxTokens = 2048,
): Promise<AIResponse> {
  const model = config.model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages.filter(m => m.role !== 'system');

  const contents = chatMsgs.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.3,
      topP: 0.95,
      topK: 40,
    },
  };

  // Use native systemInstruction (proper handling vs prepend hack)
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { text, provider: 'Gemini', model };
}

async function streamGemini(
  config: AIProviderConfig,
  messages: AIMessage[],
  onChunk: (chunk: string) => void,
  maxTokens = 4096,
): Promise<void> {
  const model = config.model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${config.apiKey}`;

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages.filter(m => m.role !== 'system');

  const contents = chatMsgs.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const body: any = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3, topP: 0.95 },
  };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini stream error ${response.status}: ${errText}`);
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
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const chunk: string = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (chunk) onChunk(chunk);
      } catch (err) { console.warn('[ai-providers] Skipped entry:', err instanceof Error ? err.message : err); }
    }
  }
}

// ── Anthropic (Claude) API call ───────────────────────────────────────────────

async function callAnthropic(
  config: AIProviderConfig,
  messages: AIMessage[],
  maxTokens = 1024,
): Promise<AIResponse> {
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  const url = `${baseUrl}/v1/messages`;

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const body: any = {
    model: config.model,
    max_tokens: maxTokens,
    messages: chatMsgs.length ? chatMsgs : [{ role: 'user', content: 'Hello' }],
  };
  if (systemMsg) body.system = systemMsg.content;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`${config.name} API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data.content?.[0]?.text ?? '';
  return { text, provider: config.name, model: config.model };
}

// ── Unified caller with retry ─────────────────────────────────────────────────

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function callAIProvider(
  config: AIProviderConfig,
  messages: AIMessage[],
  maxTokens = 1024,
  retries = 2,
): Promise<AIResponse> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (config.type === 'gemini') return await callGemini(config, messages, maxTokens);
      if (config.type === 'anthropic') return await callAnthropic(config, messages, maxTokens);
      return await callOpenAICompatible(config, messages, maxTokens);
    } catch (err: any) {
      lastError = err;
      // Don't retry auth errors (401, 403) or invalid request (400)
      const isAuthErr = err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('invalid_api_key');
      const isBadReq = err.message?.includes('400') || err.message?.includes('invalid_request');
      if (isAuthErr || isBadReq || attempt >= retries) break;
      // Exponential backoff: 1s, 2s
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastError ?? new Error('AI provider call failed');
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

  if (ss.openaiEnabled && ss.openaiApiKey) {
    providers.push({
      name: 'OpenAI',
      type: 'custom',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: ss.openaiApiKey,
      model: ss.openaiModel || 'gpt-4o',
    });
  }

  if (ss.anthropicEnabled && ss.anthropicApiKey) {
    providers.push({
      name: 'Claude',
      type: 'anthropic',
      apiKey: ss.anthropicApiKey,
      model: ss.anthropicModel || 'claude-sonnet-4-6',
    });
  }

  if (ss.geminiEnabled && ss.geminiApiKey) {
    providers.push({
      name: 'Gemini',
      type: 'gemini',
      apiKey: ss.geminiApiKey,
      model: ss.geminiModel || 'gemini-2.0-flash',
    });
  }

  return providers;
}

// ── Multi-AI: run all providers in parallel, aggregate JSON numeric fields ────

function extractJson(text: string): string | null {
  // Try markdown code block first
  const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlock) return codeBlock[1];
  // Then bare JSON object
  const bare = text.match(/\{[\s\S]*\}/);
  return bare ? bare[0] : null;
}

export { extractJson };

function aggregateJsonResponses(texts: string[]): string {
  const parsed: any[] = [];
  for (const t of texts) {
    const m = extractJson(t);
    if (!m) continue;
    try { parsed.push(JSON.parse(m)); } catch (err) { console.warn('[ai-providers] Skipped entry:', err instanceof Error ? err.message : err); }
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

  if (ok.length === 0) {
    const errors = results.map((r, i) => {
      const name = providers[i].name;
      const reason = r.status === 'rejected' ? (r.reason?.message ?? String(r.reason)) : 'unknown';
      console.error(`[ai-providers] ${name} failed:`, reason);
      return `${name}: ${reason}`;
    });
    throw new Error(`All AI providers failed — ${errors.join(' | ')}`);
  }
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
    await streamGemini(config, messages, onChunk, 4096);
    return;
  }

  if (config.type === 'anthropic') {
    const r = await callAnthropic(config, messages, 4096);
    for (const word of r.text.split(' ')) onChunk(word + ' ');
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
      } catch (err) { console.warn('[ai-providers] Skipped entry:', err instanceof Error ? err.message : err); }
    }
  }
}
