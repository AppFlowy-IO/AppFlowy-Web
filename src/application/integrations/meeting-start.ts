// A local user action may open the audio-source chooser after navigation. This
// intent is never synced into a document, where it could record a collaborator.
const starts = new Set<string>();

export function requestMeetingStart(viewId: string) {
  starts.add(viewId);
}

export function consumeMeetingStart(viewId: string) {
  return starts.delete(viewId);
}
