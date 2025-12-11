import { ChangeEvent, DragEvent, memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AudioIcon } from '@/assets/icons/audio.svg';
import { ReactComponent as UploadIcon } from '@/assets/icons/upload.svg';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { TranscriptionModel, TranscriptionOptions } from '../services/types';

interface AudioUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File, options: TranscriptionOptions) => Promise<void>;
  isTranscribing: boolean;
  progress?: number;
}

// Supported MIME types - includes video/* for mp4/webm which browsers often report as video
const SUPPORTED_MIME_TYPES = [
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'audio/ogg',
  'audio/mpga',
  // Video MIME types - mp4/webm files are often reported as video/*
  'video/mp4',
  'video/webm',
  'video/mpeg',
];

// Supported file extensions as fallback validation
const SUPPORTED_EXTENSIONS = [
  '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.flac', '.ogg',
];

const MODELS: { value: TranscriptionModel; label: string; description: string }[] = [
  { value: 'whisper-1', label: 'Whisper', description: 'Standard transcription' },
  { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe', description: 'High accuracy' },
  { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini', description: 'Fast transcription' },
  { value: 'gpt-4o-transcribe-diarize', label: 'GPT-4o Diarize', description: 'Speaker identification' },
];

export const AudioUpload = memo(({
  open,
  onOpenChange,
  onUpload,
  isTranscribing,
  progress,
}: AudioUploadProps) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModel] = useState<TranscriptionModel>('gpt-4o-transcribe-diarize');
  const [language, setLanguage] = useState<string>('en');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFile = useCallback((file: File): boolean => {
    // Check file type by MIME type first, then fall back to extension
    const mimeTypeValid = SUPPORTED_MIME_TYPES.includes(file.type);
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    const extensionValid = SUPPORTED_EXTENSIONS.includes(extension);

    if (!mimeTypeValid && !extensionValid) {
      setError(t('aiMeeting.upload.invalidFormat', 'Unsupported audio format. Please use MP3, MP4, WAV, M4A, WEBM, FLAC, or OGG.'));
      return false;
    }

    // Check file size (25MB for Whisper)
    const maxSize = 25 * 1024 * 1024;

    if (file.size > maxSize) {
      setError(t('aiMeeting.upload.fileTooLarge', 'File is too large. Maximum size is 25MB.'));
      return false;
    }

    setError(null);
    return true;
  }, [t]);

  const handleFileSelect = useCallback((file: File) => {
    if (validateFile(file)) {
      setSelectedFile(file);
    }
  }, [validateFile]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];

    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    const options: TranscriptionOptions = {
      model: selectedModel,
      language: language || undefined,
      response_format: selectedModel === 'gpt-4o-transcribe-diarize' ? 'diarized_json' : 'verbose_json',
    };

    try {
      await onUpload(selectedFile, options);
      onOpenChange(false);
      setSelectedFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transcribe audio');
    }
  }, [selectedFile, selectedModel, language, onUpload, onOpenChange]);

  const handleClose = useCallback(() => {
    if (!isTranscribing) {
      onOpenChange(false);
      setSelectedFile(null);
      setError(null);
    }
  }, [isTranscribing, onOpenChange]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('aiMeeting.upload.title', 'Upload Audio')}</DialogTitle>
          <DialogDescription>
            {t('aiMeeting.upload.description', 'Upload an audio file to transcribe. Supports MP3, WAV, M4A, and other formats.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-4">
          {/* Drop Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
              isDragging
                ? 'border-fill-theme-thick bg-fill-list-active'
                : 'border-line-divider hover:border-line-border',
              isTranscribing && 'pointer-events-none opacity-50'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={[...SUPPORTED_MIME_TYPES, ...SUPPORTED_EXTENSIONS].join(',')}
              onChange={handleInputChange}
              className="hidden"
              disabled={isTranscribing}
            />

            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <AudioIcon className="h-8 w-8 text-fill-theme-thick" />
                <div className="text-left">
                  <p className="font-medium text-text-primary">{selectedFile.name}</p>
                  <p className="text-sm text-text-secondary">{formatFileSize(selectedFile.size)}</p>
                </div>
              </div>
            ) : (
              <>
                <UploadIcon className="h-10 w-10 mx-auto text-text-tertiary mb-2" />
                <p className="text-text-secondary">
                  {t('aiMeeting.upload.dropzone', 'Drop audio file here or click to browse')}
                </p>
                <p className="text-sm text-text-tertiary mt-1">
                  {t('aiMeeting.upload.maxSize', 'Max file size: 25MB')}
                </p>
              </>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Transcription Progress */}
          {isTranscribing && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">{t('aiMeeting.upload.transcribing', 'Transcribing...')}</span>
                {progress !== undefined && <span className="text-text-primary">{progress}%</span>}
              </div>
              <div className="h-2 bg-fill-list-hover rounded-full overflow-hidden">
                <div
                  className="h-full bg-fill-theme-thick transition-all duration-300"
                  style={{ width: progress !== undefined ? `${progress}%` : '50%' }}
                />
              </div>
            </div>
          )}

          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('aiMeeting.upload.model', 'Transcription Model')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {MODELS.map((model) => (
                <button
                  key={model.value}
                  onClick={() => setSelectedModel(model.value)}
                  disabled={isTranscribing}
                  className={cn(
                    'p-3 text-left rounded-lg border transition-colors',
                    selectedModel === model.value
                      ? 'border-fill-theme-thick bg-fill-list-active'
                      : 'border-line-divider hover:border-line-border',
                    isTranscribing && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <p className="text-sm font-medium text-text-primary">{model.label}</p>
                  <p className="text-xs text-text-tertiary">{model.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Language Selection */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('aiMeeting.upload.language', 'Language (optional)')}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isTranscribing}
              className={cn(
                'w-full px-3 py-2 rounded-lg border border-line-divider bg-bg-body text-text-primary',
                'focus:outline-none focus:border-fill-theme-thick',
                isTranscribing && 'opacity-50 cursor-not-allowed'
              )}
            >
              <option value="">Auto-detect</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="nl">Dutch</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isTranscribing}>
            {t('button.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isTranscribing}
          >
            {isTranscribing
              ? t('aiMeeting.upload.transcribing', 'Transcribing...')
              : t('aiMeeting.upload.transcribe', 'Transcribe')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

AudioUpload.displayName = 'AudioUpload';

export default AudioUpload;
