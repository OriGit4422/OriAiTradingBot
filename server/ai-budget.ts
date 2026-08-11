/**
 * AI Budget Governor — hard daily spend ceiling per provider.
 * ─────────────────────────────────────────────────────────────────────────────
 * Target: $0.01–$0.05 per AI provider per day. Enforced, not hoped for.
 *
 * Four mechanisms, applied in order on every AI call:
 *
 *   1. CACHE       — content-hashed response cache. Identical prompt within TTL
 *                    returns the stored answer for $0.
 *   2. SINGLE-FLIGHT — N concurrent callers with the same prompt produce ONE
 *                    upstream request; the rest await the same promise.
 *   3. TIER GATE   — every call declares a tier. Cheap/decorative calls are cut
 *                    off long before trade-critical ones:
 *                      cosmetic → blocked past 35% of the daily budget
 *                      normal   → blocked past 75%
 *                      critical → allowed to 100% (AI veto on a live signal)
 *   4. LEDGER      — real token usage (from provider usage metadata when
 *                    present, estimated otherwise) is priced and accumulated.
 *                    Past the ceiling the call is refused and the caller falls
 *                    back to its deterministic path. Nothing silently overspends.
 *
 * The ledger is per-UTC-day and is persisted to botLogs so a restart does not
 * reset the day's spend.
 */

import { createHash } from 'crypto';

// ─── Tiers ────────────────────────────────────────────────────────────────────

export type CallTier = 'critical' | 'normal' | 'cosmetic';

/** Fraction of the daily budget each tier is allowed to consume. */
const TIER_CEILING: Record<CallTier, number> = {
  critical: 1.00,  // AI veto on a signal that may be traded
  normal:   0.75,  // signal analysis, regime narrative
  cosmetic: 0.35,  // market mood strings, prose enrichment
};

// ─── Pricing table (USD per 1M tokens) ────────────────────────────────────────
// Keys are matched as case-insensitive prefixes against the model id.
// Unknown models fall back to DEFAULT_PRICE, which is deliberately pessimistic
// so an unpriced model can never quietly blow the budget.

export interface TokenPrice { inPer1M: number; outPer1M: number }

const DEFAULT_PRICE: TokenPrice = { inPer1M: 3.00, outPer1M: 15.00 };

const PRICING: Array<[string, TokenPrice]> = [
  // Google Gemini
  ['gemini-2.0-flash-lite', { inPer1M: 0.075, outPer1M: 0.30 }],
  ['gemini-2.0-flash',      { inPer1M: 0.10,  outPer1M: 0.40 }],
  ['gemini-2.5-flash-lite', { inPer1M: 0.10,  outPer1M: 0.40 }],
  ['gemini-2.5-flash',      { inPer1M: 0.30,  outPer1M: 2.50 }],
  ['gemini-2.5-pro',        { inPer1M: 1.25,  outPer1M: 10.00 }],
  ['gemini-1.5-flash',      { inPer1M: 0.075, outPer1M: 0.30 }],
  ['gemini-1.5-pro',        { inPer1M: 1.25,  outPer1M: 5.00 }],
  // OpenAI
  ['gpt-4o-mini',           { inPer1M: 0.15,  outPer1M: 0.60 }],
  ['gpt-4o',                { inPer1M: 2.50,  outPer1M: 10.00 }],
  ['gpt-4.1-mini',          { inPer1M: 0.40,  outPer1M: 1.60 }],
  ['gpt-4.1',               { inPer1M: 2.00,  outPer1M: 8.00 }],
  ['o4-mini',               { inPer1M: 1.10,  outPer1M: 4.40 }],
  // Anthropic
  ['claude-haiku',          { inPer1M: 1.00,  outPer1M: 5.00 }],
  ['claude-3-5-haiku',      { inPer1M: 0.80,  outPer1M: 4.00 }],
  ['claude-sonnet',         { inPer1M: 3.00,  outPer1M: 15.00 }],
  ['claude-opus',           { inPer1M: 15.00, outPer1M: 75.00 }],
];

export function priceFor(model: string): TokenPrice {
  const m = (model || '').toLowerCase();
  // Longest prefix wins so "gemini-2.0-flash-lite" is not matched by "gemini-2.0-flash".
  let best: TokenPrice | null = null;
  let bestLen = -1;
  for (const [prefix, price] of PRICING) {
    if (m.includes(prefix) && prefix.length > bestLen) { best = price; bestLen = prefix.length; }
  }
  return best ?? DEFAULT_PRICE;
}

export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = priceFor(model);
  return (tokensIn / 1e6) * p.inPer1M + (tokensOut / 1e6) * p.outPer1M;
}

