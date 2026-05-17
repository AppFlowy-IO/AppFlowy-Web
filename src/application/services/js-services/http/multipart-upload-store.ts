import { UploadPartInfo } from './multipart-upload.types';

const DB_NAME = 'AppFlowyMultipartUploads';
const DB_VERSION = 1;
const STORE_NAME = 'uploads';

export interface PersistedMultipartUpload {
  id: string;
  workspaceId: string;
  viewId: string;
  fileId: string;
  uploadId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileLastModified: number;
  chunkSize: number;
  // Held only in-memory during an active upload. Stripped before persistence so
  // we don't write the full payload (potentially hundreds of MB) to IndexedDB
  // on every part completion. Callers re-attach the live File on resume via
  // `getOrCreateSession`.
  file?: File;
  parts: UploadPartInfo[];
  createdAt: number;
  updatedAt: number;
}

function canUseIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function createSessionId(workspaceId: string, viewId: string, file: File): string {
  return [
    'multipart',
    workspaceId,
    viewId,
    encodeURIComponent(file.name),
    file.size,
    file.lastModified,
    encodeURIComponent(file.type || 'application/octet-stream'),
  ].join(':');
}

function isSameFile(session: PersistedMultipartUpload, file: File): boolean {
  return (
    session.fileName === file.name &&
    session.fileSize === file.size &&
    session.fileLastModified === file.lastModified &&
    session.fileType === (file.type || 'application/octet-stream')
  );
}

class MultipartUploadStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private memoryStore = new Map<string, PersistedMultipartUpload>();

  getSessionId(workspaceId: string, viewId: string, file: File): string {
    return createSessionId(workspaceId, viewId, file);
  }

  async getSession(
    workspaceId: string,
    viewId: string,
    file: File
  ): Promise<PersistedMultipartUpload | null> {
    const id = this.getSessionId(workspaceId, viewId, file);
    const session = await this.getById(id);

    if (!session || !isSameFile(session, file)) {
      return null;
    }

    return session;
  }

  async saveSession(session: PersistedMultipartUpload): Promise<void> {
    // Drop the live File reference before persisting — only resume metadata
    // needs to survive a reload. The active upload code re-attaches the File
    // it was handed by the caller (see `getOrCreateSession`).
    const nextSession: PersistedMultipartUpload = {
      ...session,
      file: undefined,
      updatedAt: Date.now(),
    };

    if (!canUseIndexedDB()) {
      this.memoryStore.set(nextSession.id, nextSession);
      return;
    }

    const db = await this.openDb();

    if (!db) {
      this.memoryStore.set(nextSession.id, nextSession);
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(nextSession);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch {
      this.memoryStore.set(nextSession.id, nextSession);
    }
  }

  async deleteSession(id: string): Promise<void> {
    this.memoryStore.delete(id);

    if (!canUseIndexedDB()) {
      return;
    }

    const db = await this.openDb();

    if (!db) {
      return;
    }

    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  private async getById(id: string): Promise<PersistedMultipartUpload | null> {
    if (!canUseIndexedDB()) {
      return this.memoryStore.get(id) ?? null;
    }

    const db = await this.openDb();

    if (!db) {
      return this.memoryStore.get(id) ?? null;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result ?? this.memoryStore.get(id) ?? null);
      request.onerror = () => resolve(this.memoryStore.get(id) ?? null);
    });
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (!canUseIndexedDB()) {
      return Promise.resolve(null);
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });

    return this.dbPromise;
  }
}

export const multipartUploadStore = new MultipartUploadStore();
