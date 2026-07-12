export function normalizeRowDocumentViewName(title: string) {
  return title.trim();
}

export interface RowDocumentViewNameBaseline {
  documentId: string;
  title: string;
}

export function createRowDocumentViewNameBaseline(documentId: string, title: string): RowDocumentViewNameBaseline {
  return {
    documentId,
    title: normalizeRowDocumentViewName(title),
  };
}

export function shouldSyncRowDocumentViewName(lastSyncedTitle: string, title: string) {
  const name = normalizeRowDocumentViewName(title);

  return Boolean(name && name !== lastSyncedTitle);
}
