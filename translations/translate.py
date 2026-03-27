#!/usr/bin/env python3
"""
Translate a strings.js file to another language using a local Ollama model.

The Ollama container is started once, all strings are translated, then it
is stopped. The output file itself acts as the checkpoint: keys present in
the output but missing from the source are skipped on resume. Re-running
the same command continues from where it left off.

Usage:
    python3 translations/translate.py <strings.js> --language German [options]

Arguments:
    strings_js           Path to the source strings.js file
    --language LANG      Target language name, e.g. "German", "French", "Spanish"
    --output PATH        Output path (default: <input>_<lang>.js next to input)
    --model MODEL        Ollama model to use (default: translategemma:4b)
"""

import argparse
import json
import os
import re
import sys
import time
import subprocess
import urllib.request
import urllib.error

OLLAMA_URL = 'http://localhost:11434'
DOCKER_IMAGE = 'oathsworn-translation'
CONTAINER_NAME = 'oathsworn-translate-runner'
OLLAMA_VOLUME = 'oathsworn-ollama-models'


# ---------------------------------------------------------------------------
# strings.js parsing / writing
# ---------------------------------------------------------------------------

def parse_strings_js(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    m = re.search(r'const STRINGS\s*=\s*(\{.*\});', content, re.DOTALL)
    if not m:
        raise ValueError(f"Could not find STRINGS object in {path}")
    return json.loads(m.group(1))


def write_strings_js(strings, path, language, source_path):
    """Write a (partial or complete) STRINGS dict to a strings.js file."""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'// Auto-generated: {language} translation of {os.path.basename(source_path)}\n')
        f.write('const STRINGS = ')
        f.write(json.dumps(strings, ensure_ascii=False, indent=2))
        f.write(';\n')


# ---------------------------------------------------------------------------
# Docker / Ollama management
# ---------------------------------------------------------------------------

def build_image():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    print("Building Docker image...")
    subprocess.run(['docker', 'build', '-t', DOCKER_IMAGE, script_dir], check=True)


def start_container():
    # Clean up any leftover container from a previous interrupted run
    subprocess.run(['docker', 'rm', '-f', CONTAINER_NAME], capture_output=True)
    subprocess.run([
        'docker', 'run', '-d',
        '--name', CONTAINER_NAME,
        '-p', '11434:11434',
        '-v', f'{OLLAMA_VOLUME}:/root/.ollama',
        DOCKER_IMAGE,
    ], check=True)


def stop_container():
    subprocess.run(['docker', 'stop', CONTAINER_NAME], capture_output=True)
    subprocess.run(['docker', 'rm', CONTAINER_NAME], capture_output=True)


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
    """Pull the model if not already present in the volume."""
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
    subprocess.run(['docker', 'exec', CONTAINER_NAME, 'ollama', 'pull', model], check=True)


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------

def translate_string(text, language, model):
    """Send one string to the Ollama API and return the translated text."""
    prompt = (
        f'Translate the following text to {language}. '
        f'Return only the translated text with no explanation, quotes, or commentary. '
        f'Preserve all newlines, punctuation, and do not translate proper nouns or character names.\n\n'
        f'{text}'
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
        print(f"Done. Output is at {args.output}")
        return

    # Start container
    build_image()
    print("Starting Ollama container...")
    start_container()
    try:
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
                    done_keys[key] = translate_string(value, args.language, args.model)
                except Exception as e:
                    print(f"  WARNING: failed on '{key}': {e} - keeping original")
                    done_keys[key] = value

            # Write output file after each string - it is the checkpoint
            write_strings_js(done_keys, args.output, args.language, args.strings_js)

            print(f"  [{len(done_keys)}/{total} {len(done_keys)/total*100:.1f}%] {key}")

        # Re-write with keys in original source order
        translated = {k: done_keys[k] for k in strings if k in done_keys}
        write_strings_js(translated, args.output, args.language, args.strings_js)
        print(f"\nDone. Written to {args.output}")

    finally:
        print("Stopping container...")
        stop_container()


if __name__ == '__main__':
    main()
