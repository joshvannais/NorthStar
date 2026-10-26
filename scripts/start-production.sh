#!/bin/sh
set -eu

# This shell boundary runs before any Node executable is selected. It never
# resolves through PATH: shell builtins and fixed root-owned utilities bind the
# deployed process to the exact Official Image Node selected at build time.
FAILURE='NorthStar production startup rejected the Node runtime.'
CANONICAL_ROOT='/app'
CANONICAL_SCRIPT='/app/scripts/start-production.sh'
startup_check='NS14B-00'

fail() {
  # Check identifiers are fixed source literals. They identify only the public
  # startup gate that rejected; no environment value, path selected by a
  # caller, credential, digest, database fact, or stack trace is emitted.
  case "$startup_check" in
    NS14B-00|NS14B-01|NS14B-02|NS14B-03|NS14B-04|NS14B-05|NS14B-06|\
    NS14B-07|NS14B-08|NS14B-09|NS14B-10|NS14B-11|NS14B-12|\
    NS14B-13A|NS14B-13B|NS14B-13C|NS14B-13D|NS14B-13E|NS14B-13F|\
    NS14B-13G|NS14B-13H|NS14B-13I|NS14B-13J|NS14B-13K|NS14B-13L|NS14B-13M|\
    NS14B-13N|\
    NS14B-14|NS14B-15|NS14B-16|NS14B-17|NS14B-18) ;;
    *) startup_check='NS14B-00' ;;
  esac
  echo "$FAILURE Check $startup_check." >&2
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
      Groups:*)
        set -- $status_line
        # A numeric OCI USER may start with supplementary groups cleared or
        # with its primary group repeated as the sole supplementary group.
        # Both preserve the exact GID 1000 boundary above; any other or
        # additional supplementary group fails closed.
        if [ "$#" -eq 1 ]; then
          :
        elif [ "$#" -eq 2 ] && [ "$2" = 1000 ]; then
          :
        else
          return 1
        fi
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
  [ "$saw_uid$saw_gid$saw_groups$saw_cap_inh$saw_cap_prm$saw_cap_eff$saw_cap_amb$saw_no_new_privs" = 11111111 ]
}

startup_check='NS14B-01'
check_runtime_identity || fail

startup_check='NS14B-02'
if [ -n "${LD_PRELOAD-}" ] || [ -n "${LD_LIBRARY_PATH-}" ]; then
  fail
fi

# The Railway Docker build copies the source tree to /app. Accept only the physical canonical
# script or the documented relative spelling while already in physical /app.
# Caller-controlled PWD, INIT_CWD, CDPATH, npm variables, and alternate trees
# never select a repository root.
startup_check='NS14B-03'
if [ "$0" = "$CANONICAL_SCRIPT" ]; then
  :
elif [ "$0" = 'scripts/start-production.sh' ] &&
     [ "$(/bin/pwd -P)" = "$CANONICAL_ROOT" ]; then
  :
else
  fail
fi
startup_check='NS14B-04'
if [ ! -x /usr/bin/dpkg ] || [ ! -x /usr/bin/readlink ] ||
   [ ! -x /usr/bin/sha256sum ] || [ ! -x /usr/bin/stat ] ||
   [ ! -x /usr/bin/od ]; then
  fail
fi
startup_check='NS14B-05'
if [ "$(/usr/bin/readlink -f -- "$CANONICAL_ROOT")" != "$CANONICAL_ROOT" ] ||
   [ "$(/usr/bin/readlink -f -- "$CANONICAL_SCRIPT")" != "$CANONICAL_SCRIPT" ] ||
   [ -L "$CANONICAL_ROOT" ] || [ -L "$CANONICAL_ROOT/scripts" ] ||
   [ -L "$CANONICAL_SCRIPT" ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$CANONICAL_ROOT")" != '0:0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$CANONICAL_ROOT/scripts")" != '0:0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$CANONICAL_SCRIPT")" != '0:0:444:1' ]; then
  fail
fi

