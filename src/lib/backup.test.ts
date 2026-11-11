import { describe, expect, it } from 'vitest';
import { backupFileName, makeBackup, parseBackup } from './backup';
import type { SavedState } from './storage';

const state: SavedState = {
  books: [{ id: '0', title: 'Piranesi', authors: 'Susanna Clarke', isbn: '9781635575637', status: 'read', rating: 5, lastRead: '2024-03-09' }],
  filters: { statuses: ['read'], minRating: 0, from: '', to: '', sort: 'rating', count: 20 },
  settings: {
    height: 30,
    width: 20,
    spine: 5,
    style: 'edge',
    paper: 'letter',
    margin: 10,
    gap: 2,
    guideOpacity: 1,
    guideWidth: 0.15,
    model: { hook: true, hookPosition: 'spine', hookSide: 'back', roundSpine: true },
  },
  overrides: { '0': true },
  customCovers: { '0': { url: 'data:image/jpeg;base64,AAAA', wrap: false } },
  panes: { setup: 320 },
};

describe('backups', () => {
  it('round-trip everything, uploaded images included', () => {
    expect(parseBackup(makeBackup(state))).toEqual(state);
  });

  it('are named by local date', () => {
    expect(backupFileName(new Date(2026, 10, 11, 23, 30))).toBe('mini-book-labels-backup-2026-11-11.json');
  });

  it('reject other files with a plain message', () => {
    expect(() => parseBackup('not json')).toThrow(/not a Mini Book Labels backup/);
    expect(() => parseBackup('{"books": []}')).toThrow(/not a Mini Book Labels backup/);
  });

  it('reject backups from a newer version, and damaged book lists', () => {
    const newer = JSON.parse(makeBackup(state));
    expect(() => parseBackup(JSON.stringify({ ...newer, version: 99 }))).toThrow(/newer version/);
    expect(() => parseBackup(JSON.stringify({ ...newer, books: [{ id: 1 }] }))).toThrow(/damaged/);
  });

  it('leave out malformed sections so the app uses its defaults for them', () => {
    const partial = JSON.parse(makeBackup(state));
    const restored = parseBackup(JSON.stringify({ ...partial, settings: 'oops', panes: null }));
    expect(restored.settings).toBeUndefined();
    expect(restored.panes).toBeUndefined();
    expect(restored.books).toEqual(state.books);
  });
});
