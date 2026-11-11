import { useState } from 'react';
import {
  buildBookMesh,
  meshToStl,
  stlFileName,
  type HookPosition,
  type HookSide,
  type ModelOptions,
} from '../lib/bookModel';
import type { Dims } from '../lib/scales';

interface Props {
  dims: Dims;
  options: ModelOptions;
  onChange: (options: ModelOptions) => void;
  /** Shows the book in the preview's 3D view; `openTab` also brings the preview forward on a phone. */
  onShow3d: (openTab: boolean) => void;
}

/** Free STL of a hardcover mini book sized to the current label, built in the browser. */
export function ModelPanel({ dims, options, onChange, onShow3d }: Props) {
  const [status, setStatus] = useState<'idle' | 'building' | 'failed'>('idle');
  // Changing an option shows the result, so the hook or spine can be seen as it is set.
  const set = (patch: Partial<ModelOptions>) => {
    onChange({ ...options, ...patch });
    onShow3d(false);
  };

  async function download() {
    setStatus('building');
    try {
      const mesh = await buildBookMesh(dims, options, true);
      const url = URL.createObjectURL(new Blob([meshToStl(mesh)], { type: 'model/stl' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = stlFileName(dims, options);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus('idle');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div className="fields">
      <p className="muted">
        A free hardcover book to print and wrap your labels around, sized to the label: {dims.height} x {dims.width} mm
        covers with a {dims.spine} mm spine.
      </p>
      <label className="check">
        <input type="checkbox" checked={options.hook} onChange={(e) => set({ hook: e.target.checked })} />
        Ornament hook on top
      </label>
      {options.hook && (
        <div className="row">
          <label>
            Hook along the top
            <select
              value={options.hookPosition}
              onChange={(e) => set({ hookPosition: e.target.value as HookPosition })}
            >
              <option value="center">Centred</option>
              <option value="spine">Spine corner</option>
              <option value="fore-edge">Fore-edge corner</option>
            </select>
          </label>
          <label>
            Flush with
            <select value={options.hookSide} onChange={(e) => set({ hookSide: e.target.value as HookSide })}>
              <option value="front">Front cover</option>
              <option value="back">Back cover</option>
            </select>
          </label>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={options.roundSpine} onChange={(e) => set({ roundSpine: e.target.checked })} />
        Slightly rounded spine (flat prints best)
      </label>
      <div className="row">
        <button onClick={() => onShow3d(true)}>View in 3D</button>
        <button className="grow" onClick={() => void download()} disabled={status === 'building'}>
          {status === 'building' ? 'Building model' : 'Download STL'}
        </button>
      </div>
      {status === 'failed' && <p className="error">Could not build the model in this browser.</p>}
      <p className="muted find">
        Print it lying on its {options.hook && options.hookSide === 'back' ? 'back' : 'front'} cover, as the file is
        laid out; it needs no supports.
      </p>
    </div>
  );
}
