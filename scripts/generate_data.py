#!/usr/bin/env python3
"""
Generate web app data files from Android app resources.
Produces:
  web/data/strings.js          - all game strings from strings.xml
  web/data/chapters/init.js    - declares const CHAPTERS = {}
  web/data/chapters/chapter_N.js - one file per chapter (N = internal chapter number)
  web/data/images.js           - map of image name -> file extension (jpg or png)
  web/data/images/             - game images copied from drawable-land-xxxhdpi/
  web/data/audio/              - audio tracks copied from res/raw/
"""

import re
import json
import os
import shutil
from PIL import Image, ImageDraw, ImageFilter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(BASE_DIR, 'app', 'src', 'main')
JAVA_DIR = os.path.join(APP_DIR, 'java', 'com', 'shadowborne_games', 'oathsworn')
RES_DIR = os.path.join(APP_DIR, 'res')
OUT_DIR = os.path.join(BASE_DIR, 'web', 'data')
IMAGE_DIR = os.path.join(RES_DIR, 'drawable-land-xxxhdpi')
DRAWABLE_DIR = os.path.join(RES_DIR, 'drawable')
AUDIO_DIR = os.path.join(RES_DIR, 'raw')
OUT_IMAGE_DIR = os.path.join(OUT_DIR, 'images')
OUT_AUDIO_DIR = os.path.join(OUT_DIR, 'audio')
OUT_CHAPTERS_DIR = os.path.join(OUT_DIR, 'chapters')
OUT_UI_DIR = os.path.join(OUT_DIR, 'ui')
OUT_UI_CHAPTERS_DIR = os.path.join(OUT_DIR, 'ui', 'chapters')

# Specific assets used by the web UI itself (not game content images)
UI_ASSETS = [
    'oathsworn_logo.png',
    'oathsworn_background.jpg',
]

# UI assets sourced from res/drawable (not drawable-land-xxxhdpi)
DRAWABLE_UI_ASSETS = [
    'info.png',
    'settings.png',
    'play_next.png',
    'play_previous.png',
]

# All ch*.jpg images from the drawable dir, copied to web/data/ui/chapters/
# (includes both chapter select art and in-game section images)
UI_CHAPTER_ART_GLOB = 'ch*.jpg'

