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
    && /usr/bin/find / -xdev -type f -perm /6000 -exec /bin/chmod a-s '{}' + \
    && capability_inventory=/tmp/northstar-file-capabilities \
    && /usr/sbin/getcap -r / 2>/dev/null > "$capability_inventory" \
    && while IFS= read -r capability_entry; do \
         test -z "$capability_entry" && continue; \
         capability_path=${capability_entry% *}; \
         test "$capability_path" != "$capability_entry" || exit 78; \
         /usr/sbin/setcap -r "$capability_path"; \
       done < "$capability_inventory" \
    && /bin/rm -f "$capability_inventory" \
    && /bin/chown 0:0 /usr/bin/chage /usr/bin/chfn /usr/bin/chsh \
         /usr/bin/expiry /usr/bin/gpasswd /usr/bin/mount /usr/bin/newgrp \
         /usr/bin/passwd /usr/bin/su /usr/bin/umount /usr/sbin/unix_chkpwd \
    && for helper in /usr/bin/chage /usr/bin/chfn /usr/bin/chsh \
         /usr/bin/expiry /usr/bin/gpasswd /usr/bin/mount /usr/bin/newgrp \
         /usr/bin/passwd /usr/bin/su /usr/bin/umount /usr/sbin/unix_chkpwd; do \
         test "$(/usr/bin/stat -c '%u:%g' -- "$helper" 2>/dev/null)" = '0:0' || \
           { /usr/bin/printf '%s\n' \
               'NorthStar production build rejected the deprivileged helper ownership. Check NS14B-BUILD-SETID-OWNER.' >&2; \
             exit 78; }; \
       done \
    && /bin/chmod 0555 /usr/bin/setpriv /usr/sbin/getcap /usr/sbin/capsh \
         /usr/sbin/getpcaps /usr/sbin/setcap /usr/bin/chage /usr/bin/chfn \
         /usr/bin/chsh /usr/bin/expiry /usr/bin/gpasswd /usr/bin/mount \
         /usr/bin/newgrp /usr/bin/passwd /usr/bin/su /usr/bin/umount \
         /usr/sbin/unix_chkpwd \
    && case "$TARGETARCH" in \
         amd64) setpriv_sha='d5839b20edb0d77222b1e11be7d155c7122d381dbfad40876b0def7dd710f5bd'; setpriv_size='80192'; \
                  getcap_sha='815e0a9db190b9f50e83a9443daa368c705bf466142521b12b4770bf7f69f579'; getcap_size='14576'; \
                  capsh_sha='16246b635b9a566874e1374bb2c686379cb1ff7e57497d9bb71869d77d3bc35c'; capsh_size='54568'; \
                  getpcaps_sha='e7d7113447a52f62eae75aebb44e6f14b4706ac840a668260090e5b818af629d'; getpcaps_size='14576'; \
                  setcap_sha='58b227dc41893b9b29e40e68a1c2af081e3a84630371980071056a80fed8fbe0'; setcap_size='14576'; \
                  chage_sha='f1aced4c56099e77221aa8a408a073a41d971520fd82108bd8e737cad6e7fcd1'; chage_size='80376'; \
                  chfn_sha='0d91ea5e4961f4b09526e7eba8f1aa7fea53b56290019c656dba29256c860bb4'; chfn_size='62672'; \
                  chsh_sha='e9ea120b0d271feb49f02ad923e8789f51128beb0f41be11f1a0e7e46484bdf0'; chsh_size='52880'; \
                  expiry_sha='76ca5abc17ecc1ec50f9716f91b7ec9044bce69431b4fc3f172489b56d41e308'; expiry_size='31184'; \
                  gpasswd_sha='f5ddf4ff327b07c2e1109645d35b0f75011d20877c9a0c2c1b0678dd1b8c3879'; gpasswd_size='88496'; \
                  mount_sha='18ca60a1e1c93f58fca00607ad32bf192fea00157eac73a5341f8bd1c2201403'; mount_size='59704'; \
                  newgrp_sha='ced400910c4fe7ab0676ae07ee6489d677baa18e1425750a21b9688ab2e02fb6'; newgrp_size='48896'; \
                  passwd_sha='d30cd42625b51cb54c49edc5b0b3348d6a438539446af3752a6af10393c4f2d2'; passwd_size='68248'; \
                  su_sha='4b8bb44ac13b8f8f8c08708faff91a9b63b3fa369b8cbfe1abb5ef09e8029993'; su_size='72000'; \
                  umount_sha='54bf7fbc1db029188f5d7e1397f4ad7b2cd1e2d7a57869002d390063cbbb3268'; umount_size='35128'; \
                  unix_chkpwd_sha='0ef065c7d555e7dc66789956ae2a67547a98a38fc5f846373975c85e95009345'; unix_chkpwd_size='39160' ;; \
         arm64) setpriv_sha='24410fedc29286402ae3b366bd3a78c3d177f7a1190797f1ea564f190097356c'; setpriv_size='133288'; \
                  getcap_sha='dfd4546e0dbf6213e920622249d10e4469a4e41cfbdc62fd0da2472acffdd836'; getcap_size='67672'; \
                  capsh_sha='ce65733af73e8357b3b61ed9495254147f70a9783af257d2dad5ab5445f44dc7'; capsh_size='70464'; \
                  getpcaps_sha='2979481886c0ebd48a0ffbe5dcd2d2d63cb6cc8d9e23174558e774cc0dc03246'; getpcaps_size='67672'; \
                  setcap_sha='17caa8b013d9c946534dd9973d69040066778e92ac5e756e06572cc6f6c492c7'; setcap_size='67672'; \
                  chage_sha='be8de5f4f97c24251b9265acfc814e8565f3045c69cab72f1dd8c31002fe64f0'; chage_size='137424'; \
                  chfn_sha='41732ba55e81bdd78c784fbe80ca85e76c7e076a4dbd1a23ef0a6607a9042540'; chfn_size='70616'; \
                  chsh_sha='ac7c3f9f29f423b9edb8b6bf449ec65fec4b2aa047011908d6e42e9f2f603d25'; chsh_size='69064'; \
                  expiry_sha='e8f60724dd66050667a72c415e116c13aec2dc9d320a3dc711959a63a99d8d49'; expiry_size='67880'; \
                  gpasswd_sha='91280540427c40502aad93ea821f848061f49eadb36994ce5c8e2de6fdb3a42b'; gpasswd_size='137352'; \
                  mount_sha='4e3aa9cd2b207144bc3206a95019fcdeeac9114cb58d9b19850b948b2003c2ef'; mount_size='67744'; \
                  newgrp_sha='0466e757f261cc50fa879f50c0663372e399fa6653a659053037faaa334da104'; newgrp_size='69176'; \
                  passwd_sha='bc0b502346f44eff9bf08cfd121b280684652a7e8eb4e78cba6404d32892ebf0'; passwd_size='72048'; \
                  su_sha='c673b670821b019213950a266be48d235cd2faf6692ea7f50c399dc4a59c0396'; su_size='133312'; \
                  umount_sha='60ac2e037660e390520585a8d6afd4ee09949eead31dbb18c21b07245d082816'; umount_size='67744'; \
                  unix_chkpwd_sha='18b7c15bf7267ad65341e19e682e136c3f60d2de88944dcd66ededfab7442ac1'; unix_chkpwd_size='67680' ;; \
         *) exit 78 ;; \
       esac \
    && printf '%s  %s\n' "$setpriv_sha" /usr/bin/setpriv | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$getcap_sha" /usr/sbin/getcap | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$capsh_sha" /usr/sbin/capsh | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$getpcaps_sha" /usr/sbin/getpcaps | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$setcap_sha" /usr/sbin/setcap | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$chage_sha" /usr/bin/chage | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$chfn_sha" /usr/bin/chfn | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$chsh_sha" /usr/bin/chsh | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$expiry_sha" /usr/bin/expiry | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$gpasswd_sha" /usr/bin/gpasswd | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$mount_sha" /usr/bin/mount | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$newgrp_sha" /usr/bin/newgrp | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$passwd_sha" /usr/bin/passwd | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$su_sha" /usr/bin/su | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$umount_sha" /usr/bin/umount | /usr/bin/sha256sum -c - \
    && printf '%s  %s\n' "$unix_chkpwd_sha" /usr/sbin/unix_chkpwd | /usr/bin/sha256sum -c - \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/setpriv)" = "$setpriv_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/sbin/getcap)" = "$getcap_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/sbin/capsh)" = "$capsh_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/sbin/getpcaps)" = "$getpcaps_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/sbin/setcap)" = "$setcap_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/chage)" = "$chage_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/chfn)" = "$chfn_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/chsh)" = "$chsh_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/expiry)" = "$expiry_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/gpasswd)" = "$gpasswd_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/mount)" = "$mount_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/newgrp)" = "$newgrp_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/passwd)" = "$passwd_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/su)" = "$su_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/bin/umount)" = "$umount_size" \
    && test "$(/usr/bin/stat -c '%s' /usr/sbin/unix_chkpwd)" = "$unix_chkpwd_size" \
    && /usr/bin/printf '%s\n' 'northstar-privilege-inventory-v4' \
         'setid=none' 'filecap=none' 'runtime_uid=1000' 'runtime_gid=1000' \
         'pinned_helper=/usr/sbin/capsh' 'pinned_helper=/usr/sbin/getpcaps' \
         'pinned_helper=/usr/sbin/setcap' \
         'deprivileged_helper=/usr/bin/chage' 'deprivileged_helper=/usr/bin/chfn' \
         'deprivileged_helper=/usr/bin/chsh' 'deprivileged_helper=/usr/bin/expiry' \
         'deprivileged_helper=/usr/bin/gpasswd' 'deprivileged_helper=/usr/bin/mount' \
         'deprivileged_helper=/usr/bin/newgrp' 'deprivileged_helper=/usr/bin/passwd' \
         'deprivileged_helper=/usr/bin/su' 'deprivileged_helper=/usr/bin/umount' \
         'deprivileged_helper=/usr/sbin/unix_chkpwd' \
         > /app/.northstar-runtime/privilege-inventory \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/setpriv)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/sbin/getcap)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/sbin/capsh)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/sbin/getpcaps)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/sbin/setcap)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/chage)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/chfn)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/chsh)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/expiry)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/gpasswd)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/mount)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/newgrp)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/passwd)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/su)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/bin/umount)" = '0:0:555' \
    && test "$(/usr/bin/stat -c '%u:%g:%a' /usr/sbin/unix_chkpwd)" = '0:0:555' \
    && /usr/bin/printf '%s\n' 'northstar-executable-inventory-v5' \
         'setpriv_path=/usr/bin/setpriv' "setpriv_sha256=$setpriv_sha" \
         "setpriv_size=$setpriv_size" 'setpriv_mode_policy=0555-or-0755' \
         'getcap_path=/usr/sbin/getcap' "getcap_sha256=$getcap_sha" \
         "getcap_size=$getcap_size" 'getcap_mode_policy=0555-or-0755' \
         'capsh_path=/usr/sbin/capsh' "capsh_sha256=$capsh_sha" \
         "capsh_size=$capsh_size" 'capsh_mode_policy=0555-or-0755' \
         'getpcaps_path=/usr/sbin/getpcaps' "getpcaps_sha256=$getpcaps_sha" \
         "getpcaps_size=$getpcaps_size" 'getpcaps_mode_policy=0555-or-0755' \
         'setcap_path=/usr/sbin/setcap' "setcap_sha256=$setcap_sha" \
         "setcap_size=$setcap_size" 'setcap_mode_policy=0555-or-0755' \
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
