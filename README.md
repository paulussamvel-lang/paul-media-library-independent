# Paul 素材库

面向 Mac 本地剪辑的素材管理工具。通过文件夹、标签或备注找素材，可以直接试听音频、预览视频，并把本地原件拖进剪辑软件。

## 使用已有图库

桌面版首次启动时选择包含 `library.sqlite` 和 `files` 的 Paul 素材库目录。默认查找 `~/Documents/Paul 素材库`，也可通过 `PAUL_LIBRARY_PATH` 指定目录。应用将最近选择保存在本机应用设置里。

要创建独立库，可复制迁移已有 Eagle 图库。目标目录需尚未创建，源库只读。

```sh
node backend/migrate-eagle.js "/path/to/YourLibrary.library" "$HOME/Documents/Paul 素材库"
```

网页版可设置 `EAGLE_LIBRARY_PATH` 后运行 `启动查看器.command`，读取旧库。网页版和桌面版默认使用 `http://127.0.0.1:13003/`。桌面版提供原件拖拽。

## 日常操作

- 点音频卡片可打开播放器。鼠标停在波形上会试听，左右移动可跳到对应位置。搜索框旁可设 BPM 区间并排序。
- 使用「批量整理」加标签、加入文件夹或移动归类。智能文件夹可保存关键词、标签、格式及范围。
- 侧栏可新建顶层或子文件夹，也可给当前文件夹改名。「批量整理」可按顺序编号或查找替换素材名称，原文件名保留。
- 素材移入回收站后，可在侧栏「回收站」选择还原，保留原文件夹、标签和来源。批量改名、移入与还原均可通过「撤销上次整理」撤回。
- 单个本地文件最多 2 GB。大文件导入时显示进度。已完整暂存的文件可重启恢复，尚未传完的文件须重传。相同字节会复用原件。
- Chrome 可加载 `chrome-extension` 目录中的扩展，右键收藏单张网页图片，保留原图、来源、文件夹和标签。单图上限 20 MB。

## 构建

在本机安装 Node.js 26 后运行：

```sh
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm --prefix desktop ci
zsh desktop/package-macos.zsh
```

安装包输出到 `dist/macos/Paul 素材库.app`。可传一个新的输出目录复建。本地打包用当前 Mac 的架构和 Node 运行环境。

## 兼容性

这版独立实现了库服务入口、Eagle 旧库适配器、应用导航、素材视图和 Web 客户端。保留 Paul 素材库数据库结构和浏览器扩展使用的本地接口。原版本曾基于 [eagle-web](https://github.com/aspi-rin/eagle-web) 的提交 `bd3ecf3168868723bd5228bf93b890a5228a9a2c`。
