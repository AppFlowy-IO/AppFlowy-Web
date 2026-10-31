import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SummaryIcon } from '@/assets/icons/ai_summary_tab.svg';

import { presentedChildren } from './document-content';
import { flattenBlocks } from './source';

import type { SourceBlock } from './types';

export function MeetingSlide({
  meeting,
  children,
  measureKey,
}: {
  meeting?: SourceBlock;
  children: ReactNode;
  measureKey?: string;
}) {
  return meeting ? (
    <div className='ps-doc-block' data-meeting-measure={measureKey}>
      <DocumentMeeting block={meeting}>{children}</DocumentMeeting>
    </div>
  ) : (
    <>{children}</>
  );
}

/** Read-only meeting summary using the native meeting surface and active-tab styling. */
export default function DocumentMeeting({ block, children }: { block: SourceBlock; children: ReactNode }) {
  const { t } = useTranslation();
  const hasSummary = useMemo(
    () =>
      flattenBlocks(presentedChildren(block)).some(
        (child) => child.text.trim() || child.formula?.trim() || child.url || child.database
      ),
    [block]
  );

  return (
    <div
      className='ai-meeting-block my-2 flex flex-col overflow-hidden rounded-xl border border-border-primary bg-[var(--block-bg-color-20)]'
      data-ai-meeting-active='summary'
    >
      <div className='px-4 py-3'>
        <div className='text-2xl font-semibold leading-9 text-text-primary'>
          {block.meeting?.title?.trim() || t('document.aiMeeting.titleDefault')}
        </div>
      </div>
      <div className='flex-1 rounded-2xl bg-bg-body'>
        <div className='ai-meeting-tabs px-4 pb-2 pt-4'>
          <span className='inline-flex items-center gap-1.5 rounded-md bg-fill-content-visible px-3 py-1.5 text-sm font-medium text-text-primary'>
            <SummaryIcon className='h-5 w-5 text-current' />
            <span>{t('document.aiMeeting.tab.summary')}</span>
          </span>
        </div>
        <div className='ai-meeting-content px-4 pb-4 pt-2'>
          {hasSummary ? children : <p className='text-text-secondary'>No summary available.</p>}
        </div>
      </div>
    </div>
  );
}
