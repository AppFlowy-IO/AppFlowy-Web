import * as Y from 'yjs';

import { dataStringTOJson } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey } from '@/application/types';

type ContentNode = {
  type?: BlockType | string;
  text?: string;
  children?: unknown[];
  data?: Record<string, unknown>;
};

function hasNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.length > 0;
}

function hasImageContent(data: Record<string, unknown> | undefined) {
  if (!data) return false;

  return (
    hasNonEmptyString(data.url) || hasNonEmptyString(data.retry_local_url) || hasNonEmptyString(data.pending_upload_id)
  );
}

export function hasEditorNodeContent(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;

  const contentNode = node as ContentNode;

  if ('text' in contentNode) {
    return hasNonEmptyString(contentNode.text);
  }

  if (contentNode.type === BlockType.ImageBlock) {
    return hasImageContent(contentNode.data);
  }

  if (contentNode.type === YjsEditorKey.text) {
    return contentNode.children?.some(hasEditorNodeContent) ?? false;
  }

  if (contentNode.type && contentNode.type !== BlockType.Page && contentNode.type !== BlockType.Paragraph) {
    return true;
  }

  return contentNode.children?.some(hasEditorNodeContent) ?? false;
}

export function hasYjsBlockContent(block: Y.Map<unknown>) {
  const type = block.get(YjsEditorKey.block_type);

  if (!type || type === BlockType.Page || type === BlockType.Paragraph) {
    return false;
  }

  if (type === BlockType.ImageBlock) {
    return hasImageContent(dataStringTOJson(block.get(YjsEditorKey.block_data) as string) as Record<string, unknown>);
  }

  return true;
}

