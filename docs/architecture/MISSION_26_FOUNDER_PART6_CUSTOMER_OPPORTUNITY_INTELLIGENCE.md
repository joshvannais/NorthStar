# Mission 26 Founder Part 6 — Customer and Opportunity Intelligence

Founder Part 6 has two approved slices: customer intelligence and opportunity intelligence. They are delivered together as one bounded present-state package because both answers come from the same current tenant-private customer, opportunity, human qualification-review and estimate-request-review records.

## Customer intelligence slice

Migration 238 counts current canonical customers from completed NorthStar ingestion operations and identifies a returning customer only when the same canonical customer has more than one current canonical opportunity. The output is aggregate only. It returns no customer identity, contact information, note, source identifier or digest. The result describes the NorthStar-recorded subset and does not claim provider, off-platform or whole-business completeness.

## Opportunity intelligence slice

Migration 238 uses the latest immutable human qualification review and latest immutable estimate-request review for each current canonical opportunity. It reports aggregate reviewed, unreviewed, open, qualified, requested and closed state counts. A qualified opportunity needs estimate review only when its current human qualification is `qualified` and its current estimate-request state is `open`. Missing review evidence stays visible as unreviewed; it is never inferred from a legacy score or converted into a probability.

The projection acquires the existing lead-state and estimate-request-state writer fences and computes every customer, opportunity and review aggregate in one SQL statement, so its read-committed statement snapshot stays coherent even if canonical ingestion commits concurrently. It reauthorizes paid owner/admin access after the fences and before return, caps each source population at 500 and fails closed above the cap. Public execute is revoked and only the runtime role receives execute authority.

## Product boundary

The existing Command Center receives one compact **Customer & opportunity insight** directly beside its existing customer and lead work. It gives one plain current answer, quiet scope and last-checked context, one `/dashboard/leads` action, one short boundary and one collapsed **Review details** section. Missing estimate-request review evidence is visible and prioritized for human review. The isolated demo uses a clearly fictional aggregate fixture, keeps its action inside `/demo/leads` and makes no paid API request. The rendered boundary explicitly says provider, off-platform and whole-business coverage is incomplete.

This package does not add another dashboard. It does not predict who will book, calculate conversion probability or customer lifetime value, contact a customer, change a price, create an estimate, schedule work or mutate a lead state. `probabilityCalibrated`, `forecastIssued` and `automaticActionAuthorized` remain false.

CI, private production-tenant behavior, live-provider and off-platform completeness, natural production history, physical Safari/devices and complete accessibility remain unavailable until separately evidenced.
