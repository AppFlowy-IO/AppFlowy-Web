import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { visualizer } from 'rollup-plugin-visualizer';
import { totalBundleSize } from 'vite-plugin-total-bundle-size';
import path from 'path';
import istanbul from 'vite-plugin-istanbul';
import { createHtmlPlugin } from 'vite-plugin-html';
import { viteExternalsPlugin } from 'vite-plugin-externals';

const resourcesPath = path.resolve(__dirname, '../resources');
const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.env.COVERAGE === 'true';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    createHtmlPlugin({
      inject: {
        data: {
          injectCdn: isProd,
          cdnLinks: isProd ? `
              <link rel="dns-prefetch" href="//cdn.jsdelivr.net">
              <link rel="preconnect" href="//cdn.jsdelivr.net">
              
              <script crossorigin src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js"></script>
              <script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
            ` : '',
        },
      },
    }),
    isProd ? viteExternalsPlugin({
      react: 'React',
      'react-dom': 'ReactDOM',
    }) : undefined,
    svgr({
      svgrOptions: {
        prettier: false,
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        icon: true,
        svgoConfig: {
          multipass: true,
          plugins: [
            {
              name: 'preset-default',
              params: {
                overrides: {
                  removeViewBox: false,
                },
              },
            },
            {
              name: 'prefixIds',
              params: {
                prefix: (node, { path }) => {
                  const fileName = path?.split('/')?.pop()?.split('.')?.[0];
                  return `${fileName}-`;
                },
              },
            },
          ],
        },
        svgProps: {
          role: 'img',
        },
        replaceAttrValues: {
          '#333': 'currentColor',
          'black': 'currentColor',
        },
      },
    }),
    // Enable istanbul for code coverage (active if isTest is true)
    isTest ? istanbul({
      cypress: true,
      requireEnv: false,
      include: ['src/**/*'],
      exclude: [
        '**/__tests__/**/*',
        'cypress/**/*',
        'node_modules/**/*',
      ],
    }) : undefined,
    process.env.ANALYZE_MODE
      ? visualizer({
        emitFile: true,
      })
      : undefined,
    process.env.ANALYZE_MODE
      ? totalBundleSize({
        fileNameRegex: /\.(js|css)$/,
        calculateGzip: false,
      })
      : undefined,
  ],
  // prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    strictPort: true,
    host: '0.0.0.0',
    watch: {
      ignored: ['node_modules'],
    },
    cors: false,
    sourcemapIgnoreList: false,
  },
  envPrefix: ['AF'],
  esbuild: {
    keepNames: true,
    sourcesContent: true,
    sourcemap: true,
    minifyIdentifiers: false, // Disable identifier minification in development
    minifySyntax: false,      // Disable syntax minification in development
    pure: !isDev ? ['console.log', 'console.debug', 'console.info', 'console.trace'] : [],
  },
  build: {
    target: `esnext`,
    reportCompressedSize: true,
    rollupOptions: isProd
      ? {

        output: {
          chunkFileNames: 'static/js/[name]-[hash].js',
          entryFileNames: 'static/js/[name]-[hash].js',
          assetFileNames: 'static/[ext]/[name]-[hash].[ext]',
          manualChunks(id) {
            if (
              // id.includes('/react@') ||
              // id.includes('/react-dom@') ||
              id.includes('/react-is@') ||
              id.includes('/yjs@') ||
              id.includes('/y-indexeddb@') ||
              id.includes('/dexie') ||
              id.includes('/redux') ||
              id.includes('/react-custom-scrollbars') ||
              id.includes('/dayjs') ||
              id.includes('/smooth-scroll-into-view-if-needed') ||
              id.includes('/react-virtualized-auto-sizer') ||
              id.includes('/react-window')
              || id.includes('/@popperjs')
              || id.includes('/@mui/material/Dialog') ||
              id.includes('/quill-delta')
            ) {
              return 'common';
            }
          },
        },
      }
      : {},
  },
  resolve: {
    alias: [
      { find: 'src/', replacement: `${__dirname}/src/` },
      { find: '@/', replacement: `${__dirname}/src/` },
      { find: 'cypress/support', replacement: `${__dirname}/cypress/support` },
    ],
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'react-katex', '@appflowyinc/editor', '@appflowyinc/ai-chat'],
  },
});
