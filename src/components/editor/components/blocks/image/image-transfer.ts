import { downloadBlob } from '@/utils/download';
import { convertBlobToPng, fetchImageBlob } from '@/utils/image';

export async function copyImage(url: string) {
  // Supply a promise while the click still owns user activation (Safari).
  const png = fetchImageBlob(url).then((file) => {
    if (!file) throw new Error('Image unavailable');
    return file.type === 'image/png' ? file : convertBlobToPng(file);
  });

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export async function downloadImage(url: string, name: string) {
  const file = await fetchImageBlob(url);

  if (!file) throw new Error('Image unavailable');
  downloadBlob(file, name);
}
