import type { StorybookConfig } from '@storybook/react-vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-docs',
    '@storybook/addon-onboarding',
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) => {
        if (prop.parent) {
          return !prop.parent.fileName.includes('node_modules');
        }
        return true;
      },
      shouldRemoveUndefinedFromOptional: true,
    },
  },
  async viteFinal(config, { configType }) {
    // Static Storybook builds do not emit these intermediate maps. Skip them
    // to keep chunk rendering within Node's default heap.
    if (configType === 'PRODUCTION' && config.esbuild && typeof config.esbuild === 'object') {
      config.esbuild.sourcemap = false;
    }

    if (config.resolve) {
      const existingAlias = Array.isArray(config.resolve.alias)
        ? config.resolve.alias
        : config.resolve.alias
          ? Object.entries(config.resolve.alias).map(([find, replacement]) => ({
            find,
            replacement: replacement as string,
          }))
          : [];

      config.resolve.alias = [
        ...existingAlias,
        { find: 'src/', replacement: path.resolve(__dirname, '../src/') },
        { find: '@/', replacement: path.resolve(__dirname, '../src/') },
      ];
    }

    // Ensure CSS processing is enabled
    // PostCSS config is automatically picked up from postcss.config.cjs
    // Vite/Storybook will automatically process CSS/SCSS files
    if (!config.css) {
      config.css = {};
    }

    config.css.modules = config.css.modules || {};

    // Ensure Material-UI is properly optimized for Storybook
    if (!config.optimizeDeps) {
      config.optimizeDeps = {};
    }

    config.optimizeDeps.include = [
      ...(config.optimizeDeps.include || []),
      '@mui/material/styles',
      '@mui/material/styles/createTheme',
      '@emotion/react',
      '@emotion/styled',
    ];

    // Ensure proper module resolution for MUI v6
    if (!config.resolve) {
      config.resolve = {};
    }
    if (!config.resolve.dedupe) {
      config.resolve.dedupe = [];
    }
    if (!config.resolve.dedupe.includes('@mui/material')) {
      config.resolve.dedupe.push('@mui/material');
    }

    return config;
  },
};
export default config;