startup_check='NS14B-06'
if [ "${NODE_OPTIONS+x}" = x ] && [ -n "${NODE_OPTIONS}" ]; then
  fail
fi
if [ "${NODE_PATH+x}" = x ] && [ -n "${NODE_PATH}" ]; then
  fail
fi
if [ "${NPM_CONFIG_NODE_OPTIONS+x}" = x ] && [ -n "${NPM_CONFIG_NODE_OPTIONS}" ]; then
  fail
fi
if [ "${npm_config_node_options+x}" = x ] && [ -n "${npm_config_node_options}" ]; then
  fail
fi

# Local/test executable selection is deliberately a different command. None
# of its inputs are accepted by the Railway/Docker production boundary.
startup_check='NS14B-07'
if [ -n "${NODE_BINARY-}" ] || [ -n "${NORTHSTAR_NODE_BINARY-}" ] ||
   [ -n "${NORTHSTAR_LOCAL_NODE_BINARY-}" ] ||
   [ -n "${NORTHSTAR_LOCAL_NODE_SHA256-}" ] ||
   [ -n "${NORTHSTAR_NODE_RUNTIME_MODE-}" ] ||
   [ -n "${NORTHSTAR_PRODUCTION_NODE_PATH-}" ] ||
   [ -n "${NORTHSTAR_NIX_STORE_ROOT-}" ]; then
  fail
fi

runtime_directory="$CANONICAL_ROOT/.northstar-runtime"
manifest="$runtime_directory/node-path"
sha_manifest="$runtime_directory/node-sha256"
arch_manifest="$runtime_directory/node-arch"
privilege_manifest="$runtime_directory/privilege-inventory"
privilege_sha_manifest="$runtime_directory/privilege-inventory.sha256"
executable_manifest="$runtime_directory/executable-inventory"
executable_sha_manifest="$runtime_directory/executable-inventory.sha256"
startup_check='NS14B-08'
if [ ! -f "$manifest" ] || [ -L "$manifest" ] ||
   [ ! -f "$sha_manifest" ] || [ -L "$sha_manifest" ] ||
   [ ! -f "$arch_manifest" ] || [ -L "$arch_manifest" ] ||
   [ ! -f "$privilege_manifest" ] || [ -L "$privilege_manifest" ] ||
   [ ! -f "$privilege_sha_manifest" ] || [ -L "$privilege_sha_manifest" ] ||
   [ ! -f "$executable_manifest" ] || [ -L "$executable_manifest" ] ||
   [ ! -f "$executable_sha_manifest" ] || [ -L "$executable_sha_manifest" ]; then
  fail
