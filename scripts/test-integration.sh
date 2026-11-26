#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMP_DIR="$(mktemp -d /tmp/atoms-integration-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
export DATABASE_URL="file:$TMP_DIR/test.db"

npx prisma db push --skip-generate >/dev/null
exec npx tsx scripts/integration.ts