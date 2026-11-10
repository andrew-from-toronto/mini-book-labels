# Mini Book Labels

Printable wraparound labels (back, spine, front) for 3D printed miniature books, built from your StoryGraph library.

Live app: https://andrew-from-toronto.github.io/mini-book-labels/

## How it works

1. On StoryGraph, go to Manage Account, then Export StoryGraph Library, and download the CSV.
2. Drop the CSV into the app. It is parsed in your browser and never uploaded anywhere. You can also add any book by ISBN, with or without a CSV.
3. Filter by read status, star rating and date read, pick how many books you want, and tick or untick individual books.
4. Set your label size in millimetres (cover height, cover width, spine thickness) and pick a spine/back style.
5. Print at 100% scale. Each page has a 50 mm ruler so you can check the scale before cutting.

Your library, selections, covers and settings are saved in your browser's local storage, so a refresh or restart picks up where you left off. "Start over" clears it.

Front covers come from [Open Library Covers](https://openlibrary.org/dev/docs/api/covers), looked up by ISBN and then by title and author. Books with no cover get a generated typographic one, and any cover can be replaced with your own image. The spine and back are generated from the front cover.

If you have complete artwork for a book (one image with back, spine and front, as often found on Pinterest), use Replace cover, tick "Image is the full wrap" and paste the image link or upload the file. The same panel has search links to Pinterest and Google Images for the book. The app finds the spine in the artwork, then stretches the back, spine and front each onto the matching part of the label. If it gets the spine wrong, two sliders set its width and position by hand.

Pasted image links that the browser is not allowed to read (Pinterest, for example) are reloaded through the [wsrv.nl](https://wsrv.nl) image proxy so the spine and colours can be detected. Only the image address is sent there.

StoryGraph has no public API, which is why this uses the CSV export.

## Development

```
pnpm install
pnpm dev
pnpm test
pnpm build
```

Pushing to `main` deploys to GitHub Pages.

## Support

If this saved you some fiddly cutting and pasting, you can [buy me a coffee](https://buymeacoffee.com/andrew.from.toronto).

## License

[AGPL-3.0](LICENSE)
