#!/bin/sh
set -e

mkdir -p /app/logs
chown -R node:node /app/logs 2>/dev/null || true

exec su node -s /bin/sh -c "$*"
