#!/usr/bin/env python3
"""Generate DryWatch launcher + notification icons from the splash-screen logo.

The splash mark (OnboardingScreen) is: a square frame rotated 45 degrees, an
inner square cut, and a solid dot at the centre. This script redraws that
mark as PNGs so the launcher icon, the notification small icon, and the status
bar icon are the same shape.

Outputs:
  mipmap-*/ic_launcher.png        legacy square launcher icon (full color)
  mipmap-*/ic_launcher_round.png  round launcher icon (full color)
  mipmap-*/ic_launcher_fg.png     adaptive foreground (transparent, 108dp grid)
  drawable/ic_stat_drywatch.xml   vector notification/status icon (white)

Palette (robi.work dark): background #2b312f, foreground #eaf2ef.
"""
from pathlib import Path

from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parents[1] / "android/app/src/main/res"
BG = (43, 49, 47, 255)        # #2b312f
FG = (234, 242, 239, 255)     # #eaf2ef

# Legacy launcher densities (px). Adaptive foreground uses the 108dp grid.
LEGACY = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
ADAPTIVE = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def draw_mark(size: int, stroke: float, inset: float) -> Image.Image:
    """Draw the splash mark centred in a transparent square of `size` px.

    stroke: outline thickness in px; inset: distance from the canvas edge to
    the outer frame.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size / 2
    half = size / 2 - inset

    # Outer frame rotated 45 degrees = a square rotated: draw it as a
    # diamond-outline by rotating a square's four corners.
    outer = half * 1.4142 / 2 * 1.0
    # The splash frame is 46px in a 62px box -> ~74% of the box.
    outer = half * 0.74 * 1.4142 / 1.4142 * 1.0
    outer = half * 0.74
    pts = [
        (c, c - outer),
        (c + outer, c),
        (c, c + outer),
        (c - outer, c),
    ]
    d.line(pts + [pts[0]], fill=FG, width=int(stroke), joint="curve")

    # Inner square cut (same rotation, smaller).
    inner = outer * (22.0 / 46.0)
    ipts = [
        (c, c - inner),
        (c + inner, c),
        (c, c + inner),
        (c - inner, c),
    ]
    d.line(ipts + [ipts[0]], fill=FG, width=int(stroke), joint="curve")

    # Centre dot (8px in a 62px box).
    r = half * (8.0 / 62.0) * 1.6
    d.ellipse([c - r, c - r, c + r, c + r], fill=FG)
    return img


def legacy_icon(size: int, round_shape: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    mark = draw_mark(size, stroke=max(2.0, size * 0.031), inset=size * 0.13)
    if round_shape:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        img.paste(mark, (0, 0), mark)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    img.paste(mark, (0, 0), mark)
    return img


def adaptive_fg(size: int) -> Image.Image:
    # Adaptive icons: the safe zone is the middle 66dp of the 108dp grid.
    # Draw the mark into the middle third.
    inner = int(size * 0.62)
    mark = draw_mark(inner, stroke=max(2.0, inner * 0.045), inset=inner * 0.02)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(mark, ((size - inner) // 2, (size - inner) // 2), mark)
    return out


def main():
    for folder, size in LEGACY.items():
        d = RES / folder
        d.mkdir(parents=True, exist_ok=True)
        legacy_icon(size, False).save(d / "ic_launcher.png")
        legacy_icon(size, True).save(d / "ic_launcher_round.png")
        print(f"  {folder}/ic_launcher.png ({size})")

    for folder, size in ADAPTIVE.items():
        d = RES / folder
        d.mkdir(parents=True, exist_ok=True)
        adaptive_fg(size).save(d / "ic_launcher_foreground.png")
        print(f"  {folder}/ic_launcher_foreground.png ({size})")

    print("done")


if __name__ == "__main__":
    main()
