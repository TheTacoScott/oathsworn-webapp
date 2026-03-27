#!/usr/bin/env python3
"""
Translate a strings.js file to another language using a local Ollama model.

Intended to run inside the Docker Compose environment defined alongside this
script. The only host dependency is Docker - setup.sh handles everything else.

The output file itself acts as the checkpoint: keys present in the output
but absent from the source are already done. Re-running the same command
resumes from where it left off.

Usage (via setup.sh):
    ./translations/setup.sh web/data/strings.js --language German [options]

Direct usage (inside container):
    python3 translate.py <strings.js> --language German [options]

Arguments:
    strings_js           Path to the source strings.js file
    --language LANG      Target language name, e.g. "German", "French", "Spanish"
    --output PATH        Output path (default: <input>_<lang>.js next to input)
    --model MODEL        Ollama model to use (default: translategemma:4b)
"""

import argparse
import json
import os
import random
import re
import shutil
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

    # Newline count
    orig_nl = original.count('\n')
    trans_nl = translated.count('\n')
    if orig_nl > 0 and trans_nl != orig_nl:
        warnings.append(f"newline count changed ({orig_nl} -> {trans_nl})")

    return warnings


# ---------------------------------------------------------------------------
# strings.js parsing / writing / replacing
# ---------------------------------------------------------------------------

def parse_strings_js(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    m = re.search(r'const STRINGS\s*=\s*(\{.*\});', content, re.DOTALL)
    if not m:
        raise ValueError(f"Could not find STRINGS object in {path}")
    return json.loads(m.group(1))


def replace_strings_js(strings_js_path, translated_path):
    """Swap translated_path into strings_js_path, backing up the original as strings_original.js.

    The backup is only written once - if strings_original.js already exists it is
    left untouched. This means re-running setup.sh (which regenerates strings.js
    from the APK) followed by this script will re-swap correctly without
    clobbering the English backup with a previously-translated strings.js.
    """
    dirpath = os.path.dirname(os.path.abspath(strings_js_path))
    backup_path = os.path.join(dirpath, 'strings_original.js')

    if not os.path.exists(backup_path):
        shutil.copy2(strings_js_path, backup_path)
        print(f"  Backed up original strings to {backup_path}")
    else:
        print(f"  Backup already exists at {backup_path}, leaving it alone")

    shutil.copy2(translated_path, strings_js_path)
    print(f"  Replaced {strings_js_path} with translated version")


def write_strings_js(strings, path, language, source_path):
    """Write a (partial or complete) STRINGS dict to a strings.js file."""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'// Auto-generated: {language} translation of {os.path.basename(source_path)}\n')
        f.write('const STRINGS = ')
        f.write(json.dumps(strings, ensure_ascii=False, indent=2, sort_keys=True))
        f.write(';\n')


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

def translate_string(text, language, model):
    """Send one string to the Ollama API and return the translated text."""
    terms_list = ', '.join(GAME_TERMS)
    prompt = (
        f'Translate the text below to {language}. '
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
    parser.add_argument('strings_js', help='Path to source strings.js')
    parser.add_argument('--language', '-l', required=True,
                        help='Target language name, e.g. German, French, Spanish')
    parser.add_argument('--output', '-o',
                        help='Output path for translated strings.js')
    parser.add_argument('--model', '-m', default='translategemma:4b',
                        help='Ollama model to use (default: translategemma:4b)')
    parser.add_argument('--retries', type=int, default=1, metavar='N',
                        help='Number of times to retry a string after a sanity failure (default: 1)')
    parser.add_argument('--replace', default=True, action=argparse.BooleanOptionalAction,
                        help='Replace strings.js with the translated version once all keys '
                             'are complete with no skips. Backs up the original as '
                             'strings_original.js (only on first run). Default: on.')
    args = parser.parse_args()

    # Resolve output path
    lang_slug = args.language.lower().replace(' ', '_')
    if args.output is None:
        base, _ = os.path.splitext(args.strings_js)
        args.output = f'{base}_{lang_slug}.js'

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
        if args.replace:
            print("\nAll keys complete - replacing strings.js...")
            replace_strings_js(args.strings_js, args.output)
        print(f"\nDone. Output is at {args.output}")
        return

    if not wait_for_ollama(timeout=30):
        print("Error: Ollama did not become ready in time.")
        sys.exit(1)

    ensure_model(args.model)

    print(f"\nTranslating {len(remaining)} strings to {args.language} using {args.model}...")
    print(f"  Output: {args.output}\n")

    for key, value in remaining:
        if not value or not value.strip():
            done_keys[key] = value
        else:
            try:
                result = translate_string(value, args.language, args.model)
                warnings = check_translation(value, result)
                for attempt in range(args.retries):
                    if not warnings:
                        break
                    print(f"  SANITY FAIL [{key}]: {', '.join(warnings)}", flush=True)
                    print(f"  Bad output: {result!r}", flush=True)
                    print(f"  Retrying ({attempt + 1}/{args.retries})...", flush=True)
                    result = translate_string(value, args.language, args.model)
                    warnings = check_translation(value, result)
                if warnings:
                    print(f"  SANITY FAIL [{key}]: {', '.join(warnings)}", flush=True)
                    print(f"  Bad output: {result!r}", flush=True)
                    print(f"  Skipping '{key}' - will retry on next run", flush=True)
                else:
                    done_keys[key] = result
            except Exception as e:
                print(f"  WARNING: failed on '{key}': {e} - skipping", flush=True)

        # Write output file after each string - it is the checkpoint
        write_strings_js(done_keys, args.output, args.language, args.strings_js)

        print(f"  [{len(done_keys)}/{total} {len(done_keys)/total*100:.1f}%] {key}", flush=True)

    # Re-write with keys in original source order
    translated = {k: done_keys[k] for k in strings if k in done_keys}
    write_strings_js(translated, args.output, args.language, args.strings_js)

    skipped = total - len(done_keys)
    if skipped:
        print(f"\n{skipped} key(s) skipped due to failures - run again to retry them.")
        print(f"Output (partial) written to {args.output}")
    else:
        print(f"\nAll {total} keys translated successfully.")
        if args.replace:
            print("Replacing strings.js...")
            replace_strings_js(args.strings_js, args.output)
        print(f"Done. Output written to {args.output}")


if __name__ == '__main__':
    main()
