#!/bin/sh
# Builds the web UI and installs it on this machine, where sw_admin's
# nginx serves it. nginx serves the files as they are and sends
# index.html uncached, so there is nothing to restart.
set -eu

cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"   # node isn't on the default PATH

ROOT=/usr/local/seawall/share/sw_admin
URL=https://localhost:8443

# install only when package-lock.json changed since the last install;
# npm ci installs exactly the lock file and never rewrites it
[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci

echo "== build $(git describe --always --dirty)"
npm run build

# a VITE_USE_MOCK=true left in the environment would build the mock in,
# and with it the admin / admin login
if grep -rq "Not in the mock" dist; then
    echo "== dist/ holds the mock backend; not deploying it" >&2
    exit 1
fi

# the files must be readable by the sw_admin user
if [ -w "$ROOT" ]; then SUDO=; else SUDO=sudo; fi
copy() {
    $SUDO rsync -rlt --chmod=D755,F644 "$@"
}

echo "== install into $ROOT"
# The new assets first, then index.html, which loads them: a page loaded
# in between still gets the old index.html with the old assets.
copy dist/assets/ "$ROOT/assets/"
copy --delete --exclude=/assets/ dist/ "$ROOT/"
# Then drop the old build's assets. A tab opened before this that asks
# for one reloads the page (router.onError in src/router.ts).
copy --delete dist/assets/ "$ROOT/assets/"

echo "== check $URL"
# -k: the device's certificate is self-signed
for path in / /llms.txt; do
    code=$(curl -sk -o /dev/null -w '%{http_code}' "$URL$path")
    if [ "$code" != 200 ]; then
        echo "== $URL$path: HTTP $code" >&2
        exit 1
    fi
done
if ! curl -sk "$URL/" | cmp -s - dist/index.html; then
    echo "== $URL/ is not the index.html just built" >&2
    exit 1
fi
echo "== deployed"
