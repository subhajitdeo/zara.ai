import requests
import sys

def get_nifty500_symbols():
    """Fetch the list of Nifty 500 stocks directly from the NSE API."""
    # This is the official NSE API endpoint for index constituents
    url = "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    try:
        # A session is needed to handle NSE's cookies
        session = requests.Session()
        session.headers.update(headers)
        
        # Initial request to set cookies
        session.get("https://www.nseindia.com", timeout=10)
        
        # Fetch the index data
        response = session.get(url, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        # Extract the list of stock symbols from the response
        stocks = [item['symbol'] for item in data['data']]
        
        # Save to file
        with open('nifty500.txt', 'w') as f:
            f.write("\n".join(stocks))
            
        print(f"✅ Success! Updated nifty500.txt with {len(stocks)} symbols.")
        return True
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Network error: {e}")
        return False
    except (KeyError, ValueError) as e:
        print(f"❌ Error parsing data: {e}")
        return False

if __name__ == "__main__":
    success = get_nifty500_symbols()
    if not success:
        sys.exit(1)
