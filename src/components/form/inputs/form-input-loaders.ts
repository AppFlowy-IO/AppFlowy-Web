let formLongTextInputPromise:
  | Promise<{ default: typeof import('./FormLongTextInput').FormLongTextInput }>
  | undefined;

/** Shared loader so schema preloading and React.lazy join one network request. */
export function loadFormLongTextInput() {
  formLongTextInputPromise ??= import('./FormLongTextInput').then(({ FormLongTextInput }) => ({
    default: FormLongTextInput,
  }));

  return formLongTextInputPromise;
}
