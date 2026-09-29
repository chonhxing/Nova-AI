<script>
import WIcon from '../../shared/WIcon.vue';
import WToggle from '../../shared/WToggle.vue';
import { createStatus } from '../../shared/status.js';
import { storage, sendMessage } from '../../shared/chrome.js';

export default {
  name: 'AgentSection',
  components: { WIcon, WToggle },
  data() {
    return {
      ...createStatus(),
      perms: {
        can_manage_folders: true,
        can_parse_content: true,
        can_web_search: true,
        can_execute_commands: false,
        can_auto_tag: false,
      },
      permRows: [
        { key: 'can_manage_folders', label: '管理文件夹/标签', desc: '允许 Agent 整理知识库的文件夹与标签' },
        { key: 'can_parse_content', label: '分析内容', desc: '允许 Agent 读取和总结页面内容' },
        { key: 'can_web_search', label: '网页搜索', desc: '允许 Agent 联网搜索补充信息' },
        { key: 'can_execute_commands', label: '执行命令（需审批）', desc: '允许 Agent 执行受限的浏览器命令' },
        { key: 'can_auto_tag', label: '自动标签', desc: '保存到知识库时让 AI 自动打标签' },
      ],
      evalAllowlist: '',
      autoSavePages: false,
    };
  },
  async created() {
    try {
      const resp = await sendMessage({ type: 'KB_V2_AGENT_PERMISSIONS', payload: { action: 'load' } });
      if (resp?.success && resp.data) Object.assign(this.perms, resp.data);
      const r = await storage.sync.get(['agentSecurityConfig', 'privacyConfig']);
      const sec = r.agentSecurityConfig || {};
      this.evalAllowlist = (sec.evalAllowlist || []).join('\n');
      this.autoSavePages = r.privacyConfig?.autoSavePages === true;
    } catch { /* ignore */ }
  },
  methods: {
    async save() {
      try {
        const resp = await sendMessage({ type: 'KB_V2_AGENT_PERMISSIONS', payload: { action: 'save', permissions: { ...this.perms } } });
        const evalAllowlist = (this.evalAllowlist || '').split(/[\s\n,]+/).map((d) => d.trim()).filter(Boolean);
        await storage.sync.set({ agentSecurityConfig: { evalAllowlist } });
        await storage.sync.set({ privacyConfig: { autoSavePages: this.autoSavePages } });
        if (resp?.success) this.show('Agent 权限与安全设置已保存', 'success');
        else this.show('保存失败', 'error');
      } catch (e) {
        this.show('保存失败: ' + e.message, 'error');
      }
    },
  },
};
</script>

<template>
  <div>
    <div class="section-header">
      <div class="section-title"><WIcon name="agent" :size="19" /> Agent 权限</div>
      <div class="section-desc">控制 AI Agent 可以执行的操作范围</div>
    </div>

    <div class="card">
      <div v-for="row in permRows" :key="row.key" class="row">
        <div class="row-main">
          <div class="row-label">{{ row.label }}</div>
          <div class="row-desc">{{ row.desc }}</div>
        </div>
        <WToggle v-model="perms[row.key]" />
      </div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="shieldCheck" :size="14" /> AI 网页操作授权</div>
      <div class="field">
        <label>允许 AI 操作网页的域名（每行一个，如 www.bilibili.com）</label>
        <textarea
          v-model="evalAllowlist"
          rows="3"
          style="resize:vertical;"
          placeholder="默认全站禁止。列出后，AI 可在该域名内点击元素、读取页面结构、填写输入框。"
        />
        <div class="hint">v3.4 起 AI 网页操作默认全站拒绝（安全加固），只有在此列出的域名才被允许</div>
      </div>
      <div class="row">
        <div class="row-main">
          <div class="row-label">自动记忆访问页面（隐私）</div>
          <div class="row-desc">默认关闭；开启后会把访问过的页面全文存入本机知识库</div>
        </div>
        <WToggle v-model="autoSavePages" />
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" @click="save">保存权限</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>
  </div>
</template>
