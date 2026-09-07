import { reactive } from 'vue';
import http from './api';

export const store = reactive({
  stats: null,
  async loadStats() {
    try {
      this.stats = await http.get('/stats/today');
    } catch (e) {
      /* 忽略 */
    }
  },
});
