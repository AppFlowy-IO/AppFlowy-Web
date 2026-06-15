import { Avatar, Divider, Tooltip } from '@mui/material';
import React, { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import smoothScrollIntoViewIfNeeded from 'smooth-scroll-into-view-if-needed';

import { GlobalComment } from '@/application/comment.type';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as BulletedListIcon } from '@/assets/icons/bulleted_1.svg';
import { useCommentRender } from '@/components/global-comment/GlobalComment.hooks';
import { Reactions } from '@/components/global-comment/reactions';

interface CommentProps {
  comment: GlobalComment;
}

const MAX_HEIGHT = 320;

function Comment({ comment }: CommentProps) {
  const { avatar, time, timeFormat } = useCommentRender(comment);
  const { t } = useTranslation();
  const ref = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLSpanElement>(null);
  const [showExpand, setShowExpand] = React.useState(false);
  const [isExpand, setIsExpand] = React.useState(false);

  useEffect(() => {
    const contentEl = contentRef.current;

    if (!contentEl) return;
    const contentHeight = contentEl.offsetHeight;

    setShowExpand(contentHeight > MAX_HEIGHT);
  }, []);

  const toggleExpand = useCallback(() => {
    setIsExpand((prev) => {
      return !prev;
    });
  }, []);

  return (
    <div className={'comment flex flex-col gap-2'} ref={ref}>
      <div className={'flex items-center gap-2'}>
        <div className={'flex items-center gap-4'}>
          <Avatar {...avatar} className={`h-8 w-8`} />
          <Tooltip title={comment.user?.name} enterNextDelay={500} enterDelay={1000} placement={'top-start'}>
            <div className={'max-w-[200px] truncate font-semibold'}>{comment.user?.name}</div>
          </Tooltip>
        </div>
        <Tooltip title={timeFormat} enterNextDelay={500} enterDelay={1000} placement={'top-start'}>
          <div className={'flex items-center gap-2 text-text-secondary'}>
            <BulletedListIcon className={'h-3 w-3'} />
            <div className={'whitespace-nowrap text-sm'}>{time}</div>
          </div>
        </Tooltip>
      </div>
      <div className={'ml-12 flex flex-col gap-2'}>
        {comment.isDeleted ? (
          <span className={'text-text-secondary'}>{`[${t('globalComment.hasBeenDeleted')}]`}</span>
        ) : (
          <div
            style={{
              height: showExpand && !isExpand ? MAX_HEIGHT : 'auto',
              overflow: isExpand ? 'unset' : 'hidden',
              transition: 'height 0.8s ease-in-out',
            }}
          >
            <span ref={contentRef} className={'transform whitespace-pre-wrap break-words'}>
              {comment.content}
            </span>
          </div>
        )}
        {showExpand && (
          <>
            <Tooltip
              title={isExpand ? t('globalComment.collapse') : t('globalComment.readMore')}
              disableInteractive={true}
            >
              <div
                onClick={() => {
                  const originalExpand = isExpand;

                  toggleExpand();

                  if (originalExpand && ref.current) {
                    void smoothScrollIntoViewIfNeeded(ref.current, {
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }
                }}
                className={
                  'relative flex cursor-pointer items-center justify-center gap-2 bg-transparent text-text-secondary hover:text-text-action'
                }
              >
                <Divider className={'flex-1'} />
                <ArrowDown className={`h-5 w-5 transform ${isExpand ? 'rotate-180' : null} `} />
                <Divider className={'flex-1'} />
              </div>
            </Tooltip>
          </>
        )}
        {!comment.isDeleted && <Reactions comment={comment} />}
      </div>
    </div>
  );
}

export default memo(Comment);
