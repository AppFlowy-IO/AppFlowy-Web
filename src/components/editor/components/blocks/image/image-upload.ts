import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, ImageType, ImageBlockData } from '@/application/types';
import { ImageBlockNode } from '@/components/editor/editor.type';
import { FileHandler } from '@/utils/file';
import { createPendingUploadId } from '@/utils/pending-upload';

import { imageUploadLimitCode, isImageUploadLimit, isSupportedImage } from './image-data';
import { isImageUploading, setImageUploading } from './image-upload-state';
import { imageUploadSource, watchImageUploadSource } from './image-upload-ownership';

export function writableImage(editor: YjsEditor, blockId: string) {
  if (!YjsEditor.connected(editor)) return;
  const node = findSlateEntryByBlockId(editor, blockId)?.[0];

  return node?.type === BlockType.ImageBlock &&
    isSupportedImage(node.data as ImageBlockData) &&
    !editor.readOnly &&
    !editor.isElementReadOnly(node)
    ? (node as ImageBlockNode)
    : undefined;
}

type Upload = (file: File) => Promise<string | undefined>;
/** A persisted retry snapshot belongs to its placeholder until a successful commit. */
export async function uploadImageBlocks({
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
  uploadFile?: Upload;
  onStarted?: () => void;
  onError?: (error: unknown) => void;
}) {
  const original = writableImage(editor, blockId);

  if (!original || !files.length || isImageUploading(editor, blockId)) return;
  const originalData = original.data;
  const handler = new FileHandler();
  const staging = watchImageUploadSource(editor, blockId);

  setImageUploading(editor, blockId, true);
  const pending = await Promise.all(
    files.map(async (file): Promise<ImageBlockData> => {
      const data: ImageBlockData = {
        url: '',
        name: file.name,
        source: 'upload',

        image_type: ImageType.External,

        pending_upload_id: createPendingUploadId(),
        retry_local_url: '',
        upload_error: false,
        upload_error_code: null,
      };

      try {
        const stored = await handler.handleFileUpload(file);

        handler.releaseUrl(stored.id);
        data.retry_local_url = stored.id;
      } catch {
        /* Storage failure must not prevent a cloud upload. */
      }

      return data;
    })
  );
  const cleanup = (data: ImageBlockData) =>
    data.retry_local_url ? handler.cleanup(data.retry_local_url).catch(() => undefined) : undefined;
  const live = writableImage(editor, blockId);
  const unchanged = staging.valid() && live && imageUploadSource(live.data) === imageUploadSource(originalData);

  staging.dispose();

  if (!unchanged) {
    await Promise.all(pending.map(cleanup));
    setImageUploading(editor, blockId, false);
    return;
  }

  CustomEditor.setBlockData(editor, blockId, pending[0]);
  const targets = [{ id: blockId, index: 0 }];

  for (let index = 1; index < files.length; index++) {
    const id = CustomEditor.addBelowBlock(editor, targets[targets.length - 1].id, BlockType.ImageBlock, pending[index]);

    if (id) {
      targets.push({ id, index });
      setImageUploading(editor, id, true);
    } else void cleanup(pending[index]);
  }

  editor.flushLocalChanges();
  onStarted?.();
  await Promise.all(
    targets.map(async ({ id, index }) => {
      const data = pending[index];
      const ownership = watchImageUploadSource(editor, id);
      let url: string | undefined;
      let failure: unknown;

      try {
        url = await uploadFile?.(files[index]);
        if (!url) failure = new Error('Upload did not complete.');
      } catch (error) {
        failure = error;
      }

      try {
        const node = findSlateEntryByBlockId(editor, id)?.[0];
        const owned =
          node?.type === BlockType.ImageBlock &&
          (node.data as ImageBlockData).pending_upload_id === data.pending_upload_id;
        const writable = owned && ownership.valid() && writableImage(editor, id);

        if (writable) {
          CustomEditor.setBlockData(
            editor,
            id,
            url
              ? { url, retry_local_url: '', pending_upload_id: '', upload_error: false, upload_error_code: null }
              : { pending_upload_id: '', upload_error: true, upload_error_code: imageUploadLimitCode(failure) }
          );
          // A Slate-only update is not a saved upload. Flush into the document
          // before releasing the recovery file, while this editor still owns it.
          editor.flushLocalChanges();
        }

        const committed = findSlateEntryByBlockId(editor, id)?.[0] as ImageBlockNode | undefined;

        if (
          YjsEditor.connected(editor) &&
          (!owned || (url && writable && committed?.data.url === url && !committed.data.retry_local_url))
        )
          await cleanup(data);
        if (failure && writable) onError?.(failure);
      } finally {
        ownership.dispose();
        setImageUploading(editor, id, false);
      }
    })
  );
}

export async function retryImageUpload(editor: YjsEditor, blockId: string, uploadFile?: Upload) {
  const original = writableImage(editor, blockId);
  const originalData = original?.data;
  const id = originalData?.retry_local_url;

  if (!id || isImageUploading(editor, blockId) || isImageUploadLimit(originalData?.upload_error_code)) return;
  const handler = new FileHandler();
  const ownership = watchImageUploadSource(editor, blockId);
  const target = () => {
    const node = writableImage(editor, blockId);

    return node &&
      ownership.valid() &&
      node.data.retry_local_url === id &&
      node.data.url === originalData?.url &&
      node.data.pending_upload_id === originalData?.pending_upload_id
      ? node
      : undefined;
  };

  setImageUploading(editor, blockId, true);
  try {
    const stored = await handler.getStoredFile(id);

    if (!target()) return;
    if (!stored) throw new Error('The local file is no longer available.');
    const url = await uploadFile?.(stored.file);

    if (!url) throw new Error('Upload did not complete.');
    if (!target()) return;
    CustomEditor.setBlockData(editor, blockId, {
      url,

      image_type: ImageType.External,
      pending_upload_id: '',
      retry_local_url: '',
      upload_error: false,
      upload_error_code: null,
    });
    editor.flushLocalChanges();
    const committed = findSlateEntryByBlockId(editor, blockId)?.[0] as ImageBlockNode | undefined;

    if (YjsEditor.connected(editor) && committed?.data.url === url && !committed.data.retry_local_url)
      await handler.cleanup(id).catch(() => undefined);
  } catch (error) {
    if (target()) {
      CustomEditor.setBlockData(editor, blockId, { upload_error: true, upload_error_code: imageUploadLimitCode(error) });
      editor.flushLocalChanges();
    }

    throw error;
  } finally {
    ownership.dispose();
    handler.releaseUrl(id);
    setImageUploading(editor, blockId, false);
  }
}