os.makedirs(OUT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Strings
# ---------------------------------------------------------------------------

def parse_android_string(text):
    """Convert raw Android XML string value to plain text."""
    if text is None:
        return ''
    text = text.strip()
    # Remove xliff tags (keep inner content)
    text = re.sub(r'<xliff:g[^>]*>', '', text)
    text = re.sub(r'</xliff:g>', '', text)
    # Remove other inline XML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Android escape sequences
    text = text.replace("\\'", "'")
    text = text.replace('\\"', '"')
    text = text.replace('\\n', '\n')
    text = text.replace('\\t', '\t')
    text = text.replace('\\\\', '\\')
    return text


def parse_strings_xml():
    path = os.path.join(RES_DIR, 'values', 'strings.xml')
    strings = {}
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # Match <string name="...">...</string> including multiline values
    for m in re.finditer(r'<string name="([^"]+)"[^>]*>(.*?)</string>', content, re.DOTALL):
        name = m.group(1)
        text = m.group(2)
        strings[name] = parse_android_string(text)
    return strings


# ---------------------------------------------------------------------------
# Image extension map
# ---------------------------------------------------------------------------

def build_image_map():
    """Return dict of image_name (no ext) -> extension."""
    ext_map = {}
    if not os.path.isdir(IMAGE_DIR):
        print(f"  WARNING: image dir not found: {IMAGE_DIR}")
        return ext_map
    for fname in os.listdir(IMAGE_DIR):
        base, ext = os.path.splitext(fname)
        if base.startswith('ch') and ext in ('.jpg', '.png'):
            ext_map[base] = ext[1:]  # 'jpg' or 'png'
    return ext_map


# ---------------------------------------------------------------------------
# Asset copying
# ---------------------------------------------------------------------------

def _sync_dir(src_dir, dest_dir, keep):
    """Sync files matching keep(fname) from src_dir into dest_dir.
    - Removes dest files that are no longer in the source set.
    - Skips files whose size and mtime already match (shutil.copy2 preserves mtime).
    Returns (copied, removed) counts.
    """
    os.makedirs(dest_dir, exist_ok=True)
    expected = {f for f in os.listdir(src_dir) if keep(f)}

    removed = 0
    for fname in os.listdir(dest_dir):
        if fname not in expected:
            os.remove(os.path.join(dest_dir, fname))
            removed += 1

    copied = 0
    for fname in expected:
        src = os.path.join(src_dir, fname)
        dest = os.path.join(dest_dir, fname)
        ss = os.stat(src)
        if os.path.exists(dest):
            ds = os.stat(dest)
            if ss.st_size == ds.st_size and ss.st_mtime == ds.st_mtime:
                continue
        shutil.copy2(src, dest)
        copied += 1

    return copied, removed


def copy_images():
    """Sync game images (ch*) from drawable-land-xxxhdpi to web/data/images/."""
    if not os.path.isdir(IMAGE_DIR):
        print(f"  WARNING: image dir not found: {IMAGE_DIR}")
        return 0, 0
    def keep(fname):
        base, ext = os.path.splitext(fname)
        return base.startswith('ch') and ext in ('.jpg', '.png')
    return _sync_dir(IMAGE_DIR, OUT_IMAGE_DIR, keep)


def copy_audio():
    """Sync mp3 files from res/raw to web/data/audio/."""
    if not os.path.isdir(AUDIO_DIR):
        print(f"  WARNING: audio dir not found: {AUDIO_DIR}")
        return 0, 0
    return _sync_dir(AUDIO_DIR, OUT_AUDIO_DIR, lambda f: f.endswith('.mp3'))


def _copy_named_assets(src_dir, dest_dir, names):
    """Copy a fixed list of named files from src_dir to dest_dir, skipping unchanged."""
    if not os.path.isdir(src_dir):
        print(f"  WARNING: source dir not found: {src_dir}")
        return 0
    os.makedirs(dest_dir, exist_ok=True)
    copied = 0
    for fname in names:
        src = os.path.join(src_dir, fname)
        dest = os.path.join(dest_dir, fname)
        if not os.path.exists(src):
            print(f"  WARNING: asset not found: {src}")
            continue
        ss = os.stat(src)
        if os.path.exists(dest):
            ds = os.stat(dest)
            if ss.st_size == ds.st_size and ss.st_mtime == ds.st_mtime:
                continue
        shutil.copy2(src, dest)
        copied += 1
    return copied


def copy_ui_assets():
    """Copy logo/background/icons to web/data/ui/."""
    copied = _copy_named_assets(IMAGE_DIR, OUT_UI_DIR, UI_ASSETS)
    copied += _copy_named_assets(DRAWABLE_DIR, OUT_UI_DIR, DRAWABLE_UI_ASSETS)
    return copied


def generate_deepwood_token():
    """
    Composite the deepwood time token from two clean semicircles found in
    ch15b_7_6__p1.jpg, apply a circular mask, and write deepwood_token.png
    to web/data/ui/.

    The source image has four tokens on a white background; two of them have
    clean halves at the crop coordinates below.  Stacking top+bottom gives a
    complete 324x308 circle which is then masked to a transparent-background PNG.
    """
    src = os.path.join(IMAGE_DIR, 'ch15b_7_6__p1.jpg')
    out = os.path.join(OUT_UI_DIR, 'deepwood_token.png')

    if not os.path.exists(src):
        print(f"  WARNING: token source not found: {src}")
        return False

    # Skip if output is already newer than the source
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
        return False

    img = Image.open(src).convert('RGB')

    # Crop: (left, upper, right, lower) == (x, y, x+w, y+h)
    top_half    = img.crop((491, 310,  491+324, 310+154))   # clean top semicircle
    bottom_half = img.crop((195, 1055, 195+324, 1055+154))  # clean bottom semicircle

    # Stack into a 324x308 composite
    w, half_h = 324, 154
    combined = Image.new('RGB', (w, half_h * 2), (255, 255, 255))
    combined.paste(top_half,    (0, 0))
    combined.paste(bottom_half, (0, half_h))
    combined = combined.convert('RGBA')

    # Circular alpha mask, slightly inset, with a soft edge
    mask = Image.new('L', (w, half_h * 2), 0)
    cx, cy, r = w // 2 + 1, half_h + 2, half_h - 7
    ImageDraw.Draw(mask).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=1.5))

    combined.putalpha(mask)

    # Trim to the bounding box of non-transparent pixels, plus a small equal margin
    margin = 4
    bbox = combined.getbbox()
    combined = combined.crop((
        max(0, bbox[0] - margin),
        max(0, bbox[1] - margin),
        min(combined.width,  bbox[2] + margin),
        min(combined.height, bbox[3] + margin),
    ))

    os.makedirs(OUT_UI_DIR, exist_ok=True)
    combined.save(out)
    return True


