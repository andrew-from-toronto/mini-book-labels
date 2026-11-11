/** Hands the browser a file to save, as if a download link had been clicked. */
export function saveFile(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Some browsers read the URL after click() returns, so it is released a little later.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
