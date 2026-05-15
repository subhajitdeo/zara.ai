"""
NSE Nifty 500 Trend Strength Scanner
Fixed: yfinance MultiIndex columns + scalar extraction + delisted symbols
"""

import json
import time
import logging
import sys
import os
from datetime import datetime
from typing import Dict, List, Optional
import pandas as pd
import yfinance as yf
from tqdm import tqdm

SYMBOLS_FILE = "nifty500.txt"
OUTPUT_FILE = "data/results.json"
YEARS = 3
DELAY = 0.3
MAX_RETRIES = 2

WEIGHTS = {
    "ema_separation": 0.20,
    "price_distance": 0.25,
    "daily_gain": 0.20,
    "relative_volume": 0.15,
    "momentum": 0.20
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def load_symbols():
    with open(SYMBOLS_FILE, 'r') as f:
        symbols = [line.strip().upper() for line in f if line.strip()]
    logger.info(f"Loaded {len(symbols)} symbols")
    return symbols

def fetch_stock(symbol: str) -> Optional[pd.DataFrame]:
    ticker = f"{symbol}.NS"
    for attempt in range(MAX_RETRIES):
        try:
            df = yf.download(ticker, period=f"{YEARS}y", progress=False, auto_adjust=False)
            if df.empty or len(df) < 200:
                logger.warning(f"{symbol}: insufficient data ({len(df)} days)")
                return None
            # FIX: Flatten MultiIndex columns (yfinance returns ('Close','RELIANCE.NS') etc.)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)
            df = df[['Open','High','Low','Close','Volume']].copy()
            df.sort_index(inplace=True)
            return df
        except Exception as e:
            logger.warning(f"{symbol} attempt {attempt+1} failed: {e}")
            time.sleep(2)
    return None

def calculate_emas(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['EMA20'] = df['Close'].ewm(span=20, adjust=False).mean()
    df['EMA50'] = df['Close'].ewm(span=50, adjust=False).mean()
    df['EMA100'] = df['Close'].ewm(span=100, adjust=False).mean()
    df['EMA200'] = df['Close'].ewm(span=200, adjust=False).mean()
    return df

def compute_metrics(df: pd.DataFrame, symbol: str) -> Optional[Dict]:
    try:
        if df is None or df.empty:
            return None
        df = calculate_emas(df)
        # Extract scalars – now works because columns are flattened
        close = float(df['Close'].iloc[-1])
        ema20 = float(df['EMA20'].iloc[-1])
        ema50 = float(df['EMA50'].iloc[-1])
        ema100 = float(df['EMA100'].iloc[-1])
        ema200 = float(df['EMA200'].iloc[-1])
        current_vol = float(df['Volume'].iloc[-1])
        if any(pd.isna(x) for x in [ema20, ema50, ema100, ema200]):
            return None
        prev_close = float(df['Close'].iloc[-2]) if len(df) > 1 else close
        daily_gain = (close - prev_close) / prev_close * 100
        vol_series = df['Volume'].iloc[-21:-1]
        avg_vol = float(vol_series.mean()) if len(vol_series) >= 10 else current_vol
        rel_vol = current_vol / avg_vol if avg_vol > 0 else 1.0
        ema_sep = (ema20 - ema200) / ema200 * 100
        price_dist = (close - ema20) / ema20 * 100
        if len(df) >= 6:
            close_5d_ago = float(df['Close'].iloc[-6])
            momentum = (close - close_5d_ago) / close_5d_ago * 100
        else:
            momentum = daily_gain
        # Separate comparisons – all scalars, no ambiguity
        is_bullish = (close > ema20) and (ema20 > ema50) and (ema50 > ema100) and (ema100 > ema200)
        return {
            "symbol": symbol,
            "price": round(close, 2),
            "ema20": round(ema20, 2),
            "ema50": round(ema50, 2),
            "ema100": round(ema100, 2),
            "ema200": round(ema200, 2),
            "daily_gain_pct": round(daily_gain, 2),
            "volume": int(current_vol),
            "rel_volume": round(rel_vol, 2),
            "ema_sep_pct": round(ema_sep, 2),
            "price_dist_pct": round(price_dist, 2),
            "momentum_pct": round(momentum, 2),
            "is_bullish_aligned": is_bullish
        }
    except Exception as e:
        logger.error(f"{symbol}: compute error {e}")
        return None

def normalize(values):
    if len(values) < 2:
        return [0.5] * len(values)
    s = pd.Series(values)
    low, high = s.quantile(0.05), s.quantile(0.95)
    if high <= low:
        return [0.5] * len(values)
    return [max(0.0, min(1.0, (v - low) / (high - low))) for v in values]

def add_scores(stocks):
    if not stocks:
        return []
    keys = ["ema_sep_pct", "price_dist_pct", "daily_gain_pct", "rel_volume", "momentum_pct"]
    metrics = {k: [s[k] for s in stocks] for k in keys}
    norm = {k: normalize(v) for k, v in metrics.items()}
    for i, s in enumerate(stocks):
        score = sum(norm[k][i] * WEIGHTS[k] for k in WEIGHTS)
        s["trend_score"] = round(score * 100, 1)
        if s["is_bullish_aligned"] and s["trend_score"] >= 60:
            s["status"], s["color"] = "Strong Bullish", "green"
        elif s["is_bullish_aligned"]:
            s["status"], s["color"] = "Bullish", "green"
        elif s["trend_score"] >= 50:
            s["status"], s["color"] = "Neutral", "yellow"
        else:
            s["status"], s["color"] = "Weak", "red"
    stocks.sort(key=lambda x: x["trend_score"], reverse=True)
    for rank, s in enumerate(stocks, 1):
        s["rank"] = rank
    return stocks

def main():
    start = datetime.now()
    logger.info("Starting NSE scanner (yfinance) - MultiIndex fix applied")
    symbols = load_symbols()
    if not symbols:
        sys.exit(1)
    all_stocks, failed = [], []
    for sym in tqdm(symbols, desc="Scanning"):
        time.sleep(DELAY)
        df = fetch_stock(sym)
        if df is None:
            failed.append(sym)
            continue
        m = compute_metrics(df, sym)
        if m:
            all_stocks.append(m)
        else:
            failed.append(sym)
    logger.info(f"Successful: {len(all_stocks)}, Failed: {len(failed)}")
    if not all_stocks:
        logger.error("No data, exiting")
        sys.exit(1)
    ranked = add_scores(all_stocks)
    bullish_cnt = sum(1 for s in ranked if s["is_bullish_aligned"])
    output = {
        "last_updated": datetime.now().isoformat(),
        "last_updated_readable": datetime.now().strftime("%Y-%m-%d %H:%M:%S IST"),
        "total_stocks_scanned": len(symbols),
        "successful_stocks": len(ranked),
        "bullish_count": bullish_cnt,
        "failed_count": len(failed),
        "scanner_duration_seconds": round((datetime.now() - start).total_seconds(), 1),
        "stocks": ranked
    }
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2)
    logger.info(f"Saved to {OUTPUT_FILE}")
    print(f"\n✅ Complete: {len(ranked)} stocks, bullish: {bullish_cnt}")

if __name__ == "__main__":
    main()
