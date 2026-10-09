#!/usr/bin/env bash
# Next release tag: max(latest plain vX.Y.Z tag + 1 patch, package.json version).
# Inputs (env, for tests): PKG_VERSION, TAGS (newline-separated). Defaults read the repo.
set -euo pipefail
pkg="${PKG_VERSION:-$(node -p "require('./package.json').version")}"
tags="${TAGS-$(git tag --list 'v*')}"
latest=$(printf '%s\n' "$tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' | sort -V | tail -n1 || true)
if [[ -z "$latest" ]]; then echo "v$pkg"; exit 0; fi
IFS=. read -r ma mi pa <<<"$latest"
bumped="$ma.$mi.$((pa + 1))"
echo "v$(printf '%s\n%s\n' "$bumped" "$pkg" | sort -V | tail -n1)"
