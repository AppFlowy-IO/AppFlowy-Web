import tsconfig from './tsconfig.jest.json' with { type: 'json' };
import { pathsToModuleNameMapper } from 'ts-jest';

const esModules = ['lodash-es', 'nanoid'].join('|');

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  testEnvironment: 'node',
  preset: 'ts-jest',
  // preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  modulePaths: [tsconfig.compilerOptions.baseUrl],
  moduleNameMapper: {
    ...pathsToModuleNameMapper(tsconfig.compilerOptions.paths),
    '^lodash-es(/(.*)|$)': 'lodash$1',
    '^nanoid(/(.*)|$)': 'nanoid$1',
    '^dayjs$': '<rootDir>/node_modules/dayjs/dayjs.min.js',
  },
  transform: {
    '^.+\\.(j|t)sx?$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
      useESM: true,
      isolatedModules: true
    }],
    '(.*)/node_modules/nanoid/.+\\.(j|t)sx?$': ['ts-jest', {
      useESM: true,
      tsconfig: 'tsconfig.jest.json'
    }],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transformIgnorePatterns: [`/node_modules/(?!${esModules})`],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  coverageDirectory: '<rootDir>/coverage/jest',
  collectCoverage: true,
  coverageProvider: 'v8',
  coveragePathIgnorePatterns: [
    '/cypress/',
    '/coverage/',
    '/node_modules/',
    '/__tests__/',
    '/__mocks__/',
    '/__fixtures__/',
    '/__helpers__/',
    '/__utils__/',
    '/__constants__/',
    '/__types__/',
    '/__mocks__/',
    '/__stubs__/',
    '/__fixtures__/',
    '/application/folder-yjs/',
  ],
};