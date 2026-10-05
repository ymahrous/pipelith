/** Trigger a browser download of generated content. Nothing is uploaded anywhere. */
export function downloadBlob(name: string, data: BlobPart, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** File-name-safe slug for downloads. */
export function slug(s: string, fallback = "program") {
  const v = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return v || fallback;
}

/** Read a user-picked file as text with a size cap. */
export async function readTextFile(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`${file.name} is ${(file.size / 1024).toFixed(0)} KB; the limit is ${(maxBytes / 1024).toFixed(0)} KB.`);
  }
  return file.text();
}