def copy_chapter_art():
    """Copy all ch*.jpg from the drawable dir to web/data/ui/chapters/."""
    import glob as _glob
    if not os.path.isdir(IMAGE_DIR):
        print(f"  WARNING: image dir not found: {IMAGE_DIR}")
        return 0
    os.makedirs(OUT_UI_CHAPTERS_DIR, exist_ok=True)
    names = [os.path.basename(p) for p in _glob.glob(os.path.join(IMAGE_DIR, UI_CHAPTER_ART_GLOB))]
    return _copy_named_assets(IMAGE_DIR, OUT_UI_CHAPTERS_DIR, names)


# ---------------------------------------------------------------------------
# Java parsing helpers
# ---------------------------------------------------------------------------

def split_top_level(s):
    """Split string by commas at depth 0 (not inside parens/brackets/braces)."""
    args = []
    depth = 0
    current = []
    for c in s:
        if c in '([{':
            depth += 1
            current.append(c)
        elif c in ')]}':
            depth -= 1
            current.append(c)
        elif c == ',' and depth == 0:
            args.append(''.join(current).strip())
            current = []
        else:
            current.append(c)
    if current:
        args.append(''.join(current).strip())
    return args


def extract_int_array(s):
    """Extract int list from 'new int[]{1, 2, 3}' or similar."""
    m = re.search(r'\{([^}]*)\}', s)
    if m:
        parts = [p.strip() for p in m.group(1).split(',') if p.strip()]
        result = []
        for p in parts:
            try:
                result.append(int(p))
            except ValueError:
                result.append(-1)
        return result
    return [-1]


def parse_resource_ref(s):
    """R.string.X -> 'X', R.raw.X -> 'X', R.drawable.X -> 'X', this.z/-1 -> None."""
    s = s.strip()
    if s in ('this.z', '-1'):
        return None
    m = re.match(r'R\.(?:string|raw|drawable)\.(\w+)', s)
    if m:
        return m.group(1)
    try:
        v = int(s)
        return None if v == -1 else v
    except ValueError:
        return None


def parse_section_args(args):
    """Parse Section constructor arg list into a structured dict."""
    if len(args) < 20:
        return None

    def get_bool(s):
        return 'true' in s.lower()

    def get_single_int(s):
        m = re.search(r'\((-?\d+)\)', s)
        return int(m.group(1)) if m else -1

    popup_texts = [parse_resource_ref(args[i]) for i in range(4)]
    audio = [parse_resource_ref(args[i]) for i in range(4, 8)]
    section_texts = [parse_resource_ref(args[i]) for i in range(8, 12)]

    locations_added = extract_int_array(args[12])
    show_locations = get_bool(args[13])
    is_location = get_bool(args[14])
    clear_locations_list = get_bool(args[15])
    remove_specific = extract_int_array(args[16])
    time_added = get_single_int(args[17])

    # ImageLinks: new ImageLinks(new int[]{R.drawable.X, ...})
    image_links_raw = args[18]
    image_links = re.findall(r'R\.drawable\.(\w+)', image_links_raw)
    if not image_links:
        image_links = None

    image_positions = extract_int_array(args[19])
    if image_positions == [-1]:
        image_positions = None

    # Choices (args 20+)
    choices = []
    for i in range(20, len(args)):
        arg = args[i].strip()
        m = re.match(r'new Choice\(R\.string\.(\w+),\s*(-?\d+)\)', arg)
        if m:
            choices.append({'text': m.group(1), 'next': int(m.group(2))})

    return {
        'popUpTexts': popup_texts,
        'audio': audio,
        'sectionTexts': section_texts,
        'locationsAdded': locations_added,
        'showLocations': show_locations,
        'isLocation': is_location,
        'clearLocationsList': clear_locations_list,
        'removeSpecificLocations': remove_specific,
        'timeAdded': time_added,
        'imageLinks': image_links,
        'imagePositions': image_positions,
        'choices': choices if choices else None,
    }


