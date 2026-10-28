import Dialog from '@mui/material/Dialog';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import AppTheme from '@/components/main/AppTheme';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { SAMPLE_SNAPSHOT } from '@/components/presentation/fixtures';
import '@/styles/global.css';

// Match the native app's theme and PresentationDialog -> DocumentPresenter portals.
function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <AppTheme>
      <button onClick={() => setOpen(true)}>Present document</button>
      <Dialog open={open} fullScreen onClose={() => setOpen(false)}>
        <DocumentPresenter snapshot={SAMPLE_SNAPSHOT} onClose={() => setOpen(false)} onSource={() => undefined} />
      </Dialog>
    </AppTheme>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
