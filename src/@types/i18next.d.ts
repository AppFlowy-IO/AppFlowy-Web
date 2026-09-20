import resources from './resources';

declare module 'i18next' {
  interface i18n {
    // i18next 22 supports this overload at runtime but omits it from its types.
    loadResources(language: string, callback?: (error: unknown) => void): void;
  }

  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: typeof resources;
  }
}
