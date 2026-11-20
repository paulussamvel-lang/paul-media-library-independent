const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../chrome-extension/manifest.json');
const { OrganizationError } = require('./organizer');
const { IngestStore, sha } = require('./ingest');
const { readUploadHeader, spoolUpload } = require('./upload-stream');

const alphabet = 'abcdefghijklmnop';
const fingerprint = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex');
const extensionOrigin = 'chrome-extension://' + [...fingerprint.slice(0, 32)].map((n) => alphabet[parseInt(n, 16)]).join('');
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const LOCAL_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'aif', 'aiff', 'ogg', 'oga', 'opus', 'flac',
  'mp4', 'mov', 'm4v', 'webm', 'zip', 'txt']);

class CaptureStore {
  constructor(db, library) {
    this.ingest = new IngestStore(db, library);
    this.uploading = new Set();
    this.findFolder = db.prepare('SELECT 1 FROM folders WHERE id = ?');
    this.tags = db.prepare('SELECT DISTINCT tag FROM asset_tags ORDER BY tag COLLATE NOCASE, tag');
  }

  prepare({ requestId, name, sourceUrl, folderId, tags, width, height, extension } = {}, local = false) {
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(requestId)) {
      throw new OrganizationError('导入会话无效，请重新选择素材。');
    }
    const id = `capture-${requestId.replaceAll('-', '')}`;
    const origin = local ? null : validateSource(sourceUrl);
    const title = safeName(name, local ? '本地素材' : '网页图片');
    if (folderId != null && (typeof folderId !== 'string' || !this.findFolder.get(folderId))) {
      throw new OrganizationError('所选文件夹已不存在，请重新选择。');
    }
    if (!Array.isArray(tags) || tags.length > 30 ||
        tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 80)) {
      throw new OrganizationError('最多可填 30 个标签，每个最多 80 个字符。');
    }
    return { id, requestId, title, origin, folderId: folderId ?? null,
      tags: [...new Set(tags.map((tag) => tag.trim()))].sort(), width: dimension(width), height: dimension(height),
      extension: typeof extension === 'string' ? extension.toLowerCase() : '',
      source: local ? 'local-import' : 'chrome-extension' };
  }

  capture(payload = {}, local = false) {
    const metadata = this.prepare(payload, local);
    if (this.uploading.has(metadata.id)) throw new OrganizationError('这次导入仍在处理。', 409);
    const bytes = decode(payload.image, MAX_IMAGE_BYTES, '原件');
    const preview = payload.thumbnail ? decode(payload.thumbnail, 1024 * 1024, '缩略图') : null;
    if (preview && imageFormat(preview) !== 'jpg') throw new OrganizationError('缩略图格式无效。');
    const record = assetRecord(metadata, imageFormat(bytes), sha(bytes), bytes.length, preview);
    return this.ingest.save(record, bytes, preview);
  }

  async stream(body) {
    const upload = await readUploadHeader(body);
    const metadata = this.prepare(upload.metadata, true);
    const { id } = metadata;
    if (this.uploading.has(id)) throw new OrganizationError('这次导入仍在处理。', 409);
    this.uploading.add(id);
    const directory = this.ingest.stage(id);
    const filename = path.join(directory, 'stream-upload');
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const { hash, signature } = await spoolUpload(upload, filename);
      const record = assetRecord(metadata, imageFormat(signature), hash, upload.metadata.size);
      return this.ingest.saveUploaded(record, filename);
    } finally {
      this.uploading.delete(id);
      if (fs.existsSync(filename)) {
        try { fs.rmSync(filename); }
        catch (error) { console.error('无法清理未完成的上传', error.code); }
      }
    }
  }
}

function assetRecord(metadata, format, hash, byteSize, preview = null) {
  const { title, origin, folderId, tags, extension, source } = metadata;
  const ext = format || (source === 'local-import' && LOCAL_EXTENSIONS.has(extension) ? extension : null);
  if (!ext) throw new OrganizationError('此文件格式暂不支持。');
  const originalName = `${title}.${ext}`;
  const thumbnailName = preview ? (originalName.toLowerCase() === 'preview.jpg' ? 'preview-1.jpg' : 'preview.jpg') :
    (format ? originalName : null);
  const requestHash = sha(JSON.stringify([hash, origin, title, ext, folderId, tags]));
  return { ...metadata, ext, hash, byteSize, originalName, thumbnailName, requestHash };
}

function validateSource(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new OrganizationError('没有可保存的网页来源。');
  const url = URL.parse(value);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new OrganizationError('来源链接应是网页地址。');
  }
  return value;
}

function safeName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const clean = value.normalize('NFC').replace(/[\\/:\x00-\x1f\x7f]/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  return [...clean].slice(0, 60).join('') || fallback;
}

function decode(value, limit, field) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(limit / 3) * 4 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new OrganizationError(`${field}数据无效或超过大小限制。`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > limit) throw new OrganizationError(`${field}超过大小限制。`);
  return bytes;
}

function imageFormat(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && /^(avif|avis)$/.test(bytes.toString('ascii', 8, 12))) return 'avif';
  return null;
}

function dimension(value) {
  return Number.isInteger(value) && value > 0 && value <= 100000 ? value : null;
}

module.exports = { CaptureStore, extensionOrigin };
