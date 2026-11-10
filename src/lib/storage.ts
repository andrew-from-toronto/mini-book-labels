import type { Book, CustomCover, Filters, Settings } from './types';

const KEY = 'mini-book-labels:v1';

export interface SavedState {
  books: Book[];
  filters: Filters;
  settings: Settings;
  overrides: Record<string, boolean>;
  customCovers: Record<string, CustomCover>;
  panes: Panes;
}

/** Column widths in px set by dragging the handles. Unset means the responsive default. */
export interface Panes {
  setup?: number;
  preview?: number;
}

export function loadState(): Partial<SavedState> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveState(state: SavedState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Usually the storage quota: uploaded images are the bulk, so save everything except those.
    const linksOnly = Object.entries(state.customCovers).filter(([, c]) => !c.url.startsWith('data:'));
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, customCovers: Object.fromEntries(linksOnly) }));
    } catch {
      /* storage unavailable (private window, blocked site data): the app works without it */
    }
  }
}