# ---------------------------------------------------------------------------
# Chapter parsing
# ---------------------------------------------------------------------------

def parse_chapter_java(chapter_num, filename):
    path = os.path.join(JAVA_DIR, 'book', filename)
    if not os.path.exists(path):
        print(f"  WARNING: not found: {path}")
        return None

    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    chapter = {
        'num': chapter_num,
        'clue': [-1],
        'clueLocation': -1,
        'clueLocationSectionNum': -1,
        'location': {},
        'deepwoodChapter': False,
        'deepwoodTokens': [],
        'deepwoodMap': {},
        'sections': [],
    }

    m = re.search(r'this\.clue\s*=\s*new int\[\]\{([^}]*)\}', content)
    if m:
        chapter['clue'] = [int(x.strip()) for x in m.group(1).split(',') if x.strip()]

    m = re.search(r'this\.clueLocation\s*=\s*(-?\d+)', content)
    if m:
        chapter['clueLocation'] = int(m.group(1))

    m = re.search(r'this\.clueLocationSectionNum\s*=\s*(-?\d+)', content)
    if m:
        chapter['clueLocationSectionNum'] = int(m.group(1))

    for m in re.finditer(r'this\.location\.put\((\d+),\s*(\d+)\)', content):
        chapter['location'][int(m.group(1))] = int(m.group(2))

    if 'this.deepwoodChapter = true' in content:
        chapter['deepwoodChapter'] = True

    m = re.search(r'Collections\.addAll\(this\.deepwoodTokens,([^)]+)\)', content)
    if m:
        chapter['deepwoodTokens'] = [int(x.strip()) for x in m.group(1).split(',') if x.strip()]

    for m in re.finditer(r'this\.deepwoodMap\.put\((\d+),\s*(\d+)\)', content):
        chapter['deepwoodMap'][int(m.group(1))] = int(m.group(2))

    # Determine sections array size
    m = re.search(r'this\.sections\s*=\s*new Section\[(\d+)\]', content)
    num_sections = int(m.group(1)) if m else 0

    # Parse section lines (each section is a single long line)
    sections_dict = {}
    for line in content.splitlines():
        m = re.match(r'\s*this\.sections\[(\d+)\]\s*=\s*new Section\((.*)\);', line)
        if m:
            idx = int(m.group(1))
            args = split_top_level(m.group(2))
            section = parse_section_args(args)
            if section:
                sections_dict[idx] = section

    chapter['sections'] = [sections_dict.get(i) for i in range(num_sections)]
    return chapter


# ---------------------------------------------------------------------------
# GT parsing (time triggers + onNormalPath)
# ---------------------------------------------------------------------------

