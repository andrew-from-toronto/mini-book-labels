export type ReadStatus = string;

export interface Book {
  id: string;
  title: string;
  authors: string;
  isbn: string | null;
  status: ReadStatus;
  rating: number | null;
  /** ISO yyyy-mm-dd */
  lastRead: string | null;
}

export type SortKey = 'rating' | 'date-read' | 'title';

export interface Filters {
  statuses: ReadStatus[];
  minRating: number;
  from: string;
  to: string;
  sort: SortKey;
  count: number;
}

export type LabelStyle = 'edge' | 'blur';
export type PaperKey = 'letter' | 'a4';

export interface Settings {
  height: number;
  width: number;
  spine: number;
  style: LabelStyle;
  paper: PaperKey;
  margin: number;
  gap: number;
}
