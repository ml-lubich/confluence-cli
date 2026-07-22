module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'lib/**/*.js',
    'bin/**/*.js',
    '!node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Enforce a real coverage bar on the new bulk engine + error formatter. The
  // legacy surface is intentionally not gated (yet) to avoid a misleading global
  // number; these modules are the ones this fork adds and owns.
  coverageThreshold: {
    './lib/bulk/': {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './lib/errors.js': {
      branches: 80,
      functions: 100,
      lines: 90,
      statements: 90
    }
  },
  testMatch: [
    '**/tests/**/*.test.js'
  ]
};
