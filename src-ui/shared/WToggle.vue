<script>
/**
 * 开关（对齐 iOS / Monica 设置页风格）
 * Vue 3 v-model 契约：modelValue prop + update:modelValue 事件
 * （Vue 2 的 model 选项已被移除，用它会导致 v-model 完全失联）
 */
export default {
  name: 'WToggle',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  computed: {
    on() {
      return this.modelValue;
    },
  },
  methods: {
    toggle() {
      this.$emit('update:modelValue', !this.modelValue);
    },
  },
};
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="on ? 'true' : 'false'"
    class="wtoggle"
    :class="{ on }"
    @click="toggle"
  />
</template>

<style>
.wtoggle {
  width: 42px;
  height: 24px;
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--hairline);
  position: relative;
  transition: background var(--t), border-color var(--t);
  flex-shrink: 0;
  padding: 0;
}
.wtoggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform var(--t);
}
.wtoggle.on {
  background: var(--accent);
  border-color: transparent;
}
.wtoggle.on::after {
  transform: translateX(18px);
}
</style>
