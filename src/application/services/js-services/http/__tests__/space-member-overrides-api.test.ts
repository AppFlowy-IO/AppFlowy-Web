import { SpaceMemberRole } from '@/application/types';

import {
  addSpaceMember,
  addSpaceMemberByUuid,
  removeSpaceMemberByUuid,
  updateSpaceMemberByUuid,
} from '../workspace-api';

const mockClient = { post: jest.fn(), patch: jest.fn(), delete: jest.fn() };
const uuid = '12345678-1234-4123-8123-123456789abc';

jest.mock('../core', () => ({
  getAxios: () => mockClient,
  executeAPIRequest: async (callback: () => Promise<unknown>) => callback(),
  executeAPIVoidRequest: async (callback: () => Promise<unknown>) => callback(),
}));
jest.mock('../workspace-creation-api', () => ({}));

beforeEach(() => jest.clearAllMocks());

test('UUID create inherits without serializing a default or an override', async () => {
  await addSpaceMemberByUuid('workspace', 'space', uuid, { role: SpaceMemberRole.Member });
  expect(mockClient.post).toHaveBeenCalledWith(
    `/api/workspace/workspace/spaces/space/members/users/${uuid}`,
    { role: 'member' },
    expect.any(Object)
  );
});

test.each([{ role: SpaceMemberRole.Member }, { access_level_override: null }, { access_level_override: 20 }])(
  'preserves omission, null and explicit override: %p',
  async (patch) => {
    await updateSpaceMemberByUuid('workspace', 'space', uuid, patch as never);
    expect(mockClient.patch).toHaveBeenCalledWith(
      `/api/workspace/workspace/spaces/space/members/users/${uuid}`,
      patch,
      expect.any(Object)
    );
  }
);

test('deletes by the exact UUID and rejects an imprecise numeric substitute', async () => {
  await removeSpaceMemberByUuid('workspace', 'space', uuid);
  expect(mockClient.delete).toHaveBeenCalledWith(`/api/workspace/workspace/spaces/space/members/users/${uuid}`);
  await expect(
    updateSpaceMemberByUuid('workspace', 'space', '9223372036854775806', { role: SpaceMemberRole.Owner })
  ).rejects.toThrow();
  expect(mockClient.patch).not.toHaveBeenCalled();
});

test('the legacy serializer retains exact decimal UID and explicit null without stringifying undefined', async () => {
  await addSpaceMember('workspace', 'space', {
    uid: '9223372036854775806',
    role: SpaceMemberRole.Member,
    access_level: 30,
    access_level_override: null,
  });
  expect(mockClient.post.mock.calls[0][1]).toBe(
    '{"uid":9223372036854775806,"role":"member","access_level":30,"access_level_override":null}'
  );
});
