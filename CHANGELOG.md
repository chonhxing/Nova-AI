# 更新日志

## v3.8.0（2026-09-30）

### B站视频下载（算法移植自开源项目 Bili23-Downloader）

- **视频页一键下载**：B站视频页右下角新增悬浮"下载视频"按钮（仅 bilibili.com 注入，SPA 路由轮询显隐），点击打开下载面板——视频标题/UP主/分P 列表、清晰度列表（含编码、分辨率、体积估算）、音频轨列表（192K/132K/64K，自动识别 Hi-Res 与杜比全景声）、下载队列状态（进行中/完成/失败）
- **WBI 签名移植**：从 nav 接口取 img/sub key，mixinKeyEncTab 混淆重排取前 32 位，参数加 `wts` 秒级时间戳→按键排序→值过滤 `!'()*`→form 编码→`md5(query+mixinKey)` 得 `w_rid`。已对照真实 B 站接口验证（view/playurl 均通过，签名错误会返回 -403）；nav 偶发风控按 Bili23 策略重试（3 次、间隔 2s）
- **登录清晰度随浏览器账号**：接口请求带 `credentials:'include'`，扩展 host 权限下自动附带用户 B 站登录 Cookie（SESSDATA）——大会员自动解锁 1080P+/4K/HDR 等高档位，无需像 Bili23 手动填 Cookie；首次以 `qn=127` 探测账号权限上限
- **DASH 取流与 CDN 择优**：`fnval=4048`（DASH+4K+杜比+8K+AV1），baseUrl+backupUrl 合并后按黑名单主机过滤（mcdn/pcdn P2P 变体、szbdyd 等，移植自 Bili23 cdn.py）优先正规线路——实测默认首选会被分到 mcdn 主机
- **直链下载**：`chrome.downloads` 直链 + Referer 注入双保险（downloads API 的 `headers` 参数为主，declarativeNetRequest 会话规则对扩展发起的第三方请求兜底）——实测正规 upos CDN 无 Referer 返回 403、带则 206。文件存入"无极下载/"子目录，按 Windows 非法字符集按路径段清洗（保留目录分隔符）
- **引擎与 UI 分层**：引擎在 Service Worker（`libs/bili-downloader.js`，无 UI 依赖），面板 UI 在懒注入 IIFE 包内（`src-ui/panel/bili/App.vue`），中间经 BILI_GET_INFO/RESOLVE/DOWNLOAD 消息；入口脚本（`libs/bili-entry.js`）仅注入 B站，负责悬浮按钮与面板挂载
- **音视频为独立 DASH 流**：下载得 视频.m4s + 音频.m4a，面板内置 ffmpeg 合并命令提示（`-c copy` 无损封装）；弹幕/字幕导出与音视频自动合并留待后续版本
- v3.7.0 与 v3.7.1（面板图标补齐、AI 气泡卡片样式修复、工具调用 JSON 泄漏修复）已推送 GitHub；本版本按约定仅本地提交不推送

## v3.7.0（2026-09-29）

### UI 全面拥抱 Vue 3：聊天面板 / 弹幕管理姬重写 + 懒注入架构

