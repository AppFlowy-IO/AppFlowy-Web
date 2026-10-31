import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import AppTheme from '@/components/main/AppTheme';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { SAMPLE_MARKDOWN } from '@/components/presentation/fixtures';
import { parseMarkdown } from '@/components/presentation/source';
import '@/styles/global.css';

// Browser-test entry only: no app route, account simulation, provider or backend.
function Fixture() {
  const [text, setText] = useState(SAMPLE_MARKDOWN);
  const [snapshot, setSnapshot] = useState(() => parseMarkdown(SAMPLE_MARKDOWN, 'Q3 Product Review'));
  const [open, setOpen] = useState(false);
  return (
    <AppTheme>
      <textarea aria-label='Source content · Markdown' value={text} onChange={(event) => setText(event.target.value)} />
      <button onClick={() => setSnapshot(parseMarkdown(text, 'Q3 Product Review'))}>Update source snapshot</button>
      <button onClick={() => setOpen(true)}>Present document</button>
      {open && <DocumentPresenter snapshot={snapshot} onClose={() => setOpen(false)} onSource={() => setOpen(false)} />}
    </AppTheme>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
