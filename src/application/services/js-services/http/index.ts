// Re-export everything from domain files
export * from './core';
export * from './gotrue';
export * from './auth-api';
export * from './user-api';
export * from './workspace-api';
export * from './view-api';
export * from './page-api';
export * from './collab-api';
export * from './publish-api';
export * from './template-api';
export * from './billing-api';
export * from './import-api';
export * from './file-api';
export * from './access-api';
export * from './misc-api';

// Note: http_api.ts is kept as a re-export file for integration test setup
// (http/__tests__/setup.ts imports `* as APIService from '../http_api'`)
