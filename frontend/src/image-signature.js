import { originalUrl, thumbnailUrl } from './api/index.js';

async function loadImage(asset) {
  for (const url of asset.hasThumbnail ? [thumbnailUrl(asset.id), originalUrl(asset.id)] : [originalUrl(asset.id)]) {
    try {
      // SVG can be drawn to a canvas from an image element. ImageBitmap only decodes raster files here.
      if (asset.ext?.toLowerCase() === 'svg') {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (response.ok) return await createImageBitmap(await response.blob());
    } catch {
      // Try the original when the thumbnail cannot be loaded or decoded.
    }
  }
  throw new Error('Image is unavailable');
}

export async function imageSignature(asset) {
  const image = await loadImage(asset);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 9, 8);
    context.drawImage(image, 0, 0, 9, 8);
    const rgba = context.getImageData(0, 0, 9, 8).data;
    let hash = 0n;
    let red = 0;
    let green = 0;
    let blue = 0;
    const luminance = (offset) => rgba[offset] * 299 + rgba[offset + 1] * 587 + rgba[offset + 2] * 114;
    for (let i = 0; i < 72; i++) {
      const offset = i * 4;
      red += rgba[offset];
      green += rgba[offset + 1];
      blue += rgba[offset + 2];
      if (i % 9 !== 8) hash = (hash << 1n) | BigInt(luminance(offset) > luminance(offset + 4));
    }
    return { id: asset.id, hash: hash.toString(16).padStart(16, '0'),
      ratio: asset.width > 0 && asset.height > 0 ? asset.width / asset.height : image.width / image.height,
      red: Math.round(red / 72), green: Math.round(green / 72), blue: Math.round(blue / 72) };
  } finally {
    image.close?.();
  }
}
