#!/usr/bin/env python3
"""
Generate a starter UI strings translation file for hand editing.

Reads web/data/ui_strings.js, extracts all keys and English values, and
writes a new web/data/strings_XX.js stub with English values as placeholders.
Edit the values in your language, then place the file in web/data/ for the
app to pick it up automatically.

Usage:
    python3 translations/gen_ui_template.py <lang_code>
    python3 translations/gen_ui_template.py de
    python3 translations/gen_ui_template.py zh --output /path/to/strings_zh.js

The output is a self-registering file in the same format as other language
files. If the output path already exists, any keys already present are kept
and only new keys are added (so re-running after ui_strings.js gains new
entries fills in only the gaps).
"""

import argparse
import json
import os
import re
import sys


def parse_ui_strings(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # Match Object.assign pattern used in ui_strings.js
    m = re.search(
        r'STRINGS\[["\']\w+["\']\]\s*=\s*Object\.assign\([^,]+,\s*(\{.*?\})\s*\);',
        content, re.DOTALL
    )
    if not m:
        # Fall back to plain namespaced assignment
        m = re.search(r'STRINGS\[["\']\w+["\']\]\s*=\s*(\{.*?\})\s*;', content, re.DOTALL)
    if not m:
        raise ValueError(f"Could not parse strings from {path}")
    return json.loads(m.group(1))


def parse_existing(path):
    """Return existing translated keys from a strings_XX.js, or {} if absent."""
    if not os.path.isfile(path):
        return {}
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    m = re.search(r'STRINGS\[["\']\w+["\']\]\s*=\s*(\{.*?\})\s*;', content, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except Exception:
        return {}


def write_template(strings, existing, lang_code, output_path, source_path):
    merged = dict(existing)
    added = 0
    for key, value in strings.items():
        if key not in merged:
            merged[key] = value   # English value as placeholder
            added += 1

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(f'// UI strings template for language: {lang_code}\n')
        f.write(f'// Generated from {os.path.basename(source_path)}\n')
        f.write('// Replace each English value with the translation for your language.\n')
        f.write('// Game text (story sections, choices) falls back to English\n')
        f.write('// until a full game translation is available.\n')
        f.write('window.STRINGS = window.STRINGS || {};\n')
        f.write(f'STRINGS["{lang_code}"] = ')
        f.write(json.dumps(merged, ensure_ascii=False, indent=2))
        f.write(';\n')
    return added


def main():
    parser = argparse.ArgumentParser(
        description='Generate a starter UI strings translation file for hand editing.'
    )
    parser.add_argument('lang_code', help='ISO 639-1 language code, e.g. de, fr, zh')
    parser.add_argument('--ui-strings', default=None,
                        help='Path to ui_strings.js (default: auto-detect from script location)')
    parser.add_argument('--output', '-o', default=None,
                        help='Output path (default: web/data/strings_<lang>.js)')
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)

    if args.ui_strings is None:
        args.ui_strings = os.path.join(repo_root, 'web', 'data', 'ui_strings.js')
    if args.output is None:
        args.output = os.path.join(repo_root, 'web', 'data', f'strings_{args.lang_code}.js')

    if not os.path.isfile(args.ui_strings):
        print(f"Error: {args.ui_strings} not found. Run setup.sh first.", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {args.ui_strings}...")
    strings = parse_ui_strings(args.ui_strings)
    print(f"  {len(strings)} keys found")

    existing = parse_existing(args.output)
    if existing:
        print(f"  {len(existing)} keys already in {args.output} - will keep them")

    added = write_template(strings, existing, args.lang_code, args.output, args.ui_strings)
    print(f"  {added} new placeholder(s) written")
    print(f"Output: {args.output}")
    print()
    print("Edit the values in your language, then place the file in web/data/")
    print("to have the app pick it up automatically.")


if __name__ == '__main__':
    main()
