# VibeOS

[English](./README.md) · **简体中文**

一个运行在浏览器里的 **AI 幻觉驱动操作系统**。除了核心运行时之外，每个窗口的界面
都是由 AI 实时生成的：用户在窗口上操作，系统便向模型询问“这个窗口接下来应该变成
什么样”——就像一个真实的程序在响应你。

![VibeOS —— 浏览器里的 AI 幻觉驱动操作系统](docs/screenshot.jpeg)

> **本项目是对 Microsoft Build 2026「Vibe OS」演示的复刻。**
> VibeOS 完全从零复刻了 **Microsoft Build 2026 Vibe OS** 演示所展示的概念。
> 全部灵感来自该演示，在此致以诚挚的感谢——没有它就没有这个项目。

> 操作系统本身是真实的（内核、窗口、持久化、智能体、右键菜单），
> 而其中的 *内容* 是被“幻觉”出来的。

## 功能特性

- **AI 动态界面** —— 应用窗口是由模型实时生成 / 增量打补丁的 HTML 片段。界面生成是
  **无状态的**：每次操作都会把当前完整界面作为上下文发送，因此任何应用都能正确
  重新渲染，而不依赖一个不断增长的会话。
- **皮肤 / 主题系统** —— 在设置里实时切换整机外观：**默认（DevDock，原生极简主题）**、
  **Windows XP「Luna」** 和 **Mac OS X「Aqua」**。皮肤是基于设计令牌（design token）的
  纯 CSS，所以系统外壳 *和* AI 生成的内容会同时即时换肤——并且与明暗模式相互独立
  （XP 与 Aqua 只有浅色外观）。
- **AI 皮肤工作室** —— 原生的 **皮肤** 应用用下拉框和对话管理自定义皮肤：可从 VibeOS 基础
  元素新建空白皮肤，或复制任意皮肤的当前外观；内置皮肤只读。每次成功生成都会保存并立即应用
  一个新版本，可随时选回旧版本继续设计；失败或取消不会影响当前版本。生成结果必须遵守
  [令牌与外壳契约](packages/shared/src/domain/skins.ts)，正文、卡片、选中态和品牌色的文字
  在明暗两种模式下都需达到 4.5:1 对比度。皮肤可通过 `.vibeskin` 文件导出 / 导入。
- **系统级右键菜单** —— 在任意位置右键。不同位置（桌面、窗口标题栏、应用内容、任务栏、
  任务栏项）有不同的菜单，二级菜单遵循“安全三角”的指向判定，样式也跟随当前皮肤。
- **活动监视器** —— 每一次 AI 运行的实时仪表盘：Token 用量图表（输入 vs 输出）、
  按模型分布、成本、耗时、错误率，以及一份滚动分页加载的运行日志。
- **应用管理** —— 原生的 Applications 应用：新建、重命名、复制和卸载本地应用，用对话描述改动
  并生成不可变版本（经典或交互式），选择当前版本，导入 / 导出 `.vibeapp` 应用包。
  **保存为应用** 会保留生成窗口的身份、窗口和共享数据。
- **内置 Files** —— 管理真实系统盘，支持文本编辑、导入下载、重命名、移动复制和回收站；不调用模型。
- **内置查看器** —— 双击文件打开独立的文本或媒体查看器。文本按原文显示；图片支持适应窗口和原始尺寸，
  音视频使用浏览器播放控件。刷新或重启后保留打开的文件；具体媒体格式取决于浏览器解码支持。
- **持久化的系统状态** —— 窗口、应用记忆、桌面引用、设置、通知、用户画像和智能体
  运行记录都存放在 SQLite 中，重启后依然保留。
- **多智能体运行时** —— 多个智能体并发驱动整个系统：
  - **界面生成智能体**（强模型）—— 在用户操作时渲染 / 增量更新窗口。
  - **系统事件智能体**（快模型，定时触发）—— 自发产生氛围式通知，让系统“活”起来，
    无需用户触发；没有客户端连接时不运行。每一步自带的摘要会进入后续提示词，记忆整理
    不需要额外的后台模型调用。
- **桌面外壳** —— 桌面、可拖拽 / 可缩放的多窗口管理器、任务栏、开始菜单
  （区分 *系统* 应用与 *生成* 应用）、通知（吐司 + 通知中心）。
- **全局用户画像** —— 用户只需写一次的画像 / 记忆；每个生成的应用都会读取它，
  让整个系统更懂你、并在窗口之间保持连贯。
- **系统调用** —— 模型可以发出 `app-state`、`notify`、`open`、`spawn-window`、`install`
  （应用 + 桌面快捷方式）、`create-file`、`focus`、`close`、`window-state`、
  `resize-window` 和 `communication` 调用。
- **沙箱化渲染** —— 经典版本的 AI HTML 会被净化（无脚本 / 无内联事件处理器）；所有交互
  通过事件委托捕获并作为操作回传——包括输入框里输入的值，因此提交时会带上其内容。
  交互式版本（新体验的默认方式）还可以在不透明源 iframe 中运行经过校验的小段脚本，
  无法访问宿主页面、其存储或网络；详见 [docs/interactive-runtime.md](docs/interactive-runtime.md)。