fi
startup_check='NS14B-09'
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
startup_check='NS14B-10'
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
startup_check='NS14B-11'
/usr/bin/sha256sum -c "$privilege_sha_manifest" >/dev/null 2>&1 || fail
exec 3< "$privilege_manifest"
for expected_privilege_line in northstar-privilege-inventory-v4 setid=none filecap=none \
  runtime_uid=1000 runtime_gid=1000 pinned_helper=/usr/sbin/capsh \
  pinned_helper=/usr/sbin/getpcaps pinned_helper=/usr/sbin/setcap \
  deprivileged_helper=/usr/bin/chage deprivileged_helper=/usr/bin/chfn \
  deprivileged_helper=/usr/bin/chsh deprivileged_helper=/usr/bin/expiry \
  deprivileged_helper=/usr/bin/gpasswd deprivileged_helper=/usr/bin/mount \
  deprivileged_helper=/usr/bin/newgrp deprivileged_helper=/usr/bin/passwd \
  deprivileged_helper=/usr/bin/su deprivileged_helper=/usr/bin/umount \
  deprivileged_helper=/usr/sbin/unix_chkpwd; do
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
    capsh_sha='16246b635b9a566874e1374bb2c686379cb1ff7e57497d9bb71869d77d3bc35c'
    capsh_size='54568'
    getpcaps_sha='e7d7113447a52f62eae75aebb44e6f14b4706ac840a668260090e5b818af629d'
    getpcaps_size='14576'
    setcap_sha='58b227dc41893b9b29e40e68a1c2af081e3a84630371980071056a80fed8fbe0'
    setcap_size='14576'
    chage_sha='f1aced4c56099e77221aa8a408a073a41d971520fd82108bd8e737cad6e7fcd1'; chage_size='80376'
    chfn_sha='0d91ea5e4961f4b09526e7eba8f1aa7fea53b56290019c656dba29256c860bb4'; chfn_size='62672'
    chsh_sha='e9ea120b0d271feb49f02ad923e8789f51128beb0f41be11f1a0e7e46484bdf0'; chsh_size='52880'
    expiry_sha='76ca5abc17ecc1ec50f9716f91b7ec9044bce69431b4fc3f172489b56d41e308'; expiry_size='31184'
    gpasswd_sha='f5ddf4ff327b07c2e1109645d35b0f75011d20877c9a0c2c1b0678dd1b8c3879'; gpasswd_size='88496'
    mount_sha='18ca60a1e1c93f58fca00607ad32bf192fea00157eac73a5341f8bd1c2201403'; mount_size='59704'
    newgrp_sha='ced400910c4fe7ab0676ae07ee6489d677baa18e1425750a21b9688ab2e02fb6'; newgrp_size='48896'
    passwd_sha='d30cd42625b51cb54c49edc5b0b3348d6a438539446af3752a6af10393c4f2d2'; passwd_size='68248'
    su_sha='4b8bb44ac13b8f8f8c08708faff91a9b63b3fa369b8cbfe1abb5ef09e8029993'; su_size='72000'
    umount_sha='54bf7fbc1db029188f5d7e1397f4ad7b2cd1e2d7a57869002d390063cbbb3268'; umount_size='35128'
    unix_chkpwd_sha='0ef065c7d555e7dc66789956ae2a67547a98a38fc5f846373975c85e95009345'; unix_chkpwd_size='39160'
    ;;
  arm64:d09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d)
    setpriv_sha='24410fedc29286402ae3b366bd3a78c3d177f7a1190797f1ea564f190097356c'
    setpriv_size='133288'
    getcap_sha='dfd4546e0dbf6213e920622249d10e4469a4e41cfbdc62fd0da2472acffdd836'
    getcap_size='67672'
    capsh_sha='ce65733af73e8357b3b61ed9495254147f70a9783af257d2dad5ab5445f44dc7'
    capsh_size='70464'
    getpcaps_sha='2979481886c0ebd48a0ffbe5dcd2d2d63cb6cc8d9e23174558e774cc0dc03246'
    getpcaps_size='67672'
    setcap_sha='17caa8b013d9c946534dd9973d69040066778e92ac5e756e06572cc6f6c492c7'
    setcap_size='67672'
    chage_sha='be8de5f4f97c24251b9265acfc814e8565f3045c69cab72f1dd8c31002fe64f0'; chage_size='137424'
    chfn_sha='41732ba55e81bdd78c784fbe80ca85e76c7e076a4dbd1a23ef0a6607a9042540'; chfn_size='70616'
    chsh_sha='ac7c3f9f29f423b9edb8b6bf449ec65fec4b2aa047011908d6e42e9f2f603d25'; chsh_size='69064'
    expiry_sha='e8f60724dd66050667a72c415e116c13aec2dc9d320a3dc711959a63a99d8d49'; expiry_size='67880'
    gpasswd_sha='91280540427c40502aad93ea821f848061f49eadb36994ce5c8e2de6fdb3a42b'; gpasswd_size='137352'
    mount_sha='4e3aa9cd2b207144bc3206a95019fcdeeac9114cb58d9b19850b948b2003c2ef'; mount_size='67744'
    newgrp_sha='0466e757f261cc50fa879f50c0663372e399fa6653a659053037faaa334da104'; newgrp_size='69176'
    passwd_sha='bc0b502346f44eff9bf08cfd121b280684652a7e8eb4e78cba6404d32892ebf0'; passwd_size='72048'
    su_sha='c673b670821b019213950a266be48d235cd2faf6692ea7f50c399dc4a59c0396'; su_size='133312'
    umount_sha='60ac2e037660e390520585a8d6afd4ee09949eead31dbb18c21b07245d082816'; umount_size='67744'
    unix_chkpwd_sha='18b7c15bf7267ad65341e19e682e136c3f60d2de88944dcd66ededfab7442ac1'; unix_chkpwd_size='67680'
    ;;
  *) fail ;;
