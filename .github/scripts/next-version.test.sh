#!/usr/bin/env bash
# Usage: bash .github/scripts/next-version.test.sh  — exits non-zero on failure.
set -euo pipefail
s="$(dirname "$0")/next-version.sh"
check() { local got; got=$(PKG_VERSION="$1" TAGS="$2" bash "$s"); [[ "$got" == "$3" ]] || { echo "FAIL pkg=$1 tags=[$2]: got $got want $3"; exit 1; }; }
check 0.1.0 ""                         v0.1.0   # first release
check 0.1.0 "v0.1.0"                   v0.1.1   # patch bump
check 0.1.0 $'v0.1.9\nv0.1.10'         v0.1.11  # numeric, not lexical, sort
check 0.1.0 $'v0.1.3\nv0.2.0-beta'     v0.1.4   # ignore non-plain tags
check 0.2.0 "v0.1.4"                   v0.2.0   # package.json bumped ahead
check 0.1.0 "v0.3.2"                   v0.3.3   # tag ahead of package.json
if PKG_VERSION=0.2.0-beta TAGS="" bash "$s" >/dev/null 2>&1; then echo "FAIL: pre-release pkg version accepted"; exit 1; fi
echo ok
