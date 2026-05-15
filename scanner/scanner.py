import pandas as pd
import yfinance as yf
import json
import time
import os
from datetime import datetime

# Ensure data directory exists
os.makedirs("data", exist_ok=True)

# Load stock list
stocks = pd.read_csv("scanner/nifty500.csv")

results = []

# Scan each stock
for symbol in stocks["SYMBOL"]:
    try:
        ticker = symbol + ".NS"
        print(f"Scanning {ticker}")

        # Download 3 years daily data
        data = yf.download(
            ticker,
            period="3y",
            interval="1d",
            progress=False,
            auto_adjust=True
        )

        if data.empty:
            print(f"No data for {symbol}")
            continue

        # Get close prices
        close = data["Close"].squeeze()

        # Need at least 2 days for change, 200 days for EMA200
        if len(close) < 200:
            print(f"Insufficient data for {symbol} (need 200 days)")
            continue

        # Latest close and previous close
        latest_close = float(close.iloc[-1])
        prev_close = float(close.iloc[-2]) if len(close) >= 2 else latest_close
        daily_change_pct = ((latest_close - prev_close) / prev_close) * 100

        # Latest low and high
        low = data["Low"].squeeze()
        high = data["High"].squeeze()
        latest_low = float(low.iloc[-1])
        latest_high = float(high.iloc[-1])

        # EMAs
        ema20 = float(close.ewm(span=20).mean().iloc[-1])
        ema50 = float(close.ewm(span=50).mean().iloc[-1])
        ema100 = float(close.ewm(span=100).mean().iloc[-1])
        ema200 = float(close.ewm(span=200).mean().iloc[-1])

        # Bullish alignment
        bullish = (latest_close > ema20 > ema50 > ema100 > ema200)

        # Trend strength score
        strength = (
            ((latest_close - ema20) / ema20) * 100 +
            ((ema20 - ema50) / ema50) * 100 +
            ((ema50 - ema100) / ema100) * 100 +
            ((ema100 - ema200) / ema200) * 100
        )

        results.append({
            "symbol": symbol,
            "price": round(latest_close, 2),
            "change": round(daily_change_pct, 2),
            "low": round(latest_low, 2),
            "high": round(latest_high, 2),
            "ema20": round(ema20, 2),
            "ema50": round(ema50, 2),
            "ema100": round(ema100, 2),
            "ema200": round(ema200, 2),
            "bullish": bullish,
            "score": round(strength, 2)
        })

        time.sleep(0.7)  # Rate limiting

    except Exception as e:
        print(f"Failed: {symbol} - {e}")

# Sort strongest first
results.sort(key=lambda x: x["score"], reverse=True)

# Final JSON
final_data = {
    "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "total_stocks": len(results),
    "data": results
}

# Save JSON
with open("data/results.json", "w") as f:
    json.dump(final_data, f, indent=4)

print(f"EMA scan completed! {len(results)} stocks saved.")
