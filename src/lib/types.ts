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

/** Fractions of an image to trim from each edge, for scans with borders or stray lines. */
export interface Crop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A user-supplied image: either a front cover, or complete back + spine + front artwork. */
export interface CustomCover {
  url: string;
  wrap: boolean;
  /** For wraps: a manual spine position, overriding the detected one. */
  spine?: WrapSpine;
  crop?: Crop;
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

export type HookPosition = 'center' | 'spine' | 'fore-edge';
/** Which cover the hook sits flush with. The book prints lying on that cover. */
export type HookSide = 'front' | 'back';

/** Settings for the 3D printable book. */
export interface ModelOptions {
  hook: boolean;
  hookPosition: HookPosition;
  hookSide: HookSide;
  /** A slight outward bow on the spine. Flat prints best. */
  roundSpine: boolean;
}
export type PaperKey = 'letter' | 'a4';

export interface Settings {
  height: number;
  width: number;
  spine: number;
  style: LabelStyle;
  paper: PaperKey;
  margin: number;
  gap: number;
  /** Opacity (0 to 1) of the on-screen back / spine / front alignment guides. */
  guideOpacity: number;
  /** Thickness in mm of the alignment guide lines, which are centred on the folds. */
  guideWidth: number;
  model: ModelOptions;
}
