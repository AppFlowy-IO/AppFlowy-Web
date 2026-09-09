import { createContext } from 'react';

/** Lets a containing surface retain mounted composers while hiding a draft. */
export const CommentDraftContext = createContext<((composerId: string, hasDraft: boolean) => void) | undefined>(
  undefined
);
