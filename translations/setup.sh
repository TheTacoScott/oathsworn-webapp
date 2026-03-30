#!/usr/bin/env bash
#
# Translate a strings.js file using a local Ollama model running in Docker.
# The only host dependency is Docker.
#
# Produces a sidecar file (e.g. strings_fr.js) next to the source.
# The source strings.js is never modified.
#
# Usage:
#   ./translations/setup.sh <strings.js> --language <lang> [options]
#
# Examples:
#   ./translations/setup.sh web/data/strings.js --language French
#   ./translations/setup.sh web/data/strings.js --language Spanish --model llama3.2:3b
#
# All arguments are passed directly to translate.py.
# Paths are relative to the repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NETWORK=oathsworn-translate-net
OLLAMA_CONTAINER=oathsworn-translate-ollama

cleanup() {
    docker stop  "$OLLAMA_CONTAINER" 2>/dev/null || true
    docker rm    "$OLLAMA_CONTAINER" 2>/dev/null || true
    docker network rm "$NETWORK"    2>/dev/null || true
}
trap cleanup EXIT

# Clean up any leftover containers/networks from a previous interrupted run
cleanup

echo "Creating local network thing..."
docker network create "$NETWORK"

echo "Running ollama..."
docker run -d \
    --name "$OLLAMA_CONTAINER" \
    --network "$NETWORK" \
    -v oathsworn-ollama-models:/root/.ollama \
    ollama/ollama:latest

echo "Building translate image..."
docker build -t oathsworn-translation "$SCRIPT_DIR"

# Resolve the input file to an absolute path and mount its directory at /data.
# The output defaults to the same directory, so it lands next to the input on the host.
STRINGS_JS_HOST="$(realpath "$1")"
STRINGS_JS_DIR="$(dirname "$STRINGS_JS_HOST")"
STRINGS_JS_FILE="$(basename "$STRINGS_JS_HOST")"
shift

echo "Translating ${STRINGS_JS_HOST}"
docker run --rm \
    --network "$NETWORK" \
    -e OLLAMA_URL="http://$OLLAMA_CONTAINER:11434" \
    -v "$STRINGS_JS_DIR:/data:z" \
    oathsworn-translation python3 -u /app/translate.py "/data/$STRINGS_JS_FILE" "$@"
