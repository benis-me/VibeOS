# 应用通信

通信由后端统一路由，复用现有 WebSocket、窗口调度器和系统盘操作。
生成的 HTML 仍不执行 JavaScript。原生应用通过前端的 `sendCommunication` 调用，
AI 通过 `communication` syscall 调用；身份和请求链由系统填写。

## 命令

`c2s.communication.command` 的 payload 是 `{windowId, requestId, command}`。
共享校验和类型在 `packages/shared/src/domain/communication.ts`。

| action                  | 含义                                           |
| ----------------------- | ---------------------------------------------- |
| send                    | 定向发送，确认是否成功交给接收方               |
| request                 | 定向请求，等待接收方回复                       |
| reply                   | 回复 messageId，只允许该请求的接收窗口操作     |
| publish                 | 发布以当前应用为来源的事件                     |
| subscribe / unsubscribe | 设置或取消当前窗口的订阅                       |
| refresh                 | 重新读取当前窗口的数据订阅，用于初次显示和重连 |

目标可为 `{windowId}`、`{appId, open?, newWindow?}` 或
`{system: "files" | "apps" | "settings" | "app-data"}`。应用目标默认使用它最前面的窗口；
`open:true` 允许启动尚未运行的应用，`newWindow:true` 打开独立实例，
单实例应用仍复用已有窗口。

默认 `mode:"ai"` 将消息交给接收窗口的 AI，继续使用完整/局部渲染协议。
`mode:"data"` 直接投递给已有界面及其 channel 绑定，不调用模型。
需要首次生成界面的应用会拒绝纯数据投递。
`responseMode` 决定回复在发送窗口中作为数据还是 AI 上下文，默认为 data。
原生窗口始终使用数据回复。数据模式不会自动回复请求，简单更新应使用 send。

    {"type":"communication","command":{
      "action":"request","target":{"system":"files"},"topic":"read",
      "data":{"path":"Documents/note.txt"},"responseMode":"ai"
    }}

成功读取后，AI 会收到包含实际 content、path、version 的 response。
继续写入时必须携带这个 version；创建新文件不需要 version。
收到写入成功的实际回复后，再回复原调用方，不能把“开始写入”当作“保存成功”。
`APP MESSAGE` 和 `PENDING REPLIES` 提供当前请求链的上下文。

## 系统与原生应用

| 目标                             | topic / 参数                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| system: files                    | list、stat、read、write、mkdir、move、copy、trash、restore、open；参数沿用 Files 命令，省略 action |
| system: apps                     | list 返回真实应用 ID；windows 返回运行窗口 ID                                                      |
| system: settings                 | get / set，仅开放 theme、locale、skin                                                              |
| system: app-data                 | get / set；当前应用的共享 JSON，set 必须携带读取时的 version                                         |
| Files、Text Viewer、Media Viewer | file.open，data: {path}                                                                            |
| Skins                            | skin.activate，data: {id, versionId?}                                                              |
| Settings                         | get / set，与系统设置端点相同                                                                      |

文件操作限定在系统盘，沿用路径检查、版本冲突和回收站规则。
永久删除仍由原生回收站操作。现有查看器若正在显示另一个文件，请打开新窗口。
模型服务凭据和其他运行设置不会出现在通信查询或设置事件中。

Files 的“打开方式”可以将选中的文件发送给原生查看器、已安装应用或现有应用窗口。
发出的 file.open 请求携带真实系统盘路径；Files 等待回复并展示完成或失败状态。

## 同应用窗口联动

普通 AI 交互在同一轮输出中声明共享状态，无需额外调用模型读取、再写入：

    {"calls":[{"type":"app-state","data":{"tasks":{"event-3":{"done":true}}}}]}

`data` 是完整的更新后记录，必须保留其他记录和未知字段。仅改变导航、选择或显示时，
使用 `{"type":"app-state"}` 保持数据不变，不能传空对象代替。输出 HTML、通知或
spawn-window 时必须声明一次状态；只执行关闭、通信或只读的共享状态刷新可以省略。写入使用生成开始时
的真实版本，先于其他 syscall 和最终界面发布；冲突时保留新数据及原界面，不发布成功通知。

写入后，其他已有界面的同应用窗口自动收到 `app.data.changed`，由 AI 按共享状态
更新相关区域；通知只是反馈，无需点击。写入窗口不会被自己的变化反复唤醒，
请求链中的上游窗口也能收到实际写入后的状态。
相同数据不产生新版本或事件，排队的重复状态刷新会合并。同应用刷新只允许保持状态，
不应再次写入、通知或重复业务动作。显式的同应用 app.data.changed 订阅覆盖默认策略：
纯文本绑定已足够的窗口可声明 mode:data，省去 AI 刷新。

