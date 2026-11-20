const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { OrganizationError } = require('./organizer');

const MAX_HEADER_BYTES = 32 * 1024;
const MAX_LOCAL_BYTES = 2 * 1024 ** 3;

async function readUploadHeader(body) {
  const input = body.iterator({ destroyOnReturn: false });
  const buffers = [];
  let length = 0;
  for (;;) {
    const { done, value } = await input.next();
    if (done) break;
    const newline = value.indexOf(10);
    const header = newline === -1 ? value : value.subarray(0, newline);
    length += header.length;
    if (length > MAX_HEADER_BYTES) break;
    buffers.push(header);
    if (newline !== -1) {
      let metadata;
      try { metadata = JSON.parse(Buffer.concat(buffers, length).toString('utf8')); }
      catch { throw new OrganizationError('文件导入信息无效。'); }
      if (!metadata || typeof metadata !== 'object' ||
          !Number.isSafeInteger(metadata.size) || metadata.size < 1) {
        throw new OrganizationError('文件大小无效。');
      }
      if (metadata.size > MAX_LOCAL_BYTES) throw new OrganizationError('单个文件不能超过 2 GB。', 413);
      const contentLength = body.headers['content-length'];
      if (contentLength && Number(contentLength) !== length + 1 + metadata.size) {
        throw new OrganizationError('文件大小与导入信息不符。');
      }
      return { metadata, input, initial: value.subarray(newline + 1) };
    }
  }
  throw new OrganizationError('文件导入信息无效。');
}

async function spoolUpload(upload, filename) {
  const hash = createHash('sha256');
  let size = 0;
  let signature = Buffer.alloc(0);
  const { initial, input, metadata } = upload;
  async function* chunks() {
    let next = { done: false, value: initial };
    while (!next.done) {
      const chunk = next.value;
      size += chunk.length;
      if (size > metadata.size) throw new OrganizationError('收到的文件超过了申报大小。', 413);
      if (signature.length < 16) {
        signature = Buffer.concat([signature, chunk.subarray(0, 16 - signature.length)]);
      }
      hash.update(chunk);
      yield chunk;
      next = await input.next();
    }
  }
  await pipeline(Readable.from(chunks(), { objectMode: false }), fs.createWriteStream(filename, { mode: 0o600 }));
  if (size !== metadata.size) throw new OrganizationError('文件未传完，请重试。');
  return { hash: hash.digest('hex'), signature };
}

module.exports = { readUploadHeader, spoolUpload };
