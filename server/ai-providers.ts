/**
 * Multi-AI Provider System
 * Supports: OpenAI-compatible custom APIs + Google Gemini + Anthropic
 *
 * Every call is routed through the AI budget governor (./ai-budget), which
 * caches, de-duplicates and hard-caps daily spend per provider. Callers declare
 * a tier so decorative calls are dropped long before trade-critical ones.
 */
import { storage } from './storage';
import {
  admit, commit, cacheGet, cacheSet, makeCacheKey, getInFlight, setInFlight,
  recordCacheHit, extractUsage,
} from './ai-budget';
import {
  resolveOptions, isModelNotFound, noteRetiredModel, resolveGeminiModel,
  isRetryableError, promptChars, extractJson, parseJson,
  GEMINI_FALLBACK_MODEL, AIBudgetExceededError,
  type AIMessage, type AICallOptions, type ResolvedCallOptions,
  type AIProviderConfig, type AIResponse,
} from './ai-providers-core';

// The pure half of this layer lives in ./ai-providers-core so it can be unit
// tested without a DATABASE_URL. Re-exported here so callers keep one import.
export * from './ai-providers-core';

// ── OpenAI-compatible API call ────────────────────────────────────────────────

async function callOpenAICompatible(
  config: AIProviderConfig,
  messages: AIMessage[],
  opts: ResolvedCallOptions,
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
      max_tokens: opts.maxTokens,
      messages: formatted,
      temperature: opts.temperature,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`${config.name} API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  return {
    text,
    provider: config.name,
    model: config.model,
    usage: extractUsage(data, promptChars(messages), text),
  };
}

// ── Google Gemini API call ────────────────────────────────────────────────────

async function callGemini(
  config: AIProviderConfig,
  messages: AIMessage[],
  opts: ResolvedCallOptions,
): Promise<AIResponse> {
  return callGeminiWithModel(config, messages, opts, resolveGeminiModel(config.model), true);
}

async function callGeminiWithModel(
  config: AIProviderConfig,
  messages: AIMessage[],
  opts: ResolvedCallOptions,
  model: string,
  mayDowngrade: boolean,
): Promise<AIResponse> {
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
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
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
    // A retired/unknown model is a configuration problem, not a transient one.
    // Downgrade once to a model that exists rather than surfacing a 404 that
    // would strip the AI layer off every signal until someone edits Settings.
    if (mayDowngrade && isModelNotFound(response.status, errText)) {
      const replacement = noteRetiredModel(model);
      if (replacement) {
        return callGeminiWithModel(config, messages, opts, replacement, false);
      }
    }
    throw new Error(`Gemini API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return {
    text,
    provider: 'Gemini',
    model,
    usage: extractUsage(data, promptChars(messages), text),
  };
}

async function streamGemini(
  config: AIProviderConfig,
  messages: AIMessage[],
  onChunk: (chunk: string) => void,
  maxTokens = 4096,
): Promise<void> {
  const model = resolveGeminiModel(config.model);
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
  opts: ResolvedCallOptions,
): Promise<AIResponse> {
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  const url = `${baseUrl}/v1/messages`;

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const body: any = {
    model: config.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
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
  return {
    text,
    provider: config.name,
    model: config.model,
    usage: extractUsage(data, promptChars(messages), text),
  };
}

// ── Unified caller with retry + budget governor ───────────────────────────────

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function dispatch(
  config: AIProviderConfig,
  messages: AIMessage[],
  opts: ResolvedCallOptions,
): Promise<AIResponse> {
  if (config.type === 'gemini') return callGemini(config, messages, opts);
  if (config.type === 'anthropic') return callAnthropic(config, messages, opts);
  return callOpenAICompatible(config, messages, opts);
}

export async function callAIProvider(
  config: AIProviderConfig,
  messages: AIMessage[],
  maxTokensOrOptions: number | AICallOptions = 1024,
  retries = 2,
): Promise<AIResponse> {
  const opts = resolveOptions(maxTokensOrOptions, 1024);
  // Price and cache against the model that will actually be called, not the id
  // stored in Settings — those diverge once a retired model has been downgraded.
  const model = config.type === 'gemini'
    ? resolveGeminiModel(config.model)
    : (config.model || 'unknown');

  // 1. Cache — identical prompt within TTL costs nothing.
  const key = makeCacheKey([config.name, model, opts.maxTokens, opts.temperature, messages]);
  const hit = cacheGet(key);
  if (hit) {
    recordCacheHit(config.name, hit.estCostUsd);
    return { text: hit.text, provider: hit.provider, model: hit.model, cached: true };
  }

  // 2. Single-flight — concurrent identical prompts share one upstream request.
  const pending = getInFlight(key);
  if (pending) {
    const shared = await pending;
    return { ...shared, cached: true };
  }

  // 3. Budget gate — worst-case priced before the request is made.
  const chars = promptChars(messages);
  const verdict = admit({
    provider: config.name,
    model,
    tier: opts.tier,
    promptChars: chars,
    maxOutTokens: opts.maxTokens,
  });
  if (!verdict.allowed) {
    throw new AIBudgetExceededError(verdict.reason ?? 'AI daily budget reached');
  }

  const run = (async (): Promise<AIResponse> => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await dispatch(config, messages, opts);
        // 4. Ledger — commit real usage.
        const usage = res.usage ?? { tokensIn: Math.ceil(chars / 4), tokensOut: 0, measured: false };
        const cost = commit({
          provider: config.name,
          model,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
        });
        cacheSet(key, { text: res.text, provider: res.provider, model: res.model, estCostUsd: cost }, opts.cacheTtlMs);
        return res;
      } catch (err: any) {
        lastError = err;
        // Only transient failures are worth a retry. Auth, malformed-request and
        // missing-model errors are deterministic: retrying them three times with
        // backoff just delays every signal by ~3s and, on metered providers,
        // bills for the same rejection twice more.
        if (!isRetryableError(err?.message) || attempt >= retries) break;
        // Exponential backoff: 1s, 2s
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
    throw lastError ?? new Error('AI provider call failed');
  })();

  // The derived promise must never be the only holder of a rejection: setInFlight
  // attaches a handler, and `run` itself is returned to (and awaited by) the caller.
  setInFlight(key, run.then(r => ({ text: r.text, provider: r.provider, model: r.model })));
  return run;
}

