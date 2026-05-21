import { parseAppFlowyBlockLink, getSingleURLTextFromClipboardData } from '../appflowy-block-link';

function createClipboardData(data: Record<string, string>): Pick<DataTransfer, 'getData'> {
  return {
    getData: jest.fn((type: string) => data[type] ?? ''),
  };
}

describe('withPasted AppFlowy block link support', () => {
  const blockLink =
    'https://test.appflowy.com/app/6f79bb5a-d432-4155-84a0-2e5c44f2cd51/21191004-0b3d-497e-b17c-ac65fa82c78a?blockId=wsZx6I';

  it('parses desktop copy-link-to-block URLs by AppFlowy route shape, independent of host', () => {
    expect(parseAppFlowyBlockLink(blockLink)).toEqual({
      pageId: '21191004-0b3d-497e-b17c-ac65fa82c78a',
      blockId: 'wsZx6I',
    });
  });

  it('reads a single AppFlowy block link from URI clipboard formats before HTML paste handling', () => {
    expect(
      getSingleURLTextFromClipboardData(
        createClipboardData({
          'text/uri-list': blockLink,
          'text/html': `<ul><li><a href="${blockLink}"></a></li></ul>`,
        })
      )
    ).toBe(blockLink);
  });

  it('ignores AppFlowy page URLs without blockId', () => {
    expect(
      parseAppFlowyBlockLink(
        'https://test.appflowy.com/app/6f79bb5a-d432-4155-84a0-2e5c44f2cd51/21191004-0b3d-497e-b17c-ac65fa82c78a'
      )
    ).toBeNull();
  });
});
