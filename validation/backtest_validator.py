"""
Phase 0 — Edge Validation Backtest
===================================
Validates the core deterministic setup before any bot infrastructure is trusted.

Strategy v3 improvements over v2 (based on real Binance backtest results):
  Real data showed win rates of 33–37% — below the ~38% breakeven at 2R after fees.
  Three root causes identified and fixed:

  1. RR raised to 3.0: fee breakeven drops from 38% to ~29%, giving real headroom
     at the observed 33–37% win rates. EV at 35% WR, 3R: 0.35×3 - 0.65×1 - 0.21 = +0.19R.

  2. Volume threshold raised from 1.5× to 2.5×: real data produced 324–347 trades
     (too many; quality suffers). 2.5× selects only the clearest institutional sweeps
     and targets ~80–120 trades per year per pair.

  3. Candle body quality filter: for bullish sweeps, the confirmation candle close
     must be in the top 40% of its own range (close > low + 0.4×(high-low)).
     For bearish sweeps, close must be in the bottom 40%. Eliminates indecision doji
     candles that signal no real directional commitment.

  Previous improvements retained: confirmation candle, RSI momentum filter, ATR stops,
  HTF EMA50 bias, kill-zone filter, bootstrap gate.

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
RR_TP       = 3.0      # take-profit at 3R — breakeven WR drops to ~29% after fees
RR_SL       = 1.0      # stop-loss at 1R
TAKER_FEE   = 0.0005   # 0.05% per side
SLIPPAGE    = 0.0003   # 0.03% per side
N_BOOTSTRAP = 1000
CI_LEVEL    = 0.95

LONDON_START = 7
LONDON_END   = 10
NY_START     = 12
NY_END       = 15

VOLUME_SURGE_MULT = 2.5   # sweep bar volume must be >= this × 20-bar avg (raised from 1.5)
RSI_PERIOD        = 14
RSI_BULL_MAX      = 55    # bullish entries blocked above this RSI (tightened from 60)
RSI_BEAR_MIN      = 45    # bearish entries blocked below this RSI (tightened from 40)
BODY_QUALITY_PCT  = 0.40  # confirmation candle close must be in top/bottom 40% of range
ATR_PERIOD        = 14
ATR_MULT          = 1.0   # stop distance = ATR_MULT × ATR(14)

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
    Returns 1 (bullish sweep) when price wicks below rolling low and closes above it.
    Returns -1 (bearish sweep) when price wicks above rolling high and closes below it.
    Signal is shifted forward by 1 bar so entry happens on the confirmation candle,
    not the sweep candle itself (improvement #1).
    """
    prev_low  = df_15m['low'].rolling(lookback).min().shift(1)
    prev_high = df_15m['high'].rolling(lookback).max().shift(1)
    bullish = (df_15m['low'] < prev_low) & (df_15m['close'] > prev_low)
    bearish = (df_15m['high'] > prev_high) & (df_15m['close'] < prev_high)
    result = pd.Series(0, index=df_15m.index)
    result[bullish] = 1
    result[bearish] = -1
    # Shift by 1: enter on the bar after the sweep is confirmed
    return result.shift(1).fillna(0)

def volume_surge(df_15m: pd.DataFrame, lookback: int = 20, mult: float = VOLUME_SURGE_MULT) -> pd.Series:
    """True on bars where volume >= mult × rolling average."""
    avg_vol = df_15m['volume'].rolling(lookback).mean().shift(1)
    # shift(1) aligns the sweep bar's volume with the confirmation bar index
    surge = (df_15m['volume'].shift(1) >= avg_vol * mult)
    return surge.fillna(False)

def body_quality(df_15m: pd.DataFrame, direction: pd.Series) -> pd.Series:
    """
    True when the confirmation candle shows committed directional body.
    Bullish (direction=1): close in top BODY_QUALITY_PCT of candle range.
    Bearish (direction=-1): close in bottom BODY_QUALITY_PCT of candle range.
    Eliminates doji and indecision bars.
    """
    rng = (df_15m['high'] - df_15m['low']).replace(0, np.nan)
    pos = (df_15m['close'] - df_15m['low']) / rng  # 0=at low, 1=at high
    bull_ok = (direction == 1) & (pos >= (1 - BODY_QUALITY_PCT))
    bear_ok = (direction == -1) & (pos <= BODY_QUALITY_PCT)
    return (bull_ok | bear_ok).fillna(False)

def rsi(series: pd.Series, n: int = RSI_PERIOD) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=n - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=n - 1, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def atr(df: pd.DataFrame, n: int = ATR_PERIOD) -> pd.Series:
    hl  = df['high'] - df['low']
    hpc = (df['high'] - df['close'].shift(1)).abs()
    lpc = (df['low']  - df['close'].shift(1)).abs()
    tr  = pd.concat([hl, hpc, lpc], axis=1).max(axis=1)
    return tr.ewm(com=n - 1, adjust=False).mean()

def in_kill_zone(index: pd.DatetimeIndex) -> pd.Series:
    hours = index.hour
    london = (hours >= LONDON_START) & (hours < LONDON_END)
    ny     = (hours >= NY_START) & (hours < NY_END)
    return pd.Series(london | ny, index=index)

