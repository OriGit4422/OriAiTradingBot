"""
Phase 0 — Edge Validation Backtest
===================================
Validates the core deterministic setup before any bot infrastructure is trusted.

Strategy: HTF (4H) EMA50 bias + liquidity sweep (EQH/EQL swept & reclaimed) on 15m,
          valid only inside London (07:00-10:00 UTC) or NY (12:00-15:00 UTC) kill zones.

Compare against an identical-risk random-entry control on the same data.
Apply realistic fees + slippage to both runs.

Output: per-pair PASS/FAIL based on whether the lower bound of a 1000-resample
        bootstrap 95% CI on (real expectancy - random expectancy) exceeds zero.

Gate: must PASS on at least 2 of 3 pairs to proceed to Phase 1.

Usage:
    pip install ccxt numpy pandas
    python backtest_validator.py
"""

import time
import random
import numpy as np
import pandas as pd

try:
    import ccxt
except ImportError:
    raise SystemExit("Install ccxt first: pip install ccxt numpy pandas")

# ─── Config ──────────────────────────────────────────────────────────────────

PAIRS       = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']
RISK_PCT    = 0.0075   # 0.75% per trade
RR_TP       = 1.5      # take-profit at 1.5R
RR_SL       = 1.0      # stop-loss at 1R
TAKER_FEE   = 0.0005   # 0.05% per side
SLIPPAGE    = 0.0003   # 0.03% per side
N_BOOTSTRAP = 1000
CI_LEVEL    = 0.95

LONDON_START = 7
LONDON_END   = 10
NY_START     = 12
NY_END       = 15

# ─── Data fetch ──────────────────────────────────────────────────────────────

def fetch_ohlcv(symbol: str, timeframe: str, since_days: int = 730) -> pd.DataFrame:
    exchange = ccxt.binance({'enableRateLimit': True})
    since_ms = int((time.time() - since_days * 86400) * 1000)
    all_candles = []
    while True:
        batch = exchange.fetch_ohlcv(symbol, timeframe, since=since_ms, limit=1000)
        if not batch:
            break
        all_candles.extend(batch)
        since_ms = batch[-1][0] + 1
        if len(batch) < 1000:
            break
        time.sleep(0.2)
    df = pd.DataFrame(all_candles, columns=['ts', 'open', 'high', 'low', 'close', 'volume'])
    df['ts'] = pd.to_datetime(df['ts'], unit='ms', utc=True)
    df.set_index('ts', inplace=True)
    return df

# ─── Indicators ──────────────────────────────────────────────────────────────

def ema(series: pd.Series, n: int) -> pd.Series:
    return series.ewm(span=n, adjust=False).mean()

def htf_bias(df_4h: pd.DataFrame) -> pd.Series:
    """1 = bullish (price > EMA50), -1 = bearish."""
    e = ema(df_4h['close'], 50)
    return np.sign(df_4h['close'] - e).replace(0, np.nan).ffill()

def liquidity_sweep(df_15m: pd.DataFrame, lookback: int = 20) -> pd.Series:
    """
    Returns 1 (bullish sweep) when:
      - price wicks below the rolling low of the last `lookback` bars and closes above it
    Returns -1 (bearish sweep) when:
      - price wicks above the rolling high and closes below it
    Otherwise 0.
    """
    prev_low  = df_15m['low'].rolling(lookback).min().shift(1)
    prev_high = df_15m['high'].rolling(lookback).max().shift(1)
    bullish = (df_15m['low'] < prev_low) & (df_15m['close'] > prev_low)
    bearish = (df_15m['high'] > prev_high) & (df_15m['close'] < prev_high)
    result = pd.Series(0, index=df_15m.index)
    result[bullish] = 1
    result[bearish] = -1
    return result

def in_kill_zone(index: pd.DatetimeIndex) -> pd.Series:
    hours = index.hour
    london = (hours >= LONDON_START) & (hours < LONDON_END)
    ny     = (hours >= NY_START) & (hours < NY_END)
    return pd.Series(london | ny, index=index)

# ─── Backtest engine ──────────────────────────────────────────────────────────

