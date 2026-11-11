# Mini Book Labels

Printable wraparound labels (back, spine, front) for 3D printed miniature books, built from your StoryGraph or Goodreads library.

Live app: https://andrew-from-toronto.github.io/mini-book-labels/

## How it works

1. Export your library as a CSV. On StoryGraph: Manage Account, then Export StoryGraph Library. On Goodreads: My Books, then Import and export, then Export Library.
2. Drop the CSV into the app (or press "Try a sample" to load a random handful of popular books and see how it works); it works out which site it came from. It is parsed in your browser and never uploaded anywhere. You can also search for any book by title, author or ISBN and add it, with or without a CSV.
3. Filter by read status, star rating and date read, pick how many books you want, and tick or untick individual books.
4. Pick a scale (1:4 to 1:24, based on a 210 x 140 x 35 mm paperback) or set your own label size in millimetres, and pick a spine/back style. Click any book to edit its cover; the print preview zooms to that label, and Expand opens the full preview.
5. Print at 100% scale. Each page has a 50 mm ruler so you can check the scale before cutting.

Your library, selections, covers and settings are saved in your browser's local storage, so a refresh or restart picks up where you left off. "Back up" saves all of it, uploaded images included, to a file that "Restore" loads again, in this browser or another. "Start over" clears it.

Front covers come from [Open Library Covers](https://openlibrary.org/dev/docs/api/covers), looked up by ISBN and then by title and author. Books with no cover get a generated typographic one. Opening a book shows the covers of its other editions on Open Library to pick from instead, and any cover can be replaced with your own image. The spine and back are generated from the front cover.

If you have complete artwork for a book (one image with back, spine and front, as often found on Pinterest), use Replace cover, tick "Image is the full wrap" and paste the image link or upload the file. The same panel has search links to Pinterest and Google Images for the book. The app finds the spine in the artwork (by its fold lines, or by the empty gutter beside the spine text; failing both, it estimates the width from the book's page count), then stretches the back, spine and front each onto the matching part of the label. If it gets the spine wrong, two sliders set its width and position by hand. Thin stray borders on images you supply (a white scan margin, a grey line along one edge) are trimmed automatically, unless the cover itself is mostly that colour; sliders let you trim by hand instead.

Pasted image links that the browser is not allowed to read (Pinterest, for example) are reloaded through the [wsrv.nl](https://wsrv.nl) image proxy so the spine and colours can be detected. Only the image address is sent there. Pinterest links are also upgraded to the original upload where it can be found, or else the 1200 px wide copy, before loading.

Neither StoryGraph nor Goodreads has a public API for this, which is why the app uses the CSV exports.

## 3D model

Section 5 of the app offers a free 3MF (or STL) of a hardcover mini book sized to your label, built in your browser with [Manifold](https://github.com/elalish/manifold), and the preview's 3D view shows it with the label wrapped on. Options:

- **Ornament hook:** centred, or at the spine or fore-edge corner of the top. Its 1.6 mm hole stays the same size at every scale.
- **Spine:** flat, which prints best, or slightly rounded.

The page edges have grooves so they read as pages. The model prints lying on its front cover with no supports: the page lines then follow the print layers, the back cover's overhang has a 45 degree bevel under it, and the hook sits flush with the front cover.

## Development

```
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm screens
```

`pnpm screens` runs the app in Chromium through [Playwright](https://playwright.dev) at desktop, tablet and phone sizes and saves screenshots of its main states to `screens/`, for checking layout changes. The first time, install the browser with `pnpm exec playwright install chromium`.

Pushing to `main` deploys to GitHub Pages.

## Support

If this saved you some fiddly cutting and pasting, you can [buy me a coffee](https://buymeacoffee.com/andrew.from.toronto).

## License

[AGPL-3.0](LICENSE)
