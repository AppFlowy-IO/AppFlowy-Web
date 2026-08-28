export function normalizeRowDocumentViewName(title: string) {
  return title.trim();
}

export function shouldSyncRowDocumentViewName(lastSyncedTitle: string, title: string) {
  const name = normalizeRowDocumentViewName(title);

  return Boolean(name && name !== lastSyncedTitle);
}
