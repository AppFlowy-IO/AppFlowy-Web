import { TextEncoder } from 'util';

import { getAxios } from '../core';
import { getPublishConfig, patchPublishConfig, publishCollabs, PublishCollabMetadata } from '../publish-api';

jest.mock('../core', () => ({
  getAxios: jest.fn(),
  executeAPIRequest: jest.fn(async (request: () => Promise<{ data: { data: unknown } }>) => {
    const response = await request();

    return response.data.data;
  }),
}));

describe('publishing configuration wire contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.TextEncoder = TextEncoder;
  });

  it('reads private config and returns the complete result of a partial PATCH', async () => {
    const initial = { comments_enabled: true, duplicate_enabled: false };
    const saved = { comments_enabled: false, duplicate_enabled: false };
    const get = jest.fn().mockResolvedValue({ data: { data: initial } });
    const patch = jest.fn().mockResolvedValue({ data: { data: saved } });

    jest.mocked(getAxios).mockReturnValue({ get, patch } as never);

    await expect(getPublishConfig('workspace', 'view')).resolves.toEqual(initial);
    await expect(patchPublishConfig('workspace', 'view', { comments_enabled: false })).resolves.toEqual(saved);
    expect(get).toHaveBeenCalledWith('/api/workspace/workspace/publish/view/config');
    expect(patch).toHaveBeenCalledWith('/api/workspace/workspace/publish/view/config', { comments_enabled: false });
  });

  it.each([undefined, true, false])(
    'encodes comments=%s atomically with binary publication content',
    async (enabled) => {
      const post = jest.fn().mockResolvedValue({ data: { code: 0 } });

      jest.mocked(getAxios).mockReturnValue({ post } as never);
      const meta: PublishCollabMetadata = {
        view_id: 'view',
        publish_name: 'page',
        config: enabled === undefined ? undefined : { comments_enabled: enabled },
        metadata: {
          view: {
            view_id: 'view',
            name: 'Page',
            layout: 1,
            icon: null,
            extra: null,
            created_by: null,
            last_edited_by: null,
            last_edited_time: 0,
            created_at: 0,
            child_views: null,
          },
          child_views: [],
          ancestor_views: [],
        },
      };
      const data = new Uint8Array([1, 2, 3]);

      await publishCollabs('workspace', [{ meta, data }]);

      const body = post.mock.calls[0][1] as Uint8Array;
      const frame = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const metadataLength = frame.getUint32(0, true);
      const decoded = JSON.parse(Buffer.from(body.slice(4, 4 + metadataLength)).toString('utf8'));

      expect(decoded.config).toEqual(enabled === undefined ? undefined : { comments_enabled: enabled });
      expect(frame.getUint32(4 + metadataLength, true)).toBe(data.length);
      expect(body.slice(8 + metadataLength, 8 + metadataLength + data.length)).toEqual(data);
      expect(frame.getUint32(8 + metadataLength + data.length, true)).toBe(0);
      expect(post).toHaveBeenCalledTimes(1);
    }
  );
});
