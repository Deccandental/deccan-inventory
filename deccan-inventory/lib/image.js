// Resize + re-encode an image in the browser before upload.
// Falls back to the original file if anything goes wrong (e.g. HEIC that
// the canvas can't decode). Keeps stored photos small (~150-300 KB).
export async function compressImage(file, maxDim = 1200, quality = 0.82) {
  try {
    if (!file.type || !file.type.startsWith('image/')) return file;
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
    });
    let w = img.width, h = img.height;
    if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch (_) {
    return file;
  }
}
