import * as Y from 'yjs';

import {
  captureRowDocRevision,
  hasRowDocRevision,
  shareEquivalentRowDocRevision,
} from '@/application/database-yjs/row-doc-revision';
import { YDoc, YjsEditorKey } from '@/application/types';

jest.mock('lodash-es', () => jest.requireActual('lodash'));

describe('non-owning row value revisions', () => {
  const docs: YDoc[] = [];
  const rowDoc = (value: number) => {
    const doc = new Y.Doc({ guid: 'same-row' }) as YDoc;

    doc.getMap(YjsEditorKey.data_section).set('value', value);
    docs.push(doc);
    return doc;
  };

  afterEach(() => {
    docs.splice(0).forEach((doc) => doc.destroy());
    jest.restoreAllMocks();
  });

  it('requires verified equal content before accepting a replacement with the same guid', () => {
    const seed = rowDoc(100);
    const canonical = rowDoc(100);
    const captured = captureRowDocRevision(seed);

    expect(hasRowDocRevision(canonical, captured)).toBe(false);
    shareEquivalentRowDocRevision(seed, canonical);
    expect(hasRowDocRevision(canonical, captured)).toBe(true);
    expect(hasRowDocRevision(seed, captured)).toBe(true);
  });

  it('keeps an unchanged canonical sibling valid when the old seed changes', () => {
    const seed = rowDoc(100);
    const canonical = rowDoc(100);
    const captured = captureRowDocRevision(seed);

    shareEquivalentRowDocRevision(seed, canonical);
    seed.getMap(YjsEditorKey.data_section).set('value', 200);
    expect(hasRowDocRevision(seed, captured)).toBe(false);
    expect(hasRowDocRevision(canonical, captured)).toBe(true);

    const changedSeed = captureRowDocRevision(seed);

    shareEquivalentRowDocRevision(seed, canonical);
    expect(hasRowDocRevision(canonical, changedSeed)).toBe(false);
  });

  it('invalidates an entry captured from the seed when the canonical sibling changes', () => {
    const seed = rowDoc(100);
    const canonical = rowDoc(100);
    const captured = captureRowDocRevision(seed);

    shareEquivalentRowDocRevision(seed, canonical);
    canonical.getMap(YjsEditorKey.data_section).set('value', 200);
    expect(hasRowDocRevision(canonical, captured)).toBe(false);
    expect(hasRowDocRevision(seed, captured)).toBe(true);
    shareEquivalentRowDocRevision(seed, canonical);
    expect(hasRowDocRevision(canonical, captured)).toBe(false);
  });

  it('invalidates delete-only updates even when their state vector is unchanged', () => {
    const seed = rowDoc(100);
    const canonical = rowDoc(100);
    const captured = captureRowDocRevision(seed);

    shareEquivalentRowDocRevision(seed, canonical);
    const stateVector = Y.encodeStateVector(canonical);

    canonical.getMap(YjsEditorKey.data_section).delete('value');
    expect(Y.encodeStateVector(canonical)).toEqual(stateVector);
    expect(hasRowDocRevision(canonical, captured)).toBe(false);
  });

  it('rejects destroyed documents and their old generations', () => {
    const seed = rowDoc(100);
    const canonical = rowDoc(100);
    const captured = captureRowDocRevision(seed);

    shareEquivalentRowDocRevision(seed, canonical);
    canonical.destroy();
    expect(hasRowDocRevision(canonical, captured)).toBe(false);
    shareEquivalentRowDocRevision(seed, canonical);
    expect(hasRowDocRevision(canonical, captured)).toBe(false);
  });

  it('compares BigInt-backed values exactly without serializing them to strings', () => {
    const seed = rowDoc(100);
    const canonical = rowDoc(100);
    const different = rowDoc(100);
    const captured = captureRowDocRevision(seed);

    jest.spyOn(seed.getMap(YjsEditorKey.data_section), 'toJSON').mockReturnValue({ value: 100n });
    jest.spyOn(canonical.getMap(YjsEditorKey.data_section), 'toJSON').mockReturnValue({ value: 100n });
    jest.spyOn(different.getMap(YjsEditorKey.data_section), 'toJSON').mockReturnValue({ value: '100n' });
    shareEquivalentRowDocRevision(seed, canonical);
    shareEquivalentRowDocRevision(seed, different);
    expect(hasRowDocRevision(canonical, captured)).toBe(true);
    expect(hasRowDocRevision(different, captured)).toBe(false);
  });

  it('supports repeated and transitive adoption without cycling old tokens', () => {
    const first = rowDoc(100);
    const second = rowDoc(100);
    const third = rowDoc(100);
    const captured = captureRowDocRevision(first);

    shareEquivalentRowDocRevision(first, second);
    shareEquivalentRowDocRevision(second, third);
    shareEquivalentRowDocRevision(third, first);
    expect(hasRowDocRevision(third, captured)).toBe(true);
    third.getMap(YjsEditorKey.data_section).set('value', 200);
    expect(hasRowDocRevision(third, captured)).toBe(false);
    expect(hasRowDocRevision(second, captured)).toBe(true);
  });
});
