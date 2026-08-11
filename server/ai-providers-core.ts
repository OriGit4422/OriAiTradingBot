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

import { estimateCostUsd, type CallTier } from './ai-budget';

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

// ─── Economy routing ──────────────────────────────────────────────────────────
//
// A $0.05/day budget and a premium model are incompatible: at $15 per 1M output
// tokens, a single 1,100-token answer is $0.017 — a third of the day. The app
// then spends most of its life refusing calls, which is what "all my credits are
// gone" looks like from the outside.
//
// Every prompt this app sends is short and structured: pre-computed indicator
// values in, a fixed JSON object out. That is exactly the workload the small
// models handle at full quality, so the premium model buys nothing here while
// costing 20–50x. Routing non-fitting calls onto the small model is therefore
// not a quality trade-off — it is removing an expense with no matching benefit.
//
// The downgrade is conditional, not unconditional: a configured model is used as
// configured whenever its worst-case price fits what is left in the budget. Only
// when it does not fit does the cheaper model take over, which keeps the feature
// working instead of returning an error.

/** Cheapest current model per provider that reliably returns well-formed JSON. */
export const ECONOMY_MODELS = {
  gemini: 'gemini-2.0-flash-lite',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
} as const;

/**
 * How aggressively to prefer the cheap model.
 *
 *   always — the default. Use the economy model whenever one exists. On Gemini
 *            this is the difference between ~7 deep analyses a day and ~250, for
 *            output of the same quality on prompts this small.
 *   auto   — keep the configured model while it fits the remaining budget, and
 *            downgrade only when it stops fitting. Costs more per call and
 *            therefore yields fewer of them.
 *   off    — never substitute. The configured model or nothing.
 *
 * Set `AI_ECONOMY_MODE` to change it. The default is deliberately the aggressive
 * one: a user who has set a $0.05/day cap has already said which side of the
 * cost/model trade-off they are on, and the panel reports every substitution
 * rather than making the change invisible.
 */
export type EconomyMode = 'always' | 'auto' | 'off';

export function parseEconomyMode(raw: string | undefined): EconomyMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'auto' || v === 'off' || v === 'always') return v;
  if (v !== '') {
    console.warn(`[ai-providers] AI_ECONOMY_MODE="${raw}" is not always|auto|off — using "always".`);
  }
  return 'always';
}

let economyMode: EconomyMode = parseEconomyMode(process.env.AI_ECONOMY_MODE);

export function getEconomyMode(): EconomyMode { return economyMode; }
export function setEconomyMode(mode: EconomyMode): void { economyMode = mode; }

/**
 * The cheap model to fall back to for this provider, or null when there is no
 * safe choice.
 *
 * Custom endpoints are only rewritten when they point at OpenAI itself. A
 * self-hosted or proxied OpenAI-compatible server exposes its own model names,
 * and substituting "gpt-4o-mini" there turns a budget problem into a 404.
 */
export function economyModelFor(config: Pick<AIProviderConfig, 'type' | 'baseUrl'>): string | null {
  if (config.type === 'gemini') return ECONOMY_MODELS.gemini;
  if (config.type === 'anthropic') return ECONOMY_MODELS.anthropic;
  const base = config.baseUrl || 'https://api.openai.com/v1';
  return /\/\/api\.openai\.com(\/|$)/.test(base) ? ECONOMY_MODELS.openai : null;
}

export interface ModelChoice {
  /** The model the request should actually be sent to. */
  model: string;
  /** Set when the configured model was too expensive for the remaining budget. */
  downgradedFrom?: string;
  /** Worst-case price of the call at `model`. */
  estCostUsd: number;
}

/**
 * Pick the model to send this call to.
 *
 * `capUsd` is the smaller of the per-call ceiling and what the provider has left
 * at this tier, so the choice adapts as the day fills: early calls run on the
 * configured model, and once headroom tightens the same feature keeps working on
 * the cheap one instead of failing. A downgrade is only taken when it actually
 * helps — if the cheap model still does not fit, the configured model is kept and
 * admission refuses it, so the caller falls back to its deterministic path with
 * an accurate reason rather than a misleading one.
 */
export function chooseModel(opts: {
  config: Pick<AIProviderConfig, 'type' | 'baseUrl'>;
  requested: string;
  promptChars: number;
  maxOutTokens: number;
  capUsd: number;
  /** Defaults to the process-wide AI_ECONOMY_MODE setting. */
  mode?: EconomyMode;
}): ModelChoice {
  const mode = opts.mode ?? economyMode;
  const tokensIn = Math.ceil(opts.promptChars / 4);
  const requestedCost = estimateCostUsd(opts.requested, tokensIn, opts.maxOutTokens);
  const keep: ModelChoice = { model: opts.requested, estCostUsd: requestedCost };

  if (mode === 'off') return keep;

  const economy = economyModelFor(opts.config);
  if (!economy || economy === opts.requested) return keep;

  const economyCost = estimateCostUsd(economy, tokensIn, opts.maxOutTokens);
  // Never "downgrade" onto something that is not actually cheaper — the pricing
  // table can be wrong or incomplete, and a substitution that costs more is
  // strictly worse than leaving the configured model in place.
  if (economyCost >= requestedCost) return keep;

  const swap: ModelChoice = { model: economy, downgradedFrom: opts.requested, estCostUsd: economyCost };

  if (mode === 'always') return swap;
  // mode === 'auto': the configured model stands while it fits what is left.
  return requestedCost <= opts.capUsd ? keep : swap;
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