- **页内聊天面板迁移 Vue 3**：content.js 里约 1100 行手写面板 UI（326 行 CSS + innerHTML 模板 + 事件绑定）重写为 Vue 3 组件（`src-ui/panel/chat/App.vue`），功能逐项对齐——双 Tab、空态建议卡、气泡/头像/时间行、快捷操作栏、IME 守卫输入框、知识库搜索（300ms 防抖）/收藏/删除、拖拽移动。content.js 从 2342 行瘦身到约 1270 行（-46%），只保留业务逻辑（AI 调用/压缩/知识库/历史持久化，`wuji_conversation` 存储契约不变，老用户历史无损）
- **懒注入架构（内存核心优化）**：面板 UI 编译为独立 IIFE 包 `ui/panel-ui.js`（119KB/gzip 42KB），由 Service Worker 经 `chrome.scripting.executeScript` 在**首次打开面板时**才注入隔离世界——未打开过面板的页面零 Vue 解析与内存成本（原实现 content.js 113KB 每页常驻）。文件自带跨注入幂等守卫，重复注入不双重挂载
- **关闭即真卸载**：关闭面板 → Vue app unmount + 宿主移除，DOM/document 监听/storage 监听/响应式树全部释放（原实现只是 display:none 常驻）；重新打开完整重挂载，历史从 storage 恢复
- **流式渲染重写（流畅度核心）**：原实现 rAF 每帧全量重建 innerHTML + 追上后 rAF 永不停止空转；现在流式期间只更新一个文本节点（纯文本逐字揭示，每帧 3 字符、追上即停 rAF），完成后一次性渲染完整 Markdown。自动滚动仅在用户贴近底部时跟随
- **弹幕管理姬面板迁移 Vue 3**：约 150 行 innerHTML 模板的弹幕面板重写为 `src-ui/panel/danmaku/App.vue`（BV 提取/轮询/弹幕集列表/删除）；播放器引擎（池化渲染/rAF 粒子/二分插入）保持原生保证 60fps。抓取轮询逻辑留在引擎侧经 bridge 交付
- **弹幕引擎懒注入 + 内存修复**：danmaku-player.js（43KB）从 manifest 静态注入所有网站改为——B 站/YouTube 页面加载时自动注入（SW tabs.onUpdated），其余站点仅在打开弹幕面板时注入；非视频页省 43KB 解析与常驻内存。修复三处泄漏：`stopSyncLoop()` 从未被调用（2s 同步 interval 页面常驻）、全页 MutationObserver 永不 disconnect、卸载后 80 个池化 div 与控件残留——现在 DANMAKU_UNLOAD 时全部释放；加懒注入幂等守卫（IIFE 重复执行会因 let/const 重声明抛错）
- **弹窗链路适配**：弹窗"弹幕管理姬"改为经 SW 中继（注入后再转发到标签页），非视频站点也能正常打开
- **translator.js 内存/性能修复**：悬停翻译监听按需武装（`hoverEnabled` 关闭时不注册 document 级监听、不建弹窗 DOM，注意改动后需刷新页面生效）；原文缓存（originalContents）加 800 条上限防长页面无界增长；escHtml 复用单个转义 div；getComputedStyle 结果按节点 WeakMap 缓存（TreeWalker 扫描减少强制布局）
- **设置页九分区懒加载**：全部改 `defineAsyncComponent` + 动态 import，Vite 按分区自动分包，首屏只加载当前分区
- **构建系统**：新增 `vite.panel.config.js`（lib 模式 IIFE + `define` 替换 `process.env.NODE_ENV`——lib 模式不自动替换，浏览器无 process 直接崩，这个坑用一个浏览器 404/报错换来的）；面板样式走 JS 字符串模块 + `adoptedStyleSheets` 注入 ShadowRoot（规避 lib 模式独立 CSS 产物）

## v3.6.0（2026-09-29）

### 接入百度翻译：通用版 + 大模型文本翻译

