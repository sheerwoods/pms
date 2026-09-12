<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <el-icon :size="26"><Hotel /></el-icon>
        <span>酒店 PMS</span>
      </div>
      <el-form :model="form" label-position="top" @submit.prevent>
        <el-form-item label="账号">
          <el-input v-model="form.username" size="large" placeholder="请输入账号" autocomplete="username" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" size="large" show-password placeholder="请输入密码" autocomplete="current-password" @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="submit">登录</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { login } from '../utils/auth';

const route = useRoute();
const router = useRouter();
const form = reactive({ username: '', password: '' });
const loading = ref(false);

async function submit() {
  if (!form.username.trim() || !form.password) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  loading.value = true;
  try {
    await login(form.username.trim(), form.password);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/room-status';
    router.replace(redirect);
  } catch {
    /* 接口层已提示 */
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #eef3fb 0%, #dfe8f6 100%);
}
.login-card {
  width: 360px;
  padding: 32px 28px 24px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(31, 56, 105, 0.14);
}
.login-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 24px;
  font-size: 20px;
  font-weight: 600;
  color: #1f3869;
}
.login-btn {
  width: 100%;
  margin-top: 4px;
}
</style>
