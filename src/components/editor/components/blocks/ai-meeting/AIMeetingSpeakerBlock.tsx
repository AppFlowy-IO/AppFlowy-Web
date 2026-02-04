import { forwardRef, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Element as SlateElement } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { BlockType } from '@/application/types';
import { formatTimestamp } from '@/components/editor/components/blocks/ai-meeting/ai-meeting.utils';
import { AIMeetingNode, AIMeetingSpeakerNode, EditorElementProps } from '@/components/editor/editor.type';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const parseSpeakerInfoMap = (raw: unknown) => {
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;

      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, Record<string, unknown>>;
  }

  return null;
};

const getBaseSpeakerId = (speakerId: string) => {
  const [base] = speakerId.split('_');

  return base || speakerId;
};

const resolveSpeakerInfo = (
  speakerId?: string,
  infoMap?: Record<string, Record<string, unknown>> | null,
  unknownLabel?: string,
  fallbackLabel?: (id: string) => string
) => {
  const resolvedUnknownLabel = unknownLabel ?? 'Unknown speaker';

  if (!speakerId) {
    return {
      name: resolvedUnknownLabel,
      email: '',
      avatarUrl: '',
    };
  }

  const baseId = getBaseSpeakerId(speakerId);
  const info = infoMap?.[speakerId] ?? infoMap?.[baseId];
  const name = typeof info?.name === 'string' ? info?.name?.trim() : '';
  const email = typeof info?.email === 'string' ? info?.email?.trim() : '';
  const avatarUrl = typeof info?.avatar_url === 'string' ? info?.avatar_url?.trim() : '';

  if (name) {
    return {
      name,
      email,
      avatarUrl,
    };
  }

  if (!baseId) {
    return {
      name: resolvedUnknownLabel,
      email,
      avatarUrl,
    };
  }

  return {
    name: fallbackLabel ? fallbackLabel(baseId) : `Speaker ${baseId}`,
    email,
    avatarUrl,
  };
};

export const AIMeetingSpeakerBlock = memo(
  forwardRef<HTMLDivElement, EditorElementProps<AIMeetingSpeakerNode>>(({ node, children, className, ...attributes }, ref) => {
    const { t } = useTranslation();
    const editor = useSlateStatic();

    const speakerId = (node.data?.speaker_id || (node.data as Record<string, unknown>)?.speakerId) as
      | string
      | undefined;
    const timestampRaw = node.data?.timestamp ?? (node.data as Record<string, unknown>)?.timestamp;
    const timestamp = typeof timestampRaw === 'number' ? timestampRaw : Number(timestampRaw);

    const parentAiMeeting = useMemo(() => {
      try {
        const path = ReactEditor.findPath(editor, node);
        const match = Editor.above(editor, {
          at: path,
          match: (n) => {
            return !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === BlockType.AIMeetingBlock;
          },
        });

        if (!match) return null;

        return match[0] as AIMeetingNode;
      } catch {
        return null;
      }
    }, [editor, node]);

    const speakerInfoMap = useMemo(() => {
      const raw = parentAiMeeting?.data?.speaker_info_map;

      return parseSpeakerInfoMap(raw);
    }, [parentAiMeeting?.data?.speaker_info_map]);

    const unknownSpeakerLabel = t('document.aiMeeting.speakerUnknown');
    const getFallbackLabel = useCallback(
      (id: string) => t('document.aiMeeting.speakerFallback', { id }),
      [t]
    );
    const speakerInfo = useMemo(
      () => resolveSpeakerInfo(speakerId, speakerInfoMap, unknownSpeakerLabel, getFallbackLabel),
      [getFallbackLabel, speakerId, speakerInfoMap, unknownSpeakerLabel]
    );
    const speakerName = speakerInfo.name;
    const displayTimestamp = useMemo(() => formatTimestamp(timestamp), [timestamp]);

    const avatarColorKey = speakerId || speakerName || unknownSpeakerLabel;
    const avatarLabel = useMemo(() => {
      if (speakerName && speakerName !== unknownSpeakerLabel) {
        return speakerName.trim().charAt(0).toUpperCase();
      }

      if (speakerId) return getBaseSpeakerId(speakerId).charAt(0).toUpperCase();
      return '?';
    }, [speakerId, speakerName, unknownSpeakerLabel]);

    return (
      <div
        ref={ref}
        {...attributes}
        className={cn('ai-meeting-speaker', className)}
      >
        <div className="ai-meeting-speaker__header" contentEditable={false}>
          <Avatar
            size="sm"
            shape="circle"
            className="ai-meeting-speaker__avatar"
          >
            {speakerInfo.avatarUrl ? (
              <AvatarImage src={speakerInfo.avatarUrl} alt={speakerName} />
            ) : (
              <AvatarFallback name={avatarColorKey}>
                <span>{avatarLabel}</span>
              </AvatarFallback>
            )}
          </Avatar>
          <div className="ai-meeting-speaker__name">{speakerName}</div>
          {displayTimestamp && <div className="ai-meeting-speaker__timestamp">{displayTimestamp}</div>}
        </div>
        <div className="ai-meeting-speaker__content">{children}</div>
      </div>
    );
  })
);

AIMeetingSpeakerBlock.displayName = 'AIMeetingSpeakerBlock';
