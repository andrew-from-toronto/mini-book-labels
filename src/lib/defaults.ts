import { DEFAULT_MODEL_OPTIONS } from './bookModel';
import type { Settings } from './types';

/** The designer's starting settings; the order page uses them for everything an order code leaves out. */
export const DEFAULT_SETTINGS: Settings = {
  height: 30,
  width: 20,
  spine: 5,
  style: 'edge',
  paper: 'letter',
  margin: 10,
  gap: 2,
  guideOpacity: 1,
  guideWidth: 0.15,
  model: DEFAULT_MODEL_OPTIONS,
};
