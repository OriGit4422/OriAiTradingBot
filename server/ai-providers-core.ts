/**
 * AI Providers Core — the pure parts of the provider layer.
 *
 * Deliberately free of storage/db/network imports so it can be unit-tested
 * without a DATABASE_URL, mirroring the learning-core / learning-engine split.
 * `ai-providers.ts` wraps this with the actual HTTP calls and re-exports
 * everything here, so callers keep importing from one place.
 *
 * What lives here: model-id resolution, error classification, call-option
 * defaulting and JSON extraction — all of it deterministic and side-effect free
 * apart from the process-local map of models the API has reported as retired.
 */

import type { CallTier } from './ai-budget';

// ─── Call options ─────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Per-call controls. Passing a bare number is still supported and means
 * `{ maxTokens: n }`.
 */
export interface AICallOptions {
  maxTokens?: number;
  temperature?: number;
  /** Budget tier — defaults to 'normal'. */
  tier?: CallTier;
  /** How long an identical prompt may be served from cache. 0 disables. */
  cacheTtlMs?: number;
  /** Short label for logs/diagnostics. */
  label?: string;
}

export interface ResolvedCallOptions {
  maxTokens: number;
  temperature: number;
  tier: CallTier;
  cacheTtlMs: number;
  label: string;
}

/** Default cache TTL by tier — cosmetic text is reusable far longer than a veto. */
const DEFAULT_CACHE_TTL: Record<CallTier, number> = {
  critical: 3 * 60 * 1000,
  normal: 10 * 60 * 1000,
  cosmetic: 60 * 60 * 1000,
};

export function resolveOptions(
  opts: number | AICallOptions | undefined,
  defaultMaxTokens: number,
): ResolvedCallOptions {
  const o: AICallOptions = typeof opts === 'number' ? { maxTokens: opts } : (opts ?? {});
  const tier: CallTier = o.tier ?? 'normal';
  return {
    maxTokens: o.maxTokens ?? defaultMaxTokens,
    temperature: o.temperature ?? 0.3,
    tier,
    cacheTtlMs: o.cacheTtlMs ?? DEFAULT_CACHE_TTL[tier],
    label: o.label ?? 'ai-call',
  };
}

/** Thrown when the governor refuses a call. Callers fall back to deterministic paths. */
export class AIBudgetExceededError extends Error {
  readonly budgetExceeded = true;
  constructor(message: string) {
    super(message);
    this.name = 'AIBudgetExceededError';
  }
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
  /** Actual tokens consumed (provider-reported when available, else estimated). */
  usage?: { tokensIn: number; tokensOut: number; measured: boolean };
  /** True when the answer came from the response cache and cost nothing. */
  cached?: boolean;
}

// ─── Gemini model resolution ──────────────────────────────────────────────────
//
// A model id stored in Settings outlives the model itself. `gemini-1.5-pro-latest`
// was configured here and Google retired it from v1beta, so every AI call 404'd —
// which is what took the app down. Two layers guard against that recurring:
//
//   1. A static alias table rewrites known-retired ids at load time.
//   2. `noteRetiredModel` records any id the API reports as NOT_FOUND, so the very
//      next call skips it instead of paying for the same 404 again.
//
// A wrong model id must degrade to a working one, never crash and never block a signal.

/** Cheap, current, and universally available on v1beta — the safe landing spot. */
export const GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';

/** Retired ids → the current model that replaces them. Matched as a prefix. */
const RETIRED_GEMINI_PREFIXES: Array<[string, string]> = [
  ['gemini-1.5-pro',    GEMINI_FALLBACK_MODEL],
  ['gemini-1.5-flash',  GEMINI_FALLBACK_MODEL],
  ['gemini-1.0-pro',    GEMINI_FALLBACK_MODEL],
  ['gemini-pro-vision', GEMINI_FALLBACK_MODEL],
  ['gemini-pro',        GEMINI_FALLBACK_MODEL],
];

/** Models this process has seen return 404 NOT_FOUND, and what to use instead. */
const retiredAtRuntime = new Map<string, string>();

export function resolveGeminiModel(raw?: string | null): string {
  const model = (raw || '').trim() || GEMINI_FALLBACK_MODEL;
  const runtime = retiredAtRuntime.get(model);
  if (runtime) return runtime;
  const lower = model.toLowerCase();
  for (const [prefix, replacement] of RETIRED_GEMINI_PREFIXES) {
    if (lower.startsWith(prefix)) return replacement;
  }
  return model;
}

/** True when the provider says the model does not exist, rather than that the call failed. */
export function isModelNotFound(status: number, body: string): boolean {
  if (status !== 404) return false;
  return /NOT_FOUND|is not found|not supported for/i.test(body);
}

/**
 * Remember that `model` does not exist and return what to use instead, or null
 * when the fallback itself is what failed and there is nothing safer to try.
 */
export function noteRetiredModel(model: string): string | null {
  if (model === GEMINI_FALLBACK_MODEL) return null;
  if (!retiredAtRuntime.has(model)) {
    console.warn(
      `[ai-providers] Model "${model}" is not available on this API version — ` +
      `falling back to "${GEMINI_FALLBACK_MODEL}" for the rest of this process. ` +
      `Update it in Settings → AI Agents to silence this.`,
    );
  }
  retiredAtRuntime.set(model, GEMINI_FALLBACK_MODEL);
  return GEMINI_FALLBACK_MODEL;
}

/** Test hook — forget everything learned from 404s. */
export function clearRetiredModels(): void {
  retiredAtRuntime.clear();
}

/**
 * Classify a provider error. Deterministic failures are not worth retrying:
 * doing so delays every signal by the backoff and, on metered providers, bills
 * for the same rejection again.
 */
export function isRetryableError(message: string | undefined): boolean {
  const msg = message ?? '';
  const isAuthErr = msg.includes('401') || msg.includes('403') || msg.includes('invalid_api_key');
  const isBadReq = msg.includes('400') || msg.includes('invalid_request');
  const isMissingModel = msg.includes('404') || msg.includes('NOT_FOUND');
  return !(isAuthErr || isBadReq || isMissingModel);
}

// ─── JSON extraction from model output ────────────────────────────────────────

export function extractJson(text: string): string | null {
  if (!text) return null;
  // Try markdown code block first (object or array)
  const codeBlock = text.match(/```(?:json)?\s*([[{][\s\S]*?[\]}])\s*```/);
  if (codeBlock) return codeBlock[1];
  // Then bare JSON object
  const bare = text.match(/\{[\s\S]*\}/);
  if (bare) return bare[0];
  // Finally a bare JSON array
  const arr = text.match(/\[[\s\S]*\]/);
  return arr ? arr[0] : null;
}

/**
 * Extract AND parse JSON from a model response.
 * `extractJson` returns the raw substring; this returns the typed value or null.
 */
export function parseJson<T = any>(text: string): T | null {
  const raw = extractJson(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function promptChars(messages: AIMessage[]): number {
  return messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
}
