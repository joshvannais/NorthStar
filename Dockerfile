# syntax=docker/dockerfile:1
# The digest is the Docker Official Image multi-architecture index for exact
# Node 22.23.3 bookworm-slim. The build verifies the selected architecture's
# executable against the independently pinned nodejs.org artifact digest.
FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS pinned-node

LABEL com.northstar.node.version="22.23.3" \
      com.northstar.node.image-index="sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392" \
      com.northstar.node.linux-amd64-manifest="sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562" \
      com.northstar.node.linux-arm64-manifest="sha256:b20fe038d9592822dd534600a1ddf467e985178aa3fed60ec441a056c2cc45bd" \
      com.northstar.node.source-revision="81f419144a1251854c6d9afb09eaa39928e724e8"

FROM pinned-node AS dependencies
ARG TARGETARCH
WORKDIR /app
COPY --chown=0:0 package.json package-lock.json ./
RUN case "$TARGETARCH" in \
      amd64) expected='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48' ;; \
      arm64) expected='d09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d' ;; \
      *) echo 'Unsupported NorthStar production architecture.' >&2; exit 78 ;; \
    esac \
    && printf '%s  %s\n' "$expected" /usr/local/bin/node | /usr/bin/sha256sum -c - \
    && test "$(/usr/local/bin/node --version)" = 'v22.23.3' \
    && test "$(/usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js --version)" = '10.9.9' \
    && /usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js \
         ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM pinned-node AS runtime
