#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Standard workstations need no cloud-specific paths.
if [[ -d /workspace/our_kanvan ]]; then
 export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/workspace/.config}"
 export FIREBASE_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-/workspace/.cache/firebase}"
fi
if [[ -x /workspace/.tools/node_modules/node/bin/node ]]; then
 export PATH="/workspace/.tools/node_modules/node/bin:$PATH"
fi
npm run check
npm run build
npm run test:emulators
