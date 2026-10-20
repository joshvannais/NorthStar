#!/bin/sh
set -eu

# This shell boundary runs before any Node executable is selected. It never
# resolves through PATH: shell builtins and fixed root-owned utilities bind the
# deployed process to the exact Official Image Node selected at build time.
FAILURE='NorthStar production startup rejected the Node runtime.'
CANONICAL_ROOT='/app'
CANONICAL_SCRIPT='/app/scripts/start-production.sh'

fail() {
  echo "$FAILURE" >&2
  exit 78
}

check_runtime_identity() {
  saw_uid=0
  saw_gid=0
  saw_groups=0
  saw_cap_inh=0
  saw_cap_prm=0
  saw_cap_eff=0
  saw_cap_amb=0
  saw_no_new_privs=0
  while IFS= read -r status_line; do
    case "$status_line" in
      Uid:*) set -- $status_line; [ "$#" -eq 5 ] &&
        [ "$2" = 1000 ] && [ "$3" = 1000 ] && [ "$4" = 1000 ] &&
        [ "$5" = 1000 ] || return 1; saw_uid=1 ;;
      Gid:*) set -- $status_line; [ "$#" -eq 5 ] &&
        [ "$2" = 1000 ] && [ "$3" = 1000 ] && [ "$4" = 1000 ] &&
        [ "$5" = 1000 ] || return 1; saw_gid=1 ;;
      Groups:*) set -- $status_line; [ "$#" -eq 2 ] && [ "$2" = 1000 ] || return 1;
        saw_groups=1 ;;
      CapInh:*) set -- $status_line; [ "$2" = 0000000000000000 ] || return 1;
        saw_cap_inh=1 ;;
      CapPrm:*) set -- $status_line; [ "$2" = 0000000000000000 ] || return 1;
        saw_cap_prm=1 ;;
      CapEff:*) set -- $status_line; [ "$2" = 0000000000000000 ] || return 1;
        saw_cap_eff=1 ;;
      CapAmb:*) set -- $status_line; [ "$2" = 0000000000000000 ] || return 1;
        saw_cap_amb=1 ;;
      NoNewPrivs:*) set -- $status_line; [ "$2" = 1 ] || return 1;
        saw_no_new_privs=1 ;;
    esac
  done < /proc/self/status
  [ "$saw_uid$saw_gid$saw_groups$saw_cap_inh$saw_cap_prm$saw_cap_eff$saw_cap_amb$saw_no_new_privs" =
    11111111 ]
}

check_runtime_identity || fail

if [ -n "${LD_PRELOAD-}" ] || [ -n "${LD_LIBRARY_PATH-}" ]; then
  fail
fi

# The Railway Docker build copies the source tree to /app. Accept only the physical canonical
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
if [ ! -x /usr/bin/dpkg ] || [ ! -x /usr/bin/readlink ] ||
   [ ! -x /usr/bin/sha256sum ] || [ ! -x /usr/bin/stat ] ||
   [ ! -x /usr/bin/od ]; then
  fail
fi
if [ "$(/usr/bin/readlink -f -- "$CANONICAL_ROOT")" != "$CANONICAL_ROOT" ] ||
   [ "$(/usr/bin/readlink -f -- "$CANONICAL_SCRIPT")" != "$CANONICAL_SCRIPT" ] ||
   [ -L "$CANONICAL_ROOT" ] || [ -L "$CANONICAL_ROOT/scripts" ] ||
   [ -L "$CANONICAL_SCRIPT" ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$CANONICAL_ROOT")" != '0:0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$CANONICAL_ROOT/scripts")" != '0:0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$CANONICAL_SCRIPT")" != '0:0:444:1' ]; then
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
# of its inputs are accepted by the Railway/Docker production boundary.
if [ -n "${NODE_BINARY-}" ] || [ -n "${NORTHSTAR_NODE_BINARY-}" ] ||
   [ -n "${NORTHSTAR_LOCAL_NODE_BINARY-}" ] ||
   [ -n "${NORTHSTAR_LOCAL_NODE_SHA256-}" ] ||
   [ -n "${NORTHSTAR_NODE_RUNTIME_MODE-}" ] ||
   [ -n "${NORTHSTAR_PRODUCTION_NODE_PATH-}" ] ||
   [ -n "${NORTHSTAR_NIX_STORE_ROOT-}" ]; then
  echo "$FAILURE" >&2
  exit 78
