export type ButtonLocation = { type: 'url'; url: string } | { type: 'page'; view_id: string };
export type ButtonOpenTarget = ButtonLocation | { type: 'created_row'; action_index: number };
export type ButtonResultTarget = ButtonLocation | { type: 'row'; database_id: string; view_id: string; row_id: string };

const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) &&
  v !== '00000000-0000-0000-0000-000000000000';

export function validButtonText(value: string, limit: number) {
  return [...value.trim()].length <= limit && !/\p{Cc}/u.test(value);
}

export function validButtonUrl(value: unknown): value is string {
  if (typeof value !== 'string' || new Blob([value]).size > 2048 || !/^https?:\/\//i.test(value)) return false;
  if (/[\p{Cc}\p{White_Space}\\]/u.test(value)) return false;
  if (
    value
      .slice(value.indexOf('//') + 2)
      .split(/[/?#]/, 1)[0]
      .includes('@')
  )
    return false;
  try {
    const url = new URL(value);

    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function location(raw: Record<string, unknown>): ButtonLocation | undefined {
  if (Object.keys(raw).length !== 2) return;
  if (raw.type === 'page' && id(raw.view_id)) return { type: 'page', view_id: raw.view_id };
  if (raw.type === 'url' && validButtonUrl(raw.url)) return { type: 'url', url: raw.url };
}

export function readButtonOpenTarget(input: unknown): ButtonOpenTarget | undefined {
  if (!input || typeof input !== 'object') return;
  const raw = input as Record<string, unknown>;

  if (
    Object.keys(raw).length === 2 &&
    raw.type === 'created_row' &&
    Number.isInteger(raw.action_index) &&
    Number(raw.action_index) >= 0 &&
    Number(raw.action_index) < 5
  )
    return { type: 'created_row', action_index: Number(raw.action_index) };
  return location(raw);
}

export function readButtonResultTarget(input: unknown): ButtonResultTarget | undefined {
  if (!input || typeof input !== 'object') return;
  const raw = input as Record<string, unknown>;

  if (Object.keys(raw).length === 4 && raw.type === 'row' && id(raw.database_id) && id(raw.view_id) && id(raw.row_id)) {
    return { type: 'row', database_id: raw.database_id, view_id: raw.view_id, row_id: raw.row_id };
  }

  return location(raw);
}
