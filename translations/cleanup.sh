#!/usr/bin/env bash
#
# Remove Docker images and optionally the model cache volume used by the
# translation pipeline.
#
# Usage:
#   ./translations/cleanup.sh            # remove images only
#   ./translations/cleanup.sh --volumes  # also remove the model cache volume
#
# The model cache volume (oathsworn-ollama-models) can be several GB depending
# on which models were pulled. Removing it means the next translation run will
# need to re-download the model.

set -euo pipefail

REMOVE_VOLUMES=false
for arg in "$@"; do
    case "$arg" in
        --volumes) REMOVE_VOLUMES=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

echo "Removing translation Docker images..."
docker rmi oathsworn-translation  2>/dev/null && echo "  Removed oathsworn-translation"  || echo "  oathsworn-translation not found, skipping"
docker rmi ollama/ollama:latest    2>/dev/null && echo "  Removed ollama/ollama:latest"    || echo "  ollama/ollama:latest not found, skipping"

if $REMOVE_VOLUMES; then
    echo "Removing model cache volume..."
    docker volume rm oathsworn-ollama-models 2>/dev/null && echo "  Removed oathsworn-ollama-models" || echo "  oathsworn-ollama-models not found, skipping"
else
    echo ""
    echo "Model cache volume (oathsworn-ollama-models) was kept."
    echo "Run with --volumes to remove it too (requires re-downloading the model next run)."
fi

echo ""
echo "Done."
