import sys
import json
import numpy as np

def calculate_sma(data, period):
    if len(data) < period:
        return [0] * len(data)
    return np.convolve(data, np.ones(period)/period, mode='valid').tolist()

def calculate_ema(data, period):
    if len(data) < period:
        return [0] * len(data)
    weights = np.exp(np.linspace(-1., 0., period))
    weights /= weights.sum()
    a = np.convolve(data, weights, mode='full')[:len(data)]
    a[:period] = a[period]
    return a.tolist()

def calculate_rsi(data, period=14):
    if len(data) < period + 1:
        return [50] * len(data)
    deltas = np.diff(data)
    seed = deltas[:period+1]
    up = seed[seed >= 0].sum()/period
    down = -seed[seed < 0].sum()/period
    if down == 0: rs = 100
    else: rs = up/down
    rsi = np.zeros_like(data)
    rsi[:period+1] = 100. - 100./(1.+rs)

    for i in range(period+1, len(data)):
        delta = deltas[i-1]
        if delta > 0:
            upval = delta
            downval = 0.
        else:
            upval = 0.
            downval = -delta

        up = (up*(period-1) + upval)/period
        down = (down*(period-1) + downval)/period
        if down == 0: rs = 100
        else: rs = up/down
        rsi[i] = 100. - 100./(1.+rs)
    return rsi.tolist()

def calculate_atr(high, low, close, period=14):
    if len(high) < 2:
        return 0
    tr = np.maximum(high[1:] - low[1:], 
                    np.maximum(np.abs(high[1:] - close[:-1]), 
                               np.abs(low[1:] - close[:-1])))
    return float(np.mean(tr[-period:]))

def main():
    try:
        input_data = json.loads(sys.stdin.read())
        candles = input_data['candles']
        
        close = np.array([c['close'] for c in candles])
        high = np.array([c['high'] for c in candles])
        low = np.array([c['low'] for c in candles])
        volume = np.array([c['volume'] for c in candles])
        
        n = len(close)
        if n < 50:
            print(json.dumps({"error": "Insufficient data"}))
            return

        sma20 = calculate_sma(close, 20)
        sma50 = calculate_sma(close, 50)
        rsi = calculate_rsi(close, 14)
        atr_val = calculate_atr(high, low, close, 14)
        vol_avg = float(np.mean(volume[-20:]))
        
        # MACD (12, 26, 9) - simplified
        ema12 = np.array(calculate_ema(close, 12))
        ema26 = np.array(calculate_ema(close, 26))
        macd_line = ema12 - ema26
        signal_line = np.array(calculate_ema(macd_line, 9))
        histogram = macd_line - signal_line
        
        # Bollinger
        std20 = np.std(close[-20:])
        upper_bb = sma20[-1] + (std20 * 2)
        lower_bb = sma20[-1] - (std20 * 2)
        
        indicators = {
            "rsi": rsi[-1],
            "sma20": sma20[-1],
            "sma50": sma50[-1],
            "macd": {
                "macd": float(macd_line[-1]),
                "signal": float(signal_line[-1]),
                "histogram": float(histogram[-1])
            },
            "bollinger": {
                "upper": float(upper_bb),
                "middle": float(sma20[-1]),
                "lower": float(lower_bb)
            },
            "atr": atr_val,
            "vol20Avg": vol_avg
        }
        
        print(json.dumps(indicators))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
