// On the guide pages: swaps the tree picture for the app's live 3D tree once it scrolls near. three.js
// and React load only then, and only where WebGL works; anywhere else the picture stays.

function webgl(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function mount(stage: HTMLElement) {
  const [{ createElement }, { createRoot }, { default: TreeDemo }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('./components/TreeDemo'),
  ]);
  stage.replaceChildren();
  stage.classList.add('live');
  createRoot(stage).render(createElement(TreeDemo));
}

const stage = document.querySelector<HTMLElement>('[data-tree-demo]');
if (stage && webgl()) {
  const seen = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      // A failed load leaves the picture in place.
      mount(stage).catch(() => {});
    },
    { rootMargin: '600px 0px' },
  );
  seen.observe(stage);
}
