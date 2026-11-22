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

export function formatTime(value) {
  const seconds = Math.floor(value);
  return [Math.floor(seconds / 60), seconds % 60].map(part => String(part).padStart(2, '0')).join(':');
}

export function defaultView(folder, assets) {
  if (folder.id === '__trash__') return 'list';
  if (folder.id === '__all__') return 'waterfall';
  const audioFolder = /^(bgm|sfx)(?:$|[^a-z])|音乐|配乐|音效|音频/i.test(folder.name) ||
    kinds[folder.extension?.toLowerCase()] === 'audio';
  return audioFolder || (assets.length && assets.every(asset => asset.kind === 'audio')) ? 'waveform' : 'waterfall';
}

export function layOutRows(assets, pixelWidth, height) {
  const margin = 16;
  const width = Math.max(0, pixelWidth - margin * 2);
  const positions = assets.map((asset, index) => ({ asset, left: margin, top: index * height, width, height }));
  return { positions, height: assets.length * height };
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
      height = Math.max(64, Math.min(480, Math.round(width * ratio))) + 35;
    }
    const top = ends[nextLane];
    positions.push({ asset, top, height, width, left: margin + nextLane * (width + gutter) });
    ends[nextLane] += height + gutter;
  }
  return { positions, height: Math.max(...ends) + margin - gutter };
}
