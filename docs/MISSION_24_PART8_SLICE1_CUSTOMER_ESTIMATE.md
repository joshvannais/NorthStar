# Mission 24 Part 8 Slice 1 — customer estimate preview and exports

This slice adds one customer-safe estimate projection to the existing paid and isolated-demo estimate review. A current owner or administrator can open a restrained contractor-branded preview and download a matching PDF or PNG. The three formats use the exact same fetched projection and amount formatter. Nothing is sent, issued, accepted, invoiced, charged, scheduled or assigned.

The preview is available only after the existing full commercial approval is current. A changed Business Profile, estimate, decision, pricing source, commercial plan or tax basis removes the customer summary and therefore removes the preview action. Unknown tax, incomplete totals, malformed amounts and missing approved scope fail closed.

The projection exposes only the contractor's selected public identity/contact fields, customer display name/address, approved scope, customer charges, included adjustment labels/amounts, reviewed tax, totals and payment schedule. It strips database identifiers, source pins, evidence, internal costs, margin, profit, Capella/Polaris analysis, tax registration data, private customer contact details, actor/session data and approval reasons. Remote logos are not fetched; a clean text-brand fallback is used.

The customer document uses NorthStar's established type stack, a quiet off-white surface, restrained gold rules, aligned dollar amounts and a small authentic platform signature. The host theme affects only the preview dialog chrome; the customer document remains print-safe. Mobile uses a full-height dialog with independent document scrolling and reachable download controls.

The PDF contains selectable text and paginates bounded long content. The PNG is rendered at high resolution and grows to fit the complete bounded projection rather than clipping it. Static exports contain no acceptance or question controls and no private action token.

This remains a preview, not an immutable issued estimate. Slice 2 owns persisted issued versions, revision/reapproval and historical document identity. Slice 3 owns expiring/revocable public links, genuine customer acceptance, customer-question handoff, delivery state and recovery. No action control is shown before its route exists.
