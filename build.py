#!/usr/bin/env python3
"""
Build script for Translation Review Tool Chrome Extension.

Usage:
    python3 build.py

Output:
    translation-review-tool-v{version}.zip  — share this file directly.
    Recipient unzips it and loads the folder as an unpacked extension in Chrome.
"""

import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT     = Path(__file__).parent
MANIFEST = ROOT / 'manifest.json'

INCLUDE = [
    'manifest.json',
    'background.js',
    'content.js',
    'content.css',
    'sidepanel.html',
    'sidepanel.js',
    'sidepanel.css',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
]


def log(msg):
    print(f'  {msg}')


def err(msg):
    print(f'  ✗  {msg}', file=sys.stderr)
    sys.exit(1)


def check_sources():
    missing = [f for f in INCLUDE if not (ROOT / f).exists()]
    if missing:
        err(f"Missing source files: {', '.join(missing)}")
    log('✓  All source files present')


def read_version():
    with open(MANIFEST) as f:
        version = json.load(f).get('version', '1.0.0')
    log(f'✓  Version: {version}')
    return version


def regenerate_icons():
    script = ROOT / 'icons' / 'create_icons.py'
    if not script.exists():
        return
    result = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
    if result.returncode != 0:
        err(f'Icon generation failed:\n{result.stderr}')
    log('✓  Icons regenerated')


def create_zip(version):
    zip_path = ROOT / f'translation-review-tool-v{version}.zip'
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel in INCLUDE:
            zf.write(ROOT / rel, rel)

    size_kb = zip_path.stat().st_size // 1024
    log(f'✓  {zip_path.name}  ({size_kb} KB)')
    return zip_path


def main():
    print()
    print('  Translation Review Tool — Build')
    print()

    check_sources()
    version = read_version()
    regenerate_icons()
    zip_path = create_zip(version)

    print()
    print('  ─────────────────────────────────────────────────────────')
    print(f'  Share:  {zip_path.name}')
    print()
    print('  To install:')
    print('    1. Unzip the file')
    print('    2. Open  chrome://extensions')
    print('    3. Enable  Developer mode  (top-right toggle)')
    print('    4. Click  Load unpacked  → select the unzipped folder')
    print('  ─────────────────────────────────────────────────────────')
    print()


if __name__ == '__main__':
    main()
