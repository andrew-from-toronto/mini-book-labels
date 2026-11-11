import { buildBookMesh, meshToStl, modelFileName } from './bookModel';
import { saveFile } from './download';
import type { Dims } from './scales';
import { meshTo3mf } from './threeMf';
import type { ModelOptions } from './types';

export type ModelFormat = '3mf' | 'stl';

/** Builds the printable book in the browser and saves it. Returns the file name. */
export async function downloadModel(dims: Dims, options: ModelOptions, format: ModelFormat): Promise<string> {
  const mesh = await buildBookMesh(dims, options, true);
  const name = modelFileName(dims, options, format);
  if (format === '3mf') {
    saveFile(meshTo3mf(mesh, `Mini book ${dims.height} x ${dims.width} x ${dims.spine} mm`), name, 'model/3mf');
  } else {
    saveFile(meshToStl(mesh), name, 'model/stl');
  }
  return name;
}
