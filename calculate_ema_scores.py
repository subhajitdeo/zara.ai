import pandas as pd
import json
import os
from datetime import datetime

# Paths
DATA_FOLDER = "data/processed"
OUTPUT_FOLDER = "data/scores"

os.makedirs(OUTPUT_FOLDER, exist_ok=True)

def parse_yahoo_finance_data(data):
    """Parse Yahoo Finance JSON format into candles array"""
    candles = []
    
    try:
        # Yahoo Finance format: data['chart']['result'][0]
        result = data.get('chart', {}).get('result', [])
        if not result:
            return []
        
        chart_data = result[0]
        timestamps = chart_data.get('timestamp', [])
        quotes = chart_data.get('indicators', {}).get('quote', [{}])[0]
        
        for i in range(len(timestamps)):
            if i < len(quotes.get('open', [])):
                o = quotes['open'][i]
                h = quotes['high'][i]
                l = quotes['low'][i]
                c = quotes['close'][i]
                v = quotes['volume'][i]
                
                # Skip None values
                if None in (o, h, l, c, v):
                    continue
                    
                candles.append({
                    'time': pd.Timestamp(timestamps[i], unit='s').strftime('%Y-%m-%d'),
                    'open': float(o),
                    'high': float(h),
                    'low': float(l),
                    'close': float(c),
                    'volume': int(v)
                })
        
        return candles
    except Exception as e:
        print(f"  Parse error: {e}")
        return []

def calculate_ema_from_candles(candles):
    """Calculate EMAs from candle data"""
    if not candles or len(candles) < 200:
        return None, None, None, None
    
    # Extract closing prices
    closes = [c['close'] for c in candles]
    
    # Calculate EMAs using pandas
    close_series = pd.Series(closes)
    ema20 = float(close_series.ewm(span=20, adjust=False).mean().iloc[-1])
    ema50 = float(close_series.ewm(span=50, adjust=False).mean().iloc[-1])
    ema100 = float(close_series.ewm(span=100, adjust=False).mean().iloc[-1])
    ema200 = float(close_series.ewm(span=200, adjust=False).mean().iloc[-1])
    
    return ema20, ema50, ema100, ema200

def calculate_score(latest_close, ema20, ema50, ema100, ema200):
    """Calculate symmetry score based on EMA alignment"""
    if latest_close > ema20 > ema50 > ema100 > ema200:
        gaps = [
            latest_close - ema20,
            ema20 - ema50,
            ema50 - ema100,
            ema100 - ema200
        ]
        mean_gap = sum(gaps) / len(gaps)
        
        if mean_gap > 0:
            deviations = [abs(g - mean_gap) for g in gaps]
            max_deviation = max(deviations)
            symmetry_score = max(0, 100 * (1 - (max_deviation / mean_gap)))
        else:
            symmetry_score = 0
    else:
        symmetry_score = 0
    
    return round(symmetry_score, 2)

