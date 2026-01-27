import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';

interface DatabaseContextProviderProps {
  children: React.ReactNode;
  value: DatabaseContextState;
}

export const DatabaseContextProvider = ({ children, value }: DatabaseContextProviderProps) => {
  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
};
