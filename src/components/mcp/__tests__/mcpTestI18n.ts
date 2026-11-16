import i18next, { type TFunction } from 'i18next';

import en from '@/@types/translations/en.json';

/**
 * The real i18next over en.json, with the app's defaults (`src/i18n/config.ts` sets no
 * interpolation options), for MCP tests that assert English text. A hand-rolled translator would
 * hide a call that forgets `RAW_INTERPOLATION` (i18next HTML-escapes values by default, so
 * `Q&A` shows as `Q&amp;A`) and resolves plurals differently (a count of 0 reads `_other`).
 *
 * Components get it through `jest.mock('react-i18next', …)` with `jest.requireActual` of this
 * module inside the factory.
 */
const instance = i18next.createInstance();

// Inline resources and no deferred init: ready when this module has loaded.
void instance.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  initImmediate: false,
});

export const mcpTestT: TFunction = instance.t;
