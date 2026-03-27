#!/usr/bin/env bash
#
# Convenience wrapper around translate.py.
#
# Usage:
#   ./translations/setup.sh <strings.js> --language <lang> [options]
#
# Examples:
#   ./translations/setup.sh web/data/strings.js --language French
#   ./translations/setup.sh web/data/strings.js --language Spanish --model llama3.2:3b
#
# All arguments are passed directly to translate.py. Run with --help for full options.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/translate.py" "$@"
