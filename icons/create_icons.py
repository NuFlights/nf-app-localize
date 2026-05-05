#!/usr/bin/env python3
"""Generate PNG icon files for the Translation Review extension.
Run from the extension root:  python3 icons/create_icons.py
No external dependencies — uses only stdlib.
"""

import struct
import zlib
import os

BLUE = (37, 99, 235)   # #2563eb
WHITE = (255, 255, 255)


def make_png(size: int, bg: tuple = BLUE, fg: tuple = WHITE) -> bytes:
    """Build a minimal valid PNG with a rounded-corner blue square design."""

    def chunk(name: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", crc)

    r = max(size // 6, 1)   # corner radius (pixels)
    rows = []

    for y in range(size):
        row = bytearray([0])  # filter byte: None
        for x in range(size):
            # Rounded square: treat corners within radius as transparent/white
            cx = min(x, size - 1 - x)
            cy = min(y, size - 1 - y)
            if cx < r and cy < r:
                dist_sq = (r - cx - 1) ** 2 + (r - cy - 1) ** 2
                pixel = bg if dist_sq <= r * r else WHITE
            else:
                pixel = bg
            row += bytearray(pixel)
        rows.append(bytes(row))

    raw = b"".join(rows)
    compressed = zlib.compress(raw, 9)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )


def main():
    out_dir = os.path.dirname(__file__)
    for size in (16, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(make_png(size))
        print(f"  Created {path}  ({size}×{size})")
    print("Done.")


if __name__ == "__main__":
    main()
