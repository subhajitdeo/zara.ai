"""
NSE Nifty 500 Trend Strength Scanner
Uses direct Yahoo Finance API (no yfinance library) - more reliable.
"""

import json
import time
import logging
import sys
import os
import requests
from datetime import datetime
from typing import Dict, List, Optional
import pandas as pd
from tqdm import tqdm

# ==================== CONFIGURATION ====================
SYMBOLS_FILE = "nifty500.txt"
OUTPUT_FILE = "data/results.json"
YEARS_OF_DATA = 3
REQUEST_DELAY = 0.5  # seconds between stocks
MAX_RETRIES = 3

# Scoring weights
WEIGHTS = {
    "ema_separation": 0.20,
    "price_distance": 0.25,
    "daily_gain": 0.20,
    "relative_volume": 0.15,
    "momentum": 0.20
}

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Headers to mimic a real browser
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
}


def load_symbols(file_path: str) -> List[str]:
    """Load NSE symbols from text file."""
    try:
        with open(file_path, 'r') as f:
            symbols = [line.strip().upper() for line in f if line.strip()]
        logger.info(f"Loaded {len(symbols)} symbols")
        return symbols
    except FileNotFoundError:
        logger.error(f"Symbol file {file_path} not found!")
        return []


def fetch_stock_data_direct(symbol: str, period: str = "3y") -> Optional[pd.DataFrame]:
    """
    Fetch daily OHLCV data using direct Yahoo Finance API (no yfinance).
    Uses .NS suffix for NSE stocks.
    """
    ticker = f"{symbol}.NS"
    # Calculate number of days for 3 years (approx 756 trading days, but we fetch more)
    # Yahoo finance uses intervals: 1d, 1wk, 1mo. We'll use 1d.
    # We need enough data for EMA200 (~200 days). Fetch 5 years to be safe.
    end_date = int(datetime.now().timestamp())
    start_date = int((datetime.now() - pd.Timedelta(days=5*365)).timestamp())
    
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    params = {
        'period1': start_date,
        'period2': end_date,
        'interval': '1d',
        'includePrePost': 'false',
        'events': 'div,splits'
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, headers=HEADERS, params=params, timeout=15)
            if response.status_code != 200:
                logger.warning(f"{symbol}: HTTP {response.status_code}")
                time.sleep(2)
                continue
            
            data = response.json()
            
            # Parse the response
            if 'chart' not in data or 'result' not in data['chart'] or not data['chart']['result']:
                logger.warning(f"{symbol}: No data in response")
                return None
            
            result = data['chart']['result'][0]
            timestamps = result['timestamp']
            quote = result['indicators']['quote'][0]
            
            # Extract columns
            opens = quote.get('open', [])
            highs = quote.get('high', [])
            lows = quote.get('low', [])
            closes = quote.get('close', [])
            volumes = quote.get('volume', [])
            
            # Build DataFrame
            df = pd.DataFrame({
                'Open': opens,
                'High': highs,
                'Low': lows,
                'Close': closes,
                'Volume': volumes
            })
            
            # Convert timestamp to datetime index
            df.index = pd.to_datetime(timestamps, unit='s')
            
            # Remove rows with NaN in Close (non-trading days)
            df = df.dropna(subset=['Close'])
            
            if df.empty or len(df) < 200:
                logger.warning(f"{symbol}: Only {len(df)} days, need 200+")
                return None
            
            # Sort by date
            df.sort_index(inplace=True)
            return df
            
        except Exception as e:
            logger.warning(f"{symbol} attempt {attempt+1} failed: {str(e)[:100]}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(3 * (attempt + 1))
    return None


def calculate_emas(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate EMAs 20, 50, 100, 200."""
    df = df.copy()
    df['EMA20'] = df['Close'].ewm(span=20, adjust=False).mean()
    df['EMA50'] = df['Close'].ewm(span=50, adjust=False).mean()
    df['EMA100'] = df['Close'].ewm(span=100, adjust=False).mean()
    df['EMA200'] = df['Close'].ewm(span=200, adjust=False).mean()
    return df


def compute_metrics(df: pd.DataFrame, symbol: str) -> Optional[Dict]:
    """Extract latest metrics and compute trend indicators."""
    try:
        if df is None or df.empty:
            return None
        
        df = calculate_emas(df)
        latest = df.iloc[-1]
        
        # Check for NaN in critical EMAs
        required_cols = ['EMA20', 'EMA50', 'EMA100', 'EMA200']
        if any(pd.isna(latest[col]) for col in required_cols):
            logger.debug(f"{symbol}: Missing EMA values")
            return None
        
        # Previous close for daily gain
        prev_close = df['Close'].iloc[-2] if len(df) > 1 else latest['Close']
        daily_gain_pct = ((latest['Close'] - prev_close) / prev_close) * 100
        
        # Relative volume (20-day average)
        vol_series = df['Volume'].iloc[-21:-1]
        avg_volume_20 = vol_series.mean() if len(vol_series) >= 10 else latest['Volume']
        rel_volume = latest['Volume'] / avg_volume_20 if avg_volume_20 > 0 else 1.0
        
        # EMA separation as % of EMA200
        ema_sep_pct = ((latest['EMA20'] - latest['EMA200']) / latest['EMA200']) * 100
        
        # Price distance from EMA20 (%)
        price_dist_pct = ((latest['Close'] - latest['EMA20']) / latest['EMA20']) * 100
        
        # Momentum (5-day change)
        if len(df) >= 6:
            close_5d_ago = df['Close'].iloc[-6]
            momentum_pct = ((latest['Close'] - close_5d_ago) / close_5d_ago) * 100
        else:
            momentum_pct = daily_gain_pct
        
        # Bullish alignment condition
        is_bullish = (
            latest['Close'] > latest['EMA20'] > latest['EMA50'] > latest['EMA100'] > latest['EMA200']
        )
        
        # Safely convert volume to int
        volume_int = int(latest['Volume']) if not pd.isna(latest['Volume']) else 0
        
        return {
            "symbol": symbol,
            "price": round(latest['Close'], 2),
            "ema20": round(latest['EMA20'], 2),
            "ema50": round(latest['EMA50'], 2),
            "ema100": round(latest['EMA100'], 2),
            "ema200": round(latest['EMA200'], 2),
            "daily_gain_pct": round(daily_gain_pct, 2),
            "volume": volume_int,
            "rel_volume": round(rel_volume, 2),
            "ema_sep_pct": round(ema_sep_pct, 2),
            "price_dist_pct": round(price_dist_pct, 2),
            "momentum_pct": round(momentum_pct, 2),
            "is_bullish_aligned": is_bullish
        }
    except Exception as e:
        logger.error(f"{symbol}: compute_metrics crashed - {str(e)}")
        return None


def normalize_metric(values: List[float]) -> List[float]:
    """Min-max normalization with outlier clipping."""
    if not values or len(values) < 2:
        return [0.5] * len(values)
    
    series = pd.Series(values)
    lower = series.quantile(0.05)
    upper = series.quantile(0.95)
    
    if upper <= lower:
        return [0.5] * len(values)
    
    normalized = [(v - lower) / (upper - lower) for v in values]
    return [max(0.0, min(1.0, n)) for n in normalized]


def calculate_trend_scores(stocks_data: List[Dict]) -> List[Dict]:
    """Add normalized trend strength score (0-100)."""
    if not stocks_data:
        return []
    
    metrics = {
        "ema_sep_pct": [],
        "price_dist_pct": [],
        "daily_gain_pct": [],
        "rel_volume": [],
        "momentum_pct": []
    }
    
    for stock in stocks_data:
        for key in metrics.keys():
            metrics[key].append(stock.get(key, 0))
    
    normalized_metrics = {}
    for key, values in metrics.items():
        normalized_metrics[key] = normalize_metric(values)
    
    for idx, stock in enumerate(stocks_data):
        score = 0.0
        for metric, weight in WEIGHTS.items():
            score += normalized_metrics[metric][idx] * weight
        
        stock["trend_score"] = round(score * 100, 1)
        
        # Status classification
        if stock.get("is_bullish_aligned", False) and stock["trend_score"] >= 60:
            stock["status"] = "Strong Bullish"
            stock["color"] = "green"
        elif stock.get("is_bullish_aligned", False):
            stock["status"] = "Bullish"
            stock["color"] = "green"
        elif stock["trend_score"] >= 50:
            stock["status"] = "Neutral"
            stock["color"] = "yellow"
        else:
            stock["status"] = "Weak"
            stock["color"] = "red"
    
    stocks_data.sort(key=lambda x: x["trend_score"], reverse=True)
    for rank, stock in enumerate(stocks_data, 1):
        stock["rank"] = rank
    
    return stocks_data


def run_scanner():
    """Main execution."""
    start_time = datetime.now()
    logger.info("Starting NSE Nifty 500 Trend Strength Scanner (Direct Yahoo API)")
    
    symbols = load_symbols(SYMBOLS_FILE)
    if not symbols:
        sys.exit(1)
    
    all_stocks_data = []
    failed_symbols = []
    
    for symbol in tqdm(symbols, desc="Scanning stocks"):
        time.sleep(REQUEST_DELAY)
        
        df = fetch_stock_data_direct(symbol, period=f"{YEARS_OF_DATA}y")
        if df is None:
            failed_symbols.append(symbol)
            continue
        
        metrics = compute_metrics(df, symbol)
        if metrics:
            all_stocks_data.append(metrics)
        else:
            failed_symbols.append(symbol)
    
    logger.info(f"Successfully processed: {len(all_stocks_data)} stocks")
    logger.info(f"Failed: {len(failed_symbols)} stocks")
    
    if not all_stocks_data:
        logger.error("No valid stock data. Exiting.")
        sys.exit(1)
    
    ranked_stocks = calculate_trend_scores(all_stocks_data)
    bullish_count = sum(1 for s in ranked_stocks if s.get("is_bullish_aligned", False))
    
    output = {
        "last_updated": datetime.now().isoformat(),
        "last_updated_readable": datetime.now().strftime("%Y-%m-%d %H:%M:%S IST"),
        "total_stocks_scanned": len(symbols),
        "successful_stocks": len(ranked_stocks),
        "bullish_count": bullish_count,
        "failed_count": len(failed_symbols),
        "scanner_duration_seconds": round((datetime.now() - start_time).total_seconds(), 1),
        "stocks": ranked_stocks
    }
    
    # Ensure data directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2)
    
    logger.info(f"Results saved to {OUTPUT_FILE}")
    if ranked_stocks:
        logger.info(f"Top 5: {[s['symbol'] for s in ranked_stocks[:5]]}")
    
    print("\n" + "="*50)
    print("SCAN COMPLETE")
    print(f"Total scanned: {len(ranked_stocks)}")
    print(f"Bullish aligned: {bullish_count}")
    if ranked_stocks:
        print(f"Avg trend score: {sum(s['trend_score'] for s in ranked_stocks)/len(ranked_stocks):.1f}")
    print("="*50)


if __name__ == "__main__":
    run_scanner()
