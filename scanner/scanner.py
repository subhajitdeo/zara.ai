import pandas as pd
import yfinance as yf
import json
import time
from datetime import datetime

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

        # Skip if no data
        if data.empty:
            continue

        # Get close prices
        close = data["Close"].squeeze()

        # EMA calculations
        ema20 = float(close.ewm(span=20).mean().iloc[-1])
        ema50 = float(close.ewm(span=50).mean().iloc[-1])
        ema100 = float(close.ewm(span=100).mean().iloc[-1])
        ema200 = float(close.ewm(span=200).mean().iloc[-1])

        # Latest close
        latest_close = float(close.iloc[-1])

        # Bullish alignment
        bullish = (
            latest_close > ema20 > ema50 > ema100 > ema200
        )

        # Trend strength score
        strength = (
            ((latest_close - ema20) / ema20) * 100 +
            ((ema20 - ema50) / ema50) * 100 +
            ((ema50 - ema100) / ema100) * 100 +
            ((ema100 - ema200) / ema200) * 100
        )

        # Save stock result
        results.append({
            "symbol": symbol,
            "price": round(latest_close, 2),
            "ema20": round(ema20, 2),
            "ema50": round(ema50, 2),
            "ema100": round(ema100, 2),
            "ema200": round(ema200, 2),
            "bullish": bullish,
            "score": round(strength, 2)
        })

        # Prevent rate limiting
        time.sleep(0.3)

    except Exception as e:

        print(f"Failed: {symbol}")
        print(e)

# Sort strongest first
results = sorted(
    results,
    key=lambda x: x["score"],
    reverse=True
)

# Final JSON structure
final_data = {
    "last_updated": str(datetime.now()),
    "total_stocks": len(results),
    "data": results
}

# Save JSON
with open("data/results.json", "w") as f:
    json.dump(final_data, f, indent=4)

print("EMA scan completed successfully!")
