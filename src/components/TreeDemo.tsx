import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { sampleLibrary } from '../lib/sample';
import { dimsAtScale, scaleForTree } from '../lib/scales';
import { TREE_SIZES } from '../lib/tree';
import { useCovers } from '../lib/useCovers';
import '../viewer.css';

const Tree3D = lazy(() => import('./Tree3D'));

/** How many of the app's sample books hang on the guides' tree. */
const BOOKS = 24;
const NO_CUSTOM = {};

/**
 * The app's tree view on a guide page: the app's own sample books, with real covers, on a tree the
 * visitor can turn and resize. The books are sized to suit the tree, as the guide recommends.
 */
export default function TreeDemo() {
  const books = useMemo(() => sampleLibrary(BOOKS, 0), []);
  const coverOf = useCovers(books, NO_CUSTOM);
  const [scale, setScale] = useState(() => scaleForTree(TREE_SIZES.tabletop.height));
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...dimsAtScale(scale) }), [scale]);
  const onTreeHeight = useCallback((metres: number) => {
    setScale(scaleForTree(metres));
  }, []);
  const embedded = useMemo(() => ({ size: 'tabletop' as const, lights: 'warm' as const, baubles: 'none' as const, onTreeHeight }), [onTreeHeight]);
  const { height, width } = settings;

  return (
    <>
      <Suspense fallback={<div className="tree-demo-loading">Building the tree...</div>}>
        <Tree3D books={books} coverOf={coverOf} customCovers={NO_CUSTOM} settings={settings} embedded={embedded} />
      </Suspense>
      <p className="tree-demo-note">
        Ornaments at 1:{scale} ({height} x {width} mm)
      </p>
    </>
  );
}
