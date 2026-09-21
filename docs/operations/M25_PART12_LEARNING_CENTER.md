# Mission 25 Part 12 Learning Center

Part 12K brings the accepted CRM and field-service, project and change-order, customer-communication, and external-financial evidence into the owner and administrator Learning Center. It extends the same private, review-first experience already used for labor, travel, assets, and materials.

## What an owner can review

- The named company source, import permission, bounded import progress, current record count, and last source update.
- Explicit links between imported references and recognizable company customers, work, estimates, or field visits. NorthStar never performs fuzzy matching here.
- Separate purpose permissions for customer, project, or financial outcome comparisons and for service-level summaries.
- Customer lead, appointment, issued-estimate, and response states; project contract movement, change orders, duration, and delivery state; and external recorded revenue, collections, realized cost, and margin. Each measure stays independent. Missing or incompatible evidence remains unavailable.
- Continuous-update settings, retention, legal or audit holds, deletion, and bounded cleanup. A hold blocks cleanup. Deletion requires a separate consequence checkbox before each batch.

The page never asks for a connection secret. Connections are managed outside the page. It does not create or edit a customer, lead, appointment, job, estimate, project, change order, invoice, payment, accounting record, price, schedule, inventory record, or company policy.

## Recovery and safety

The page converts structured server failures into plain recovery messages. A changed record asks the owner to refresh. An ended session asks the owner to sign in. A permission failure explains that the company record is restricted. Internal codes, request identifiers, opaque database identities, and source digests are not rendered.

Source deletion immediately hides dependent learning. Canceling deletion and starting a new permission period does not revive earlier imported records, links, outcomes, or suggestions. The Learning Center displays only current guarded projections.

## Responsive and accessibility evidence

Automated Chrome and Playwright WebKit review covers paid and isolated-demo states at 360×800, 390×844, 768×1024, 1024×768, and 1440×900 in light and dark themes. The checks cover keyboard entry, semantic headings and labels, live status, disabled demo controls, destructive confirmation, reload-at-top behavior, structured-error recovery, identifier leakage, and horizontal overflow.

Physical Safari, physical phones and tablets, manual screen-reader testing, and the founder's final visual verdict remain separate unavailable evidence.
