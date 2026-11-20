import { originalUrl } from './api/index.js';

const BINS = 120;
const cache = new Map();
let queue = Promise.resolve();
let context;

export function audioWaveform(id) {
  if (cache.has(id)) return cache.get(id);
  const job = queue.then(() => readWaveform(id));
  queue = job.catch(() => {});
  cache.set(id, job);
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  job.catch(() => cache.delete(id));
  return job;
}

async function readWaveform(id) {
  const response = await fetch(originalUrl(id), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('无法读取音频');
  context ||= new AudioContext();
  const audio = await context.decodeAudioData(await response.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  const width = Math.max(1, Math.ceil(audio.length / BINS));
  const stride = Math.max(1, Math.floor(width / 128));
  const peaks = Array.from({ length: BINS }, (_, bin) => {
    let peak = 0;
    for (let pos = bin * width; pos < Math.min((bin + 1) * width, audio.length); pos += stride) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[pos]));
    }
    return peak;
  });
  const max = Math.max(...peaks, 0.05);
  return { peaks: peaks.map((peak) => peak / max), duration: audio.duration };
}
