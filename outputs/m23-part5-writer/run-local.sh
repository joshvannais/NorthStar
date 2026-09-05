#!/usr/bin/env bash
set -euo pipefail
export PATH=/home/joshv/.local/node-v24.18.1-linux-x64/bin:/usr/bin:/bin
unset LD_LIBRARY_PATH
export NODE_ENV=test
unset DATABASE_URL MIGRATION_DATABASE_URL OPENAI_API_KEY POLARIS_OPENAI_ENABLED
task_pg_bin=/home/joshv/.cache/northstar-p5-runtime/postgresql-18.4/bin
task_pg_root=/home/joshv/.local/tmp/m23-part5-pg-eccc8e9-vanilla
mkdir -p "$task_pg_root"
if ! test -f "$task_pg_root/data/PG_VERSION"; then
 "$task_pg_bin/initdb" -D "$task_pg_root/data" --encoding=UTF8 --locale=C --data-checksums --auth=trust
fi
if ! "$task_pg_bin/pg_ctl" -D "$task_pg_root/data" status >/dev/null 2>&1; then
 "$task_pg_bin/pg_ctl" -D "$task_pg_root/data" -l "$task_pg_root/server.log" -o "-h 127.0.0.1 -p 55468 -c timezone=UTC -c unix_socket_directories=$task_pg_root" -w start
fi
export M19_PG_ADMIN_URL=postgresql://joshv@127.0.0.1:55468/postgres
export M19_EXPECTED_PG_DATA_DIR="$task_pg_root/data"
export M19_EXPECTED_PG_PORT=55468
export M19_TEST_RUN_ID=m23p5-eccc8e9
cd /home/joshv/northstar-m23-part5-writer-eccc8e9-20260905
if test "${1:-}" = --available; then
 node outputs/m23-part5-writer/run-available.js
else
 node node_modules/jest/bin/jest.js --runInBand "$@"
fi
