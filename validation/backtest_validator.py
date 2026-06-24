"""
Phase 0 — Edge Validation Backtest
===================================
Validates the core deterministic setup before any bot infrastructure is trusted.

Strategy v4 — complete entry redesign based on real data feedback:

  v2 (2R, 1.5× vol): 340 trades, 35% WR → negative EV after fees (breakeven=38%)
  v3 (3R, 2.5× vol, body filter): 48 trades, 25% WR → over-filtered, late entry

  Root cause of v3 failure: body quality filter checked the CONFIRMATION candle,
  which caused late entry after the initial impulse was spent. Also 48 trades
  gives too small a sample for the bootstrap CI to ever tighten.

  v4 redesign:
  1. Enter on the SWEEP candle's close (remove 1-bar shift).
     The sweep candle itself is the signal — close back above/below the level
     IS the confirmation. Entering on its close catches the reversal at source.

  2. Sweep candle recovery quality: close must be in top 35% of candle range
     (bullish) or bottom 35% (bearish). This filters weak recoveries on the
     sweep candle itself — the candle that actually matters.

  3. Sweep wick depth: the wick that sweeps the level must be >= 0.5× ATR(14)
     deep. Shallow sweeps are noise; deep ones are real stop hunts.

  4. Volume 2.0× (relaxed from 2.5×) — less restrictive, targets ~100-180 trades/yr.

  5. RSI filter back to 60/40 (loosened from 55/45).

  6. Stop = sweep candle's wick low/high + small buffer (0.1× ATR).
     Natural stop placement at the actual swept level, not a fixed ATR multiple.

  7. RR = 2.5R (compromise between 2R and 3R).
     Breakeven WR after fees: ~31%. Real data WR expected 35-42%.

Compare against an identical-risk random-entry control on the same data.
Apply realistic fees + slippage to both runs.

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
RR_TP       = 2.5      # take-profit at 2.5R; breakeven WR after fees ~31%
RR_SL       = 1.0      # stop-loss at 1R
TAKER_FEE   = 0.0005   # 0.05% per side
SLIPPAGE    = 0.0003   # 0.03% per side
N_BOOTSTRAP = 1000
CI_LEVEL    = 0.95

LONDON_START = 7
LONDON_END   = 10
NY_START     = 12
NY_END       = 15

VOLUME_SURGE_MULT  = 2.0   # sweep bar volume >= this × 20-bar avg
RSI_PERIOD         = 14
RSI_BULL_MAX       = 60    # bullish entries blocked above this 1H RSI
RSI_BEAR_MIN       = 40    # bearish entries blocked below this 1H RSI
ATR_PERIOD         = 14
RECOVERY_PCT       = 0.35  # sweep candle close must be in top/bottom 35% of its range
WICK_DEPTH_MULT    = 0.5   # sweep wick must be >= this × ATR(14) deep beyond the level
SL_BUFFER_MULT     = 0.1   # stop placed ATR × this beyond the wick extreme

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

def atr(df: pd.DataFrame, n: int = ATR_PERIOD) -> pd.Series:
    hl  = df['high'] - df['low']
    hpc = (df['high'] - df['close'].shift(1)).abs()
    lpc = (df['low']  - df['close'].shift(1)).abs()
    tr  = pd.concat([hl, hpc, lpc], axis=1).max(axis=1)
    return tr.ewm(com=n - 1, adjust=False).mean()

def rsi(series: pd.Series, n: int = RSI_PERIOD) -> pd.Series:
    delta    = series.diff()
    gain     = delta.clip(lower=0)
    loss     = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=n - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=n - 1, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def in_kill_zone(index: pd.DatetimeIndex) -> pd.Series:
    hours  = index.hour
    london = (hours >= LONDON_START) & (hours < LONDON_END)
    ny     = (hours >= NY_START) & (hours < NY_END)
    return pd.Series(london | ny, index=index)

def sweep_signals(df: pd.DataFrame, atr_series: pd.Series,
                  lookback: int = 20) -> pd.DataFrame:
    """
    Returns a DataFrame with columns:
      direction : 1 (bullish sweep) or -1 (bearish sweep) or 0 (none)
      sl_price  : natural stop price (wick extreme + buffer)

    Filters applied on the sweep candle itself:
      - wick sweeps the rolling level
      - close recovers back past the level (confirmed reversal in same candle)
      - close is in top/bottom RECOVERY_PCT of the candle range
      - volume >= VOLUME_SURGE_MULT x 20-bar rolling average
      - wick depth >= WICK_DEPTH_MULT x ATR
    """
    prev_low  = df['low'].rolling(lookback).min().shift(1)
    prev_high = df['high'].rolling(lookback).max().shift(1)
    vol_avg   = df['volume'].rolling(lookback).mean().shift(1)
    candle_rng = (df['high'] - df['low']).replace(0, np.nan)
    close_pos  = (df['close'] - df['low']) / candle_rng  # 0=at low, 1=at high

    bull = (
        (df['low'] < prev_low) &
        (df['close'] > prev_low) &
        (close_pos >= (1 - RECOVERY_PCT)) &
        (df['volume'] >= vol_avg * VOLUME_SURGE_MULT) &
        ((prev_low - df['low']) >= atr_series * WICK_DEPTH_MULT)
    )
    bear = (
        (df['high'] > prev_high) &
        (df['close'] < prev_high) &
        (close_pos <= RECOVERY_PCT) &
        (df['volume'] >= vol_avg * VOLUME_SURGE_MULT) &
        ((df['high'] - prev_high) >= atr_series * WICK_DEPTH_MULT)
    )

    direction = pd.Series(0, index=df.index)
    direction[bull] = 1
    direction[bear] = -1

    sl_bull = df['low']  - atr_series * SL_BUFFER_MULT
    sl_bear = df['high'] + atr_series * SL_BUFFER_MULT
    sl_price = pd.Series(np.nan, index=df.index)
    sl_price[bull] = sl_bull[bull]
    sl_price[bear] = sl_bear[bear]

    return pd.DataFrame({'direction': direction, 'sl_price': sl_price})

# ─── Backtest engine ──────────────────────────────────────────────────────────

def run_backtest(df_15m: pd.DataFrame, df_4h: pd.DataFrame,
                 df_1h: pd.DataFrame, random_entries: bool = False) -> list[float]:
    """Returns list of trade P&L in R-multiples."""
    bias_4h  = htf_bias(df_4h).reindex(df_15m.index, method='ffill')
    atr_15m  = atr(df_15m)
    sweeps   = sweep_signals(df_15m, atr_15m)
    kz       = in_kill_zone(df_15m.index)
    rsi_1h   = rsi(df_1h['close']).reindex(df_15m.index, method='ffill')

    trades: list[float] = []
    in_trade = False
    entry = sl = tp = direction = None

    valid_bars = df_15m.index[kz]

    if random_entries:
        n_signals  = max(1, len(valid_bars) // 50)
        entry_bars = set(pd.DatetimeIndex(
            random.sample(list(valid_bars), min(n_signals, len(valid_bars)))))
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
            dir_rand = random.choice([1, -1])
            sl_dist  = float(atr_15m.iloc[i]) * 1.1
            if sl_dist <= 0 or np.isnan(sl_dist):
                sl_dist = price * 0.005
            entry     = price
            sl        = entry - dir_rand * sl_dist
            tp        = entry + dir_rand * sl_dist * RR_TP
            direction = dir_rand
            in_trade  = True
        else:
            bias  = bias_4h.get(ts, 0)
            sweep = sweeps['direction'].iloc[i]

            if bias == 0 or sweep == 0 or bias != sweep:
                continue

            r = rsi_1h.iloc[i]
            if not np.isnan(r):
                if bias == 1 and r > RSI_BULL_MAX:
                    continue
                if bias == -1 and r < RSI_BEAR_MIN:
                    continue

            sl_price = sweeps['sl_price'].iloc[i]
            if np.isnan(sl_price):
                continue

            dir_val  = int(bias)
            entry    = price
            sl_dist  = abs(entry - sl_price)
            if sl_dist <= 0:
                continue
            sl        = sl_price
            tp        = entry + dir_val * sl_dist * RR_TP
            direction = dir_val
            in_trade  = True

    return trades

# ─── Bootstrap CI ────────────────────────────────────────────────────────────

def bootstrap_ci(real_r: list[float], random_r: list[float],
                 n: int = N_BOOTSTRAP) -> tuple[float, float]:
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
    print("Phase 0 — Edge Validation Backtest v4")
    print("v4: enter on sweep candle close, natural wick stop,")
    print("  sweep recovery + wick depth filters, 2.5R target")
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
