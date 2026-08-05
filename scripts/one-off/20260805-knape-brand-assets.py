#!/usr/bin/env python3
"""Generate Knape & Associates' CRM brand asset set.

    python3 scripts/one-off/20260805-knape-brand-assets.py

Writes into apps/app/public/brand/. Requires Pillow + numpy; nothing in the
build runs this. It is a one-shot generator kept in the tree so the icons can be
rebuilt from their source instead of sitting here as unexplained binaries.

THE SOURCE ARTWORK
------------------
`Knape-Logo-500px.png` — the supplied lockup, 500x200. Two elements with a
21px gutter between them:

    x 20..173   the disc mark: a charcoal disc with a cyan "K"
    x 195..482  the wordmark: "KNAPE" over "ASSOCIATES", charcoal

Two ink colours and nothing else: charcoal #231f20 and cyan #0693cf.

WHY THE LOCKUP IS EMITTED TWICE
-------------------------------
The wordmark is charcoal. On the app's dark theme charcoal-on-near-black is
invisible, so a single <img> would render as a floating cyan disc with nothing
beside it. A CSS mask would fix the visibility and throw the cyan away, which
loses the only colour the brand has.

So the charcoal is recoloured to near-white for the dark theme and left alone
for the light one, and the cyan is untouched in both — cyan reads on both
grounds. BrandWordmark picks between them with `dark:`, by the `-dark` suffix
convention it documents.

    knape-logo.png       dark surfaces (charcoal -> near-white)
    knape-logo-dark.png  light surfaces (as supplied)

WHY THE ICONS INVERT THE MARK
-----------------------------
The disc as supplied is a charcoal circle. At 16px, where the K's leaf detail
is gone and a favicon is a coloured blob and nothing else, that is a dark blob
— indistinguishable from every other dark favicon in the tab strip, and from
the near-black tile the app itself sits on.

So the icons take the same two colours and swap them: a cyan tile with the K
knocked out in charcoal. Same mark, same palette, but the blob is now bright
cyan, which is the one thing that still survives at 16px. Hue alone would not
have — two dark squares stay two dark squares.
"""

import os

import numpy as np
from PIL import Image, ImageDraw

SRC = "/root/knape/knape-dashboard-/Knape-Logo-500px.png"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "app", "public", "brand")

CHARCOAL = (35, 31, 32)  # #231f20 — wordmark, disc, and the inked K on the tiles
CYAN = (6, 147, 207)  # #0693cf — the K, and the tile ground
NEAR_WHITE = (242, 242, 242)  # the dark-theme substitute for charcoal

# Measured off the source, not guessed. See the module docstring.
DISC_BOX = (20, 19, 174, 182)
# First column of the wordmark. The gutter between the two elements is x 174..194.
WORDMARK_X = 190


def load_source() -> Image.Image:
    return Image.open(SRC).convert("RGBA")


def recolour_wordmark(img: Image.Image, to: tuple[int, int, int]) -> Image.Image:
    """Repaint the charcoal wordmark, leaving the disc mark alone.

    Restricted to x >= WORDMARK_X on purpose. The disc is charcoal too, and
    recolouring it turns the mark into a near-white coin — a different logo,
    not a dark-theme rendering of this one. Only the lettering has to move,
    because only the lettering is charcoal-on-charcoal against the app's dark
    surface; the disc still carries the cyan K, which reads on either ground.

    Per-pixel distance rather than an exact match: the lockup is anti-aliased
    and its "charcoal" spans a few dozen near-identical values (#231f20,
    #2b2b2b, #221e1f...). An equality test would recolour the solid interior of
    each letter and leave its edges dark, giving the wordmark a black halo. The
    blend weight is the distance itself, so a half-covered edge pixel ends up
    half recoloured and the letterforms keep their shape.
    """
    a = np.array(img).astype(float)
    rgb, alpha = a[..., :3], a[..., 3:]

    d_char = np.linalg.norm(rgb - np.array(CHARCOAL), axis=-1)
    weight = np.clip(1.0 - d_char / 140.0, 0.0, 1.0)

    # The disc keeps its supplied colours; only the lettering is repainted.
    weight[:, :WORDMARK_X] = 0.0
    weight = weight[..., None]

    out = rgb * (1 - weight) + np.array(to, dtype=float) * weight
    return Image.fromarray(
        np.concatenate([out, alpha], axis=-1).clip(0, 255).astype(np.uint8), "RGBA"
    )


