import { createContext, ReactNode, useContext } from 'react';

export interface PlaceholderOverride {
  unselected?: string;
  selected?: string;
  onlyFirstChild?: boolean; // Only show placeholder on first child
}

const PlaceholderContext = createContext<PlaceholderOverride | null>(null);

export function PlaceholderProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: PlaceholderOverride;
}) {
  return <PlaceholderContext.Provider value={value}>{children}</PlaceholderContext.Provider>;
}

export function usePlaceholderOverride() {
  return useContext(PlaceholderContext);
}