def run_backtest(df_15m: pd.DataFrame, df_4h: pd.DataFrame, random_entries: bool = False) -> list[float]:
    """
    Returns list of trade P&L in R-multiples.
    Each trade risks 1R, targets 1.5R (configurable via RR_TP/RR_SL).
    """
    # Align 4H bias to 15m index
    bias_4h = htf_bias(df_4h).reindex(df_15m.index, method='ffill')
    sweep_15m = liquidity_sweep(df_15m)
    kz = in_kill_zone(df_15m.index)

    trades: list[float] = []
    in_trade = False
    entry = sl = tp = direction = None

    valid_bars = df_15m.index[kz & df_15m.index.notnull()]

    if random_entries:
        # Uniformly random valid bar timestamps, same count as real strategy expects
        n_signals = max(1, len(valid_bars) // 50)
        entry_bars = set(pd.DatetimeIndex(random.sample(list(valid_bars), min(n_signals, len(valid_bars)))))
    else:
        entry_bars = None

    for i, ts in enumerate(df_15m.index):
        row = df_15m.iloc[i]
        price = row['close']

        # Exit open trade
        if in_trade:
            if direction == 1:
                if row['low'] <= sl:
                    raw = -RR_SL
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(raw - cost * (1 / RISK_PCT))
                    in_trade = False
                elif row['high'] >= tp:
                    raw = RR_TP
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(raw - cost * (1 / RISK_PCT))
                    in_trade = False
            else:
                if row['high'] >= sl:
                    raw = -RR_SL
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(raw - cost * (1 / RISK_PCT))
                    in_trade = False
                elif row['low'] <= tp:
                    raw = RR_TP
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(raw - cost * (1 / RISK_PCT))
                    in_trade = False
            continue

        if not kz.iloc[i]:
            continue

        if random_entries:
            if ts not in entry_bars:
                continue
            dir_rand = random.choice([1, -1])
            sl_dist = price * 0.005  # 0.5% default stop
            entry = price
            sl = entry - dir_rand * sl_dist
            tp = entry + dir_rand * sl_dist * RR_TP
            direction = dir_rand
            in_trade = True
        else:
            bias = bias_4h.get(ts, 0)
            sweep = sweep_15m.iloc[i]
            if bias == 0 or sweep == 0:
                continue
            if bias != sweep:
                continue  # direction must agree

            dir_val = int(bias)
            sl_dist = price * 0.005
            entry = price
            sl = entry - dir_val * sl_dist
            tp = entry + dir_val * sl_dist * RR_TP
            direction = dir_val
            in_trade = True

    return trades

# ─── Bootstrap CI ────────────────────────────────────────────────────────────

def bootstrap_ci(real_r: list[float], random_r: list[float], n: int = N_BOOTSTRAP) -> tuple[float, float]:
    """95% CI on (mean(real) - mean(random)) via percentile bootstrap."""
    if not real_r or not random_r:
        return (-999.0, -999.0)
    real_arr   = np.array(real_r)
    random_arr = np.array(random_r)
    diffs = []
    for _ in range(n):
        s_real   = np.random.choice(real_arr,   size=len(real_arr),   replace=True)
        s_random = np.random.choice(random_arr, size=len(random_arr), replace=True)
        diffs.append(s_real.mean() - s_random.mean())
    lo = np.percentile(diffs, (1 - CI_LEVEL) / 2 * 100)
    hi = np.percentile(diffs, (1 - (1 - CI_LEVEL) / 2) * 100)
    return float(lo), float(hi)

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Phase 0 — Edge Validation Backtest")
    print(f"Strategy: HTF EMA50 bias + liquidity sweep + kill zones")
    print(f"Fees: {TAKER_FEE*100:.3f}% taker | Slippage: {SLIPPAGE*100:.3f}%")
    print("=" * 60)

    passes = 0

    for pair in PAIRS:
        print(f"\n▶ {pair}")
        print("  Fetching 2 years of 15m + 4H candles...")
        try:
            df_15m = fetch_ohlcv(pair, '15m', since_days=730)
            df_4h  = fetch_ohlcv(pair, '4h',  since_days=730)
        except Exception as e:
            print(f"  ✗ Data fetch failed: {e}")
            continue

        print(f"  15m bars: {len(df_15m)} | 4H bars: {len(df_4h)}")

        real_trades   = run_backtest(df_15m, df_4h, random_entries=False)
        random_trades = run_backtest(df_15m, df_4h, random_entries=True)

        if not real_trades or not random_trades:
            print("  ✗ No trades generated")
            continue

        real_r   = np.array(real_trades)
        random_r = np.array(random_trades)

        win_rate  = float((real_r > 0).mean())
        expectancy = float(real_r.mean())
        max_dd    = float(np.min(np.minimum.accumulate(np.cumsum(real_r))))

        lo, hi = bootstrap_ci(real_trades, random_trades)

        passed = lo > 0
        if passed:
            passes += 1

        print(f"  Trades:    {len(real_trades)} real | {len(random_trades)} random")
        print(f"  Win rate:  {win_rate:.1%}")
        print(f"  Expectancy:{expectancy:+.3f}R per trade")
        print(f"  Max DD:    {max_dd:.2f}R")
        print(f"  Bootstrap 95% CI (real - random): [{lo:+.4f}, {hi:+.4f}]")
        print(f"  {'✅ PASS' if passed else '❌ FAIL'} — lower bound {'>' if passed else '<='} 0")

    print("\n" + "=" * 60)
    print(f"RESULT: {passes}/3 pairs passed")
    if passes >= 2:
        print("✅ GATE PASSED — proceed to Phase 1 (deterministic core)")
    else:
        print("❌ GATE FAILED — edge not validated after costs")
        print("   Action: revise entry logic (not infrastructure) before proceeding")
    print("=" * 60)

if __name__ == '__main__':
    main()
