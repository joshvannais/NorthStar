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
COPY --chown=0:0 . /app
COPY --from=dependencies --chown=0:0 /app/node_modules /app/node_modules
RUN NORTHSTAR_TARGETARCH="$TARGETARCH" /bin/sh /app/scripts/prepare-production-node.sh

USER root
CMD ["/bin/sh", "/app/scripts/start-production.sh"]
