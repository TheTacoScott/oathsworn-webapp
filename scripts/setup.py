#!/usr/bin/env python3
"""
setup.py - One-shot setup for the Oathsworn web companion app.

Downloads the APK from Google Drive, decompiles it with jadx,
and generates all web data files.

Usage:
    python3 scripts/setup.py [--apk PATH]

Options:
    --apk PATH    Use a local APK file instead of downloading
"""

import os
import sys
import shutil
import subprocess
import argparse

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Directory used to cache the downloaded APK between runs.
# Defaults to /cache (the Docker default); override with APK_CACHE_DIR env var.
APK_CACHE_DIR = os.environ.get('APK_CACHE_DIR', '/cache')
CACHED_APK = os.path.join(APK_CACHE_DIR, 'oathsworn.apk')
CACHED_APK_DE = os.path.join(APK_CACHE_DIR, 'oathsworn_de.apk')

# Sharing URLs for the three APK versions on Google Drive
APK_DRIVE_URLS = [
    'https://drive.google.com/file/d/19I2BNjdLALwjcJA4Ssz7gDNUhBlYEBLY/view?usp=drive_link',
    'https://drive.google.com/file/d/1AT4AtK8KBQikssSJejQHedcuEElDUkxq/view?usp=drive_link',
    'https://drive.google.com/file/d/1QUtQbaeUKrc31m8UwbuXcSRaIfefvpXO/view?usp=drive_link',
]

# German APK mirrors (contains full German strings.xml at res/values/strings.xml)
APK_DE_DRIVE_URLS = [
    'https://drive.google.com/file/d/11F_UkgX92eq9eBQDn7eY7G5lRsl7KD3m/view',
    'https://drive.google.com/file/d/1ftOw0kdLL68_6OTEUY9TTuZe0SX_4pZI/view',
    'https://drive.google.com/file/d/1k7L_BvWOTrfc4_YabMkagmIh9invaE3f/view',
]

APK_SHA256 = '0c1c0b496969ff3a33019db46506350d796000a17606617690c261eedfa9bc96'
APK_DE_SHA256 = 'bd243191111bff0f9ce7c7b25ba8b06ca6829008cbec758ff4cb2399bbdb03d5'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def banner(title):
    width = 60
    inner = width - 8  # "=== " + " ===" = 8 chars
    line = '=' * width
    print(f"\n{line}")
    print(f"=== {title.center(inner)} ===")
    print(line)


def ensure_gdown():
    """Import gdown, installing it via pip if necessary."""
    try:
        import gdown
        return gdown
    except ImportError:
        pass
    print("  gdown not found - installing via pip...")
    result = subprocess.run(
        [sys.executable, '-m', 'pip', 'install', 'gdown'],
        capture_output=True,
    )
    if result.returncode != 0:
        print("  Error: pip install gdown failed.")
        print("  Install manually:  pip install gdown")
        return None
    import gdown
    return gdown


def verify_sha256(path, expected):
    """Return True if the file's SHA256 matches expected."""
    import hashlib
    sha = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            sha.update(chunk)
    actual = sha.hexdigest()
    if actual != expected:
        print(f"  Error: SHA256 mismatch for {path}")
        print(f"  Expected: {expected}")
        print(f"  Got:      {actual}")
        return False
    return True


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

def step_download(dest_path):
    banner("Download APK")
    gdown = ensure_gdown()
    if gdown is None:
        return False

    for i, url in enumerate(APK_DRIVE_URLS, 1):
        print(f"  [{i}/{len(APK_DRIVE_URLS)}] {url}")
        try:
            output = gdown.download(url, dest_path, quiet=False, fuzzy=True)
        except Exception as e:
            print(f"  Failed: {e}")
            output = None

        if output and os.path.exists(dest_path):
            print(f"  Downloaded: {dest_path}")
            return True

    print("  Error: all download sources failed.")
    return False


_DECOMPILE_REQUIRED = [
    # Core string resources
    os.path.join('app', 'src', 'main', 'res', 'values', 'strings.xml'),
    # Representative chapter Java file
    os.path.join('app', 'src', 'main', 'java', 'com', 'shadowborne_games', 'oathsworn', 'book', 'Chapter1.java'),
    # Audio directory
    os.path.join('app', 'src', 'main', 'res', 'raw'),
]


