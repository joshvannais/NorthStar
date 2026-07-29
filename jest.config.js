/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  verbose: true,
  testTimeout: 15000,
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/isolated-data-root.js'],
  collectCoverageFrom: [
    'src/services/**/*.js',
    'src/context/**/*.js',
    'src/routes/**/*.js',
  ],
  coveragePathIgnorePatterns: ['/node_modules/'],
  moduleDirectories: ['node_modules', '<rootDir>'],
};
