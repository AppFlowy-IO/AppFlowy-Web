import { useAuthenticatedOriginalImage } from '@/components/_shared/hooks/useAuthenticatedImage';
import { isAppFlowyAuthenticatedFileUrl } from '@/utils/file-storage-url';

import type { SourceBlock } from './types';

const SAFE_URL = /^(https?:\/\/|blob:)/i;

/** Share authenticated originals between a slide and its measuring copy. */
export default function DocumentImage({ block, onSource }: { block: SourceBlock; onSource: (id: string) => void }) {
  const url = block.url;
  const authenticated = !!url && isAppFlowyAuthenticatedFileUrl(url);
  // External and editor-owned blob URLs need no loader, which would otherwise revoke borrowed blobs.
  const original = useAuthenticatedOriginalImage(authenticated ? url : undefined);

  if (!url || (!authenticated && !SAFE_URL.test(url)))
    return <button onClick={() => onSource(block.id)}>Open image in source</button>;

  return <img src={authenticated ? original || undefined : url} alt={block.text || 'Source image'} />;
}
