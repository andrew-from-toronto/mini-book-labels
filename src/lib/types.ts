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

/** Where the spine sits in wrap artwork, as fractions of the image width. */
export interface WrapSpine {
  left: number;
  right: number;
}

/** A user-supplied image: either a front cover, or complete back + spine + front artwork. */
export interface CustomCover {
  url: string;
  wrap: boolean;
  /** For wraps: a manual spine position, overriding the detected one. */
  spine?: WrapSpine;
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
