import { getConnectionAccessToken } from '@/application/services/domains/integration';
import { getConfigValue } from '@/utils/runtime-config';

import { DriveFile } from './google-drive';

interface PickerDocument {
  id?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastEditedUtc?: number;
}
interface PickerResponse {
  action: string;
  docs?: PickerDocument[];
}
interface Picker {
  setVisible(visible: boolean): void;
  dispose(): void;
}
interface DocsView {
  setIncludeFolders(value: boolean): DocsView;
  setSelectFolderEnabled(value: boolean): DocsView;
  setMimeTypes(value: string): DocsView;
}
interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setSize(width: number, height: number): PickerBuilder;
  setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
  build(): Picker;
}
interface PickerAPI {
  DocsView: new () => DocsView;
  PickerBuilder: new () => PickerBuilder;
  Feature: { SUPPORT_DRIVES: string };
  Action: { PICKED: string; CANCEL: string };
}
type GoogleWindow = Window & {
  google?: { picker?: PickerAPI };
  gapi?: { load: (name: string, options: { callback: () => void; onerror: () => void }) => void };
};

// Same formats as Flutter's google_drive_picker_server.dart. Folders are shown
// for navigation, never accepted as an embedded document. Archives/Vids are omitted.
const mimeTypes = [
  ...['document', 'spreadsheet', 'presentation', 'drawing', 'form', 'script', 'folder', 'site', 'file'].map(
    (type) => `application/vnd.google-apps.${type}`
  ),
  ...['png', 'jpeg', 'gif', 'webp', 'bmp', 'svg+xml'].map((type) => `image/${type}`),
  ...['mp4', 'webm', 'quicktime', 'mpeg'].map((type) => `video/${type}`),
  ...['mpeg', 'wav', 'ogg', 'mp4'].map((type) => `audio/${type}`),
  ...['plain', 'html', 'csv', 'markdown', 'rtf'].map((type) => `text/${type}`),
  ...[
    'pdf',
    'msword',
    'vnd.openxmlformats-officedocument.wordprocessingml.document',
    'vnd.ms-excel',
    'vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'vnd.ms-powerpoint',
    'vnd.openxmlformats-officedocument.presentationml.presentation',
    'json',
    'xml',
    'rtf',
  ].map((type) => `application/${type}`),
].join(',');

let sdk: Promise<PickerAPI> | undefined;

/** Lazy shared SDK loading; a blocked/failed script can be retried. No credentials here. */
export function loadGoogleDrivePicker(): Promise<PickerAPI> {
  const host = window as GoogleWindow;

  if (host.google?.picker) return Promise.resolve(host.google.picker);
  if (sdk) return sdk;
  sdk = new Promise<PickerAPI>((resolve, reject) => {
    let script: HTMLScriptElement | undefined;
    let finished = false;
    const finish = (api?: PickerAPI) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      if (script) {
        script.onload = null;
        script.onerror = null;
      }

      if (api) resolve(api);
      else {
        script?.remove();
        reject(new Error('Unable to load Google Picker'));
      }
    };

    const timeout = window.setTimeout(() => finish(), 30_000);
    const loadModule = () => {
      if (finished) return;
      try {
        if (!host.gapi) {
          finish();
          return;
        }

        host.gapi.load('picker', { callback: () => finish(host.google?.picker), onerror: () => finish() });
      } catch {
        finish();
      }
    };

    if (host.gapi) loadModule();
    else {
      script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.onload = loadModule;
      script.onerror = () => finish();
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    sdk = undefined;
    throw error;
  });
  return sdk;
}

/** Owns one account-bound picker. Abort disposes its iframe and ignores late callbacks. */
export async function openGoogleDrivePicker({
  workspaceId,
  connectionId,
  signal,
  onSelect,
  onCancel,
}: {
  workspaceId: string;
  connectionId: string;
  signal: AbortSignal;
  onSelect: (file: DriveFile) => void;
  onCancel: () => void;
}): Promise<void> {
  const [api, token] = await Promise.all([
    loadGoogleDrivePicker(),
    getConnectionAccessToken(workspaceId, connectionId, signal),
  ]);

  if (signal.aborted) return;
  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', dispose);
    picker.dispose();
  };

  const callback = (response: PickerResponse) => {
    if (closed || signal.aborted) return;
    if (response.action === api.Action.CANCEL) {
      dispose();
      onCancel();
      return;
    }

    if (response.action !== api.Action.PICKED) return;
    const file = response.docs?.find((doc) => doc.id && doc.mimeType !== 'application/vnd.google-apps.folder');

    if (!file?.id || !file.name || !file.mimeType) return;
    dispose();
    onSelect({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      ...(typeof file.sizeBytes === 'number' ? { size: String(file.sizeBytes) } : {}),
      ...(typeof file.lastEditedUtc === 'number' && Number.isFinite(new Date(file.lastEditedUtc).getTime())
        ? { modifiedTime: new Date(file.lastEditedUtc).toISOString() }
        : {}),
    });
  };

  const view = new api.DocsView().setIncludeFolders(true).setSelectFolderEnabled(false).setMimeTypes(mimeTypes);
  const builder = new api.PickerBuilder()
    .addView(view)
    .enableFeature(api.Feature.SUPPORT_DRIVES)
    .setOAuthToken(token)
    // Public Cloud project number shared with Flutter, not an OAuth client secret.
    .setAppId(getConfigValue('APPFLOWY_GOOGLE_DRIVE_PICKER_APP_ID', '994557425188'))
    .setOrigin(window.location.origin)
    .setSize(Math.min(1280, window.innerWidth - 32), Math.min(720, window.innerHeight - 32))
    .setCallback(callback);
  const developerKey = getConfigValue('APPFLOWY_GOOGLE_DRIVE_PICKER_API_KEY', '');

  if (developerKey) builder.setDeveloperKey(developerKey);
  const picker = builder.build();

  signal.addEventListener('abort', dispose, { once: true });
  try {
    picker.setVisible(true);
  } catch (error) {
    dispose();
    throw error;
  }
}