def process_all_stocks():
    """Process all .NS.json files in data/processed folder"""
    
    if not os.path.exists(DATA_FOLDER):
        print(f"❌ Data folder not found: {DATA_FOLDER}")
        return
    
    # Get all .NS.json files
    json_files = [f for f in os.listdir(DATA_FOLDER) if f.endswith('.NS.json')]
    print(f"📊 Found {len(json_files)} stock files to process")
    
    results = []
    
    for json_file in json_files:
        # Extract symbol (remove .NS.json)
        symbol = json_file.replace('.NS.json', '')
        
        try:
            file_path = os.path.join(DATA_FOLDER, json_file)
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            # Parse Yahoo Finance format
            candles = parse_yahoo_finance_data(data)
            
            if not candles or len(candles) < 200:
                print(f"⚠️ {symbol}: Only {len(candles)} candles (need 200), skipping")
                continue
            
            # Get latest data
            latest_candle = candles[-1]
            latest_close = latest_candle['close']
            
            # Calculate change from previous day
            if len(candles) >= 2:
                prev_close = candles[-2]['close']
                change_pct = ((latest_close - prev_close) / prev_close) * 100
            else:
                change_pct = 0
            
            latest_high = latest_candle['high']
            latest_low = latest_candle['low']
            
            # Calculate EMAs from candles
            ema20, ema50, ema100, ema200 = calculate_ema_from_candles(candles)
            
            if None in (ema20, ema50, ema100, ema200):
                print(f"⚠️ {symbol}: Could not calculate EMAs, skipping")
                continue
            
            # Calculate score
            score = calculate_score(latest_close, ema20, ema50, ema100, ema200)
            
            # Store results
            stock_data = {
                "symbol": symbol,
                "price": round(latest_close, 2),
                "change": round(change_pct, 2),
                "low": round(latest_low, 2),
                "high": round(latest_high, 2),
                "ema20": round(ema20, 2),
                "ema50": round(ema50, 2),
                "ema100": round(ema100, 2),
                "ema200": round(ema200, 2),
                "score": score,
                "alignment": "Perfect" if latest_close > ema20 > ema50 > ema100 > ema200 else "Partial",
                "trend": "BULLISH" if latest_close > ema200 else "BEARISH"
            }
            
            results.append(stock_data)
            print(f"✅ {symbol}: Score={score}, Price={latest_close}, Trend={stock_data['trend']}")
            
        except Exception as e:
            print(f"❌ {symbol}: Error - {e}")
    
    # Sort by score (highest first)
    results.sort(key=lambda x: x["score"], reverse=True)
    
    # Calculate statistics
    if results:
        avg_score = sum(r["score"] for r in results) / len(results)
        bullish = sum(1 for r in results if r["trend"] == "BULLISH")
        perfect_alignment = sum(1 for r in results if r["alignment"] == "Perfect")
        highest_score_stock = results[0]['symbol'] if results else "N/A"
        highest_score = results[0]['score'] if results else 0
    else:
        avg_score = bullish = perfect_alignment = highest_score = 0
        highest_score_stock = "N/A"
    
    # Save combined results to JSON
    final_data = {
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_stocks_processed": len(results),
        "statistics": {
            "average_score": round(avg_score, 2),
            "bullish_stocks": bullish,
            "bearish_stocks": len(results) - bullish,
            "perfect_alignment": perfect_alignment,
            "highest_score": highest_score,
            "highest_score_stock": highest_score_stock
        },
        "top_10_scores": results[:10],
        "all_stocks": results
    }
    
    # Save to files
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    
    # Save combined results
    combined_file = os.path.join(OUTPUT_FOLDER, "all_results.json")
    with open(combined_file, 'w') as f:
        json.dump(final_data, f, indent=2)
    
    # Save to root data folder
    root_result_file = "data/results.json"
    with open(root_result_file, 'w') as f:
        json.dump(final_data, f, indent=2)
    
    # Save sorted results as CSV for easy viewing
    df = pd.DataFrame(results)
    df.to_csv("data/ema_scores.csv", index=False)
    
    print(f"\n{'='*60}")
    print(f"✅ EMA CALCULATION COMPLETE!")
    print(f"   Total stocks processed: {len(results)}")
    print(f"   Average score: {round(avg_score, 2)}")
    print(f"   Bullish stocks: {bullish}")
    print(f"   Bearish stocks: {len(results) - bullish}")
    print(f"   Perfect EMA alignment: {perfect_alignment}")
    if results:
        print(f"   Top stock: {results[0]['symbol']} (Score: {results[0]['score']})")
    print(f"\n📁 Results saved to:")
    print(f"   - {OUTPUT_FOLDER}/all_results.json")
    print(f"   - data/results.json")
    print(f"   - data/ema_scores.csv")
    print(f"{'='*60}")

if __name__ == "__main__":
    process_all_stocks()
