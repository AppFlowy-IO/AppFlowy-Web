/** The config a deployment injects at runtime as `window.__APP_CONFIG__` (see docker/entrypoint.sh). */
export interface RuntimeConfig {
  APPFLOWY_BASE_URL?: string;
  APPFLOWY_GOTRUE_BASE_URL?: string;
  APPFLOWY_WS_BASE_URL?: string;
  APPFLOWY_GOOGLE_DRIVE_PICKER_APP_ID?: string;
  APPFLOWY_GOOGLE_DRIVE_PICKER_API_KEY?: string;
  /**
   * Public origin of the AppFlowy MCP service, without `/mcp`: an explicit override. Unset, the
   * Web uses the `mcp_url` AppFlowy Cloud advertises in server-info.
   */
  APPFLOWY_MCP_BASE_URL?: string;
}

/**
 * Keys a deployment may leave empty on purpose. The Docker entrypoints inject
 * the four URL keys, an unset one as '', and for these '' means "not set
 * here": a value baked into the build (Vite inlines `APPFLOWY_*` from a
 * developer's `.env`) must not win over it. The entrypoints refuse to start
 * with the other URL keys empty and never inject the Google Drive picker
 * keys, so an empty value of any other key falls back as before.
 */
const OPTIONAL_KEYS: ReadonlySet<keyof RuntimeConfig> = new Set(['APPFLOWY_MCP_BASE_URL']);

/**
 * The value of `key`: the injected runtime config, else the build-time env,
 * else `defaultValue`. An optional key the runtime config carries, even
 * empty, never falls back to the build. Without `import.meta`, so Jest can
 * test it (Jest replaces `runtime-config.ts` with a mock).
 */
export function resolveConfigValue(
  key: keyof RuntimeConfig,
  defaultValue: string,
  runtimeConfig: RuntimeConfig | undefined,
  buildEnv: Readonly<Record<string, unknown>>
): string {
  const runtimeValue = runtimeConfig?.[key];

  // An entrypoint that did not substitute its template leaves `${KEY}` behind.
  if (typeof runtimeValue === 'string' && !runtimeValue.startsWith('${')) {
    if (runtimeValue) return runtimeValue;
    if (OPTIONAL_KEYS.has(key)) return defaultValue;
  }

  const envValue = buildEnv[key];

  return typeof envValue === 'string' && envValue ? envValue : defaultValue;
}
