const SELECTED_WORKSPACE_STORAGE_KEY = 'duplicate_selected_workspace';

export function loadDuplicateSelectedWorkspaceId(): string {
  try {
    return localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveDuplicateSelectedWorkspaceId(workspaceId: string): void {
  try {
    localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    // Selecting a workspace must still work when storage is disabled or full.
  }
}
