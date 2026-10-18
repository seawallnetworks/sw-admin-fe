<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, type FormInst, type FormRules } from 'naive-ui'
import { ApiError, USE_MOCK, login } from '../api'

const router = useRouter()
const route = useRoute()

const formRef = ref<FormInst | null>(null)
const form = reactive({ user: '', password: '' })

// sw_authd's rules; a login outside them fails like a wrong password, so say why here instead
const USER_RE = /^(?![.-])[A-Za-z0-9._-]{1,32}$/
const PASSWORD_MAX_BYTES = 256
const rules: FormRules = {
  user: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    {
      validator: (_rule, v: string) => !v || USER_RE.test(v),
      message: '用户名为 1-32 个字母、数字或 . _ -，且不能以 . 或 - 开头',
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    {
      validator: (_rule, v: string) => !/[\r\n\0]/.test(v) && new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES,
      message: '密码不能超过 256 字节，且不能包含换行',
      trigger: 'blur',
    },
  ],
}

function loginError(e: unknown) {
  if (!(e instanceof ApiError)) return '登录失败'
  if (e.status === 401) return '用户名或密码错误'
  if (e.status === 429) return '登录尝试过于频繁，请一分钟后再试'
  if (e.status === 502) return '设备无响应，请稍后重试'
  return e.message
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
    await login(form.user, form.password)
    const redirect = route.query.redirect
    router.replace(typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/dashboard')
  } catch (e) {
    error.value = loginError(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page">
    <NCard title="Seawall 管理控制台" class="card" :bordered="false">
      <NForm ref="formRef" :model="form" :rules="rules" :show-require-mark="false" @submit.prevent="onSubmit">
        <NFormItem label="用户名" path="user">
          <NInput v-model:value="form.user" placeholder="用户名" autofocus />
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