// ── Load active providers from DB settings ────────────────────────────────────

export async function getActiveProviders(): Promise<AIProviderConfig[]> {
  const s = await storage.getSettings();
  if (!s) return [];
  const ss = s as any;
  const primary: AIProviderConfig[] = [];
  const fallback: AIProviderConfig[] = [];

  // Gemini is always first — cheapest, highest quota.
  // The previous mapping here pointed gemini-1.5-pro at gemini-1.5-pro-latest and
  // gemini-1.0-pro at gemini-1.5-flash; the whole 1.5 line has since been retired
  // from v1beta, so both aliases 404'd. resolveGeminiModel owns this now and lands
  // every retired id on a model that currently exists.
  if (ss.geminiEnabled && ss.geminiApiKey) {
    primary.push({
      name: 'Gemini',
      type: 'gemini',
      apiKey: ss.geminiApiKey,
      model: resolveGeminiModel(ss.geminiModel),
    });
  }

  if (ss.customAi1Enabled && ss.customAi1ApiKey) {
    fallback.push({
      name: ss.customAi1Name || 'Custom AI 1',
      type: 'custom',
      baseUrl: ss.customAi1BaseUrl || 'https://api.openai.com/v1',
      apiKey: ss.customAi1ApiKey,
      model: ss.customAi1Model || 'gpt-4o',
    });
  }

  if (ss.customAi2Enabled && ss.customAi2ApiKey) {
    fallback.push({
      name: ss.customAi2Name || 'Custom AI 2',
      type: 'custom',
      baseUrl: ss.customAi2BaseUrl || 'https://api.openai.com/v1',
      apiKey: ss.customAi2ApiKey,
      model: ss.customAi2Model || 'gpt-4o',
    });
  }

  if (ss.openaiEnabled && ss.openaiApiKey) {
    fallback.push({
      name: 'OpenAI',
      type: 'custom',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: ss.openaiApiKey,
      model: ss.openaiModel || 'gpt-4o',
    });
  }

  if (ss.anthropicEnabled && ss.anthropicApiKey) {
    fallback.push({
      name: 'Claude',
      type: 'anthropic',
      apiKey: ss.anthropicApiKey,
      model: ss.anthropicModel || 'claude-sonnet-4-6',
    });
  }

  // Gemini first, others after
  return [...primary, ...fallback];
}

