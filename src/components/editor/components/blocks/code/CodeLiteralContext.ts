import { createContext } from 'react';

/** Persisted rich-text marks survive conversion back to prose, but code always displays literally. */
export const CodeLiteralContext = createContext(false);
