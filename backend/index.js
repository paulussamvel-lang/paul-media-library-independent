const { existsSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const { resolveRuntime } = require('./runtime');
const LegacyProvider = require('./providers/legacy');
const ManagedProvider = require('./providers/managed');
const { OrganizationError } = require('./organizer');
const { extensionOrigin } = require('./capture');

const localEnv = path.resolve(__dirname, '../.env');
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
const runtime = resolveRuntime();
const endpoint = `127.0.0.1:${runtime.port}`;
const origin = `http://${endpoint}`;
const library = runtime.entry.type === 'managed' ?
  new ManagedProvider(runtime.entry.path, runtime.writable) : new LegacyProvider(runtime.entry.path);
const { organizer, smartFolders, captures, duplicates } = library;
const serverApp = express();
serverApp.disable('x-powered-by');

serverApp.use((request, response, next) => {
  if (request.get('Host') !== endpoint) return response.sendStatus(400);
  if (request.path.startsWith('/api/')) response.set('Cache-Control', 'no-store');
  response.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'");
  next();
});

const api = express.Router();
const json = express.json({ limit: '1mb' });
const pictureJson = express.json({ limit: '29mb' });

function guardLocal(request, response, next) {
  if (!organizer) return response.sendStatus(405);
  if (request.get('Origin') !== origin) return response.sendStatus(403);
  if (!request.is(request.path === '/import/stream' ? 'application/octet-stream' : 'application/json')) {
    return response.sendStatus(415);
  }
  next();
}

function extensionOnly(request, response, next) {
  if (!captures) return response.sendStatus(403);
  const caller = request.get('Origin');
  if ((request.method === 'GET' || request.method === 'HEAD') && !caller) return next();
  if (caller !== extensionOrigin) return response.sendStatus(403);
  response.set('Access-Control-Allow-Origin', extensionOrigin).vary('Origin');
  next();
}

const respond = handler => async (request, response, next) => {
  try { response.json(await handler(request)); }
  catch (error) { next(error); }
};

api.get('/config', respond(() => ({
  libraries: runtime.libraries,
  activeLibraryIndex: runtime.index,
  activeLibrary: { ...runtime.entry, index: runtime.index, canOrganize: Boolean(organizer) },
})));
api.get('/libraries', respond(() => runtime.libraries));
api.get('/folders', respond(() => library.getFolders()));
api.get('/smart-folders', respond(() => smartFolders?.list() || []));
api.get('/images', (request, response, next) => {
  const { folderId, q = '', includeSubfolders } = request.query;
  if (typeof folderId !== 'string' || folderId.length === 0 || typeof q !== 'string' || q.length > 160) {
    return response.sendStatus(400);
  }
  respond(() => library.getImages(folderId, includeSubfolders === 'true', q.trim()))(request, response, next);
});
api.get('/file/:id/:kind', (request, response) => {
  const { id, kind } = request.params;
  if (kind !== 'original' && kind !== 'thumbnail') return response.status(400).json({ error: '文件类型无效。' });
  try { library.pipeFile(id, kind, response); }
  catch { response.sendStatus(404); }
});

api.options(['/capture/image', '/capture/options'], extensionOnly, (_request, response) => {
  response.set({
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type',
  }).sendStatus(204);
});
api.get('/capture/options', extensionOnly, respond(() => ({
  folders: library.getFolders(), tags: captures.tags.all().map(row => row.tag),
})));
api.post('/capture/image', extensionOnly, (request, response, next) => {
  if (!request.is('application/json')) return response.sendStatus(415);
  next();
}, pictureJson, respond(request => captures.capture(request.body)));

if (organizer) {
  api.get('/organization', respond(() => ({ latestEdit: organizer.latestEdit() })));
  api.get('/duplicates', respond(() => duplicates.report()));
  api.get('/duplicates/pending', respond(() => duplicates.pending.all()));
  api.post('/organization/apply', guardLocal, json, respond(request => organizer.apply(request.body)));
  api.post('/organization/undo', guardLocal, json, respond(request => organizer.undo(request.body)));
  api.post('/smart-folders/save', guardLocal, json, respond(request => smartFolders.save(request.body)));
  api.post('/smart-folders/remove', guardLocal, json, respond(request => smartFolders.removeRule(request.body)));
  api.post('/duplicates/index', guardLocal, json, respond(request => duplicates.index(request.body.entries)));
  api.post('/duplicates/ignore', guardLocal, json, respond(request => duplicates.ignorePair(request.body)));
  api.post('/import/file', guardLocal, pictureJson, respond(request => captures.capture(request.body, true)));
  api.post('/import/stream', guardLocal, respond(request => captures.stream(request)));
}

api.use((request, response) => response.sendStatus(['GET', 'HEAD'].includes(request.method) ? 404 : 405));
serverApp.use('/api', api);
const assets = path.resolve(__dirname, '../frontend/dist');
if (existsSync(assets)) serverApp.use(express.static(assets));
serverApp.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (request.destroyed && !request.complete) return;
  request.resume();
  if (error instanceof OrganizationError) return response.status(error.status).json({ error: error.message });
  if (error.status === 404) return response.sendStatus(404);
  if (error.status === 413) return response.status(413).json({ error: '上传的数据超过大小限制。' });
  if (error.status === 400) return response.status(400).json({ error: '请求格式无效。' });
  console.error(error);
  response.status(500).json({ error: '素材库操作失败，请重试。' });
});

const listener = serverApp.listen(runtime.port, '127.0.0.1', () => {
  captures?.ingest.recover();
  console.log(`Paul 素材库正在运行：${origin}`);
});
if (process.env.PAUL_EXIT_WITH_PARENT === '1') {
  process.stdin.once('end', () => listener.close());
  process.stdin.resume();
}