esac

startup_check='NS14B-12'
/usr/bin/sha256sum -c "$executable_sha_manifest" >/dev/null 2>&1 || fail
exec 3< "$executable_manifest"
for expected_executable_line in northstar-executable-inventory-v5 \
  setpriv_path=/usr/bin/setpriv "setpriv_sha256=$setpriv_sha" \
  "setpriv_size=$setpriv_size" setpriv_mode_policy=0555-or-0755 \
  getcap_path=/usr/sbin/getcap "getcap_sha256=$getcap_sha" \
  "getcap_size=$getcap_size" getcap_mode_policy=0555-or-0755 \
  capsh_path=/usr/sbin/capsh "capsh_sha256=$capsh_sha" \
  "capsh_size=$capsh_size" capsh_mode_policy=0555-or-0755 \
  getpcaps_path=/usr/sbin/getpcaps "getpcaps_sha256=$getpcaps_sha" \
  "getpcaps_size=$getpcaps_size" getpcaps_mode_policy=0555-or-0755 \
  setcap_path=/usr/sbin/setcap "setcap_sha256=$setcap_sha" \
  "setcap_size=$setcap_size" setcap_mode_policy=0555-or-0755; do
  IFS= read -r executable_line <&3 || fail
  [ "$executable_line" = "$expected_executable_line" ] || fail
done
if IFS= read -r executable_line <&3; then
  exec 3<&-
  fail
fi
exec 3<&-

check_setpriv_identity() {
  startup_check='NS14B-13A'
  [ -f /usr/bin/setpriv ] && [ -x /usr/bin/setpriv ] || fail
  startup_check='NS14B-13B'
  [ ! -L /usr/bin/setpriv ] &&
    [ "$(/usr/bin/readlink -f -- /usr/bin/setpriv)" = /usr/bin/setpriv ] || fail
  startup_check='NS14B-13C'
  [ "$(/usr/bin/stat -c '%s' -- /usr/bin/setpriv)" = "$setpriv_size" ] || fail
  startup_check='NS14B-13D'
  case "$(/usr/bin/stat -c '%u:%g:%a' -- /usr/bin/setpriv)" in
    0:0:555|0:0:755) ;;
    *) fail ;;
  esac
  startup_check='NS14B-13E'
  /usr/bin/printf '%s  %s\n' "$setpriv_sha" /usr/bin/setpriv |
    /usr/bin/sha256sum -c - >/dev/null 2>&1 || fail
}

check_getcap_identity() {
  startup_check='NS14B-13F'
  [ -f /usr/sbin/getcap ] && [ -x /usr/sbin/getcap ] || fail
  startup_check='NS14B-13G'
  [ ! -L /usr/sbin/getcap ] &&
    [ "$(/usr/bin/readlink -f -- /usr/sbin/getcap)" = /usr/sbin/getcap ] || fail
  startup_check='NS14B-13H'
  [ "$(/usr/bin/stat -c '%s' -- /usr/sbin/getcap)" = "$getcap_size" ] || fail
  startup_check='NS14B-13I'
  case "$(/usr/bin/stat -c '%u:%g:%a' -- /usr/sbin/getcap)" in
    0:0:555|0:0:755) ;;
    *) fail ;;
  esac
  startup_check='NS14B-13J'
  /usr/bin/printf '%s  %s\n' "$getcap_sha" /usr/sbin/getcap |
    /usr/bin/sha256sum -c - >/dev/null 2>&1 || fail
}

