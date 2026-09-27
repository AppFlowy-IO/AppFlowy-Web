import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

import { initAPIService } from '@/application/services/js-services/http/core';
import { ConnectionsPanel } from '@/components/app/settings/ConnectionsPanel';
import '@/i18n/config';
import '@/styles/global.css';

initAPIService({ baseURL: location.origin, gotrueURL: location.origin, wsURL: '' });

function Fixture() {
  const [open, setOpen] = useState(true);

  return (
    <main className='mx-auto flex h-screen max-w-3xl flex-col p-8'>
      <button onClick={() => setOpen(!open)}>{open ? 'Close settings' : 'Open settings'}</button>
      {open && <ConnectionsPanel workspaceId='connection-test-workspace' />}
      <Toaster />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