# ─── Backtest engine ──────────────────────────────────────────────────────────

def run_backtest(df_15m: pd.DataFrame, df_4h: pd.DataFrame,
                 df_1h: pd.DataFrame, random_entries: bool = False) -> list[float]:
    """
    Returns list of trade P&L in R-multiples.
    Each trade risks 1R, targets RR_TP R.
    """
    bias_4h   = htf_bias(df_4h).reindex(df_15m.index, method='ffill')
    sweep_15m = liquidity_sweep(df_15m)
    vol_surge = volume_surge(df_15m)
    body_ok   = body_quality(df_15m, sweep_15m)
    kz        = in_kill_zone(df_15m.index)
    atr_15m   = atr(df_15m)

    rsi_1h    = rsi(df_1h['close']).reindex(df_15m.index, method='ffill')

    trades: list[float] = []
    in_trade = False
    entry = sl = tp = direction = None

    valid_bars = df_15m.index[kz]

    if random_entries:
        n_signals = max(1, len(valid_bars) // 50)
        entry_bars = set(pd.DatetimeIndex(random.sample(list(valid_bars), min(n_signals, len(valid_bars)))))
    else:
        entry_bars = None

    for i, ts in enumerate(df_15m.index):
        row   = df_15m.iloc[i]
        price = row['close']

        if in_trade:
            if direction == 1:
                if row['low'] <= sl:
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(-RR_SL - cost * (1 / RISK_PCT))
                    in_trade = False
                elif row['high'] >= tp:
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(RR_TP - cost * (1 / RISK_PCT))
                    in_trade = False
            else:
                if row['high'] >= sl:
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(-RR_SL - cost * (1 / RISK_PCT))
                    in_trade = False
                elif row['low'] <= tp:
                    cost = (TAKER_FEE + SLIPPAGE) * 2
                    trades.append(RR_TP - cost * (1 / RISK_PCT))
                    in_trade = False
            continue

        if not kz.iloc[i]:
            continue

        if random_entries:
            if ts not in entry_bars:
                continue
            dir_rand  = random.choice([1, -1])
            sl_dist   = float(atr_15m.iloc[i]) * ATR_MULT
            if sl_dist <= 0 or np.isnan(sl_dist):
                sl_dist = price * 0.005
            entry     = price
            sl        = entry - dir_rand * sl_dist
            tp        = entry + dir_rand * sl_dist * RR_TP
            direction = dir_rand
            in_trade  = True
        else:
            bias  = bias_4h.get(ts, 0)
            sweep = sweep_15m.iloc[i]

            if bias == 0 or sweep == 0 or bias != sweep:
                continue

            # Volume surge filter
            if not vol_surge.iloc[i]:
                continue

            # Candle body quality filter
            if not body_ok.iloc[i]:
                continue

            # RSI momentum filter
            r = rsi_1h.iloc[i]
            if not np.isnan(r):
                if bias == 1 and r > RSI_BULL_MAX:
                    continue
                if bias == -1 and r < RSI_BEAR_MIN:
                    continue

            # ATR-based stop (improvement #4)
            sl_dist = float(atr_15m.iloc[i]) * ATR_MULT
            if sl_dist <= 0 or np.isnan(sl_dist):
                sl_dist = price * 0.005

            dir_val   = int(bias)
            entry     = price
            sl        = entry - dir_val * sl_dist
            tp        = entry + dir_val * sl_dist * RR_TP
            direction = dir_val
            in_trade  = True

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
    print("Phase 0 — Edge Validation Backtest v3")
    print("v3 fixes: 3R target, 2.5× volume threshold,")
    print("  candle body quality filter, tighter RSI (55/45)")
    print(f"Fees: {TAKER_FEE*100:.3f}% taker | Slippage: {SLIPPAGE*100:.3f}%")
    print("=" * 60)

    passes = 0

    for pair in PAIRS:
        print(f"\n▶ {pair}")
        print("  Fetching 2 years of 15m, 1H + 4H candles...")
        try:
            df_15m = fetch_ohlcv(pair, '15m', since_days=730)
            df_1h  = fetch_ohlcv(pair, '1h',  since_days=730)
            df_4h  = fetch_ohlcv(pair, '4h',  since_days=730)
        except Exception as e:
            print(f"  ✗ Data fetch failed: {e}")
            continue

        print(f"  15m bars: {len(df_15m)} | 1H bars: {len(df_1h)} | 4H bars: {len(df_4h)}")

        real_trades   = run_backtest(df_15m, df_4h, df_1h, random_entries=False)
        random_trades = run_backtest(df_15m, df_4h, df_1h, random_entries=True)

        if not real_trades or not random_trades:
            print("  ✗ No trades generated")
            continue

        real_r   = np.array(real_trades)
        random_r = np.array(random_trades)

        win_rate   = float((real_r > 0).mean())
        expectancy = float(real_r.mean())
        max_dd     = float(np.min(np.minimum.accumulate(np.cumsum(real_r))))

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
