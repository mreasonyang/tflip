#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
printf 'Building Tflip website from source commit: '
git rev-parse HEAD
node --version
python3 --version

npm ci --ignore-scripts
npm test
npm run preview:sync
