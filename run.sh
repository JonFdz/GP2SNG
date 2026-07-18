#!/usr/bin/env bash
# Build the app and launch the compiled (non-dev) build.
# For day-to-day development with hot-reload, use `npm run dev` instead.
set -euo pipefail
cd "$(dirname "$0")"

npm run build
npx electron .
