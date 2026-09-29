/**
 * 无极 — AI 服务商目录（唯一数据源）
 * 同时供两处消费：
 *   1. service-worker：importScripts 后读 self.WUJI_PROVIDERS
 *   2. 设置页（Vue 打包）：作为副作用 import，读 window.WUJI_PROVIDERS
 *
 * path 为 chat/completions 的拼接路径，缺省 '/v1/chat/completions'，
 * 非 OpenAI 标准路径的服务商（智谱 v4 / 千帆 v2 / Gemini 兼容层 / Cohere 兼容层）必须显式给出。
 * 维护提示：改这里之后不需要再动 service-worker.js / 设置页，两处都从本文件取值。
 */
(function (root) {
  'use strict';

  var DEFAULT_PATH = '/v1/chat/completions';

  var PROVIDERS = {
    // —— 国内 ——
    deepseek:    { name: 'DeepSeek',          baseUrl: 'https://api.deepseek.com',                          model: 'deepseek-chat',            site: 'https://platform.deepseek.com/api_keys',      group: 'cn', hint: '常用：deepseek-chat / deepseek-reasoner' },
    qwen:        { name: '阿里 · 通义千问',     baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',    model: 'qwen-plus',                site: 'https://bailian.console.aliyun.com/?apiKey=1', group: 'cn', hint: '常用：qwen-plus / qwen-max' },
    zhipu:       { name: '智谱 · GLM',        baseUrl: 'https://open.bigmodel.cn/api/paas',                  model: 'glm-4-flash',              path: '/v4/chat/completions',                         site: 'https://open.bigmodel.cn/usercenter/apikeys', group: 'cn', hint: 'glm-4-flash 免费；视觉用 glm-4.6v-flash' },
    moonshot:    { name: '月之暗面 · Kimi',    baseUrl: 'https://api.moonshot.cn',                            model: 'moonshot-v1-8k',           site: 'https://platform.moonshot.cn/console/api-keys', group: 'cn', hint: '常用：moonshot-v1-8k / moonshot-v1-32k' },
    spark:       { name: '讯飞 · 星火',        baseUrl: 'https://spark-api-open.xf-yun.com',                  model: 'lite',                     site: 'https://console.xfyun.cn/services/bm3',        group: 'cn', hint: 'lite 便宜；4.0Ultra 效果更好' },
    yi:          { name: '零一万物 · Yi',      baseUrl: 'https://api.lingyiwanwu.com',                        model: 'yi-large',                 site: 'https://platform.lingyiwanwu.com/apikeys',     group: 'cn' },
    wenxin:      { name: '百度 · 千帆',        baseUrl: 'https://qianfan.baidubce.com',                       model: 'ernie-4.0-8k',             path: '/v2/chat/completions',                         site: 'https://console.bce.baidu.com/iam/#/iam/apikey/list', group: 'cn', hint: '千帆 v2 OpenAI 兼容接口，需千帆 API Key（v2）' },
    minimax:     { name: 'MiniMax',           baseUrl: 'https://api.minimaxi.com',                           model: 'MiniMax-Text-01',          site: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', group: 'cn' },
    baichuan:    { name: '百川智能',           baseUrl: 'https://api.baichuan-ai.com',                        model: 'Baichuan4',                site: 'https://platform.baichuan-ai.com/apikeys',     group: 'cn' },
    stepfun:     { name: '阶跃星辰',           baseUrl: 'https://api.stepfun.com',                            model: 'step-2-mini',              site: 'https://platform.stepfun.com/interface-key',   group: 'cn' },
    siliconflow: { name: '硅基流动',           baseUrl: 'https://api.siliconflow.cn',                         model: 'Qwen/Qwen2.5-7B-Instruct', site: 'https://cloud.siliconflow.cn/account/ak',      group: 'cn', hint: '聚合平台，国内直连、部分模型免费' },
    // —— 国外 ——
    openai:      { name: 'OpenAI',            baseUrl: 'https://api.openai.com',                             model: 'gpt-4.1-mini',             site: 'https://platform.openai.com/api-keys',         group: 'overseas' },
    claude:      { name: 'Anthropic · Claude', baseUrl: 'https://api.anthropic.com',                          model: 'claude-3-5-haiku-latest',  site: 'https://console.anthropic.com/settings/keys',  group: 'overseas', hint: '走 Anthropic OpenAI 兼容层' },
    groq:        { name: 'Groq',              baseUrl: 'https://api.groq.com/openai',                        model: 'llama-3.3-70b-versatile',  site: 'https://console.groq.com/keys',                group: 'overseas', hint: '速度极快，免费额度充足' },
    mistral:     { name: 'Mistral',           baseUrl: 'https://api.mistral.ai',                             model: 'mistral-small-latest',     site: 'https://console.mistral.ai/api-keys',          group: 'overseas' },
    cohere:      { name: 'Cohere',            baseUrl: 'https://api.cohere.com',                             model: 'command-a-03-2025',        path: '/compatibility/v1/chat/completions',           site: 'https://dashboard.cohere.com/api-keys', group: 'overseas', hint: '走 Cohere OpenAI 兼容层' },
    perplexity:  { name: 'Perplexity',        baseUrl: 'https://api.perplexity.ai',                          model: 'sonar',                    site: 'https://www.perplexity.ai/settings/api',       group: 'overseas', hint: 'sonar 自带联网搜索' },
    openrouter:  { name: 'OpenRouter · 聚合',  baseUrl: 'https://openrouter.ai/api/v1',                       model: 'deepseek/deepseek-chat',   site: 'https://openrouter.ai/settings/keys',          group: 'overseas', hint: '一个 Key 调用数百个模型' },
    // —— 其他 ——
    custom:      { name: '自定义服务商',        baseUrl: '', model: '', site: '', group: 'custom', hint: '任何兼容 OpenAI 协议的服务都能接入' }
  };

  // 视觉模型专用默认值（baseUrl/model 与文本模型不同）
  var VISION_PROVIDERS = {
    zhipu:    { name: '智谱 AI',            baseUrl: 'https://open.bigmodel.cn/api/paas', model: 'glm-4.6v-flash',            path: '/v4/chat/completions',               site: 'https://open.bigmodel.cn/usercenter/apikeys' },
    qwen:     { name: '阿里 · 通义千问',      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-vl-plus', site: 'https://bailian.console.aliyun.com/?apiKey=1' },
    moonshot: { name: '月之暗面 · Kimi',     baseUrl: 'https://api.moonshot.cn',           model: 'moonshot-v1-8k-vision-preview', site: 'https://platform.moonshot.cn/console/api-keys' },
    openai:   { name: 'OpenAI',             baseUrl: 'https://api.openai.com',            model: 'gpt-4.1-mini',              site: 'https://platform.openai.com/api-keys' },
    gemini:   { name: 'Google · Gemini',    baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', path: '/v1beta/openai/chat/completions', site: 'https://aistudio.google.com/apikey', hint: '走 Gemini OpenAI 兼容层' },
    claude:   { name: 'Anthropic · Claude', baseUrl: 'https://api.anthropic.com',         model: 'claude-3-5-haiku-latest',   site: 'https://console.anthropic.com/settings/keys' },
    stepfun:  { name: '阶跃星辰',            baseUrl: 'https://api.stepfun.com',           model: 'step-1v-flash',             site: 'https://platform.stepfun.com/interface-key' },
    custom:   { name: '自定义',              baseUrl: '', model: '', site: '' }
  };

  /**
   * 取某服务商 chat/completions 的完整请求路径
   * @param {string} provider 服务商 key
   * @param {'text'|'vision'} kind 配置类别（vision 里 gemini 有独立 path）
   */
  function chatApiPath(provider, kind) {
    var table = kind === 'vision' ? VISION_PROVIDERS : PROVIDERS;
    var p = table[provider] || (kind === 'vision' ? PROVIDERS[provider] : null) || VISION_PROVIDERS[provider];
    return (p && p.path) || DEFAULT_PATH;
  }

  root.WUJI_PROVIDERS = PROVIDERS;
  root.WUJI_VISION_PROVIDERS = VISION_PROVIDERS;
  root.WUJI_CHAT_PATH = chatApiPath;
  root.WUJI_DEFAULT_PATH = DEFAULT_PATH;
})(typeof self !== 'undefined' ? self : this);