ARG TARGETARCH
WORKDIR /app
RUN /usr/bin/apt-get update \
    && /usr/bin/apt-get install -y --no-install-recommends \
         libcap2=1:2.66-4+deb12u3+b1 libcap2-bin=1:2.66-4+deb12u3+b1 \
    && /bin/rm -rf /var/lib/apt/lists/*
COPY --chown=0:0 . /app
COPY --from=dependencies --chown=0:0 /app/node_modules /app/node_modules
RUN NORTHSTAR_TARGETARCH="$TARGETARCH" /bin/sh /app/scripts/prepare-production-node.sh \
    && test "$(/usr/bin/id -u node)" = '1000' \
    && test "$(/usr/bin/id -g node)" = '1000' \
    && test "$(/usr/bin/id -G node)" = '1000' \
    && /bin/mkdir -p /var/lib/northstar/data /var/lib/northstar/tmp /var/lib/northstar/home \
    && if test -d /app/data; then /bin/cp -a /app/data/. /var/lib/northstar/data/; fi \
    && /bin/chown -R 1000:1000 /var/lib/northstar \
    && /bin/chmod 0700 /var/lib/northstar /var/lib/northstar/data \
         /var/lib/northstar/tmp /var/lib/northstar/home \
    && /bin/chown -R 0:0 /app \
    && /usr/bin/find /app -xdev -type d -exec /bin/chmod 0555 '{}' + \
    && /usr/bin/find /app -xdev -type f -exec /bin/chmod 0444 '{}' + \
    && /usr/bin/find /usr/local -xdev -type d -exec /bin/chmod go-w '{}' + \
    && /usr/bin/find /usr/local -xdev -type f -exec /bin/chmod go-w '{}' + \
    && /bin/chmod 0555 /usr/local/bin/node \
    && /bin/rm -f /usr/bin/chfn /usr/bin/chsh /usr/bin/gpasswd /usr/bin/mount \
         /usr/bin/newgrp /usr/bin/passwd /usr/bin/su /usr/bin/umount \
         /usr/bin/chage /usr/bin/expiry /usr/sbin/unix_chkpwd \
    && /usr/bin/find / -xdev -type f -perm /6000 -exec /bin/chmod a-s '{}' + \
    && capability_inventory=/tmp/northstar-file-capabilities \
    && /usr/sbin/getcap -r / 2>/dev/null > "$capability_inventory" \
    && while IFS= read -r capability_entry; do \
         test -z "$capability_entry" && continue; \
         capability_path=${capability_entry% *}; \
         test "$capability_path" != "$capability_entry" || exit 78; \
         /usr/sbin/setcap -r "$capability_path"; \
       done < "$capability_inventory" \
    && /bin/rm -f "$capability_inventory" /usr/sbin/setcap \
    && /bin/rm -f /usr/sbin/capsh /usr/sbin/getpcaps \
    && /bin/chmod 0555 /usr/bin/setpriv /usr/sbin/getcap \
    && case "$TARGETARCH" in \
         amd64) setpriv_sha='d5839b20edb0d77222b1e11be7d155c7122d381dbfad40876b0def7dd710f5bd'; setpriv_size='80192'; \
                  getcap_sha='815e0a9db190b9f50e83a9443daa368c705bf466142521b12b4770bf7f69f579'; getcap_size='14576' ;; \
         arm64) setpriv_sha='24410fedc29286402ae3b366bd3a78c3d177f7a1190797f1ea564f190097356c'; setpriv_size='133288'; \
                  getcap_sha='dfd4546e0dbf6213e920622249d10e4469a4e41cfbdc62fd0da2472acffdd836'; getcap_size='67672' ;; \
         *) exit 78 ;; \
       esac \
    && printf '%s  %s\n' "$setpriv_sha" /usr/bin/setpriv | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$getcap_sha" /usr/sbin/getcap | /usr/bin/sha256sum -c - \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/setpriv)" = "$setpriv_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/sbin/getcap)" = "$getcap_size" \
    && /usr/bin/printf '%s\n' 'northstar-privilege-inventory-v2' \
         'setid=none' 'filecap=none' 'runtime_uid=1000' 'runtime_gid=1000' \
         'removed_helper=/usr/sbin/capsh' 'removed_helper=/usr/sbin/getpcaps' \
         'removed_helper=/usr/sbin/setcap' \
         > /app/.northstar-runtime/privilege-inventory \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/setpriv)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/sbin/getcap)" = '0:0:555' \
    && /usr/bin/printf '%s\n' 'northstar-executable-inventory-v4' \
         'setpriv_path=/usr/bin/setpriv' "setpriv_sha256=$setpriv_sha" \
         "setpriv_size=$setpriv_size" 'setpriv_mode_policy=0555-or-0755' \
         'getcap_path=/usr/sbin/getcap' "getcap_sha256=$getcap_sha" \
         "getcap_size=$getcap_size" 'getcap_mode_policy=0555-or-0755' \
         > /app/.northstar-runtime/executable-inventory \
    && /usr/bin/sha256sum /app/.northstar-runtime/privilege-inventory \
         > /app/.northstar-runtime/privilege-inventory.sha256 \
    && /usr/bin/sha256sum /app/.northstar-runtime/executable-inventory \
         > /app/.northstar-runtime/executable-inventory.sha256 \
    && /bin/chown 0:0 /app/.northstar-runtime/privilege-inventory \
         /app/.northstar-runtime/privilege-inventory.sha256 \
         /app/.northstar-runtime/executable-inventory \
         /app/.northstar-runtime/executable-inventory.sha256 \
    && /bin/chmod 0444 /app/.northstar-runtime/privilege-inventory \
         /app/.northstar-runtime/privilege-inventory.sha256 \
         /app/.northstar-runtime/executable-inventory \
         /app/.northstar-runtime/executable-inventory.sha256 \
    && test ! -e /usr/sbin/capsh && test ! -L /usr/sbin/capsh \
    && test ! -e /usr/sbin/getpcaps && test ! -L /usr/sbin/getpcaps \
    && test ! -e /usr/sbin/setcap && test ! -L /usr/sbin/setcap \
    && test -z "$(/usr/bin/find / -xdev -type f -perm /6000 -print -quit)" \
    && test -z "$(/usr/sbin/getcap -r / 2>/dev/null)" \
    && test -z "$(/usr/bin/find /usr/lib -xdev \( -type f -o -type d \) \
         \( ! -uid 0 -o ! -gid 0 -o -perm /022 \) -print -quit)"

ENV HOME=/var/lib/northstar/home \
    NORTHSTAR_DATA_DIR=/var/lib/northstar/data \
    TMPDIR=/var/lib/northstar/tmp \
    TMP=/var/lib/northstar/tmp \
    TEMP=/var/lib/northstar/tmp

USER 1000:1000
CMD ["/usr/bin/setpriv", "--no-new-privs", "--", "/bin/sh", "/app/scripts/start-production.sh"]
