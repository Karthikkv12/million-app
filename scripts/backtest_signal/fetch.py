import yfinance as yf, pandas as pd, time, sys
U = """AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO ORCL CRM ADBE AMD INTC QCOM TXN MU AMAT LRCX KLAC ASML TSM NFLX NOW SNOW PLTR
SHOP UBER ABNB PYPL SQ COIN MSTR ROKU ZM DOCU TWLO NET CRWD DDOG MDB OKTA PANW FTNT ZS SMCI ARM DELL HPQ IBM CSCO
BABA JD PDD BIDU NIO XPEV LI SE MELI NBIS IONQ RGTI SOFI HOOD AFRM UPST RIVN LCID CHWY ETSY EBAY WBD PARA DIS CMCSA T VZ
JPM BAC WFC C GS MS SCHW AXP V MA BRK-B BLK KRE
XOM CVX OXY COP SLB HAL DVN FANG MPC
JNJ PFE MRK ABBV LLY UNH CVS WBA MRNA BIIB GILD AMGN BMY
WMT COST TGT HD LOW NKE SBUX MCD KO PEP PG CL KHC
BA CAT DE GE HON LMT RTX UPS FDX F GM
SPY QQQ IWM DIA XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT""".split()
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
