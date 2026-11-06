import { getConnectionAccessToken } from '@/application/services/domains/integration';

import { loadGoogleDrivePicker, openGoogleDrivePicker } from '../google-drive-picker';

jest.mock('@/application/services/domains/integration', () => ({ getConnectionAccessToken: jest.fn() }));

const host = window as unknown as { google?: { picker: unknown }; gapi?: unknown };
const callbacks: Array<(value: unknown) => void> = [];
const visible = jest.fn();
const dispose = jest.fn();
const view = {
  setIncludeFolders: jest.fn().mockReturnThis(),
  setSelectFolderEnabled: jest.fn().mockReturnThis(),
  setMimeTypes: jest.fn().mockReturnThis(),
};
const builder = {
  addView: jest.fn().mockReturnThis(),
  enableFeature: jest.fn().mockReturnThis(),
  setOAuthToken: jest.fn().mockReturnThis(),
  setAppId: jest.fn().mockReturnThis(),
  setOrigin: jest.fn().mockReturnThis(),
  setSize: jest.fn().mockReturnThis(),
  setDeveloperKey: jest.fn().mockReturnThis(),
  setCallback: jest.fn((callback) => {
    callbacks.push(callback);
    return builder;
  }),
  build: jest.fn(() => ({ setVisible: visible, dispose })),
};
const sdk = {
  DocsView: jest.fn(() => view),
  PickerBuilder: jest.fn(() => builder),
  Feature: { SUPPORT_DRIVES: 'supportDrives' },
  Action: { PICKED: 'picked', CANCEL: 'cancel' },
};
const file = {
  id: 'private-file',
  name: 'Roadmap',
  mimeType: 'application/vnd.google-apps.document',
  sizeBytes: 2632,
  lastEditedUtc: 1793491200000,
};
let controller: AbortController;
let options: Parameters<typeof openGoogleDrivePicker>[0];

beforeEach(() => {
  jest.clearAllMocks();
  callbacks.length = 0;
  host.google = { picker: sdk };
  controller = new AbortController();
  options = {
    workspaceId: 'workspace',
    connectionId: 'work',
    signal: controller.signal,
    onSelect: jest.fn(),
    onCancel: jest.fn(),
  };
  jest.mocked(getConnectionAccessToken).mockResolvedValue('test-token');
});
afterEach(() => {
  controller.abort();
  delete host.google;
  delete host.gapi;
});

it('opens the selected account using Flutter configuration, with folders navigable but not selectable', async () => {
  await openGoogleDrivePicker(options);
  expect(getConnectionAccessToken).toHaveBeenCalledWith('workspace', 'work', controller.signal);
  expect(builder.setOAuthToken).toHaveBeenCalledWith('test-token');
  expect(builder.setAppId).toHaveBeenCalledWith('994557425188');
  expect(builder.enableFeature).toHaveBeenCalledWith('supportDrives');
  expect(view.setIncludeFolders).toHaveBeenCalledWith(true);
  expect(view.setSelectFolderEnabled).toHaveBeenCalledWith(false);
  expect(view.setMimeTypes.mock.calls[0][0]).not.toContain('application/vnd.google-apps.vid');
  expect(visible).toHaveBeenCalledWith(true);
  callbacks[0]({ action: 'picked', docs: [{ ...file, mimeType: 'application/vnd.google-apps.folder' }] });
  expect(options.onSelect).not.toHaveBeenCalled();
  callbacks[0]({ action: 'picked', docs: [file] });
  expect(options.onSelect).toHaveBeenCalledWith({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: '2632',
    modifiedTime: new Date(file.lastEditedUtc).toISOString(),
  });
  expect(dispose).toHaveBeenCalledTimes(1);
  callbacks[0]({ action: 'picked', docs: [file] });
  expect(options.onSelect).toHaveBeenCalledTimes(1);
});

it('cancels without embedding and disposes the modal exactly once', async () => {
  await openGoogleDrivePicker(options);
  callbacks[0]({ action: 'cancel' });
  controller.abort();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(options.onCancel).toHaveBeenCalledTimes(1);
  expect(options.onSelect).not.toHaveBeenCalled();
});

it('ignores a late callback after the block/account is closed', async () => {
  await openGoogleDrivePicker(options);
  controller.abort();
  callbacks[0]({ action: 'picked', docs: [file] });
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(options.onSelect).not.toHaveBeenCalled();
});

it('does not open a picker after closing during token retrieval', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(getConnectionAccessToken).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const pending = openGoogleDrivePicker(options);
  controller.abort();
  resolve('late-test-token');
  await pending;
  expect(builder.build).not.toHaveBeenCalled();
});

it('shares SDK loading and retries after a blocked script', async () => {
  delete host.google;
  const first = loadGoogleDrivePicker();
  expect(loadGoogleDrivePicker()).toBe(first);
  const script = document.querySelector('script[src="https://apis.google.com/js/api.js"]')!;
  script.dispatchEvent(new Event('error'));
  await expect(first).rejects.toThrow('Unable to load Google Picker');
  const second = loadGoogleDrivePicker();
  const next = document.querySelector('script[src="https://apis.google.com/js/api.js"]')!;
  expect(next).not.toBe(script);
  host.gapi = {
    load: (_: string, { callback }: { callback: () => void }) => {
      host.google = { picker: sdk };
      callback();
    },
  };
  next.dispatchEvent(new Event('load'));
  await expect(second).resolves.toBe(sdk);
  next.remove();
});
