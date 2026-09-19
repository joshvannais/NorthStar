# Mission 25 Part 13B graph evidence evaluation

Part 13B answers four bounded questions about one exact current Part 13A graph: whether its lineage is still current, which explicitly required outcome domains have evidence, which required domains are missing and where current sources overlap.

An owner or administrator names one to seven required domains for the review. The normalized set can contain labor, travel, equipment, materials, customer, scope and financial evidence. NorthStar does not infer that every job requires every domain. A covered domain has at least one current graph node. A required domain with no node is missing. Evidence overlaps when more than one node covers the same claim slot, including native and imported alternatives for labor work, equipment use or material quantity. Material cost is a separate slot from material quantity.

An overlap is not proof that values disagree. The evaluation keeps every source and asks for review; it never selects a preferred source, combines values, converts units or currencies, or claims job performance. Complete per-job summaries begin in Slice C.

The immutable evaluation pins the exact current graph, its graph and source digests, its permission period, normalized required domains, calculation version and deterministic request identity. A newer graph, source correction, tombstone, reviewed-link change, target change or permission change makes the saved evaluation stale and hides its detail. Revocation blocks reads and replay. A later grant does not revive any earlier graph or evaluation.

Runtime can only call guarded read and build entry functions. It cannot read evaluation storage or execute validation, scoring, projection or trigger helpers. Evaluation changes no customer, lead, appointment, job, estimate, price, schedule, dispatch decision, labor record, asset, material, project, financial record or company policy.

This slice adds no rendered page. The API messages use plain business language. The paid and isolated-demo experience, responsive and accessibility review, physical-device evidence, manual assistive-technology review and founder visual verdict remain Slice H or separately unavailable evidence. Native NorthStar invoice, payment, collection and accounting truth remains unavailable until Mission 27.
