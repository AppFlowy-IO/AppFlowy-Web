let active: { owner: object; signal?: AbortSignal } | undefined;

/** File imports and live meetings share Flutter's single-transcription guard. */
export function hasActiveTranscription() {
  return Boolean(active && !active.signal?.aborted);
}

export function acquireTranscription(owner: object, signal?: AbortSignal) {
  if (hasActiveTranscription()) return false;
  active = { owner, signal };
  return true;
}

export function releaseTranscription(owner: object) {
  if (active?.owner === owner) active = undefined;
}
