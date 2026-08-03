#!/usr/bin/env python3
"""Render the README graphics from the design tokens in design/direction.md.

Everything here is drawn with the same devices as the running dashboard —
square nodes, laid and unlaid track, corner ticks, the leading marker — so the
README shows the product's own instrument language rather than a generic banner.

Type is set in the real faces (Chakra Petch for the wordmark, IBM Plex for
everything else) and written out as outlines: GitHub renders README images in a
sandbox that will not load a webfont, so live <text> would fall back to a
system face and the wordmark would stop being the wordmark.

    python3 design/render.py        # rewrites design/banner.svg, design/matrix.svg

Needs `pip install fonttools uharfbuzz` and network access on first run (the
fonts are downloaded to design/.fonts/, which is gitignored).
"""

from __future__ import annotations

import urllib.request
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".fonts"

# Pinned Google Fonts binaries — the same faces next/font fetches at build time.
FONTS = {
    "display": "chakrapetch/v13/cIflMapbsEk7TDLdtEz1BwkeQI5FQA.ttf",
    "sans": "ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD6llzAA.ttf",
    "sans-medium": "ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD2FlzAA.ttf",
    "mono": "ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n5ig.ttf",
    "mono-medium": "ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJ8lc.ttf",
}

# design/direction.md
VOID, SURFACE, SURFACE_2, SURFACE_3 = "#07090C", "#0F151B", "#171F27", "#212C36"
INK, DIM, SIGNAL = "#EDF1F6", "#8C99A8", "#FF7F6E"
ENV = ["#5BE0D0", "#F5B655", "#FF7F6E"]  # information → caution → critical


# ── type ────────────────────────────────────────────────────────────────────


@lru_cache(maxsize=None)
def font(role: str):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / FONTS[role].split("/")[-1]
    if not path.exists():
        urllib.request.urlretrieve(f"https://fonts.gstatic.com/s/{FONTS[role]}", path)
    blob = hb.Blob.from_file_path(str(path))
    face = hb.Face(blob)
    tt = TTFont(str(path))
    return hb.Font(face), face.upem, tt.getGlyphOrder(), tt.getGlyphSet()


def shape(role, text):
    hbfont, upem, order, glyphs = font(role)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf)
    return buf, upem, order, glyphs


def width(role, text, size, tracking=0.0):
    buf, upem, _, _ = shape(role, text)
    units = sum(p.x_advance for p in buf.glyph_positions)
    return units * size / upem + tracking * size * max(0, len(buf.glyph_infos) - 1)


def text(role, s, size, x, y, fill=INK, tracking=0.0, anchor="start", opacity=None):
    """A string as an SVG path, baseline at (x, y)."""
    buf, upem, order, glyphs = shape(role, s)
    if anchor == "middle":
        x -= width(role, s, size, tracking) / 2
    elif anchor == "end":
        x -= width(role, s, size, tracking)

    scale = size / upem
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
    cursor = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        glyphs[order[info.codepoint]].draw(
            # Fonts are y-up, SVG is y-down.
            TransformPen(
                pen,
                Transform(scale, 0, 0, -scale, x + (cursor + pos.x_offset) * scale, y - pos.y_offset * scale),
            )
        )
        cursor += pos.x_advance
        x += tracking * size

    op = f' opacity="{opacity}"' if opacity is not None else ""
    return f'<path d="{pen.getCommands()}" fill="{fill}"{op}/>'


def eyebrow(s, size, x, y, fill=DIM, anchor="start"):
    """11px-scale uppercase label, 0.16em — the interface's labelling voice."""
    return text("sans-medium", s.upper(), size, x, y, fill, tracking=0.16, anchor=anchor)


# ── the instrument devices ──────────────────────────────────────────────────


def ticks(x, y, w, h, arm=12, weight=2, opacity=0.85):
    """Corner ticks: framing without containment."""
    d = (
        f"M{x} {y + arm}V{y}H{x + arm}"  # top-left
        f"M{x + w} {y + h - arm}V{y + h}H{x + w - arm}"  # bottom-right
    )
    return (
        f'<path d="{d}" fill="none" stroke="{SIGNAL}" stroke-width="{weight}" '
        f'opacity="{opacity}"/>'
    )


def grid(w, h, step=46, opacity=0.03):
    """The faint ruling of an instrument face."""
    lines = "".join(f"M0 {y}H{w}" for y in range(step, h, step))
    lines += "".join(f"M{x} 0V{h}" for x in range(step, w, step))
    return f'<path d="{lines}" stroke="{INK}" stroke-width="1" opacity="{opacity}"/>'


