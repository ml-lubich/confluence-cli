module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'lib/bulk/**/*.js',
    'lib/errors.js',
    'bin/commands/bulk.js',
    'bin/commands/mirror.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Enforce a real coverage bar on the new bulk engine + error formatter. The
  // legacy surface is intentionally not gated (yet) to avoid a misleading global
  // number; these modules are the ones this fork adds and owns.
  coverageThreshold: {
    './lib/bulk/': {
      branches: 85,
      functions: 100,
      lines: 95,
      statements: 95
    },
    './lib/errors.js': {
      branches: 80,
      functions: 100,
      lines: 90,
      statements: 90
    },
    './bin/commands/bulk.js': {
      branches: 65,
      functions: 100,
      lines: 90,
      statements: 90
    },
    './bin/commands/mirror.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  testMatch: [
    '**/tests/**/*.test.js'
  ]
};
