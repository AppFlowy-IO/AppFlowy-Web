const base = require('./jest.config.cjs');

/** Focused feature gate; the broader collaboration suite still runs separately. */
module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/src/application/sync-outbox/__tests__/*.test.ts',
    '<rootDir>/src/application/sync-status/__tests__/*.test.ts',
    '<rootDir>/src/components/app/header/__tests__/SyncIndicator.test.tsx',
  ],
  coverageProvider: 'babel',
  coverageDirectory: '<rootDir>/coverage/sync-indicator',
  collectCoverageFrom: [
    'src/application/sync-outbox/receipts.ts',
    'src/application/sync-status/{bind,store}.ts',
    'src/components/app/header/SyncIndicator.tsx',
  ],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
