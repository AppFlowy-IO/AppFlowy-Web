import { expect, Page } from '@playwright/test';

/** Stub only Google's SDK boundary. AppFlowy's token API, picker lifecycle,
 * popover focus, metadata fetch and editor mutation all execute normally. */
export async function mockGooglePicker(page: Page) {
  await page.route('https://apis.google.com/js/api.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `(${pickerSDK.toString()})();`,
    })
  );
}

function pickerSDK() {
  const host = window as any;
  class DocsView {
    folders = false;
    selectFolders = true;
    mimeTypes = '';
    setIncludeFolders(value: boolean) {
      this.folders = value;
      return this;
    }
    setSelectFolderEnabled(value: boolean) {
      this.selectFolders = value;
      return this;
    }
    setMimeTypes(value: string) {
      this.mimeTypes = value;
      return this;
    }
  }
  class PickerBuilder {
    callback = (_: unknown) => {};
    config: Record<string, unknown> = {};
    addView(view: DocsView) {
      this.config.view = view;
      return this;
    }
    enableFeature(feature: string) {
      this.config.feature = feature;
      return this;
    }
    setOAuthToken(token: string) {
      this.config.token = token;
      return this;
    }
    setAppId(id: string) {
      this.config.appId = id;
      return this;
    }
    setDeveloperKey(_: string) {
      return this;
    }
    setOrigin(origin: string) {
      this.config.origin = origin;
      return this;
    }
    setSize(width: number, height: number) {
      this.config.size = [width, height];
      return this;
    }
    setCallback(callback: (value: unknown) => void) {
      this.callback = callback;
      return this;
    }
    build() {
      const dialog = document.createElement('div');
      const backdrop = document.createElement('div');
      const frame = document.createElement('iframe');
      const config = this.config;
      host.__googlePickerConfig = config;
      dialog.className = 'picker-dialog';
      dialog.style.cssText = 'position:fixed;inset:32px;background:white;color:black;';
      backdrop.className = 'picker-dialog-bg';
      backdrop.style.cssText = 'position:fixed;inset:0;background:#0008;';
      frame.title = 'Google Drive file picker';
      frame.style.cssText = 'width:100%;height:100%;border:0;';
      frame.srcdoc =
        '<!doctype html><html><body><h1>Select a file</h1><input aria-label="Search Google Drive"><button id="folder">Test folder</button><button id="file" hidden>Private roadmap</button><button id="select" disabled>Select</button><button id="cancel">Cancel</button></body></html>';
      frame.onload = () => {
        const doc = frame.contentDocument!;
        doc.querySelector<HTMLInputElement>('input')!.focus();
        doc.getElementById('folder')!.ondblclick = () => {
          doc.getElementById('file')!.hidden = false;
        };
        doc.getElementById('file')!.onclick = () => {
          (doc.getElementById('select') as HTMLButtonElement).disabled = false;
        };
        doc.getElementById('select')!.onclick = () =>
          this.callback({
            action: 'picked',
            docs: [
              {
                id: 'private-file',
                name: 'Private roadmap',
                mimeType: 'application/vnd.google-apps.document',
              },
            ],
          });
        doc.getElementById('cancel')!.onclick = () => this.callback({ action: 'cancel' });
        doc.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') this.callback({ action: 'cancel' });
        });
      };
      dialog.append(frame);
      return {
        setVisible: (show: boolean) => {
          if (show) document.body.append(backdrop, dialog);
        },
        dispose: () => {
          frame.onload = null;
          dialog.remove();
          backdrop.remove();
        },
      };
    }
  }
  host.gapi = {
    load: (_: string, options: { callback: () => void }) => {
      host.google = {
        picker: {
          DocsView,
          PickerBuilder,
          Feature: { SUPPORT_DRIVES: 'supportDrives' },
          Action: { PICKED: 'picked', CANCEL: 'cancel' },
        },
      };
      options.callback();
    },
  };
}

export function googlePickerFrame(page: Page) {
  return page.frameLocator('iframe[title="Google Drive file picker"]');
}

export async function pickDriveFile(page: Page) {
  const picker = googlePickerFrame(page);
  await picker.getByRole('button', { name: 'Test folder', exact: true }).dblclick();
  await picker.getByRole('button', { name: 'Private roadmap', exact: true }).click();
  await picker.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('.picker-dialog')).toHaveCount(0);
}
