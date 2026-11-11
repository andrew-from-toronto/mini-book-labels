/**
 * Backup and restore. Everything the app keeps lives in this browser's local storage, which clearing
 * site data wipes; a backup file keeps it safe and moves it to another browser or computer.
 */
import type { SavedState } from './storage';

const FORMAT = 'mini-book-labels-backup';
/** Bump when the saved shape changes in a way older copies of the app cannot read. */
const VERSION = 1;

export function makeBackup(state: SavedState, now = new Date()): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, savedAt: now.toISOString(), ...state });
}

export function backupFileName(now = new Date()): string {
  // Local date, which is what the person saving it will recognise.
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `mini-book-labels-backup-${date}.json`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads a backup back, checking it is one before anything is replaced. Missing or malformed sections
 * come back empty, so the app falls back to its defaults for them; the books themselves must be valid.
 */
export function parseBackup(text: string): Partial<SavedState> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a Mini Book Labels backup.');
  }
  if (!isObject(data) || data.format !== FORMAT) throw new Error('That file is not a Mini Book Labels backup.');
  if (typeof data.version !== 'number' || data.version > VERSION) {
    throw new Error('That backup was made by a newer version of the app. Reload the page and try again.');
  }
  const books = data.books;
  if (
    !Array.isArray(books) ||
    !books.every((b) => isObject(b) && typeof b.id === 'string' && typeof b.title === 'string')
  ) {
    throw new Error('That backup is damaged: its book list cannot be read.');
  }
  return {
    books: books as SavedState['books'],
    ...(isObject(data.filters) && { filters: data.filters as unknown as SavedState['filters'] }),
    ...(isObject(data.settings) && { settings: data.settings as unknown as SavedState['settings'] }),
    ...(isObject(data.overrides) && { overrides: data.overrides as SavedState['overrides'] }),
    ...(isObject(data.customCovers) && { customCovers: data.customCovers as SavedState['customCovers'] }),
    ...(isObject(data.panes) && { panes: data.panes as SavedState['panes'] }),
  };
}
