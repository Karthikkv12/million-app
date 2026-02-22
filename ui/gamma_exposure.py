from __future__ import annotations
import math, warnings
import plotly.graph_objects as go
import streamlit as st
from logic.gamma import compute_gamma_exposure

# ──────────────────────────────────────────────
#  Formatters & colour helpers
# ──────────────────────────────────────────────

def _fmt_cell(v: float) -> str:
    a = abs(v)
    s = "-" if v < 0 else ""
    if a >= 1_000_000_000: return f"{s}${a/1e9:.1f}B"
    if a >= 1_000_000:     return f"{s}${a/1e6:.1f}M"
    if a >= 1_000:         return f"{s}${a/1e3:.1f}K"
    if a == 0:             return "$0"
    return f"{s}${a:.0f}"


def _fmt_gex(v: float) -> str:
    a = abs(v)
    s = "-" if v < 0 else "+"
    if a >= 1e9: return f"{s}${a/1e9:.2f}B"
    if a >= 1e6: return f"{s}${a/1e6:.2f}M"
    if a >= 1e3: return f"{s}${a/1e3:.1f}K"
    return f"{s}${a:.0f}"


def _heat_bg(v: float, vmax: float) -> str:
    """Return an RGB colour string: green = strong positive GEX (long), red = strong negative (short)."""
    if vmax == 0 or (isinstance(v, float) and math.isnan(v)):
        return "transparent"
    ratio = max(-1.0, min(1.0, v / vmax))
    if ratio >= 0:
        # light green → bright green
        t = ratio
        if t < 0.25:
            f = t / 0.25; r, g, b = int(220 - f*60), int(240 - f*30), int(220 - f*60)
        elif t < 0.5:
            f = (t - 0.25) / 0.25; r, g, b = int(160 - f*80), int(210 - f*30), int(160 - f*80)
        elif t < 0.75:
            f = (t - 0.5) / 0.25; r, g, b = int(80 - f*60), int(180 + f*40), int(80 - f*60)
        else:
            f = (t - 0.75) / 0.25; r, g, b = int(20 + f*30), int(220 + f*15), int(20 + f*20)
    else:
        # light red → bright red
        t = -ratio
        if t < 0.25:
            f = t / 0.25; r, g, b = int(240 - f*30), int(220 - f*60), int(220 - f*60)
        elif t < 0.5:
            f = (t - 0.25) / 0.25; r, g, b = int(210 - f*30), int(160 - f*80), int(160 - f*80)
        elif t < 0.75:
            f = (t - 0.5) / 0.25; r, g, b = int(180 + f*40), int(80 - f*60), int(80 - f*60)
        else:
            f = (t - 0.75) / 0.25; r, g, b = int(220 + f*15), int(20 + f*30), int(20 + f*20)
    return f"rgb({r},{g},{b})"


def _fg(bg: str) -> str:
    """Return black or white text depending on background luminance."""
    if bg == "transparent":
        return "inherit"
    try:
        r, g, b = [int(x) for x in bg[4:-1].split(",")]
        return "#111111" if (0.299 * r + 0.587 * g + 0.114 * b) >= 100 else "#ffffff"
    except Exception:
        return "#111111"


# ──────────────────────────────────────────────
#  Cached data fetcher
# ──────────────────────────────────────────────

@st.cache_data(ttl=300, show_spinner=False)
def _cached_gex(symbol: str) -> dict:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        r = compute_gamma_exposure(symbol.upper())
    return {
        "symbol": r.symbol,
        "spot": r.spot,
        "expiries": r.expiries,
        "strikes": r.strikes,
        "gex_by_strike": r.gex_by_strike,
        "call_gex_by_strike": r.call_gex_by_strike,
        "put_gex_by_strike": r.put_gex_by_strike,
        "heatmap_expiries": r.heatmap_expiries,
        "heatmap_strikes": r.heatmap_strikes,
        "heatmap_values": r.heatmap_values,
        "zero_gamma": r.zero_gamma,
        "max_call_wall": r.max_call_wall,
        "max_put_wall": r.max_put_wall,
        "max_gex_strike": r.max_gex_strike,
        "net_gex": r.net_gex,
        "error": r.error,
        "lot_size": r.lot_size,
        # per-expiry heatmap slices
        "heatmap_expiries": r.heatmap_expiries,
        "heatmap_strikes": r.heatmap_strikes,
        "heatmap_values": r.heatmap_values,
    }


@st.cache_data(ttl=120, show_spinner=False)
def _search_suggestions(query: str, max_results: int = 6) -> list[dict]:
    """Use yfinance Search to find matching symbols for a query string."""
    try:
        import yfinance as yf
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            results = yf.Search(query, max_results=max_results)
        out = []
        for q in (results.quotes or [])[:max_results]:
            sym  = q.get("symbol", "")
            name = q.get("longname") or q.get("shortname") or sym
            exch = q.get("exchDisp", "")
            qt   = q.get("quoteType", "")
            if sym:
                out.append({"symbol": sym, "name": name, "exchange": exch, "type": qt})
        return out
    except Exception:
        return []


@st.cache_data(ttl=60, show_spinner=False)
def _fetch_price_info(symbol: str) -> dict:
    """Fetch live price info: spot, prev_close, open, high, low, volume, year_change."""
    try:
        import yfinance as yf
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fi = yf.Ticker(symbol.upper()).fast_info
        last   = float(fi.last_price   or 0)
        prev   = float(fi.previous_close or last)
        hi     = float(fi.day_high     or 0)
        lo     = float(fi.day_low      or 0)
        vol    = int(fi.last_volume    or 0)
        chg    = last - prev
        chg_pct = (chg / prev * 100) if prev else 0.0
        return {
            "last": last, "prev_close": prev,
            "day_high": hi, "day_low": lo,
            "volume": vol, "change": chg, "change_pct": chg_pct,
        }
    except Exception:
        return {"last": 0, "prev_close": 0, "day_high": 0, "day_low": 0,
                "volume": 0, "change": 0, "change_pct": 0}


# ──────────────────────────────────────────────
#  Strike tables — two modes
# ──────────────────────────────────────────────
# Mode A: single ticker  → STRIKE | exp1 | exp2 | …   (rows = strikes, cols = expiries)
# Mode B: multi-ticker   → [STRIKE|GEX] [STRIKE|GEX] … (panels side-by-side, one expiry)
# ──────────────────────────────────────────────

