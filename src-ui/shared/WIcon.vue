<script>
import { ICONS } from './icons.js';

export default {
  name: 'WIcon',
  props: {
    name: { type: String, required: true },
    size: { type: [Number, String], default: 16 },
  },
  computed: {
    html() {
      return ICONS[this.name] || '';
    },
  },
};
</script>

<template>
  <span
    class="wicon"
    :style="{ width: size + 'px', height: size + 'px' }"
    v-html="html"
  />
</template>

<style>
.wicon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 0;
}
.wicon svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
