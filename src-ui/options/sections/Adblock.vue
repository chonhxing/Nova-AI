<script>
import WIcon from '../../shared/WIcon.vue';
import WToggle from '../../shared/WToggle.vue';
import { createStatus } from '../../shared/status.js';
import { sendMessage, getActiveTab } from '../../shared/chrome.js';

function detectSiteName(domain) {
  const clean = domain.replace(/^www\./, '').replace(/\.[^.]+$/, '');
  if (clean.length <= 3) return clean.toUpperCase();
  return clean.split('.').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export default {
  name: 'AdblockSection',
  components: { WIcon, WToggle },
  data() {
    return {
      ...createStatus(),
      enabled: true,
      dnrCount: '-',
      cssCount: '-',
      updatedAt: '',
      lists: [],
      whitelist: [],
      wlInput: '',
    };
  },
  async created() {
    await this.load();
  },
  methods: {
    async load() {
      try {
        const stats = await sendMessage({ type: 'ADBLOCK_GET_STATS' });
        if (stats?.success) {
          const s = stats.stats;
          this.dnrCount = s.dnrRuleCount || 0;
          this.cssCount = (s.cosmeticGlobalCount || 0) + (s.cosmeticDomainCount || 0);
          this.enabled = s.enabled !== false;
          if (s.updatedAt) this.updatedAt = new Date(s.updatedAt).toLocaleString('zh-CN');
        }
        const lists = await sendMessage({ type: 'ADBLOCK_GET_LISTS' });
        if (lists?.success && lists.lists?.length) this.lists = lists.lists;
        await this.loadWhitelist();
      } catch { /* ignore */ }
    },
    async loadWhitelist() {
      try {
        const resp = await sendMessage({ type: 'ADBLOCK_WHITELIST_LIST' });
        this.whitelist = resp?.success ? resp.items || [] : [];
      } catch { /* ignore */ }
    },
    async toggleEnabled(on) {
      this.enabled = on;
      try {
        const resp = await sendMessage({ type: 'ADBLOCK_TOGGLE', enabled: on });
        if (resp?.success) this.show(on ? '广告过滤已启用' : '广告过滤已禁用', 'success');
      } catch (e) {
        this.show('操作失败: ' + e.message, 'error');
      }
    },
    async toggleList(list) {
      list.enabled = !list.enabled;
      try {
        await sendMessage({ type: 'ADBLOCK_SAVE_LISTS', lists: this.lists });
        this.show('过滤列表已保存，下次更新规则时生效', 'success');
      } catch (e) {
        this.show('保存失败: ' + e.message, 'error');
      }
    },
    async updateRules() {
      this.show('正在更新规则，可能需要几十秒...', 'info', 0);
      try {
        const resp = await sendMessage({ type: 'ADBLOCK_UPDATE_RULES' });
        if (resp?.success) {
          this.show('规则已更新到所有页面', 'success');
          setTimeout(() => this.load(), 1000);
        } else {
          this.show('更新失败: ' + (resp?.error || '未知错误'), 'error');
        }
      } catch (e) {
        this.show('更新失败: ' + e.message, 'error');
      }
    },
    async clearRules() {
      if (!confirm('确定清除所有广告过滤规则？')) return;
      try {
        const resp = await sendMessage({ type: 'ADBLOCK_CLEAR_RULES' });
        if (resp?.success) {
          this.show('所有规则已清除', 'success');
          this.load();
        }
      } catch (e) {
        this.show('清除失败: ' + e.message, 'error');
      }
    },
    async addWhitelist(domain) {
      let host = domain.trim().toLowerCase();
      if (!host) { this.show('请输入域名', 'error'); return; }
      try {
        host = new URL(host.includes('://') ? host : 'https://' + host).hostname;
      } catch { /* 保持原值 */ }
      const name = detectSiteName(host);
      try {
        const resp = await sendMessage({ type: 'ADBLOCK_WHITELIST_ADD_NAMED', domain: host, name });
        if (resp?.success) {
          this.show(`已添加 ${name} (${host}) 到白名单`, 'success');
          this.wlInput = '';
          this.loadWhitelist();
        } else {
          this.show(resp?.error || '添加失败', 'error');
        }
      } catch (e) {
        this.show('添加失败: ' + e.message, 'error');
      }
    },
    async addCurrentSite() {
      try {
        const tab = await getActiveTab();
        if (!tab?.url) { this.show('无法获取当前网站', 'error'); return; }
        await this.addWhitelist(new URL(tab.url).hostname);
      } catch {
        this.show('获取当前网站失败', 'error');
      }
    },
    async removeWhitelist(item) {
      try {
        const resp = await sendMessage({ type: 'ADBLOCK_WHITELIST_REMOVE', domain: item.domain });
        if (resp?.success) {
          this.show('已从白名单移除', 'success');
          this.loadWhitelist();
        }
      } catch { /* ignore */ }
    },
    async clearWhitelist() {
      if (!confirm('确定清空所有白名单网站？')) return;
      try {
        const resp = await sendMessage({ type: 'ADBLOCK_WHITELIST_CLEAR' });
        if (resp?.success) {
          this.show('白名单已清空', 'success');
          this.loadWhitelist();
        }
      } catch { /* ignore */ }
    },
  },
};
</script>

<template>
  <div>
    <div class="section-header">
      <div class="section-title"><WIcon name="shieldCheck" :size="19" /> 广告过滤</div>
      <div class="section-desc">EasyList China 规则 + 自定义规则，拦截广告请求和隐藏广告元素</div>
    </div>

    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="row-label">启用广告过滤</div>
          <div class="row-desc">关闭后立即停止拦截，所有页面恢复原样</div>
        </div>
        <WToggle :model-value="enabled" @update:model-value="toggleEnabled" />
      </div>

      <div class="stat-grid" style="margin-top:14px;">
        <div class="stat-card">
          <div class="num" style="color:var(--accent);">{{ dnrCount }}</div>
          <div class="label">DNR 网络规则</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--ok);">{{ cssCount }}</div>
          <div class="label">CSS 隐藏规则</div>
        </div>
        <div class="stat-card">
          <div class="num" style="font-size:12px; padding-top:6px;">{{ updatedAt || '--' }}</div>
          <div class="label">最后更新</div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary btn-sm" @click="updateRules">立即更新规则</button>
        <button class="btn btn-outline btn-sm" @click="clearRules">清除所有规则</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="refresh" :size="14" /> 过滤器规则列表</div>
      <div v-if="!lists.length" class="hint">暂无规则列表</div>
      <div v-for="list in lists" :key="list.id" class="list-item">
        <div style="flex:1;min-width:0;">
          <div class="list-name">{{ list.name }}</div>
          <div class="list-desc">{{ list.description || '' }}</div>
        </div>
        <WToggle :model-value="!!list.enabled" @update:model-value="toggleList(list)" />
      </div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="shieldCheck" :size="14" /> 网站白名单</div>
      <div class="hint" style="margin:0 0 12px;">白名单内的网站不会屏蔽广告，适合信任的网站或依赖广告的平台（当前 {{ whitelist.length }} 个）</div>
      <div style="display:flex;gap:8px;">
        <input
          v-model="wlInput"
          type="text"
          placeholder="例如: youtube.com 或 bilibili.com"
          style="flex:1;"
          @keydown.enter="addWhitelist(wlInput)"
        />
        <button class="btn btn-primary btn-sm" @click="addWhitelist(wlInput)"><WIcon name="plus" :size="13" /> 添加</button>
      </div>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn btn-outline btn-sm" @click="addCurrentSite">添加当前网站</button>
        <button v-if="whitelist.length" class="btn btn-danger btn-sm" @click="clearWhitelist">清空白名单</button>
      </div>

      <div v-if="whitelist.length" style="margin-top:14px;max-height:260px;overflow-y:auto;">
        <div v-for="item in whitelist" :key="item.domain" class="list-item">
          <div style="flex:1;min-width:0;">
            <span class="list-name">{{ item.name || item.domain }}</span>
            <span class="list-desc" style="margin-left:8px;">{{ item.domain }}</span>
          </div>
          <button class="btn btn-sm btn-danger" @click="removeWhitelist(item)">移除</button>
        </div>
      </div>
    </div>
  </div>
</template>
