#!/bin/sh
set -eu

# This shell boundary runs before any Node executable is selected. It never
# resolves through PATH: shell builtins and fixed root-owned utilities bind the
# deployed process to the exact immutable Nix-store Node selected at build time.
FAILURE='NorthStar production startup rejected the Node runtime.'
CANONICAL_ROOT='/app'
CANONICAL_SCRIPT='/app/scripts/start-production.sh'

fail() {
  echo "$FAILURE" >&2
  exit 78
}

# Nixpacks copies the source tree to /app. Accept only the physical canonical
# script or the documented relative spelling while already in physical /app.
# Caller-controlled PWD, INIT_CWD, CDPATH, npm variables, and alternate trees
# never select a repository root.
if [ "$0" = "$CANONICAL_SCRIPT" ]; then
  :
elif [ "$0" = 'scripts/start-production.sh' ] &&
     [ "$(/bin/pwd -P)" = "$CANONICAL_ROOT" ]; then
  :
else
  fail
fi
if [ ! -x /usr/bin/readlink ] || [ ! -x /usr/bin/stat ] ||
   [ ! -x /usr/bin/od ]; then
  fail
fi
if [ "$(/usr/bin/readlink -f -- "$CANONICAL_ROOT")" != "$CANONICAL_ROOT" ] ||
   [ "$(/usr/bin/readlink -f -- "$CANONICAL_SCRIPT")" != "$CANONICAL_SCRIPT" ] ||
   [ -L "$CANONICAL_ROOT" ] || [ -L "$CANONICAL_ROOT/scripts" ] ||
   [ -L "$CANONICAL_SCRIPT" ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$CANONICAL_ROOT")" != '0:755' ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$CANONICAL_ROOT/scripts")" != '0:755' ] ||
   [ "$(/usr/bin/stat -c '%u:%a:%h' -- "$CANONICAL_SCRIPT")" != '0:644:1' ]; then
  fail
fi

if [ "${NODE_OPTIONS+x}" = x ] && [ -n "${NODE_OPTIONS}" ]; then
  echo "NorthStar production startup rejected NODE_OPTIONS." >&2
  exit 78
fi
if [ "${NODE_PATH+x}" = x ] && [ -n "${NODE_PATH}" ]; then
  echo "NorthStar production startup rejected NODE_PATH." >&2
  exit 78
fi
if [ "${NPM_CONFIG_NODE_OPTIONS+x}" = x ] && [ -n "${NPM_CONFIG_NODE_OPTIONS}" ]; then
  echo "NorthStar production startup rejected npm node options." >&2
  exit 78
fi
if [ "${npm_config_node_options+x}" = x ] && [ -n "${npm_config_node_options}" ]; then
  echo "NorthStar production startup rejected npm node options." >&2
  exit 78
fi

# Local/test executable selection is deliberately a different command. None
# of its inputs are accepted by the Railway/Nixpacks production boundary.
if [ -n "${NODE_BINARY-}" ] || [ -n "${NORTHSTAR_NODE_BINARY-}" ] ||
   [ -n "${NORTHSTAR_LOCAL_NODE_BINARY-}" ] ||
   [ -n "${NORTHSTAR_LOCAL_NODE_SHA256-}" ] ||
   [ -n "${NORTHSTAR_NODE_RUNTIME_MODE-}" ] ||
   [ -n "${NORTHSTAR_PRODUCTION_NODE_PATH-}" ] ||
   [ -n "${NORTHSTAR_NIX_STORE_ROOT-}" ]; then
  echo "$FAILURE" >&2
  exit 78
fi

manifest="$CANONICAL_ROOT/.northstar-runtime/node-path"
if [ ! -f "$manifest" ] || [ -L "$manifest" ]; then
  echo "$FAILURE Missing authenticated Nixpacks runtime manifest." >&2
  exit 78
