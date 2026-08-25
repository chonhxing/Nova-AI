<div align="center">

<img src="icons/logo.svg" alt="无极 Logo" width="96" height="96" />

# 无极 · 智能 AI 浏览器助手

**一个融合 AI 对话、沉浸式翻译、图片识别、知识库、广告过滤与标签页管理于一体的浏览器扩展**

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?logo=googlechrome&logoColor=white)
![Version](https://img.shields.io/badge/Version-3.3.0-6366f1)
![License](https://img.shields.io/badge/License-MIT-green)
![Platform](https://img.shields.io/badge/Platform-Chromium-orange?logo=chromewebstore&logoColor=white)

</div>

---

## ✨ 功能特性

| 模块 | 说明 |
| --- | --- |
| 💬 **AI 对话** | 侧边栏 AI 对话助手，支持流式输出、多轮对话、自定义系统提示词 |
| 🌐 **沉浸式翻译** | 网页双语对照翻译，支持鼠标悬停翻译、输入框翻译、目标语言与译文样式自定义 |
| 👁 **图片识别** | 视觉模型驱动，支持图片理解、OCR 文字识别与视觉分析 |
| 📚 **知识库 V2** | 保存网页 / 对话 / 文件，基于 RAG 检索增强问答，内置全文搜索、标签系统、高亮批注与知识图谱 |
| 🛡 **AI Agent** | 可配置权限的 AI 智能体，支持文件夹/标签管理、内容分析、网页搜索、自动标签等 |
| 🛡 **广告过滤** | 基于 EasyList China 规则 + AI 智能增强，DNR 网络拦截 + 元素隐藏，支持站点白名单 |
| 💤 **标签页休眠** | 自动休眠闲置标签页释放内存，支持白名单、固定/播放中/表单页保护 |
| 🎬 **弹幕管理姬** | 弹幕抓取与播放管理工具 |
| 📄 **保存为 PDF** | 一键将当前网页保存为 PDF 文件 |

## 🧠 支持的 AI 服务商

「无极」基于 **OpenAI 兼容 API** 设计，即插即用，一个配置框接入所有主流模型：

**国内**
DeepSeek · 阿里通义千问 · 智谱 GLM · 月之暗面 Kimi · 讯飞星火 · 零一万物 Yi · 百度文心一言 · MiniMax · 百川智能 · 阶跃星辰 · 硅基流动

**国外**
OpenAI · Anthropic Claude · Groq · Mistral · Cohere · Perplexity

**视觉模型**
智谱 AI · 通义千问 · Kimi · 阶跃星辰 · OpenAI · Google Gemini · Claude

> 此外还支持「自定义服务商」，可接入任意兼容 OpenAI 协议的 API 端点。

## 🔧 安装方法

### 方式一：加载已解压的扩展（推荐开发者）

1. 克隆本仓库到本地：
   ```bash
   git clone https://github.com/chonhxing/---AI-.git
   ```
2. 打开 Chrome / Edge，访问 `chrome://extensions`
3. 打开右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择仓库根目录
5. 点击工具栏的「无极」图标 →「设置」，填入你的 API Key 即可使用

### 方式二：直接下载源码

点击仓库右上角 **Code → Download ZIP**，解压后重复上述第 2~5 步。

## ⚙️ 快速配置

1. 点击浏览器工具栏的 **无极** 图标，进入「设置」
2. 在「语言模型」中选择服务商（如 DeepSeek），填入 API Key 与模型名
3. 点击「测试连接」验证配置
4. 视觉模型、翻译引擎可分别配置，留空则复用语言模型的密钥

> 🔒 **隐私说明**：所有 API Key 均仅保存在浏览器本地（`chrome.storage.local`），不会上传到任何服务器。

## 🏗️ 技术架构

- **Manifest V3**：Service Worker + Content Script 架构
- **Shadow DOM**：隔离样式，避免与宿主页面冲突
- **IndexedDB**：本地知识库存储
- **FTS 倒排索引**：知识库全文搜索
- **RAG**：检索增强生成，实现知识库问答
- **declarativeNetRequest (DNR)**：广告网络请求拦截
- **OpenAI Compatible API**：统一模型接入层

## 📁 目录结构

```
无极/
├── manifest.json          # 扩展清单（Manifest V3）
├── service-worker.js      # 后台服务
├── ui/                    # 界面
│   ├── popup.html/js/css  # 工具栏弹窗
│   ├── options.html/js    # 设置页
│   └── suspended.html/js  # 标签页休眠页
├── libs/                  # 核心逻辑
│   ├── content.js         # 内容脚本
│   ├── translator.js      # 沉浸式翻译
│   ├── kb-core.js         # 知识库核心
│   ├── kb-agent.js        # 知识库 Agent
│   ├── tab-suspender.js   # 标签页休眠
│   ├── danmaku-*.js       # 弹幕模块
│   └── adblock/           # 广告过滤
└── icons/                 # 图标资源
```

## ❤️ 支持作者

如果「无极」对你有帮助，欢迎点个 ⭐ Star，或通过扩展内的「赞助作者」支持我持续开发。

## 📄 许可证

[MIT License](LICENSE)

---

<div align="center">

**无极 · 智能 AI 浏览器助手** — 让 AI 融入每一次浏览

</div>
