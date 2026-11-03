import Dialog from '@mui/material/Dialog';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import AppTheme from '@/components/main/AppTheme';
import { METRICS_MAP } from '@/components/presentation/__tests__/fixtures/mindmap-tables';
import MindMapViewer from '@/components/presentation/MindMapViewer';
import type { MindMap } from '@/components/presentation/types';
import '@/components/presentation/presentation.css';
import '@/styles/global.css';

const input: { map: MindMap; table?: boolean } = await fetch('/presentation-map-input.json').then((response) =>
  response.json()
);
const map = input.table ? METRICS_MAP : input.map;
const noop = () => undefined;

// Rendering fixture only: no persistence, simulated quota or model endpoint.
function Fixture() {
  const [open, setOpen] = useState(false);
  const direct = new URLSearchParams(location.search).has('present');
  const viewer = (
    <div className='ps-root'>
      <MindMapViewer
        map={map}
        mapStyle={{ structure: 'balanced', branchLine: 'curved' }}
        canGenerate={false}
        onGenerate={noop}
        onSlides={noop}
        onClosePresentation={direct ? () => setOpen(false) : undefined}
        onSource={(id) => {
          document.documentElement.dataset.openedSource = id;
        }}
      />
    </div>
  );
  return (
    <AppTheme>
      {direct ? (
        <>
          <button onClick={() => setOpen(true)}>Present mind map</button>
          <Dialog
            open={open}
            fullScreen
            onClose={() => setOpen(false)}
            PaperProps={{ className: 'ps-root ps-map-preview-dialog' }}
          >
            {open && viewer}
          </Dialog>
        </>
      ) : (
        viewer
      )}
    </AppTheme>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
