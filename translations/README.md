# Oathsworn Translation Pipeline

Experimental machine translation of story strings using a local Ollama model.
The only host dependency is Docker.

---

## How it works

1. `setup.sh` creates a Docker network, starts an Ollama container on it, builds a small Python container on the same network, and runs `translate.py` inside it.
2. `translate.py` reads the English `strings.js`, translates each string value, and writes a sidecar file (e.g. `strings_fr.js`) that registers the translation into `window.STRINGS["fr"]`.
3. The source `strings.js` is **never modified**. The sidecar file is loaded by `lang-loader.js` at runtime alongside the English base.
4. On exit (success, failure, or Ctrl-C) the Ollama container and network are torn down automatically.

The output file doubles as a checkpoint. Interrupted runs resume exactly where they left off on the next invocation.

---

## German is different

German is the one language that does **not** use this pipeline. The official Oathsworn app has a separate German APK that ships a complete, human-authored German `strings.xml`. The main setup process handles German natively: set `OATHSWORN_GERMAN=true` before running `./setup.sh` and it will download the German APK, extract its strings, and write `web/data/strings_de.js` automatically. No translation model is involved.

This pipeline is for languages that have no official translation and must be machine-translated.

---

## Quick start

```bash
./translations/setup.sh web/data/strings.js --lang fr
```

When it finishes, `web/data/strings_fr.js` contains the French translation.
The original `web/data/strings.js` is untouched.

---

## Arguments

| Argument | Default | Description |
|---|---|---|
| `strings_js` | (required) | Path to the source English `strings.js` file |
| `--lang CODE` | (required) | ISO 639-1 language code, e.g. `fr`, `es`, `ja` |
| `--output PATH` | `strings_<lang>.js` next to input | Output path for the translated sidecar file |
| `--model MODEL` | `translategemma:4b` | Ollama model to use |

---

## Resuming an interrupted run

Just re-run the same command. Keys already present in the output file are skipped automatically. Keys that failed sanity checks are not written to the output file and will be retried.

---

## Sanity checks

Every translated string is validated before being written. Strings that fail are skipped (not written to the output file) and retried on the next run. The bad output is printed so patterns can be identified.

Checks performed:
- **Bad output patterns**: known model failure strings like "Google Translate", "As an AI", etc.
- **Length ratio**: translated text must be between 0.2x and 8.0x the length of the original
- **Game term preservation**: terms in `GAME_TERMS` that appear in the original must also appear in the translation
- **Newline count**: translated text must have the same number of newlines as the original

### Adding new bad patterns or game terms

Edit the two lists near the top of `translate.py`:

```python
GAME_TERMS = [
    'Oathsworn',
    'Deepwood',
    # add character names, location names, etc.
]

BAD_OUTPUT_PATTERNS = [
    'Google Translate',
    'As an AI',
    # add any new patterns found in bad output
]
```

---

## Model cache

The Ollama model is stored in a Docker volume (`oathsworn-ollama-models`) and persists between runs. The first run will pull the model, which may take a while depending on your connection. Subsequent runs skip the download entirely.

To swap models, pass `--model` with any model available in Ollama:

```bash
./translations/setup.sh web/data/strings.js --lang fr --model llama3.2:3b
```

---

## Cleanup

Remove all Docker images and the model cache volume:

```bash
./translations/cleanup.sh
```

Note: this removes the cached model. The next translation run will need to re-download it.
