#!/usr/bin/env python3
"""Generate PNG icon files for the Translation Review extension — Nuflights theme."""

import struct
import zlib
import math
import os

MAROON = (163, 21, 23)
WHITE  = (255, 255, 255)
BG     = (0, 0, 0, 0)  # unused — kept for reference


def _chunk(name: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(name + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + name + data + struct.pack(">I", crc)


def _encode_png(pixels: list, size: int) -> bytes:
    rows = []
    for row in pixels:
        scanline = bytearray([0])
        for r, g, b in row:
            scanline += bytes([r, g, b])
        rows.append(bytes(scanline))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def _canvas(size: int, color: tuple) -> list:
    return [[color] * size for _ in range(size)]


def _set(pixels, x, y, color, size):
    if 0 <= x < size and 0 <= y < size:
        pixels[y][x] = color


def _rect(pixels, x0, y0, w, h, color, size):
    for dy in range(max(h, 0)):
        for dx in range(max(w, 0)):
            _set(pixels, x0 + dx, y0 + dy, color, size)


def _rounded_bg(pixels, size, radius):
    r = radius
    for y in range(size):
        for x in range(size):
            cx = min(x, size - 1 - x)
            cy = min(y, size - 1 - y)
            if cx < r and cy < r:
                if (r - cx - 1) ** 2 + (r - cy - 1) ** 2 > r * r:
                    pixels[y][x] = WHITE


def _draw_globe(pixels, size, cx, cy, r, thick, color):
    """Draw a globe: circle outline + equator + meridian + two latitude bands."""
    # Outer circle
    for angle_deg in range(0, 360):
        a = math.radians(angle_deg)
        for t in range(thick):
            rad = r - t
            x = int(round(cx + rad * math.cos(a)))
            y = int(round(cy + rad * math.sin(a)))
            _set(pixels, x, y, color, size)

    # Equator (horizontal line through centre)
    for x in range(cx - r + thick, cx + r - thick + 1):
        for t in range(thick):
            _set(pixels, x, cy - t // 2, color, size)

    # Prime meridian (vertical ellipse — simplified as vertical line)
    for y in range(cy - r + thick, cy + r - thick + 1):
        for t in range(thick):
            _set(pixels, cx - t // 2, y, color, size)

    # Upper latitude line (1/3 above equator)
    lat_y = cy - r // 3
    lat_half = int(round(math.sqrt(max(0, r * r - (lat_y - cy) ** 2))))
    for x in range(cx - lat_half + thick, cx + lat_half - thick + 1):
        for t in range(thick):
            _set(pixels, x, lat_y - t // 2, color, size)

    # Lower latitude line (1/3 below equator)
    lat_y2 = cy + r // 3
    for x in range(cx - lat_half + thick, cx + lat_half - thick + 1):
        for t in range(thick):
            _set(pixels, x, lat_y2 - t // 2, color, size)


def make_icon(size: int) -> bytes:
    s = size
    pixels = _canvas(s, MAROON)
    _rounded_bg(pixels, s, max(s // 5, 2))

    if s == 16:
        cx, cy, r, thick = 8, 8, 5, 1
    elif s == 48:
        cx, cy, r, thick = 24, 24, 17, 2
    else:  # 128
        cx, cy, r, thick = 64, 64, 46, 3

    _draw_globe(pixels, s, cx, cy, r, thick, WHITE)
    return _encode_png(pixels, s)


def main():
    out_dir = os.path.dirname(os.path.abspath(__file__))
    for size in (16, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(make_icon(size))
        print(f"  Created {path}  ({size}x{size})")
    print("Done.")


if __name__ == "__main__":
    main()
