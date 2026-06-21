import { collabIndexedDBExists } from '@/application/db';

const originalIndexedDB = globalThis.indexedDB;

function installIndexedDBMock(indexedDBMock: Partial<IDBFactory>) {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: indexedDBMock,
  });
}

function createSuccessfulOpenRequest(database: IDBDatabase) {
  const request = { result: database } as IDBOpenDBRequest;

  Promise.resolve().then(() => {
    request.onsuccess?.({} as Event);
  });

  return request;
}

function createNewDatabaseOpenRequest(database: IDBDatabase) {
  const request = { result: database } as IDBOpenDBRequest;

  Promise.resolve().then(() => {
    request.onupgradeneeded?.({} as IDBVersionChangeEvent);
    request.onsuccess?.({} as Event);
  });

  return request;
}

function createSuccessfulDeleteRequest() {
  const request = {} as IDBOpenDBRequest;

  Promise.resolve().then(() => {
    request.onsuccess?.({} as Event);
  });

  return request;
}

describe('collabIndexedDBExists', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDB,
    });
    jest.restoreAllMocks();
  });

  it('probes the named IndexedDB when database enumeration is unavailable', async () => {
    const database = { close: jest.fn() } as unknown as IDBDatabase;
    const open = jest.fn(() => createSuccessfulOpenRequest(database));
    const deleteDatabase = jest.fn();

    installIndexedDBMock({ open, deleteDatabase });

    await expect(collabIndexedDBExists('legacy-row-db')).resolves.toBe(true);

    expect(open).toHaveBeenCalledWith('legacy-row-db');
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it('deletes an empty IndexedDB created while probing a missing name', async () => {
    const database = { close: jest.fn() } as unknown as IDBDatabase;
    const open = jest.fn(() => createNewDatabaseOpenRequest(database));
    const deleteDatabase = jest.fn(() => createSuccessfulDeleteRequest());

    installIndexedDBMock({ open, deleteDatabase });

    await expect(collabIndexedDBExists('missing-row-db')).resolves.toBe(false);

    expect(open).toHaveBeenCalledWith('missing-row-db');
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith('missing-row-db');
  });

  it('falls back to probing when database enumeration fails', async () => {
    const database = { close: jest.fn() } as unknown as IDBDatabase;
    const open = jest.fn(() => createSuccessfulOpenRequest(database));
    const databases = jest.fn().mockRejectedValue(new Error('blocked'));

    installIndexedDBMock({ open, databases });

    await expect(collabIndexedDBExists('blocked-enumeration-row-db')).resolves.toBe(true);

    expect(databases).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('blocked-enumeration-row-db');
  });
});
