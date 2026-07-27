'use strict';

const path = require('path');

function getDataRoot() {
  return process.env.NORTHSTAR_DATA_DIR
    ? path.resolve(process.env.NORTHSTAR_DATA_DIR)
    : path.resolve(__dirname, '../../data');
}

function dataPath(...segments) {
  return path.join(getDataRoot(), ...segments);
}

module.exports = { dataPath, getDataRoot };
