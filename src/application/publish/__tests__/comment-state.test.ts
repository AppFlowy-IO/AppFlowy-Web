import {
  cachePublishCommentsEnabled,
  clearCachedPublishCommentsEnabled,
  getCachedPublishCommentsEnabled,
} from '@/application/publish/comment-state';

const firstViewId = 'comments-view-one';
const secondViewId = 'comments-view-two';

describe('publish comment state', () => {
  beforeEach(() => {
    clearCachedPublishCommentsEnabled(firstViewId);
    clearCachedPublishCommentsEnabled(secondViewId);
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('persists independent values for each page in localStorage', () => {
    cachePublishCommentsEnabled(firstViewId, true);
    cachePublishCommentsEnabled(secondViewId, false);

    expect(getCachedPublishCommentsEnabled(firstViewId)).toBe(true);
    expect(getCachedPublishCommentsEnabled(secondViewId)).toBe(false);
    expect(window.localStorage.getItem(`appflowy:publish-comments:v2:${firstViewId}`)).toBe('1');
    expect(window.localStorage.getItem(`appflowy:publish-comments:v2:${secondViewId}`)).toBe('0');
  });

  it('migrates the previous session-only value to localStorage', () => {
    window.sessionStorage.setItem(`appflowy:publish-comments:v1:${firstViewId}`, '1');

    expect(getCachedPublishCommentsEnabled(firstViewId)).toBe(true);
    expect(window.localStorage.getItem(`appflowy:publish-comments:v2:${firstViewId}`)).toBe('1');
    expect(window.sessionStorage.getItem(`appflowy:publish-comments:v1:${firstViewId}`)).toBeNull();
  });
});
