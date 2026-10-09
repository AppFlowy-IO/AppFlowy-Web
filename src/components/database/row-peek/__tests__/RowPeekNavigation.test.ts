import { createRowPeekNavigation } from '@/components/database/row-peek/RowPeekNavigation';
import { Log } from '@/utils/log';

afterEach(() => jest.restoreAllMocks());

describe('row peek save barriers', () => {
  it('waits for a focused property save even when blur unregisters its editor', async () => {
    const navigation = createRowPeekNavigation();
    const container = document.createElement('div');
    const input = document.createElement('input');
    let finish!: (saved: boolean) => void;
    const save = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    const unregister = navigation.register(save);

    container.append(input);
    document.body.append(container);
    input.addEventListener('blur', unregister);
    input.focus();
    try {
      const ready = jest.fn();
      const pending = navigation.prepare(container);

      void pending.then(ready);
      await Promise.resolve();
      expect(document.activeElement).not.toBe(input);
      expect(save).toHaveBeenCalledTimes(1);
      expect(ready).not.toHaveBeenCalled();
      finish(true);
      await expect(pending).resolves.toBe(true);
      await expect(navigation.prepare(container)).resolves.toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      container.remove();
    }
  });

  it('coalesces concurrent navigation requests and waits for every editor', async () => {
    const navigation = createRowPeekNavigation();
    let finishTitle!: (saved: boolean) => void;
    let finishDocument!: (saved: boolean) => void;
    const title = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishTitle = resolve;
        })
    );
    const document = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishDocument = resolve;
        })
    );

    navigation.register(title);
    navigation.register(document);
    const first = navigation.prepare(null);
    const second = navigation.prepare(null);
    const ready = jest.fn();

    void first.then(ready);
    expect(second).toBe(first);
    await Promise.resolve();
    finishTitle(true);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finishDocument(false);
    await expect(first).resolves.toBe(false);
    expect(title).toHaveBeenCalledTimes(1);
    expect(document).toHaveBeenCalledTimes(1);
  });

  it('preserves the row after a save exception and permits a corrected retry', async () => {
    const navigation = createRowPeekNavigation();
    const error = new Error('Write failed');
    const log = jest.spyOn(Log, 'error').mockImplementation(() => undefined);
    const save = jest.fn().mockRejectedValueOnce(error).mockResolvedValue(true);

    navigation.register(save);
    await expect(navigation.prepare(null)).resolves.toBe(false);
    await expect(navigation.prepare(null)).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('[RowPeek] Failed to save before navigation', error);
  });
});