def parse_gt_java(chapter_num, filename):
    path = os.path.join(JAVA_DIR, 'gameTrackers', filename)
    if not os.path.exists(path):
        print(f"  WARNING: not found: {path}")
        return {}, 'always'

    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract timeN() return values.
    # Some path-guarded methods have an early "return -1;" before the real trigger
    # value, so a non-greedy first-match would capture the wrong line.  Instead,
    # collect every return value in the method body and take the first non-(-1) one.
    time_triggers = {}
    for i in range(1, 33):
        m = re.search(rf'public int time{i}\(\)(.*?)(?=\n    (?:public|protected|@Override|/\*)|\Z)',
                      content, re.DOTALL)
        if m:
            body = m.group(1)
            # Skip methods that JADX could not decompile (no usable Java source).
            if 'UnsupportedOperationException' in body:
                continue
            returns = [int(v) for v in re.findall(r'return\s+(-?\d+)\s*;', body)]
            non_sentinel = [v for v in returns if v != -1]
            if non_sentinel:
                time_triggers[i] = non_sentinel[0]

    # Parse onNormalPath - extract the return statement(s)
    on_normal_path = 'always'
    m = re.search(r'boolean onNormalPath\(int[^)]*\)\s*\{([\s\S]*?)(?=\n\s{4}\})', content)
    if m:
        body = m.group(1)
        has_true = 'return true' in body
        has_false = 'return false' in body
        if has_true and not has_false:
            on_normal_path = 'always'
        elif has_false and not has_true:
            on_normal_path = 'never'
        elif has_true and has_false:
            # Extract the condition - look for section ranges or lists
            # Pattern: return i >= X && i <= Y || ...
            range_matches = re.findall(r'i\s*>=\s*(\d+)\s*&&\s*i\s*<=\s*(\d+)', body)
            if range_matches:
                ranges = [[int(a), int(b)] for a, b in range_matches]
                on_normal_path = {'type': 'ranges', 'ranges': ranges}
            else:
                on_normal_path = 'always'
        # UnsupportedOperationException means decompilation failed - default to always
    else:
        on_normal_path = 'always'

    return time_triggers, on_normal_path


# ---------------------------------------------------------------------------
# Chapter registry
# ---------------------------------------------------------------------------

CHAPTERS_MAP = [
    (1,  'Chapter1.java',    'GT1.java'),
    (2,  'Chapter2.java',    'GT2.java'),
    (3,  'Chapter3.java',    'GT3.java'),
    (4,  'Chapter4.java',    'GT4.java'),
    (5,  'Chapter5.java',    'GT5.java'),
    (6,  'Chapter6.java',    'GT6.java'),
    (7,  'Chapter7.java',    'GT7.java'),
    (8,  'Chapter8.java',    'GT8.java'),
    (9,  'Chapter9.java',    'GT9.java'),
    (10, 'Chapter10.java',   'GT10.java'),
    (11, 'Chapter11.java',   'GT11.java'),
    (22, 'Chapter11_5.java', 'GT11_5.java'),
    (12, 'Chapter12.java',   'GT12.java'),
    (13, 'Chapter13.java',   'GT13.java'),
    (14, 'Chapter14.java',   'GT14.java'),
    (15, 'Chapter15.java',   'GT15.java'),
    (16, 'Chapter16.java',   'GT16.java'),
    (17, 'Chapter17.java',   'GT17.java'),
    (18, 'Chapter18.java',   'GT18.java'),
    (19, 'Chapter19.java',   'GT19.java'),
    (20, 'Chapter20.java',   'GT20.java'),
    (21, 'Chapter21.java',   'GT21.java'),
]

# Display label overrides (internal chapter num -> label shown in the app and in chapters.js)
CHAPTER_DISPLAY_LABELS = {22: '11.5'}


# ---------------------------------------------------------------------------
# chapters.js writer
# ---------------------------------------------------------------------------

def format_section(section):
    """Format one section object: opening/closing braces on their own lines,
    each field on its own line with a compact JSON value."""
    lines = []
    keys = list(section.keys())
    for i, key in enumerate(keys):
        comma = ',' if i < len(keys) - 1 else ''
        lines.append(f'      {json.dumps(key)}: {json.dumps(section[key], ensure_ascii=False)}{comma}')
    return '    {\n' + '\n'.join(lines) + '\n    }'


def write_chapter_file(path, chapter_num, chapter):
    """Write a single chapter JS file."""
    label = CHAPTER_DISPLAY_LABELS.get(chapter_num, str(chapter_num))
    bar = '// ' + '=' * 76
    sections = chapter.get('sections', [])

    with open(path, 'w', encoding='utf-8') as f:
        f.write(f'// Chapter {label} - auto-generated by scripts/generate_data.py\n')
        f.write('// Manual edits are possible; re-running generate_data.py will overwrite them.\n')
        f.write('\n')
        f.write('//\n')
        f.write(bar + '\n')
        f.write(f'//  [CH{label}]\n')
        f.write(bar + '\n')
        f.write('//\n')
        f.write('\n')
        f.write(f'CHAPTERS[{chapter_num}] = {{\n')

        for key, val in chapter.items():
            if key == 'sections':
                continue
            f.write(f'  {json.dumps(key)}: {json.dumps(val, ensure_ascii=False)},\n')

        f.write('  "sections": [\n')
        for i, section in enumerate(sections):
            comma = ',' if i < len(sections) - 1 else ''
            if section is None:
                f.write(f'    null{comma}\n')
            else:
                f.write(format_section(section) + comma + '\n')
        f.write('  ]\n')
        f.write('};\n')


