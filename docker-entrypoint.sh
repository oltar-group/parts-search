#!/bin/sh
set -e

mkdir -p /app/logs /app/data
chown -R node:node /app/logs /app/data 2>/dev/null || true

exec su node -s /bin/sh -c "$*"
