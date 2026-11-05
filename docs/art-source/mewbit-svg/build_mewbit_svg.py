"""Builds web/public/character/mewbit.svg, the rigged 2D cartoon MewBit.

Left-side parts are authored once and mirrored for the right side. Every
movable part is its own <g id="..."> with a transform-origin at its joint,
so CSS or JS can rotate/scale it without touching the paths.
"""
import re
from pathlib import Path

W = 420
OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "character" / "mewbit.svg"

LINE = "#1a1424"
SKIN = "#f9e2da"
SKIN_SHADE = "#e6bdb8"
CLOTH = "#1c1928"
CLOTH_DARK = "#110f18"
CLOTH_LIGHT = "#2a2638"
STOCKING = "#24202f"
METAL = "#b9b6c6"
CYAN = "#2de2ff"
MAGENTA = "#ff3fd0"


def fmt(v):
    return str(int(v)) if v == int(v) else f"{v:.1f}"


def mirror(d):
    """Mirror an absolute-coordinate path (M L C Q H V Z) across x = W/2."""
    out, cmd, idx = [], None, 0
    for t in re.findall(r"[A-Za-z]|-?\d*\.?\d+", d):
        if t.isalpha():
            cmd, idx = t, 0
            out.append(t)
            continue
        v = float(t)
        if (cmd in "MLCQ" and idx % 2 == 0) or cmd == "H":
            v = W - v
        idx += 1
        out.append(fmt(v))
    return " ".join(out)


def origin(x, y):
    return f'style="transform-origin:{fmt(x)}px {fmt(y)}px"'


class Side:
    def __init__(self, s):
        self.s = s
        self.r = s == "r"

    def d(self, path):
        return mirror(path) if self.r else path

    def x(self, x):
        return W - x if self.r else x


def p(d, fill="none", cls="o", extra=""):
    c = f' class="{cls}"' if cls else ""
    return f'<path{c} d="{d}" fill="{fill}"{extra and " " + extra}/>'