check_setpriv_identity
check_getcap_identity
startup_check='NS14B-13K'
[ -f /usr/sbin/capsh ] && [ -x /usr/sbin/capsh ] && [ ! -L /usr/sbin/capsh ] &&
  [ "$(/usr/bin/readlink -f -- /usr/sbin/capsh)" = /usr/sbin/capsh ] &&
  [ "$(/usr/bin/stat -c '%s' -- /usr/sbin/capsh)" = "$capsh_size" ] || fail
case "$(/usr/bin/stat -c '%u:%g:%a' -- /usr/sbin/capsh)" in
  0:0:555|0:0:755) ;;
  *) fail ;;
esac
/usr/bin/printf '%s  %s\n' "$capsh_sha" /usr/sbin/capsh |
  /usr/bin/sha256sum -c - >/dev/null 2>&1 || fail
startup_check='NS14B-13L'
[ -f /usr/sbin/getpcaps ] && [ -x /usr/sbin/getpcaps ] && [ ! -L /usr/sbin/getpcaps ] &&
  [ "$(/usr/bin/readlink -f -- /usr/sbin/getpcaps)" = /usr/sbin/getpcaps ] &&
  [ "$(/usr/bin/stat -c '%s' -- /usr/sbin/getpcaps)" = "$getpcaps_size" ] || fail
case "$(/usr/bin/stat -c '%u:%g:%a' -- /usr/sbin/getpcaps)" in
  0:0:555|0:0:755) ;;
  *) fail ;;
esac
/usr/bin/printf '%s  %s\n' "$getpcaps_sha" /usr/sbin/getpcaps |
  /usr/bin/sha256sum -c - >/dev/null 2>&1 || fail
startup_check='NS14B-13M'
[ -f /usr/sbin/setcap ] && [ -x /usr/sbin/setcap ] && [ ! -L /usr/sbin/setcap ] &&
  [ "$(/usr/bin/readlink -f -- /usr/sbin/setcap)" = /usr/sbin/setcap ] &&
  [ "$(/usr/bin/stat -c '%s' -- /usr/sbin/setcap)" = "$setcap_size" ] || fail
case "$(/usr/bin/stat -c '%u:%g:%a' -- /usr/sbin/setcap)" in
  0:0:555|0:0:755) ;;
  *) fail ;;
esac
/usr/bin/printf '%s  %s\n' "$setcap_sha" /usr/sbin/setcap |
  /usr/bin/sha256sum -c - >/dev/null 2>&1 || fail

# The pinned package tools remain ordinary root-owned executables with no
# set-id bit or file capability. Prove that this uid-1000, zero-capability,
# no-new-privileges process cannot use the mutation helper to install one.
startup_check='NS14B-13N'
privilege_probe="$TMPDIR/.northstar-capability-probe-$$"
umask 077
set -C
: > "$privilege_probe" || { set +C; fail; }
set +C
[ -f "$privilege_probe" ] && [ ! -L "$privilege_probe" ] &&
  [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$privilege_probe")" = '1000:1000:600' ] || {
  /bin/rm -f "$privilege_probe"
  fail
}
/bin/chmod 0700 "$privilege_probe" || { /bin/rm -f "$privilege_probe"; fail; }
if /usr/sbin/capsh --has-p=cap_setuid >/dev/null 2>&1 ||
   /usr/sbin/setcap cap_setuid=ep "$privilege_probe" >/dev/null 2>&1; then
  /usr/sbin/setcap -r "$privilege_probe" >/dev/null 2>&1 || :
  /bin/rm -f "$privilege_probe"
  fail
fi
probe_capability=$(/usr/sbin/getcap "$privilege_probe" 2>/dev/null) || {
  /bin/rm -f "$privilege_probe"
  fail
}
[ -z "$probe_capability" ] || { /bin/rm -f "$privilege_probe"; fail; }
/bin/rm -f "$privilege_probe" || fail

