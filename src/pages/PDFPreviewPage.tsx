import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { pdfBrowserSource } from '@/components/editor/components/blocks/pdf/pdf-browser';
import { pdfFileName } from '@/components/editor/components/blocks/pdf/pdf-data';
import { PDFPages } from '@/components/editor/components/blocks/pdf/PDFPages';
import { usePDFDocument } from '@/components/editor/components/blocks/pdf/usePDFDocument';
import AppTheme from '@/components/main/AppTheme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { downloadFile } from '@/utils/download';

function PDFPreview({ source, name }: { source: string; name: string }) {
  const { t } = useTranslation();
  const { state, unlock, retry } = usePDFDocument(source, Boolean(source));
  const [zoom, setZoom] = useState(1);
  const [password, setPassword] = useState('');
  const submittedPassword = useRef('');

  useEffect(() => {
    document.title = name;
  }, [name]);
  useEffect(() => {
    if (state.status === 'ready') {
      setPassword('');
      submittedPassword.current = '';
    }
  }, [state.status]);

  return (
    <main className='flex h-screen flex-col bg-surface-primary text-text-primary'>
      <header className='flex h-14 shrink-0 items-center gap-4 border-b border-border-primary px-4'>
        <h1 className='min-w-0 flex-1 truncate text-sm font-medium' title={name}>{name}</h1>
        {state.status === 'ready' && (
          <select
            aria-label={t('document.plugins.pdf.zoom')}
            className='h-8 rounded-md bg-surface-layer-01 px-2 text-sm'
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {Array.from({ length: 16 }, (_, i) => (i + 1) / 4).map((value) => (
              <option key={value} value={value}>{value * 100}%</option>
            ))}
          </select>
        )}
        <Button variant='ghost' disabled={!source} onClick={() => void downloadFile(source, name)}>
          {t('button.download')}
        </Button>
      </header>
      <div className='mx-auto min-h-0 w-full max-w-[1080px] flex-1'>
        {!source || state.status === 'error' ? (
          <div role='alert' className='flex h-full flex-col items-center justify-center gap-5 p-8 text-center'>
            <p className='whitespace-pre-line text-text-secondary'>{t('document.plugins.pdf.previewError')}</p>
            {source && <Button onClick={retry}>{t('document.plugins.pdf.tryAgain')}</Button>}
          </div>
        ) : state.status === 'loading' ? (
          <div role='status' className='flex h-full items-center justify-center text-text-secondary'>
            {t('document.plugins.pdf.loading')}
          </div>
        ) : state.status === 'password' ? (
          <form
            className='flex h-full flex-col items-center justify-center gap-3 p-8'
            onSubmit={(event) => {
              event.preventDefault();
              if (!password.trim() || (state.incorrect && password === submittedPassword.current)) return;
              submittedPassword.current = password;
              unlock(password);
            }}
          >
            <p className='whitespace-pre-line text-center text-text-secondary'>{t('document.plugins.pdf.protectedFile')}</p>
            <Input
              type='password'
              autoComplete='off'
              aria-label={t('document.plugins.pdf.password')}
              aria-invalid={state.incorrect}
              className='w-[280px] max-w-full'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {state.incorrect && <p role='alert' className='text-sm text-text-error'>{t('document.plugins.pdf.incorrectPassword')}</p>}
            <Button type='submit' disabled={!password.trim() || (state.incorrect && password === submittedPassword.current)}>
              {t('document.plugins.pdf.unlock')}
            </Button>
          </form>
        ) : <PDFPages document={state.document} zoom={zoom} />}
      </div>
    </main>
  );
}

export default function PDFPreviewPage() {
  const [params] = useSearchParams();
  const source = pdfBrowserSource(params.get('source') || '', window.location.origin) || '';
  const name = pdfFileName({ url: source, name: params.get('name') || undefined });

  return <AppTheme><PDFPreview key={source} source={source} name={name} /></AppTheme>;
}
