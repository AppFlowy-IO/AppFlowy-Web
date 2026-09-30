import {
  publishedDatabasePayload,
  publishedDocumentPayload,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import {
  INLINED_PUBLISH_SNAPSHOT_ID,
  peekInlinedPublishSnapshot,
  releaseInlinedPublishSnapshot,
} from '@/application/publish-snapshot/inlined';

const { namespace, publishName } = publishedDocumentPayload;

/** Emits the block the way deploy/html.ts does: a JSON data script after #root. */
const inline = (value: unknown, text = JSON.stringify(value)) => {
  const script = document.createElement('script');

  script.type = 'application/json';
  script.id = INLINED_PUBLISH_SNAPSHOT_ID;
  script.textContent = text;
  document.body.appendChild(script);
};

const inlinedBlock = () => document.getElementById(INLINED_PUBLISH_SNAPSHOT_ID);

describe('peekInlinedPublishSnapshot', () => {
  beforeEach(() => {
    releaseInlinedPublishSnapshot();
  });

  it('returns undefined when nothing is inlined', () => {
    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });

  it('returns the normalized snapshot for the matching page', () => {
    inline(publishedDocumentPayload);

    const snapshot = peekInlinedPublishSnapshot(namespace, publishName);

    expect(snapshot?.view.name).toBe('Published document');
    // Normalization fills collections the payload omitted.
    expect(snapshot?.view.childViews).toEqual([]);
  });

  it('normalizes database snapshots too', () => {
    inline(publishedDatabasePayload);

    expect(
      peekInlinedPublishSnapshot(publishedDatabasePayload.namespace, publishedDatabasePayload.publishName)?.kind
    ).toBe('database');
  });

  it('is side-effect free: repeated peeks return the same parsed snapshot', () => {
    // A render React discards (a suspended first mount, StrictMode) peeks again
    // and must still find the snapshot.
    inline(publishedDocumentPayload);

    const first = peekInlinedPublishSnapshot(namespace, publishName);

    expect(first).toBeDefined();
    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBe(first);
    expect(inlinedBlock()).not.toBeNull();
  });

  it('parses the block only once', () => {
    inline(publishedDocumentPayload);

    const parse = jest.spyOn(JSON, 'parse');

    try {
      peekInlinedPublishSnapshot(namespace, publishName);
      peekInlinedPublishSnapshot(namespace, publishName);
      peekInlinedPublishSnapshot(namespace, 'other');

      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });

  it('ignores a snapshot for a different page without discarding it', () => {
    inline(publishedDocumentPayload);

    expect(peekInlinedPublishSnapshot(namespace, 'other')).toBeUndefined();
    expect(peekInlinedPublishSnapshot('other', publishName)).toBeUndefined();
    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeDefined();
  });

  it('round-trips text the server escapes for embedding in a script element', () => {
    // deploy/html.ts writes <, >, & and U+2028/U+2029 as \uXXXX escapes. The
    // two separators are built from code points so this source never holds
    // the raw characters.
    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);
    const name = `</script><!-- & ${lineSeparator}${paragraphSeparator}`;
    const payload = { ...publishedDocumentPayload, view: { ...publishedDocumentPayload.view, name } };
    const escaped = JSON.stringify(payload)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .split(lineSeparator)
      .join('\\u2028')
      .split(paragraphSeparator)
      .join('\\u2029');

    expect(escaped).not.toMatch(/[<>&]/);
    inline(payload, escaped);

    expect(peekInlinedPublishSnapshot(namespace, publishName)?.view.name).toBe(name);
  });

  it('returns undefined for a block that is not valid JSON', () => {
    inline(undefined, '{ not json');

    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });

  it('returns undefined for an empty block', () => {
    inline(undefined, '');

    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });

  it.each([
    null,
    'x',
    42,
    [],
    {},
    { ...publishedDocumentPayload, schemaVersion: '1' },
    { ...publishedDocumentPayload, kind: 'whiteboard' },
    { ...publishedDocumentPayload, view: undefined },
    { ...publishedDocumentPayload, namespace: 42 },
  ])('rejects malformed value %p', (value) => {
    inline(value);

    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });
});

describe('releaseInlinedPublishSnapshot', () => {
  beforeEach(() => {
    releaseInlinedPublishSnapshot();
  });

  it('removes the block from the DOM and makes later peeks find nothing', () => {
    inline(publishedDocumentPayload);
    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeDefined();

    releaseInlinedPublishSnapshot();

    expect(inlinedBlock()).toBeNull();
    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });

  it('works when the block was never read', () => {
    inline(publishedDocumentPayload);

    releaseInlinedPublishSnapshot();

    expect(inlinedBlock()).toBeNull();
    expect(peekInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });

  it('is a no-op when nothing is inlined', () => {
    expect(() => releaseInlinedPublishSnapshot()).not.toThrow();
  });
});