startup_check='NS14B-14'
check_deprivileged_helper() {
  helper_path=$1
  helper_size=$2
  helper_sha=$3
  [ -f "$helper_path" ] && [ -x "$helper_path" ] && [ ! -L "$helper_path" ] &&
    [ "$(/usr/bin/readlink -f -- "$helper_path" 2>/dev/null)" = "$helper_path" ] &&
    [ "$(/usr/bin/stat -c '%s' -- "$helper_path" 2>/dev/null)" = "$helper_size" ] || fail
  case "$(/usr/bin/stat -c '%u:%g:%a' -- "$helper_path" 2>/dev/null)" in
    0:0:555|0:0:755) ;;
    *) fail ;;
  esac
  /usr/bin/printf '%s  %s\n' "$helper_sha" "$helper_path" |
    /usr/bin/sha256sum -c - >/dev/null 2>&1 || fail
}
check_deprivileged_helper /usr/bin/chage "$chage_size" "$chage_sha"
check_deprivileged_helper /usr/bin/chfn "$chfn_size" "$chfn_sha"
check_deprivileged_helper /usr/bin/chsh "$chsh_size" "$chsh_sha"
check_deprivileged_helper /usr/bin/expiry "$expiry_size" "$expiry_sha"
check_deprivileged_helper /usr/bin/gpasswd "$gpasswd_size" "$gpasswd_sha"
check_deprivileged_helper /usr/bin/mount "$mount_size" "$mount_sha"
check_deprivileged_helper /usr/bin/newgrp "$newgrp_size" "$newgrp_sha"
check_deprivileged_helper /usr/bin/passwd "$passwd_size" "$passwd_sha"
check_deprivileged_helper /usr/bin/su "$su_size" "$su_sha"
check_deprivileged_helper /usr/bin/umount "$umount_size" "$umount_sha"
check_deprivileged_helper /usr/sbin/unix_chkpwd "$unix_chkpwd_size" "$unix_chkpwd_sha"
for privilege_root in /usr "$CANONICAL_ROOT" /var/lib/northstar /tmp /home; do
  [ -e "$privilege_root" ] || continue
  unexpected_setid=$(/usr/bin/find "$privilege_root" -xdev -type f \
    -perm /6000 -print -quit) || fail
  [ -z "$unexpected_setid" ] || fail
done
unexpected_filecap=$(/usr/sbin/getcap -r /usr "$CANONICAL_ROOT" /var/lib/northstar \
  /tmp /home 2>/dev/null) || fail
[ -z "$unexpected_filecap" ] || fail
startup_check='NS14B-15'
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
  fail
}
if [ "$canonical_path" != "$node_path" ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$node_path")" != '0:0:555' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$node_bin")" != '0:0:755' ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$node_root")" != '0:0:755' ]; then
  fail
fi
printf '%s  %s\n' "$node_sha256" "$node_path" |
  /usr/bin/sha256sum -c - >/dev/null 2>&1 || fail
# Both pinned Node 22.23.3 Linux artifacts declare ELFOSABI_LINUX (03).
set -- $(/usr/bin/od -An -tx1 -N20 -- "$node_path")
case "$runtime_arch" in
  x64) elf_machine='3e' ;;
  arm64) elf_machine='b7' ;;
  *) fail ;;
esac
if [ "$#" -ne 20 ] || [ "$1" != '7f' ] || [ "$2" != '45' ] ||
   [ "$3" != '4c' ] || [ "$4" != '46' ] || [ "$5" != '02' ] ||
   [ "$6" != '01' ] || [ "$8" != '03' ] || [ "${19}" != "$elf_machine" ] ||
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
startup_check='NS14B-16'
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
check_setpriv_identity
check_getcap_identity
startup_check='NS14B-17'
for protected_directory in "$CANONICAL_ROOT" "$CANONICAL_ROOT/scripts" \
  "$CANONICAL_ROOT/src" "$CANONICAL_ROOT/node_modules" "$runtime_directory" \
  "$node_root" "$node_bin" /usr/bin /usr/sbin /usr/local/lib \
  /usr/local/lib/node_modules /usr/lib; do
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
startup_check='NS14B-18'
exec "$node_path" "$launcher" || fail
