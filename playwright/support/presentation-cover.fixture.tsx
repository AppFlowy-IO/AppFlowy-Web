import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Element } from 'slate';

import { CoverType, ViewLayout, type ViewCover } from '@/application/types';
import AppTheme from '@/components/main/AppTheme';
import DocumentPresenter from '@/components/presentation/DocumentPresenter';
import { snapshotFromSlate } from '@/components/presentation/snapshot-adapter';
import ViewMetaPreview from '@/components/view-meta/ViewMetaPreview';
import '@/styles/global.css';

const params = new URLSearchParams(location.search);
const covers: Record<string, ViewCover> = {
  built_in: { type: CoverType.BuildInImage, value: '3', offset: 0.6 },
  custom: { type: CoverType.CustomImage, value: '/covers/m_cover_image_4.png', offset: -0.4 },
  unsplash: { type: CoverType.UpsplashImage, value: '/covers/m_cover_image_5.png', offset: 1 },
  color: { type: CoverType.NormalColor, value: 'appflowy_them_color_tint3' },
  gradient: { type: CoverType.GradientColor, value: 'linear-gradient(120deg, #7a94e8, #d6b4eb)' },
  removed: { type: CoverType.None, value: '' },
  unavailable: { type: CoverType.CustomImage, value: '/missing-presentation-cover.png' },
};
const cover = covers[params.get('cover') || 'built_in'];
const title = 'How our ideas become better products';
const source = {
  type: 'page',
  children: [{ type: 'paragraph', children: [{ type: 'text', children: [{ text: 'The document continues here.' }] }] }],
} as Element;
const snapshot = snapshotFromSlate('cover-page', title, source, false, undefined, cover);
function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <AppTheme>
      <ViewMetaPreview name={title} cover={cover} layout={ViewLayout.Document} readOnly />
      <button onClick={() => setOpen(true)}>Present document</button>
      {open && <DocumentPresenter snapshot={snapshot} onSource={() => setOpen(false)} onClose={() => setOpen(false)} />}
    </AppTheme>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