fi

runtime_directory="$CANONICAL_ROOT/.northstar-runtime"
manifest="$runtime_directory/node-path"
sha_manifest="$runtime_directory/node-sha256"
arch_manifest="$runtime_directory/node-arch"
privilege_manifest="$runtime_directory/privilege-inventory"
privilege_sha_manifest="$runtime_directory/privilege-inventory.sha256"
executable_manifest="$runtime_directory/executable-inventory"
executable_sha_manifest="$runtime_directory/executable-inventory.sha256"
if [ ! -f "$manifest" ] || [ -L "$manifest" ] ||
   [ ! -f "$sha_manifest" ] || [ -L "$sha_manifest" ] ||
   [ ! -f "$arch_manifest" ] || [ -L "$arch_manifest" ] ||
   [ ! -f "$privilege_manifest" ] || [ -L "$privilege_manifest" ] ||
   [ ! -f "$privilege_sha_manifest" ] || [ -L "$privilege_sha_manifest" ] ||
   [ ! -f "$executable_manifest" ] || [ -L "$executable_manifest" ] ||
   [ ! -f "$executable_sha_manifest" ] || [ -L "$executable_sha_manifest" ]; then
  echo "$FAILURE Missing authenticated Docker runtime manifest." >&2
  exit 78
fi
if [ "$(/usr/bin/readlink -f -- "$runtime_directory")" != "$runtime_directory" ] ||
   [ "$(/usr/bin/readlink -f -- "$manifest")" != "$manifest" ] ||
   [ "$(/usr/bin/readlink -f -- "$sha_manifest")" != "$sha_manifest" ] ||
   [ "$(/usr/bin/readlink -f -- "$arch_manifest")" != "$arch_manifest" ] ||
   [ "$(/usr/bin/readlink -f -- "$privilege_manifest")" != "$privilege_manifest" ] ||
   [ "$(/usr/bin/readlink -f -- "$privilege_sha_manifest")" != "$privilege_sha_manifest" ] ||
   [ "$(/usr/bin/readlink -f -- "$executable_manifest")" != "$executable_manifest" ] ||
   [ "$(/usr/bin/readlink -f -- "$executable_sha_manifest")" != "$executable_sha_manifest" ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$runtime_directory")" != '0:0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$manifest")" != '0:0:444:1' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$sha_manifest")" != '0:0:444:1' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$arch_manifest")" != '0:0:444:1' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$privilege_manifest")" != '0:0:444:1' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$privilege_sha_manifest")" != '0:0:444:1' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$executable_manifest")" != '0:0:444:1' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$executable_sha_manifest")" != '0:0:444:1' ]; then
  fail
fi
read_single_line() {
  file=$1
  exec 3< "$file"
  IFS= read -r value <&3 || fail
  if IFS= read -r extra_line <&3; then
    exec 3<&-
    fail
  fi
  exec 3<&-
  printf '%s' "$value"
}
node_path=$(read_single_line "$manifest")
node_sha256=$(read_single_line "$sha_manifest")
runtime_arch=$(read_single_line "$arch_manifest")
if [ "$node_path" != '/usr/local/bin/node' ]; then
  fail
fi
if [ "${HOME-}" != '/var/lib/northstar/home' ] ||
   [ "${NORTHSTAR_DATA_DIR-}" != '/var/lib/northstar/data' ] ||
   [ "${TMPDIR-}" != '/var/lib/northstar/tmp' ] ||
   [ "${TMP-}" != '/var/lib/northstar/tmp' ] ||
   [ "${TEMP-}" != '/var/lib/northstar/tmp' ]; then
  fail
fi
for writable_directory in "$HOME" "$NORTHSTAR_DATA_DIR" "$TMPDIR"; do
  if [ ! -d "$writable_directory" ] || [ -L "$writable_directory" ] ||
     [ "$(/usr/bin/readlink -f -- "$writable_directory")" != "$writable_directory" ] ||
     [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$writable_directory")" != '1000:1000:700' ]; then
    fail
  fi
done
/usr/bin/sha256sum -c "$privilege_sha_manifest" >/dev/null || fail
exec 3< "$privilege_manifest"
for expected_privilege_line in northstar-privilege-inventory-v2 setid=none filecap=none \
  runtime_uid=1000 runtime_gid=1000 removed_helper=/usr/sbin/capsh \
  removed_helper=/usr/sbin/getpcaps removed_helper=/usr/sbin/setcap; do
  IFS= read -r privilege_line <&3 || fail
  [ "$privilege_line" = "$expected_privilege_line" ] || fail
done
if IFS= read -r privilege_line <&3; then
  exec 3<&-
  fail
fi
exec 3<&-

case "$runtime_arch:$node_sha256" in
  x64:fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48)
    setpriv_sha='d5839b20edb0d77222b1e11be7d155c7122d381dbfad40876b0def7dd710f5bd'
    setpriv_size='80192'
    getcap_sha='815e0a9db190b9f50e83a9443daa368c705bf466142521b12b4770bf7f69f579'
    getcap_size='14576'
    ;;
  arm64:d09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d)
    setpriv_sha='24410fedc29286402ae3b366bd3a78c3d177f7a1190797f1ea564f190097356c'
    setpriv_size='133288'
    getcap_sha='dfd4546e0dbf6213e920622249d10e4469a4e41cfbdc62fd0da2472acffdd836'
    getcap_size='67672'
    ;;
  *) fail ;;
