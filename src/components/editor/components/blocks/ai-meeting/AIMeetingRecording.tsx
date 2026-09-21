import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useSlateStatic } from 'slate-react';

import { consumeMeetingStart } from '@/application/integrations/meeting-start';
import {
  MeetingAudioSource,
  MeetingRecordingError,
  MeetingTranscription,
  TranscriptionState,
} from '@/application/integrations/meeting-transcription';
import { YjsEditor } from '@/application/slate-yjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import {
  assertDocExists,
  dataStringTOJson,
  getBlock,
  getChildrenArray,
  getText,
} from '@/application/slate-yjs/utils/yjs';
import { AIMeetingBlockData, BlockType, YjsEditorKey } from '@/application/types';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/utils/errors';

export function AIMeetingRecording({
  workspaceId,
  viewId,
  blockId,
  transcriptBlockId,
  pendingDuration = 0,
  onFinished,
}: {
  workspaceId: string;
  viewId: string;
  blockId: string;
  transcriptBlockId?: string;
  pendingDuration?: number;
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const session = useRef<MeetingTranscription>();
  const mounted = useRef(true);
  const finished = useRef(onFinished);
  const [choosing, setChoosing] = useState(false);
  const [state, setState] = useState<TranscriptionState>('idle');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const hasTranscript = useRef(false);

  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);
  useEffect(() => {
    mounted.current = true;
    if (consumeMeetingStart(viewId)) setChoosing(true);
    return () => {
      void session.current?.stop();
      mounted.current = false;
    };
  }, [viewId, workspaceId, blockId]);

  useEffect(() => {
    if (state === 'idle') return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state]);

  const start = async (source: MeetingAudioSource) => {
    if (session.current || !transcriptBlockId) return;
    setError('');
    setChoosing(false);
    hasTranscript.current = false;
    const transcriptTurns = new Map<number, string>();
    // Final socket messages may arrive after the React editor unmounts. Write
    // directly to its retained collab instead of depending on Slate selection.
    const updateMeeting = (data: Partial<AIMeetingBlockData>) => {
      const block = getBlock(blockId, editor.sharedRoot);

      if (block)
        block.set(
          YjsEditorKey.block_data,
          JSON.stringify({ ...dataStringTOJson(block.get(YjsEditorKey.block_data)), ...data })
        );
    };

    const onError = (failure: unknown) => {
      if (!mounted.current) return;
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setError(
        failure instanceof MeetingRecordingError
          ? t(`document.aiMeeting.recordingErrors.${failure.code}`)
          : getErrorMessage(failure, t('document.aiMeeting.recordingFailed'))
      );
    };

    const recording = new MeetingTranscription(workspaceId, {
      onState: (next) => {
        if (next === 'recording' || next === 'idle' || next === 'stopping')
          updateMeeting({ recording_state: next === 'recording' ? 'recording' : 'idle', auto_start_recording: false });
        if (!mounted.current) return;
        setState(next);
        if (next === 'idle') {
          session.current = undefined;
          if (hasTranscript.current)
            setTimeout(() => {
              if (mounted.current) finished.current();
            }, 0);
        }
      },
      onPartial: (text) => {
        if (mounted.current) setPartial(text);
      },
      onTranscript: (text, turnOrder) => {
        const root = editor.sharedRoot;
        const block = getBlock(transcriptBlockId, root);

        if (!block) return;
        const existingId = turnOrder === undefined ? undefined : transcriptTurns.get(turnOrder);
        const doc = assertDocExists(root);

        if (existingId) {
          const existing = getBlock(existingId, root);

          if (!existing) return;
          const content = getText(existing.get(YjsEditorKey.block_external_id), root);

          doc.transact(() => {
            content.delete(0, content.length);
            content.insert(0, text);
          });
          return;
        }

        const children = getChildrenArray(block.get(YjsEditorKey.block_children), root);
        const paragraph = {
          type: BlockType.Paragraph,
          data: {},
          children: [{ type: YjsEditorKey.text, children: [{ text }] }],
        } as unknown as Element;

        doc.transact(() => {
          const [id] = slateContentInsertToYData(transcriptBlockId, children.length, [paragraph], doc);

          if (turnOrder !== undefined) transcriptTurns.set(turnOrder, id);
          updateMeeting({ show_notes_directly: false });
        });
        hasTranscript.current = true;
      },
      onError,
      onPendingDuration: (seconds) => {
        updateMeeting({ pending_billing_duration: seconds });
      },
    });

    session.current = recording;
    try {
      await recording.start(source, pendingDuration);
    } catch (failure) {
      onError(failure);
      session.current = undefined;
      if (mounted.current) setState('idle');
    }
  };

  return (
    <div className='mt-3 flex flex-col gap-2 text-sm' contentEditable={false}>
      {state === 'idle' ? (
        <Button
          className='self-start'
          variant='outline'
          disabled={!transcriptBlockId}
          onClick={() => setChoosing((current) => !current)}
        >
          {t('document.aiMeeting.startTranscribing')}
        </Button>
      ) : (
        <div className='flex items-center gap-3'>
          <span role='status'>{t(`document.aiMeeting.recordingState.${state}`)}</span>
          <Button variant='outline' disabled={state === 'stopping'} onClick={() => void session.current?.stop()}>
            {t('document.aiMeeting.stopTranscribing')}
          </Button>
        </div>
      )}
      {choosing && (
        <div className='rounded-lg border border-border-primary p-3'>
          <p className='mb-3 text-text-secondary'>{t('document.aiMeeting.audioSourceHint')}</p>
          <div className='flex flex-wrap gap-2'>
            <Button onClick={() => void start('meeting')}>{t('document.aiMeeting.meetingAudio')}</Button>
            <Button variant='outline' onClick={() => void start('microphone')}>
              {t('document.aiMeeting.microphoneOnly')}
            </Button>
            <Button variant='ghost' onClick={() => setChoosing(false)}>
              {t('button.cancel')}
            </Button>
          </div>
        </div>
      )}
      {partial && (
        <p aria-live='polite' className='text-text-secondary'>
          {partial}
        </p>
      )}
      {error && (
        <p role='alert' className='text-text-error'>
          {error}
        </p>
      )}
    </div>
  );
}