def k_mask() -> Image.Image:
    """The K, lifted off the disc as an alpha mask.

    Selected by BLUENESS, not by distance from charcoal. The obvious test —
    "inside the disc, anything that is not charcoal is the K" — also selects
    the disc's own anti-aliased rim, whose pixels blend charcoal toward
    transparency and so drift away from charcoal on the way out. That printed a
    ghost circle around the K on every tile.

    The K is the only blue thing in the artwork: cyan #0693cf has B-R = 201,
    charcoal #231f20 has B-R = -3, and no amount of edge blending between two
    neutral values invents a blue cast. The K's white inner highlight is not
    blue, so it is caught by a second test on brightness — bounded to the
    disc's interior, where the only bright pixels are that highlight.
    """
    disc = load_source().crop(DISC_BOX)
    a = np.array(disc).astype(float)
    rgb, alpha = a[..., :3], a[..., 3]

    blueness = rgb[..., 2] - rgb[..., 0]
    cyan_cov = np.clip((blueness - 12.0) / 40.0, 0.0, 1.0)
    highlight_cov = np.clip((rgb.min(axis=-1) - 120.0) / 60.0, 0.0, 1.0)

    coverage = np.maximum(cyan_cov, highlight_cov) * (alpha / 255.0)
    return Image.fromarray((coverage * 255).astype(np.uint8), "L")


def tile(size: int, inset: float) -> Image.Image:
    """A cyan tile with the K knocked out in charcoal.

    `inset` is the share of the tile left as margin on each side. The maskable
    icon needs more of it than the plain one: Android crops maskable icons to a
    circle, and a mark sized for the square gets its corners eaten.
    """
    img = Image.new("RGBA", (size, size), CYAN + (255,))

    mark = int(size * (1 - 2 * inset))
    mask = k_mask()
    # Fit the K into a square box without distorting it — the source is 154x163.
    w, h = mask.size
    scale = mark / max(w, h)
    mask = mask.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    ink = Image.new("RGBA", mask.size, CHARCOAL + (255,))
    img.paste(ink, ((size - mask.size[0]) // 2, (size - mask.size[1]) // 2), mask)
    return img


def rounded(img: Image.Image, radius_ratio: float = 0.22) -> Image.Image:
    """Round the tile's corners. Apple and the PWA prompt both expect a square
    source, but the favicon is painted raw and a hard square reads as a colour
    swatch rather than a mark."""
    size = img.size[0]
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [(0, 0), (size - 1, size - 1)], radius=int(size * radius_ratio), fill=255
    )
    out = img.copy()
    out.putalpha(mask)
    return out


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    src = load_source()

    def save(img: Image.Image, name: str, **kw) -> None:
        path = os.path.join(OUT, name)
        img.save(path, **kw)
        print(f"  {name:34s} {img.size[0]}x{img.size[1]}")

    print("lockup")
    # Trimmed to the ink so the sidebar controls the padding, not the asset.
    save(recolour_wordmark(src, NEAR_WHITE).crop(src.getbbox()), "knape-logo.png")
    save(src.crop(src.getbbox()), "knape-logo-dark.png")

    print("icons")
    save(rounded(tile(192, 0.20)), "knape-icon-192.png")
    save(rounded(tile(512, 0.20)), "knape-icon-512.png")
    # Maskable is deliberately NOT rounded: the platform does the cropping, and
    # rounding first leaves transparent slivers outside the circle.
    save(tile(512, 0.28), "knape-icon-maskable-512.png")
    # Safari composites onto white if the icon has alpha, so this one stays square
    # and opaque rather than getting white corners on a home screen.
    save(tile(180, 0.20), "knape-apple-touch-icon.png")

    # Every frame composed at its own size rather than downscaled from one
    # bitmap — a 16px LANCZOS reduction of a 512px tile turns the K to mush.
    ico = tile(256, 0.20)
    ico.save(
        os.path.join(OUT, "knape-favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("  knape-favicon.ico                  16/24/32/48/64/128/256")

    print("open graph")
    og = Image.new("RGBA", (1200, 630), CHARCOAL + (255,))
    lock = recolour_wordmark(src, NEAR_WHITE).crop(src.getbbox())
    lw = 700
    lock = lock.resize((lw, int(lock.size[1] * lw / lock.size[0])), Image.LANCZOS)
    og.paste(lock, ((1200 - lw) // 2, (630 - lock.size[1]) // 2), lock)
    save(og.convert("RGB"), "knape-og.png")


if __name__ == "__main__":
    main()
