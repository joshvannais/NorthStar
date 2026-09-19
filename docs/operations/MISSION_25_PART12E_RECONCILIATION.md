# Mission 25 Part 12E reviewed reconciliation operations

## Owner and administrator workflow

1. Read the reviewed choices for one current Part 12 source class and source.
2. Select one exact imported reference and one allowed same-company NorthStar record.
3. Confirm the current source and target digests shown by the read response.
4. Save the link with a new request key, or append an unlink revision.
5. Refresh when the source evidence, target record or permission period changed.

The source classes are `crm_field_service`, `project_change_order`, `communication` and `financial`. Customer references use customer targets. Execution references use current-work targets. Job, estimate, project, change-order and external financial references use estimate targets. A financial link identifies the owning estimate only; native billing and accounting records remain unavailable until Mission 27.

## Failure and recovery

- Inactive permission hides references and blocks changes.
- A correction, tombstone or target change marks an existing link stale.
- A stale link is never silently replaced; refresh and review it again.
- Revocation followed by a later grant starts an empty source period. Old evidence and links do not return.
- Unsafe or duplicate display labels remove that choice until the company record is clearer.
- Repeating the same request key with the same payload returns the original result. Reusing it with different details fails.

No operation in this slice changes an imported record or a NorthStar customer, estimate, execution, schedule, price, project, change order or financial record.
