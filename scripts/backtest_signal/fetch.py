import yfinance as yf, pandas as pd, time, sys
U = """AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO ORCL CRM ADBE AMD INTC QCOM TXN MU AMAT LRCX KLAC ASML TSM NFLX NOW SNOW PLTR
SHOP UBER ABNB PYPL SQ COIN MSTR ROKU ZM DOCU TWLO NET CRWD DDOG MDB OKTA PANW FTNT ZS SMCI ARM DELL HPQ IBM CSCO
BABA JD PDD BIDU NIO XPEV LI SE MELI NBIS IONQ RGTI SOFI HOOD AFRM UPST RIVN LCID CHWY ETSY EBAY WBD PARA DIS CMCSA T VZ
JPM BAC WFC C GS MS SCHW AXP V MA BRK-B BLK KRE
XOM CVX OXY COP SLB HAL DVN FANG MPC
JNJ PFE MRK ABBV LLY UNH CVS WBA MRNA BIIB GILD AMGN BMY
WMT COST TGT HD LOW NKE SBUX MCD KO PEP PG CL KHC
BA CAT DE GE HON LMT RTX UPS FDX F GM
SPY QQQ IWM DIA XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT
MRVL ADI NXPI ON MCHP INTU ADSK WDAY ANET SPOT PINS COF USB PNC SPGI ICE CME BX TMO ABT DHR ISRG VRTX REGN MDT SYK
BKNG CMG LULU ROST TJX MO UNP NOC GD ETN DAL CCL EOG PSX VLO FCX NEM LIN NEE DUK AMT XLU XBI EEM EFA GDX
^GSPC ^RUT ^N225 ^FTSE ^GDAXI ^FCHI ^HSI ^AXJO ^GSPTSE ^BVSP ^KS11 ^TWII DD NUE IP APD SHW ECL VMC O SPG PLD PSA WELL AIG
ALL TRV CB PGR GIS HSY KMB SYY ADM CPB KR MMM EMR ITW CSX NSC PH DOV WM SO D AEP ED EXC XEL BAX BDX CI HUM DBC USO UNG IEF
LQD HYG EWJ EWZ FXI EWG VNQ""".split()
# 2026-11-14 round 3: the last two lines (52 names) took the backtest from 148 to 200 symbols. Add more each week:
# append a line here, re-run fetch.py + feats.py, then swing3.py / swing3b.py / signal3.py (new names are reported
# apart as a hold-out). SQ, ROKU, WBD, WBA in the first block no longer download from Yahoo.
# 2026-11-14 round 4: the last three lines (65 names: 12 indexes back to 1927, older stocks in materials, REITs,
# insurance, staples, transports, utilities, health; bond / commodity / country ETFs) → 265 symbols. Then feats4.py
# (back to 1963, modeled VIX before 1991) and round4.py. MMC and K no longer download.
out={}
for i in range(0,len(U),25):
    b=U[i:i+25]
    df=yf.download(b, period="max", interval="1d", auto_adjust=True, group_by="ticker", progress=False, threads=True)
    for s in b:
        try:
            d=df[s].dropna(subset=["Close"])
            if len(d)>300: out[s]=d[["Open","High","Low","Close","Volume"]]
        except Exception as e: print("miss",s,e)
    print(i, len(out), flush=True)
pd.concat(out, names=["sym","date"]).to_pickle("prices.pkl")
v=yf.download("^VIX", period="max", progress=False, auto_adjust=True)["Close"]; v.to_pickle("vix.pkl")
print("done", len(out), len(U))