// ── Multi-AI: run all providers in parallel, aggregate JSON numeric fields ────


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
  maxTokensOrOptions: number | AICallOptions = 1024,
): Promise<{ text: string; providers: string[]; cached?: boolean }> {
  const opts = resolveOptions(maxTokensOrOptions, 1024);
  const providers = await getActiveProviders();
  if (providers.length === 0) {
    throw new Error('No AI providers configured. Add API keys in Settings → AI Agents.');
  }

  // Try Gemini first (index 0 — always placed first by getActiveProviders).
  // If it succeeds, return immediately without burning quota on other providers.
  const primary = providers[0];
  const fallbacks = providers.slice(1);

  try {
    const r = await callAIProvider(primary, messages, opts);
    return { text: r.text, providers: [r.provider], cached: r.cached };
  } catch (primaryErr: any) {
    console.warn(`[ai-providers] Primary (${primary.name}) failed: ${primaryErr?.message} — trying fallbacks`);
    if (fallbacks.length === 0) throw primaryErr;
  }

  // Primary failed — try fallbacks SEQUENTIALLY, cheapest first, and stop at the
  // first success. Fanning out in parallel multiplied spend by the number of
  // configured providers for no accuracy gain (the responses were averaged).
  const errors: string[] = [`${primary.name}: (failed — see above)`];
  for (const p of fallbacks) {
    try {
      const r = await callAIProvider(p, messages, opts);
      return { text: r.text, providers: [r.provider], cached: r.cached };
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      console.error(`[ai-providers] ${p.name} failed:`, reason);
      errors.push(`${p.name}: ${reason}`);
    }
  }
  throw new Error(`All AI providers failed — ${errors.join(' | ')}`);
}

/**
 * Consensus mode — queries every configured provider and merges numeric fields.
 * Costs N× a single call, so it is opt-in and never used on hot paths.
 */
export async function callConsensusAI(
  messages: AIMessage[],
  maxTokensOrOptions: number | AICallOptions = 1024,
): Promise<{ text: string; providers: string[] }> {
  const opts = resolveOptions(maxTokensOrOptions, 1024);
  const providers = await getActiveProviders();
  if (providers.length === 0) {
    throw new Error('No AI providers configured. Add API keys in Settings → AI Agents.');
  }

  const results = await Promise.allSettled(
    providers.map(p => callAIProvider(p, messages, opts)),
  );
  const ok = results
    .filter((r): r is PromiseFulfilledResult<AIResponse> => r.status === 'fulfilled')
    .map(r => r.value);

  if (ok.length === 0) {
    const errors = providers.map((p, i) => {
      const r = results[i];
      const reason = r.status === 'rejected' ? (r.reason?.message ?? String(r.reason)) : 'unknown';
      console.error(`[ai-providers] ${p.name} failed:`, reason);
      return `${p.name}: ${reason}`;
    });
    throw new Error(`All AI providers failed — ${errors.join(' | ')}`);
  }
  if (ok.length === 1) return { text: ok[0].text, providers: [ok[0].provider] };

  const aggregatedText = aggregateJsonResponses(ok.map(r => r.text));
  return { text: aggregatedText, providers: ok.map(r => r.provider) };
}

// ── Streaming helper for chat (SSE) ──────────────────────────────────────────
// Returns text chunks via callback; uses first available provider

const CHAT_MAX_TOKENS = 1500;

export async function streamChatResponse(
  messages: AIMessage[],
  onChunk: (chunk: string) => void,
): Promise<void> {
  const providers = await getActiveProviders();
  if (providers.length === 0) {
    throw new Error('No AI providers configured. Add API keys in Settings → AI Agents.');
  }

  const config = providers[0];
  const model = config.model || (config.type === 'gemini' ? 'gemini-2.0-flash' : 'unknown');
  const chars = promptChars(messages);

  // Chat is user-initiated, so it counts against the 'normal' tier rather than
  // running outside the budget entirely.
  const verdict = admit({
    provider: config.name,
    model,
    tier: 'normal',
    promptChars: chars,
    maxOutTokens: CHAT_MAX_TOKENS,
  });
  if (!verdict.allowed) throw new AIBudgetExceededError(verdict.reason ?? 'AI daily budget reached');

  // Streaming responses carry no reliable usage metadata, so the emitted text is
  // measured locally and committed to the ledger when the stream ends.
  let produced = '';
  const track = (chunk: string) => { produced += chunk; onChunk(chunk); };
  const settle = () => {
    commit({
      provider: config.name,
      model,
      tokensIn: Math.ceil(chars / 4),
      tokensOut: Math.ceil(produced.length / 4),
    });
  };

  if (config.type === 'gemini') {
    try {
      await streamGemini(config, messages, track, CHAT_MAX_TOKENS);
    } finally { settle(); }
    return;
  }

  if (config.type === 'anthropic') {
    const r = await callAnthropic(config, messages, resolveOptions({ maxTokens: CHAT_MAX_TOKENS }, CHAT_MAX_TOKENS));
    commit({
      provider: config.name,
      model,
      tokensIn: r.usage?.tokensIn ?? Math.ceil(chars / 4),
      tokensOut: r.usage?.tokensOut ?? Math.ceil(r.text.length / 4),
    });
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
      max_tokens: CHAT_MAX_TOKENS,
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

  try {
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
          if (chunk) track(chunk);
        } catch (err) { console.warn('[ai-providers] Skipped entry:', err instanceof Error ? err.message : err); }
      }
    }
  } finally {
    settle();
  }
}
