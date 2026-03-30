#!/usr/bin/env python3
"""
Translate a strings.js file to another language using a local Ollama model.

Intended to run inside the Docker Compose environment defined alongside this
script. The only host dependency is Docker - setup.sh handles everything else.

Produces a sidecar file (e.g. strings_fr.js) that registers the translation
into window.STRINGS["fr"]. The source strings.js is never modified.

The output file itself acts as the checkpoint: keys present in the output
but absent from the source are already done. Re-running the same command
resumes from where it left off.

Usage (via setup.sh):
    ./translations/setup.sh web/data/strings.js --language French [options]

Direct usage (inside container):
    python3 translate.py <strings.js> --language French [options]

Arguments:
    strings_js           Path to the source English strings.js file
    --lang CODE          ISO 639-1 language code, e.g. "fr", "es", "ja"
    --output PATH        Output path (default: strings_<lang>.js next to input)
    --model MODEL        Ollama model to use (default: translategemma:4b)
"""

import argparse
import json
import math
import os
import random
import re
import sys
import time
import urllib.request
import urllib.error

OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')


# ---------------------------------------------------------------------------
# Sanity check configuration
# ---------------------------------------------------------------------------

# Game-specific terms that must not be translated.
# Injected into the prompt and verified in output.
GAME_TERMS = [
    'Oathsworn',
    'Deepwood',
]

# Substrings that indicate the model responded with something other than a
# translation. Add to this list as new bad patterns are discovered.
BAD_OUTPUT_PATTERNS = [
    'Google Translate',
    'Microsoft Translator',
    'DeepL',
    'I cannot translate',
    "I'm unable to translate",
    'I am unable to translate',
    'I cannot provide',
    'As an AI',
]

# Translated text length must be within this ratio of the original.
LENGTH_RATIO_MIN = 0.2
LENGTH_RATIO_MAX = 8.0


def check_translation(original, translated):
    """Return a list of warning strings, empty if the translation looks ok."""
    warnings = []

    # Bad output patterns
    for pattern in BAD_OUTPUT_PATTERNS:
        if pattern.lower() in translated.lower():
            warnings.append(f"contains bad pattern: {pattern!r}")

    # Length ratio
    if original.strip():
        ratio = len(translated) / max(len(original), 1)
        if ratio < LENGTH_RATIO_MIN or ratio > LENGTH_RATIO_MAX:
            warnings.append(f"length ratio {ratio:.1f} outside [{LENGTH_RATIO_MIN}, {LENGTH_RATIO_MAX}]")

    # Game terms preservation
    for term in GAME_TERMS:
        if term in original and term not in translated:
            warnings.append(f"game term {term!r} not preserved")

    # Newline count: allow +/- 20% (rounded down)
    orig_nl = original.count('\n')
    trans_nl = translated.count('\n')
    if orig_nl > 0:
        min_nl = math.floor(orig_nl * 0.8)
        max_nl = math.ceil(orig_nl * 1.2)
        if trans_nl < min_nl or trans_nl > max_nl:
            warnings.append(f"newline count {trans_nl} outside [{min_nl}, {max_nl}]")

    return warnings


# ---------------------------------------------------------------------------
# Language code -> human-readable name
# ---------------------------------------------------------------------------

LANGUAGE_NAMES = {
    # Germanic
    'af': 'Afrikaans',
    'da': 'Danish',
    'de': 'German',
    'is': 'Icelandic',
    'nl': 'Dutch',
    'no': 'Norwegian',
    'sv': 'Swedish',
    # Romance
    'ca': 'Catalan',
    'es': 'Spanish',
    'fr': 'French',
    'gl': 'Galician',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ro': 'Romanian',
    # Slavic
    'bg': 'Bulgarian',
    'bs': 'Bosnian',
    'cs': 'Czech',
    'hr': 'Croatian',
    'mk': 'Macedonian',
    'pl': 'Polish',
    'ru': 'Russian',
    'sk': 'Slovak',
    'sl': 'Slovenian',
    'sr': 'Serbian',
    'uk': 'Ukrainian',
    # Baltic / Finno-Ugric
    'et': 'Estonian',
    'fi': 'Finnish',
    'hu': 'Hungarian',
    'lt': 'Lithuanian',
    'lv': 'Latvian',
    # Other European
    'el': 'Greek',
    'sq': 'Albanian',
    # Middle Eastern / South Asian
    'ar': 'Arabic',
    'bn': 'Bengali',
    'fa': 'Persian',
    'he': 'Hebrew',
    'hi': 'Hindi',
    'tr': 'Turkish',
    'ur': 'Urdu',
    # Caucasian / Central Asian
    'hy': 'Armenian',
    'ka': 'Georgian',
    'kk': 'Kazakh',
    'uz': 'Uzbek',
    # East / Southeast Asian
    'id': 'Indonesian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ms': 'Malay',
    'th': 'Thai',
    'vi': 'Vietnamese',
    'zh': 'Chinese',
}


