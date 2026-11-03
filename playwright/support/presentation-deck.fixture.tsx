import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { useAppThemeMode } from '@/components/main/useAppThemeMode';
import SlidesWorkflow from '@/components/presentation/SlidesWorkflow';

import type { Theme } from '@/components/presentation/server-contract';
import type { DeckScene } from '@/components/presentation/server-scene';
import type { PageSnapshot, SavedDeck, StoryPlan } from '@/components/presentation/types';

import '@/styles/global.css';
import '@/components/presentation/presentation.css';

const theme: Theme = {
  id: 'paper',
  name: 'Paper',
  description: '',
  color: '#112233',
  background: '#FFFFFF',
  textColor: '#112233',
  font: 'Arial',
  bodyFont: 'Arial',
  footer: '',
  palette: [],
  guidelines: '',
};
const plan: StoryPlan = {
  title: 'Saved deck',
  slides: Array.from({ length: 3 }, (_, index) => ({
    id: `slide-${index}`,
    title: `Slide ${index + 1}`,
    layout: 'title',
    message: '',
    points: [],
    sourceIds: [],
    notes: '',
    warnings: [],
  })),
};
const scene: DeckScene = {
  schemaVersion: 1,
  width: 1280,
  height: 720,
  title: plan.title,
  theme,
  style: { id: theme.id, version: 1 },
  warnings: [],
  slides: plan.slides.map((slide) => ({
    id: slide.id,
    layout: slide.layout,
    background: 'FFFFFF',
    notes: '',
    sourceIds: [],
    warnings: [],
    elements: [
      {
        id: 'title',
        kind: 'text',
        text: slide.title,
        bounds: { x: 128, y: 72, width: 1024, height: 144 },
        font: theme.font,
        size: 48,
        bold: true,
        color: '112233',
      },
    ],
  })),
};
const snapshot: PageSnapshot = {
  pageId: 'page',
  title: 'Source',
  revision: 'revision',
  kind: 'document',
  blocks: [],
  properties: [],
  warnings: [],
};
const deck: SavedDeck = {
  id: 'deck',
  version: 1,
  createdAt: '2026-10-30T00:00:00Z',
  plan,
  style: theme,
  sourceRevision: snapshot.revision,
  scene: { workspaceId: 'workspace', id: 'deck', version: 1, value: scene },
};

function Fixture() {
  useAppThemeMode();
  const [open, setOpen] = useState(false);

  if (!open) return <button onClick={() => setOpen(true)}>Open saved deck</button>;
  return (
    <div className='ps-root'>
      <SlidesWorkflow
        snapshot={snapshot}
        plan={plan}
        activeDeck={deck}
        scope={{ workspaceId: 'workspace', pageId: 'page' }}
        style={theme}
        styles={[theme]}
        stage='preview'
        initialAction='present'
        options={{ audience: '', slideCount: 3, instructions: '', includeProperties: false, allowWebSearch: false }}
        onOptions={() => undefined}
        onStyle={() => undefined}
        onPlan={() => undefined}
        onStage={() => undefined}
        onGenerate={() => undefined}
        onSource={() => undefined}
        onApplyOutline={async () => undefined}
        onDiscardOutline={() => undefined}
        onStyles={() => undefined}
        onUpgrade={() => undefined}
        hasOutlineChanges={false}
        canGenerate={false}
        canEdit={false}
        sourceChanged={false}
        hasNarrative={false}
        origin='Saved presentation'
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
