<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, type FormInst, type FormRules } from 'naive-ui'
import { USE_MOCK, login } from '../api'

const router = useRouter()
const route = useRoute()

const formRef = ref<FormInst | null>(null)
const form = reactive({ username: '', password: '' })
const rules: FormRules = {
  username: { required: true, message: '请输入用户名', trigger: 'blur' },
  password: { required: true, message: '请输入密码', trigger: 'blur' },
}
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  error.value = ''
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    await login(form.username, form.password)
    const redirect = route.query.redirect
    router.replace(typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/dashboard')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <NCard title="Seawall 管理控制台" class="card" :bordered="false">
      <NForm ref="formRef" :model="form" :rules="rules" :show-require-mark="false" @submit.prevent="onSubmit">
        <NFormItem label="用户名" path="username">
          <NInput v-model:value="form.username" placeholder="用户名" autofocus />
        </NFormItem>
        <NFormItem label="密码" path="password">
          <NInput
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            placeholder="密码"
          />
        </NFormItem>
        <NAlert v-if="error" type="error" :show-icon="true" class="error">{{ error }}</NAlert>
        <NButton type="primary" block attr-type="submit" :loading="loading">登录</NButton>
        <p v-if="USE_MOCK" class="hint">Mock 模式：admin / admin</p>
      </NForm>
    </NCard>
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f2d3d, #2b5876);
}
.card {
  width: 360px;
}
.error {
  margin-bottom: 16px;
}
.hint {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12px;
  color: #999;
}
</style>
