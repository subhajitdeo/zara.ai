import pandas as pd
import json
import os
from datetime import datetime

def calculate_ema_from_processed():
    """Read processed JSON files and calculate EMA scores"""
    
    processed_dir = "data/processed"
    results = []
    
    # Get all JSON files from processed folder
    if not os.path.exists(processed_dir):
        print(f"❌ Processed directory not found: {processed_dir}")
        return
    
    json_files = [f for f in os.listdir(processed_dir) if f.endswith('.json')]
    print(f"📊 Found {len(json_files)} processed JSON files")
    
    for json_file in json_files:
        symbol = json_file.replace('.json', '')
        
        try:
            with open(os.path.join(processed_dir, json_file), 'r') as f:
                data = json.load(f)
            
            # Extract EMAs from indicators (already calculated)
            indicators = data.get('indicators', {})
            latest_price = data.get('latest_price', 0)
            
            ema20 = indicators.get('EMA20', {}).get('value', 0)
            ema50 = indicators.get('EMA50', {}).get('value', 0)
            ema100 = indicators.get('EMA100', {}).get('value', 0)
            ema200 = indicators.get('EMA200', {}).get('value', 0)
            
            # Skip if any EMA is 0
            if ema20 == 0 or ema50 == 0 or ema100 == 0 or ema200 == 0:
                print(f"⚠️ {symbol}: Missing EMA values")
                continue
            
            # Calculate symmetry score
            if latest_price > ema20 > ema50 > ema100 > ema200:
                gaps = [
                    latest_price - ema20,
                    ema20 - ema50,
                    ema50 - ema100,
                    ema100 - ema200
                ]
                mean_gap = sum(gaps) / len(gaps)
                if mean_gap > 0:
                    deviations = [abs(g - mean_gap) for g in gaps]
                    max_deviation = max(deviations)
                    score = max(0, 100 * (1 - (max_deviation / mean_gap)))
                else:
                    score = 0
            else:
                score = 0
            
            results.append({
                "symbol": symbol,
                "price": round(latest_price, 2),
                "ema20": round(ema20, 2),
                "ema50": round(ema50, 2),
                "ema100": round(ema100, 2),
                "ema200": round(ema200, 2),
                "score": round(score, 2),
                "alignment": "Perfect" if latest_price > ema20 > ema50 > ema100 > ema200 else "Broken",
                "trend": "BULLISH" if latest_price > ema200 else "BEARISH"
            })
            
            print(f"✅ {symbol}: Score={round(score, 2)}, Price={latest_price}")
            
        except Exception as e:
            print(f"❌ {symbol}: Error - {e}")
    
    # Sort by score (highest first)
    results.sort(key=lambda x: x["score"], reverse=True)
    
    # Calculate statistics
    if results:
        avg_score = sum(r["score"] for r in results) / len(results)
        bullish = sum(1 for r in results if r["trend"] == "BULLISH")
        perfect = sum(1 for r in results if r["alignment"] == "Perfect")
    else:
        avg_score = bullish = perfect = 0
    
    # Save results
    output = {
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_stocks": len(results),
        "statistics": {
            "average_score": round(avg_score, 2),
            "bullish_stocks": bullish,
            "bearish_stocks": len(results) - bullish,
            "perfect_alignment": perfect
        },
        "top_10": results[:10],
        "all_stocks": results
    }
    
    os.makedirs("data", exist_ok=True)
    with open("data/results.json", "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\n{'='*50}")
    print(f"✅ EMA CALCULATION COMPLETE")
    print(f"   Stocks processed: {len(results)}")
    print(f"   Average score: {round(avg_score, 2)}")
    print(f"   Bullish: {bullish}, Bearish: {len(results)-bullish}")
    print(f"   Perfect alignment: {perfect}")
    print(f"📁 Results saved to: data/results.json")
    print(f"{'='*50}")

if __name__ == "__main__":
    calculate_ema_from_processed()
