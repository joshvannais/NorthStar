#!/bin/sh
set -eu

# Nixpacks build boundary: select without executing Node and persist only the
# unique immutable store path. Runtime revalidates the path independently.
FAILURE='NorthStar production build rejected the Node runtime.'
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
if [ ! -x /usr/bin/readlink ] || [ ! -x /usr/bin/stat ] ||
   [ ! -x /usr/bin/od ]; then
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
printf '%s\n' "$node_path" > .northstar-runtime/node-path