def language_display_name(lang_code):
    """Return the human-readable name for a language code, or None if unknown."""
    return LANGUAGE_NAMES.get(lang_code.lower())


# ---------------------------------------------------------------------------
# strings.js parsing / writing
# ---------------------------------------------------------------------------


def parse_strings_js(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # New namespaced format: STRINGS["en"] = { ... }; or STRINGS['en'] = { ... };
    m = re.search(r'STRINGS\[["\']\w+["\']\]\s*=\s*(?:Object\.assign\([^,]+,\s*)?(\{.*?\})\s*\)?;', content, re.DOTALL)
    if m:
        return json.loads(m.group(1))
    # Old flat format: const STRINGS = { ... };
    m = re.search(r'const STRINGS\s*=\s*(\{.*\});', content, re.DOTALL)
    if m:
        return json.loads(m.group(1))
    raise ValueError(f"Could not find STRINGS object in {path}")


def write_strings_js(strings, path, lang_code, source_path):
    """Write a (partial or complete) STRINGS dict to a strings_XX.js sidecar file."""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'// Auto-generated: {lang_code} translation of {os.path.basename(source_path)}\n')
        f.write('window.STRINGS = window.STRINGS || {};\n')
        f.write(f'STRINGS["{lang_code}"] = Object.assign(STRINGS["{lang_code}"] || {{}}, ')
        f.write(json.dumps(strings, ensure_ascii=False, indent=2, sort_keys=True))
        f.write(');\n')


# ---------------------------------------------------------------------------
# Ollama management
# ---------------------------------------------------------------------------

def wait_for_ollama(timeout=30):
    print("Waiting for Ollama to be ready...", end='', flush=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f'{OLLAMA_URL}/api/tags', timeout=2)
            print(" ready.")
            return True
        except Exception:
            print('.', end='', flush=True)
            time.sleep(1)
    print(" timed out.")
    return False


