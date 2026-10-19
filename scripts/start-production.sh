#!/bin/sh
set -eu

# This shell boundary runs before Node can honor NODE_OPTIONS. Production
# starts fail closed instead of inheriting a preload, import hook, custom
# loader, inspector, or other process-wide JavaScript injection.
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

unset NODE_OPTIONS NODE_PATH NPM_CONFIG_NODE_OPTIONS npm_config_node_options
exec node scripts/production-launcher.js
