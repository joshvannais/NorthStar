#!/bin/sh
set -eu

# Docker build boundary. The Docker daemon has already selected one immutable
# platform manifest from the pinned Official Image index. Before this script
# executes Node, it binds that selection to the independently pinned executable
# digest from the signed nodejs.org release artifacts.
FAILURE='NorthStar production build rejected the Node runtime.'
CANONICAL_ROOT='/app'
CANONICAL_SCRIPT='/app/scripts/prepare-production-node.sh'
NODE_PATH='/usr/local/bin/node'
NPM_CLI='/usr/local/lib/node_modules/npm/bin/npm-cli.js'

fail() {
  echo "$FAILURE" >&2
  exit 78
}

if [ "$0" != "$CANONICAL_SCRIPT" ] || [ "$(/bin/pwd -P)" != "$CANONICAL_ROOT" ]; then
  fail
fi
for utility in /usr/bin/dpkg /usr/bin/od /usr/bin/readlink /usr/bin/sha256sum /usr/bin/stat; do
  [ -x "$utility" ] && [ ! -L "$utility" ] || fail
done
if [ "$(/usr/bin/readlink -f -- "$CANONICAL_ROOT")" != "$CANONICAL_ROOT" ] ||
   [ "$(/usr/bin/readlink -f -- "$CANONICAL_SCRIPT")" != "$CANONICAL_SCRIPT" ] ||
   [ -L "$CANONICAL_ROOT" ] || [ -L "$CANONICAL_ROOT/scripts" ] ||
   [ -L "$CANONICAL_SCRIPT" ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$CANONICAL_ROOT")" != '0:755' ] ||
   [ "$(/usr/bin/stat -c '%u:%a' -- "$CANONICAL_ROOT/scripts")" != '0:755' ] ||
   [ "$(/usr/bin/stat -c '%u:%a:%h' -- "$CANONICAL_SCRIPT")" != '0:644:1' ]; then
  fail
fi

platform=$(/usr/bin/dpkg --print-architecture) || fail
case "$platform:$NORTHSTAR_TARGETARCH" in
  amd64:amd64)
    runtime_arch='x64'
    expected_sha256='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
    elf_machine='3e'
    ;;
  arm64:arm64)
    runtime_arch='arm64'
    expected_sha256='d09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d'
    elf_machine='b7'
    ;;
  *) fail ;;
esac
if [ ! -f "$NODE_PATH" ] || [ ! -x "$NODE_PATH" ] || [ -L "$NODE_PATH" ] ||
   [ "$(/usr/bin/readlink -f -- "$NODE_PATH")" != "$NODE_PATH" ] ||
   [ "$(/usr/bin/stat -c '%u' -- "$NODE_PATH")" != '0' ]; then
  fail
fi
printf '%s  %s\n' "$expected_sha256" "$NODE_PATH" |
  /usr/bin/sha256sum -c - >/dev/null || fail
# Both pinned Node 22.23.3 Linux artifacts declare ELFOSABI_LINUX (03).
set -- $(/usr/bin/od -An -tx1 -N20 -- "$NODE_PATH")
if [ "$#" -ne 20 ] || [ "$1" != '7f' ] || [ "$2" != '45' ] ||
   [ "$3" != '4c' ] || [ "$4" != '46' ] || [ "$5" != '02' ] ||
   [ "$6" != '01' ] || [ "$8" != '03' ] || [ "${19}" != "$elf_machine" ] ||
   [ "${20}" != '00' ]; then
  fail
fi

# Only an executable that passed the hash and ELF gates may run.
[ "$($NODE_PATH --version)" = 'v22.23.3' ] || fail
[ "$($NODE_PATH "$NPM_CLI" --version)" = '10.9.9' ] || fail
/bin/chmod 0555 "$NODE_PATH"
node_bin=${NODE_PATH%/node}
node_root=${node_bin%/bin}
[ "$(/usr/bin/stat -c '%u:%a' -- "$NODE_PATH")" = '0:555' ] || fail
[ "$(/usr/bin/stat -c '%u:%a' -- "$node_bin")" = '0:755' ] || fail
[ "$(/usr/bin/stat -c '%u:%a' -- "$node_root")" = '0:755' ] || fail

runtime_directory="$CANONICAL_ROOT/.northstar-runtime"
[ -d "$runtime_directory" ] && [ ! -L "$runtime_directory" ] || fail
[ "$(/usr/bin/readlink -f -- "$runtime_directory")" = "$runtime_directory" ] || fail
[ "$(/usr/bin/stat -c '%u:%a' -- "$runtime_directory")" = '0:755' ] || fail
umask 022
printf '%s\n' "$NODE_PATH" > "$runtime_directory/node-path"
printf '%s\n' "$expected_sha256" > "$runtime_directory/node-sha256"
printf '%s\n' "$runtime_arch" > "$runtime_directory/node-arch"
for manifest in "$runtime_directory/node-path" "$runtime_directory/node-sha256" \
  "$runtime_directory/node-arch"; do
  [ ! -L "$manifest" ] || fail
  [ "$(/usr/bin/readlink -f -- "$manifest")" = "$manifest" ] || fail
  [ "$(/usr/bin/stat -c '%u:%a:%h' -- "$manifest")" = '0:644:1' ] || fail
done
