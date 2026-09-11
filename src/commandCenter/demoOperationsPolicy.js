'use strict';
// Read-preserving recovery switch. A compatible build can pause only new work
// actions without erasing recorded demo operations or reverting their reader.
module.exports = Object.freeze({ mutationsEnabled: true });
