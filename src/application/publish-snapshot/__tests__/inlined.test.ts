import {
  publishedDatabasePayload,
  publishedDocumentPayload,
} from '@/application/publish-snapshot/__fixtures__/published-page-snapshots';
import { takeInlinedPublishSnapshot } from '@/application/publish-snapshot/inlined';

const { namespace, publishName } = publishedDocumentPayload;

describe('takeInlinedPublishSnapshot', () => {
  beforeEach(() => {
    delete window.__APPFLOWY_PUBLISH_SNAPSHOT__;
  });

  it('returns undefined when nothing is inlined', () => {
    expect(takeInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });

  it('returns the normalized snapshot for the matching page', () => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = publishedDocumentPayload;

    const snapshot = takeInlinedPublishSnapshot(namespace, publishName);

    expect(snapshot?.view.name).toBe('Published document');
    // Normalization fills collections the payload omitted.
    expect(snapshot?.view.childViews).toEqual([]);
  });

  it('normalizes database snapshots too', () => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = publishedDatabasePayload;

    expect(
      takeInlinedPublishSnapshot(publishedDatabasePayload.namespace, publishedDatabasePayload.publishName)?.kind
    ).toBe('database');
  });

  it('can be taken only once', () => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = publishedDocumentPayload;

    expect(takeInlinedPublishSnapshot(namespace, publishName)).toBeDefined();
    expect(takeInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
  });

  it('ignores and clears a snapshot for a different page', () => {
    window.__APPFLOWY_PUBLISH_SNAPSHOT__ = publishedDocumentPayload;

    expect(takeInlinedPublishSnapshot(namespace, 'other')).toBeUndefined();
    expect(takeInlinedPublishSnapshot('other', publishName)).toBeUndefined();
    expect(window.__APPFLOWY_PUBLISH_SNAPSHOT__).toBeUndefined();
  });

  it.each([null, 'x', 42, [], {}, { ...publishedDocumentPayload, schemaVersion: '1' }])(
    'rejects malformed value %p',
    (value) => {
      window.__APPFLOWY_PUBLISH_SNAPSHOT__ = value;

      expect(takeInlinedPublishSnapshot(namespace, publishName)).toBeUndefined();
    }
  );
});
