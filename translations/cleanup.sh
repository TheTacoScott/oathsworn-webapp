#!/usr/bin/env bash
#
# Remove all Docker images and volumes used by the translation pipeline.

set -euo pipefail

docker rmi oathsworn-translation   2>/dev/null && echo "Removed oathsworn-translation"  || echo "oathsworn-translation not found, skipping"
docker rmi ollama/ollama:latest     2>/dev/null && echo "Removed ollama/ollama:latest"    || echo "ollama/ollama:latest not found, skipping"
docker volume rm oathsworn-ollama-models 2>/dev/null && echo "Removed oathsworn-ollama-models" || echo "oathsworn-ollama-models not found, skipping"
