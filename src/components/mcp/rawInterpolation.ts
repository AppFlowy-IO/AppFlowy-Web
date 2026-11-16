/**
 * i18next options for values that are raw text: app and member names, emails, hosts and other
 * server data. React escapes what it renders, so i18next must not escape them too: the app keeps
 * i18next's default `escapeValue: true` (`src/i18n/config.ts`), which would show `Q&A` as
 * `Q&amp;A`. Spread it into the values, `t(key, { name, ...RAW_INTERPOLATION })`, and render the
 * result as text, never as HTML. The one definition for the consent page, the setup guide and
 * Settings → MCP.
 */
export const RAW_INTERPOLATION = { interpolation: { escapeValue: false } };
