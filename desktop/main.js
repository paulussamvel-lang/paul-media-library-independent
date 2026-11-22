const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { assetDirectory } = require('../backend/storage');

const viewerUrl = 'http://127.0.0.1:13003/';
const projectRoot = path.resolve(__dirname, '..');
const packaged = projectRoot === path.join(process.resourcesPath, 'app');
let library = process.env.PAUL_LIBRARY_PATH;
let ownedServer;
let mainWindow;

async function checkViewer() {
  const response = await fetch(`${viewerUrl}api/config`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
  if (!response) return false;
  const config = response.ok ? await response.json().catch(() => null) : null;
  if (config?.activeLibrary?.path !== library || config?.activeLibrary?.type !== 'managed' ||
      !config.activeLibrary.canOrganize || config.organizationVersion !== 2 || config.workspaceVersion !== 1) {
    throw new Error('端口 13003 正在运行另一个素材库查看器。请先关闭它，再打开桌面版。');
  }
  return true;
}

async function ensureViewer() {
  if (await checkViewer()) return;
  const node = packaged ? path.join(path.dirname(process.execPath), 'node') :
    process.env.MEDIA_LIBRARY_NODE || path.join(os.homedir(), '.local', 'bin', 'node');
  if (!fs.existsSync(node)) {
    throw new Error(packaged ? '应用内缺少运行环境，请重新安装 Paul 素材库。' :
      '找不到本机 Node.js。请通过「启动桌面版.command」启动。');
  }
  if (!fs.existsSync(path.join(projectRoot, 'frontend', 'dist', 'index.html'))) {
    throw new Error('查看器网页尚未构建，请按 README.md 构建前端。');
  }
  fs.mkdirSync(path.join(library, 'captures'), { recursive: true, mode: 0o700 });
  ownedServer = spawn(node, [
    '--permission', '--allow-net', `--allow-fs-read=${projectRoot}`, `--allow-fs-read=${library}`,
    `--allow-fs-write=${path.join(library, 'library.sqlite')}`,
    `--allow-fs-write=${path.join(library, 'library.sqlite-journal')}`,
    `--allow-fs-write=${path.join(library, 'captures')}`,
    path.join(projectRoot, 'backend', 'index.js'),
  ], {
    cwd: projectRoot,
    env: { PAUL_LIBRARY_PATH: library, PAUL_LIBRARY_WRITABLE: '1', PAUL_EXIT_WITH_PARENT: '1' },
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  let serverError;
  ownedServer.on('error', (error) => { serverError = error; });
  for (let attempt = 0; attempt < 45; attempt++) {
    if (serverError) throw serverError;
    if (await checkViewer()) return;
    if (ownedServer.exitCode !== null) break;
    await delay(100);
  }
  throw new Error('本地查看器未能启动。');
}

async function resolveLibraryPath() {
  if (library) return library;
  const preference = path.join(app.getPath('userData'), 'paul-library-path.json');
  try {
    const saved = JSON.parse(fs.readFileSync(preference, 'utf8')).directory;
    if (typeof saved === 'string' && fs.existsSync(path.join(saved, 'library.sqlite'))) return saved;
  } catch {
    // Start with a default location or ask for the managed library.
  }
  const standard = path.join(os.homedir(), 'Documents', 'Paul 素材库');
  if (fs.existsSync(path.join(standard, 'library.sqlite'))) return standard;
  const choice = await dialog.showOpenDialog({
    title: '选择 Paul 素材库目录',
    properties: ['openDirectory'],
    buttonLabel: '打开图库',
  });
  if (choice.canceled) return null;
  const [directory] = choice.filePaths;
  if (!fs.existsSync(path.join(directory, 'library.sqlite'))) throw new Error('请选择包含 library.sqlite 的独立素材库目录。');
  fs.writeFileSync(preference, JSON.stringify({ directory }), { mode: 0o600 });
  return directory;
}

async function openLibrary() {
  const selected = await resolveLibraryPath();
  if (!selected) { app.quit(); return; }
  library = fs.realpathSync(selected);
  const db = new DatabaseSync(path.join(library, 'library.sqlite'), { readOnly: true });
  db.exec('PRAGMA busy_timeout = 1000');
  app.once('will-quit', () => db.close());
  await ensureViewer();
  const findAsset = db.prepare(`SELECT original_name FROM assets a WHERE id = ?
    AND NOT EXISTS (SELECT 1 FROM trashed_assets t WHERE t.asset_id = a.id)`);
  const icon = await app.getFileIcon(__filename, { size: 'normal' });

  const window = mainWindow = new BrowserWindow({
    title: 'Paul 素材库', width: 980, height: 720, minWidth: 460, minHeight: 420,
    backgroundColor: '#18181c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  window.once('closed', () => { mainWindow = null; });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = URL.parse(url);
    if (target && ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password) {
      shell.openExternal(url).catch((error) => console.error(error.message));
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== viewerUrl) event.preventDefault();
  });
  ipcMain.on('asset:start-drag', (event, id) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== viewerUrl ||
        typeof id !== 'string' || !/^[a-z0-9_-]+$/i.test(id)) return;
    try {
      const filename = findAsset.get(id)?.original_name;
      if (!filename || filename !== path.basename(filename) || filename.includes('\\')) return;
      const directory = assetDirectory(library, id);
      const filenameOnDisk = fs.realpathSync(path.join(directory, filename));
      if (path.dirname(filenameOnDisk) === directory && fs.statSync(filenameOnDisk).isFile()) {
        event.sender.startDrag({ file: filenameOnDisk, icon });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(error.message);
    }
  });
  await window.loadURL(viewerUrl);
}

app.setName('Paul 素材库');
if (packaged && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => ownedServer?.stdin.end());
  app.whenReady().then(openLibrary).catch((error) => {
    dialog.showErrorBox('无法打开 Paul 素材库', error.message);
    app.quit();
  });
}
