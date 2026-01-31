/**
 * Jest mock for runtime-config.ts
 * This avoids the import.meta.env issue in Jest tests
 */
export function getConfigValue(key: string, defaultValue: string): string {
  // Return test defaults for common config keys
  const testDefaults: Record<string, string> = {
    APPFLOWY_BASE_URL: 'https://test.appflowy.cloud',
    APPFLOWY_GOTRUE_BASE_URL: 'https://test.appflowy.cloud/gotrue',
  };

  return testDefaults[key] ?? defaultValue;
}
