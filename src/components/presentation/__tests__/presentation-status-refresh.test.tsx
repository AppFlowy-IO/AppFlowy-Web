import { act, renderHook } from '@testing-library/react';

import { getPresentationStatus } from '../presentation-client';
import { usePresentationStatusRefresh } from '../usePresentationStatusRefresh';

import type { PresentationStatus } from '../server-contract';

jest.mock('../presentation-client', () => ({ getPresentationStatus: jest.fn() }));

test('refresh changes only allowance status and ignores stale workspace responses', async () => {
  const accept = jest.fn();
  let finish!: (value: PresentationStatus) => void;

  jest.mocked(getPresentationStatus).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = renderHook(({ workspace }) => usePresentationStatusRefresh(workspace, 'user', accept), { initialProps: { workspace: 'first' } });
  let pending!: Promise<void>;

  act(() => { pending = view.result.current(); });
  const signal = jest.mocked(getPresentationStatus).mock.calls[0][1]!;

  view.rerender({ workspace: 'second' });
  expect(signal.aborted).toBe(true);
  await act(async () => { finish({ remainingSlides: 0 } as PresentationStatus); await pending; });
  expect(accept).not.toHaveBeenCalled();
  const next = { remainingSlides: 4 } as PresentationStatus;

  jest.mocked(getPresentationStatus).mockResolvedValueOnce(next);
  await act(view.result.current);
  expect(accept).toHaveBeenCalledWith(next);
});

test('failed refresh retains the last successful status and returning focus refreshes availability', async () => {
  const accept = jest.fn();
  const { result } = renderHook(() => usePresentationStatusRefresh('workspace', 'user', accept));

  jest.mocked(getPresentationStatus).mockRejectedValueOnce(new Error('Temporary outage'));
  await act(result.current);
  expect(accept).not.toHaveBeenCalled();
  const next = { remainingSlides: 100 } as PresentationStatus;

  jest.mocked(getPresentationStatus).mockResolvedValueOnce(next);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(accept).toHaveBeenCalledWith(next);
});