- **百度翻译大模型引擎**（质量最佳）：对接官方[大模型文本翻译 API](https://api.fanyi.baidu.com/doc/21)（`/ait/api/aiTextTranslate`），支持"翻译指令"自定义译文风格（如"使用学术风格来翻译"，500 字以内）；鉴权双模式——控制台创建的 API Key 走 `Authorization: Bearer`（推荐），或与通用版相同的 MD5 签名
- **百度翻译通用版引擎**：对接通用文本翻译 API（`/api/trans/vip/translate`），AppID + 密钥签名鉴权，高级版约 100 万字符/月免费额度
- **引擎选择与自动降级**：引擎下拉新增两个百度选项；选百度引擎时请求失败自动降级到免费引擎（Google → 微软）；"自动"模式检测到已配置百度凭证时优先走百度（配了 API Key 优先大模型）
- **标准版 QPS=1 适配**：请求自动节流 1.1s 间隔，54003/59004 限频、54005 长 query 自动退避重试，52001/52002 系统错误重试一次；多段落翻译按 UTF-8 字节打包（单次留足 6000 字上限余量），段落超限自动分包
- **语种代码映射**：百度代码体系与常规不同（ja→jp、ko→kor、zh-TW→cht、fr→fra、es→spa 等 13 项差异自动转换），目标语言不可为 auto 的约束已处理
- **错误码全翻译**：54001 签名错误、52003 未开通服务、58003 IP 封禁、54004 余额不足等 18 个错误码转为可读中文提示
- **设置页**：百度引擎显示 APPID / 密钥 / API Key / 翻译指令四个字段，带开发者信息与开通服务直达链接；"测试翻译引擎"按钮走 Service Worker 生产代码路径实测百度接口
- 划词翻译、整页翻译、悬停翻译全部走新引擎调度；翻译签名用自实现 MD5（SubtleCrypto 不提供），已对照标准库验证 12 组向量（含 CJK 与 55/56/119/120 字节边界）

## v3.5.0（2026-09-29）

### 界面全面重做（Vue 3 + Vite）

- **全局外观切换**：新增"跟随系统 / 浅色 / 深色"三态开关——弹窗顶栏（点击循环）、设置页侧边栏（三段选择器）、页内悬浮窗顶栏（点击循环）三处入口，偏好存 `uiConfig.theme`，四个界面（弹窗/设置页/悬浮窗/休眠页）实时联动。实现上所有颜色改用 CSS `light-dark()` 成对声明，切换只改 `color-scheme` 一个属性（需 Chromium 123+，2024 年起的浏览器均支持）
- **技术栈升级**：弹窗和设置页迁移到 Vue 3，引入 Vite 构建（`npm run build`），构建产物仍输出到 `ui/` 并随仓库提交，不懂 Node 的用户照旧"加载已解压的扩展程序"即可用
- **弹窗重做**：模型状态胶囊（当前服务商/模型一目了然，未配置时有提示）、2×2 快捷操作宫格、分组工具列表；广告白名单状态感知（已加白显示"恢复屏蔽"）
- **设置页重做**：emoji 标题全部换成线性 SVG 图标；卡片化布局；每个服务商带"获取 API Key"直达链接；视觉/翻译引擎按需显示
- **全界面暗色模式**：弹窗、设置页、页内悬浮聊天窗、休眠页全部跟随系统深浅色
- 页内悬浮聊天窗版本号改为从 manifest 动态读取

### AI 服务商大扫除

- **百度文心 → 百度千帆 v2**：旧端点路径拼接错误必然 404，且已停止服务；现指向 `qianfan.baidubce.com/v2` OpenAI 兼容接口
- **MiniMax**：`api.minimax.chat` 已退役（301 跳官网），换到 `api.minimaxi.com`
- **Cohere**：`api.cohere.ai` 已迁移，走 `api.cohere.com/compatibility/v1` 兼容层
- **Gemini 视觉**：原来拼出的路径根本不存在，现走 Google 官方 OpenAI 兼容层 `/v1beta/openai`，模型换 `gemini-2.5-flash`
- **Groq**：默认模型 Mixtral 已被下线，换 `llama-3.3-70b-versatile`
- 新增 **OpenRouter** 聚合入口；OpenAI 默认模型换 `gpt-4.1-mini`；智谱免费模型 `glm-4-flash` 保持
- **服务商目录单一数据源**：新建 `libs/providers.js`，Service Worker 与设置页共用一份，请求路径（智谱 v4 / 千帆 v2 / Gemini / Cohere 兼容层）按服务商自动拼接，再也不会一处改了另一处漏掉

### 资源占用

- **弹幕脚本不再骚扰全网站**：播放器按钮的 body 级 MutationObserver 现在只在 B 站启动（此前所有网站常驻监听全页 DOM 变化），回调加了 500ms 节流
- **Service Worker 全部 fetch 加超时**：上版 CHANGELOG 宣称修了但实际没修，这次真修了——非流式 15-60s 头超时，流式响应 60s 无数据自动断开，一个挂起不再卡死整条消息
- **AI 记忆库加容量上限**：`kb_ai_memories` 超 300 条自动淘汰最旧（此前无限增长）
- **页面全文存档加约束**：单条全文截断 5 万字符；同 URL 24 小时内只更新不追加；总量超 500 条淘汰最旧（此前同页面每次访问都存一条、正文无上限）
- **DOM 监听器治理**：deepWatchDOM 的空回调观察器 5 分钟自动断开（此前挂到页面卸载），watch_dom 10 分钟自动断开，监听器总数上限 10 个
- content script 加注入幂等守卫，扩展重载后不再重复初始化

### 修的 bug

- **设置页所有开关点击无反应**（Agent 权限 / 翻译 / 广告过滤 / 标签页休眠全部中招）：WToggle 组件误用了 Vue 2 的 `model` 选项，Vue 3 已移除该选项导致 v-model 完全失联。已改为 Vue 3 契约（`modelValue` + `update:modelValue`）
- **保存 PDF 一直失败**：用了 `chrome.downloads` API 但 manifest 里没有 `downloads` 权限，已补上
- 流式工具调用循环、视觉模块 system prompt 里的版本号改为动态读取，AI 不会再自称 V3.3

## v3.4.0（2026-09-02）

### 新东西

- **WebAssembly 内核**：手写 WAT 汇编，编译出 811 字节的 wasm 文件，跑了语言检测、哈希、编辑距离三个函数。wasm 加不出来就自动用 JS，行为一样（跑了 20 条一致性测试）
- **CSS 声明式过滤**：广告匹配改成 `:is()` 分块，每块 200 条选择器，匹配开销从 O(N) 降到 O(分块数)
- **模糊搜索建议**：知识库搜不到结果时会提示"你是不是要找…"，用编辑距离算近邻
- **免费翻译引擎**：Google 和微软 Edge 翻译接口直接用，不用填 Key。选"自动"的话 Google 不通就切微软，AI 引擎挂了也会降级

### 翻译

上次已经重做过翻译了，这次加固：
- 批量翻译用 JSON 编号对齐，三层兜底防止译文串位
- 代码和命令名不翻译（之前 `addMilkCoin` 会被拆散）

### 广告屏蔽

- DNR 规则以前整批添加，一条坏的全废。现在先校验，500 条一批，单条失败只跳过那一条
- `##` 开头的全局隐藏规则被解析器当注释丢了，EasyList 里大半规则都是这种格式
- 白名单以前只停了元素隐藏，网络请求照样拦截。现在改了 excludedInitiatorDomains，变更后立刻重建规则
- AI 生成的自定义规则保存后立刻生效，不用等浏览器重启了
- 广告开关现在真的能启停 DNR

### 安全

- AI 回复的 Markdown 渲染有 XSS 漏洞（直接 innerHTML，LLM 输出的 HTML 会在扩展上下文执行）。现在先转义再套语法
- CDP 任意执行 JS（console_eval）改成默认全站拒绝，设置页可以加域名白名单
- 页面全文自动存档默认关了，设置里可以开

### 修的 bug

- 多轮工具调用循环里最终回答被丢了，用户看到原始 `{"tool":...}` JSON
- 标签页休眠从来没生效过（MV3 的 Service Worker 30 秒被杀，setTimeout 丢了）。现在 deadline 存到 storage.session，alarm 安全网接管
- 弹幕播放器控制面板打不开（pointer-events:none 让鼠标穿过去了）
- 弹幕池满了直接丢、固定弹幕淡出定时器 seek 时误杀新弹幕、加载无限重试、bvid 属性注入
- 知识库：索引事务挂死、更新/删除后索引不跟着变、删条目索引残留膨胀、批量索引写入（以前几万次 IDB 往返，现在一次 getAll）、并发打标丢更新
- 流式渲染结束 500ms 后必抛 TypeError（闭包引用已置 null 的变量）
- 中文输入法打拼音按 Enter 误发送消息
- 轮盘点完按钮后工具栏又弹出来
- read_dom 的 wait 参数是假的，直接抛错让用户"设置 wait 重新调用"
- watchDOM 无上报回调时 changes 数组无限涨
- "重置全部配置"把弹幕集和知识库也清了
- 弹幕存储超 10MB 静默失败，现在加了 LRU 淘汰
- 各种请求没超时，一个 fetch 挂起就卡死，现在 10-15 秒超时
- SW 启动时 importScripts 失败会击穿整个 Service Worker

### 其他

- 知识库统计改成单次游标，不用拉两遍全表
- 标签创建走 name 索引直查，不全表扫描了
- 设置页加了"AI 网页操作域名授权"和"自动记忆页面"两个开关
- manifest 里 web_accessible_resources 加了 wasm 文件