def laid(x1, x2, y, color, weight=3):
    """Track the flag has reached: solid, finely notched like a ruler."""
    return (
        f'<path d="M{x1} {y}H{x2}" stroke="{color}" stroke-width="{weight}"/>'
        f'<path d="M{x1} {y}H{x2}" stroke="#000" stroke-width="{weight}" '
        f'stroke-dasharray="1 12" opacity="0.45"/>'
    )


def ahead(x1, x2, y):
    """Track it has not: thin, sparse, sitting well back."""
    return (
        f'<path d="M{x1} {y}H{x2}" stroke="{DIM}" stroke-width="1" '
        f'stroke-dasharray="2 6" opacity="0.55"/>'
    )


def node(cx, cy, size, color, state):
    """Square node. Colour means live; neutral means promoted but off;
    hatched means the flag has not reached this environment at all."""
    h = size / 2
    x, y = cx - h, cy - h
    if state == "absent":
        return (
            f'<rect x="{x + 0.5}" y="{y + 0.5}" width="{size - 1}" height="{size - 1}" '
            f'fill="url(#hatch)" stroke="{DIM}" stroke-opacity="0.42" stroke-width="1"/>'
        )
    if state == "off":
        return (
            f'<rect x="{x}" y="{y}" width="{size}" height="{size}" fill="{SURFACE_3}"/>'
            f'<rect x="{x + 1}" y="{y + 1}" width="{size - 2}" height="{size - 2}" '
            f'fill="none" stroke="{DIM}" stroke-width="2"/>'
        )
    return (
        f'<rect x="{x - 2}" y="{y - 2}" width="{size + 4}" height="{size + 4}" '
        f'fill="{color}" opacity="0.45" filter="url(#glow)"/>'
        f'<rect x="{x - 3}" y="{y - 3}" width="{size + 6}" height="{size + 6}" '
        f'fill="none" stroke="{VOID}" stroke-width="6"/>'
        f'<rect x="{x - 4}" y="{y - 4}" width="{size + 8}" height="{size + 8}" '
        f'fill="none" stroke="{color}" stroke-width="2" opacity="0.3"/>'
        f'<rect x="{x}" y="{y}" width="{size}" height="{size}" fill="{color}"/>'
    )


def rail(stops, xs, cy, size):
    """One flag's journey: a line whose solid portion is how far it has reached.

    Each half-segment takes its own stop's colour, exactly as the CSS does, so
    the frontier — laid arriving, unlaid departing — falls on a single node.
    """
    out = []
    for i, x in enumerate(xs[:-1]):
        nxt = i + 1
        mid = (x + xs[nxt]) / 2
        reached = stops[nxt] != "absent"
        out.append(laid(x, mid, cy, ENV[i]) if reached else ahead(x, mid, cy))
        out.append(laid(mid, xs[nxt], cy, ENV[nxt]) if reached else ahead(mid, xs[nxt], cy))
    for i, (stop, x) in enumerate(zip(stops, xs)):
        out.append(node(x, cy, size, ENV[i], stop))
    return "".join(out)


DEFS = f"""<defs>
<filter id="glow" x="-150%" y="-150%" width="400%" height="400%">
<feGaussianBlur stdDeviation="5"/>
</filter>
<pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
<rect width="1" height="4" fill="{DIM}" opacity="0.5"/>
</pattern>
<linearGradient id="pipeline" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="{ENV[0]}"/><stop offset="0.5" stop-color="{ENV[1]}"/>
<stop offset="1" stop-color="{ENV[2]}"/>
</linearGradient>
</defs>"""


def svg(w, h, body, title, desc):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" '
        f'height="{h}" role="img" aria-labelledby="t d">'
        f"<title id=\"t\">{title}</title><desc id=\"d\">{desc}</desc>"
        f"{DEFS}{body}</svg>\n"
    )


# ── banner ──────────────────────────────────────────────────────────────────


