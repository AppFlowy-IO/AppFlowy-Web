import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import {
  FORM_DESCRIPTION,
  FORM_DESCRIPTION_VISIBLE,
  FORM_INCLUDED,
  FORM_ORDER,
  FORM_REQUIRED,
} from '@/application/database-yjs/form-questions';
import type { YDatabaseFormFieldSettings, YDatabaseView } from '@/application/types';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';

import { useFormLayoutSnapshot } from '../useFormLayoutSnapshot';

let mockView: YDatabaseView | undefined;

jest.mock('@/application/database-yjs/context', () => ({
  useDatabaseView: () => mockView,
}));

function createView(id: string, questionId: string, description: string): YDatabaseView {
  const doc = new Y.Doc();
  const view = doc.getMap(`view-${id}`) as YDatabaseView;
  const settings = new Y.Map() as YDatabaseFormFieldSettings;
  const entry = new Y.Map<unknown>();

  entry.set(FORM_INCLUDED, true);
  entry.set(FORM_REQUIRED, false);
  entry.set(FORM_DESCRIPTION_VISIBLE, true);
  entry.set(FORM_DESCRIPTION, description);
  entry.set(FORM_ORDER, 0);
  settings.set(questionId, entry);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Form);
  view.set(YjsDatabaseKey.form_field_settings, settings);
  return view;
}

describe('useFormLayoutSnapshot', () => {
  afterEach(() => {
    mockView = undefined;
  });

  it('reads the active view synchronously on the first render and on a view swap', () => {
    const firstView = createView('first', 'question-a', 'First');
    const secondView = createView('second', 'question-b', 'Second');
    const renders: string[] = [];

    mockView = firstView;
    const { result, rerender } = renderHook(() => {
      const snapshot = useFormLayoutSnapshot();

      renders.push(snapshot.questions[0]?.fieldId ?? 'empty');
      return snapshot;
    });

    expect(renders[0]).toBe('question-a');
    expect(result.current.questions[0]?.description).toBe('First');

    mockView = secondView;
    rerender();

    expect(renders[renders.length - 1]).toBe('question-b');
    expect(result.current.questions[0]?.description).toBe('Second');
  });

  it('shares one Yjs observer across consumers and publishes nested changes', () => {
    mockView = createView('shared', 'question-a', 'Before');
    const observe = jest.spyOn(mockView, 'observeDeep');
    const unobserve = jest.spyOn(mockView, 'unobserveDeep');
    const { result, unmount } = renderHook(() => [useFormLayoutSnapshot(), useFormLayoutSnapshot()] as const);

    expect(observe).toHaveBeenCalledTimes(1);

    act(() => {
      mockView?.get(YjsDatabaseKey.form_field_settings)?.get('question-a')?.set(FORM_DESCRIPTION, 'After');
    });

    expect(result.current[0].questions[0]?.description).toBe('After');
    expect(result.current[1]).toBe(result.current[0]);

    unmount();
    expect(unobserve).toHaveBeenCalledTimes(1);
  });
});