def _single_ticker_table_html(d: dict, n_strikes: int = 20, expiry_filter: list | None = None) -> str:
    """
    Mode A — one ticker, multiple expiries as columns.
    Rows = n_strikes centred on spot (n_strikes//2 above, n_strikes//2 below).
    Cols = STRIKE | expiry-1 | expiry-2 | …
    Gold ► row = nearest spot strike.
    ★ = king node per expiry column.
    % badge when |GEX| >= 10% of that column's max.
    """
    import datetime as _dt

    if d.get("error") or not d.get("spot"):
        return f"<p style='color:#f88'>Error: {d.get('error','no data')}</p>"

    sym  = d["symbol"]
    spot = d["spot"]
    hm_exp = d.get("heatmap_expiries", [])
    hm_str = d.get("heatmap_strikes", [])
    hm_val = d.get("heatmap_values", [])

    # filter expiries
    exp_cols: list[tuple] = []   # (label, short_label, gex_map, vmax, king_strike)
    for ei, exp in enumerate(hm_exp):
        if expiry_filter and exp not in expiry_filter:
            continue
        vals = hm_val[ei] if ei < len(hm_val) else []
        gex_map = {s: v for s, v in zip(hm_str, vals)}
        vmax = max((abs(v) for v in gex_map.values()), default=1) or 1
        king = max(gex_map, key=lambda s: abs(gex_map[s])) if gex_map else None
        try:
            short = _dt.date.fromisoformat(exp).strftime("%b %d")
        except Exception:
            short = exp[-5:] if len(exp) >= 5 else exp
        exp_cols.append((exp, short, gex_map, vmax, king))

    if not exp_cols:
        return "<p style='color:var(--gex-text3)'>No expiry data for selected filter.</p>"

    # union of strikes ±20% of spot across all selected expiries
    lo, hi = spot * 0.80, spot * 1.20
    all_s: set = set()
    for _, _, gm, _, _ in exp_cols:
        all_s.update(s for s in gm if lo <= s <= hi)
    all_sorted = sorted(all_s)          # ascending
    if not all_sorted:
        return "<p style='color:var(--gex-text3)'>No strikes in ±20% range.</p>"
    # Centre on spot: find nearest strike, take n//2 above and n//2 below
    half = max(1, n_strikes // 2)
    spot_idx = min(range(len(all_sorted)), key=lambda i: abs(all_sorted[i] - spot))
    lo_idx = max(0, spot_idx - half)
    hi_idx = min(len(all_sorted), spot_idx + half)
    # expand if we hit an edge
    if hi_idx - lo_idx < n_strikes:
        if lo_idx == 0:
            hi_idx = min(len(all_sorted), n_strikes)
        else:
            lo_idx = max(0, hi_idx - n_strikes)
    sorted_strikes = sorted(all_sorted[lo_idx:hi_idx], reverse=True)

    nearest_spot = min(sorted_strikes, key=lambda s: abs(s - spot))

    # price info
    pi   = _fetch_price_info(sym)
    lp   = pi["last"] or spot
    chg  = pi["change"]; chg_p = pi["change_pct"]
    chg_c = "#00cc44" if chg >= 0 else "#ff4444"
    arr   = "+" if chg >= 0 else ""
    net   = d.get("net_gex", 0) or 0
    net_c = "#00cc44" if net >= 0 else "#ff4444"
    zg    = d.get("zero_gamma")
    zg_s  = f"${zg:.2f}" if zg else "—"
    lot   = d.get("lot_size", 100)
    lot_badge = (
        f"&nbsp;&nbsp;<span style='font-size:9px;background:var(--gex-bg2);color:var(--gex-text3);"
        f"border:1px solid var(--gex-border2);border-radius:3px;padding:1px 5px'>lot×{lot}</span>"
        if lot != 100 else ""
    )

    # ── header ────────────────────────────────────────────────────────────
    TH = ("background:var(--gex-bg2);padding:4px 10px;font-size:10px;font-weight:700;"
          "position:sticky;top:0;z-index:3;border-bottom:1px solid var(--gex-border2);white-space:nowrap")

    ncols = 1 + len(exp_cols)
    regime_label = "Long \u03b3" if net >= 0 else "Short \u03b3"
    regime_color = "#00cc44" if net >= 0 else "#ff4444"

    LBL_S = "font-size:10px;font-weight:600;color:var(--gex-text3);margin-right:4px"
    VAL_S = "font-size:13px;font-weight:800;"

    rowA = (
        f"<tr><th colspan='{ncols}' style='{TH};text-align:left;"
        f"padding:8px 12px;border-bottom:2px solid var(--gex-border2)'>"
        f"<span style='font-size:17px;font-weight:900;color:var(--gex-text);"
        f"letter-spacing:0.5px;margin-right:8px'>{sym}</span>"
        f"<span style='font-size:15px;font-weight:700;color:var(--gex-text);"
        f"margin-right:14px'>${lp:.2f}</span>"
        f"<span style='{VAL_S};color:{chg_c};"
        f"margin-right:18px'>{arr}{chg:.2f}&nbsp;({arr}{chg_p:.2f}%)</span>"
        f"<span style='color:var(--gex-border2);margin-right:18px;font-size:13px'>|</span>"
        f"<span style='{LBL_S}'>Net GEX</span>"
        f"<span style='{VAL_S};color:{net_c};"
        f"margin-right:18px'>{_fmt_gex(net)}</span>"
        f"<span style='{LBL_S}'>Regime</span>"
        f"<span style='{VAL_S};color:{regime_color};"
        f"margin-right:18px'>{regime_label}</span>"
        f"<span style='{LBL_S}'>Zero \u03b3</span>"
        f"<span style='{VAL_S};color:var(--gex-text2);"
        f"margin-right:14px'>{zg_s}</span>"
        + (f"<span style='font-size:9px;background:var(--gex-bg);color:var(--gex-text3);"
           f"border:1px solid var(--gex-border2);border-radius:3px;padding:1px 5px'>"
           f"lot\u00d7{lot}</span>" if lot != 100 else "")
        + "</th></tr>"
    )

    rowB_cells = f"<th style='{TH};color:var(--gex-text3);text-align:left;min-width:90px'>STRIKE</th>"
    for (exp, short, _, _, king) in exp_cols:
        king_badge = (" <span style='background:#cc8800;color:#fff;font-size:7px;font-weight:800;"
                      "border-radius:2px;padding:0 3px'>&#9733;</span>") if king in sorted_strikes else ""
        rowB_cells += (f"<th style='{TH};color:var(--gex-text2);text-align:right;"
                       f"min-width:100px;border-left:1px solid var(--gex-border)'>"
                       f"{short}{king_badge}</th>")
    rowB = f"<tr>{rowB_cells}</tr>"

    thead = f"<thead>{rowA}{rowB}</thead>"

    # ── body ──────────────────────────────────────────────────────────────
    BASE_TD = "padding:1px 8px;font-size:11px;font-weight:600;font-family:'Courier New',monospace;border-bottom:1px solid var(--gex-border)"
    rows_html = ""
    for strike in sorted_strikes:
        is_spot = (strike == nearest_spot)
        sk_bg   = "var(--gex-spot-bg)" if is_spot else "var(--gex-bg)"
        sk_col  = "#111" if is_spot else "var(--gex-text2)"
        sk_wt   = "font-weight:800" if is_spot else ""
        sk_bdr  = "border-top:2px solid #FFB800;border-bottom:2px solid #FFB800;border-left:4px solid #FFB800" if is_spot else ""
        spot_badge = (
            f"<span style='background:#FFB800;color:#111;font-size:8px;font-weight:800;"
            f"border-radius:3px;padding:1px 5px;margin-right:4px;vertical-align:middle'>"
            f"&#9658; SPOT ${lp:.2f}</span>"
        ) if is_spot else ""

        cells = (
            f"<td style='background:{sk_bg};color:{sk_col};{sk_wt};"
            f"{BASE_TD};text-align:left;{sk_bdr}'>{spot_badge}{strike:.1f}</td>"
        )
        for (_, _, gex_map, vmax, king) in exp_cols:
            v = gex_map.get(strike, float("nan"))
            if isinstance(v, float) and math.isnan(v):
                cells += f"<td style='background:var(--gex-bg);color:var(--gex-border2);{BASE_TD};text-align:right;border-left:1px solid var(--gex-border)'>—</td>"
                continue
            cell_bg = _heat_bg(v, vmax)
            fg      = _fg(cell_bg)
            badge   = ""
            if vmax > 0 and abs(v) >= 0.10 * vmax:
                pct = int(round(v / vmax * 100))
                bc  = "#00cc44" if pct > 0 else "#ff4444"
                badge = f"<span style='background:{bc};color:#000;font-size:7px;font-weight:700;border-radius:3px;padding:0 3px;margin-right:2px;vertical-align:middle'>{pct:+d}%</span>"
            star = "<span style='color:#fff;background:#cc8800;font-size:9px;font-weight:800;border-radius:3px;padding:1px 4px;margin-left:3px;vertical-align:middle'>&#9733; KING</span>" if king == strike else ""
            bdr  = "border-top:1px solid #cc8800;border-bottom:1px solid #cc8800" if is_spot else ""
            cells += (
                f"<td style='background:{cell_bg};color:{fg};"
                f"{BASE_TD};text-align:right;border-left:1px solid #1a1a1a;{bdr}'>"
                f"{badge}{_fmt_cell(v) if v != 0 else ''}{star}</td>"
            )
        rows_html += f"<tr>{cells}</tr>"

    return (
        "<style>.gex-a-wrap{overflow-x:auto;overflow-y:auto;max-height:640px;"
        "border-radius:6px;border:1px solid var(--gex-border);background:var(--gex-bg)}"
        ".gex-a{border-collapse:collapse;width:100%;font-family:'Courier New',monospace}"
        ".gex-a tbody tr:hover td{filter:brightness(0.85)}</style>"
        "<div class='gex-a-wrap'><table class='gex-a'>"
        f"{thead}<tbody>{rows_html}</tbody></table></div>"
    )


def _compare_table_html(datasets: list, expiry: str, n_strikes: int = 20) -> str:
    """
    Mode B — multiple tickers, one shared expiry.
    Each ticker = its own STRIKE | GEX panel, side by side.
    Each ticker uses n_strikes centred on its own spot (n_strikes//2 above, n_strikes//2 below).
    """
    import datetime as _dt

    try:
        exp_label = _dt.date.fromisoformat(expiry).strftime("%b %d, %Y")
    except Exception:
        exp_label = expiry

    SEP     = "border-left:3px solid var(--gex-border2)"
    BASE_TD = "padding:1px 8px;font-size:11px;font-weight:600;font-family:'Courier New',monospace;border-bottom:1px solid var(--gex-border)"
    TH      = "background:var(--gex-bg2);padding:4px 8px;position:sticky;top:0;z-index:3;border-bottom:1px solid var(--gex-border2);white-space:nowrap"

    panels: list[dict] = []
    for d in datasets:
        if d.get("error") or not d.get("spot"):
            continue
        sym    = d["symbol"]
        spot   = d["spot"]
        hm_exp = d.get("heatmap_expiries", [])
        hm_str = d.get("heatmap_strikes", [])
        hm_val = d.get("heatmap_values", [])

        # find nearest expiry to the selected one
        if expiry in hm_exp:
            ei = hm_exp.index(expiry)
        elif hm_exp:
            import datetime as _dt2
            def _ed(e):
                try: return _dt2.date.fromisoformat(e)
                except: return _dt2.date.today()
            tgt = _ed(expiry)
            ei = min(range(len(hm_exp)), key=lambda x: abs((_ed(hm_exp[x]) - tgt).days))
        else:
            continue

        vals    = hm_val[ei] if ei < len(hm_val) else []
        gex_map = {s: v for s, v in zip(hm_str, vals)}
        if not gex_map:
            gex_map = {k: v for k, v in zip(d.get("strikes", []), d.get("gex_by_strike", []))}

        lo, hi = spot * 0.80, spot * 1.20
        all_s = sorted(s for s in gex_map if lo <= s <= hi)  # ascending
        if not all_s:
            continue
        # Centre on spot
        half = max(1, n_strikes // 2)
        spot_idx = min(range(len(all_s)), key=lambda i: abs(all_s[i] - spot))
        lo_idx = max(0, spot_idx - half)
        hi_idx = min(len(all_s), spot_idx + half)
        if hi_idx - lo_idx < n_strikes:
            if lo_idx == 0:
                hi_idx = min(len(all_s), n_strikes)
            else:
                lo_idx = max(0, hi_idx - n_strikes)
        strikes = sorted(all_s[lo_idx:hi_idx], reverse=True)
        if not strikes:
            continue

        vmax         = max((abs(gex_map.get(s, 0)) for s in strikes), default=1) or 1
        king_strike  = max(strikes, key=lambda s: abs(gex_map.get(s, 0)))
        nearest_spot = min(strikes, key=lambda s: abs(s - spot))
        pi           = _fetch_price_info(sym)
        lp           = pi["last"] or spot
        chg          = pi["change"]; chg_p = pi["change_pct"]
        net          = d.get("net_gex", 0) or 0
        zg           = d.get("zero_gamma")

        panels.append({
            "sym": sym, "lp": lp, "chg": chg, "chg_p": chg_p,
            "strikes": strikes, "gex_map": gex_map, "vmax": vmax,
            "king_strike": king_strike, "nearest_spot": nearest_spot,
            "net": net, "zg": zg,
        })

    if not panels:
        return "<p style='color:var(--gex-text3)'>No data for selected expiry.</p>"

    # header rows
    rowA = ""; rowC = ""
    for i, p in enumerate(panels):
        sep          = f";{SEP}" if i > 0 else ""
        chg_c        = "#00cc44" if p["chg"] >= 0 else "#ff4444"
        arr          = "+" if p["chg"] >= 0 else ""
        net_c        = "#00cc44" if p["net"] >= 0 else "#ff4444"
        zg_s         = f"${p['zg']:.2f}" if p["zg"] else "—"
        regime_label = "Long \u03b3" if p["net"] >= 0 else "Short \u03b3"
        regime_color = "#00cc44" if p["net"] >= 0 else "#ff4444"

        C_LBL = "font-size:10px;font-weight:600;color:var(--gex-text3);margin-right:4px"
        C_VAL = "font-size:13px;font-weight:800;"
        th_style = (f"background:var(--gex-bg2);padding:8px 14px;font-size:11px;font-weight:700;"
                    f"position:sticky;top:0;z-index:3;border-bottom:2px solid var(--gex-border2);"
                    f"white-space:nowrap;text-align:left{sep}")
        rowA += (
            f"<th colspan='2' style='{th_style}'>"
            f"<span style='font-size:17px;font-weight:900;color:var(--gex-text);margin-right:8px'>{p['sym']}</span>"
            f"<span style='font-size:15px;font-weight:700;color:var(--gex-text);margin-right:14px'>${p['lp']:.2f}</span>"
            f"<span style='{C_VAL};color:{chg_c};margin-right:18px'>{arr}{p['chg']:.2f} ({arr}{p['chg_p']:.2f}%)</span>"
            f"<span style='color:var(--gex-border2);margin-right:18px;font-size:13px'>|</span>"
            f"<span style='{C_LBL}'>Net GEX</span>"
            f"<span style='{C_VAL};color:{net_c};margin-right:18px'>{_fmt_gex(p['net'])}</span>"
            f"<span style='{C_LBL}'>Regime</span>"
            f"<span style='{C_VAL};color:{regime_color};margin-right:18px'>{regime_label}</span>"
            f"<span style='{C_LBL}'>Zero \u03b3</span>"
            f"<span style='{C_VAL};color:var(--gex-text2)'>{zg_s}</span>"
            f"</th>"
        )
        col_th = f"{TH};font-size:9px;font-weight:700;color:var(--gex-text3);border-top:2px solid var(--gex-border2);border-bottom:2px solid var(--gex-border2)"
        rowC += (
            f"<th style='{col_th};text-align:left{sep}'>STRIKE</th>"
            f"<th style='{col_th};text-align:right;min-width:100px'>GEX</th>"
        )

    thead = f"<thead><tr>{rowA}</tr><tr>{rowC}</tr></thead>"

    max_len   = max(len(p["strikes"]) for p in panels)
    rows_html = ""
    for row_i in range(max_len):
        cells = ""
        for i, p in enumerate(panels):
            sep = f";{SEP}" if i > 0 else ""
            strikes = p["strikes"]
            if row_i >= len(strikes):
                cells += f"<td style='background:var(--gex-bg);{BASE_TD}{sep}'></td><td style='background:var(--gex-bg);{BASE_TD}'></td>"
                continue
            strike   = strikes[row_i]
            v        = p["gex_map"].get(strike, 0)
            is_spot  = (strike == p["nearest_spot"])
            is_king  = (strike == p["king_strike"])
            cell_bg  = _heat_bg(v, p["vmax"])
            fg       = _fg(cell_bg)
            sk_bg    = "var(--gex-spot-bg)" if is_spot else "var(--gex-bg)"
            sk_col   = "#111" if is_spot else "var(--gex-text2)"
            sk_wt    = "font-weight:800" if is_spot else ""
            sk_bdr   = "border-top:2px solid #FFB800;border-bottom:2px solid #FFB800;border-left:4px solid #FFB800" if is_spot else ""
            spot_badge = (
                f"<span style='background:#FFB800;color:#111;font-size:8px;font-weight:800;"
                f"border-radius:3px;padding:1px 5px;margin-right:4px;vertical-align:middle'>"
                f"&#9658; SPOT ${p['lp']:.2f}</span>"
            ) if is_spot else ""
            marker   = ""
            badge    = ""
            if p["vmax"] > 0 and abs(v) >= 0.10 * p["vmax"]:
                pct = int(round(v / p["vmax"] * 100))
                bc  = "#00cc44" if pct > 0 else "#ff4444"
                badge = f"<span style='background:{bc};color:#000;font-size:7px;font-weight:700;border-radius:3px;padding:0 3px;margin-right:2px;vertical-align:middle'>{pct:+d}%</span>"
            star = "<span style='color:#fff;background:#cc8800;font-size:9px;font-weight:800;border-radius:3px;padding:1px 4px;margin-left:3px;vertical-align:middle'>&#9733; KING</span>" if is_king else ""
            cells += (
                f"<td style='background:{sk_bg};color:{sk_col};{sk_wt};{BASE_TD};text-align:left;{sk_bdr}{sep}'>"
                f"{spot_badge}{strike:.1f}</td>"
                f"<td style='background:{cell_bg};color:{fg};{BASE_TD};text-align:right;{sk_bdr}'>"
                f"{badge}{_fmt_cell(v) if v != 0 else ''}{star}</td>"
            )
        rows_html += f"<tr>{cells}</tr>"

    return (
        "<style>.gex-b-wrap{overflow-x:auto;overflow-y:auto;max-height:640px;"
        "border-radius:6px;border:1px solid var(--gex-border);background:var(--gex-bg)}"
        ".gex-b{border-collapse:collapse;width:100%;font-family:'Courier New',monospace}"
        ".gex-b tbody tr:hover td{filter:brightness(0.85)}</style>"
        "<div class='gex-b-wrap'><table class='gex-b'>"
        f"{thead}<tbody>{rows_html}</tbody></table></div>"
    )



# ──────────────────────────────────────────────
#  Bar chart
# ──────────────────────────────────────────────

def _bar_chart(d: dict, key: str) -> "go.Figure":
    strikes = d.get("strikes", [])
    net_gex = d.get("gex_by_strike", [])
    call_gex = d.get("call_gex_by_strike", [])
    put_gex = d.get("put_gex_by_strike", [])
    spot = d.get("spot")
    symbol = d.get("symbol", key)

    fig = go.Figure()
    if call_gex:
        fig.add_trace(go.Bar(
            x=strikes, y=call_gex, name="Call GEX",
            marker_color="rgba(220,50,50,0.85)",
            hovertemplate="%{x:.0f}: %{y:,.0f}<extra>Call</extra>",
        ))
    if put_gex:
        fig.add_trace(go.Bar(
            x=strikes, y=put_gex, name="Put GEX",
            marker_color="rgba(50,200,80,0.85)",
            hovertemplate="%{x:.0f}: %{y:,.0f}<extra>Put</extra>",
        ))
    if net_gex:
        fig.add_trace(go.Scatter(
            x=strikes, y=net_gex, name="Net GEX",
            mode="lines", line=dict(color="#ffe066", width=2),
            hovertemplate="%{x:.0f}: %{y:,.0f}<extra>Net</extra>",
        ))
    if spot:
        fig.add_vline(
            x=spot, line_color="#00ffcc", line_dash="dash", line_width=1.5,
            annotation_text=f"Spot {spot:.2f}", annotation_font_color="#00ffcc",
        )
    zg = d.get("zero_gamma")
    if zg:
        fig.add_vline(
            x=zg, line_color="#ff6b6b", line_dash="dot", line_width=1.2,
            annotation_text=f"ZG {zg:.0f}", annotation_font_color="#ff6b6b",
            annotation_position="bottom right",
        )
    fig.update_layout(
        title=dict(text=f"{symbol} — GEX by Strike", font=dict(color="#e0e0e0", size=14)),
        barmode="overlay",
        plot_bgcolor="#0a0a0a", paper_bgcolor="#0a0a0a",
        font=dict(color="#cccccc", size=11),
        legend=dict(bgcolor="#111", bordercolor="#333", borderwidth=1, font=dict(size=10)),
        xaxis=dict(gridcolor="#1a1a1a", zerolinecolor="#333", title="Strike"),
        yaxis=dict(gridcolor="#1a1a1a", zerolinecolor="#333", title="GEX ($)"),
        margin=dict(l=50, r=20, t=50, b=40),
        height=420,
    )
    return fig


# ──────────────────────────────────────────────
#  King Node star chart
# ──────────────────────────────────────────────

def _king_node_chart(d: dict, expiry: str) -> "go.Figure":
    """
    Polar / star chart for a single expiry.
    Each spoke = one strike; radius = abs(GEX).
    The strike with the highest absolute GEX is the King Node (★).
    Positive GEX spokes are green; negative are red.
    """
    heatmap_expiries: list = d.get("heatmap_expiries", [])
    heatmap_strikes: list  = d.get("heatmap_strikes", [])
    heatmap_values: list   = d.get("heatmap_values", [])
    symbol = d.get("symbol", "")
    spot   = d.get("spot")

    if expiry not in heatmap_expiries or not heatmap_strikes:
        fig = go.Figure()
        fig.update_layout(
            paper_bgcolor="#0a0a0a",
            plot_bgcolor="#0a0a0a",
            font=dict(color="#888"),
            title=dict(text="No data for this expiry", font=dict(color="#888")),
            height=480,
        )
        return fig

    exp_idx = heatmap_expiries.index(expiry)
    raw_vals: list[float] = heatmap_values[exp_idx] if exp_idx < len(heatmap_values) else []

    if not raw_vals:
        fig = go.Figure()
        fig.update_layout(paper_bgcolor="#0a0a0a", height=480)
        return fig

    strikes = heatmap_strikes
    gex_vals = raw_vals

    # Normalise angles evenly around 360°
    n = len(strikes)
    angles = [i * 360 / n for i in range(n)] + [0]  # close the loop

    abs_vals = [abs(v) for v in gex_vals]
    max_abs  = max(abs_vals) if abs_vals else 1
    king_idx = abs_vals.index(max_abs)
    king_strike = strikes[king_idx]
    king_val    = gex_vals[king_idx]

    # Build per-point colour (green=positive, red=negative)
    colours = ["rgba(50,200,80,0.85)" if v >= 0 else "rgba(220,50,50,0.85)" for v in gex_vals]

    # We draw two separate scatter-polar traces so legend shows both colour meanings,
    # then a highlighted king-node marker.
    pos_r, pos_theta, pos_labels = [], [], []
    neg_r, neg_theta, neg_labels = [], [], []
    for i, (s, v) in enumerate(zip(strikes, gex_vals)):
        ang = angles[i]
        lbl = f"Strike {s:.0f}<br>GEX: {_fmt_gex(v)}"
        if v >= 0:
            pos_r.append(abs(v)); pos_theta.append(ang); pos_labels.append(lbl)
        else:
            neg_r.append(abs(v)); neg_theta.append(ang); neg_labels.append(lbl)

    fig = go.Figure()

    if pos_r:
        fig.add_trace(go.Scatterpolar(
            r=pos_r, theta=pos_theta,
            mode="markers",
            marker=dict(size=6, color="rgba(50,200,80,0.85)"),
            name="Long GEX (calls)",
            hovertemplate="%{customdata}<extra></extra>",
            customdata=pos_labels,
        ))

    if neg_r:
        fig.add_trace(go.Scatterpolar(
            r=neg_r, theta=neg_theta,
            mode="markers",
            marker=dict(size=6, color="rgba(220,50,50,0.85)"),
            name="Short GEX (puts)",
            hovertemplate="%{customdata}<extra></extra>",
            customdata=neg_labels,
        ))

    # King node — the dominant strike — gold star
    king_angle = angles[king_idx]
    fig.add_trace(go.Scatterpolar(
        r=[abs(king_val)],
        theta=[king_angle],
        mode="markers+text",
        marker=dict(
            size=22,
            color="#ffd700",
            symbol="star",
            line=dict(color="#fff", width=1.5),
        ),
        text=[f"{king_strike:.0f}"],
        textposition="top center",
        textfont=dict(color="#ffd700", size=11, family="Arial Black"),
        name=f"King Node  {king_strike:.0f}  ({_fmt_gex(king_val)})",
        hovertemplate=(
            f"<b>KING NODE</b><br>"
            f"Strike: {king_strike:.0f}<br>"
            f"GEX: {_fmt_gex(king_val)}<br>"
            f"Expiry: {expiry}<extra></extra>"
        ),
    ))

    # Spot ring — dashed circle at the radius corresponding to spot-proximity
    # (just for visual reference; we draw a grey spoke at the nearest strike)
    if spot:
        nearest_s = min(strikes, key=lambda s: abs(s - spot))
        ni = strikes.index(nearest_s)
        spot_r = abs(gex_vals[ni]) if ni < len(gex_vals) else max_abs * 0.5
        fig.add_trace(go.Scatterpolar(
            r=[spot_r],
            theta=[angles[ni]],
            mode="markers",
            marker=dict(size=14, color="rgba(255,215,0,0)", symbol="circle",
                        line=dict(color="#00ffcc", width=2)),
            name=f"Spot ≈ {nearest_s:.0f}",
            hovertemplate=f"Spot strike: {nearest_s:.0f}<br>GEX: {_fmt_gex(gex_vals[ni])}<extra></extra>",
        ))

    fig.update_layout(
        polar=dict(
            bgcolor="#111",
            radialaxis=dict(
                visible=True, showticklabels=True,
                tickfont=dict(color="#555", size=8),
                gridcolor="#222",
                tickformat=".2s",
                linecolor="#333",
            ),
            angularaxis=dict(
                tickfont=dict(color="#555", size=8),
                gridcolor="#1a1a1a",
                linecolor="#333",
                direction="clockwise",
            ),
        ),
        paper_bgcolor="#0a0a0a",
        font=dict(color="#cccccc", size=11),
        title=dict(
            text=(
                f"<b>{symbol}</b> — King Node  "
                f"<span style='color:#ffd700'>{king_strike:.0f}</span>  "
                f"({expiry})"
            ),
            font=dict(color="#e0e0e0", size=14),
            x=0.5,
        ),
        legend=dict(bgcolor="#111", bordercolor="#333", borderwidth=1,
                    font=dict(size=10), orientation="h",
                    x=0.5, xanchor="center", y=-0.1),
        height=520,
        margin=dict(l=40, r=40, t=60, b=60),
    )
    return fig


# ──────────────────────────────────────────────
#  Symbol resolution
# ──────────────────────────────────────────────

# Known Indian index/equity names → auto-resolve to correct yfinance symbol
_INDIA_SYMBOL_MAP: dict[str, str] = {
    "NIFTY":        "^NSEI",
    "NIFTY50":      "^NSEI",
    "BANKNIFTY":    "^NSEBANK",
    "FINNIFTY":     "NIFTY_FIN_SERVICE.NS",
    "MIDCPNIFTY":   "NIFTY_MIDCAP_100.NS",
    "SENSEX":       "^BSESN",
}

_INDIA_EQUITY_SUFFIXES = {".NS", ".BO"}

def _resolve_symbol(raw: str) -> str:
    """Normalise a ticker string entered by the user.
    - Known Indian index shorthands (NIFTY, BANKNIFTY…) → yfinance index symbol
    - Bare NSE equity names (e.g. RELIANCE) → RELIANCE.NS
    - Everything else passes through unchanged.
    """
    up = raw.strip().upper()
    # Already has exchange suffix or is a yfinance index (^) → no change
    if up.startswith("^") or any(up.endswith(s) for s in _INDIA_EQUITY_SUFFIXES):
        return up
    # Known Indian index shorthand
    if up in _INDIA_SYMBOL_MAP:
        return _INDIA_SYMBOL_MAP[up]
    return up  # US ticker — pass through


# ──────────────────────────────────────────────
#  Main page
# ──────────────────────────────────────────────

def render_gamma_exposure_page() -> None:
    # ── Theme-adaptive CSS variables ─────────────────────────────────────────
    st.markdown("""
    <style>
    :root {
        --gex-bg:      #f5f5f5;
        --gex-bg2:     #ffffff;
        --gex-border:  #e0e0e0;
        --gex-border2: #cccccc;
        --gex-text:    #111111;
        --gex-text2:   #444444;
        --gex-text3:   #888888;
        --gex-spot-bg: #fffbe6;
        --gex-head:    #111111;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --gex-bg:      #0a0a0a;
            --gex-bg2:     #0d0d0d;
            --gex-border:  #222222;
            --gex-border2: #2a2a2a;
            --gex-text:    #e0e0e0;
            --gex-text2:   #aaaaaa;
            --gex-text3:   #555555;
            --gex-spot-bg: #1a1400;
            --gex-head:    #e0e0e0;
        }
    }
    </style>
    """, unsafe_allow_html=True)

    st.markdown(
        "<h2 style='color:var(--gex-head);margin-bottom:4px'>Gamma Exposure (GEX)</h2>",
        unsafe_allow_html=True,
    )

    # If a suggestion button set a pending ticker, pre-seed the input value
    # before the widget is rendered (avoids the "cannot modify after instantiation" error).
    if "gex_tickers_pending" in st.session_state:
        st.session_state["gex_tickers"] = st.session_state.pop("gex_tickers_pending")

    # Default to SPY on first load
    if "gex_tickers" not in st.session_state:
        st.session_state["gex_tickers"] = "SPY"

    col_input, col_btn = st.columns([5, 1])
    with col_input:
        raw_input = st.text_input(
            "Tickers",
            key="gex_tickers",
            placeholder="e.g. SPY  AAPL  RELIANCE.NS  (up to 5, space or comma separated)",
            label_visibility="collapsed",
        )
    with col_btn:
        fetch = st.button("Refresh", use_container_width=True, key="gex_fetch")

    tickers = [_resolve_symbol(t) for t in raw_input.replace(",", " ").split() if t.strip()][:5]
    if not tickers:
        return

    datasets: list = []
    errors: list = []

    prog = st.progress(0, text="Loading options data…")
    for i, sym in enumerate(tickers):
        if fetch:
            _cached_gex.clear()
        try:
            d = _cached_gex(sym)
            datasets.append(d)
            if d.get("error"):
                errors.append(f"**{sym}**: {d['error']}")
        except Exception as exc:
            errors.append(f"**{sym}**: {exc}")
            datasets.append({"symbol": sym, "error": str(exc)})
        prog.progress((i + 1) / len(tickers), text=f"Loaded {sym}")
    prog.empty()

    # ── Show suggestions for any failed tickers ───────────────────────────
    failed_syms = [d["symbol"] for d in datasets if d.get("error") or not d.get("spot")]
    for sym in failed_syms:
        suggestions = _search_suggestions(sym)
        if not suggestions:
            st.warning(f"**{sym}** — no data found and no suggestions available.")
            continue

        st.markdown(
            f"<div style='background:var(--gex-bg2);border:1px solid var(--gex-border2);border-radius:8px;"
            f"padding:10px 16px 6px 16px;margin-bottom:8px'>"
            f"<div style='font-size:11px;color:var(--gex-text3);margin-bottom:8px'>"
            f"⚠️&nbsp; No options data for <b style='color:var(--gex-text)'>{sym}</b>"
            f" — did you mean one of these?"
            f"</div></div>",
            unsafe_allow_html=True,
        )
        btn_cols = st.columns(len(suggestions))
        for col, s in zip(btn_cols, suggestions):
            label   = s["symbol"]
            name    = s["name"][:28] + "…" if len(s["name"]) > 28 else s["name"]
            exch    = s["exchange"]
            btn_lbl = f"{label}\n{name} · {exch}" if exch else f"{label}\n{name}"
            if col.button(btn_lbl, key=f"sugg_{sym}_{label}", use_container_width=True):
                # Write to a pending key — the widget reads it on the next rerun
                # before st.text_input is instantiated, avoiding the Streamlit error.
                current = st.session_state.get("gex_tickers", "")
                parts   = [t.strip() for t in current.replace(",", " ").split() if t.strip()]
                resolved_failed = sym
                new_parts = [label if _resolve_symbol(p) == resolved_failed else p for p in parts]
                if label not in new_parts:
                    new_parts = [label if p.upper() == sym.upper() else p for p in new_parts]
                if label not in new_parts:
                    new_parts.append(label)
                st.session_state["gex_tickers_pending"] = " ".join(new_parts)
                _cached_gex.clear()
                st.rerun()

    valid = [d for d in datasets if not d.get("error") and d.get("spot")]

    if valid:
        cols = st.columns(len(valid))
        for col, d in zip(cols, valid):
            sym   = d["symbol"]
            net   = d.get("net_gex", 0) or 0
            rc    = "#00cc44" if net >= 0 else "#ff4444"
            rl    = "Long Gamma" if net >= 0 else "Short Gamma"
            zg    = d.get("zero_gamma")
            zg_s  = f"${zg:.2f}" if zg else "—"
            mcw   = d.get("max_call_wall")
            mpw   = d.get("max_put_wall")

            pi = _fetch_price_info(sym)
            spot   = pi["last"] or d.get("spot") or 0
            chg    = pi["change"]
            chg_p  = pi["change_pct"]
            hi     = pi["day_high"]
            lo     = pi["day_low"]
            vol    = pi["volume"]
            chg_c  = "#00cc44" if chg >= 0 else "#ff4444"
            chg_arrow = "+" if chg >= 0 else ""
            vol_s  = f"{vol/1_000_000:.1f}M" if vol >= 1_000_000 else (f"{vol/1_000:.0f}K" if vol >= 1_000 else str(vol))

            with col:
                st.markdown(
                    f"<div style='background:var(--gex-bg2);border:1px solid var(--gex-border2);border-radius:8px;"
                    f"padding:12px 14px;'>"
                    # ticker + spot
                    f"<div style='display:flex;justify-content:space-between;align-items:baseline'>"
                    f"<span style='font-size:20px;font-weight:800;color:var(--gex-text);letter-spacing:1px'>{sym}</span>"
                    f"<span style='font-size:22px;font-weight:700;color:var(--gex-text)'>${spot:.2f}</span>"
                    f"</div>"
                    # daily change
                    f"<div style='margin-top:2px'>"
                    f"<span style='font-size:13px;font-weight:700;color:{chg_c}'>"
                    f"{chg_arrow}{chg:.2f} ({chg_arrow}{chg_p:.2f}%)</span>"
                    f"<span style='font-size:10px;color:var(--gex-text3);margin-left:8px'>today</span>"
                    f"</div>"
                    # high / low / volume
                    f"<div style='display:flex;gap:12px;margin-top:6px;font-size:10px;color:var(--gex-text3)'>"
                    f"<span>H&nbsp;<b style='color:var(--gex-text2)'>${hi:.2f}</b></span>"
                    f"<span>L&nbsp;<b style='color:var(--gex-text2)'>${lo:.2f}</b></span>"
                    f"<span>Vol&nbsp;<b style='color:var(--gex-text2)'>{vol_s}</b></span>"
                    f"</div>"
                    # divider
                    f"<div style='border-top:1px solid var(--gex-border);margin:8px 0'></div>"
                    # GEX stats
                    f"<div style='display:flex;justify-content:space-between;font-size:10px'>"
                    f"<div>"
                    f"<div style='color:var(--gex-text3)'>Regime</div>"
                    f"<div style='color:{rc};font-weight:700;font-size:11px'>{rl}</div>"
                    f"</div>"
                    f"<div>"
                    f"<div style='color:var(--gex-text3)'>Net GEX</div>"
                    f"<div style='color:#cc8800;font-weight:700;font-size:11px'>{_fmt_gex(net)}</div>"
                    f"</div>"
                    f"<div>"
                    f"<div style='color:var(--gex-text3)'>Zero Gamma</div>"
                    f"<div style='color:var(--gex-text2);font-size:11px'>{zg_s}</div>"
                    f"</div>"
                    f"</div>"
                    # call / put walls
                    f"<div style='display:flex;gap:14px;margin-top:6px;font-size:10px'>"
                    f"<span style='color:var(--gex-text3)'>Call Wall&nbsp;<b style='color:#00cc44'>${mcw:.0f}</b></span>" if mcw else ""
                    f"<span style='color:var(--gex-text3)'>Put Wall&nbsp;<b style='color:#ff4444'>${mpw:.0f}</b></span>" if mpw else ""
                    f"</div>"
                    f"</div>",
                    unsafe_allow_html=True,
                )

    st.markdown("<div style='margin-top:14px'></div>", unsafe_allow_html=True)

    tab_table, tab_bar, tab_king, tab_compare = st.tabs(["Strike Table", "Bar Chart", "King Node", "Compare"])

    with tab_table:
        if not valid:
            st.warning("No valid data to display.")
        else:
            # ── collect all available expiries across all loaded tickers ──
            all_expiries: list = []
            seen_e: set = set()
            for d in valid:
                for exp in d.get("heatmap_expiries", []):
                    if exp not in seen_e:
                        all_expiries.append(exp)
                        seen_e.add(exp)

            is_multi = len(valid) > 1  # auto-detect mode

            # ── Shared inline control bar ─────────────────────────────────
            st.markdown(
                "<style>"
                "div[data-testid='stHorizontalBlock'] > div[data-testid='stColumn'] {"
                "  padding-right: 4px !important; padding-left: 4px !important;"
                "}"
                "div.gex-ctrl-bar div[data-baseweb='select'] > div,"
                "div.gex-ctrl-bar input[type='number'] {"
                "  background: var(--gex-bg2) !important; border: 1px solid var(--gex-border2) !important;"
                "  border-radius: 6px !important; color: var(--gex-text) !important; font-size:12px !important;"
                "}"
                "</style>",
                unsafe_allow_html=True,
            )

            _STRIKE_OPTIONS = [5, 10, 20, 30, 40, 50, "Custom"]

            if not is_multi:
                # ── MODE A: single ticker — expiries as columns ────────────
                with st.container():
                    st.markdown("<div class='gex-ctrl-bar'>", unsafe_allow_html=True)
                    ca, cb, cc = st.columns([5, 2, 2])
                    with ca:
                        if "gex_exp_filter" not in st.session_state:
                            st.session_state["gex_exp_filter"] = (
                                all_expiries[:4] if len(all_expiries) >= 4 else list(all_expiries)
                            )
                        st.session_state["gex_exp_filter"] = [
                            e for e in st.session_state["gex_exp_filter"] if e in all_expiries
                        ]
                        selected_expiries = st.multiselect(
                            "Expiries",
                            options=all_expiries,
                            key="gex_exp_filter",
                            placeholder="Expiry dates…",
                            label_visibility="collapsed",
                        )
                    with cb:
                        _strike_sel = st.selectbox(
                            "Strikes", _STRIKE_OPTIONS,
                            index=2, key="gex_strikes_sel",
                            label_visibility="collapsed",
                        )
                    with cc:
                        if _strike_sel == "Custom":
                            n_strikes = int(st.number_input(
                                "N", min_value=2, max_value=200, value=20, step=2,
                                key="gex_strikes_custom", label_visibility="collapsed",
                            ))
                        else:
                            n_strikes = int(_strike_sel)
                            st.markdown(
                                f"<div style='height:38px;display:flex;align-items:center;"
                                f"font-size:11px;color:var(--gex-text3)'>±{n_strikes//2} around spot</div>",
                                unsafe_allow_html=True,
                            )
                    st.markdown("</div>", unsafe_allow_html=True)

                expiry_filter = selected_expiries if selected_expiries else None
                st.markdown(
                    _single_ticker_table_html(valid[0], n_strikes=n_strikes, expiry_filter=expiry_filter),
                    unsafe_allow_html=True,
                )

            else:
                # ── MODE B: multi-ticker — one expiry, panels side by side ─
                with st.container():
                    st.markdown("<div class='gex-ctrl-bar'>", unsafe_allow_html=True)
                    ca, cb, cc = st.columns([5, 2, 2])
                    with ca:
                        selected_expiry = st.selectbox(
                            "Expiry",
                            options=all_expiries,
                            index=0,
                            key="gex_cmp_expiry",
                            label_visibility="collapsed",
                        )
                    with cb:
                        _strike_sel = st.selectbox(
                            "Strikes", _STRIKE_OPTIONS,
                            index=2, key="gex_strikes_sel",
                            label_visibility="collapsed",
                        )
                    with cc:
                        if _strike_sel == "Custom":
                            n_strikes = int(st.number_input(
                                "N", min_value=2, max_value=200, value=20, step=2,
                                key="gex_strikes_custom", label_visibility="collapsed",
                            ))
                        else:
                            n_strikes = int(_strike_sel)
                            st.markdown(
                                f"<div style='height:38px;display:flex;align-items:center;"
                                f"font-size:11px;color:var(--gex-text3)'>±{n_strikes//2} around spot</div>",
                                unsafe_allow_html=True,
                            )
                    st.markdown("</div>", unsafe_allow_html=True)

                st.markdown(
                    _compare_table_html(valid, expiry=selected_expiry, n_strikes=n_strikes),
                    unsafe_allow_html=True,
                )

            st.markdown(
                "<div style='margin-top:8px;font-size:10px;color:var(--gex-text3)'>"
                "Green = dealer <b>long gamma</b> &nbsp;|&nbsp; "
                "Red = dealer <b>short gamma</b> &nbsp;|&nbsp; "
                "<span style='background:#FFB800;color:#111;font-size:8px;font-weight:800;border-radius:3px;padding:1px 5px'>&#9658; SPOT</span> = <b>current spot</b> &nbsp;|&nbsp; "
                "<span style='color:#fff;background:#cc8800;font-size:9px;font-weight:800;border-radius:3px;padding:1px 4px'>&#9733; KING</span> = <b>King Node</b>"
                "</div>",
                unsafe_allow_html=True,
            )

    with tab_bar:
        if not valid:
            st.warning("No valid data to display.")
        else:
            for d in valid:
                fig = _bar_chart(d, d["symbol"])
                st.plotly_chart(fig, use_container_width=True, key=f"bar_{d['symbol']}")
                walls_md = []
                mcw = d.get("max_call_wall")
                mpw = d.get("max_put_wall")
                if mcw: walls_md.append(f"Call Wall: **${mcw:.0f}**")
                if mpw: walls_md.append(f"Put Wall: **${mpw:.0f}**")
                if walls_md:
                    st.caption("  |  ".join(walls_md))

    with tab_compare:
        st.markdown(
            "<p style='color:var(--gex-text3);font-size:12px;margin-bottom:12px'>"
            "Compare GEX profiles for up to 3 tickers side-by-side for a chosen expiry.</p>",
            unsafe_allow_html=True,
        )

        # ── ticker inputs ──────────────────────────────────────────────────
        cmp_cols = st.columns(3)
        cmp_syms: list[str] = []
        for ci, cmp_col in enumerate(cmp_cols):
            with cmp_col:
                default_val = tickers[ci] if ci < len(tickers) else ""
                val = st.text_input(
                    f"Ticker {ci + 1}", value=default_val,
                    key=f"cmp_sym_{ci}", placeholder="e.g. SPY",
                )
                if val.strip():
                    cmp_syms.append(val.strip().upper())

        if not cmp_syms:
            st.info("Enter at least one ticker above.")
        else:
            # fetch data for compare tickers (auto-loads on any input change)
            cmp_datasets: list[dict] = []
            cmp_prog = st.progress(0, text="Loading compare data...")
            for ci, sym in enumerate(cmp_syms[:3]):
                try:
                    cd = _cached_gex(sym)
                    cmp_datasets.append(cd)
                    if cd.get("error"):
                        st.warning(f"{sym}: {cd['error']}")
                except Exception as exc:
                    st.warning(f"{sym}: {exc}")
                    cmp_datasets.append({"symbol": sym, "error": str(exc)})
                cmp_prog.progress((ci + 1) / len(cmp_syms[:3]))
            cmp_prog.empty()

            cmp_valid = [cd for cd in cmp_datasets if not cd.get("error") and cd.get("spot")]
            if not cmp_valid:
                st.warning("No valid data loaded.")
            else:
                # ── per-ticker header cards ───────────────────────────────
                hdr_cols = st.columns(len(cmp_valid))
                for hc, cd in zip(hdr_cols, cmp_valid):
                    sym   = cd["symbol"]
                    net   = cd.get("net_gex", 0) or 0
                    rc    = "#00cc44" if net >= 0 else "#ff4444"
                    rl    = "Long Gamma" if net >= 0 else "Short Gamma"
                    zg    = cd.get("zero_gamma")
                    zg_s  = f"${zg:.2f}" if zg else "—"
                    mcw   = cd.get("max_call_wall")
                    mpw   = cd.get("max_put_wall")
                    pi    = _fetch_price_info(sym)
                    spot  = pi["last"] or cd.get("spot") or 0
                    chg   = pi["change"]; chg_p = pi["change_pct"]
                    hi    = pi["day_high"]; lo = pi["day_low"]; vol = pi["volume"]
                    chg_c = "#00cc44" if chg >= 0 else "#ff4444"
                    arr   = "+" if chg >= 0 else ""
                    vol_s = f"{vol/1_000_000:.1f}M" if vol >= 1_000_000 else (f"{vol/1_000:.0f}K" if vol >= 1_000 else str(vol))

                    with hc:
                        st.markdown(
                            f"<div style='background:var(--gex-bg2);border:1px solid var(--gex-border2);"
                            f"border-radius:8px;padding:12px 14px;margin-bottom:10px'>"
                            f"<div style='display:flex;justify-content:space-between;align-items:baseline'>"
                            f"<span style='font-size:20px;font-weight:800;color:var(--gex-text)'>{sym}</span>"
                            f"<span style='font-size:20px;font-weight:700;color:var(--gex-text)'>${spot:.2f}</span>"
                            f"</div>"
                            f"<div style='font-size:13px;font-weight:700;color:{chg_c};margin-top:2px'>"
                            f"{arr}{chg:.2f} ({arr}{chg_p:.2f}%)</div>"
                            f"<div style='display:flex;gap:10px;margin-top:5px;font-size:10px;color:var(--gex-text3)'>"
                            f"<span>H <b style='color:var(--gex-text2)'>${hi:.2f}</b></span>"
                            f"<span>L <b style='color:var(--gex-text2)'>${lo:.2f}</b></span>"
                            f"<span>Vol <b style='color:var(--gex-text2)'>{vol_s}</b></span>"
                            f"</div>"
                            f"<div style='border-top:1px solid var(--gex-border);margin:7px 0'></div>"
                            f"<div style='display:flex;justify-content:space-between;font-size:10px'>"
                            f"<div><div style='color:var(--gex-text3)'>Regime</div>"
                            f"<div style='color:{rc};font-weight:700'>{rl}</div></div>"
                            f"<div><div style='color:var(--gex-text3)'>Net GEX</div>"
                            f"<div style='color:#cc8800;font-weight:700'>{_fmt_gex(net)}</div></div>"
                            f"<div><div style='color:var(--gex-text3)'>Zero Gamma</div>"
                            f"<div style='color:var(--gex-text2)'>{zg_s}</div></div>"
                            f"</div>"
                            f"<div style='display:flex;gap:12px;margin-top:5px;font-size:10px'>"
                            + (f"<span style='color:var(--gex-text3)'>Call Wall <b style='color:#00cc44'>${mcw:.0f}</b></span>" if mcw else "")
                            + (f"<span style='color:var(--gex-text3)'>Put Wall <b style='color:#ff4444'>${mpw:.0f}</b></span>" if mpw else "")
                            + f"</div></div>",
                            unsafe_allow_html=True,
                        )

                st.markdown("<div style='margin-top:4px'></div>", unsafe_allow_html=True)

                # ── shared expiry selector ────────────────────────────────
                all_cmp_exp: list = []
                seen_e: set = set()
                for cd in cmp_valid:
                    for e in cd.get("heatmap_expiries", []):
                        if e not in seen_e:
                            all_cmp_exp.append(e); seen_e.add(e)

                if all_cmp_exp:
                    selected_cmp_exp = st.selectbox(
                        "Select expiry for comparison",
                        options=all_cmp_exp,
                        key="cmp_expiry",
                    )

                    # ── side-by-side bar charts ───────────────────────────
                    chart_cols = st.columns(len(cmp_valid))
                    for cc, cd in zip(chart_cols, cmp_valid):
                        sym = cd["symbol"]
                        hm_exp  = cd.get("heatmap_expiries", [])
                        hm_str  = cd.get("heatmap_strikes", [])
                        hm_val  = cd.get("heatmap_values", [])
                        spot_v  = (pi := _fetch_price_info(sym))["last"] or cd.get("spot") or 0

                        if selected_cmp_exp in hm_exp:
                            ei   = hm_exp.index(selected_cmp_exp)
                            vals = hm_val[ei] if ei < len(hm_val) else []
                            # filter ±20% of spot
                            pairs = [(s, v) for s, v in zip(hm_str, vals)
                                     if spot_v == 0 or (spot_v * 0.8 <= s <= spot_v * 1.2)]
                            if pairs:
                                sk, vk = zip(*pairs)
                                clrs = ["rgba(50,200,80,0.85)" if v >= 0 else "rgba(220,50,50,0.85)" for v in vk]
                                king_s = max(pairs, key=lambda x: abs(x[1]))[0]

                                fig = go.Figure(go.Bar(
                                    x=list(sk), y=list(vk),
                                    marker_color=clrs,
                                    hovertemplate="%{x:.0f}: %{y:,.0f}<extra></extra>",
                                ))
                                if spot_v:
                                    fig.add_vline(x=spot_v, line_color="#ffd700",
                                                  line_dash="dash", line_width=1.5,
                                                  annotation_text=f"Spot {spot_v:.2f}",
                                                  annotation_font_color="#ffd700")
                                # king node line
                                fig.add_vline(x=king_s, line_color="#ffffff",
                                              line_dash="dot", line_width=1,
                                              annotation_text=f"K {king_s:.0f}",
                                              annotation_font_color="#fff")
                                fig.update_layout(
                                    title=dict(text=f"{sym}  {selected_cmp_exp}",
                                               font=dict(color="#e0e0e0", size=13)),
                                    plot_bgcolor="#0a0a0a", paper_bgcolor="#0a0a0a",
                                    font=dict(color="#aaa", size=10),
                                    xaxis=dict(gridcolor="#1a1a1a", title="Strike"),
                                    yaxis=dict(gridcolor="#1a1a1a", title="GEX ($)"),
                                    margin=dict(l=40, r=10, t=40, b=30),
                                    height=340,
                                    showlegend=False,
                                )
                                with cc:
                                    st.plotly_chart(fig, use_container_width=True,
                                                    key=f"cmp_chart_{sym}_{selected_cmp_exp}")
                                    # king node callout
                                    king_v = dict(zip(sk, vk)).get(king_s, 0)
                                    kc2 = "#00cc44" if king_v >= 0 else "#ff4444"
                                    st.markdown(
                                        f"<div style='background:var(--gex-spot-bg);border:1px solid #cc8800;"
                                        f"border-radius:5px;padding:6px 12px;font-size:11px'>"
                                        f"<span style='color:#cc8800;font-weight:700'>King Node</span>"
                                        f"&nbsp;&nbsp;"
                                        f"<span style='color:var(--gex-text);font-size:13px;font-weight:700'>${king_s:.0f}</span>"
                                        f"&nbsp;"
                                        f"<span style='color:{kc2}'>{_fmt_gex(king_v)}</span>"
                                        f"</div>",
                                        unsafe_allow_html=True,
                                    )
                            else:
                                with cc:
                                    st.caption(f"{sym}: no data near spot for {selected_cmp_exp}")
                        else:
                            with cc:
                                st.caption(f"{sym}: expiry {selected_cmp_exp} not available")

                    # ── strike table for selected expiry ──────────────────
                    st.markdown(
                        "<div style='margin-top:18px;margin-bottom:6px;"
                        "font-size:12px;font-weight:700;color:var(--gex-text3);letter-spacing:1px'>"
                        "STRIKE TABLE</div>",
                        unsafe_allow_html=True,
                    )
                    st.markdown(
                        _compare_table_html(cmp_valid, expiry=selected_cmp_exp, n_strikes=20),
                        unsafe_allow_html=True,
                    )
                    st.markdown(
                        "<div style='margin-top:6px;font-size:10px;color:var(--gex-text3)'>"
                        "Green = dealer <b>long gamma</b> &nbsp;|&nbsp; "
                        "Red = dealer <b>short gamma</b> &nbsp;|&nbsp; "
                        "<span style='background:#FFB800;color:#111;font-size:8px;font-weight:800;border-radius:3px;padding:1px 5px'>&#9658; SPOT</span> = spot &nbsp;|&nbsp; "
                        "<span style='color:#fff;background:#cc8800;font-size:9px;font-weight:800;border-radius:3px;padding:1px 4px'>&#9733; KING</span> = King Node"
                        "</div>",
                        unsafe_allow_html=True,
                    )
                else:
                    st.info("No expiry data available for the selected tickers.")

    with tab_king:
        if not valid:
            st.warning("No valid data to display.")
        else:
            st.markdown(
                "<p style='color:#888;font-size:12px'>"
                "<b style='color:#ffd700'>King Node</b> = the strike with the largest absolute GEX "
                "for the chosen expiry. It acts as the dominant gamma magnet / wall for that date.</p>",
                unsafe_allow_html=True,
            )
            for d in valid:
                expiries = d.get("heatmap_expiries", [])
                if not expiries:
                    st.info(f"{d['symbol']}: no expiry data available.")
                    continue

                sel_key = f"king_exp_{d['symbol']}"
                selected_exp = st.selectbox(
                    f"{d['symbol']} — Select expiry",
                    expiries,
                    key=sel_key,
                )

                fig = _king_node_chart(d, selected_exp)
                st.plotly_chart(fig, use_container_width=True, key=f"king_{d['symbol']}_{selected_exp}")

                # Summary card for the king node of this expiry
                hm_exp = d.get("heatmap_expiries", [])
                hm_str = d.get("heatmap_strikes", [])
                hm_val = d.get("heatmap_values", [])
                if selected_exp in hm_exp and hm_str:
                    ei = hm_exp.index(selected_exp)
                    vals = hm_val[ei] if ei < len(hm_val) else []
                    if vals:
                        abs_v = [abs(v) for v in vals]
                        ki = abs_v.index(max(abs_v))
                        ks = hm_str[ki]
                        kv = vals[ki]
                        kc = "#00cc44" if kv >= 0 else "#ff4444"
                        st.markdown(
                            f"<div style='background:#1a1400;border:1px solid #ffd700;"
                            f"border-radius:6px;padding:10px 16px;margin-top:6px;"
                            f"display:inline-block'>"
                            f"<span style='color:#ffd700;font-size:16px;font-weight:800'>King Node</span> "
                            f"<span style='color:#e0e0e0;font-size:14px;margin-left:8px'>{d['symbol']} · {selected_exp}</span><br>"
                            f"<span style='color:#e0e0e0;font-size:22px;font-weight:700'>${ks:.0f}</span>"
                            f"<span style='color:{kc};font-size:13px;margin-left:10px'>{_fmt_gex(kv)}</span>"
                            f"</div>",
                            unsafe_allow_html=True,
                        )
