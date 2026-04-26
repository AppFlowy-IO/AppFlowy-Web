import { UIVariant } from '@/application/types';

export interface DatabaseViewportLayoutInput {
  embeddedHeight?: number;
  isDocumentBlock?: boolean;
  variant?: UIVariant;
}

export function shouldUseFixedDatabaseViewport({
  embeddedHeight,
  isDocumentBlock,
  variant,
}: DatabaseViewportLayoutInput) {
  return embeddedHeight !== undefined || (!isDocumentBlock && variant !== UIVariant.Publish);
}
