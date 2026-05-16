/*
 * AppFlowy IndexedDB export helper.
 *
 * Usage:
 * 1. Open https://appflowy.com in the browser profile that has the data.
 * 2. Open DevTools Console.
 * 3. Paste this whole file and press Enter.
 *
 * The script exports all IndexedDB databases visible to the current origin into
 * a zip file. It is self-contained and does not load third-party libraries.
 */
(async () => {
  const ZIP_FILE_PREFIX = 'appflowy-indexeddb-export';
  const textEncoder = new TextEncoder();

  function assertBrowserSupport() {
    if (!globalThis.indexedDB) {
      throw new Error('IndexedDB is not available in this browser context.');
    }

    if (!globalThis.Blob || !globalThis.URL || !document?.createElement) {
      throw new Error('Blob download APIs are not available in this browser context.');
    }
  }

  function timestampForFilename() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  function safePathSegment(value) {
    const text = String(value || 'unnamed');
    const safe = text.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 160);

    return safe || 'unnamed';
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);

      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  async function valueToJsonSafe(value, seen = new WeakSet()) {
    if (value === undefined) {
      return { __type: 'Undefined' };
    }

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'bigint') {
      return { __type: 'BigInt', value: value.toString() };
    }

    if (typeof value === 'symbol' || typeof value === 'function') {
      return { __type: typeof value, value: String(value) };
    }

    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }

    if (value instanceof ArrayBuffer) {
      return {
        __type: 'ArrayBuffer',
        byteLength: value.byteLength,
        base64: bytesToBase64(new Uint8Array(value)),
      };
    }

    if (ArrayBuffer.isView(value)) {
      const view = value;
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

      return {
        __type: view.constructor?.name || 'TypedArray',
        byteOffset: view.byteOffset,
        byteLength: view.byteLength,
        base64: bytesToBase64(bytes),
      };
    }

    if (value instanceof Blob) {
      const isFile = typeof File !== 'undefined' && value instanceof File;
      const bytes = new Uint8Array(await value.arrayBuffer());

      return {
        __type: isFile ? 'File' : 'Blob',
        name: isFile ? value.name : undefined,
        type: value.type,
        size: value.size,
        lastModified: isFile ? value.lastModified : undefined,
        base64: bytesToBase64(bytes),
      };
    }

    if (typeof value === 'object') {
      if (seen.has(value)) {
        return { __type: 'CircularReference' };
      }

      seen.add(value);

      if (Array.isArray(value)) {
        return Promise.all(value.map((item) => valueToJsonSafe(item, seen)));
      }

      if (value instanceof Map) {
        const entries = [];

        for (const [entryKey, entryValue] of value.entries()) {
          entries.push({
            key: await valueToJsonSafe(entryKey, seen),
            value: await valueToJsonSafe(entryValue, seen),
          });
        }

        return { __type: 'Map', entries };
      }

      if (value instanceof Set) {
        const values = [];

        for (const item of value.values()) {
          values.push(await valueToJsonSafe(item, seen));
        }

        return { __type: 'Set', values };
      }

      const output = {};

      for (const [key, childValue] of Object.entries(value)) {
        output[key] = await valueToJsonSafe(childValue, seen);
      }

      return output;
    }

    return String(value);
  }

  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Failed to open IndexedDB database: ${name}`));
      request.onblocked = () => reject(new Error(`Opening IndexedDB database was blocked: ${name}`));
    });
  }

  function readStoreSchema(db, storeName) {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);

    return {
      name: store.name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: Array.from(store.indexNames).map((indexName) => {
        const index = store.index(indexName);

        return {
          name: index.name,
          keyPath: index.keyPath,
          multiEntry: index.multiEntry,
          unique: index.unique,
        };
      }),
    };
  }

  function readStoreRecords(db, storeName) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const records = [];
      const request = store.openCursor();
      let pendingSerialization = Promise.resolve();

      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          pendingSerialization.then(() => resolve(records)).catch(reject);
          return;
        }

        const key = cursor.key;
        const value = cursor.value;

        pendingSerialization = pendingSerialization.then(async () => {
          records.push({
            key: await valueToJsonSafe(key),
            value: await valueToJsonSafe(value),
          });
        });

        cursor.continue();
      };

      request.onerror = () => reject(request.error || new Error(`Failed to read object store: ${storeName}`));
      transaction.onerror = () =>
        reject(transaction.error || new Error(`IndexedDB transaction failed while reading: ${storeName}`));
    });
  }

  async function listDatabaseInfos() {
    if (typeof indexedDB.databases === 'function') {
      const databaseInfos = await indexedDB.databases();

      return databaseInfos.filter((info) => info.name);
    }

    const manualNames = prompt(
      'This browser does not expose indexedDB.databases(). Enter comma-separated IndexedDB database names to export.'
    );

    return String(manualNames || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }

  async function exportDatabase(databaseInfo, files, manifest) {
    const dbName = databaseInfo.name;
    const dbPath = `databases/${safePathSegment(dbName)}`;
    const db = await openDatabase(dbName);

    try {
      const storeNames = Array.from(db.objectStoreNames);
      const databaseManifest = {
        name: dbName,
        version: db.version,
        objectStores: [],
      };

      manifest.databases.push(databaseManifest);

      for (const storeName of storeNames) {
        console.info(`[AppFlowy IndexedDB Export] Reading ${dbName}/${storeName}`);
        const storePath = `${dbPath}/stores/${safePathSegment(storeName)}.json`;
        const schema = readStoreSchema(db, storeName);
        const records = await readStoreRecords(db, storeName);

        databaseManifest.objectStores.push({
          name: storeName,
          recordCount: records.length,
          path: storePath,
          schema,
        });

        files.push({
          path: storePath,
          data: JSON.stringify({ schema, records }, null, 2),
        });
      }
    } finally {
      db.close();
    }
  }

  function makeCrc32Table() {
    const table = new Uint32Array(256);

    for (let i = 0; i < 256; i += 1) {
      let crc = i;

      for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }

      table[i] = crc >>> 0;
    }

    return table;
  }

  const crc32Table = makeCrc32Table();

  function crc32(bytes) {
    let crc = 0xffffffff;

    for (let i = 0; i < bytes.length; i += 1) {
      crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(date.getFullYear(), 1980);
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

    return { dosDate, dosTime };
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    const view = new DataView(bytes.buffer);

    view.setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);

    view.setUint32(0, value >>> 0, true);
    return bytes;
  }

  function toBytes(value) {
    return value instanceof Uint8Array ? value : textEncoder.encode(value);
  }

  function createZip(files) {
    const parts = [];
    const centralDirectory = [];
    let offset = 0;
    const { dosDate, dosTime } = dosDateTime(new Date());
    const pushParts = (target, nextParts) => {
      for (const part of nextParts) {
        target.push(part);
      }
    };

    for (const file of files) {
      const nameBytes = textEncoder.encode(file.path);
      const dataBytes = toBytes(file.data);
      const checksum = crc32(dataBytes);
      const localHeader = [
        uint32(0x04034b50),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(checksum),
        uint32(dataBytes.length),
        uint32(dataBytes.length),
        uint16(nameBytes.length),
        uint16(0),
        nameBytes,
      ];

      pushParts(parts, localHeader);
      parts.push(dataBytes);

      centralDirectory.push(
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(checksum),
        uint32(dataBytes.length),
        uint32(dataBytes.length),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes
      );

      offset += localHeader.reduce((sum, part) => sum + part.length, 0) + dataBytes.length;
    }

    const centralDirectoryOffset = offset;
    const centralDirectorySize = centralDirectory.reduce((sum, part) => sum + part.length, 0);

    pushParts(parts, centralDirectory);
    pushParts(parts, [
      uint32(0x06054b50),
      uint16(0),
      uint16(0),
      uint16(files.length),
      uint16(files.length),
      uint32(centralDirectorySize),
      uint32(centralDirectoryOffset),
      uint16(0)
    ]);

    return new Blob(parts, { type: 'application/zip' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  assertBrowserSupport();

  const files = [];
  const manifest = {
    exportedAt: new Date().toISOString(),
    origin: location.origin,
    href: location.href,
    userAgent: navigator.userAgent,
    databases: [],
  };
  const databaseInfos = await listDatabaseInfos();

  if (databaseInfos.length === 0) {
    throw new Error('No IndexedDB databases were found for this origin.');
  }

  console.info(`[AppFlowy IndexedDB Export] Exporting ${databaseInfos.length} database(s).`);

  for (const databaseInfo of databaseInfos) {
    await exportDatabase(databaseInfo, files, manifest);
  }

  files.unshift({
    path: 'manifest.json',
    data: JSON.stringify(manifest, null, 2),
  });

  const zipBlob = createZip(files);
  const filename = `${ZIP_FILE_PREFIX}-${safePathSegment(location.hostname)}-${timestampForFilename()}.zip`;

  downloadBlob(zipBlob, filename);
  console.info(`[AppFlowy IndexedDB Export] Download started: ${filename}`);
})().catch((error) => {
  console.error('[AppFlowy IndexedDB Export] Failed to export IndexedDB data:', error);
});
