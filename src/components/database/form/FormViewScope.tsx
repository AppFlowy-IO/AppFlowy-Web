import { useDatabaseContext } from '@/application/database-yjs';

import { FormShareProvider } from './FormShareContext';

export default function FormViewScope({ children }: { children: React.ReactNode }) {
  const { canShare } = useDatabaseContext();

  return <FormShareProvider canUpdateSettings={canShare === true}>{children}</FormShareProvider>;
}
