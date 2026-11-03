import { createContext } from 'react';

/** A host can commit pending filter inputs before persisting and releasing its state. */
export const FilterInputFlushContext = createContext<Set<() => void> | null>(null);
