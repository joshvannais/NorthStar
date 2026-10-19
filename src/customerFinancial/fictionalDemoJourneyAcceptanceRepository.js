'use strict';

// Part 14B projection used to accept a caller-supplied detached demo record.
// The supported operation now lives on DemoCommandCenterRepository and owns
// the exact database authority, projection, serialization, and response
// lifetime. This compatibility module deliberately exports no capability.
module.exports = Object.freeze(Object.create(null));
