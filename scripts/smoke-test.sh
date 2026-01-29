#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR="${1:-/tmp/dzx-smoke-$$}"

CREATE_BIN="$ROOT_DIR/packages/dzx/dist/cli/create-dzx.js"

if [ ! -f "$CREATE_BIN" ]; then
  echo "create-dzx build not found at $CREATE_BIN. Build @dwizi/dzx before running this smoke test."
  exit 1
fi

node "$CREATE_BIN" --yes --template basic --runtime node --dir "$WORK_DIR"

if ! command -v dzx >/dev/null 2>&1; then
  echo "dzx CLI not found on PATH. Install @dwizi/dzx or link the workspace package before running this smoke test."
  exit 1
fi

( cd "$WORK_DIR" && dzx inspect --json )

rm -rf "$WORK_DIR"