def step_decompile(apk_path):
    banner("Decompile APK")

    app_dir = os.path.join(REPO_ROOT, 'app')
    if os.path.isdir(app_dir):
        print(f"  Removing existing {app_dir}")
        shutil.rmtree(app_dir)

    print(f"  Source: {apk_path}")
    print(f"  Output: {REPO_ROOT}")
    subprocess.run([
        'jadx',
        '-q',
        '--export-gradle',
        '--export-gradle-type', 'android-app',
        '-d', REPO_ROOT,
        apk_path,
    ])

    missing = [p for p in _DECOMPILE_REQUIRED if not os.path.exists(os.path.join(REPO_ROOT, p))]
    if missing:
        print("  Error: decompile did not produce expected output:")
        for p in missing:
            print(f"    missing: {p}")
        sys.exit(1)

    print("  Decompile complete.")


def step_download_german():
    banner("Download German APK")
    gdown = ensure_gdown()
    if gdown is None:
        return False

    for i, url in enumerate(APK_DE_DRIVE_URLS, 1):
        print(f"  [{i}/{len(APK_DE_DRIVE_URLS)}] {url}")
        try:
            output = gdown.download(url, CACHED_APK_DE, quiet=False, fuzzy=True)
        except Exception as e:
            print(f"  Failed: {e}")
            output = None

        if output and os.path.exists(CACHED_APK_DE):
            print(f"  Downloaded: {CACHED_APK_DE}")
            return True

    print("  Error: all German APK download sources failed.")
    return False


_DE_STRINGS_SRC = os.path.join('app', 'src', 'main', 'res', 'values', 'strings.xml')


def step_extract_german_strings(apk_path):
    banner("Extract German Strings")
    de_res_dir = '/tmp/oathsworn_de_res'

    if os.path.isdir(de_res_dir):
        shutil.rmtree(de_res_dir)

    print(f"  Source: {apk_path}")
    print(f"  Extracting resources to: {de_res_dir}")
    subprocess.run([
        'jadx',
        '-q',
        '-s',           # skip source decompilation - we only need resources
        '-dr', de_res_dir,
        apk_path,
    ])

    de_strings_path = os.path.join(de_res_dir, 'res', 'values', 'strings.xml')
    if not os.path.isfile(de_strings_path):
        print(f"  Error: strings.xml not found at {de_strings_path}")
        sys.exit(1)

    dest = os.path.join(REPO_ROOT, _DE_STRINGS_SRC)
    shutil.copy2(de_strings_path, dest)
    print(f"  Replaced {dest} with German strings.")

    shutil.rmtree(de_res_dir)


def step_generate():
    banner("Generate web data")
    script = os.path.join(REPO_ROOT, 'scripts', 'generate_data.py')
    result = subprocess.run([sys.executable, script])
    return result.returncode == 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Download, decompile, and generate data for the Oathsworn web app.',
    )
    parser.add_argument(
        '--apk',
        help='Skip download and use this local APK file instead',
    )
    args = parser.parse_args()

    # Determine APK path
    if args.apk:
        if not os.path.isfile(args.apk):
            print(f"Error: APK not found: {args.apk}")
            sys.exit(1)
        apk_path = args.apk
        print(f"Using local APK: {apk_path}")
    elif os.path.isfile(CACHED_APK):
        apk_path = CACHED_APK
        banner("Download APK")
        print(f"  Using cached APK: {CACHED_APK}")
    else:
        os.makedirs(APK_CACHE_DIR, exist_ok=True)
        apk_path = CACHED_APK
        if not step_download(apk_path):
            sys.exit(1)

    # Verify APK integrity
    banner("Verifying APK")
    if not verify_sha256(apk_path, APK_SHA256):
        sys.exit(1)
    print("  SHA256 OK.")

    # Decompile
    step_decompile(apk_path)

    # German strings: download German APK and swap in its strings.xml
    if os.environ.get('OATHSWORN_GERMAN', '').lower() == 'true':
        if os.path.isfile(CACHED_APK_DE):
            banner("Download German APK")
            print(f"  Using cached German APK: {CACHED_APK_DE}")
        else:
            if not step_download_german():
                sys.exit(1)
        banner("Verifying German APK")
        if not verify_sha256(CACHED_APK_DE, APK_DE_SHA256):
            sys.exit(1)
        print("  SHA256 OK.")
        step_extract_german_strings(CACHED_APK_DE)

    # Generate data
    if not step_generate():
        sys.exit(1)

    banner("Fixing File Ownership")

    # Fix ownership of bind-mounted output directories so files aren't root-owned
    # on the host. HOST_UID/HOST_GID are passed in from setup.sh.
    host_uid = os.environ.get('HOST_UID')
    host_gid = os.environ.get('HOST_GID')
    if host_uid and host_gid:
        data_dir = os.path.join(REPO_ROOT, 'web', 'data')
        print(f"\nFixing file ownership to {host_uid}:{host_gid}...")
        subprocess.run(
            ['chown', '-R', f'{host_uid}:{host_gid}', data_dir, APK_CACHE_DIR],
            check=True,
        )

if __name__ == '__main__':
    main()
