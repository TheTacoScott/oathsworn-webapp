#!/usr/bin/env python3
"""
Generate a starter UI strings block for a new language.

Reads web/js/ui_strings.js, extracts all English keys, and prints an
Object.assign block ready to paste into ui_strings.js. All values are
initially set to the English text as placeholders.

If the target language already has entries in ui_strings.js, only the
missing keys are included in the output (so re-running after new keys
are added only shows gaps).

Usage:
    python3 translations/gen_ui_template.py <lang_code>
    python3 translations/gen_ui_template.py de
    python3 translations/gen_ui_template.py zh

Paste the output into web/js/ui_strings.js, replacing any existing
block for that language (or adding a new one at the end), then translate
each English placeholder value.
"""

import argparse
import json
import os
import re
import sys


LANG_LABELS = {
    'de': 'Deutsch (German)',
    'nl': 'Nederlands (Dutch)',
    'sv': 'Svenska (Swedish)',
    'no': 'Norsk (Norwegian)',
    'da': 'Dansk (Danish)',
    'fr': 'Français (French)',
    'es': 'Español (Spanish)',
    'it': 'Italiano (Italian)',
    'pt': 'Português (Portuguese)',
    'ro': 'Română (Romanian)',
    'pl': 'Polski (Polish)',
    'cs': 'Čeština (Czech)',
    'sk': 'Slovenčina (Slovak)',
    'ru': 'Русский (Russian)',
    'uk': 'Українська (Ukrainian)',
    'hu': 'Magyar (Hungarian)',
    'el': 'Ελληνικά (Greek)',
    'tr': 'Türkçe (Turkish)',
    'he': 'עברית (Hebrew)',
    'ar': 'العربية (Arabic)',
    'ja': '日本語 (Japanese)',
    'ko': '한국어 (Korean)',
    'zh': '中文 (Chinese)',
}


def parse_language_block(content, lang):
    """Extract the dict from STRINGS["lang"] = Object.assign(..., {...}); or plain assignment."""
    # Object.assign form
    m = re.search(
        rf'STRINGS\["{re.escape(lang)}"\]\s*=\s*Object\.assign\([^,]+,\s*(\{{.*?\}})\s*\);',
        content, re.DOTALL
    )
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # Plain assignment form
    m = re.search(
        rf'STRINGS\["{re.escape(lang)}"\]\s*=\s*(\{{.*?\}})\s*;',
        content, re.DOTALL
    )
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return {}


def main():
    parser = argparse.ArgumentParser(
        description='Generate a starter UI strings block for pasting into ui_strings.js.'
    )
    parser.add_argument('lang_code', help='ISO 639-1 language code, e.g. de, fr, zh')
    parser.add_argument('--ui-strings', default=None,
                        help='Path to ui_strings.js (default: auto-detect from script location)')
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)

    if args.ui_strings is None:
        args.ui_strings = os.path.join(repo_root, 'web', 'js', 'ui_strings.js')

    if not os.path.isfile(args.ui_strings):
        print(f"Error: {args.ui_strings} not found.", file=sys.stderr)
        sys.exit(1)

    with open(args.ui_strings, 'r', encoding='utf-8') as f:
        content = f.read()

    en = parse_language_block(content, 'en')
    if not en:
        print("Error: could not parse English block from ui_strings.js.", file=sys.stderr)
        sys.exit(1)

    existing = parse_language_block(content, args.lang_code)
    if existing:
        print(f"# Note: {args.lang_code} already has {len(existing)} key(s) in ui_strings.js.",
              file=sys.stderr)
        print(f"# Showing only the {len(en) - len(existing)} missing key(s).", file=sys.stderr)
        print(file=sys.stderr)

    missing = {k: v for k, v in en.items() if k not in existing}

    if not missing:
        print(f"# All {len(en)} keys are already present for '{args.lang_code}'.",
              file=sys.stderr)
        sys.exit(0)

    label = LANG_LABELS.get(args.lang_code, args.lang_code.upper())
    print(f'// -- {label} {"--" + "-" * max(0, 50 - len(label))}')
    print(f'STRINGS["{args.lang_code}"] = Object.assign(STRINGS["{args.lang_code}"] || {{}}, ')
    print(json.dumps(missing, ensure_ascii=False, indent=2))
    print(');')
    print()
    print(f'// Paste the block above into web/js/ui_strings.js and translate each value.',
          file=sys.stderr)


if __name__ == '__main__':
    main()
