const groups = {
  audio: 'mp3 m4a aac wav ogg oga opus flac aif aiff',
  video: 'mov mp4 m4v webm ogv mkv avi mpeg mpg',
  image: 'jpg jpeg jfif png webp gif svg bmp avif ico tif tiff heic heif',
};
const kinds = Object.fromEntries(Object.entries(groups).flatMap(([kind, extensions]) =>
  extensions.split(' ').map(ext => [ext, kind])));

export function displayAsset(asset) {
  const ext = String(asset.ext || '');
  return { ...asset, ext, kind: kinds[ext.toLowerCase()] || 'file' };
}

export function layOutShelf(assets, pixelWidth) {
  const margin = 16;
  const gutter = 10;
  const available = Math.max(100, pixelWidth - margin * 2);
  const lanes = Math.max(1, Math.floor((available + gutter) / 218));
  const width = Math.floor((available + gutter) / lanes) - gutter;
  const ends = Array(lanes).fill(margin);
  const positions = [];
  for (const asset of assets) {
    let nextLane = 0;
    for (let i = 1; i < lanes; i++) {
      if (ends[i] < ends[nextLane]) nextLane = i;
    }
    let height = 56;
    if (asset.kind === 'audio') height = 112;
    if (asset.kind === 'image' || asset.kind === 'video') {
      const ratio = asset.height > 0 && asset.width > 0 ? asset.height / asset.width : 0.6;
      height = Math.max(64, Math.min(540, Math.round(width * ratio)));
    }
    const top = ends[nextLane];
    positions.push({ asset, top, height, width, left: margin + nextLane * (width + gutter) });
    ends[nextLane] += height + gutter;
  }
  return { positions, height: Math.max(...ends) + margin - gutter };
}
