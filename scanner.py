"""
NSE Nifty 500 Trend Strength Scanner
Uses nsepython (direct NSE India API) – no API key, works in GitHub Actions.
"""

import json
import time
import logging
import sys
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import pandas as pd
from tqdm import tqdm

# ==================== CONFIGURATION ====================
SYMBOLS_FILE = "nifty500.txt"
OUTPUT_FILE = "data/results.json"
YEARS_OF_DATA = 3
REQUEST_DELAY = 0.5       # seconds between stocks (avoid rate limits)

# Scoring weights for the trend strength score
WEIGHTS = {
    "ema_separation": 0.20,      # EMA20 to EMA200 spread
    "price_distance": 0.25,      # Distance from EMA20
    "daily_gain": 0.20,          # Today's change percent
    "relative_volume": 0.15,     # Volume vs 20-day average
    "momentum": 0.20              # 5-day price momentum
}

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


def load_symbols(file_path: str) -> List[str]:
    """Load NSE symbols from text file (one per line)."""
    try:
        with open(file_path, 'r') as f:
            symbols = [line.strip().upper() for line in f if line.strip()]
        logger.info(f"Loaded {len(symbols)} symbols from {file_path}")
        return symbols
    except FileNotFoundError:
        logger.error(f"Symbol file {file_path} not found!")
        return []


def fetch_stock_data(symbol: str, years: int = 3) -> Optional[pd.DataFrame]:
    """
    Fetch daily OHLCV data using nsepython.
    Directly calls NSE India's historical data API.
    """
    try:
        from nsepython import nse_eq_history
        
        # Date range: last 3 years + a buffer for holidays
        end_date = datetime.now()
        start_date = end_date - timedelta(days=years*365 + 30)
        
        from_date_str = start_date.strftime("%d-%m-%Y")
        to_date_str = end_date.strftime("%d-%m-%Y")
        
        # Fetch data from NSE
        data = nse_eq_history(symbol, from_date_str, to_date_str, series="EQ")
        
        if not data or len(data) == 0:
            logger.warning(f"{symbol}: No data returned from NSE")
            return None
        
        # Convert to DataFrame
        df = pd.DataFrame.from_dict(data, orient='index')
        df.index = pd.to_datetime(df.index)
        df.sort_index(inplace=True)
        
        # Rename columns to standard names
        df = df.rename(columns={
            'OPEN': 'Open',
            'HIGH': 'High',
            'LOW': 'Low',
            'CLOSE': 'Close',
            'VOLUME': 'Volume'
        })
        
        # Keep only OHLCV columns
        df = df[['Open', 'High', 'Low', 'Close', 'Volume']].copy()
        
        # Convert to numeric values
        for col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Drop rows with missing data
        df.dropna(subset=['Close'], inplace=True)
        
        # Need at least 200 trading days for EMA200 calculation
        if len(df) < 200:
            logger.warning(f"{symbol}: Only {len(df)} days, need 200+")
            return None
        
        return df
        
    except Exception as e:
        logger.warning(f"{symbol}: nsepython error - {str(e)[:100]}")
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
        
        # Ensure all required EMAs are present
        required_cols = ['EMA20', 'EMA50', 'EMA100', 'EMA200']
        if any(pd.isna(latest[col]) for col in required_cols):
            logger.debug(f"{symbol}: Missing EMA values")
            return None
        
        # Daily gain percent
        prev_close = df['Close'].iloc[-2] if len(df) > 1 else latest['Close']
        daily_gain_pct = ((latest['Close'] - prev_close) / prev_close) * 100
        
        # Relative volume (20-day average vs today)
        vol_series = df['Volume'].iloc[-21:-1]
        avg_volume_20 = vol_series.mean() if len(vol_series) >= 10 else latest['Volume']
        rel_volume = latest['Volume'] / avg_volume_20 if avg_volume_20 > 0 else 1.0
        
        # EMA separation as percent of EMA200
        ema_sep_pct = ((latest['EMA20'] - latest['EMA200']) / latest['EMA200']) * 100
        
        # Price distance from EMA20 as percent
        price_dist_pct = ((latest['Close'] - latest['EMA20']) / latest['EMA20']) * 100
        
        # 5-day momentum
        if len(df) >= 6:
            close_5d_ago = df['Close'].iloc[-6]
            momentum_pct = ((latest['Close'] - close_5d_ago) / close_5d_ago) * 100
        else:
            momentum_pct = daily_gain_pct
        
        # Bullish alignment: Price > EMA20 > EMA50 > EMA100 > EMA200
        is_bullish = (
            latest['Close'] > latest['EMA20'] > latest['EMA50'] > latest['EMA100'] > latest['EMA200']
        )
        
        # Safely convert volume to integer
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
        logger.error(f"{symbol}: compute_metrics error - {str(e)}")
        return None


