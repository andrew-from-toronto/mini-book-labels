# Mini Book Labels

Printable wraparound labels (back, spine, front) for 3D printed miniature books, built from your StoryGraph or Goodreads library.

Live app: https://minibookornaments.com/

## How it works

1. Export your library as a CSV. On StoryGraph: Manage Account, then Export StoryGraph Library. On Goodreads: My Books, then Import and export, then Export Library.
2. Drop the CSV into the app (or press "Try a sample" to load a random handful of popular books and see how it works); it works out which site it came from. It is parsed in your browser and never uploaded anywhere. You can also search for any book by title, author or ISBN and add it, with or without a CSV. A book the search does not find can be added as a blank book: it is never looked up, you set its title and author, and it gets your own cover image or a plain generated one.
3. Filter by read status, star rating and date read, pick how many books you want, tick or untick individual books, and drag them into the order you want them on the sheet.
4. Pick a scale (1:4 to 1:24, based on a 210 x 140 x 35 mm paperback) or set your own label size in millimetres, and pick a spine/back style. Click any book to edit its cover; the print preview zooms to that label, and Expand opens the full preview.
5. Print at 100% scale. Each page has a 50 mm ruler so you can check the scale before cutting. Or make a file for a print shop or a cutting machine instead (below).

Your library, selections, covers and settings are saved in your browser's local storage, so a refresh or restart picks up where you left off. "Back up" saves all of it, uploaded images included, to a file that "Restore" loads again, in this browser or another. "Start over" clears it.

