import { act, render } from '@testing-library/react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

import { View, YDoc } from '@/application/types';
import { AppOutlineContext, AppOutlineReaderContext } from '@/components/app/contexts/AppOutlineContext';

import { useDashboardOwnerLookup } from '../hooks/useDashboardOwnerLookup';

function folderView(viewId: string, owner?: string): View {
  return { view_id: viewId, name: viewId, children: [], extra: owner ? { dashboard_owner: owner } : null } as unknown as View;
}

let ownerOf: ReturnType<typeof useDashboardOwnerLookup> = () => null;
let renders = 0;
let setOutline: (outline: View[]) => void = () => undefined;

/** Reads only what the lookup needs; never re-rendered by its parent (memo, stable props). */
const Lookup = memo(function Lookup({ hostDoc }: { hostDoc: YDoc }) {
  renders += 1;
  ownerOf = useDashboardOwnerLookup({ hostDoc });
  return null;
});

/** The business layer's shape: the outline in state, and a stable reader of the same value. */
function Outline({ hostDoc }: { hostDoc: YDoc }) {
  const [outline, set] = useState<View[]>([]);
  const outlineRef = useRef(outline);

  outlineRef.current = outline;
  setOutline = set;
  const readOutline = useCallback(() => outlineRef.current, []);
  const value = useMemo(() => ({ outline }), [outline]);

  return (
    <AppOutlineReaderContext.Provider value={readOutline}>
      <AppOutlineContext.Provider value={value}>
        <Lookup hostDoc={hostDoc} />
      </AppOutlineContext.Provider>
    </AppOutlineReaderContext.Provider>
  );
}

beforeEach(() => {
  renders = 0;
});

describe('useDashboardOwnerLookup', () => {
  it('reads the outline at call time without subscribing to it', () => {
    const hostDoc = new Y.Doc() as YDoc;

    render(<Outline hostDoc={hostDoc} />);
    expect(renders).toBe(1);
    expect(ownerOf('v1')).toBeNull();

    // A folder change replaces the outline context value: the lookup's owner
    // is not re-rendered, and the callback still sees the new outline.
    act(() => setOutline([folderView('space', undefined), folderView('v1', 'dash')]));
    expect(renders).toBe(1);
    expect(ownerOf('v1')).toBe('dash');

    act(() => setOutline([folderView('v1')]));
    expect(renders).toBe(1);
    expect(ownerOf('v1')).toBeNull();
    hostDoc.destroy();
  });

  it('is null outside the app layers (no reader provided)', () => {
    const hostDoc = new Y.Doc() as YDoc;

    render(<Lookup hostDoc={hostDoc} />);
    expect(ownerOf('v1')).toBeNull();
    hostDoc.destroy();
  });
});
