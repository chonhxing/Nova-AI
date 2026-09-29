import { reactive } from 'vue';

/**
 * 各设置分区共用的状态提示条
 * const { status, show } = createStatus();
 */
export function createStatus() {
  const status = reactive({ text: '', type: 'info' });
  let timer = null;
  return {
    status,
    show(text, type = 'info', ms = 3000) {
      clearTimeout(timer);
      status.text = text;
      status.type = type;
      if (ms) timer = setTimeout(() => { status.text = ''; }, ms);
    },
  };
}