esac

/usr/bin/sha256sum -c "$executable_sha_manifest" >/dev/null || fail
exec 3< "$executable_manifest"
for expected_executable_line in northstar-executable-inventory-v1 \
  setpriv_path=/usr/bin/setpriv "setpriv_sha256=$setpriv_sha" \
  "setpriv_size=$setpriv_size" setpriv_mode=555; do
  IFS= read -r executable_line <&3 || fail
  [ "$executable_line" = "$expected_executable_line" ] || fail
done
IFS= read -r setpriv_build_line <&3 || fail
case "$setpriv_build_line" in setpriv_build_device_inode=*) ;;
  *) fail ;;
esac
setpriv_build_identity=${setpriv_build_line#setpriv_build_device_inode=}
case "$setpriv_build_identity" in
  *:*) build_device=${setpriv_build_identity%%:*};
       build_inode=${setpriv_build_identity#*:} ;;
  *) fail ;;
esac
case "$build_device" in ''|*[!0-9]*) fail ;; esac
case "$build_inode" in ''|*[!0-9]*) fail ;; esac
for expected_executable_line in \
  setpriv_identity_anchor=/app/.northstar-runtime/setpriv.identity \
  getcap_path=/usr/sbin/getcap "getcap_sha256=$getcap_sha" \
  "getcap_size=$getcap_size" getcap_mode=555; do
  IFS= read -r executable_line <&3 || fail
  [ "$executable_line" = "$expected_executable_line" ] || fail
done
IFS= read -r getcap_build_line <&3 || fail
case "$getcap_build_line" in getcap_build_device_inode=*) ;;
  *) fail ;;
esac
getcap_build_identity=${getcap_build_line#getcap_build_device_inode=}
case "$getcap_build_identity" in
  *:*) build_device=${getcap_build_identity%%:*};
       build_inode=${getcap_build_identity#*:} ;;
  *) fail ;;
esac
case "$build_device" in ''|*[!0-9]*) fail ;; esac
case "$build_inode" in ''|*[!0-9]*) fail ;; esac
IFS= read -r executable_line <&3 || fail
[ "$executable_line" = \
  'getcap_identity_anchor=/app/.northstar-runtime/getcap.identity' ] || fail
