import { attachCellMentionLedger, CellMentionLedger } from '../cell-mention-ledger';

describe('confirmed cell mention notifications', () => {
  const send = jest.fn(async () => true);
  let ledger: CellMentionLedger;

  beforeEach(() => {
    jest.useFakeTimers();
    send.mockClear();
    ledger = new CellMentionLedger(new Set());
    ledger.attach();
  });
  afterEach(async () => {
    ledger.detach();
    await ledger.flush();
    jest.useRealTimers();
  });

  function save(people: string[], idleMs?: number) {
    ledger.beginSave();
    ledger.saved(new Set(people), send, idleMs);
    ledger.finishSave();
  }

  it('never sends for pasted recipients or an unsuccessful save', async () => {
    save(['pasted']);
    await ledger.flush();
    ledger.pick('picked', true);
    ledger.beginSave();
    ledger.finishSave();
    await ledger.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('drops a title mention removed by the next save before the burst ends', async () => {
    ledger.pick('Ada', true);
    save(['Ada'], 1000);
    expect(send).not.toHaveBeenCalled();
    save([], 1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
  });

  it('waits for the last confirmed title save and deduplicates reinsertions', async () => {
    ledger.pick('Ada', true);
    save(['Ada'], 1000);
    await jest.advanceTimersByTimeAsync(900);
    save([], 1000);
    save(['Ada'], 1000);
    await jest.advanceTimersByTimeAsync(999);
    expect(send).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    save([], 1000);
    ledger.pick('Ada', true);
    save(['Ada'], 1000);
    await ledger.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([{ outside: [] }, { outside: ['Ada', 'Bob'] }])(
    'uses outside value %j without attributing its additions to our save',
    async ({ outside }) => {
      ledger.pick('Ada', true);
      ledger.pick('Bob', true);
      save(['Ada'], 1000);
      ledger.outsideValue(new Set(outside));
      save(outside, 1000);
      await ledger.flush();
      expect(send.mock.calls).toEqual(outside.length ? [['Ada', true]] : []);
    }
  );

  it('retains intents and deduplication when a pending save outlives its editor', async () => {
    const first = attachCellMentionLedger('pending-cell', new Set());
    first.pick('Ada', true);
    first.beginSave();
    first.detach();
    const reopened = attachCellMentionLedger('pending-cell', new Set());
    expect(reopened).toBe(first);
    first.saved(new Set(['Ada']), send, 1000);
    first.finishSave();
    await first.flush();
    reopened.detach();
    await reopened.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('records the last picker preference and sends at most once at each strength', async () => {
    ledger.pick('Ada', false);
    save(['Ada']);
    await ledger.flush();
    save([]);
    await ledger.flush();
    ledger.pick('Ada', false);
    ledger.pick('Ada', true);
    save(['Ada']);
    await ledger.flush();
    expect(send.mock.calls).toEqual([
      ['Ada', false],
      ['Ada', true],
    ]);
  });
});
