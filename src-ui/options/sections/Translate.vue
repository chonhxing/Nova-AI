<script>
import WIcon from '../../shared/WIcon.vue';
import WToggle from '../../shared/WToggle.vue';
import ProviderFields from './ProviderFields.vue';
import { createStatus } from '../../shared/status.js';
import { storage, sendMessage } from '../../shared/chrome.js';
import { PROVIDERS, chatPath } from '../../shared/providers-bridge.js';

export default {
  name: 'TranslateSection',
  components: { WIcon, WToggle, ProviderFields },
  data() {
    return {
      ...createStatus(),
      providers: PROVIDERS,
      settings: {
        hoverEnabled: true,
        inputEnabled: false,
        targetLang: 'zh-CN',
        displayMode: 'bilingual',
        fontSize: '13px',
        transColor: '#6366f1',
      },
      api: {
        engine: 'auto', provider: 'deepseek', apiKey: '', model: '', baseUrl: '',
        baiduAppid: '', baiduSecret: '', baiduApiKey: '', baiduLlmInstruction: '',
      },
    };
  },
  async created() {
    try {
      const [r, tApi] = await Promise.all([
        storage.sync.get('translatorConfig'),
        storage.sync.get('translatorApiConfig'),
      ]);
      if (r.translatorConfig) Object.assign(this.settings, r.translatorConfig);
      const t = tApi.translatorApiConfig || {};
      this.api.engine = t.engine || (t.apiKey ? 'ai' : 'auto');
      this.api.provider = t.provider || 'deepseek';
      this.api.apiKey = t.apiKey || '';
      this.api.model = t.model || '';
      this.api.baseUrl = t.baseUrl || '';
      this.api.baiduAppid = t.baiduAppid || '';
      this.api.baiduSecret = t.baiduSecret || '';
      this.api.baiduApiKey = t.baiduApiKey || '';
      this.api.baiduLlmInstruction = t.baiduLlmInstruction || '';
    } catch { /* ignore */ }
  },
  methods: {
    async save() {
      await storage.sync.set({ translatorConfig: { ...this.settings, cacheEnabled: true }, translatorApiConfig: { ...this.api } });
      this.show('翻译设置和 API 配置已保存', 'success');
    },
    async test() {
      // 百度引擎：交给 Service Worker 用与正式翻译完全相同的代码路径测试
      if (this.api.engine === 'baidu' || this.api.engine === 'baiduLlm') {
        const llm = this.api.engine === 'baiduLlm';
        if (!this.api.baiduAppid || (!llm && !this.api.baiduSecret) || (llm && !this.api.baiduApiKey && !this.api.baiduSecret)) {
          this.show(llm ? '请先填写百度翻译 AppID 和密钥（或 API Key）' : '请先填写百度翻译 AppID 和密钥', 'error');
          return;
        }
        this.show('正在测试百度翻译接口...', 'info', 0);
        try {
          const resp = await sendMessage({
            type: 'TRANSLATE_ENGINE_TEST',
            payload: {
              engine: this.api.engine,
              config: {
                baiduAppid: this.api.baiduAppid,
                baiduSecret: this.api.baiduSecret,
                baiduApiKey: this.api.baiduApiKey,
                baiduLlmInstruction: this.api.baiduLlmInstruction,
              },
            },
          });
          if (resp?.success) this.show((llm ? '百度翻译大模型' : '百度翻译') + '连接成功！｜' + (resp.text || ''), 'success');
          else this.show(resp?.error || '百度翻译连接失败', 'error');
        } catch (e) {
          this.show('百度翻译连接失败: ' + e.message, 'error');
        }
        return;
      }
      // 免费引擎：直接测 Google / 微软接口
      if (this.api.engine !== 'ai') {
        this.show('正在测试免费翻译引擎...', 'info', 0);
        try {
          try {
            const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=zh-CN&q=' + encodeURIComponent('Hello, this is a test.');
            const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (resp.ok) {
              const data = await resp.json();
              const text = (Array.isArray(data?.[0]) ? data[0] : []).map((s) => (Array.isArray(s) && s[0]) ? s[0] : '').join('');
              this.show('Google 翻译接口连接成功！｜' + text, 'success');
              return;
            }
          } catch { /* 落入微软兜底 */ }
          const auth = await fetch('https://edge.microsoft.com/translate/auth', { signal: AbortSignal.timeout(10000) })
            .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
          const msResp = await fetch('https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': auth.trim(), 'Or-Referer': 'https://cn.bing.com' },
            body: JSON.stringify([{ Text: 'Hello, this is a test.' }]),
          });
          if (!msResp.ok) throw new Error('HTTP ' + msResp.status);
          const msData = await msResp.json();
          this.show('Microsoft 翻译接口连接成功！｜' + (msData?.[0]?.translations?.[0]?.text || ''), 'success');
        } catch (e) {
          this.show('免费翻译接口均不可用: ' + e.message, 'error');
        }
        return;
      }
      let apiKey = this.api.apiKey;
      if (!apiKey) {
        const r = await storage.sync.get('apiConfig');
        apiKey = r.apiConfig?.apiKey || '';
      }
      if (!apiKey) { this.show('请先输入翻译 API Key 或配置语言模型 API Key', 'error'); return; }
      this.show('正在测试翻译 API...', 'info', 0);
      try {
        const baseUrl = (this.api.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
        const resp = await fetch(`${baseUrl}${chatPath(this.api.provider)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: this.api.model || 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) this.show('翻译 API 连接成功！', 'success');
        else {
          const err = await resp.text();
          this.show(`API 返回错误 ${resp.status}: ${err.substring(0, 100)}`, 'error');
        }
      } catch (e) {
        this.show('连接失败: ' + e.message, 'error');
      }
    },
    async clearCache() {
      await storage.local.remove('translatorCache');
      this.show('翻译缓存已清空', 'success');
    },
  },
};
</script>

<template>
  <div>
    <div class="section-header">
      <div class="section-title"><WIcon name="globe" :size="19" /> 网页翻译</div>
      <div class="section-desc">双语对照翻译。内置百度翻译大模型 / Google / 微软引擎，也可接 AI 模型获得更贴合语境的译文</div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="settings" :size="14" /> 基础设置</div>
      <div class="row">
        <div class="row-main">
          <div class="row-label">鼠标悬停翻译</div>
          <div class="row-desc">悬停在段落上 800ms 后显示译文</div>
        </div>
        <WToggle v-model="settings.hoverEnabled" />
      </div>
      <div class="row">
        <div class="row-main">
          <div class="row-label">输入框翻译</div>
          <div class="row-desc">在网页输入框内即时翻译正在输入的文字</div>
        </div>
        <WToggle v-model="settings.inputEnabled" />
      </div>
      <div class="field" style="margin-top:12px;">
        <label>目标语言</label>
        <select v-model="settings.targetLang">
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁体中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
        </select>
      </div>
      <div class="field">
        <label>显示模式</label>
        <select v-model="settings.displayMode">
          <option value="bilingual">双语对照（上原文下译文）</option>
          <option value="translation">仅显示译文</option>
        </select>
      </div>
      <div class="row">
        <div class="row-main"><div class="row-label">译文字号</div></div>
        <select v-model="settings.fontSize" style="width:100px;">
          <option value="12px">12px</option>
          <option value="13px">13px</option>
          <option value="14px">14px</option>
          <option value="15px">15px</option>
        </select>
      </div>
      <div class="row">
        <div class="row-main"><div class="row-label">译文颜色</div></div>
        <input v-model="settings.transColor" type="color" />
      </div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="bot" :size="14" /> 翻译引擎</div>
      <div class="field">
        <label>引擎</label>
        <select v-model="api.engine">
          <option value="auto">自动（已配置百度则优先，否则 Google → 微软）</option>
          <option value="baiduLlm">百度翻译大模型（质量最佳，支持翻译指令）</option>
          <option value="baidu">百度翻译·通用版（需 AppID+密钥）</option>
          <option value="google">Google 翻译（免费）</option>
          <option value="microsoft">Microsoft 翻译（免费）</option>
          <option value="ai">AI 模型翻译（更贴合语境，需 API Key）</option>
        </select>
        <div class="hint">免费引擎无需配置；百度引擎失败会自动降级到免费引擎</div>
      </div>

      <template v-if="api.engine === 'baidu' || api.engine === 'baiduLlm'">
        <div class="field">
          <label>百度翻译 APPID</label>
          <input v-model.trim="api.baiduAppid" type="text" placeholder="在百度翻译开放平台开发者信息中查看" autocomplete="off" />
          <div class="hint">
            前往
            <a href="https://fanyi-api.baidu.com/manage/developer" target="_blank" rel="noreferrer">开发者信息</a>
            查看 APPID 和密钥；使用大模型翻译需先
            <a href="https://fanyi-api.baidu.com/doc/21" target="_blank" rel="noreferrer">开通服务</a>
          </div>
        </div>
        <div class="field">
          <label>密钥</label>
          <input v-model.trim="api.baiduSecret" type="password" placeholder="与 APPID 配对的密钥" autocomplete="new-password" />
        </div>
        <template v-if="api.engine === 'baiduLlm'">
          <div class="field">
            <label>API Key（可选，推荐）</label>
            <input v-model.trim="api.baiduApiKey" type="password" placeholder="控制台 → API Key 管理 中创建；填后优先使用" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>翻译指令（可选）</label>
            <input v-model="api.baiduLlmInstruction" type="text" maxlength="500" placeholder="对译文的风格要求，如：使用学术风格来翻译" />
            <div class="hint">仅大模型翻译支持，500 字以内；标准版 QPS=1，大段翻译会自动节流</div>
          </div>
        </template>
      </template>

      <template v-if="api.engine === 'ai'">
        <ProviderFields :config="api" :providers="providers" key-placeholder="翻译专用 API Key（留空复用语言模型）" key-hint="留空则使用语言模型的 API Key" @status="show" />
        <div class="hint" style="margin-top:-6px;">推荐使用性价比高的模型，如 deepseek-chat</div>
      </template>

      <div class="btn-row">
        <button class="btn btn-primary" @click="save">保存全部翻译设置</button>
        <button class="btn btn-outline" @click="test">测试翻译引擎</button>
        <button class="btn btn-outline" @click="clearCache">清空翻译缓存</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>
  </div>
</template>
