/**
 * Dependencies that must resolve to one runtime instance. A second React
 * module has its own hook dispatcher and cannot be rendered by the app's
 * ReactDOM instance.
 */
export const VITE_DEDUPED_DEPENDENCIES = ['react', 'react-dom'] as const;

/**
 * Lazy views are not guaranteed to be found by Vite's startup dependency
 * scan. Pre-bundle Recharts with React so opening the first Chart view cannot
 * trigger a mid-session dependency re-optimization and split the React graph.
 */
export const VITE_OPTIMIZED_DEPENDENCIES = [
  'react',
  'react-dom',
  'recharts',
  'react-katex',
  '@appflowyinc/editor',
  'react-colorful',
  'i18next',
  'i18next-browser-languagedetector',
  'i18next-resources-to-backend',
  'react-i18next',
] as const;