fi
if [ "$(/usr/bin/readlink -f -- "$CANONICAL_ROOT/.northstar-runtime")" !=
     "$CANONICAL_ROOT/.northstar-runtime" ] ||
   [ "$(/usr/bin/readlink -f -- "$manifest")" != "$manifest" ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$CANONICAL_ROOT/.northstar-runtime")" != '0:755' ] ||
   [ "$(/usr/bin/stat -c '%u:%a:%h' -- "$manifest")" != '0:644:1' ]; then
  fail
fi
exec 3< "$manifest"
IFS= read -r node_path <&3 || {
  echo "$FAILURE" >&2
  exit 78
}
if IFS= read -r extra_line <&3; then
  echo "$FAILURE" >&2
  exit 78
fi
exec 3<&-

case "$node_path" in
  /nix/store/*-nodejs-22.23.3/bin/node) ;;
  *) echo "$FAILURE" >&2; exit 78 ;;
esac

# The manifest is build-derived, but it is not trusted by itself. Cross-check
# it against the one and only exact immutable Nix-store runtime and reject
# symlinks before executing it. The launcher's first code verifies uid/mode.
set -- /nix/store/*-nodejs-22.23.3/bin/node
if [ "$#" -ne 1 ] || [ "$1" != "$node_path" ] ||
   [ ! -f "$node_path" ] || [ ! -x "$node_path" ] ||
   [ -L "$node_path" ]; then
  echo "$FAILURE" >&2
  exit 78
fi
node_bin=${node_path%/node}
node_store=${node_bin%/bin}
if [ ! -d "$node_bin" ] || [ ! -d "$node_store" ] ||
   [ -L "$node_bin" ] || [ -L "$node_store" ]; then
  echo "$FAILURE" >&2
  exit 78
fi

# Railway's Nixpacks image supplies these root-owned Ubuntu base utilities at
# fixed paths. They are never resolved through inherited PATH. The immutable
# Nix derivation must be canonical, root-owned, and mode 0555 before Node runs.
LC_ALL=C
export LC_ALL
canonical_path=$(/usr/bin/readlink -f -- "$node_path") || {
  echo "$FAILURE" >&2
  exit 78
}
if [ "$canonical_path" != "$node_path" ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$node_path")" != '0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$node_bin")" != '0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$node_store")" != '0:555' ]; then
  echo "$FAILURE" >&2
  exit 78
fi
set -- $(/usr/bin/od -An -tx1 -N20 -- "$node_path")
if [ "$#" -ne 20 ] || [ "$1" != '7f' ] || [ "$2" != '45' ] ||
   [ "$3" != '4c' ] || [ "$4" != '46' ] || [ "$5" != '02' ] ||
   [ "$6" != '01' ] || [ "$8" != '00' ] || [ "${19}" != '3e' ] ||
   [ "${20}" != '00' ]; then
  echo "$FAILURE" >&2
  exit 78
fi

unset NODE_OPTIONS NODE_PATH NPM_CONFIG_NODE_OPTIONS npm_config_node_options
PATH=$node_bin
export PATH
NORTHSTAR_AUTHENTICATED_NODE_PATH=$node_path
NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY='nix-store-22.23.3-v1'
NORTHSTAR_CANONICAL_ROOT=$CANONICAL_ROOT
export NORTHSTAR_AUTHENTICATED_NODE_PATH NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY
export NORTHSTAR_CANONICAL_ROOT
launcher="$CANONICAL_ROOT/scripts/production-launcher.js"
child="$CANONICAL_ROOT/src/productionChild.js"
server="$CANONICAL_ROOT/src/server.js"
for resource in "$launcher" "$child" "$server" \
  "$CANONICAL_ROOT/package.json" "$CANONICAL_ROOT/package-lock.json" \
  "$CANONICAL_ROOT/nixpacks.toml"
do
  if [ ! -f "$resource" ] || [ -L "$resource" ] ||
     [ "$(/usr/bin/readlink -f -- "$resource")" != "$resource" ] ||
     [ "$(/usr/bin/stat -c '%u:%a:%h' -- "$resource")" != '0:644:1' ]; then
    fail
  fi
done
CDPATH=''
export CDPATH
cd "$CANONICAL_ROOT" || fail
exec "$node_path" "$launcher"
