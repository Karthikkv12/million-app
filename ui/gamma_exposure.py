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
        return "#0d0d0d"
    ratio = max(-1.0, min(1.0, v / vmax))
    if ratio >= 0:
        # dark → bright green
        t = ratio
        if t < 0.25:
            f = t / 0.25; r, g, b = 0, int(30 + f * 80), 0
        elif t < 0.5:
            f = (t - 0.25) / 0.25; r, g, b = 0, int(110 + f * 90), int(f * 20)
        elif t < 0.75:
            f = (t - 0.5) / 0.25; r, g, b = int(f * 40), int(200 + f * 40), int(20 + f * 20)
        else:
            f = (t - 0.75) / 0.25; r, g, b = int(40 + f * 50), int(240 + f * 15), int(40 + f * 30)
    else:
        # dark → bright red
        t = -ratio
        if t < 0.25:
            f = t / 0.25; r, g, b = int(40 + f * 80), 0, 0
        elif t < 0.5:
            f = (t - 0.25) / 0.25; r, g, b = int(120 + f * 80), int(f * 10), 0
        elif t < 0.75:
            f = (t - 0.5) / 0.25; r, g, b = int(200 + f * 40), int(10 + f * 20), 0
        else:
            f = (t - 0.75) / 0.25; r, g, b = int(240 + f * 15), int(30 + f * 30), int(f * 20)
    return f"rgb({r},{g},{b})"


def _fg(bg: str) -> str:
    """Return white or dark text depending on background luminance."""
    try:
        r, g, b = [int(x) for x in bg[4:-1].split(",")]
        return "#ffffff" if (0.299 * r + 0.587 * g + 0.114 * b) < 140 else "#0a0a0a"
    except Exception:
        return "#ffffff"


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
        # per-expiry heatmap slices
        "heatmap_expiries": r.heatmap_expiries,
        "heatmap_strikes": r.heatmap_strikes,
        "heatmap_values": r.heatmap_values,
    }


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

