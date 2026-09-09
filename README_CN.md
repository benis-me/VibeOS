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
  纯 CSS，所以系统外壳 *和* AI 生成的内容会同时即时换肤——并且与明暗模式相互独立。
- **系统级右键菜单** —— 在任意位置右键。不同位置（桌面、窗口标题栏、应用内容、任务栏、
  任务栏项）有不同的菜单，二级菜单遵循“安全三角”的指向判定，样式也跟随当前皮肤。
- **活动监视器** —— 每一次 AI 运行的实时仪表盘：Token 用量图表（输入 vs 输出）、
  按模型分布、成本、耗时、错误率，以及一份滚动分页加载的运行日志。
- **应用市场与固化** —— 安装模板应用，把一个窗口的当前状态 **固化** 成可复用的应用，
  并以 `.vibeapp` JSON 格式导出 / 导入应用。
- **内置 Files** —— 管理真实系统盘，支持文本编辑、导入下载、重命名、移动复制和回收站；不调用模型。
- **内置查看器** —— 双击文件打开独立的文本或媒体查看器。文本按原文显示；图片支持适应窗口和原始尺寸，
  音视频使用浏览器播放控件。刷新或重启后保留打开的文件；具体媒体格式取决于浏览器解码支持。
- **持久化的系统状态** —— 窗口、应用记忆、桌面引用、设置、通知、用户画像和智能体
  运行记录都存放在 SQLite 中，重启后依然保留。
- **多智能体运行时** —— 多个智能体并发驱动整个系统：
  - **界面生成智能体**（强模型）—— 在用户操作时渲染 / 增量更新窗口。
  - **系统事件智能体**（快模型，定时触发）—— 自发产生氛围式通知，让系统“活”起来，
    无需用户触发。
  - **维护智能体**（最快模型）—— 整理每个窗口的记忆、清理日志。
- **桌面外壳** —— 桌面、可拖拽 / 可缩放的多窗口管理器、任务栏、开始菜单
  （区分 *系统* 应用与 *生成* 应用）、通知（吐司 + 通知中心）。
- **全局用户画像** —— 用户只需写一次的画像 / 记忆；每个生成的应用都会读取它，
  让整个系统更懂你、并在窗口之间保持连贯。
- **系统调用** —— 模型可以发出 `notify`、`open`、`spawn-window`、`install`
  （虚拟应用 + 桌面快捷方式）、`create-file`、`focus`、`close` 等调用。
- **沙箱化渲染** —— AI 生成的 HTML 会被净化（无脚本 / 无内联事件处理器）；所有交互
  通过事件委托捕获并作为操作回传——包括输入框里输入的值，因此提交时会带上其内容。
- **可插拔的 AI 后端** —— 模型层位于统一的 `AiProvider` 抽象之后，因此系统可以运行在
  **CodeBuddy**、**Claude Code** 或 **Codex**（本地 CLI），也可以运行在 **OpenRouter** /
  任意 OpenAI 兼容 API 之上（通过 Vercel AI SDK）。可在设置里实时切换。
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
bun run build        # 生产环境前端构建 → apps/frontend/dist
bun run typecheck    # 对所有 package 做类型检查
bun test             # 运行测试套件
```

## 持久化

总数据目录默认是 `~/.vibeos`，不受启动工作目录影响：

```text
~/.vibeos/
  runtime/vibeos.db       # 设置、窗口状态、内容索引、交互记录和日志
  runtime/backups/        # 迁移前的数据库和已有磁盘备份
  disk/
    System/               # 存储版本、内置应用清单
    Desktop/              # 桌面文件及 .vibelink 应用快捷方式
    Documents/            # 用户文档
    Medias/Images/        # 生成图片，原有图片 URL 继续可用
    Applications/         # 已安装应用及生成窗口，包括已关闭窗口的内容
    Trash/                # 回收站及原始路径
    Cache/                # 生成过程的临时文件
```

应用包包含 `app.json` 和可选的 `index.html`，各窗口的 HTML 保存在所属应用目录内。
SQLite 仅保留运行状态和内容路径；之后的应用保存、页面生成、图片生成都直接读写系统盘。

生成窗口会保存当前 HTML，但不会自动成为可重复打开的已安装应用。
**保存为应用**会用当前窗口的 HTML 和尺寸创建一个新的已安装应用，并创建桌面快捷方式。
原窗口继续独立运行，后续交互不会自动改写保存的初始页面。`.vibeapp` 是应用清单和初始 HTML
的 JSON 导入导出格式，不是磁盘上的应用目录格式，也不是完整备份：引用文件、图片内容和窗口历史不会打包。

桌面应用图标对应真实的 `.vibelink` 文件，通过应用 ID 指向已安装应用。
可在应用商店创建快捷方式；安装和保存应用时也会自动创建。Files 中的重命名、移动、删除和还原
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
