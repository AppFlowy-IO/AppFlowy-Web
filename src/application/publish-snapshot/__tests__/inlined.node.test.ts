/** @jest-environment node */

import { peekInlinedPublishSnapshot, releaseInlinedPublishSnapshot } from '@/application/publish-snapshot/inlined';

// The publish-snapshot module is also imported where there is no DOM (tests
// in node, any future server-side use); there it must simply find nothing.
describe('inlined snapshot without a DOM', () => {
  it('peeks nothing and releases without throwing', () => {
    expect(typeof document).toBe('undefined');
    expect(peekInlinedPublishSnapshot('docs', 'page')).toBeUndefined();
    expect(() => releaseInlinedPublishSnapshot()).not.toThrow();
  });
});
