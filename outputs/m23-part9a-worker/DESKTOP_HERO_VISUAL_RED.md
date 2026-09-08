# Part 9A desktop hostile-heading visual red

Frozen tests-first parent: `c9cab92530e810b1c3181c919ded1be6f0dec2c6`.

Command: `node tests/browser/m23-part9a-worker-operational-experience.js --browser=chrome`

The mounted 1440 CSS-pixel page failed the new geometry control with the exact measured result:

`{"viewport":1440,"document":1440,"main":1200,"badge":{"width":50.375,"height":95.96875},"overviewBelowHeading":false,"focusable":true}`

The inert hostile title stayed non-executable and caused no horizontal overflow, but the flex row compressed `Not started` into a narrow vertical badge and positioned the overview grid beside the heading. This is not desktop-complete presentation. Failure evidence JSON SHA-256: `7e60447169a9a236e6a284eb4bc92ba8e43e6ae9d46c92daa00f762be7541539`.

No CSS or other production implementation was changed before this red run. No external or provider call was made.
