import {
  createDatabaseBlobDiffPageStage,
  DatabaseBlobDiffPageStageCapacityError,
} from '@/application/database-blob/page-stage';

type TestRange = { kind: 'only'; value: string } | { kind: 'upperBound'; value: number };

type TestRecord = {
  walkId: string;
  pageIndex: number;
  bytes: Uint8Array;
  createdAt: number;
};

function createIndexedDBHarness() {
  const records = new Map<string, TestRecord>();
  let storeCreated = false;
  let closed = false;

  const recordKey = (walkId: string, pageIndex: number) => `${walkId}:${pageIndex}`;
  const createTransaction = () => {
    const transaction = {
      error: null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore: () => ({
        put: (record: TestRecord) => {
          records.set(recordKey(record.walkId, record.pageIndex), {
            ...record,
            // IndexedDB uses structured cloning. Model that here so the test
            // catches accidental retention of the caller's page buffer.
            bytes: record.bytes.slice(),
          });
          queueMicrotask(() => transaction.oncomplete?.());
        },
        get: ([walkId, pageIndex]: [string, number]) => {
          const request = {
            result: undefined as TestRecord | undefined,
            error: null,
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null,
          };

          queueMicrotask(() => {
            const record = records.get(recordKey(walkId, pageIndex));

            request.result = record
              ? {
                  ...record,
                  bytes: record.bytes.slice(),
                }
              : undefined;
            request.onsuccess?.();
          });

          return request;
        },
        index: () => ({
          openCursor: (range: TestRange) => {
            const matchingKeys = Array.from(records.entries())
              .filter(([, record]) =>
                range.kind === 'only' ? record.walkId === range.value : record.createdAt <= range.value
              )
              .map(([key]) => key);
            let cursorIndex = 0;
            const request = {
              result: null as {
                delete: () => void;
                continue: () => void;
              } | null,
              error: null,
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            const advance = () => {
              const key = matchingKeys[cursorIndex];

              if (!key) {
                request.result = null;
                request.onsuccess?.();
                queueMicrotask(() => transaction.oncomplete?.());
                return;
              }

              request.result = {
                delete: () => {
                  records.delete(key);
                },
                continue: () => {
                  cursorIndex += 1;
                  queueMicrotask(advance);
                },
              };
              request.onsuccess?.();
            };

            queueMicrotask(advance);
            return request;
          },
        }),
      }),
    };

    return transaction;
  };
  const database = {
    objectStoreNames: {
      contains: () => storeCreated,
    },
    createObjectStore: () => {
      storeCreated = true;
      return {
        createIndex: jest.fn(),
      };
    },
    transaction: createTransaction,
    close: () => {
      closed = true;
    },
    onversionchange: null as (() => void) | null,
  };
  const factory = {
    open: () => {
      const request = {
        result: database,
        error: null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
      };

      queueMicrotask(() => {
        if (!storeCreated) request.onupgradeneeded?.();
        request.onsuccess?.();
      });

      return request;
    },
  };
  const keyRange = {
    only: (value: string): TestRange => ({ kind: 'only', value }),
    upperBound: (value: number): TestRange => ({ kind: 'upperBound', value }),
  };

  return { factory, keyRange, records, isClosed: () => closed };
}

describe('database blob diff page stage', () => {
  const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const originalIDBKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');

  afterAll(() => {
    if (originalIndexedDB) {
      Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }

    if (originalIDBKeyRange) {
      Object.defineProperty(globalThis, 'IDBKeyRange', originalIDBKeyRange);
    } else {
      Reflect.deleteProperty(globalThis, 'IDBKeyRange');
    }
  });

  it('hard-limits the in-memory fallback and releases it on clear', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: undefined,
    });
    const memoryLimitBytes = 4;
    const stage = createDatabaseBlobDiffPageStage({ memoryLimitBytes });
    const halfLimit = memoryLimitBytes / 2;
    const firstPage = new Uint8Array(halfLimit);
    const secondPage = new Uint8Array(halfLimit);

    await stage.append(firstPage);
    await stage.append(secondPage);

    expect(stage.pageCount).toBe(2);
    expect(stage.byteLength).toBe(memoryLimitBytes);
    await expect(stage.append(new Uint8Array([1]))).rejects.toBeInstanceOf(DatabaseBlobDiffPageStageCapacityError);
    await expect(stage.read(0)).resolves.toEqual(firstPage);
    await expect(stage.read(1)).resolves.toEqual(secondPage);

    await stage.clear();

    expect(stage.pageCount).toBe(0);
    expect(stage.byteLength).toBe(0);
    await expect(stage.read(0)).rejects.toThrow('out of range');
  });

  it('stages multiple pages in IndexedDB and deletes them after use', async () => {
    const harness = createIndexedDBHarness();

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: harness.factory,
    });
    Object.defineProperty(globalThis, 'IDBKeyRange', {
      configurable: true,
      value: harness.keyRange,
    });

    const stage = createDatabaseBlobDiffPageStage();
    const firstPage = new Uint8Array([1, 2, 3]);
    const secondPage = new Uint8Array([4, 5]);

    await stage.append(firstPage);
    await stage.append(secondPage);
    firstPage.fill(9);
    secondPage.fill(9);

    expect(stage.pageCount).toBe(2);
    expect(stage.byteLength).toBe(5);
    expect(harness.records.size).toBe(2);
    await expect(stage.read(0)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(stage.read(1)).resolves.toEqual(new Uint8Array([4, 5]));

    await stage.clear();

    expect(harness.records.size).toBe(0);
    expect(stage.pageCount).toBe(0);
    expect(stage.byteLength).toBe(0);
    expect(harness.isClosed()).toBe(false);
  });
});
