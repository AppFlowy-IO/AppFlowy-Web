import { t } from 'i18next';

import { EventType, on } from '@/application/session';
import { Log } from '@/utils/log';

import {
  cancelImportTask,
  createImportTask,
  CreateImportTaskType,
  uploadImportFile,
  uploadImportFileMultipart,
} from './http/import-api';
import { captureWorkspaceCreationContext } from './http/workspace-creation-api';

export interface ImportFileWithUploadOptions {
  taskType: CreateImportTaskType;
  onProgress: (progress: number) => void;
  signal?: AbortSignal;
}

/** Keep task creation, upload, completion and cleanup within the admitting actor's server. */
export async function importFileWithUpload(file: File, { taskType, onProgress, signal }: ImportFileWithUploadOptions) {
  const assertCurrent = captureWorkspaceCreationContext();
  const controller = new AbortController();
  const abort = () => controller.abort();
  const checkScope = () => {
    try {
      assertCurrent();
    } catch {
      abort();
    }
  };

  const assertActive = () => {
    assertCurrent();
    if (controller.signal.aborted) throw new Error(t('workspaceCreation.contextChanged'));
  };

  const removeListeners = [EventType.SESSION_VALID, EventType.SESSION_REFRESH, EventType.SESSION_INVALID].map((event) =>
    on(event, checkScope)
  );

  window.addEventListener('storage', checkScope);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let taskId: string | undefined;

  try {
    assertActive();
    const task = await createImportTask(file, taskType);

    taskId = task.taskId;
    assertActive();
    const progress = (value: number) => {
      checkScope();
      if (!controller.signal.aborted) onProgress(value);
    };

    if (task.multipart) {
      await uploadImportFileMultipart(file, task.multipart, progress, controller.signal, assertActive);
    } else {
      await uploadImportFile(task.presignedUrl, file, progress, controller.signal);
    }

    assertActive();
  } catch (error) {
    abort();
    // Never issue cleanup with another account's client. The server owns expiry
    // of tasks whose admitting session is no longer available.
    try {
      assertCurrent();
      if (taskId)
        void cancelImportTask(taskId).catch((cancelError) => {
          Log.warn('[Import] Failed to cancel import task after upload error', cancelError);
        });
    } catch {
      /* The admitting context ended. */
    }

    throw error;
  } finally {
    removeListeners.forEach((remove) => remove());
    window.removeEventListener('storage', checkScope);
    signal?.removeEventListener('abort', abort);
  }
}