def neon(d, color, width=2.2):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" filter="url(#glow)"/>'


def line(d, color=LINE, width=1.5, extra=""):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"{extra and " " + extra}/>'


# ---------------------------------------------------------------- hair back

def hair_back():
    d = ("M210,48 C150,48 128,92 130,150 C132,210 120,280 112,350 C108,400 100,440 92,470 "
         "L112,458 L118,486 L136,462 L146,480 L160,440 L170,300 L250,300 L260,440 L274,480 "
         "L284,462 L302,486 L308,458 L328,470 C320,440 312,400 308,350 C300,280 288,210 290,150 "
         "C292,92 270,48 210,48 Z")
    parts = [p(d, "url(#hairBack)")]
    left = Side("l")
    for s, color, alt in ((Side("l"), MAGENTA, "#9b5cff"), (Side("r"), CYAN, "#3a7bff")):
        parts.append(neon(s.d("M128,240 C122,320 114,400 104,462"), color, 2.6))
        parts.append(neon(s.d("M142,300 C138,360 132,420 126,470"), alt, 2))
        parts.append(line(s.d("M148,200 C146,260 150,330 156,420"), "#2c2450", 1.6))
    del left
    return f'<g id="hair-back" data-follows="head" {origin(210, 192)}>\n  ' + "\n  ".join(parts) + "\n</g>"


# ---------------------------------------------------------------- legs

# slight A-stance: hip at the crotch line, knee and ankle drift outward
THIGH = "M158,366 L210,366 C210,430 202,520 195,588 L165,588 C158,520 150,440 158,366 Z"
SHIN = ("M164,580 L196,580 C200,616 197,652 191,690 C188,714 186,734 185,750 "
        "L170,750 C169,734 166,714 163,690 C157,652 159,616 164,580 Z")


def rect(s, x, y, w, h, **attrs):
    """A rect authored for the left side; mirrored as a whole for the right."""
    extra = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<rect x="{fmt(W - x - w if s.r else x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}"{extra}/>'


def boot(s):
    d = s.d
    return "\n      ".join([
        f'<g id="boot-{s.s}">',
        p(d("M158,682 L198,682 L201,846 L155,846 Z"), CLOTH),
        line(d("M170,698 L186,704 L170,710 M170,738 L186,744 L170,750 M170,780 L186,786 L170,792 M170,808 L186,814 L170,820"), "#3a3550", 1.6),
        p(d("M156,718 L200,718 L200,730 L156,730 Z"), CLOTH_DARK),
        rect(s, 186, 719, 8, 10, rx=1, class_="metal"),
        p(d("M155,760 L201,760 L201,772 L155,772 Z"), "#c42fa8"),
        p(d("M153,674 L203,674 L203,690 L153,690 Z"), CLOTH_LIGHT),
        neon(d("M156,682 H200"), CYAN, 2),
        p(d("M142,886 C138,856 154,838 176,838 C198,838 214,856 210,886 Z"), CLOTH),
        f'<ellipse cx="{fmt(s.x(176))}" cy="853" rx="14" ry="5" fill="#332d48"/>',
        neon(d("M146,870 C150,858 156,850 164,846"), CYAN, 2),
        rect(s, 138, 880, 76, 18, rx=5, fill="#8d8a9a", class_="o"),
        rect(s, 140, 891, 72, 5, rx=2, fill="#5e5b6b"),
        line(d("M141,883 H211"), MAGENTA, 1.6),
        "</g>",
    ])


def leg(s):
    d, x = s.d, s.x
    stocking_top = 420 if s.r else 470
    clip = f"clip-thigh-{s.s}"
    thigh_extra = []
    if s.r:
        # garter from the shorts hem to the stocking
        thigh_extra += [line(d("M166,402 L167,424"), CLOTH_DARK, 3), f'<circle class="metal" cx="{fmt(x(166.5))}" cy="413" r="3"/>']
    else:
        thigh_extra += [
            f'<g clip-path="url(#{clip})"><rect x="140" y="436" width="80" height="10" fill="{CLOTH_DARK}"/></g>',
            f'<rect class="metal" x="194" y="437" width="7" height="8" rx="1"/>',
            f'<circle class="metal" cx="184" cy="452" r="5"/>',
        ]
    return f"""<g id="leg-{s.s}">
  <clipPath id="{clip}"><path d="{d(THIGH)}"/></clipPath>
  <g id="thigh-{s.s}" {origin(x(184), 372)}>
    <g id="shin-{s.s}" {origin(x(180), 586)}>
      {p(d(SHIN), STOCKING)}
      {p(d("M188,592 C194,624 192,660 186,690 L180,690 C186,660 188,624 184,592 Z"), "#2f2a3e", "")}
      <ellipse cx="{fmt(x(180))}" cy="596" rx="9" ry="5" fill="#38324d"/>
      {boot(s)}
    </g>
    {p(d(THIGH), SKIN)}
    <g clip-path="url(#{clip})">
      {p(d("M198,366 C202,420 198,500 192,588 L212,588 L212,366 Z"), SKIN_SHADE, "")}
      {rect(s, 140, stocking_top, 80, 230, fill=STOCKING)}
      {p(d(f"M196,{stocking_top} C198,500 194,550 190,588 L212,588 L212,{stocking_top} Z"), "#2f2a3e", "")}
      {rect(s, 140, stocking_top, 80, 9, fill="#332e44")}
      {line(d(f"M140,{stocking_top + 9} H220"), CYAN, 1.4)}
    </g>
    {p(d(THIGH))}
    {"".join(thigh_extra)}
  </g>
</g>"""


# ---------------------------------------------------------------- torso, hips, jacket

def torso():
    return f"""<g id="torso" {origin(210, 330)}>
  {p("M198,178 L222,178 L224,222 L196,222 Z", SKIN)}
  {p("M198,186 Q210,198 222,186 L222,202 Q210,210 198,202 Z", SKIN_SHADE, "")}
  {p("M196,212 L224,212 C232,222 252,224 268,228 C280,232 284,246 280,260 L270,266 C268,286 258,304 250,322 C252,336 258,348 262,362 L158,362 C162,348 168,336 170,322 C162,304 152,286 150,266 L140,260 C136,246 140,232 152,228 C168,224 188,222 196,212 Z", SKIN)}
  {p("M164,302 C188,308 232,308 256,302 L254,312 C232,316 188,316 166,312 Z", SKIN_SHADE, "", 'opacity="0.8"')}
  {line("M209,322 Q210,325 211,322", "#c99a96", 1.4)}
  {p("M176,224 L188,219 C192,238 200,248 210,248 C220,248 228,238 232,219 L244,224 C256,236 268,250 268,266 C268,280 262,292 258,302 C232,308 188,308 162,302 C158,292 152,280 152,266 C152,250 164,236 176,224 Z", CLOTH)}
  {p("M156,262 C156,280 160,292 164,300 L172,301 C166,290 164,276 166,256 Z", CLOTH_DARK, "")}
  {line("M163,297 C188,303 232,303 257,297", MAGENTA, 1.6)}
  <path d="M203,262 L217,262 L210,273 Z" fill="{MAGENTA}" filter="url(#glow)"/>
  <g id="choker">
    {p("M196,200 C204,203 216,203 224,200 L224,210 C216,213 204,213 196,210 Z", CLOTH_DARK)}
    <rect class="metal" x="205" y="201.5" width="10" height="8" rx="1" stroke-width="1.6"/>
    <circle class="metal" cx="210" cy="217" r="3.5" stroke-width="1.6"/>
    <path d="M206.5,221 L213.5,221 L210,228 Z" fill="{METAL}"/>
  </g>
</g>"""


def hips():
    sh = "M170,330 L250,330 C254,344 260,356 262,372 L264,402 L220,408 L210,382 L200,408 L156,402 L158,372 C160,356 166,344 170,330 Z"
    cuff = "M156,392 L202,398 L200,408 L156,402 Z"
    pocket = "M172,346 C182,352 188,362 190,374"
    return f"""<g id="hips" {origin(210, 370)}>
  {p(sh, "#1e1b2a")}
  {p(cuff, "#141220")}{p(mirror(cuff), "#141220")}
  {line("M210,346 L210,382 " + pocket + " " + mirror(pocket), "#3a3550", 1.5)}
  {p("M168,328 L252,328 L253,342 L167,342 Z", CLOTH_DARK)}
  <rect class="metal" x="201" y="326" width="18" height="18" rx="2" stroke-width="2.4"/>
  {line("M210,330 V340", METAL, 2)}
  <circle class="metal" cx="176" cy="350" r="5"/>
  {line("M244,342 L250,380", CLOTH_DARK, 4)}
  <circle class="metal" cx="250" cy="385" r="5"/>
</g>"""


def jacket_front():
    out = []
    for s in (Side("l"), Side("r")):
        d = s.d
        out += [
            p(d("M166,280 C172,300 176,340 176,370 L178,394 L146,398 C142,370 146,330 152,300 Z"), CLOTH),
            neon(d("M169,292 C174,320 175,350 176,388"), CYAN, 2),
            p(d("M145,388 L178,386 L178,398 L146,400 Z"), "#231f30"),
        ]
    return '<g id="jacket-front">\n  ' + "\n  ".join(out) + "\n</g>"


# ---------------------------------------------------------------- arms

def arm(s):
    d, x = s.d, s.x
    ribs = " ".join(f"M{x}," + "422 V438" for x in range(121, 153, 5))
    return f"""<g id="arm-{s.s}" {origin(x(150), 240)}>
  {p(d("M146,230 C132,236 126,252 128,272 C130,300 134,320 134,342 L154,342 C156,318 162,292 164,266 C166,244 160,230 146,230 Z"), SKIN)}
  {p(d("M118,272 C130,262 158,262 170,272 C172,298 166,322 162,346 L120,350 C114,324 114,298 118,272 Z"), CLOTH)}
  {neon(d("M119,290 C116,310 116,330 119,346"), CYAN, 2)}
  {neon(d("M156,286 C156,306 154,322 152,340"), MAGENTA, 2.6)}
  {p(d("M116,268 C130,258 158,258 172,268 L172,280 C158,270 130,270 114,282 Z"), "#231f30")}
  {neon(d("M118,266 C131,258 157,258 170,266"), MAGENTA, 2)}
  <g id="forearm-{s.s}" {origin(x(141), 342)}>
    {p(d("M118,336 L164,336 C164,372 160,402 154,424 L116,428 C114,402 114,372 118,336 Z"), CLOTH)}
    {line(d("M128,350 C126,380 126,400 128,420"), "#2c2840", 1.6)}
    {neon(d("M118,352 C116,380 116,400 117,420"), CYAN, 2)}
    {p(d("M115,420 L156,418 L155,440 L117,442 Z"), "#231f30")}
    {line(d(ribs), "#3a3550", 1.4)}
    <g id="hand-{s.s}" {origin(x(136), 441)}>
      {p(d("M121,440 C117,454 119,470 127,478 C131,482 137,482 141,478 C147,472 151,460 149,440 Z"), SKIN)}
      {line(d("M147,444 C156,449 156,460 149,465 M128,466 L129,477 M135,468 L135,479"), LINE, 1.5)}
    </g>
  </g>
</g>"""


# ---------------------------------------------------------------- head

def ear(s):
    d, x = s.d, s.x
    inner = "url(#earCyan)" if s.r else "url(#earPink)"
    tuft = "#e0fbff" if s.r else "#ffe0f6"
    rim = CYAN if s.r else MAGENTA
    return f"""<g id="ear-{s.s}" {origin(x(178), 72)}>
    {p(d("M156,86 C150,56 146,30 148,4 C170,16 190,34 202,54 Z"), "#1e1734")}
    <path d="{d("M164,72 L160,54 L163,56 L160,36 L164,38 L162,20 C176,30 186,42 193,56 L187,56 L189,64 L182,64 Z")}" fill="{inner}" filter="url(#glow)"/>
    {line(d("M170,62 L175,50 M176,66 L183,56 M166,52 L169,40"), tuft, 1.6)}
    {neon(d("M149,10 C147,32 150,56 155,80"), rim, 1.6)}
  </g>"""


def eye(s):
    d, x = s.d, s.x
    cx, cy = x(188), 128
    clip = f"clip-eye-{s.s}"
    sclera = d("M170,124 C176,113 198,112 205,128 C202,137 195,141 187,141 C178,141 172,135 170,124 Z")
    # highlights stay on the upper-left of each iris so the light reads from one side
    hx = cx - 3
    return f"""<g id="eye-{s.s}" {origin(cx, cy)}>
      <clipPath id="{clip}"><path d="{sclera}"/></clipPath>
      <path d="{sclera}" fill="#fffafc"/>
      <g clip-path="url(#{clip})">
        <g id="iris-{s.s}" {origin(cx, cy)}>
          <ellipse cx="{fmt(cx)}" cy="128" rx="9" ry="11" fill="url(#iris)" stroke="#2a0b4d" stroke-width="1.4"/>
          <ellipse cx="{fmt(cx)}" cy="129" rx="4.2" ry="6" fill="#170530"/>
          <ellipse cx="{fmt(cx)}" cy="134" rx="6" ry="3" fill="#e9a8ff" opacity="0.7"/>
          <circle cx="{fmt(hx)}" cy="124" r="2.6" fill="#fff"/>
          <circle cx="{fmt(hx + 6)}" cy="133" r="1.2" fill="#fff"/>
        </g>
        {p(d("M166,116 C178,110 198,110 208,122 L208,130 C198,118 178,117 166,126 Z"), "#b9a6c8", "", 'opacity="0.45"')}
      </g>
      {line(d("M168,125 C175,111 199,110 207,127"), LINE, 3.4)}
      {line(d("M170,120 L162,117"), LINE, 2.4)}
      {line(d("M180,140 Q188,142 196,139"), "#7a5a6a", 1.3)}
    </g>"""


def head():
    mouth = f"""<g id="mouth">
      <g id="mouth-smile">
        <path d="M196,167 Q210,173 225,165 Q213,178 196,167 Z" fill="#b85c8c"/>
        {line("M195,167 Q210,173 226,164 L228,161", LINE, 2.2)}
      </g>
      <g id="mouth-open" display="none">
        {p("M196,166 Q210,170 225,164 Q221,184 210,184 Q199,184 196,166 Z", "#4a1630")}
        <path d="M202,180 Q210,174 218,180 Q214,184 210,184 Q205,184 202,180 Z" fill="#ff7f9f"/>
        <path d="M217,167 L219,172 L221,166 Z" fill="#fff"/>
      </g>
      <g id="mouth-o" display="none">
        <ellipse class="o" cx="210" cy="172" rx="6" ry="8" fill="#4a1630"/>
      </g>
    </g>"""
    locks = []
    for s, color in ((Side("l"), MAGENTA), (Side("r"), CYAN)):
        locks.append(f"""<g id="lock-{s.s}" {origin(s.x(158), 112)}>
      {p(s.d("M152,108 C140,160 140,230 150,290 L158,276 L162,296 C166,250 168,190 166,140 Z"), "url(#hairTop)")}
      {neon(s.d("M150,150 C146,200 148,250 154,284"), color, 2)}
    </g>""")
    cups = []
    for s in (Side("l"), Side("r")):
        cx = fmt(s.x(150))
        cups.append(f"""<ellipse class="o" cx="{cx}" cy="130" rx="13" ry="22" fill="{CLOTH}"/>
      <ellipse cx="{cx}" cy="130" rx="8.5" ry="15" fill="#0d0b14"/>
      <ellipse cx="{cx}" cy="130" rx="6.5" ry="12" fill="none" stroke="{CYAN}" stroke-width="2.2" filter="url(#glow)"/>
      <circle cx="{cx}" cy="130" r="2" fill="#bff6ff"/>""")
    band = "M152,124 C144,64 176,42 210,42 C244,42 276,64 268,124"
    bangs = ("M150,124 C140,70 176,44 210,44 C244,44 280,70 270,124 Q264,100 252,92 Q250,104 246,112 "
             "Q238,92 226,86 Q224,96 220,102 Q214,88 204,84 Q206,104 212,126 Q200,108 192,88 "
             "Q186,96 180,104 Q174,92 164,92 Q160,108 156,122 Q152,112 150,124 Z")
    brow = "M171,108 Q185,101 201,106"
    return f"""<g id="head" {origin(210, 192)}>
  <g id="ears">
  {ear(Side("l"))}
  {ear(Side("r"))}
  </g>
  <g id="face">
    {p("M156,96 C154,140 164,168 184,182 C194,189 202,192 210,193 C218,192 226,189 236,182 C256,168 266,140 264,96 Z", SKIN)}
    {p("M158,96 C180,114 240,114 262,96 L262,108 C240,122 180,122 158,108 Z", SKIN_SHADE, "", 'opacity="0.7"')}
    <g filter="url(#soft)" fill="#ff8fb8" opacity="0.4">
      <ellipse cx="174" cy="153" rx="10" ry="4.5"/><ellipse cx="246" cy="153" rx="10" ry="4.5"/>
    </g>
    <g id="eyes">
    {eye(Side("l"))}
    {eye(Side("r"))}
    </g>
    {line("M213,139 L217,152 Q214,155 209,154", "#c48f8a", 1.6)}
    {mouth}
  </g>
  <g id="locks">
    {locks[0]}
    {locks[1]}
  </g>
  <g id="hair-top">
    {p(bangs, "url(#hairTop)")}
    {p("M208,46 C202,28 214,14 232,18 C220,22 214,30 216,46 Z", "#2e2350")}
    {line("M168,64 Q190,52 210,52 Q230,52 252,64", "#4b3f7a", 5, 'opacity="0.6"')}
    {line("M190,60 L184,86 M230,60 L236,86", "#3b2f63", 1.5)}
    {neon("M176,58 Q170,76 168,94", MAGENTA, 2.2)}
    {neon("M246,58 Q252,76 252,92", CYAN, 2.2)}
  </g>
  <g id="brows">
    {line(brow, "#1f1830", 2.8, 'id="brow-l"')}
    {line(mirror(brow), "#1f1830", 2.8, 'id="brow-r"')}
  </g>
  <g id="headphones">
    {line(band, LINE, 13)}
    {line(band, CLOTH_LIGHT, 8)}
    {neon("M148,104 C147,94 148,86 151,78 " + mirror("M148,104 C147,94 148,86 151,78"), CYAN, 2.2)}
    {cups[0]}
    {cups[1]}
  </g>
</g>"""


# ---------------------------------------------------------------- document

def build():
    defs = f"""<defs>
  <style>
    .o{{stroke:{LINE};stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}}
    .metal{{stroke:{METAL};fill:none;stroke-width:2;stroke-linecap:round}}
  </style>
  <linearGradient id="hairBack" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#261c42"/><stop offset="0.6" stop-color="#1a1430"/><stop offset="1" stop-color="#2a2672"/>
  </linearGradient>
  <linearGradient id="hairTop" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2e2350"/><stop offset="1" stop-color="#18122c"/>
  </linearGradient>
  <linearGradient id="earPink" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#7a1f8f"/><stop offset="1" stop-color="#ff6ad8"/>
  </linearGradient>
  <linearGradient id="earCyan" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#2340a0"/><stop offset="1" stop-color="#46e8ff"/>
  </linearGradient>
  <linearGradient id="iris" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a0a5e"/><stop offset="0.5" stop-color="#7e44e6"/><stop offset="1" stop-color="#d99dff"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="1.8" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>
</defs>"""
    rig = ("<!-- Rig: each id'd group pivots at its CSS transform-origin (viewBox units).\n"
           "     head/hair-back share a pivot and should move together; arm > forearm > hand and\n"
           "     thigh > shin are nested chains. Mouth variants: mouth-smile | mouth-open | mouth-o. -->")
    body = "\n".join([
        hair_back(),
        p("M128,270 L292,270 L304,404 L116,404 Z", "#15121e", "o", 'id="jacket-back"'),
        leg(Side("l")), leg(Side("r")),
        torso(), hips(), jacket_front(),
        arm(Side("l")), arm(Side("r")),
        head(),
    ])
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 910" width="{W}" height="910" '
           f'role="img" aria-labelledby="mewbit-title">\n<title id="mewbit-title">MewBit</title>\n{rig}\n{defs}\n'
           f'<g id="mewbit">\n{body}\n</g>\n</svg>\n')
    OUT.write_text(svg, encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
