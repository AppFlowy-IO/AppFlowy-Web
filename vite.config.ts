import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { viteExternalsPlugin } from 'vite-plugin-externals';
import { createHtmlPlugin } from 'vite-plugin-html';
import istanbul from 'vite-plugin-istanbul';
import svgr from 'vite-plugin-svgr';
import { totalBundleSize } from 'vite-plugin-total-bundle-size';
import { stripTestIdPlugin } from './vite-plugin-strip-testid';

const resourcesPath = path.resolve(__dirname, '../resources');
const isDev = process.env.NODE_ENV ? process.env.NODE_ENV === 'development' : true;
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.env.COVERAGE === 'true';

// Namespace redirect plugin for dev mode - mirrors deploy/server.ts behavior
function namespaceRedirectPlugin() {
  const baseURL = process.env.APPFLOWY_BASE_URL || 'http://localhost:8000';

  return {
    name: 'namespace-redirect',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string; method?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: () => void }, next: () => void) => void) => void } }) {
      const ignoredPrefixes = ['/app', '/login', '/import', '/after-payment', '/as-template', '/accept-invitation', '/404'];

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || req.method !== 'GET') {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname;

        // Skip ignored prefixes and root
        if (pathname === '/' || ignoredPrefixes.some((prefix) => pathname.startsWith(prefix))) {
          return next();
        }

        const parts = pathname.split('/').filter(Boolean);

        // Skip if not a single-segment path (namespace only) or if it's a static asset/dev file
        const isStaticAsset = /\.(js|css|html|map|json|png|jpg|jpeg|gif|svg|woff2?|ttf)$/i.test(pathname);
        if (parts.length !== 1 || isStaticAsset || pathname.includes('@') || pathname.includes('node_modules') || pathname.startsWith('/src/')) {
          return next();
        }

        try {
          // Fetch publish info for this namespace (same API as deploy/server.ts)
          const apiUrl = `${baseURL}/api/workspace/published/${parts[0]}`;
          const response = await fetch(apiUrl);

          if (!response.ok) {
            return next();
          }

          const data = await response.json();
          const publishInfo = data?.data?.info;

          if (publishInfo?.namespace && publishInfo?.publish_name) {
            const redirectUrl = `/${encodeURIComponent(publishInfo.namespace)}/${encodeURIComponent(publishInfo.publish_name)}`;
            res.statusCode = 302;
            res.setHeader('Location', redirectUrl);
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.end();
            return;
          }
        } catch {
          // Silently fail and let the request continue
        }

        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    isDev ? namespaceRedirectPlugin() : undefined,
    // Strip data-testid attributes in production builds
    isProd ? stripTestIdPlugin() : undefined,
    createHtmlPlugin({
      inject: {
        data: {
          injectCdn: isProd,
          cdnLinks: isProd
            ? `
              <link rel="dns-prefetch" href="//cdn.jsdelivr.net">
              <link rel="preconnect" href="//cdn.jsdelivr.net">
              
              <script crossorigin src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js"></script>
              <script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
            `
            : '',
        },
      },
    }),
    isProd
      ? viteExternalsPlugin({
          react: 'React',
          'react-dom': 'ReactDOM',
        })
      : undefined,
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
          black: 'currentColor',
        },
      },
    }),
    // Enable istanbul for code coverage (active if isTest is true)
    isTest
      ? istanbul({
          cypress: true,
          requireEnv: false,
          include: ['src/**/*'],
          exclude: ['**/__tests__/**/*', 'cypress/**/*', 'node_modules/**/*'],
        })
      : undefined,
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
    host: '0.0.0.0', // Listen on all network interfaces (both IPv4 and IPv6)
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    strictPort: true,
    watch: {
      ignored: ['node_modules'],
    },
    cors: false,
    sourcemapIgnoreList: false,
  },
  envPrefix: ['APPFLOWY'],
  esbuild: {
    keepNames: true,
    sourcesContent: true,
    sourcemap: true,
    minifyIdentifiers: false, // Disable identifier minification in development
    minifySyntax: false, // Disable syntax minification in development
    drop: !isDev ? ['console', 'debugger'] : [],
  },
  build: {
    target: `esnext`,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1600,
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
              id.includes('/react-window') ||
              id.includes('/@popperjs') ||
              id.includes('/@mui/material/Dialog') ||
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
    include: [
      'react',
      'react-dom',
      'react-katex',
      '@appflowyinc/editor',
      '@appflowyinc/ai-chat',
      'react-colorful',
      'i18next',
      'i18next-browser-languagedetector',
      'i18next-resources-to-backend',
      'react-i18next'
    ],
  },
});
