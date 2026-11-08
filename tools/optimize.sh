#!/bin/sh
set -eu
cd "$(dirname "$0")"
test -d node_modules || npm ci
exec node normalize.mjs "$@"
