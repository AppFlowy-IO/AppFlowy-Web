import { defineConfig } from 'cypress';
import codeCoverageTask from '@cypress/code-coverage/task.js';
import { execSync } from 'child_process';

export default defineConfig({
  env: {
    codeCoverage: {
      exclude: ['cypress/**/*.*', '**/__tests__/**/*.*', '**/*.test.*'],
    },
  },
  watchForFileChanges: false,
  component: {
    // src/components/editor/__tests__/blocks/Paragraph.cy.tsx
    specPattern: 'src/**/__tests__/**/*.cy.tsx',
    devServer: {
      framework: 'react',
      bundler: 'vite',
    },
    supportFile: 'cypress/support/component.ts',
  },
  chromeWebSecurity: false,
  retries: {
    // Configure retry attempts for `cypress run`
    // Default is 0
    runMode: 10,
    // Configure retry attempts for `cypress open`
    // Default is 0
    openMode: 0,
  },
});
