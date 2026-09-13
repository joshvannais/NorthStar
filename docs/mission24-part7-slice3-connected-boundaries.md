# Mission24 Part7 Slice3: Local Connected Integration Boundaries

This is local implementation evidence, not live provider or tax-coverage acceptance. Exactly three Part7 slices remain the approved plan. Both Evidence-Bound Generative And Connected-Call Integration and Onboarding Tax Preparation Integration Completion remain OPEN.

## Runtime And Source Authority

The v2 conversation route uses the current permitted selected record, complete selected estimate review and published knowledge in one protected read. It releases that transaction before model generation, then rereads current authority and source basis before display and cache replay. Model text cannot authorize money, booking, safety, availability, tax validation or direct plan writes. Recorded numeric facts are server-owned. The bounded worker-hours proposal requires an explicit user instruction identifying the existing line and worker-hours unit; it opens an unchecked normal editor with recalculation, deliberate save, adoption and renewed price review still required.

Public demo generation is separately admitted by opaque timestamp-bearing demo token, server-derived source identity and durable daily cap. A token is not signed authority. Limits are four requests per token lifetime, four per source/hour and one hundred globally/day; twenty million nano-USD is conservatively reserved per request. Rotating public tokens does not reset source/global counters. No live generation flag is enabled by this code. Future deployment must assess proxy/source-identity configuration; this code does not claim one source identity equals one human.

Call guidance requires raw provider authentication plus current integration ownership, exact agent/call/session association, active subscription, current pinned business profile and permitted published caller knowledge. It remains provisional on the existing voice session, with no parallel estimate/job graph. A two-hour session bound, maximum thirty-two immutable guidance events and twenty-five-second request deadline apply; exact current replay can remain available at the event limit. Ordinary terminal ingestion creates the single canonical graph. Missing knowledge remains explicit. The call generation binding is not provisioned: any future live binding must use reviewed provider admission/metering and cancellation, with a finite cost and concurrency budget before activation. Event retention is not a claim of independently sufficient provider spend protection.

## Existing Knowledge Outbox Exception

The existing `executeClaimWithAuthority` target/publication lock path is retained unchanged across knowledge transport/finalization, explicitly excepted from the model/tax no-network-in-transaction rule. Its SQL statement timeout remains ten seconds. The new transport uses one ten-second abort deadline for all initial GET/update/readback steps, inherits the worker abort signal, disables SDK automatic retries, and checks cancellation after waits. Exact lock cleanup and abort-aware behavior are fixture-tested; an already-sent provider update can still complete after a timeout. A Promise timeout is not proof of remote cancellation.

The local fallback binds one dedicated tenant/target Retell LLM ID and version plus reviewed immutable base-prompt hash. Only the fixed managed JSON block changes. Exact native GET verifies the expected prompt and all unrelated settings. Delimiter injection, ambiguous prior blocks, changed base/version, changed ownership and stale sequence fail closed. Later attempts only reconcile exact readback; an uncertain update is not blindly resubmitted. Existing published tombstones replace the managed projection through the same leased outbox.

Retell GET is not compare-and-swap. Before any activation, establish exclusive target ownership and exclude all other prompt writers. Draft-version readback does not prove a live agent uses that version. No model/tool/KB/agent registration, prompt update or source upload occurred in local verification.

Primary protocol references inspected during implementation:

- https://developers.openai.com/api/docs/guides/structured-outputs — Responses structured output is parsed and then checked against server-owned evidence; schema compliance is not factual verification.
- https://docs.retellai.com/build/single-multi-prompt/custom-function — default custom function payload carries name, call and args; caller fields are not tenant authority.
- https://docs.retellai.com/features/secure-webhook — exact raw-body signature verification is separate from current call ownership.
- https://docs.retellai.com/api-references/get-retell-llm and https://docs.retellai.com/api-references/update-retell-llm — bounded prompt text GET/update fallback; no documented CAS guarantee established.
- https://raw.githubusercontent.com/RetellAI/retell-typescript-sdk/main/src/resources/llm.ts — retrieve(id, query, options) and update(id, body, options), including version and shared abort options.
- https://github.com/RetellAI/retell-typescript-sdk — per-request maxRetries:0 avoids automatic mutation retries.

These are documentation/source observations, not an executed live SDK canary. Provider behavior/version must be freshly reconciled before activation.

## Tax Research And Controlled Publication

The server starts bounded no-network preparation/backfill with no acquisition transport configured. Research uses only public context (country, region, locality, jurisdiction, service key and classification), never private registration/exemption documents, customer addresses or arbitrary browser URLs. Reviewed source transport uses HTTPS allowlisted origins, pinned public DNS, bounded redirects/body/deadline and no credentials. Candidate evidence preserves URL, raw excerpt hash, fetched day, effective/end dates, coverage and exclusions. Unknown dates remain unknown. It never supplies or validates a tax rate.

Immutable research retention is at most one thousand jobs per organization and three candidates per job; no immutable candidate deletion is introduced. Internal NULL discovery skips already-enqueued/full organizations and reaches later batches. Public browsers cannot invoke NULL discovery. Older expired demo usage rows/windows can be retired through the tightly bounded routine (two hundred per relation); the worker attempts that internal cleanup no more than once per minute while enabled. Active request replay/caps and financial histories remain intact.

`taxCoveragePublication` is an offline-only artifact builder/dry-run verifier, never imported by the server. It requires an independent review manifest with exact candidate raw-text, source excerpt and reviewed-rule hashes, strict matching public context/dates, and expected current registry revision/digest. Synthetic fixture artifacts are explicitly marked. It performs zero registry writes and cannot authenticate a human review or turn research into legal validation. Publication requires a separate authorized migration-owner transaction with fresh exact registry guards and an independently reviewed real coverage pack; runtime has no validation write grant. Unknown or expired sources cannot be inferred valid. New source/rule versions preserve prior immutable records and trigger current preparation through existing rule/input/day digests.

## Operational Acceptance Still Required

Before live canary: enumerate exact entitled provider identity/version and synthetic call/session, approved source projection, existing integration owner, disclosure/consent/legal requirements, limits on requests/tokens/cost/concurrency, abort/unknown-result reconciliation, allowed side effects and exact cleanup. Confirm current keys through the designated credential workflow without logging secrets. Prove actual model response plus Retell tool/capture/knowledge/one-graph continuity and revocation, rather than authored transcript or injected transport equivalence.

Before tax checkpoint closure: obtain the intended actual jurisdiction/service/date/registration context (not inferred from founder address), authoritative source access/license basis, independently reviewed deterministic coverage and source refresh/revocation evidence. No real coverage pack is presently established by these tests. Owner-recorded treatment and simulated rules do not close this checkpoint.

No Part8 quote/send authority, Mission25 learning, new workforce credential authority, provider activation or production release is implied. Final local candidate still requires independent audit and a separate migration074 release-risk disposition.
