import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as BulletedListIcon } from '@/assets/icons/bulleted_list.svg';
import { ReactComponent as ImageIcon } from '@/assets/icons/image.svg';
import { ReactComponent as TextIcon } from '@/assets/icons/menu.svg';
import { ReactComponent as NumberedListIcon } from '@/assets/icons/numbered_list.svg';
import { ReactComponent as ParagraphIcon } from '@/assets/icons/paragraph.svg';
import { ReactComponent as TableIcon } from '@/assets/icons/table.svg';
import { ReactComponent as TextWithIcon } from '@/assets/icons/text_image.svg';
import { OutputContent, OutputLayout } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function FormatGroup({
  outputContent,
  outputLayout,
  setOutputContent,
  setOutputLayout,
  imageAvailable = true,
}: {
  outputContent?: OutputContent;
  outputLayout?: OutputLayout;
  setOutputContent: (content: OutputContent) => void;
  setOutputLayout: (layout: OutputLayout) => void;
  /** Hides the image answer types when the server has no image model. */
  imageAvailable?: boolean;
}) {
  const { t } = useTranslation();

  const actions = useMemo(() => {
    const all = [{
      Icon: TextIcon,
      key: OutputContent.TEXT,
      title: t('chat.input.button.text'),
      onClick: () => setOutputContent(OutputContent.TEXT),
    }, {
      Icon: TextWithIcon,
      key: OutputContent.RichTextImage,
      title: t('chat.input.button.textWithImage'),
      onClick: () => setOutputContent(OutputContent.RichTextImage),
    }, {
      Icon: ImageIcon,
      key: OutputContent.IMAGE,
      title: t('chat.input.button.imageOnly'),
      onClick: () => setOutputContent(OutputContent.IMAGE),
    }];

    // Without an image model only text answers are offered.
    return imageAvailable ? all : all.filter((action) => action.key === OutputContent.TEXT);
  }, [imageAvailable, setOutputContent, t]);

  const textFormats = useMemo(() => [
    {
      Icon: ParagraphIcon,
      key: OutputLayout.Paragraph,
      title: t('chat.input.button.paragraph'),
      onClick: () => setOutputLayout(OutputLayout.Paragraph),
    },
    {
      Icon: BulletedListIcon,
      key: OutputLayout.BulletList,
      title: t('chat.input.button.bulletList'),
      onClick: () => setOutputLayout(OutputLayout.BulletList),
    },
    {
      Icon: NumberedListIcon,
      key: OutputLayout.NumberedList,
      title: t('chat.input.button.numberedList'),
      onClick: () => setOutputLayout(OutputLayout.NumberedList),
    },
    {
      Icon: TableIcon,
      key: OutputLayout.SimpleTable,
      title: t('chat.input.button.table'),
      onClick: () => setOutputLayout(OutputLayout.SimpleTable),
    },
  ], [setOutputLayout, t]);

  const renderGroup = (options: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Icon: any,
    onClick?: () => void;
    key: OutputContent | OutputLayout, title: string
  }[], isLayout: boolean) => {
    return options.map(({ Icon, key, title, onClick }) => {
      const selected = isLayout ? outputLayout === key : outputContent === key;

      return (
      <Tooltip key={String(key)}>
        <TooltipTrigger asChild>
          <Button
            onMouseDown={e => {
              e.preventDefault();
            }}
            variant={'ghost'}
            size={'icon'}
            onClick={onClick}
            aria-label={title}
            aria-pressed={selected}
            className={cn(
              selected ? 'bg-fill-content-hover' : '',
              'text-icon-secondary',
            )}
          >
            <Icon
              style={{
                width: 20,
                height: 20,
              }}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          align={'center'}
          side={'top'}
        >
          {title}
        </TooltipContent>
      </Tooltip>
      );
    });
  };

  return (
    <div className={'flex gap-2 items-center'} data-testid='chat-format-group'>
      <div className={'flex gap-1'}>
        {renderGroup(actions, false)}
      </div>
      {
        outputContent !== OutputContent.IMAGE && (
          <>
            <Separator
              orientation={'vertical'}
              className={'!h-4'}
            />
            <div className={'flex gap-1'}>
              {renderGroup(textFormats, true)}
            </div>
          </>
        )
      }

    </div>
  );
}