def ensure_model(model):
    """Pull the model via the Ollama HTTP API if not already present."""
    try:
        resp = urllib.request.urlopen(f'{OLLAMA_URL}/api/tags', timeout=5)
        data = json.loads(resp.read())
        installed = [m['name'] for m in data.get('models', [])]
        base = model.split(':')[0]
        if any(m.startswith(base) for m in installed):
            print(f"Model {model} already available.")
            return
    except Exception:
        pass

    print(f"Pulling model {model} (this may take a while on first run)...")
    payload = json.dumps({'name': model}).encode('utf-8')
    req = urllib.request.Request(
        f'{OLLAMA_URL}/api/pull',
        data=payload,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        for line in resp:
            if line.strip():
                try:
                    status = json.loads(line).get('status', '')
                    if status:
                        print(f"  {status}")
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------

def translate_string(text, lang_code, model):
    """Send one string to the Ollama API and return the translated text."""
    terms_list = ', '.join(GAME_TERMS)
    name = language_display_name(lang_code)
    if name:
        target_phrase = f'to {name}'
    else:
        target_phrase = f'to the language with ISO 639-1 code "{lang_code}"'
    prompt = (
        f'You are translating narrative text from a cooperative fantasy board game storybook. '
        f'The text may contain story passages, player instructions, or choice menus (e.g. "Choose one:" followed by options). '
        f'Translate every line completely - do not pick or act on any choices, just translate all of the text as-is. '
        f'Translate the text below {target_phrase}. '
        f'Return only the translated text with no explanation, quotes, or commentary. '
        f'Preserve all newlines and punctuation. '
        f'Do not translate proper nouns or game-specific terms: {terms_list}.\n\n'
        f'Text to translate:\n{text}'
    )
    payload = json.dumps({
        'model': model,
        'prompt': prompt,
        'stream': False,
    }).encode('utf-8')
    req = urllib.request.Request(
        f'{OLLAMA_URL}/api/generate',
        data=payload,
        headers={'Content-Type': 'application/json'},
    )
    resp = urllib.request.urlopen(req, timeout=300)
    return json.loads(resp.read())['response'].strip()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Translate strings.js to another language using a local Ollama model.'
    )
    parser.add_argument('strings_js', help='Path to source English strings.js')
    parser.add_argument('--lang', '-l', required=True, metavar='CODE',
                        help='ISO 639-1 language code, e.g. fr, es, ja')
    parser.add_argument('--output', '-o',
                        help='Output path for the translated sidecar file')
    parser.add_argument('--model', '-m', default='translategemma:4b',
                        help='Ollama model to use (default: translategemma:4b)')
    parser.add_argument('--retries', type=int, default=1, metavar='N',
                        help='Number of times to retry a string after a sanity failure (default: 1)')
    args = parser.parse_args()

    lang_code = args.lang.lower().strip()
    if not lang_code.isalpha() or len(lang_code) < 2:
        print(f"Error: --lang must be an ISO 639-1 language code (e.g. fr, es, ja), got {args.lang!r}")
        sys.exit(1)

    lang_name = language_display_name(lang_code)
    if lang_name:
        print(f"Language: {lang_name} ({lang_code})")
    else:
        print(f"Language: {lang_code} (unknown code, will pass code directly to model)")

    # Resolve output path
    if args.output is None:
        base, _ = os.path.splitext(args.strings_js)
        args.output = f'{base}_{lang_code}.js'

    # Parse source strings
    print(f"Reading {args.strings_js}...")
    strings = parse_strings_js(args.strings_js)
    total = len(strings)
    print(f"  {total} strings found")

    # Load existing output as checkpoint: keys present there are already done
    done_keys = {}
    if os.path.isfile(args.output):
        done_keys = parse_strings_js(args.output)
        print(f"  Resuming: {len(done_keys)}/{total} already translated")

    remaining = [(k, v) for k, v in strings.items() if k not in done_keys]
    if not remaining:
        print("  Nothing left to translate.")
        print(f"\nDone. Output is at {args.output}")
        return

    if not wait_for_ollama(timeout=30):
        print("Error: Ollama did not become ready in time.")
        sys.exit(1)

    ensure_model(args.model)

    print(f"\nTranslating {len(remaining)} strings to {lang_name or lang_code} using {args.model}...")
    print(f"  Output: {args.output}\n")

    for key, value in random.sample(remaining,k=len(remaining)):
        if not value or not value.strip():
            done_keys[key] = value
        else:
            try:
                result = translate_string(value, lang_code, args.model)
                warnings = check_translation(value, result)
                for attempt in range(args.retries):
                    if not warnings:
                        break
                    print(f"  SANITY FAIL [{key}]: {', '.join(warnings)}", flush=True)
                    print(f"  Input:      {value!r}", flush=True)
                    print(f"  Bad output: {result!r}", flush=True)
                    print(f"  Retrying ({attempt + 1}/{args.retries})...", flush=True)
                    result = translate_string(value, lang_code, args.model)
                    warnings = check_translation(value, result)
                if warnings:
                    print(f"  SANITY FAIL [{key}]: {', '.join(warnings)}", flush=True)
                    print(f"  Input:      {value!r}", flush=True)
                    print(f"  Bad output: {result!r}", flush=True)
                    print(f"  Skipping '{key}' - will retry on next run", flush=True)
                else:
                    done_keys[key] = result
            except Exception as e:
                print(f"  WARNING: failed on '{key}': {e} - skipping", flush=True)

        # Write output file after each string - it is the checkpoint
        write_strings_js(done_keys, args.output, lang_code, args.strings_js)

        print(f"  [{len(done_keys)}/{total} {len(done_keys)/total*100:.1f}%] {key}", flush=True)

    # Re-write with keys in original source order
    translated = {k: done_keys[k] for k in strings if k in done_keys}
    write_strings_js(translated, args.output, lang_code, args.strings_js)

    skipped = total - len(done_keys)
    if skipped:
        print(f"\n{skipped} key(s) skipped due to failures - run again to retry them.")
        print(f"Output (partial) written to {args.output}")
    else:
        print(f"\nAll {total} keys translated successfully.")
        print(f"Done. Output written to {args.output}")


if __name__ == '__main__':
    main()
