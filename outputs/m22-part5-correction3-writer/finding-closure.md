# M22-P5-011 closure

## Validated cause

The shared `.m22-overview-list` grid used the max-content minimum contributed by
an unbroken durable tenant title. The list, record, title/state regions, action
row, and flex action items had no explicit shrink/wrap boundary. Calendar's
horizontally scrollable main container therefore admitted a roughly 485 px
record inside a 366 px board and placed Dispatch beyond the 390 px viewport.

## Narrow correction

- The authority board and overview list have `min-width:0`, `max-width:100%`,
  and border-box/grid `minmax(0,1fr)` containment.
- Records, titles, paragraphs, state lists/chips, action rows, and action buttons
  can shrink and wrap unbroken bytes using `overflow-wrap:anywhere` with a
  compatible word-break fallback.
- No `overflow:hidden`, ellipsis, fixed clipping, content removal, or control
  hiding was added.
- Runtime JavaScript, server state, mutation routing, preview/approval authority,
  and data semantics are byte-for-byte unchanged by this correction.

## Mounted closure

The existing production browser matrix now measures Calendar directly at 390 px
and again after setting the root font to 400 percent. It asserts bounded
document/main/board/records/titles/state lists/action rows; bounded, visible,
enabled, pointer-operable action buttons; an explicit Dispatch control; and a
multi-line, untruncated hostile durable title.

Chrome and WebKit both report main `390/390`, board `364/364`, records `322/322`,
titles/action rows `294/294`, and Dispatch within x `161.8–249.1` at normal and
400 percent. The prior 518 px main and 505–506 px board scroll widths are gone.
