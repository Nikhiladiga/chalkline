#!/usr/bin/env bash
# Next release tag: bump (BUMP=patch|minor|major, default patch) of max(latest plain vX.Y.Z tag, package.json version).
# With no tag yet, patch releases package.json as-is.
# Inputs (env, for tests): PKG_VERSION, TAGS (newline-separated). Defaults read the repo.
set -euo pipefail
bump="${BUMP:-patch}"
[[ "$bump" =~ ^(patch|minor|major)$ ]] || { echo "BUMP must be patch, minor or major, got: $bump" >&2; exit 1; }
pkg="${PKG_VERSION:-$(node -p "require('./package.json').version")}"
[[ "$pkg" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "package.json version must be plain X.Y.Z, got: $pkg" >&2; exit 1; }
tags="${TAGS-$(git tag --list 'v*')}"
latest=$(printf '%s\n' "$tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' | sort -V | tail -n1 || true)
if [[ -z "$latest" ]]; then
  [[ "$bump" == patch ]] && { echo "v$pkg"; exit 0; }
  base="$pkg"
else
  base=$(printf '%s\n%s\n' "$latest" "$pkg" | sort -V | tail -n1)
fi
IFS=. read -r ma mi pa <<<"$base"
case "$bump" in
  patch) echo "v$ma.$mi.$((pa + 1))" ;;
  minor) echo "v$ma.$((mi + 1)).0" ;;
  major) echo "v$((ma + 1)).0.0" ;;
esac
