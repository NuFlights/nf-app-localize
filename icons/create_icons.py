#!/usr/bin/env python3
"""Generate PNG icon files for the Translation Review extension."""

import struct
import zlib
import os


BLUE  = (37, 99, 235)
WHITE = (255, 255, 255)


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


def make_icon(size: int) -> bytes:
    s = size
    pixels = _canvas(s, BLUE)
    _rounded_bg(pixels, s, max(s // 5, 2))

    if s == 16:
        # "T" — 2 px thick crossbar, 2 px wide stem
        _rect(pixels,  3,  3, 10, 2, WHITE, s)   # crossbar
        _rect(pixels,  7,  3,  2, 10, WHITE, s)  # stem

    elif s == 48:
        # "T" with a subtle translation-arrow hint below the stem
        _rect(pixels,  7,  8, 34,  5, WHITE, s)  # crossbar
        _rect(pixels, 21,  8,  6, 30, WHITE, s)  # stem

        # small right-arrow  ——>
        ay = 41
        _rect(pixels,  8, ay, 24, 3, WHITE, s)   # shaft
        # arrowhead: 3 rows, each offset by 1
        for i, (ax, aw) in enumerate([(32,3),(35,3),(38,3)]):
            _rect(pixels, ax, ay - i, aw, 3 + i * 2, WHITE, s)

    elif s == 128:
        # "T"
        _rect(pixels, 16, 16, 96, 14, WHITE, s)  # crossbar
        _rect(pixels, 57, 16, 14, 58, WHITE, s)  # stem

        # right-arrow  ——>  below the T
        ay = 90
        sh = 8   # shaft height
        _rect(pixels, 16, ay, 68, sh, WHITE, s)  # shaft

        # arrowhead: 5 columns tapering outward
        for i in range(5):
            col_x = 84 + i * 5
            spread = i * sh // 4
            _rect(pixels, col_x, ay - spread, 5, sh + spread * 2, WHITE, s)

        # two short "language" lines at bottom — source / target
        _rect(pixels, 16, 112, 36, 5, WHITE, s)  # source lang bar
        _rect(pixels, 76, 112, 36, 5, WHITE, s)  # target lang bar

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