def banner():
    W, H = 1000, 350
    envs = ["dev", "qa", "prod"]
    xs = [250, 500, 750]
    stops = ["on", "on", "absent"]  # promoted to qa, live in dev and qa
    cy = 252

    body = [
        f'<rect width="{W}" height="{H}" fill="{VOID}"/>',
        grid(W, H),
        ticks(30, 30, W - 60, H - 60),
        eyebrow("Feature flag console", 11, W / 2, 66, DIM, anchor="middle"),
        text("display", "CEREBRO", 84, W / 2, 138, INK, tracking=0.22, anchor="middle"),
        text(
            "sans",
            "Self-hosted feature flags, promoted through an ordered pipeline",
            18,
            W / 2,
            180,
            DIM,
            anchor="middle",
        ),
        # The signature: the one point where laid track becomes dotted.
        eyebrow("Frontier", 10.5, xs[1], 218, SIGNAL, anchor="middle"),
        f'<path d="M{xs[1]} 226V240" stroke="{SIGNAL}" stroke-width="1" opacity="0.55"/>',
        rail(stops, xs, cy, 16),
    ]
    for i, key in enumerate(envs):
        body.append(eyebrow(f"{i:02d} {key}", 12.5, xs[i], 292, ENV[i], anchor="middle"))
    body += [
        f'<path d="M100 314H900" stroke="{INK}" stroke-width="1" opacity="0.07"/>',
        text("mono", "self-hosted · mit", 13, 100, 336, DIM),
        text("mono", "bun · hono · postgres 16 · next.js 15", 13, 900, 336, DIM, anchor="end"),
    ]
    return svg(
        W,
        H,
        "".join(body),
        "Cerebro",
        "The Cerebro wordmark above a promotion rail: a flag laid through dev and qa, "
        "live in both, with the frontier at qa and prod still ahead.",
    )


# ── flag matrix ─────────────────────────────────────────────────────────────

ROWS = [
    # key, name, per-environment (state, readout)
    ("new-checkout", "New checkout flow", [("on", "true"), ("on", "true"), ("off", "off")]),
    ("max-cart-items", "Items per cart", [("on", "12"), ("on", "8"), ("absent", "not promoted")]),
    (
        "banner-copy",
        "Homepage banner",
        [("on", "Summer sale"), ("off", "off"), ("absent", "not promoted")],
    ),
    (
        "beta-dashboard",
        "Redesigned dashboard",
        [("off", "off"), ("absent", "not promoted"), ("absent", "not promoted")],
    ),
]


def matrix():
    W = 1000
    head, row_h = 82, 86
    H = head + row_h * len(ROWS) + 14
    left, track = 380, 970
    span = (track - left) / 3
    xs = [left + span * (i + 0.5) for i in range(3)]

    body = [
        f'<rect width="{W}" height="{H}" fill="{SURFACE}"/>',
        eyebrow("Flag", 12.5, 40, 52),
    ]
    for i, key in enumerate(["dev", "qa", "prod"]):
        body.append(eyebrow(f"{i:02d} {key}", 12.5, xs[i], 52, ENV[i], anchor="middle"))
    # The header states the pipeline once: order, and direction.
    inset = (track - left) * 0.14
    body.append(
        f'<rect x="{left + inset}" y="{head - 4}" width="{track - left - inset * 2}" '
        f'height="2" fill="url(#pipeline)" opacity="0.55"/>'
    )

    for r, (key, name, stops) in enumerate(ROWS):
        y = head + r * row_h
        cy = y + 38
        live = any(state == "on" for state, _ in stops)
        if r % 2:
            body.append(f'<rect y="{y}" width="{W}" height="{row_h}" fill="{SURFACE_2}"/>')
        if live:
            # A leading signal bar, the way a HUD marks the live row.
            body.append(
                f'<rect x="20" y="{y + row_h * 0.19}" width="3.5" '
                f'height="{row_h * 0.62}" fill="{SIGNAL}"/>'
            )
        body += [
            text("mono-medium", key, 17, 42, y + 36, INK),
            text("sans", name, 14.5, 42, y + 58, DIM),
            rail([s for s, _ in stops], xs, cy, 16),
        ]
        for i, (state, readout) in enumerate(stops):
            body.append(
                text(
                    "mono",
                    readout,
                    13,
                    xs[i],
                    cy + 32,
                    ENV[i] if state == "on" else DIM,
                    anchor="middle",
                    opacity=None if state == "on" else 0.85,
                )
            )

    body.append(ticks(10, 10, W - 20, H - 20, arm=10, weight=2))
    return svg(
        W,
        H,
        "".join(body),
        "The flag matrix",
        "Four flags as rails across dev, qa and prod. Solid track is where each flag has "
        "been promoted, dotted track is where it has not, and a lit node means it is live "
        "there. A signal bar marks every flag that is on somewhere.",
    )


if __name__ == "__main__":
    (HERE / "banner.svg").write_text(banner())
    (HERE / "matrix.svg").write_text(matrix())
    print("wrote design/banner.svg and design/matrix.svg")