Front covers come from [Open Library Covers](https://openlibrary.org/dev/docs/api/covers), looked up by ISBN and then by title and author. Books with no cover get a generated typographic one. Opening a book shows the covers of its other editions on Open Library to pick from instead, and any cover can be replaced with your own image. The spine and back are generated from the front cover.

The Tree view hangs the books on the sheet on a pre-lit Christmas tree, in the sizes trees are sold in (2 ft tabletop, 4, 6, 7.5 and 9 ft, with centimetres alongside, or a custom height from 1 to 12 ft in feet or centimetres), with warm white or coloured lights and a choice of glass baubles (or none); Shuffle rehangs them. Each book is the printed model with its label, hung by the hole in its hook (or from the middle of its top without one) from the tip of a real needle spray, which bends under its weight. Physics runs in real time (`src/lib/hanging.ts`): weight and centre of mass come from the model and the same filament figures as the price; each ornament is a pendulum on its hole, so a corner hook hangs it tilted; it rests against the tree rather than passing into it, held by the needles' friction, and always cover out; ornaments never overlap; and needles and low branches give way round ornaments and the presents. Change the hook and each book swings to its new balance; turn the tree and everything sways. The tree, its lights, presents and hanging places are in `src/lib/tree.ts`; the scene (a lamp casting shadows, twinkling bulbs that light what is near them, a room around it) is `src/components/Tree3D.tsx`. Double-click a book to look closer, or open it in the book list and the camera flies to its ornament (and back out when it is closed).

The back cover can be placeholder blurb and a barcode, the front cover's artwork (mirrored and softened by default, so it reads as artwork continuing round the book), your own star rating and the month you finished the book, or plain. A details panel controls the rest: for the artwork, mirroring and flipping (either or both), zoom and which part of the cover (by default the part with the least lettering), blur, darkening, shading into the spine, grain, and carrying the artwork across the spine; for the notes, which notes show; and for every back, the barcode and the spine's title and author (`src/lib/back.ts`). Labels redraw a few per frame (`src/lib/drawQueue.ts`), at preview resolution while being edited and at print resolution once edits pause or the sheet is printed, so sliders stay smooth with many labels.

If you have complete artwork for a book (one image with back, spine and front, as often found on Pinterest), use Replace cover, tick "Image is the full wrap" and paste the image link or upload the file. The same panel has search links to Pinterest and Google Images for the book. The app finds the spine in the artwork (by its fold lines, or by the empty gutter beside the spine text; failing both, it estimates the width from the book's page count), then stretches the back, spine and front each onto the matching part of the label. If it gets the spine wrong, two sliders set its width and position by hand. Thin stray borders (a white scan margin, a grey line along one edge) are trimmed automatically, as are thicker white bars on both opposite edges of a coloured cover that was padded out to another shape, unless the cover itself is mostly that colour. This applies to looked-up covers and to images you supply; for the latter, sliders let you trim by hand instead.

Pasted image links that the browser is not allowed to read (Pinterest, for example) are reloaded through the [wsrv.nl](https://wsrv.nl) image proxy so the spine and colours can be detected. Only the image address is sent there. Pinterest links are also upgraded to the original upload where it can be found, or else the 1200 px wide copy, before loading.

Neither StoryGraph nor Goodreads has a public API for this, which is why the app uses the CSV exports.

## Print shops and cutting machines

Under Print, "Print with" picks where the sheet goes; the preview shows that sheet, with each label's bleed, cut line and safe zone.

- **A print shop (PDF)** makes two files in the browser: a print file and a proof. The print file has one page per sheet, the sheet's own size (Letter by default; A4, Legal, 11 × 17, 12 × 18, 13 × 19, SRA3 or custom). Each label carries bleed past its cut line, filled from its own edges: more of the cover artwork where the image has it, otherwise the edge mirrored (or stretched). Each label's cut line is a closed hairline path set to overprint, on its own layer, in a spot colour (`CutContour` by default) or 100% magenta or cyan. Kiss cut or die cut picks which of the two cut lines the labels use; a thru-cut round the sheet's edge is optional. Labels sit at least twice the bleed apart, or touching with one cut line between. Crop marks (registration colour) and a slug line (the sheet's details, set as outlines in black) are optional; nothing in the file needs a font. Images are RGB tagged sRGB (JPEG or lossless, about 600 dpi), or CMYK through LittleCMS with GRACoL 2013, FOGRA39 or the shop's own `.icc`, lossless at 400 dpi, with the profile as the output intent. The proof starts with a page of the settings and anything worth checking (text inside the safe zone, labels too small, margins too narrow for marks), then shows each sheet with its cut line, bleed edge and safe zone drawn on.
- **Shop setups** fill the bleed, safe zone, cut line colours, layer names and least spacing for a shop's conventions: generic `CutContour` (1/8 in bleed, the usual RIP convention), UPrinting (magenta kiss cut, cyan thru-cut), Jukebox (Kiss Cut, Thru-Cut and Artwork layers, 1.5 mm between cuts) and Sticker Mule (magenta cut line, 1/16 in bleed). Changing any of those makes the setup Custom.
- **Cricut Print Then Cut** makes a PNG per batch at 300 dpi: labels at trim size with clear gaps, each batch within Cricut's 6.75 × 9.25 in print area, and the width to set in Design Space (also in the file name and a README). Design Space adds the bleed and its marks.
- **Silhouette Print & Cut** makes, per page, a PNG with bleed, its cut lines as DXF, and both together as SVG, with labels kept clear of the registration marks Studio adds.

The Cricut and Silhouette files are untested on real machines.

The PDF writer (`src/lib/pdf/`) is written for this, with no PDF library. Layout is `sheetLayout` in `src/lib/layout.ts`, bleed is `src/lib/bleed.ts`, settings and shop setups are `src/lib/output.ts`, and the downloads are made in `src/lib/printFiles.ts`. LittleCMS ([lcms-wasm](https://github.com/mattdesl/lcms-wasm)), [opentype.js](https://opentype.js.org) and the Inter font load only when a file is made. The colour profiles in `public/icc/` are redistributed unaltered under their own terms, in `public/icc/LICENSES.md`.

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

Each build writes `version.json` with its id. Open pages check it when their tab comes back into view and every 15 minutes, and offer a Reload when a newer build is out (`src/lib/updates.ts`); they never reload on their own. Files in `/assets` are named by content hash and cached for good (`public/_headers`); pages are checked on every load.

`mini-book-ornaments/index.html` is a static how-to guide, built as a second page so search engines can read it without running the app. `pnpm og` regenerates `public/og-image.png`, the picture shown when the site is shared, from the app's own 3D view.

`pnpm screens` runs the app in Chromium through [Playwright](https://playwright.dev) at desktop, tablet and phone sizes and saves screenshots of its main states to `screens/`, for checking layout changes. The first time, install the browsers with `pnpm exec playwright install chromium webkit`. `SITE=https://minibookornaments.com/ pnpm screens` runs the same checks against the live site. `pnpm test:interactions` checks dragging cards into order, adding a blank book and the new-version banner in Chromium (Chrome and Edge), Firefox and WebKit (Safari), by mouse and by finger; it needs `pnpm exec playwright install chromium firefox webkit`.

Pushing to `main` deploys to Cloudflare: one Worker (`wrangler.jsonc`, `worker/`) serves the built site and `/api`, which passes Open Library requests through with edge caching and proxies pasted artwork. `pnpm dev` runs the Worker locally too. GitHub Pages only serves a redirect from the old `github.io` address.

## Support

If this saved you some fiddly cutting and pasting, you can [buy me a coffee](https://minibookornaments.com) (in the footer).

## License

[AGPL-3.0](LICENSE)
