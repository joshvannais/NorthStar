# Disposable-resource cleanup

The exact task PostgreSQL 18.4 cluster at
`tmp/m22-part5-correction6-pg` provided mounted, corpus, and startup evidence.
The role-separated startup script removed its database, migration/runtime roles,
server processes, and temporary data directory; verification returned zero
matching databases, roles, and sessions.

After evidence freeze, the exact task cluster is stopped and its validated data
directory and sibling log are removed. The `work/m22-part5-writer/node_modules`
junction is removed only after verifying it targets the established Part 4
dependency directory; the dependency target remains intact.

No unrelated process, accepted source, dependency target, provider, production,
or user data is removed.

Terminal verification is recorded before commit: task PostgreSQL directory and
log absent; writer dependency junction absent; dependency target present;
matching test/browser/server/PostgreSQL process count zero.
