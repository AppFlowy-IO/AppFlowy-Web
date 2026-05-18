import { createContext, useContext } from 'react';

import { FormShareState, useFormShare } from './useFormShare';

/**
 * Scopes a single `useFormShare()` to the form-builder subtree so the
 * toolbar share button and the access banner read from the same source
 * of truth. Without this both call sites would mint independent fetches
 * and patches on one would not refresh the other.
 */
const FormShareContext = createContext<FormShareState | null>(null);

export function FormShareProvider({ children }: { children: React.ReactNode }) {
  const share = useFormShare();

  return (
    <FormShareContext.Provider value={share}>
      {children}
    </FormShareContext.Provider>
  );
}

export function useFormShareContext(): FormShareState {
  const ctx = useContext(FormShareContext);

  if (!ctx) {
    throw new Error('useFormShareContext must be used within FormShareProvider');
  }

  return ctx;
}
