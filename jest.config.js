module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/services/**/*.js',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 85,
      lines: 80,
      statements: 80,
    },
    'src/services/': {
      branches: 70,
      functions: 90,
      lines: 80,
      statements: 80,
    },
  },
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,
  verbose: true,
};
