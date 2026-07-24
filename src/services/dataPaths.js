'use strict';

const path = require('path');

function getDataDir() {
  if (process.env.NORTHSTAR_DATA_DIR) {
    return path.resolve(process.env.NORTHSTAR_DATA_DIR);
  }
  return path.resolve(__dirname, '../../data');
}

function dataPath(fileName) {
  return path.join(getDataDir(), fileName);
}

module.exports = {
  getDataDir,
  dataPath,
};
