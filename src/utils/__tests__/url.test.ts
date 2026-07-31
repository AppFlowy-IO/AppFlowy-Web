import { parseAppFlowyPageLink, workspaceIdFromAppPathname } from '@/utils/url';

const workspaceId = '3df0c6bb-417f-4f81-939a-c6114f160f9a';
const viewId = '5d62b705-fee1-43c5-bd20-75a40aef254d';

describe('parseAppFlowyPageLink', () => {
  it('resolves a database page on the current AppFlowy host', () => {
    expect(parseAppFlowyPageLink(`http://localhost:3000/app/${workspaceId}/${viewId}`, 'localhost')).toEqual({
      workspaceId,
      viewId,
    });
  });

  it('preserves a block target on an internal page link', () => {
    expect(
      parseAppFlowyPageLink(
        `https://beta.appflowy.cloud/app/${workspaceId}/${viewId}?blockId=paragraph-1`,
        'beta.appflowy.cloud'
      )
    ).toEqual({
      workspaceId,
      viewId,
      blockId: 'paragraph-1',
    });
  });

  it('does not treat another AppFlowy installation as a local page mention', () => {
    expect(
      parseAppFlowyPageLink(`https://other.appflowy.cloud/app/${workspaceId}/${viewId}`, 'beta.appflowy.cloud')
    ).toBeUndefined();
  });

  it('rejects a link with a row target that a page mention cannot represent', () => {
    expect(
      parseAppFlowyPageLink(`http://localhost:3000/app/${workspaceId}/${viewId}?r=row-1`, 'localhost')
    ).toBeUndefined();
  });

  it('rejects a link with a database tab selection that a page mention cannot represent', () => {
    expect(
      parseAppFlowyPageLink(`http://localhost:3000/app/${workspaceId}/${viewId}?v=${viewId}`, 'localhost')
    ).toBeUndefined();
  });
});

describe('workspaceIdFromAppPathname', () => {
  it('extracts the workspace id from a page route', () => {
    expect(workspaceIdFromAppPathname(`/app/${workspaceId}/${viewId}`)).toBe(workspaceId);
  });

  it('extracts the workspace id from a workspace root route', () => {
    expect(workspaceIdFromAppPathname(`/app/${workspaceId}`)).toBe(workspaceId);
  });

  it('returns undefined for non-workspace app routes', () => {
    expect(workspaceIdFromAppPathname('/app/trash')).toBeUndefined();
    expect(workspaceIdFromAppPathname('/')).toBeUndefined();
  });
});
