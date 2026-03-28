/**
 * MetaApi MT5 bridge
 * Users register at https://metaapi.cloud, install the MetaApi EA on their MT5,
 * then provide their token + accountId here.
 *
 * This module wraps the MetaApi REST API directly (no SDK dep needed).
 */

const METAAPI_BASE = 'https://mt-client-api-v1.london.agiliumtrade.ai';

export interface MT5AccountInfo {
  id: string;
  name: string;
  login: string;
  server: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  currency: string;
  connected: boolean;
}

export interface MT5OrderRequest {
  symbol: string;      // XAUUSD
  type: 'ORDER_TYPE_BUY' | 'ORDER_TYPE_SELL';
  volume: number;      // lot size
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
}

export interface MT5OrderResult {
  orderId: string;
  positionId?: string;
  status: 'success' | 'error';
  message: string;
}

function headers(token: string) {
  return {
    'auth-token': token,
    'Content-Type': 'application/json',
  };
}

export async function getMT5AccountInfo(token: string, accountId: string): Promise<MT5AccountInfo> {
  // First check connection status
  const connRes = await fetch(
    `${METAAPI_BASE}/users/current/accounts/${accountId}/connection-status`,
    { headers: headers(token), signal: AbortSignal.timeout(10000) }
  );

  let connected = false;
  if (connRes.ok) {
    const conn = await connRes.json();
    connected = conn.connected === true;
  }

  // Get account info
  const res = await fetch(
    `${METAAPI_BASE}/users/current/accounts/${accountId}/account-information`,
    { headers: headers(token), signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MetaApi account info ${res.status}: ${err}`);
  }
  const data = await res.json();
  return {
    id: accountId,
    name: data.name ?? 'MT5 Account',
    login: String(data.login ?? ''),
    server: data.server ?? '',
    balance: data.balance ?? 0,
    equity: data.equity ?? 0,
    margin: data.margin ?? 0,
    freeMargin: data.freeMargin ?? 0,
    leverage: data.leverage ?? 100,
    currency: data.currency ?? 'USD',
    connected,
  };
}

export async function placeMT5Order(
  token: string,
  accountId: string,
  order: MT5OrderRequest
): Promise<MT5OrderResult> {
  try {
    const body = {
      actionType: order.type,
      symbol: order.symbol,
      volume: order.volume,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      comment: order.comment ?? 'WinM AI Gold Signal',
    };

    const res = await fetch(
      `${METAAPI_BASE}/users/current/accounts/${accountId}/trade`,
      {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return { orderId: '', status: 'error', message: `MetaApi trade error ${res.status}: ${err}` };
    }

    const data = await res.json();
    return {
      orderId: data.orderId ?? data.positionId ?? '',
      positionId: data.positionId,
      status: 'success',
      message: `Order placed: ${order.type === 'ORDER_TYPE_BUY' ? 'BUY' : 'SELL'} ${order.volume} lots at market`,
    };
  } catch (e: any) {
    return { orderId: '', status: 'error', message: e.message };
  }
}

export async function closeMT5Position(
  token: string,
  accountId: string,
  positionId: string,
  volume?: number
): Promise<MT5OrderResult> {
  try {
    const body: any = { actionType: 'POSITION_CLOSE_ID', positionId };
    if (volume) body.volume = volume;

    const res = await fetch(
      `${METAAPI_BASE}/users/current/accounts/${accountId}/trade`,
      {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return { orderId: '', status: 'error', message: `Close error ${res.status}: ${err}` };
    }
    const data = await res.json();
    return { orderId: data.orderId ?? '', status: 'success', message: 'Position closed' };
  } catch (e: any) {
    return { orderId: '', status: 'error', message: e.message };
  }
}

export async function getMT5OpenPositions(token: string, accountId: string): Promise<any[]> {
  const res = await fetch(
    `${METAAPI_BASE}/users/current/accounts/${accountId}/positions`,
    { headers: headers(token), signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.filter((p: any) => p.symbol === 'XAUUSD') : [];
}
