const { compilerOptions } = require('./tsconfig.json');
const { pathsToModuleNameMapper } = require('ts-jest');
const esModules = ['lodash-es', 'nanoid', 'unified', 'rehype-parse', 'remark-parse', 'remark-gfm', 'hast-.*', 'mdast-.*', 'unist-.*', 'vfile', 'bail', 'is-plain-obj', 'trough', 'micromark', 'decode-named-character-reference', 'character-entities', 'mdast-util-.*', 'micromark-.*', 'ccount', 'escape-string-regexp', 'markdown-table', 'devlop', 'zwitch', 'longest-streak', 'trim-lines'].join('|');

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>'],
  modulePaths: [compilerOptions.baseUrl],
  moduleNameMapper: {
    '^.+\\.svg$': '<rootDir>/src/__mocks__/svgrMock.tsx',
    '^@/utils/runtime-config$': '<rootDir>/src/__mocks__/runtime-config.ts',
    ...pathsToModuleNameMapper(compilerOptions.paths),
    '^lodash-es(/(.*)|$)': 'lodash$1',
    '^nanoid(/(.*)|$)': 'nanoid$1',
    '^dayjs$': '<rootDir>/node_modules/dayjs/dayjs.min.js',
  },
  'transform': {
    '^.+\\.(j|t)sx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
    '(.*)/node_modules/nanoid/.+\\.(j|t)sx?$': 'ts-jest',
  },
  'transformIgnorePatterns': [
    `node_modules/(?!.pnpm|${esModules})`,
  ],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
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