def normalize_metric(values: List[float]) -> List[float]:
    """Normalize metrics to 0-1 scale while clipping outliers."""
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
    """Add normalized trend strength score (0-100) to each stock."""
    if not stocks_data:
        return []
    
    # Collect all metrics for normalization
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
    
    # Normalize each metric
    normalized_metrics = {}
    for key, values in metrics.items():
        normalized_metrics[key] = normalize_metric(values)
    
    # Calculate weighted score for each stock
    for idx, stock in enumerate(stocks_data):
        score = 0.0
        for metric, weight in WEIGHTS.items():
            score += normalized_metrics[metric][idx] * weight
        
        stock["trend_score"] = round(score * 100, 1)
        
        # Classify trend status
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
    
    # Sort by trend score and assign ranks
    stocks_data.sort(key=lambda x: x["trend_score"], reverse=True)
    for rank, stock in enumerate(stocks_data, 1):
        stock["rank"] = rank
    
    return stocks_data


def run_scanner():
    """Main execution entry point."""
    start_time = datetime.now()
    logger.info("=== NSE Nifty 500 Trend Strength Scanner (nsepython) ===")
    
    # Load symbols from file
    symbols = load_symbols(SYMBOLS_FILE)
    if not symbols:
        logger.error("No symbols loaded. Exiting.")
        sys.exit(1)
    
    all_stocks = []
    failed_symbols = []
    
    # Process each symbol
    for symbol in tqdm(symbols, desc="Scanning Nifty 500"):
        time.sleep(REQUEST_DELAY)  # Rate limiting
        
        # Fetch and process stock data
        df = fetch_stock_data(symbol, years=YEARS_OF_DATA)
        if df is None:
            failed_symbols.append(symbol)
            continue
        
        metrics = compute_metrics(df, symbol)
        if metrics:
            all_stocks.append(metrics)
        else:
            failed_symbols.append(symbol)
    
    # Log summary
    logger.info(f"Successfully processed: {len(all_stocks)} stocks")
    logger.info(f"Failed: {len(failed_symbols)} stocks")
    
    if not all_stocks:
        logger.error("No valid stock data. Exiting.")
        sys.exit(1)
    
    # Calculate trend scores and rank
    ranked_stocks = calculate_trend_scores(all_stocks)
    bullish_count = sum(1 for s in ranked_stocks if s.get("is_bullish_aligned", False))
    
    # Prepare output JSON
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
    
    # Save to file
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2)
    
    logger.info(f"Results saved to {OUTPUT_FILE}")
    if ranked_stocks:
        logger.info(f"Top 5 stocks: {[s['symbol'] for s in ranked_stocks[:5]]}")
    
    # Print final summary
    print("\n" + "="*50)
    print("SCAN COMPLETE")
    print(f"Total scanned: {len(ranked_stocks)}")
    print(f"Bullish aligned: {bullish_count}")
    print(f"Avg trend score: {sum(s['trend_score'] for s in ranked_stocks)/len(ranked_stocks):.1f}")
    print("="*50)


if __name__ == "__main__":
    run_scanner()
