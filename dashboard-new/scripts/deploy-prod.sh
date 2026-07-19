#!/usr/bin/env bash
# Prebuilt production deploy of dashboard-new into the "steamline" Vercel
# project (steamline-eosin.vercel.app). Build happens locally because the app
# imports ../packages/* and reads ../dashboard/data, which only exist in the
# full repo checkout; the cloud never builds. The fixture data is injected
# into each real function bundle because fs reads through computed paths are
# invisible to output file tracing.
set -euo pipefail
cd "$(dirname "$0")/../.."

npx vercel build --prod

find .vercel/output/functions -maxdepth 3 -name '*.func' -type d | while read -r f; do
  if [ -d "$f/dashboard-new" ]; then
    rm -rf "$f/dashboard-new/data"
    cp -r dashboard/data "$f/dashboard-new/data"
    echo "data -> $f"
  fi
done

npx vercel deploy --prebuilt --prod --yes