if IFS= read -r executable_line <&3; then
  exec 3<&-
  fail
fi
exec 3<&-

check_executable_identity() {
  executable_path=$1
  identity_anchor=$2
  executable_sha=$3
  executable_size=$4
  if [ ! -f "$executable_path" ] || [ ! -x "$executable_path" ] ||
     [ -L "$executable_path" ] || [ ! -f "$identity_anchor" ] ||
     [ ! -x "$identity_anchor" ] || [ -L "$identity_anchor" ] ||
     [ "$(/usr/bin/readlink -f -- "$executable_path")" != "$executable_path" ] ||
     [ "$(/usr/bin/readlink -f -- "$identity_anchor")" != "$identity_anchor" ] ||
     [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$executable_path")" != '0:0:555:2' ] ||
     [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$identity_anchor")" != '0:0:555:2' ] ||
     [ "$(/usr/bin/stat -c '%s' -- "$executable_path")" != "$executable_size" ] ||
     [ "$(/usr/bin/stat -c '%d:%i' -- "$executable_path")" != \
       "$(/usr/bin/stat -c '%d:%i' -- "$identity_anchor")" ]; then
    fail
  fi
  /usr/bin/printf '%s  %s\n' "$executable_sha" "$executable_path" |
    /usr/bin/sha256sum -c - >/dev/null || fail
}
check_executable_identity /usr/bin/setpriv \
  "$runtime_directory/setpriv.identity" "$setpriv_sha" "$setpriv_size"
check_executable_identity /usr/sbin/getcap \
  "$runtime_directory/getcap.identity" "$getcap_sha" "$getcap_size"
for removed_helper in /usr/sbin/capsh /usr/sbin/getpcaps /usr/sbin/setcap; do
  [ ! -e "$removed_helper" ] && [ ! -L "$removed_helper" ] || fail
done

for privilege_root in /usr "$CANONICAL_ROOT" /var/lib/northstar /tmp /home; do
  [ -e "$privilege_root" ] || continue
  unexpected_setid=$(/usr/bin/find "$privilege_root" -xdev -type f \
    -perm /6000 -print -quit) || fail
  [ -z "$unexpected_setid" ] || fail
done
unexpected_filecap=$(/usr/sbin/getcap -r /usr "$CANONICAL_ROOT" /var/lib/northstar \
  /tmp /home 2>/dev/null) || fail
[ -z "$unexpected_filecap" ] || fail
platform=$(/usr/bin/dpkg --print-architecture) || fail
case "$platform:$runtime_arch:$node_sha256" in
  amd64:x64:fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48) ;;
  arm64:arm64:d09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d) ;;
  *) fail ;;
esac

# Build-generated manifests are never trusted alone. Verify the exact official
# executable digest, path, ownership, mode, ELF architecture, and directories
# before the first Node instruction runs.
if [ ! -f "$node_path" ] || [ ! -x "$node_path" ] ||
   [ -L "$node_path" ]; then
  fail
fi
node_bin=${node_path%/node}
node_root=${node_bin%/bin}
if [ ! -d "$node_bin" ] || [ ! -d "$node_root" ] ||
   [ -L "$node_bin" ] || [ -L "$node_root" ]; then
  fail
fi

# The pinned Docker Official Image supplies these root-owned Debian utilities
# at fixed paths. They are never resolved through inherited PATH. The selected
# Node executable must be canonical, root-owned, and mode 0555 before it runs.
LC_ALL=C
export LC_ALL
canonical_path=$(/usr/bin/readlink -f -- "$node_path") || {
  echo "$FAILURE" >&2
  exit 78
}
if [ "$canonical_path" != "$node_path" ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$node_path")" != '0:0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$node_bin")" != '0:0:755' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$node_root")" != '0:0:755' ]; then
  fail
fi
printf '%s  %s\n' "$node_sha256" "$node_path" |
  /usr/bin/sha256sum -c - >/dev/null || fail
set -- $(/usr/bin/od -An -tx1 -N20 -- "$node_path")
case "$runtime_arch" in
  x64) elf_machine='3e' ;;
  arm64) elf_machine='b7' ;;
  *) fail ;;
