#!/usr/bin/env bash
#
# Translate a strings.js file using a local Ollama model running in Docker.
# The only host dependency is Docker.
#
# Usage:
#   ./translations/setup.sh <strings.js> --language <lang> [options]
#
# Examples:
#   ./translations/setup.sh web/data/strings.js --language French
#   ./translations/setup.sh web/data/strings.js --language Spanish --model llama3.2:3b
#
# All arguments after the script name are passed directly to translate.py.
# Paths are relative to the repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$SCRIPT_DIR"

# Stop Ollama when the script exits (success or failure)
trap 'docker compose down' EXIT

docker compose run --rm \
    -v "$REPO_ROOT:/repo" \
    -w /repo \
    translate python3 /app/translate.py "$@"
