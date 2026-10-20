#!/bin/sh
set -eu

# Nixpacks build boundary: select without executing Node and persist only the
# unique immutable store path. Runtime revalidates the path independently.
FAILURE='NorthStar production build rejected the Node runtime.'
CANONICAL_ROOT='/app'
CANONICAL_SCRIPT='/app/scripts/prepare-production-node.sh'
fail() {
  echo "$FAILURE" >&2
  exit 78
}
if [ "$0" = "$CANONICAL_SCRIPT" ]; then
  :
elif [ "$0" = 'scripts/prepare-production-node.sh' ] &&
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
set -- /nix/store/*-nodejs-22.23.3/bin/node
if [ "$#" -ne 1 ]; then
  echo "$FAILURE" >&2
  exit 78
fi
node_path=$1
case "$node_path" in
  /nix/store/*-nodejs-22.23.3/bin/node) ;;
  *) echo "$FAILURE" >&2; exit 78 ;;
esac
node_bin=${node_path%/node}
node_store=${node_bin%/bin}
if [ ! -f "$node_path" ] || [ ! -x "$node_path" ] ||
   [ -L "$node_path" ] ||
   [ ! -d "$node_bin" ] || [ ! -d "$node_store" ] ||
   [ -L "$node_bin" ] || [ -L "$node_store" ]; then
  echo "$FAILURE" >&2
  exit 78
fi
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
runtime_directory="$CANONICAL_ROOT/.northstar-runtime"
manifest="$runtime_directory/node-path"
if [ "$(/usr/bin/readlink -f -- "$runtime_directory")" != "$runtime_directory" ] ||
   [ -L "$runtime_directory" ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$runtime_directory")" != '0:755' ]; then
  fail
fi
umask 022
printf '%s\n' "$node_path" > "$manifest"
if [ -L "$manifest" ] ||
   [ "$(/usr/bin/readlink -f -- "$manifest")" != "$manifest" ] ||
   [ "$(/usr/bin/stat -c '%u:%a:%h' -- "$manifest")" != '0:644:1' ]; then
  fail
fi