def write_chapters_js(all_chapters):
    """Write one JS file per chapter into web/data/chapters/, plus init.js."""
    os.makedirs(OUT_CHAPTERS_DIR, exist_ok=True)

    with open(os.path.join(OUT_CHAPTERS_DIR, 'init.js'), 'w', encoding='utf-8') as f:
        f.write('const CHAPTERS = {};\n')

    for chapter_num, _, _ in CHAPTERS_MAP:
        if chapter_num not in all_chapters:
            continue
        path = os.path.join(OUT_CHAPTERS_DIR, f'chapter_{chapter_num}.js')
        write_chapter_file(path, chapter_num, all_chapters[chapter_num])

    # Remove the old monolithic file if it still exists
    old = os.path.join(OUT_DIR, 'chapters.js')
    if os.path.exists(old):
        os.remove(old)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Strings
    print("Parsing strings.xml...")
    strings = parse_strings_xml()
    print(f"  {len(strings)} strings found")
    strings_path = os.path.join(OUT_DIR, 'strings.js')
    with open(strings_path, 'w', encoding='utf-8') as f:
        f.write('// Auto-generated from res/values/strings.xml\n')
        f.write('window.STRINGS = window.STRINGS || {};\n')
        f.write('STRINGS["en"] = ')
        f.write(json.dumps(strings, ensure_ascii=False, indent=2, sort_keys=True))
        f.write(';\n')
    print(f"  -> {strings_path}")

    # Image map
    print("\nBuilding image extension map...")
    image_map = build_image_map()
    print(f"  {len(image_map)} game images found")
    images_path = os.path.join(OUT_DIR, 'images.js')
    with open(images_path, 'w', encoding='utf-8') as f:
        f.write('// Auto-generated: image name -> file extension\n')
        f.write('const IMAGE_EXT = ')
        f.write(json.dumps(image_map, ensure_ascii=False))
        f.write(';\n')
    print(f"  -> {images_path}")

    # Copy images
    print("\nCopying images...")
    copied, removed = copy_images()
    print(f"  {copied} copied, {removed} removed -> {OUT_IMAGE_DIR}")

    # Copy audio
    print("\nCopying audio...")
    copied, removed = copy_audio()
    print(f"  {copied} copied, {removed} removed -> {OUT_AUDIO_DIR}")

    # Copy UI assets
    print("\nCopying UI assets...")
    copied = copy_ui_assets()
    print(f"  {copied} copied -> {OUT_UI_DIR}")
    copied = copy_chapter_art()
    print(f"  {copied} copied -> {OUT_UI_CHAPTERS_DIR}")
    generated = generate_deepwood_token()
    print(f"  deepwood_token.png {'generated' if generated else 'up to date'} -> {OUT_UI_DIR}")

    # Chapters
    print("\nParsing chapter files...")
    all_chapters = {}
    total_sections = 0

    for chapter_num, chap_file, gt_file in CHAPTERS_MAP:
        print(f"  Chapter {chapter_num:2d} ({chap_file})... ", end='', flush=True)
        chapter = parse_chapter_java(chapter_num, chap_file)
        if not chapter:
            print("FAILED")
            continue
        time_triggers, on_normal_path = parse_gt_java(chapter_num, gt_file)
        chapter['timeTriggers'] = time_triggers
        chapter['onNormalPath'] = on_normal_path
        valid = sum(1 for s in chapter['sections'] if s is not None)
        total_sections += valid
        print(f"{valid}/{len(chapter['sections'])} sections, {len(time_triggers)} time triggers")
        all_chapters[chapter_num] = chapter

    write_chapters_js(all_chapters)
    print(f"\n  -> {OUT_CHAPTERS_DIR}/")
    print(f"\nDone: {len(all_chapters)} chapters, {total_sections} total sections")


if __name__ == '__main__':
    main()