- **可插拔的 AI 后端** —— 模型层位于统一的 `AiProvider` 抽象之后，因此系统可以运行在
  **CodeBuddy**、**Claude Code** 或 **Codex**（本地 CLI），也可以通过 Vercel AI SDK 使用
  API 提供方（OpenAI、Anthropic、Gemini、OpenRouter、MiniMax、智谱、Kimi、Cerebras）。
  可在设置里实时切换，也可按用途分别指定。
- **双语（中文 / 英文）** —— 所有原生界面 *以及* AI 生成的内容都会跟随所选语言；
  语言会被注入到每一次生成的提示词中。

## 技术栈

Bun（运行时 + 包管理器）· Vite 8 · React 19 · Tailwind CSS 4 · Zustand ·
`bun:sqlite` · [`motion`](https://motion.dev) · Phosphor（应用图标）+ lucide（外壳图标）。

界面构建在一套 **自研的、基于令牌的设计系统** 之上（oklch CSS 变量、Geist + JetBrains
Mono）。皮肤系统通过 `<html>` 上的 `data-skin`，在同一套令牌之上叠加不同的视觉语言
（XP / Aqua）。

AI 后端 **对 CLI 不使用任何厂商 SDK**：`claude` / `codebuddy` 以无头 stream-json 模式驱动
（`-p --output-format stream-json`），`codex` 通过 `codex exec --json` 驱动。**OpenRouter**
（以及任意 OpenAI 兼容 API）则通过 [`ai`](https://www.npmjs.com/package/ai) +
`@ai-sdk/openai-compatible`。

## 架构

基于 CLI 的提供方（CodeBuddy / Claude Code / Codex）各自会拉起一个 CLI 子进程，因此 AI
层 **只在后端运行**。所以 VibeOS 是一个 Bun 后端（HTTP + WebSocket），负责驱动各提供方与
智能体调度器；再加上一个 Vite/React 前端，通过单条 WebSocket 连接。SQLite 是唯一的事实
来源；前端的 Zustand store 只是它的镜像。

所有模型访问都汇聚到单一的 `AiProvider` 抽象（`apps/backend/src/ai/providers/`），因此
智能体、提示词组装器和前端都无需知道当前激活的是哪个后端。CLI 提供方通过 `providers/cli/`
（子进程 + JSONL）流式输出；OpenRouter 则是一个 HTTP 提供方。

```
packages/shared   两端共享的协议 + 领域类型
apps/backend      Bun 服务端：内核/启动、SDK 管理器、模型策略、提示词组装器、
                  智能体调度器、系统调用解释器、sqlite 仓储
apps/frontend     React 桌面外壳：窗口管理器、任务栏、开始菜单、
                  AI-HTML 渲染面、右键菜单、皮肤、通知、设置
```

## 快速开始

需要 **Bun**。若要使用真实 AI，当前激活的提供方后端必须可达：对应的 CLI 在 PATH 中且已
登录（`codebuddy` / `claude` / `codex`），或为 `openrouter` 提供 `OPENROUTER_API_KEY`。

```bash
bun install
bun run dev        # 同时启动后端 (:7720) + 前端 (:7730)
```

打开 http://localhost:7730。

### 离线 / stub 模式

无需任何模型即可运行整个系统（确定性的 stub 界面）：

```bash
VIBEOS_AI_STUB=1 bun run dev
```

### 环境变量

复制 `.env.example`。常用变量：

| 变量 | 作用 |
|---|---|
| `PORT` | 后端端口（默认 7720） |
| `VIBEOS_DATA_DIR` | 总数据目录（默认 `~/.vibeos`）：`runtime/` 保存运行数据，`disk/` 作为系统盘 |
| `VIBEOS_DB_PATH` | 可选的 SQLite 路径覆盖；只跳过数据库搬迁，仍执行存储格式升级 |
| `VIBEOS_AI_PROVIDER` | 启动默认后端：`claude`（默认）`codex` `codebuddy` `openrouter`；未安装的 CLI 会被跳过 |
| `OPENROUTER_API_KEY` | `openrouter` 提供方的 API Key（或 `VIBEOS_AI_API_KEY`） |
| `VIBEOS_AI_BASE_URL` | `openrouter` 的 OpenAI 兼容端点（默认 OpenRouter） |
| `VIBEOS_AI_STUB=1` | 使用 stub 响应而非任何提供方 |
| `VIBEOS_AGENTS_DISABLED=1` | 关闭定时智能体 |
| `VIBEOS_SNAPSHOT_BUDGET` | 限制作为上下文发送的当前界面 HTML 大小（0 = 不限制） |
| `VIBEOS_MODEL_UI` / `VIBEOS_MODEL_FAST` | 覆盖自动发现的模型 id |

当前提供方、**皮肤** 以及界面/内容的 **语言（中文 / 英文）** 也都可以在 **设置** 应用里
实时切换。

## 脚本

```bash
bun run dev          # 后端 + 前端
bun run dev:backend  # 仅后端
bun run dev:frontend # 仅前端
bun run build        # 静态前端构建 → apps/frontend/dist（后端不托管它：需自行部署，
                     # 并通过 VIBEOS_WEB_ORIGIN 放行它的来源）
bun run typecheck    # 对所有 package 做类型检查
bun test             # 运行测试套件
bun run verify       # 类型检查 + biome 检查 + 测试；以退出码判定是否通过
```

## 持久化

总数据目录默认是 `~/.vibeos`，不受启动工作目录影响：

```text
~/.vibeos/
  runtime/vibeos.db       # 设置、窗口状态、内容索引、交互记录和日志
  runtime/backups/        # 迁移前的数据库和已有磁盘备份
  disk/
    System/               # 存储版本、内置应用、窗口会话、应用数据、皮肤
    Desktop/              # 桌面文件及 .vibelink 应用快捷方式
    Documents/            # 用户文档
    Medias/Images/        # 生成图片，原有图片 URL 继续可用
    Applications/         # 已安装的 .vibeapp 应用包，含不可变版本
    Trash/                # 回收站及原始路径
    Cache/Applications/   # 尚未保存的临时体验
```

应用包包含 `manifest.json` 和不可变的 `Versions/<id>/` 目录（定义、初始 `index.html`、素材）。
窗口快照保存在 `System/Sessions/<窗口 id>/`，应用共享数据保存在 `System/AppData/<应用 id>/`。
SQLite 保留对这些文件的引用；详见 [docs/applications-and-memory.md](docs/applications-and-memory.md)。

生成的窗口起初是临时体验。**保存为应用**会把它转为已安装应用，保留同一身份、窗口和共享数据，
用窗口当前界面和尺寸写入一个新版本，并创建桌面快捷方式。`.vibeapp` 应用包包含所选版本的定义
及其图片（交互式为格式 3，经典为格式 2）；共享数据仅在勾选时导出，窗口历史和其他版本不会打包。

桌面应用图标对应真实的 `.vibelink` 文件，通过应用 ID 指向已安装应用。
安装应用和保存窗口时会自动创建快捷方式。Files 中的重命名、移动、删除和还原
会同步到桌面，删除快捷方式不会卸载应用。快捷方式只在已安装其目标应用的系统中有效。

启动先检测存储版本。旧版数据会在任何结构修改前备份到 `runtime/backups/<时间戳>/`，
备份包含完整 SQLite（包括已提交的 WAL）以及已有的磁盘、旧缓存。然后迁移应用定义、
全部窗口快照、图片和虚拟文件，校验落盘内容，再清空数据库中的旧内容列并记录存储版本 1。
存储版本 2 会继续将桌面和回收站中的旧快捷方式迁成 `.vibelink` 文件，保留位置、目标应用和删除状态；
已经迁过版本 1 的安装也会执行这一步。
之前只导出过部分虚拟文件的中间状态也会迁移，已经编辑过的磁盘文件会保留。
失败时停止启动，不标记完成；重试可复用相同的导出内容，不覆盖冲突文件。迁移成功后保留备份。

Files 支持 UTF-8 文本编辑（2 MB 以内）、浏览器导入（16 MB 以内）、流式下载、重命名、
移动复制和回收站。更大的文件可直接放入 `disk/`；外部文件变化会自动刷新已打开的 Files。
地址栏支持后退/前进、上一级、面包屑、路径输入与补全建议、相对路径、复制和刷新。
Ctrl/⌘L 编辑路径，Alt+左/右/上方向键导航，F5 刷新当前聚焦的 Files 窗口。
后端默认仅监听本机。如需远程或反向代理部署，可显式配置 `VIBEOS_HOST` 和
`VIBEOS_WEB_ORIGIN`，指定监听地址和实际前端来源。

新数据库不存在时，启动会检测旧的 `apps/backend/data/vibeos.db` 或 `data/vibeos.db`，
通过 SQLite 一致性复制迁移（包含已提交的 WAL 数据），并保留旧库。新库存在时不覆盖；
发现多个有效旧库时会停止迁移，避免选错。可显式指定 `VIBEOS_DB_PATH` 选择要使用的库，
数据库会留在指定位置，但仍检测和升级其存储格式。已经位于新位置的旧版库也会迁移。

随后内核迁移数据库结构、记录本次启动，恢复打开的窗口及其快照，通过 `s2c.boot.state`
回放给客户端。应用搜索结果包含建议窗口尺寸；首次生成可调整尺寸，保存应用时会保留
窗口的实际尺寸。较小屏幕会自动约束显示范围，同时保留原来的尺寸偏好。

## 致谢

VibeOS 是一个独立的、非官方的复刻项目，灵感完全来自 **Microsoft Build 2026 Vibe OS**
演示。本项目与 Microsoft 无任何隶属或背书关系；所有商标归各自所有者所有。

## 许可协议

[MIT](./LICENSE)。