esac
if [ "$#" -ne 20 ] || [ "$1" != '7f' ] || [ "$2" != '45' ] ||
   [ "$3" != '4c' ] || [ "$4" != '46' ] || [ "$5" != '02' ] ||
   [ "$6" != '01' ] || [ "$8" != '00' ] || [ "${19}" != "$elf_machine" ] ||
   [ "${20}" != '00' ]; then
  fail
fi

unset NODE_OPTIONS NODE_PATH NPM_CONFIG_NODE_OPTIONS npm_config_node_options
PATH=$node_bin
export PATH
export HOME NORTHSTAR_DATA_DIR TMPDIR TMP TEMP
NORTHSTAR_AUTHENTICATED_NODE_PATH=$node_path
NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY='official-docker-node-22.23.3-v1'
NORTHSTAR_AUTHENTICATED_NODE_SHA256=$node_sha256
NORTHSTAR_CANONICAL_ROOT=$CANONICAL_ROOT
export NORTHSTAR_AUTHENTICATED_NODE_PATH NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY
export NORTHSTAR_AUTHENTICATED_NODE_SHA256 NORTHSTAR_CANONICAL_ROOT
launcher="$CANONICAL_ROOT/scripts/production-launcher.js"
child="$CANONICAL_ROOT/src/productionChild.js"
server="$CANONICAL_ROOT/src/server.js"
for resource in "$launcher" "$child" "$server" \
  "$CANONICAL_ROOT/package.json" "$CANONICAL_ROOT/package-lock.json" \
  "$CANONICAL_ROOT/Dockerfile" "$CANONICAL_ROOT/railway.toml" \
  "$CANONICAL_ROOT/scripts/node-v22.23.3-runtime-manifest.txt" \
  "$privilege_manifest" "$privilege_sha_manifest" \
  "$executable_manifest" "$executable_sha_manifest"
do
  if [ ! -f "$resource" ] || [ -L "$resource" ] ||
     [ "$(/usr/bin/readlink -f -- "$resource")" != "$resource" ] ||
     [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$resource")" != '0:0:444:1' ]; then
    fail
  fi
done
check_executable_identity /usr/bin/setpriv \
  "$runtime_directory/setpriv.identity" "$setpriv_sha" "$setpriv_size"
check_executable_identity /usr/sbin/getcap \
  "$runtime_directory/getcap.identity" "$getcap_sha" "$getcap_size"
for protected_directory in "$CANONICAL_ROOT" "$CANONICAL_ROOT/scripts" \
  "$CANONICAL_ROOT/src" "$CANONICAL_ROOT/node_modules" "$runtime_directory" \
  "$node_root" "$node_bin" /usr/local/lib /usr/local/lib/node_modules /usr/lib; do
  if [ ! -d "$protected_directory" ] || [ -L "$protected_directory" ] ||
     [ "$(/usr/bin/stat -c '%u:%g' -- "$protected_directory")" != '0:0' ] ||
     [ $((0$(/usr/bin/stat -c '%a' -- "$protected_directory") & 022)) -ne 0 ]; then
    fail
  fi
done
unsafe_runtime_library=$(/usr/bin/find /usr/lib -xdev \
  \( -type f -o -type d \) \
  \( ! -uid 0 -o ! -gid 0 -o -perm /022 \) -print -quit) || fail
[ -z "$unsafe_runtime_library" ] || fail
unsafe_app_entry=$(/usr/bin/find "$CANONICAL_ROOT" -xdev \
  \( -type f -o -type d \) \
  \( ! -uid 0 -o ! -gid 0 -o -perm /022 \) -print -quit) || fail
[ -z "$unsafe_app_entry" ] || fail
CDPATH=''
export CDPATH
cd "$CANONICAL_ROOT" || fail
exec "$node_path" "$launcher"