/** ~4 chars per token is close enough for budgeting; we reconcile with real usage after the call. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export interface ProviderSpend {
  provider: string;
  spendUsd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  blocked: number;
  cacheHits: number;
}

export interface BudgetStatus {
  day: string;
  dailyBudgetUsd: number;
  totalSpendUsd: number;
  providers: ProviderSpend[];
  tierCeilings: Record<CallTier, number>;
  cacheEntries: number;
  /** Money not spent because a cached answer was reused. */
  savedByCacheUsd: number;
}

const DEFAULT_DAILY_BUDGET_USD = 0.05;

/**
 * Parse the configured cap, falling back to the default on anything unusable.
 *
 * `Number('')`, `Number('abc')` and `Number(undefined)` yield 0 or NaN. A NaN
 * ceiling is the dangerous one: every `spend + cost > NaN` comparison in admit()
 * is false, so a single typo in AI_DAILY_BUDGET_USD silently switched the daily
 * cap off entirely and let spend run unbounded. The cap must fail closed.
 */
export function parseDailyBudget(raw: string | undefined): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_DAILY_BUDGET_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(
      `[ai-budget] AI_DAILY_BUDGET_USD="${raw}" is not a positive number — ` +
      `using the $${DEFAULT_DAILY_BUDGET_USD}/day default instead.`,
    );
    return DEFAULT_DAILY_BUDGET_USD;
  }
  return n;
}

let dailyBudgetUsd = parseDailyBudget(process.env.AI_DAILY_BUDGET_USD);
let ledgerDay = utcDay();
let ledger = new Map<string, ProviderSpend>();
let savedByCacheUsd = 0;

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollIfNewDay(): void {
  const today = utcDay();
  if (today !== ledgerDay) {
    ledgerDay = today;
    ledger = new Map();
    savedByCacheUsd = 0;
  }
}

function entry(provider: string): ProviderSpend {
  rollIfNewDay();
  let e = ledger.get(provider);
  if (!e) {
    e = { provider, spendUsd: 0, calls: 0, tokensIn: 0, tokensOut: 0, blocked: 0, cacheHits: 0 };
    ledger.set(provider, e);
  }
  return e;
}

export function setDailyBudget(usd: number): void {
  if (Number.isFinite(usd) && usd > 0) dailyBudgetUsd = usd;
}

export function getDailyBudget(): number {
  return dailyBudgetUsd;
}

export function getBudgetStatus(): BudgetStatus {
  rollIfNewDay();
  const providers = [...ledger.values()].sort((a, b) => b.spendUsd - a.spendUsd);
  return {
    day: ledgerDay,
    dailyBudgetUsd,
    totalSpendUsd: round6(providers.reduce((s, p) => s + p.spendUsd, 0)),
    providers: providers.map(p => ({ ...p, spendUsd: round6(p.spendUsd) })),
    tierCeilings: TIER_CEILING,
    cacheEntries: responseCache.size,
    savedByCacheUsd: round6(savedByCacheUsd),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ─── Admission control ────────────────────────────────────────────────────────

export interface AdmissionResult {
  allowed: boolean;
  reason?: string;
  /** Estimated cost of the call that was admitted (or would have been). */
  estCostUsd: number;
}

/**
 * Decide whether a call may proceed. Uses the worst case (maxTokens fully
 * consumed) so a long answer cannot push the day past the ceiling.
 */
export function admit(opts: {
  provider: string;
  model: string;
  tier: CallTier;
  promptChars: number;
  maxOutTokens: number;
}): AdmissionResult {
  const e = entry(opts.provider);
  const estIn = Math.ceil(opts.promptChars / 4);
  const estCostUsd = estimateCostUsd(opts.model, estIn, opts.maxOutTokens);
  const ceiling = dailyBudgetUsd * TIER_CEILING[opts.tier];

  // Fail closed. Any comparison against NaN is false, so a non-finite ceiling or
  // cost estimate would wave every call through — the opposite of a spend cap.
  if (!Number.isFinite(ceiling) || !Number.isFinite(estCostUsd)) {
    e.blocked++;
    return {
      allowed: false,
      estCostUsd: Number.isFinite(estCostUsd) ? estCostUsd : 0,
      reason: 'AI budget guard: daily ceiling could not be evaluated — refusing the call',
    };
  }

  if (e.spendUsd + estCostUsd > ceiling) {
    e.blocked++;
    return {
      allowed: false,
      estCostUsd,
      reason:
        `AI budget guard: ${opts.provider} ${opts.tier} calls are capped at ` +
        `$${ceiling.toFixed(4)}/day (spent $${e.spendUsd.toFixed(4)}, this call ~$${estCostUsd.toFixed(5)})`,
    };
  }
  return { allowed: true, estCostUsd };
}

/** Record actual usage after a successful call. */
export function commit(opts: {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}): number {
  const e = entry(opts.provider);
  const cost = estimateCostUsd(opts.model, opts.tokensIn, opts.tokensOut);
  e.spendUsd += cost;
  e.calls++;
  e.tokensIn += opts.tokensIn;
  e.tokensOut += opts.tokensOut;
  return cost;
}

export function recordCacheHit(provider: string, savedUsd: number): void {
  const e = entry(provider);
  e.cacheHits++;
  savedByCacheUsd += savedUsd;
}

// ─── Response cache + single-flight ───────────────────────────────────────────

interface CacheEntry { text: string; provider: string; model: string; expiresAt: number; estCostUsd: number }

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<{ text: string; provider: string; model: string }>>();

const MAX_CACHE_ENTRIES = 500;

export function makeCacheKey(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

export function cacheGet(key: string): CacheEntry | null {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) { responseCache.delete(key); return null; }
  return hit;
}

export function cacheSet(key: string, value: Omit<CacheEntry, 'expiresAt'>, ttlMs: number): void {
  if (ttlMs <= 0) return;
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    // Evict the entry closest to expiry — cheap approximation of LRU.
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of responseCache) {
      if (v.expiresAt < oldestAt) { oldestAt = v.expiresAt; oldestKey = k; }
    }
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { ...value, expiresAt: Date.now() + ttlMs });
}

