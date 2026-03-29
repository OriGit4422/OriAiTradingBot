/**
 * Exchange order execution module
 * Supports Binance Futures, Bybit V5, and MEXC Futures
 * All calls are HMAC-SHA256 signed.
 */

import { createHmac } from "crypto";

export type ExchangeName = "binance" | "bybit" | "mexc";

export interface ExchangeOrderRequest {
  symbol: string;         // e.g. BTCUSDT
  side: "BUY" | "SELL";  // BUY = long, SELL = short
  quantity: number;       // in base asset or contracts
  orderType?: "MARKET" | "LIMIT";
  price?: number;         // required for LIMIT
  leverage?: number;
  marginType?: "ISOLATED" | "CROSSED";
  reduceOnly?: boolean;
  stopLoss?: number;
  takeProfit?: number;
}

export interface ExchangeOrderResult {
  ok: boolean;
  orderId?: string;
  exchange: ExchangeName;
  message: string;
  details?: any;
}

export interface ExchangeBalance {
  ok: boolean;
  exchange: ExchangeName;
  totalWalletBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
  currency: string;
  message?: string;
}

// ── HMAC helpers ─────────────────────────────────────────────────────────────

function hmac256(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function qs(params: Record<string, any>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

// ── BINANCE FUTURES ───────────────────────────────────────────────────────────

const BINANCE_BASE = "https://fapi.binance.com";

async function binanceSigned(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, any> = {}
) {
  const timestamp = Date.now();
  const paramString = qs({ ...params, timestamp });
  const signature = hmac256(apiSecret, paramString);
  const url = `${BINANCE_BASE}${path}?${paramString}&signature=${signature}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Binance ${res.status}: ${data.msg ?? JSON.stringify(data)}`);
  return data;
}

export async function setBinanceLeverage(apiKey: string, apiSecret: string, symbol: string, leverage: number) {
  return binanceSigned("POST", "/fapi/v1/leverage", apiKey, apiSecret, { symbol, leverage });
}

export async function setBinanceMarginType(apiKey: string, apiSecret: string, symbol: string, marginType: "ISOLATED" | "CROSSED") {
  try {
    return await binanceSigned("POST", "/fapi/v1/marginType", apiKey, apiSecret, { symbol, marginType });
  } catch (e: any) {
    // Binance returns error if margin type is already set — safe to ignore
    if (e.message.includes("No need to change margin type")) return { ok: true };
    throw e;
  }
}

export async function getBinanceBalance(apiKey: string, apiSecret: string): Promise<ExchangeBalance> {
  try {
    const data = await binanceSigned("GET", "/fapi/v2/balance", apiKey, apiSecret);
    const usdt = Array.isArray(data) ? data.find((a: any) => a.asset === "USDT") : null;
    return {
      ok: true,
      exchange: "binance",
      totalWalletBalance: parseFloat(usdt?.balance ?? "0"),
      availableBalance: parseFloat(usdt?.availableBalance ?? "0"),
      unrealizedPnl: parseFloat(usdt?.unrealizedProfit ?? "0"),
      currency: "USDT",
    };
  } catch (e: any) {
    return { ok: false, exchange: "binance", totalWalletBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT", message: e.message };
  }
}

export async function placeBinanceOrder(apiKey: string, apiSecret: string, req: ExchangeOrderRequest): Promise<ExchangeOrderResult> {
  try {
    const sym = req.symbol.replace("/", "").toUpperCase();
    if (req.leverage) await setBinanceLeverage(apiKey, apiSecret, sym, req.leverage).catch(() => {});
    if (req.marginType) await setBinanceMarginType(apiKey, apiSecret, sym, req.marginType).catch(() => {});

    const order: Record<string, any> = {
      symbol: sym,
      side: req.side,
      type: req.orderType ?? "MARKET",
      quantity: req.quantity,
      positionSide: "BOTH",
    };
    if (req.orderType === "LIMIT" && req.price) {
      order.price = req.price;
      order.timeInForce = "GTC";
    }
    if (req.reduceOnly) order.reduceOnly = true;

    const result = await binanceSigned("POST", "/fapi/v1/order", apiKey, apiSecret, order);
    return { ok: true, orderId: String(result.orderId), exchange: "binance", message: `Binance ${req.side} ${req.quantity} ${sym} placed`, details: result };
  } catch (e: any) {
    return { ok: false, exchange: "binance", message: e.message };
  }
}

// ── BYBIT V5 FUTURES ──────────────────────────────────────────────────────────

const BYBIT_BASE = "https://api.bybit.com";

async function bybitSigned(
  method: "GET" | "POST",
  path: string,
  apiKey: string,
  apiSecret: string,
  body: Record<string, any> = {}
) {
  const timestamp = String(Date.now());
  const recv = "5000";
  let signPayload: string;
  let url = `${BYBIT_BASE}${path}`;
  const headers: Record<string, string> = {
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-RECV-WINDOW": recv,
    "Content-Type": "application/json",
  };

  if (method === "GET") {
    const q = qs(body);
    signPayload = timestamp + apiKey + recv + q;
    headers["X-BAPI-SIGN"] = hmac256(apiSecret, signPayload);
    if (q) url += `?${q}`;
  } else {
    const bodyStr = JSON.stringify(body);
    signPayload = timestamp + apiKey + recv + bodyStr;
    headers["X-BAPI-SIGN"] = hmac256(apiSecret, signPayload);
    const res = await fetch(url, { method, headers, body: bodyStr, signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}: ${data.retMsg}`);
    return data.result;
  }

  const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit ${data.retCode}: ${data.retMsg}`);
  return data.result;
}

export async function getBybitBalance(apiKey: string, apiSecret: string): Promise<ExchangeBalance> {
  try {
    const data = await bybitSigned("GET", "/v5/account/wallet-balance", apiKey, apiSecret, { accountType: "UNIFIED" });
    const list = data?.list?.[0]?.coin ?? [];
    const usdt = list.find((c: any) => c.coin === "USDT") ?? {};
    return {
      ok: true,
      exchange: "bybit",
      totalWalletBalance: parseFloat(usdt.walletBalance ?? "0"),
      availableBalance: parseFloat(usdt.availableToWithdraw ?? "0"),
      unrealizedPnl: parseFloat(usdt.unrealisedPnl ?? "0"),
      currency: "USDT",
    };
  } catch (e: any) {
    return { ok: false, exchange: "bybit", totalWalletBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT", message: e.message };
  }
}

export async function placeBybitOrder(apiKey: string, apiSecret: string, req: ExchangeOrderRequest): Promise<ExchangeOrderResult> {
  try {
    const sym = req.symbol.replace("/", "").toUpperCase();
    // Set leverage
    if (req.leverage) {
      await bybitSigned("POST", "/v5/position/set-leverage", apiKey, apiSecret, {
        category: "linear", symbol: sym,
        buyLeverage: String(req.leverage), sellLeverage: String(req.leverage),
      }).catch(() => {});
    }

    const body: Record<string, any> = {
      category: "linear",
      symbol: sym,
      side: req.side === "BUY" ? "Buy" : "Sell",
      orderType: req.orderType === "LIMIT" ? "Limit" : "Market",
      qty: String(req.quantity),
      timeInForce: "GTC",
    };
    if (req.price && req.orderType === "LIMIT") body.price = String(req.price);
    if (req.stopLoss) body.stopLoss = String(req.stopLoss);
    if (req.takeProfit) body.takeProfit = String(req.takeProfit);
    if (req.reduceOnly) body.reduceOnly = true;
    if (req.marginType) body.tradeMode = req.marginType === "ISOLATED" ? 1 : 0;

    const result = await bybitSigned("POST", "/v5/order/create", apiKey, apiSecret, body);
    return { ok: true, orderId: result?.orderId, exchange: "bybit", message: `Bybit ${req.side} ${req.quantity} ${sym} placed`, details: result };
  } catch (e: any) {
    return { ok: false, exchange: "bybit", message: e.message };
  }
}

// ── MEXC FUTURES ──────────────────────────────────────────────────────────────

const MEXC_BASE = "https://contract.mexc.com";

async function mexcSigned(
  method: "GET" | "POST",
  path: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, any> = {}
) {
  const timestamp = String(Date.now());
  const queryStr = qs(params);
  const signStr = apiKey + timestamp + queryStr;
  const signature = hmac256(apiSecret, signStr);
  const headers: Record<string, string> = {
    "ApiKey": apiKey,
    "Request-Time": timestamp,
    "Signature": signature,
    "Content-Type": "application/json",
  };

  let url = `${MEXC_BASE}${path}`;
  let body: string | undefined;

  if (method === "GET") {
    if (queryStr) url += `?${queryStr}`;
  } else {
    body = JSON.stringify(params);
  }

  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (data.code !== undefined && data.code !== 200 && data.code !== 0) {
    throw new Error(`MEXC ${data.code}: ${data.message ?? JSON.stringify(data)}`);
  }
  return data;
}

export async function getMexcBalance(apiKey: string, apiSecret: string): Promise<ExchangeBalance> {
  try {
    const data = await mexcSigned("GET", "/api/v1/private/account/assets", apiKey, apiSecret);
    const usdt = (data?.data ?? []).find((a: any) => a.currency === "USDT") ?? {};
    return {
      ok: true,
      exchange: "mexc",
      totalWalletBalance: parseFloat(usdt.equity ?? "0"),
      availableBalance: parseFloat(usdt.availableBalance ?? "0"),
      unrealizedPnl: parseFloat(usdt.unrealisedPnl ?? "0"),
      currency: "USDT",
    };
  } catch (e: any) {
    return { ok: false, exchange: "mexc", totalWalletBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT", message: e.message };
  }
}

export async function placeMexcOrder(apiKey: string, apiSecret: string, req: ExchangeOrderRequest): Promise<ExchangeOrderResult> {
  try {
    const sym = req.symbol.replace("/", "_").toUpperCase();
    // MEXC open/close order side: 1=open long, 2=close short, 3=open short, 4=close long
    // For auto-trading we always open new positions
    const openType = req.side === "BUY" ? 1 : 3; // 1=open long, 3=open short

    const body: Record<string, any> = {
      symbol: sym,
      price: req.orderType === "LIMIT" && req.price ? req.price : 0,
      vol: req.quantity,
      leverage: req.leverage ?? 10,
      side: openType,
      type: req.orderType === "LIMIT" ? 1 : 5, // 1=limit, 5=market
      openType: req.marginType === "CROSSED" ? 2 : 1, // 1=isolated, 2=cross
    };
    if (req.stopLoss) body.stopLossPrice = req.stopLoss;
    if (req.takeProfit) body.takeProfitPrice = req.takeProfit;

    const result = await mexcSigned("POST", "/api/v1/private/order/submit", apiKey, apiSecret, body);
    return { ok: true, orderId: String(result?.data), exchange: "mexc", message: `MEXC ${req.side} ${req.quantity} ${sym} placed`, details: result };
  } catch (e: any) {
    return { ok: false, exchange: "mexc", message: e.message };
  }
}

// ── Connectivity test ─────────────────────────────────────────────────────────

export async function testExchangeConnection(exchange: ExchangeName, apiKey: string, apiSecret: string): Promise<{ ok: boolean; message: string; balance?: ExchangeBalance }> {
  try {
    let balance: ExchangeBalance;
    if (exchange === "binance") balance = await getBinanceBalance(apiKey, apiSecret);
    else if (exchange === "bybit") balance = await getBybitBalance(apiKey, apiSecret);
    else balance = await getMexcBalance(apiKey, apiSecret);

    if (!balance.ok) return { ok: false, message: balance.message ?? "Auth failed" };
    return { ok: true, message: `Connected! Balance: $${balance.availableBalance.toFixed(2)} USDT`, balance };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}

// ── Auto-trade dispatcher ─────────────────────────────────────────────────────

export async function autoTradeSignal(
  exchange: ExchangeName,
  apiKey: string,
  apiSecret: string,
  signal: { coin: string; type: "LONG" | "SHORT"; entry: number; tp: number; sl: number; confidence: number },
  config: { leverage: number; marginType: "ISOLATED" | "CROSSED"; maxPositionUsdt: number; minConfidence: number }
): Promise<ExchangeOrderResult> {
  if (signal.confidence < config.minConfidence) {
    return { ok: false, exchange, message: `Confidence ${signal.confidence}% < minimum ${config.minConfidence}%` };
  }

  const sym = `${signal.coin.toUpperCase()}USDT`;
  const side = signal.type === "LONG" ? "BUY" : "SELL";

  // Calculate quantity based on max position size and entry price
  const rawQty = config.maxPositionUsdt / signal.entry;
  // Round to reasonable precision
  const qty = parseFloat(rawQty.toFixed(signal.entry > 1000 ? 3 : signal.entry > 100 ? 2 : signal.entry > 1 ? 1 : 0));

  const req: ExchangeOrderRequest = {
    symbol: sym,
    side,
    quantity: qty,
    orderType: "MARKET",
    leverage: config.leverage,
    marginType: config.marginType,
    stopLoss: signal.sl,
    takeProfit: signal.tp,
  };

  if (exchange === "binance") return placeBinanceOrder(apiKey, apiSecret, req);
  if (exchange === "bybit") return placeBybitOrder(apiKey, apiSecret, req);
  return placeMexcOrder(apiKey, apiSecret, req);
}
