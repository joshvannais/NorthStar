'use strict';

if (require.main !== module) throw new Error('The development child is not importable.');
process.env.NODE_ENV = 'development';
process.env.NORTHSTAR_DEVELOPMENT_CHILD = 'explicit-local-v1';
require('./server').start().catch(error => {
  console.error('[Server] Failed to start:', error);
  process.exitCode = 1;
});
