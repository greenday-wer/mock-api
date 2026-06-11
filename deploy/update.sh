#!/usr/bin/env bash
# Update koperasi-mock-api di VPS: tarik perubahan terbaru lalu reload PM2.
# Pakai: jalankan dari folder proyek -> bash deploy/update.sh
set -euo pipefail

# Pindah ke root proyek (folder induk dari deploy/)
cd "$(dirname "$0")/.."

echo "==> git pull (fast-forward)"
git pull --ff-only

echo "==> install dependency produksi"
npm ci --omit=dev

echo "==> reload PM2 (tanpa downtime)"
pm2 reload ecosystem.config.js

echo "==> selesai. Status:"
pm2 status koperasi-mock-api
