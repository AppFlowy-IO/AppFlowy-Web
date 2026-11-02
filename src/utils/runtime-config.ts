import { resolveConfigValue, type RuntimeConfig } from './runtime-config-value';

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}

/**
 * The runtime config the Docker entrypoint injected, else the build-time
 * environment from Vite, else `defaultValue` (see `resolveConfigValue`).
 */
export function getConfigValue(key: keyof RuntimeConfig, defaultValue: string): string {
  return resolveConfigValue(
    key,
    defaultValue,
    typeof window === 'undefined' ? undefined : window.__APP_CONFIG__,
    import.meta.env
  );
}

/**
 * Keep Vite's `import.meta.env` access behind this module so CommonJS Jest
 * suites can replace it through the existing runtime-config module mapping.
 */
export function isDevelopmentOrTestEnvironment(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'test';
}

/** True only under the Vite dev server (`pnpm dev`); production builds and Jest return false. */
export function isLocalDevelopment(): boolean {
  return import.meta.env.DEV === true;
}
