import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import {
  AudioFileTranscription,
  AudioTranscriptionSource,
  AudioTranscriptionStage,
} from '@/application/integrations/audio-file-transcription';
import { AudioTranscriptionError, titleFromAudioFile } from '@/application/integrations/transcription-media';
import {
  defaultTranscriptLanguage,
  saveDefaultTranscriptLanguage,
} from '@/application/integrations/transcription-result';
import {
  canUpgradeTranscriptionToPro,
  isTranscriptionLimitError,
  transcriptionUsage,
} from '@/application/integrations/transcription-usage';
import { getMeetingUsage } from '@/application/services/js-services/http/meeting-api';
import { YjsEditor } from '@/application/slate-yjs';
import { AIMeetingBlockData, SubscriptionPlan, WorkspaceUsageAndLimit } from '@/application/types';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { useEditorContext } from '@/components/editor/EditorContext';
import { getErrorMessage } from '@/utils/errors';

import { applyAudioTranscript, updateMeetingData } from './ai-meeting.import';

export function useAIMeetingImport({
  blockId,
  data,
  transcriptBlockId,
  transcriptTabIndex = 1,
  hasTranscript,
  readOnly,
  enabled,
  onFinished,
}: {
  blockId: string;
  data: AIMeetingBlockData;
  transcriptBlockId?: string;
  transcriptTabIndex?: number;
  hasTranscript: boolean;
  readOnly: boolean;
  enabled: boolean;
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { workspaceId, getSubscriptions } = useEditorContext();
  const hosted = useIsOfficialHosted();
  const [stage, setStage] = useState<AudioTranscriptionStage>('idle');
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<unknown>();
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [usage, setUsage] = useState<WorkspaceUsageAndLimit>();
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [promotionDismissed, setPromotionDismissed] = useState(false);
  const [language, setLanguageState] = useState(() => data.transcript_language || defaultTranscriptLanguage(workspaceId));
  const session = useRef<AudioFileTranscription>();
  const mounted = useRef(false);
  const attempt = useRef(0);
  const running = useRef(false);
  const usageRequest = useRef<AbortController>();
  const resumedId = useRef<string>();
  const latest = useRef({ data, onFinished, readOnly, transcriptBlockId });

  useEffect(() => {
    latest.current = { data, onFinished, readOnly, transcriptBlockId };
  }, [data, onFinished, readOnly, transcriptBlockId]);
  const busy = stage !== 'idle';
  const available = Boolean(workspaceId && transcriptBlockId && enabled && !readOnly);
  const recordingTooLong = error instanceof AudioTranscriptionError && error.code === 'recordingTooLong';
  const needsMoreMinutes = quotaExceeded || recordingTooLong;
  const getMeetingSubscriptions = useCallback(async () => {
    const subscriptions = await getSubscriptions?.();

    if (!subscriptions) throw new Error('Workspace subscription details are unavailable');
    return subscriptions.map((subscription) =>
      subscription.plan === SubscriptionPlan.AIMax ? { ...subscription, plan: SubscriptionPlan.Pro } : subscription
    );
  }, [getSubscriptions]);
  const { activeSubscriptionPlan } = useSubscriptionPlan(getSubscriptions ? getMeetingSubscriptions : undefined, {
    cacheKey: `meeting-quota:${workspaceId}`,
    enabled: needsMoreMinutes && hosted,
  });
  const canUpgrade = Boolean(getSubscriptions) && canUpgradeTranscriptionToPro(hosted, activeSubscriptionPlan);

  const reloadUsage = useCallback(async () => {
    if (!available || !mounted.current) return;
    usageRequest.current?.abort();
    const controller = new AbortController();

    usageRequest.current = controller;
    try {
      const next = await getMeetingUsage(workspaceId, controller.signal);

      if (!mounted.current || controller.signal.aborted) return;
      setUsage(next);
      setQuotaExceeded(transcriptionUsage(next).exhausted);
      setError((previous: unknown) =>
        previous instanceof AudioTranscriptionError && previous.code === 'usageFailed' ? undefined : previous
      );
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(new AudioTranscriptionError('usageFailed', failure));
      setErrorDismissed(false);
    }
  }, [available, workspaceId]);

  useEffect(() => {
    attempt.current++;
    mounted.current = true;
    running.current = false;
    resumedId.current = undefined;
    session.current = undefined;
    setStage('idle');
    setProgress(undefined);
    setError(undefined);
    setErrorDismissed(false);
    setUsage(undefined);
    setQuotaExceeded(false);
    setPromotionDismissed(false);
    return () => {
      mounted.current = false;
      running.current = false;
      session.current?.suspend();
      session.current = undefined;
      usageRequest.current?.abort();
    };
  }, [blockId, editor, workspaceId]);

  useEffect(() => {
    void reloadUsage();
    return () => usageRequest.current?.abort();
  }, [blockId, editor, reloadUsage]);
  useEffect(() => {
    if (!available || !quotaExceeded || busy) return;
    const refresh = () => { void reloadUsage(); };

    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [available, busy, quotaExceeded, reloadUsage]);
  useEffect(() => {
    setLanguageState(data.transcript_language || defaultTranscriptLanguage(workspaceId));
  }, [data.transcript_language, workspaceId]);
  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy]);

  const createSession = useCallback(
    () => {
      const currentSession = new AudioFileTranscription(workspaceId, {
        onStage: (next, fraction) => {
          if (!mounted.current || session.current !== currentSession) return;
          // Keep the indicator through applying the result and starting the
          // summary; the import hook owns the final transition to idle.
          if (next === 'idle' && running.current) return;
          setStage(next);
          setProgress(fraction);
        },
        onUsage: (next) => {
          if (!mounted.current || session.current !== currentSession) return;
          setUsage(next);
          setQuotaExceeded(transcriptionUsage(next).exhausted);
        },
        onJob: (id) => {
          if (!mounted.current || session.current !== currentSession || latest.current.readOnly) return;
          resumedId.current = id;
          updateMeetingData(editor, blockId, {
            transcript_id: id,
            recording_state: id ? 'recorded' : 'idle',
            show_notes_directly: false,
          });
        },
      });

      return currentSession;
    },
    [blockId, editor, workspaceId]
  );

  const run = useCallback(
    async (source?: AudioTranscriptionSource, resumeId?: string) => {
      if (!available || running.current) return;
      running.current = true;
      const id = ++attempt.current;

      usageRequest.current?.abort();
      setError(undefined);
      setErrorDismissed(false);
      setPromotionDismissed(false);
      setStage('checking');
      if (!session.current || source || resumeId) session.current = createSession();
      const currentSession = session.current;

      if (source) {
        const currentTitle = latest.current.data.title?.trim();

        updateMeetingData(editor, blockId, {
          transcription_type: source instanceof File ? 'audioFile' : 'urlSource',
          transcript_language: language,
          audio_file_path: '',
          selected_tab_index: transcriptTabIndex,
          ...(source instanceof File && (!currentTitle || currentTitle === t('document.aiMeeting.titleDefault'))
            ? { title: titleFromAudioFile(source.name) }
            : {}),
        });
      }

      try {
        const result = source
          ? await currentSession.start(source, language)
          : resumeId
          ? await currentSession.resume(resumeId)
          : await currentSession.retry();

        if (!mounted.current || attempt.current !== id || latest.current.readOnly) return;
        const targetId = latest.current.transcriptBlockId;

        if (!targetId || !applyAudioTranscript(editor, blockId, targetId, result)) return;
        latest.current.onFinished();
        void reloadUsage();
      } catch (failure) {
        if (!mounted.current || attempt.current !== id) return;
        if (failure instanceof DOMException && failure.name === 'AbortError') return;
        setError(failure);
        setQuotaExceeded(isTranscriptionLimitError(failure));
      } finally {
        if (mounted.current && attempt.current === id) {
          running.current = false;
          setStage('idle');
        }
      }
    },
    [available, blockId, createSession, editor, language, reloadUsage, t, transcriptTabIndex]
  );

  useEffect(() => {
    const id = data.transcript_id;

    if (!available || hasTranscript || !id || resumedId.current === id || busy) return;
    if (data.transcription_type !== 'audioFile' && data.transcription_type !== 'urlSource') return;
    resumedId.current = id;
    void run(undefined, id);
  }, [available, busy, data.transcript_id, data.transcription_type, hasTranscript, run]);

  useEffect(() => {
    if (available || !busy) return;
    attempt.current++;
    running.current = false;
    session.current?.suspend();
    setStage('idle');
  }, [available, busy]);

  const cancel = useCallback(async () => {
    const cancelledAttempt = ++attempt.current;

    running.current = false;
    setStage('idle');
    setError(undefined);
    updateMeetingData(editor, blockId, { transcript_id: '', recording_state: 'idle', transcription_type: 'none' });
    try {
      await session.current?.cancel();
    } catch (failure) {
      if (mounted.current && attempt.current === cancelledAttempt) setError(failure);
    }
  }, [blockId, editor]);

  const setLanguage = (next: string) => {
    if (!available || busy) return;
    setLanguageState(next);
    saveDefaultTranscriptLanguage(workspaceId, next);
    updateMeetingData(editor, blockId, { transcript_language: next });
  };

  const errorCode = error instanceof AudioTranscriptionError ? error.code : undefined;
  const errorDetail = error instanceof AudioTranscriptionError ? error.detail : error;
  const message = quotaExceeded
    ? canUpgrade
      ? t('document.aiMeeting.import.limitFree')
      : getErrorMessage(
          errorDetail,
          t(hosted ? 'document.aiMeeting.import.limitPaid' : 'document.aiMeeting.import.limitSelfHosted')
        )
    : errorCode === 'serviceError' && typeof errorDetail === 'string' && errorDetail.trim()
    ? errorDetail
    : errorCode
    ? t(`document.aiMeeting.import.errors.${errorCode}`)
    : error
    ? getErrorMessage(error, t('document.aiMeeting.import.errors.resultFailed'))
    : '';
  // A duration/allowance failure needs a different recording or more minutes.
  // Keep it non-retriable even if a focus refresh finds unused workspace time.
  const canRetry = !quotaExceeded && !recordingTooLong && !isTranscriptionLimitError(error) &&
    (Boolean(session.current?.canRetry) || Boolean(error && !session.current));

  return {
    workspaceId,
    reportError: (failure: AudioTranscriptionError) => {
      setError(failure);
      setErrorDismissed(false);
      setQuotaExceeded(isTranscriptionLimitError(failure));
      setPromotionDismissed(false);
    },
    available,
    busy,
    stage,
    progress,
    error,
    errorDismissed,
    errorCode,
    message,
    usage,
    quotaExceeded,
    showPromotion: needsMoreMinutes && canUpgrade && !promotionDismissed,
    dismissPromotion: () => setPromotionDismissed(true),
    dismissError: () => {
      setError(undefined);
      setErrorDismissed(true);
      // Discard an unsubmitted recording so the next import starts fresh.
      // Persisted transcript jobs retain their existing recovery path.
      if (!busy && !latest.current.data.transcript_id) session.current = undefined;
      if (quotaExceeded) void reloadUsage();
    },
    canRetry,
    retry: () => canRetry ? (session.current?.canRetry ? run() : reloadUsage()) : Promise.resolve(),
    importSource: run,
    cancel,
    language,
    setLanguage,
  };
}

export type AIMeetingImportState = ReturnType<typeof useAIMeetingImport>;
