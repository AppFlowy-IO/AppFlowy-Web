import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, FieldURLType, PDFBlockData } from '@/application/types';
import { FileHandler } from '@/utils/file';
import { createPendingUploadId } from '@/utils/pending-upload';

/** Retry progress is local UI state: never persist a pending marker that could
 * become stuck when write access is revoked while the request is in flight. */
export async function retryPDFUpload({
  editor,
  blockId,
  uploadFile,
}: {
  editor: YjsEditor;
  blockId: string;
  uploadFile: (file: File) => Promise<string | undefined>;
}) {
  const original = findSlateEntryByBlockId(editor, blockId)?.[0];
  const retryLocalUrl = (original?.data as PDFBlockData | undefined)?.retry_local_url;
  const writableTarget = () => {
    const live = findSlateEntryByBlockId(editor, blockId)?.[0];
    const data = live?.data as PDFBlockData | undefined;

    return live?.type === BlockType.PDFBlock &&
      data?.retry_local_url === retryLocalUrl && !data?.url && !data?.pending_upload_id &&
      !editor.readOnly && !editor.isElementReadOnly(live) ? live : undefined;
  };

  if (!retryLocalUrl || !writableTarget()) return;
  const handler = new FileHandler();
  const stored = await handler.getStoredFile(retryLocalUrl);

  try {
    if (!writableTarget()) return;
    if (!stored) throw new Error('The local PDF is no longer available.');
    const uploaded = await uploadFile(stored.file);

    if (!uploaded) throw new Error('The PDF upload did not complete.');
    if (!writableTarget()) return;
    CustomEditor.setBlockData(editor, blockId, {
      url: uploaded,
      url_type: 'cloud',
      retry_local_url: '',
      pending_upload_id: '',
      upload_error: false,
      uploaded_at: Date.now(),
    } as PDFBlockData);
    const committed = findSlateEntryByBlockId(editor, blockId)?.[0];
    const data = committed?.data as PDFBlockData | undefined;

    if (committed?.type === BlockType.PDFBlock && data?.url === uploaded && data.retry_local_url === '')
      await handler.cleanup(retryLocalUrl);
  } finally {
    if (stored?.url) URL.revokeObjectURL(stored.url);
  }
}

/** Stage uploads before closing the picker, then commit only to the same placeholder. */
export async function uploadPDFFiles({
  editor,
  blockId,
  files,
  uploadFile,
  onStarted,
  onError,
}: {
  editor: YjsEditor;
  blockId: string;
  files: File[];
  uploadFile?: (file: File) => Promise<string | undefined>;
  onStarted?: () => void;
  onError?: (error: unknown) => void;
}) {
  const target = () => findSlateEntryByBlockId(editor, blockId)?.[0];
  const original = target();

  if (
    !files.length ||
    !original ||
    original.type !== BlockType.PDFBlock ||
    editor.readOnly ||
    editor.isElementReadOnly(original)
  )
    return;
  const originalData = original.data;
  const handler = new FileHandler();
  const pending = await Promise.all(
    files.map(async (file): Promise<PDFBlockData> => {
      const data: PDFBlockData = {
        url: '',
        name: file.name,
        uploaded_at: Date.now(),
        url_type: 'cloud',
        pending_upload_id: createPendingUploadId(),
      };

      try {
        const stored = await handler.handleFileUpload(file);

        URL.revokeObjectURL(stored.url);
        data.retry_local_url = stored.id;
      } catch {
        // Cloud upload still works if this browser has no local storage quota.
      }

      return data;
    })
  );
  const current = target();

  if (
    !current ||
    current.type !== BlockType.PDFBlock ||
    current.data !== originalData ||
    editor.readOnly ||
    editor.isElementReadOnly(current)
  ) {
    await Promise.all(
      pending.map((data) =>
        data.retry_local_url ? handler.cleanup(data.retry_local_url).catch(() => undefined) : undefined
      )
    );
    return;
  }

  const typeFor = (file: File) =>
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? BlockType.PDFBlock : BlockType.FileBlock;
  const firstType = typeFor(files[0]);
  const firstData = firstType === BlockType.PDFBlock ? pending[0] : { ...pending[0], url_type: FieldURLType.Upload };
  const firstId =
    firstType === BlockType.PDFBlock ? blockId : CustomEditor.turnToBlock(editor, blockId, firstType, firstData);

  if (!firstId) {
    await Promise.all(
      pending.map((data) =>
        data.retry_local_url ? handler.cleanup(data.retry_local_url).catch(() => undefined) : undefined
      )
    );
    return;
  }

  if (firstType === BlockType.PDFBlock) CustomEditor.setBlockData(editor, firstId, firstData);
  const uploads = [{ id: firstId, index: 0, type: firstType }];

  for (let index = 1; index < files.length; index++) {
    const type = typeFor(files[index]);
    const data = type === BlockType.PDFBlock ? pending[index] : { ...pending[index], url_type: FieldURLType.Upload };
    const id = CustomEditor.addBelowBlock(editor, uploads[uploads.length - 1].id, type, data);

    if (id) uploads.push({ id, index, type });
    else if (pending[index].retry_local_url)
      void handler.cleanup(pending[index].retry_local_url!).catch(() => undefined);
  }

  onStarted?.();
  await Promise.all(
    uploads.map(async ({ id, index, type }) => {
      const data = pending[index];
      let url: string | undefined;

      try {
        url = await uploadFile?.(files[index]);
      } catch (error) {
        onError?.(error);
        /* Retain the local file for retry. */
      }

      const live = findSlateEntryByBlockId(editor, id)?.[0];
      const stillOwned =
        live?.type === type && (live.data as PDFBlockData)?.pending_upload_id === data.pending_upload_id;
      const canCommit = stillOwned && !editor.readOnly && !editor.isElementReadOnly(live);

      if (canCommit) {
        CustomEditor.setBlockData(
          editor,
          id,
          url
            ? ({
                url,
                url_type: type === BlockType.PDFBlock ? 'cloud' : FieldURLType.Upload,
                retry_local_url: '',
                pending_upload_id: '',
              } as PDFBlockData)
            : ({ pending_upload_id: '', upload_error: true } as PDFBlockData)
        );
      }

      if (((url && canCommit) || !stillOwned) && data.retry_local_url)
        await handler.cleanup(data.retry_local_url).catch(() => undefined);
    })
  );
}