def _single_ticker_table_html(d: dict, max_rows: int = 80, expiry_filter: list | None = None) -> str:
    """
    Mode A — one ticker, multiple expiries as columns.
    Rows = strikes descending (±20% of spot).
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
        return "<p style='color:#888'>No expiry data for selected filter.</p>"

    # union of strikes ±20% of spot across all selected expiries
    lo, hi = spot * 0.80, spot * 1.20
    all_s: set = set()
    for _, _, gm, _, _ in exp_cols:
        all_s.update(s for s in gm if lo <= s <= hi)
    sorted_strikes = sorted(all_s, reverse=True)[:max_rows]
    if not sorted_strikes:
        return "<p style='color:#888'>No strikes in ±20% range.</p>"

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

    # ── header ────────────────────────────────────────────────────────────
    TH = "background:#0d0d0d;padding:3px 8px;font-size:10px;font-weight:700;" \
         "position:sticky;top:0;z-index:3;border-bottom:2px solid #2a2a2a;white-space:nowrap"

    # Row A: ticker info spanning all columns
    ncols = 1 + len(exp_cols)  # strike col + one col per expiry
    rowA = (
        f"<tr><th colspan='{ncols}' style='{TH};text-align:left'>"
        f"<span style='font-size:15px;font-weight:800;color:#fff'>{sym}</span>"
        f"&nbsp;&nbsp;<span style='font-size:15px;color:#fff'>${lp:.2f}</span>"
        f"&nbsp;<span style='font-size:11px;color:{chg_c}'>{arr}{chg:.2f} ({arr}{chg_p:.2f}%)</span>"
        f"&nbsp;&nbsp;<span style='font-size:9px;color:#555'>ZG <span style='color:#aaa'>{zg_s}</span></span>"
        f"&nbsp;&nbsp;<span style='font-size:9px;color:#555'>Net <span style='color:{net_c};font-weight:700'>{_fmt_gex(net)}</span></span>"
        f"</th></tr>"
    )
    # Row B: column headers
    rowB_cells = f"<th style='{TH};color:#555;text-align:left;min-width:70px'>STRIKE</th>"
    for (exp, short, _, _, king) in exp_cols:
        star = " &#9733;" if king in sorted_strikes else ""
        rowB_cells += f"<th style='{TH};color:#888;text-align:right;min-width:90px;border-left:1px solid #222'>{short}{star}</th>"
    rowB = f"<tr>{rowB_cells}</tr>"

    thead = f"<thead>{rowA}{rowB}</thead>"

    # ── body ──────────────────────────────────────────────────────────────
    BASE_TD = "padding:1px 8px;font-size:11px;font-family:'Courier New',monospace;border-bottom:1px solid #141414"
    rows_html = ""
    for strike in sorted_strikes:
        is_spot = (strike == nearest_spot)
        sk_bg   = "#1a1400" if is_spot else "#0a0a0a"
        sk_col  = "#ffd700" if is_spot else "#aaaaaa"
        sk_wt   = "font-weight:800" if is_spot else ""
        sk_bdr  = "border-top:1px solid #ffd700;border-bottom:1px solid #ffd700" if is_spot else ""
        marker  = "<span style='color:#ffd700;margin-right:2px'>&#9658;</span>" if is_spot else ""

        cells = (
            f"<td style='background:{sk_bg};color:{sk_col};{sk_wt};"
            f"{BASE_TD};text-align:left;{sk_bdr}'>{marker}{strike:.1f}</td>"
        )
        for (_, _, gex_map, vmax, king) in exp_cols:
            v = gex_map.get(strike, float("nan"))
            if isinstance(v, float) and math.isnan(v):
                cells += f"<td style='background:#0d0d0d;color:#333;{BASE_TD};text-align:right;border-left:1px solid #1a1a1a'>—</td>"
                continue
            cell_bg = _heat_bg(v, vmax)
            fg      = _fg(cell_bg)
            badge   = ""
            if vmax > 0 and abs(v) >= 0.10 * vmax:
                pct = int(round(v / vmax * 100))
                bc  = "#00cc44" if pct > 0 else "#ff4444"
                badge = f"<span style='background:{bc};color:#000;font-size:7px;font-weight:700;border-radius:3px;padding:0 3px;margin-right:2px;vertical-align:middle'>{pct:+d}%</span>"
            star = "<span style='color:#ffd700;font-size:10px;margin-left:2px'>&#9733;</span>" if king == strike else ""
            bdr  = "border-top:1px solid #ffd700;border-bottom:1px solid #ffd700" if is_spot else ""
            cells += (
                f"<td style='background:{cell_bg};color:{fg};"
                f"{BASE_TD};text-align:right;border-left:1px solid #1a1a1a;{bdr}'>"
                f"{badge}{_fmt_cell(v) if v != 0 else ''}{star}</td>"
            )
        rows_html += f"<tr>{cells}</tr>"

    return (
        "<style>.gex-a-wrap{overflow-x:auto;overflow-y:auto;max-height:640px;"
        "border-radius:6px;border:1px solid #222;background:#0a0a0a}"
        ".gex-a{border-collapse:collapse;width:100%;font-family:'Courier New',monospace}"
        ".gex-a tbody tr:hover td{filter:brightness(1.4)}</style>"
        "<div class='gex-a-wrap'><table class='gex-a'>"
        f"{thead}<tbody>{rows_html}</tbody></table></div>"
    )


def _compare_table_html(datasets: list, expiry: str, max_rows: int = 80) -> str:
    """
    Mode B — multiple tickers, one shared expiry.
    Each ticker = its own STRIKE | GEX panel, side by side.
    Each ticker uses its own strike range (±20% of its spot).
    """
    import datetime as _dt

    try:
        exp_label = _dt.date.fromisoformat(expiry).strftime("%b %d, %Y")
    except Exception:
        exp_label = expiry

    SEP     = "border-left:3px solid #333"
    BASE_TD = "padding:1px 8px;font-size:11px;font-family:'Courier New',monospace;border-bottom:1px solid #141414"
    TH      = "background:#0d0d0d;padding:4px 8px;position:sticky;top:0;z-index:3;border-bottom:1px solid #2a2a2a;white-space:nowrap"

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
        strikes = sorted([s for s in gex_map if lo <= s <= hi], reverse=True)[:max_rows]
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
        return "<p style='color:#888'>No data for selected expiry.</p>"

    # header rows
    rowA = ""; rowB = ""; rowC = ""
    for i, p in enumerate(panels):
        sep = f";{SEP}" if i > 0 else ""
        chg_c = "#00cc44" if p["chg"] >= 0 else "#ff4444"
        arr   = "+" if p["chg"] >= 0 else ""
        net_c = "#00cc44" if p["net"] >= 0 else "#ff4444"
        zg_s  = f"${p['zg']:.2f}" if p["zg"] else "—"
        rowA += (
            f"<th colspan='2' style='{TH};text-align:left{sep}'>"
            f"<span style='font-size:15px;font-weight:800;color:#fff'>{p['sym']}</span>"
            f"&nbsp;&nbsp;<span style='font-size:14px;color:#fff'>${p['lp']:.2f}</span>"
            f"&nbsp;<span style='font-size:11px;color:{chg_c}'>{arr}{p['chg']:.2f} ({arr}{p['chg_p']:.2f}%)</span>"
            f"</th>"
        )
        rowB += (
            f"<th colspan='2' style='{TH};font-size:9px;font-weight:400;color:#666;text-align:left{sep}'>"
            f"<span style='color:#888'>{exp_label}</span>"
            f"&nbsp;&nbsp;ZG <span style='color:#aaa'>{zg_s}</span>"
            f"&nbsp;&nbsp;Net <span style='color:{net_c};font-weight:700'>{_fmt_gex(p['net'])}</span>"
            f"</th>"
        )
        col_th = f"{TH};font-size:9px;font-weight:700;color:#555;border-bottom:2px solid #2a2a2a"
        rowC += (
            f"<th style='{col_th};text-align:left{sep}'>STRIKE</th>"
            f"<th style='{col_th};text-align:right;min-width:100px'>GEX</th>"
        )

    thead = f"<thead><tr>{rowA}</tr><tr>{rowB}</tr><tr>{rowC}</tr></thead>"

    max_len   = max(len(p["strikes"]) for p in panels)
    rows_html = ""
    for row_i in range(max_len):
        cells = ""
        for i, p in enumerate(panels):
            sep = f";{SEP}" if i > 0 else ""
            strikes = p["strikes"]
            if row_i >= len(strikes):
                cells += f"<td style='background:#0a0a0a;{BASE_TD}{sep}'></td><td style='background:#0a0a0a;{BASE_TD}'></td>"
                continue
            strike   = strikes[row_i]
            v        = p["gex_map"].get(strike, 0)
            is_spot  = (strike == p["nearest_spot"])
            is_king  = (strike == p["king_strike"])
            cell_bg  = _heat_bg(v, p["vmax"])
            fg       = _fg(cell_bg)
            sk_bg    = "#1a1400" if is_spot else "#0a0a0a"
            sk_col   = "#ffd700" if is_spot else "#aaaaaa"
            sk_wt    = "font-weight:800" if is_spot else ""
            sk_bdr   = "border-top:1px solid #ffd700;border-bottom:1px solid #ffd700" if is_spot else ""
            marker   = "<span style='color:#ffd700;margin-right:2px'>&#9658;</span>" if is_spot else ""
            badge    = ""
            if p["vmax"] > 0 and abs(v) >= 0.10 * p["vmax"]:
                pct = int(round(v / p["vmax"] * 100))
                bc  = "#00cc44" if pct > 0 else "#ff4444"
                badge = f"<span style='background:{bc};color:#000;font-size:7px;font-weight:700;border-radius:3px;padding:0 3px;margin-right:2px;vertical-align:middle'>{pct:+d}%</span>"
            star = "<span style='color:#ffd700;font-size:10px;margin-left:2px'>&#9733;</span>" if is_king else ""
            cells += (
                f"<td style='background:{sk_bg};color:{sk_col};{sk_wt};{BASE_TD};text-align:left;{sk_bdr}{sep}'>"
                f"{marker}{strike:.1f}</td>"
                f"<td style='background:{cell_bg};color:{fg};{BASE_TD};text-align:right;{sk_bdr}'>"
                f"{badge}{_fmt_cell(v) if v != 0 else ''}{star}</td>"
            )
        rows_html += f"<tr>{cells}</tr>"

    return (
        "<style>.gex-b-wrap{overflow-x:auto;overflow-y:auto;max-height:640px;"
        "border-radius:6px;border:1px solid #222;background:#0a0a0a}"
        ".gex-b{border-collapse:collapse;width:100%;font-family:'Courier New',monospace}"
        ".gex-b tbody tr:hover td{filter:brightness(1.4)}</style>"
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
#  Presets
# ──────────────────────────────────────────────

_PRESETS: dict = {
    "— custom —": [],
    "Index ETFs  (SPY · QQQ · IWM)": ["SPY", "QQQ", "IWM"],
    "Mag-7": ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"],
    "Volatility": ["SPY", "SPX", "VIX"],
}


# ──────────────────────────────────────────────
#  Main page
# ──────────────────────────────────────────────

def render_gamma_exposure_page() -> None:
    st.markdown(
        "<h2 style='color:#e0e0e0;margin-bottom:4px'>Gamma Exposure (GEX)</h2>"
        "<p style='color:#888;font-size:12px;margin-top:0'>Dealer net gamma by strike — "
        "green = dealers long gamma (pinning), red = dealers short gamma (amplifying)</p>",
        unsafe_allow_html=True,
    )

    col_preset, col_input, col_btn = st.columns([2, 3, 1])
    with col_preset:
        preset_choice = st.selectbox(
            "Preset", list(_PRESETS.keys()), key="gex_preset", label_visibility="collapsed"
        )
    with col_input:
        default_tickers = ", ".join(_PRESETS[preset_choice]) if _PRESETS[preset_choice] else "SPY"
        raw_input = st.text_input(
            "Tickers", value=default_tickers, key="gex_tickers",
            placeholder="e.g. SPY QQQ IWM  — space or comma separated, up to 5",
            label_visibility="collapsed",
            help="Type up to 5 ticker symbols separated by spaces or commas. "
                 "Each ticker appears as its own panel in the Strike Table for side-by-side comparison.",
        )
    with col_btn:
        fetch = st.button("Refresh", use_container_width=True, key="gex_fetch")

    tickers = [t.strip().upper() for t in raw_input.replace(",", " ").split() if t.strip()][:5]
    if not tickers:
        st.info("Enter at least one ticker symbol.")
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

    for e in errors:
        st.warning(e)

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
                    f"<div style='background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;"
                    f"padding:12px 14px;'>"
                    # ticker + spot
                    f"<div style='display:flex;justify-content:space-between;align-items:baseline'>"
                    f"<span style='font-size:20px;font-weight:800;color:#fff;letter-spacing:1px'>{sym}</span>"
                    f"<span style='font-size:22px;font-weight:700;color:#fff'>${spot:.2f}</span>"
                    f"</div>"
                    # daily change
                    f"<div style='margin-top:2px'>"
                    f"<span style='font-size:13px;font-weight:700;color:{chg_c}'>"
                    f"{chg_arrow}{chg:.2f} ({chg_arrow}{chg_p:.2f}%)</span>"
                    f"<span style='font-size:10px;color:#555;margin-left:8px'>today</span>"
                    f"</div>"
                    # high / low / volume
                    f"<div style='display:flex;gap:12px;margin-top:6px;font-size:10px;color:#666'>"
                    f"<span>H&nbsp;<b style='color:#aaa'>${hi:.2f}</b></span>"
                    f"<span>L&nbsp;<b style='color:#aaa'>${lo:.2f}</b></span>"
                    f"<span>Vol&nbsp;<b style='color:#aaa'>{vol_s}</b></span>"
                    f"</div>"
                    # divider
                    f"<div style='border-top:1px solid #1e1e1e;margin:8px 0'></div>"
                    # GEX stats
                    f"<div style='display:flex;justify-content:space-between;font-size:10px'>"
                    f"<div>"
                    f"<div style='color:#555'>Regime</div>"
                    f"<div style='color:{rc};font-weight:700;font-size:11px'>{rl}</div>"
                    f"</div>"
                    f"<div>"
                    f"<div style='color:#555'>Net GEX</div>"
                    f"<div style='color:#ffe066;font-weight:700;font-size:11px'>{_fmt_gex(net)}</div>"
                    f"</div>"
                    f"<div>"
                    f"<div style='color:#555'>Zero Gamma</div>"
                    f"<div style='color:#aaa;font-size:11px'>{zg_s}</div>"
                    f"</div>"
                    f"</div>"
                    # call / put walls
                    f"<div style='display:flex;gap:14px;margin-top:6px;font-size:10px'>"
                    f"<span style='color:#555'>Call Wall&nbsp;<b style='color:#00cc44'>${mcw:.0f}</b></span>" if mcw else ""
                    f"<span style='color:#555'>Put Wall&nbsp;<b style='color:#ff4444'>${mpw:.0f}</b></span>" if mpw else ""
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

            if not is_multi:
                # ── MODE A: single ticker — expiries as columns ────────────
                st.caption("Single ticker — select one or more expiries to show as columns.")
                ctrl_left, ctrl_right = st.columns([3, 1])
                with ctrl_left:
                    # seed session state only on first visit so removals aren't overridden
                    if "gex_exp_filter" not in st.session_state:
                        st.session_state["gex_exp_filter"] = (
                            all_expiries[:4] if len(all_expiries) >= 4 else list(all_expiries)
                        )
                    # keep only expiries that are still valid options
                    st.session_state["gex_exp_filter"] = [
                        e for e in st.session_state["gex_exp_filter"] if e in all_expiries
                    ]
                    selected_expiries = st.multiselect(
                        "Expiries (columns)",
                        options=all_expiries,
                        key="gex_exp_filter",
                        placeholder="Select one or more expiry dates…",
                    )
                with ctrl_right:
                    max_rows = st.slider("Max strikes", 40, 200, 80, step=10, key="gex_maxrows")

                expiry_filter = selected_expiries if selected_expiries else None
                st.markdown(
                    _single_ticker_table_html(valid[0], max_rows=max_rows, expiry_filter=expiry_filter),
                    unsafe_allow_html=True,
                )

            else:
                # ── MODE B: multi-ticker — one expiry, panels side by side ─
                st.caption("Multiple tickers — select one expiry to compare all tickers side by side.")
                ctrl_left, ctrl_right = st.columns([3, 1])
                with ctrl_left:
                    selected_expiry = st.selectbox(
                        "Expiry for comparison",
                        options=all_expiries,
                        index=0,
                        key="gex_cmp_expiry",
                    )
                with ctrl_right:
                    max_rows = st.slider("Max strikes", 40, 200, 80, step=10, key="gex_maxrows")

                st.markdown(
                    _compare_table_html(valid, expiry=selected_expiry, max_rows=max_rows),
                    unsafe_allow_html=True,
                )

            st.markdown(
                "<div style='margin-top:8px;font-size:10px;color:#555'>"
                "Green = dealer <b>long gamma</b> &nbsp;|&nbsp; "
                "Red = dealer <b>short gamma</b> &nbsp;|&nbsp; "
                "<span style='color:#ffd700'>&#9658;</span> = <b>current spot</b> &nbsp;|&nbsp; "
                "<span style='color:#ffd700'>&#9733;</span> = <b>King Node</b>"
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
            "<p style='color:#888;font-size:12px;margin-bottom:12px'>"
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
                            f"<div style='background:#0d0d0d;border:1px solid #2a2a2a;"
                            f"border-radius:8px;padding:12px 14px;margin-bottom:10px'>"
                            f"<div style='display:flex;justify-content:space-between;align-items:baseline'>"
                            f"<span style='font-size:20px;font-weight:800;color:#fff'>{sym}</span>"
                            f"<span style='font-size:20px;font-weight:700;color:#fff'>${spot:.2f}</span>"
                            f"</div>"
                            f"<div style='font-size:13px;font-weight:700;color:{chg_c};margin-top:2px'>"
                            f"{arr}{chg:.2f} ({arr}{chg_p:.2f}%)</div>"
                            f"<div style='display:flex;gap:10px;margin-top:5px;font-size:10px;color:#666'>"
                            f"<span>H <b style='color:#aaa'>${hi:.2f}</b></span>"
                            f"<span>L <b style='color:#aaa'>${lo:.2f}</b></span>"
                            f"<span>Vol <b style='color:#aaa'>{vol_s}</b></span>"
                            f"</div>"
                            f"<div style='border-top:1px solid #1e1e1e;margin:7px 0'></div>"
                            f"<div style='display:flex;justify-content:space-between;font-size:10px'>"
                            f"<div><div style='color:#555'>Regime</div>"
                            f"<div style='color:{rc};font-weight:700'>{rl}</div></div>"
                            f"<div><div style='color:#555'>Net GEX</div>"
                            f"<div style='color:#ffe066;font-weight:700'>{_fmt_gex(net)}</div></div>"
                            f"<div><div style='color:#555'>Zero Gamma</div>"
                            f"<div style='color:#aaa'>{zg_s}</div></div>"
                            f"</div>"
                            f"<div style='display:flex;gap:12px;margin-top:5px;font-size:10px'>"
                            + (f"<span style='color:#555'>Call Wall <b style='color:#00cc44'>${mcw:.0f}</b></span>" if mcw else "")
                            + (f"<span style='color:#555'>Put Wall <b style='color:#ff4444'>${mpw:.0f}</b></span>" if mpw else "")
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
                                        f"<div style='background:#1a1400;border:1px solid #ffd700;"
                                        f"border-radius:5px;padding:6px 12px;font-size:11px'>"
                                        f"<span style='color:#ffd700;font-weight:700'>King Node</span>"
                                        f"&nbsp;&nbsp;"
                                        f"<span style='color:#fff;font-size:13px;font-weight:700'>${king_s:.0f}</span>"
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
                        "font-size:12px;font-weight:700;color:#888;letter-spacing:1px'>"
                        "STRIKE TABLE</div>",
                        unsafe_allow_html=True,
                    )
                    st.markdown(
                        _compare_table_html(cmp_valid, expiry=selected_cmp_exp, max_rows=80),
                        unsafe_allow_html=True,
                    )
                    st.markdown(
                        "<div style='margin-top:6px;font-size:10px;color:#555'>"
                        "Green = dealer <b>long gamma</b> &nbsp;|&nbsp; "
                        "Red = dealer <b>short gamma</b> &nbsp;|&nbsp; "
                        "<span style='color:#ffd700'>&#9658;</span> = spot &nbsp;|&nbsp; "
                        "<span style='color:#ffd700'>&#9733;</span> = King Node"
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