export function getInFlight(key: string) {
  return inFlight.get(key) ?? null;
}

export function setInFlight(key: string, p: Promise<{ text: string; provider: string; model: string }>) {
  inFlight.set(key, p);
  // The stored promise rejects whenever the upstream call fails. `void p.finally(...)`
  // used to leave that rejection on a derived promise nobody handled, and Node's
  // default --unhandled-rejections=throw turns that into a process exit: one 404
  // from a provider took the whole trading bot down. Swallowing here is safe —
  // the awaiting caller in callAIProvider still receives the real error.
  p.then(noop, noop).finally(() => inFlight.delete(key));
}

function noop(): void { /* rejection is reported to the awaiting caller, not here */ }

export function clearCache(): void {
  responseCache.clear();
  inFlight.clear();
}

/** Test/ops hook — resets the day's ledger. */
export function resetLedger(): void {
  ledgerDay = utcDay();
  ledger = new Map();
  savedByCacheUsd = 0;
}

// ─── Usage extraction from provider payloads ──────────────────────────────────

export function extractUsage(
  payload: any,
  fallbackPromptChars: number,
  fallbackText: string,
): { tokensIn: number; tokensOut: number; measured: boolean } {
  // Gemini
  const g = payload?.usageMetadata;
  if (g && typeof g.promptTokenCount === 'number') {
    return {
      tokensIn: g.promptTokenCount,
      tokensOut: g.candidatesTokenCount ?? 0,
      measured: true,
    };
  }
  // OpenAI-compatible
  const o = payload?.usage;
  if (o && typeof o.prompt_tokens === 'number') {
    return { tokensIn: o.prompt_tokens, tokensOut: o.completion_tokens ?? 0, measured: true };
  }
  // Anthropic
  if (o && typeof o.input_tokens === 'number') {
    return { tokensIn: o.input_tokens, tokensOut: o.output_tokens ?? 0, measured: true };
  }
  return {
    tokensIn: Math.ceil(fallbackPromptChars / 4),
    tokensOut: estimateTokens(fallbackText),
    measured: false,
  };
}

// ─── Persistence (survives restarts within the same UTC day) ─────────────────

export const BUDGET_LEDGER_EVENT = 'AI_BUDGET_LEDGER';

export function serializeLedger(): { day: string; providers: ProviderSpend[]; savedByCacheUsd: number } {
  rollIfNewDay();
  return { day: ledgerDay, providers: [...ledger.values()], savedByCacheUsd };
}

export function restoreLedger(snapshot: { day?: string; providers?: ProviderSpend[]; savedByCacheUsd?: number } | null): boolean {
  if (!snapshot?.day || snapshot.day !== utcDay() || !Array.isArray(snapshot.providers)) return false;
  ledgerDay = snapshot.day;
  ledger = new Map(snapshot.providers.map(p => [p.provider, { ...p }]));
  savedByCacheUsd = snapshot.savedByCacheUsd ?? 0;
  return true;
}
