import { act, renderHook } from '@testing-library/react';

import type { YjsEditor } from '@/application/slate-yjs';

import { clearPDFUploadError, registerPDFReady, reportPDFUploadError, usePDFReady, usePDFUploadError } from '../pdf-block-state';

it('updates open menus when a viewer loads and unmounts, scoped to its editor and block', () => {
  const editor = {} as YjsEditor;
  const otherEditor = {} as YjsEditor;
  const { result } = renderHook(() => [usePDFReady(editor, 'pdf'), usePDFReady(editor, 'other'), usePDFReady(otherEditor, 'pdf')]);
  let release!: () => void;

  expect(result.current).toEqual([false, false, false]);
  act(() => { release = registerPDFReady(editor, 'pdf'); });
  expect(result.current).toEqual([true, false, false]);
  act(() => release());
  expect(result.current).toEqual([false, false, false]);
});

it('does not let an old viewer cleanup clear the replacement viewer readiness', () => {
  const editor = {} as YjsEditor;
  const { result } = renderHook(() => usePDFReady(editor, 'pdf'));
  let releaseOld!: () => void;
  let releaseNew!: () => void;

  act(() => {
    releaseOld = registerPDFReady(editor, 'pdf');
    releaseNew = registerPDFReady(editor, 'pdf');
  });
  act(() => releaseOld());
  expect(result.current).toBe(true);
  act(() => releaseNew());
  expect(result.current).toBe(false);
});

it('delivers errors raised before the pasted block mounts and does not clear a newer failure', () => {
  const editor = {} as YjsEditor;
  const first = { code: 1037, sourceDomain: 'appflowy.server' };

  reportPDFUploadError(editor, 'pdf', first);
  const { result } = renderHook(() => usePDFUploadError(editor, 'pdf'));
  const previous = result.current!;

  expect(previous.error).toBe(first);
  const second = new Error('second upload');

  act(() => reportPDFUploadError(editor, 'pdf', second));
  act(() => clearPDFUploadError(editor, 'pdf', previous));
  expect(result.current?.error).toBe(second);
  act(() => clearPDFUploadError(editor, 'pdf', result.current!));
  expect(result.current).toBeUndefined();
});
