#!/usr/bin/env bash
# Usage: bash .github/scripts/next-version.test.sh  — exits non-zero on failure.
set -euo pipefail
s="$(dirname "$0")/next-version.sh"
check() { local got; got=$(BUMP="${4:-patch}" PKG_VERSION="$1" TAGS="$2" bash "$s"); [[ "$got" == "$3" ]] || { echo "FAIL pkg=$1 tags=[$2]: got $got want $3"; exit 1; }; }
check 0.1.0 ""                         v0.1.0   # first release
check 0.1.0 "v0.1.0"                   v0.1.1   # patch bump
check 0.1.0 $'v0.1.9\nv0.1.10'         v0.1.11  # numeric, not lexical, sort
check 0.1.0 $'v0.1.3\nv0.2.0-beta'     v0.1.4   # ignore non-plain tags
check 0.2.0 "v0.1.4"                   v0.2.1   # package.json ahead of tag
check 0.1.0 "v0.3.2"                   v0.3.3   # tag ahead of package.json
check 0.1.0 "v0.1.4" v0.2.0 minor
check 0.1.0 "v0.1.4" v1.0.0 major
check 0.3.0 "v0.1.4" v0.4.0 minor   # package ahead
check 0.1.0 "v0.3.2" v0.4.0 minor   # tag ahead
check 0.1.0 "v0.3.2" v1.0.0 major
check 0.1.0 ""       v0.2.0 minor   # no tags yet
check 0.1.5 ""       v1.0.0 major
if BUMP=huge PKG_VERSION=0.1.0 TAGS="" bash "$s" >/dev/null 2>&1; then echo "FAIL: invalid BUMP accepted"; exit 1; fi
if PKG_VERSION=0.2.0-beta TAGS="" bash "$s" >/dev/null 2>&1; then echo "FAIL: pre-release pkg version accepted"; exit 1; fi
echo ok
