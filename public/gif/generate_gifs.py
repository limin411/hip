#!/usr/bin/env python3
"""Generate action GIFs of the hip logo mascot (supersampled)."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent

# Output size + supersample factor (draw at OUT_SIZE*SS, progressive Lanczos).
OUT_SIZE = 1024
SS = 4
DRAW_SIZE = OUT_SIZE * SS  # 4096

# Motion offsets are authored for a 320px canvas; scale to output
_MOTION = OUT_SIZE / 320.0

BG = (0, 0, 0, 0)
GREEN = (159, 175, 139, 255)
WHITE = (255, 255, 255, 255)
DARK = (26, 26, 26, 255)

# Drawing scale maps logo viewBox → draw canvas
_DRAW_SCALE = DRAW_SIZE / 1320


def s(v: float) -> float:
    return v * _DRAW_SCALE


def bezier_quad(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    n: int = 64,
) -> list[tuple[float, float]]:
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def draw_thick_polyline(
    draw: ImageDraw.ImageDraw,
    pts: list[tuple[float, float]],
    fill: tuple[int, int, int, int],
    width: float,
) -> None:
    if len(pts) < 2:
        return
    r = width / 2
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy) or 1
        nx, ny = -dy / length * r, dx / length * r
        draw.polygon(
            [
                (x0 + nx, y0 + ny),
                (x0 - nx, y0 - ny),
                (x1 - nx, y1 - ny),
                (x1 + nx, y1 + ny),
            ],
            fill=fill,
        )


def draw_mascot(
    ox: float = 0,
    oy: float = 0,
    rot: float = 0,
    scale: float = 1.0,
    eye_open: float = 1.0,
    eye_open_l: float | None = None,
    eye_open_r: float | None = None,
    pupil_dx: float = 0,
    pupil_dy: float = 0,
    brow_dy: float = 0,
    brow_curve: float = 0,
    brow_dy_l: float | None = None,
    brow_dy_r: float | None = None,
    mouth: str = "smile",
    mouth_open: float = 0.0,
    ant_l: float = 0,
    ant_r: float = 0,
    blush: float = 0.0,
) -> Image.Image:
    """Draw one mascot frame (RGBA), supersampled then downscaled for smooth edges.

    ox/oy are in output-pixel units (authored against 320px, auto-scaled).
    eye_open_l / eye_open_r override eye_open per side when set (for wink).
    """
    ox_d = ox * _MOTION * SS
    oy_d = oy * _MOTION * SS
    open_l = eye_open if eye_open_l is None else eye_open_l
    open_r = eye_open if eye_open_r is None else eye_open_r
    brow_l = brow_dy if brow_dy_l is None else brow_dy_l
    brow_r = brow_dy if brow_dy_r is None else brow_dy_r

    layer = Image.new("RGBA", (DRAW_SIZE, DRAW_SIZE), BG)
    draw = ImageDraw.Draw(layer)

    def P(x: float, y: float) -> tuple[float, float]:
        cx, cy = 660.0, 700.0
        x, y = x - cx, y - cy
        x, y = x * scale, y * scale
        if rot:
            rad = math.radians(rot)
            cos_r, sin_r = math.cos(rad), math.sin(rad)
            x, y = x * cos_r - y * sin_r, x * sin_r + y * cos_r
        return (s(x + cx) + ox_d, s(y + cy) + oy_d)

    def R(r: float) -> float:
        return s(r) * scale

    # --- antennae ---
    for base, tip, ang in (
        ((428, 240), (362, 165), ant_l),
        ((844, 240), (910, 165), ant_r),
    ):
        bx, by = base
        tx, ty = tip
        dx, dy = tx - bx, ty - by
        rad = math.radians(ang)
        cos_r, sin_r = math.cos(rad), math.sin(rad)
        ntx = bx + dx * cos_r - dy * sin_r
        nty = by + dx * sin_r + dy * cos_r
        p0 = P(bx, by)
        p1 = P(ntx, nty)
        draw_thick_polyline(draw, [p0, p1], GREEN, R(40))
        tr = R(28)
        draw.ellipse((p1[0] - tr, p1[1] - tr, p1[0] + tr, p1[1] + tr), fill=GREEN)

    # --- side bumps ---
    for cx, cy, rr in ((162, 1020, 68), (1110, 1020, 68)):
        px, py = P(cx, cy)
        r = R(rr)
        draw.ellipse((px - r, py - r, px + r, py + r), fill=GREEN)

    # --- main head ---
    hx, hy = P(636, 724)
    hr = R(500)
    draw.ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=GREEN)

    # --- blush ---
    if blush > 0:
        for cx, cy in ((320, 760), (952, 760)):
            px, py = P(cx, cy)
            brx, bry = R(70), R(40)
            a = int(110 * blush)
            blush_img = Image.new("RGBA", (DRAW_SIZE, DRAW_SIZE), BG)
            bd = ImageDraw.Draw(blush_img)
            bd.ellipse(
                (px - brx, py - bry, px + brx, py + bry),
                fill=(232, 140, 140, a),
            )
            blush_img = blush_img.filter(
                ImageFilter.GaussianBlur(radius=max(1.0, R(14)))
            )
            layer = Image.alpha_composite(layer, blush_img)
            draw = ImageDraw.Draw(layer)

    # --- eyes ---
    eye_ry_base = 72
    eye_rx = 109
    for (cx, cy), open_amt in (
        ((454, 632), open_l),
        ((818, 632), open_r),
    ):
        px, py = P(cx, cy)
        rx = R(eye_rx)
        if open_amt < 0.18:
            p0 = (px - rx * 0.85, py)
            p1 = (px, py + R(12))
            p2 = (px + rx * 0.85, py)
            pts = bezier_quad(p0, p1, p2, n=48)
            draw_thick_polyline(draw, pts, DARK, R(28))
        else:
            ry = max(R(8), R(eye_ry_base) * open_amt)
            draw.ellipse((px - rx, py - ry, px + rx, py + ry), fill=WHITE)

            if open_amt > 0.28:
                pr = R(35) * min(1.0, 0.5 + open_amt * 0.5)
                ppx = px + s(pupil_dx) * scale
                ppy = py + s(pupil_dy) * scale
                max_off_x = rx * 0.35
                max_off_y = ry * 0.35
                ppx = max(px - max_off_x, min(px + max_off_x, ppx))
                ppy = max(py - max_off_y, min(py + max_off_y, ppy))
                draw.ellipse((ppx - pr, ppy - pr, ppx + pr, ppy + pr), fill=DARK)
                hr2 = pr * 0.28
                draw.ellipse(
                    (
                        ppx - pr * 0.35 - hr2,
                        ppy - pr * 0.4 - hr2,
                        ppx - pr * 0.35 + hr2,
                        ppy - pr * 0.4 + hr2,
                    ),
                    fill=WHITE,
                )

    # --- eyebrows ---
    for (left, mid, right), bdy in (
        (((332, 470), (454, 430), (576, 470)), brow_l),
        (((697, 470), (818, 430), (940, 470)), brow_r),
    ):
        p0 = P(left[0], left[1] + bdy)
        p1 = P(mid[0], mid[1] + bdy + brow_curve)
        p2 = P(right[0], right[1] + bdy)
        pts = bezier_quad(p0, p1, p2, n=48)
        draw_thick_polyline(draw, pts, DARK, R(55))

    # --- mouth ---
    if mouth == "smile":
        open_extra = mouth_open * 40
        p0 = P(555, 855)
        p1 = P(636, 890 + open_extra)
        p2 = P(717, 855)
        pts = bezier_quad(p0, p1, p2, n=48)
        draw_thick_polyline(draw, pts, DARK, R(40))
        if mouth_open > 0.3:
            mid = P(636, 875 + open_extra * 0.6)
            top = P(636, 855)
            draw.polygon([p0, mid, p2, top], fill=DARK)
    elif mouth == "ooo":
        cx, cy = P(636, 880)
        rx, ry = R(36 + mouth_open * 20), R(42 + mouth_open * 30)
        # filled ring via outer ellipse + inner hole isn't easy; draw thick outline
        draw.ellipse(
            (cx - rx, cy - ry, cx + rx, cy + ry),
            outline=DARK,
            width=max(1, int(R(36))),
        )
        draw.ellipse(
            (cx - rx * 0.55, cy - ry * 0.55, cx + rx * 0.55, cy + ry * 0.55),
            fill=DARK,
        )
    elif mouth == "flat":
        p0 = P(560, 870)
        p1 = P(712, 870)
        draw_thick_polyline(draw, [p0, p1], DARK, R(40))
    elif mouth == "grin":
        p0 = P(520, 840)
        p1 = P(636, 930 + mouth_open * 20)
        p2 = P(752, 840)
        pts = bezier_quad(p0, p1, p2, n=56)
        draw_thick_polyline(draw, pts, DARK, R(42))

    # Progressive half-scale downsample then final Lanczos — smoother AA than one-shot
    img = layer
    while img.size[0] // 2 >= OUT_SIZE:
        img = img.resize(
            (img.size[0] // 2, img.size[1] // 2), Image.Resampling.LANCZOS
        )
    if img.size != (OUT_SIZE, OUT_SIZE):
        img = img.resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)
    return img


def ease_in_out(t: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * t)


def _rgba_to_rgb_for_gif(rgba: Image.Image) -> Image.Image:
    """RGB with magenta chroma for transparent pixels."""
    rgba = rgba.convert("RGBA")
    alpha = rgba.getchannel("A")
    mask = alpha.point(lambda a: 255 if a >= 96 else 0)
    rgb = Image.new("RGB", rgba.size, (255, 0, 255))
    rgb.paste(rgba.convert("RGB"), mask=mask)
    return rgb


def _build_shared_palette(frames: list[Image.Image]) -> Image.Image:
    n = len(frames)
    step = max(1, n // 10)
    samples = [frames[i] for i in range(0, n, step)][:10]
    w, h = samples[0].size
    thumb_w = min(w, 320)
    thumbs = [
        _rgba_to_rgb_for_gif(fr).resize(
            (thumb_w, max(1, int(h * thumb_w / w))),
            Image.Resampling.BOX,
        )
        for fr in samples
    ]
    atlas_w = sum(t.size[0] for t in thumbs)
    atlas_h = max(t.size[1] for t in thumbs)
    atlas = Image.new("RGB", (atlas_w, atlas_h), (255, 0, 255))
    x = 0
    for t in thumbs:
        atlas.paste(t, (x, 0))
        x += t.size[0]
    return atlas.quantize(
        colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    )


def _find_transp_index(p: Image.Image) -> int:
    pal = p.getpalette() or []
    n_colors = max(1, len(pal) // 3)
    best_i, best_d = 0, 1e18
    for i in range(n_colors):
        r, g, b = pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]
        d = (r - 255) ** 2 + g * g + (b - 255) ** 2
        if d < best_d:
            best_d, best_i = d, i
    return best_i


def save_gif(frames: list[Image.Image], stem: str, duration: int = 60, loop: int = 0) -> None:
    path = OUT / f"{stem}.gif"
    palette = _build_shared_palette(frames)
    converted = []
    for fr in frames:
        p = _rgba_to_rgb_for_gif(fr).quantize(palette=palette, dither=Image.Dither.NONE)
        p.info["transparency"] = _find_transp_index(p)
        converted.append(p)
    transp = converted[0].info.get("transparency", 0)
    converted[0].save(
        path,
        save_all=True,
        append_images=converted[1:],
        duration=duration,
        loop=loop,
        disposal=2,
        transparency=transp,
        optimize=False,
    )
    check = Image.open(path)
    print(
        f"wrote {path.name}: {OUT_SIZE}px, "
        f"{len(frames)}→{check.n_frames} frames, {duration}ms, "
        f"{path.stat().st_size / 1024:.0f}KB"
    )


def gif_blink() -> None:
    frames = []
    sequence = (
        [1.0] * 12
        + [0.6, 0.2, 0.05, 0.2, 0.6, 1.0]
        + [1.0] * 10
        + [0.5, 0.1, 0.05, 0.15, 0.7, 1.0]
        + [0.4, 0.05, 0.05, 0.3, 1.0]
        + [1.0] * 8
    )
    for open_amt in sequence:
        frames.append(draw_mascot(eye_open=open_amt))
    save_gif(frames, "blink", duration=50)


def gif_bounce() -> None:
    frames = []
    n = 24
    for i in range(n):
        t = i / n
        phase = math.sin(t * math.pi * 2)
        y = -abs(phase) * 28
        sc = (
            1.0 + 0.06 * (1 - abs(phase))
            if abs(phase) < 0.25
            else 1.0 - 0.03 * abs(phase)
        )
        frames.append(
            draw_mascot(
                oy=y,
                scale=sc,
                mouth="smile",
                mouth_open=0.15 * abs(phase),
                ant_l=12 * phase,
                ant_r=-12 * phase,
            )
        )
    save_gif(frames, "bounce", duration=40)


def gif_look() -> None:
    frames = []
    path: list[tuple[float, float]] = []
    path += [(0, 0)] * 6
    for i in range(8):
        t = ease_in_out(i / 7)
        path.append((-55 * t, 5 * t))
    path += [(-55, 5)] * 6
    for i in range(12):
        t = ease_in_out(i / 11)
        path.append((-55 + 110 * t, 5))
    path += [(55, 5)] * 6
    for i in range(10):
        t = ease_in_out(i / 9)
        path.append((55 * (1 - t), 5 + (-45 - 5) * t))
    path += [(0, -45)] * 5
    for i in range(8):
        t = ease_in_out(i / 7)
        path.append((0, -45 * (1 - t)))
    path += [(0, 0)] * 6

    for dx, dy in path:
        brow = -8 if dy < -20 else 0
        frames.append(
            draw_mascot(
                pupil_dx=dx,
                pupil_dy=dy,
                brow_dy=brow,
                brow_curve=-10 if dy < -20 else 0,
            )
        )
    save_gif(frames, "look-around", duration=50)


def gif_wave() -> None:
    frames = []
    n = 28
    for i in range(n):
        t = i / n
        wiggle = math.sin(t * math.pi * 4)
        frames.append(
            draw_mascot(
                ant_l=28 * wiggle,
                ant_r=-28 * wiggle,
                mouth="smile",
                pupil_dy=-5,
            )
        )
    save_gif(frames, "wave", duration=45)


def gif_happy() -> None:
    frames = []
    n = 30
    for i in range(n):
        t = i / n
        hop = -abs(math.sin(t * math.pi * 3)) * 22
        spin_wiggle = math.sin(t * math.pi * 6) * 6
        frames.append(
            draw_mascot(
                oy=hop,
                rot=spin_wiggle,
                mouth="grin",
                mouth_open=0.4 + 0.3 * abs(math.sin(t * math.pi * 3)),
                eye_open=0.85 + 0.15 * abs(math.sin(t * math.pi * 3)),
                brow_dy=-18,
                brow_curve=-15,
                blush=0.7,
                ant_l=20 * math.sin(t * math.pi * 4),
                ant_r=-20 * math.sin(t * math.pi * 4),
            )
        )
    save_gif(frames, "happy", duration=40)


def gif_think() -> None:
    frames = []
    for i in range(10):
        t = ease_in_out(i / 9)
        frames.append(
            draw_mascot(
                rot=-8 * t,
                pupil_dx=20 * t,
                pupil_dy=-30 * t,
                brow_dy=-25 * t,
                brow_curve=-20 * t,
                mouth="flat" if t > 0.5 else "smile",
                ant_l=15 * t,
                ant_r=-5 * t,
            )
        )
    for i in range(18):
        open_amt = 1.0
        if i in (8, 9):
            open_amt = 0.1
        if i == 10:
            open_amt = 0.6
        frames.append(
            draw_mascot(
                rot=-8,
                pupil_dx=20,
                pupil_dy=-30,
                brow_dy=-25,
                brow_curve=-20,
                mouth="flat",
                eye_open=open_amt,
                ant_l=15 + 3 * math.sin(i * 0.4),
                ant_r=-5,
            )
        )
    for i in range(8):
        t = ease_in_out(i / 7)
        frames.append(
            draw_mascot(
                rot=-8 * (1 - t),
                pupil_dx=20 * (1 - t),
                pupil_dy=-30 * (1 - t),
                brow_dy=-25 * (1 - t),
                brow_curve=-20 * (1 - t),
                mouth="smile",
            )
        )
    save_gif(frames, "think", duration=55)


def gif_spin() -> None:
    frames = []
    n = 24
    for i in range(n):
        t = i / n
        rot = math.sin(t * math.pi * 2) * 14
        frames.append(
            draw_mascot(
                rot=rot,
                mouth="smile",
                mouth_open=0.1,
                pupil_dx=rot * 1.5,
                ant_l=-rot * 0.8,
                ant_r=-rot * 0.8,
            )
        )
    save_gif(frames, "tilt", duration=45)


def gif_sleep() -> None:
    frames = []
    for i in range(8):
        t = ease_in_out(i / 7)
        frames.append(draw_mascot(eye_open=1 - 0.3 * t, mouth="smile", brow_dy=10 * t))
    for i in range(6):
        frames.append(
            draw_mascot(
                eye_open=0.15 if i % 2 == 0 else 0.5, brow_dy=12, mouth="flat"
            )
        )
    for i in range(20):
        y = math.sin(i / 20 * math.pi * 2) * 4
        fr = draw_mascot(
            oy=y,
            eye_open=0.08,
            brow_dy=15,
            brow_curve=10,
            mouth="flat",
            ant_l=-8,
            ant_r=8,
        )
        # Z drawn at output resolution (frame is already downscaled)
        z_layer = Image.new("RGBA", fr.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(z_layer)
        z_phase = (i % 10) / 10.0
        zx = OUT_SIZE * 0.70 + z_phase * 24 * _MOTION
        zy = OUT_SIZE * 0.20 - z_phase * 36 * _MOTION
        zs = (16 + z_phase * 12) * _MOTION
        a = int(220 * (1 - z_phase * 0.75))
        zcol = (26, 26, 26, a)
        pts = [
            (zx, zy),
            (zx + zs, zy),
            (zx, zy + zs * 0.95),
            (zx + zs, zy + zs * 0.95),
        ]
        width = max(2, int((3 + z_phase * 2) * _MOTION))
        for j in range(len(pts) - 1):
            d.line([pts[j], pts[j + 1]], fill=zcol, width=width)
        fr = Image.alpha_composite(fr, z_layer)
        frames.append(fr)
    for i in range(6):
        t = ease_in_out(i / 5)
        frames.append(
            draw_mascot(
                eye_open=0.05 + 0.95 * t,
                brow_dy=15 * (1 - t),
                mouth="ooo" if t < 0.5 else "smile",
            )
        )
    save_gif(frames, "sleep", duration=70)


def gif_wink() -> None:
    frames = []
    frames += [draw_mascot()] * 8
    # close right eye
    for open_amt in (0.7, 0.35, 0.1, 0.05, 0.05, 0.05, 0.05, 0.15, 0.4, 0.75, 1.0):
        frames.append(
            draw_mascot(
                eye_open_l=1.0,
                eye_open_r=open_amt,
                brow_dy_r=8 if open_amt < 0.3 else 0,
                mouth="smile",
                mouth_open=0.25 if open_amt < 0.3 else 0.0,
                blush=0.55 if open_amt < 0.4 else 0.15,
                ant_l=6,
                ant_r=-10,
            )
        )
    frames += [draw_mascot(blush=0.2)] * 10
    save_gif(frames, "wink", duration=50)


def gif_nod() -> None:
    frames = []
    n = 28
    for i in range(n):
        t = i / n
        # two friendly nods
        phase = math.sin(t * math.pi * 4)
        # bias downward on the first half of each nod
        dip = max(0.0, -phase) * 18
        frames.append(
            draw_mascot(
                oy=dip,
                rot=phase * 3,
                pupil_dy=dip * 0.6,
                brow_dy=4 * max(0.0, -phase),
                mouth="smile",
                mouth_open=0.1 * abs(phase),
                ant_l=8 * phase,
                ant_r=-8 * phase,
            )
        )
    save_gif(frames, "nod", duration=45)


def gif_shake() -> None:
    frames = []
    n = 30
    for i in range(n):
        t = i / n
        wiggle = math.sin(t * math.pi * 5) * 12
        frames.append(
            draw_mascot(
                rot=wiggle,
                pupil_dx=wiggle * 2.2,
                mouth="flat",
                brow_dy=-6,
                brow_curve=8,
                ant_l=-wiggle * 0.6,
                ant_r=-wiggle * 0.6,
            )
        )
    save_gif(frames, "shake", duration=40)


def gif_surprise() -> None:
    frames = []
    # settle
    frames += [draw_mascot()] * 4
    # pop open
    for i in range(6):
        t = ease_in_out(i / 5)
        frames.append(
            draw_mascot(
                scale=1.0 + 0.08 * t,
                oy=-10 * t,
                eye_open=1.0 + 0.15 * t,
                mouth="ooo",
                mouth_open=0.8 * t,
                brow_dy=-28 * t,
                brow_curve=-18 * t,
                ant_l=18 * t,
                ant_r=-18 * t,
            )
        )
    # hold with tiny quiver
    for i in range(12):
        q = math.sin(i * 0.9) * 2
        frames.append(
            draw_mascot(
                scale=1.08,
                oy=-10 + q,
                eye_open=1.12,
                mouth="ooo",
                mouth_open=0.85,
                brow_dy=-28,
                brow_curve=-18,
                ant_l=18 + q,
                ant_r=-18 - q,
            )
        )
    # relax
    for i in range(8):
        t = ease_in_out(i / 7)
        frames.append(
            draw_mascot(
                scale=1.08 - 0.08 * t,
                oy=-10 * (1 - t),
                mouth="ooo" if t < 0.5 else "smile",
                mouth_open=0.85 * (1 - t),
                brow_dy=-28 * (1 - t),
                brow_curve=-18 * (1 - t),
                ant_l=18 * (1 - t),
                ant_r=-18 * (1 - t),
            )
        )
    save_gif(frames, "surprise", duration=50)


def gif_float() -> None:
    """Gentle idle bob — good ambient loop for empty states."""
    frames = []
    n = 36
    for i in range(n):
        t = i / n
        y = math.sin(t * math.pi * 2) * 10
        breath = 1.0 + 0.025 * math.sin(t * math.pi * 2)
        frames.append(
            draw_mascot(
                oy=y,
                scale=breath,
                pupil_dy=-4 + y * 0.2,
                mouth="smile",
                ant_l=6 * math.sin(t * math.pi * 2 + 0.4),
                ant_r=-6 * math.sin(t * math.pi * 2 + 0.4),
            )
        )
    save_gif(frames, "float", duration=55)


def gif_dance() -> None:
    frames = []
    n = 32
    for i in range(n):
        t = i / n
        side = math.sin(t * math.pi * 4)
        hop = -abs(math.sin(t * math.pi * 4)) * 16
        frames.append(
            draw_mascot(
                ox=side * 14,
                oy=hop,
                rot=side * 10,
                scale=1.0 + 0.04 * abs(math.sin(t * math.pi * 4)),
                mouth="grin",
                mouth_open=0.35 + 0.25 * abs(side),
                blush=0.45,
                brow_dy=-12,
                brow_curve=-10,
                ant_l=30 * side,
                ant_r=-30 * side,
                pupil_dx=side * 12,
            )
        )
    save_gif(frames, "dance", duration=40)


def gif_curious() -> None:
    frames = []
    # lean in and look
    for i in range(10):
        t = ease_in_out(i / 9)
        frames.append(
            draw_mascot(
                scale=1.0 + 0.06 * t,
                oy=8 * t,
                rot=6 * t,
                pupil_dx=28 * t,
                pupil_dy=10 * t,
                brow_dy=-12 * t,
                brow_curve=-8 * t,
                mouth="ooo" if t > 0.55 else "smile",
                mouth_open=0.35 * t,
                ant_l=10 * t,
                ant_r=5 * t,
            )
        )
    # hold, blink once
    for i in range(14):
        open_amt = 1.0
        if i in (6, 7):
            open_amt = 0.08
        if i == 8:
            open_amt = 0.55
        frames.append(
            draw_mascot(
                scale=1.06,
                oy=8,
                rot=6,
                pupil_dx=28,
                pupil_dy=10,
                brow_dy=-12,
                brow_curve=-8,
                mouth="ooo",
                mouth_open=0.35,
                eye_open=open_amt,
                ant_l=10 + 2 * math.sin(i * 0.5),
                ant_r=5,
            )
        )
    # ease out
    for i in range(8):
        t = ease_in_out(i / 7)
        frames.append(
            draw_mascot(
                scale=1.06 - 0.06 * t,
                oy=8 * (1 - t),
                rot=6 * (1 - t),
                pupil_dx=28 * (1 - t),
                pupil_dy=10 * (1 - t),
                brow_dy=-12 * (1 - t),
                brow_curve=-8 * (1 - t),
                mouth="smile",
            )
        )
    save_gif(frames, "curious", duration=50)


def gif_yawn() -> None:
    frames = []
    for i in range(8):
        t = ease_in_out(i / 7)
        frames.append(
            draw_mascot(
                eye_open=1.0 - 0.35 * t,
                brow_dy=8 * t,
                mouth="ooo",
                mouth_open=0.3 * t,
            )
        )
    for i in range(14):
        t = i / 13
        open_amt = 0.65 + 0.35 * math.sin(t * math.pi)
        frames.append(
            draw_mascot(
                eye_open=0.35 - 0.2 * math.sin(t * math.pi),
                brow_dy=10,
                brow_curve=6,
                mouth="ooo",
                mouth_open=open_amt,
                scale=1.0 + 0.02 * math.sin(t * math.pi),
                ant_l=-6,
                ant_r=6,
            )
        )
    for i in range(8):
        t = ease_in_out(i / 7)
        frames.append(
            draw_mascot(
                eye_open=0.35 + 0.65 * t,
                brow_dy=10 * (1 - t),
                mouth="ooo" if t < 0.4 else "smile",
                mouth_open=0.65 * (1 - t),
            )
        )
    # little blink after yawn
    for open_amt in (0.4, 0.08, 0.5, 1.0):
        frames.append(draw_mascot(eye_open=open_amt, mouth="smile"))
    save_gif(frames, "yawn", duration=55)


def gif_heartbeat() -> None:
    """Soft scale pulse — calm presence idle."""
    frames = []
    n = 28
    for i in range(n):
        t = i / n
        # lub-dub: two quick peaks then rest
        lub = max(0.0, math.sin(t * math.pi * 2))
        dub = max(0.0, math.sin((t - 0.18) * math.pi * 2)) * 0.55
        beat = lub + dub
        if t > 0.45:
            beat *= max(0.0, 1.0 - (t - 0.45) / 0.55)
        frames.append(
            draw_mascot(
                scale=1.0 + 0.05 * beat,
                oy=-4 * beat,
                mouth="smile",
                blush=0.15 + 0.35 * beat,
                ant_l=4 * beat,
                ant_r=-4 * beat,
            )
        )
    save_gif(frames, "heartbeat", duration=50)


def main() -> None:
    print(f"render {OUT_SIZE}px @ {SS}x supersample ({DRAW_SIZE}px draw) → gif")
    gif_blink()
    gif_bounce()
    gif_look()
    gif_wave()
    gif_happy()
    gif_think()
    gif_spin()
    gif_sleep()
    gif_wink()
    gif_nod()
    gif_shake()
    gif_surprise()
    gif_float()
    gif_dance()
    gif_curious()
    gif_yawn()
    gif_heartbeat()
    print("done")


if __name__ == "__main__":
    main()