生成时先明确本次操作和记录的新值，再输出状态与相符的 HTML；共享状态刷新不再
混入旧操作和旧总结，以当前真实数据为准。已经一致的界面可以仅返回总结。
完整局部块之间多余的闭合标签在本地忽略；缺失、重复或重叠目标仍需校验修复。

spawn-window 保留来源窗口、选中记录上下文和同应用的版本；这些信息独立进入每轮
模型上下文，不因桌面窗口较多而被截断。`{"type":"close"}` 可主动关闭当前窗口，
显式 windowId 可关闭目标窗口。关闭是独立的可选动作，完成任务不会强制关闭详情。

## 事件和局部数据

系统发布 `files.changed`、`settings.changed`、`apps.changed`、
`windows.opened`、`windows.closed`。文件事件覆盖 VibeOS 内的文件操作；
系统盘监听也会捕获外部文件变化。应用自定义事件携带真实的 appId/windowId 来源，
不能冒充系统。订阅必须指定来源，文件订阅可以按系统盘相对路径筛选。

下面的声明随 HTML 保存，应用保存、复制、重开后也有效：

    <main data-vibeos-subscriptions='[
      {"id":"document","topic":"files.changed","source":{"system":true},
       "path":"Documents/note.txt","mode":"data",
       "refresh":{"action":"read","path":"Documents/note.txt"}}
    ]'>
      <pre data-vibeos-bind="document.content"></pre>
      <p data-vibeos-bind="document.$error"></p>
    </main>

文件变更后，系统重新读取文件并只更新绑定的文本节点，不重建页面、移动焦点，
也不修改未提交的输入。绑定支持 JSON 字段路径，字符串保持纯文本，对象显示为 JSON。
需要语义处理时才使用 mode:ai，并为文件事件指定具体路径。
按状态更新的系统事件会合并短时间内的重复触发；应用自定义事件不会被合并。

普通按钮或表单可通过 data-vibeos-command 直接调用命令：

    <form data-vibeos-command='{"action":"publish","topic":"record.changed"}'>
      <label>内容 <input name="text"></label>
      <button type="submit">发布</button>
    </form>

命名字段合并到 command.data；提交按钮上的命令可以覆盖表单命令。
纯数据 request 配合 channel 和 data-vibeos-bind 显示结果。
持久化的 HTML 订阅由快照更新，运行时订阅保存在 SQLite；同名运行时订阅优先。
取消订阅会立即停止后续投递，窗口关闭会清理其订阅。

## 生命周期与检查

- 每个接收窗口串行处理 AI 消息，不同窗口并行；用户操作仍可中断正在进行的生成。
- 请求默认 120 秒超时，可设置 1–180 秒。关闭窗口、处理失败或超时会返回错误，
  同时取消该请求的后续处理，防止过期输出继续写文件。
- 请求链最多 8 跳，防止循环返回已访问的窗口。AI 文件订阅不会被自己的写入反复触发。
- 单条数据最多 256 KiB、16 层；每个发送窗口最多 16 个未回复请求，全局最多 256 个，
  每个接收窗口最多排队 32 条 AI 消息。HTML 和运行时订阅各最多 16 条。
- 请求队列不跨服务重启恢复；断线时前端等待会失败，重连重新读取持久化订阅。
  应用自定义事件不提供离线重放；大文件应通过原生查看器打开。
- 旧应用的 HTML 保留；共享状态为空时，下次交互会要求模型将已有记录连同稳定 ID
  写入共享状态，保留其他记录，再打开详情或应用变化。启动迁移为窗口新增来源和上下文字段。

检查：`NODE_OPTIONS= bun test`、`NODE_OPTIONS= bun run typecheck`。
浏览器回归命令见 `test/communication.browser.html` 和 `test/regions.browser.html`。
`test/communication-flow.ts` 由测试在隔离目录中运行，覆盖实际的 HTTP provider →
UI 调度 → 读写 → 回复链，以及排队、取消、超时和局部更新。
`test/app-workflow.ts` 覆盖旧记录初始化、无需订阅的父子窗口同步、按需关闭、
重复写入去重、上游窗口刷新、跨应用事件触发及冲突时不发布虚假成功结果。
