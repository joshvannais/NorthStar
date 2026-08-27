# Protected broad-read alias inventory

The mounted production-router test exercises 70 exact paths. Each group below
uses the same authority/data PostgreSQL snapshot.

| Group | Paths | Count |
| --- | --- | ---: |
| Canonical status/list/aggregate | `/api/v1/canonical/status`, `/graphs`, `/dashboard`, `/analytics` | 4 |
| Canonical surfaces | `/api/v1/canonical/surfaces/{customer-detail,leads,communications,calendar,command-center,polaris,executive,estimates}` | 8 |
| Canonical compatibility surfaces | `/api/v1/canonical/compat/{customer-detail,leads,communications,calendar,command-center,polaris,executive,estimates}` | 8 |
| Canonical details | `/api/v1/canonical/graphs/:id`, `/snapshots/:id` | 2 |
| Compatibility core collections | `/api/customers`, `/communications`, `/opportunities/pipeline`, `/opportunities`, `/financial/estimates`, `/workflows/agenda/today`, `/leads`, `/calls`, `/appointments` | 9 |
| Compatibility analytics | `/api/analytics/{executive,kpis,dashboard,alerts,trends,pipeline,by-service}` | 7 |
| Dashboard/status/calendar/financial | `/api/dashboard/overview`, `/dashboard/{summary,revenue,brief,coach,kpis,trends,revenue-trends}`, `/dashboard/status`, `/calendar/events`, `/calendar/upcoming`, `/financial/metrics` | 12 |
| Polaris and stats collections | `/api/polaris/{intelligence,estimates,recommendations,learning,pipeline,retell-context,business-context,unified-context}`, `/api/stats`, `/api/leads/intelligence/dashboard` | 10 |
| Compatibility details | `/api/customers/:id`, `/communications/:id`, `/opportunities/:id`, `/financial/estimates/:id`, `/leads/:id/intelligence`, `/leads/:id` | 6 |
| Command Center | `/api/v1/command-center/workspace`, `/polaris/{customer,lead,work}/:id` | 4 |
| **Total** | | **70** |

List, aggregate, count, Calendar/Command Center, existing detail, not-found
detail, and injected-error responses are covered. Target discovery already owns
its correction-5 snapshot and remains covered by the mounted Part 5 suite.
