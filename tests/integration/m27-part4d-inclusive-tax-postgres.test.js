'use strict';

// Run the exact mounted Part 3C/4A-4D source journey in an independent Jest
// module/database with a Mission 24 inclusive-tax commercial source.  The
// source suite keeps its complete exclusive campaign as the default and skips
// only later unrelated/stale-mutating cases in this focused inclusive replay.
process.env.M27_P4D_TAX_BEHAVIOR = 'inclusive';
require('./m27-part3c-billable-work-review-postgres.test');
delete process.env.M27_P4D_TAX_BEHAVIOR;
