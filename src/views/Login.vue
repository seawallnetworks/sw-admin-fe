<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, type FormInst, type FormRules } from 'naive-ui'
import HelpDrawer from '../components/HelpDrawer.vue'
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
    { required: true, message: 'Enter your user name', trigger: 'blur' },
    {
      validator: (_rule, v: string) => !v || USER_RE.test(v),
      message: 'A user name is 1 to 32 letters, digits, dots, underscores or hyphens, and can\'t start with a dot or a hyphen',
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: 'Enter your password', trigger: 'blur' },
    {
      validator: (_rule, v: string) => !/[\r\n\0]/.test(v) && new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES,
      message: 'A password is at most 256 bytes, with no line breaks',
      trigger: 'blur',
    },
  ],
}

function loginError(e: unknown) {
  if (!(e instanceof ApiError)) return 'Login failed'
  if (e.status === 401) return 'Wrong user name or password'
  if (e.status === 429) return 'Too many login attempts. Try again in a minute.'
  if (e.status === 502) return 'The device is not responding. Please try again later.'
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
    <NCard title="Seawall Admin Console" class="card" :bordered="false">
      <NForm ref="formRef" :model="form" :rules="rules" :show-require-mark="false" @submit.prevent="onSubmit">
        <NFormItem label="User name" path="user">
          <NInput v-model:value="form.user" placeholder="User name" autofocus />
        </NFormItem>
        <NFormItem label="Password" path="password">
          <NInput
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            placeholder="Password"
          />
        </NFormItem>
        <NAlert v-if="error" type="error" :show-icon="true" class="error">{{ error }}</NAlert>
        <NButton type="primary" block attr-type="submit" :loading="loading">Log In</NButton>
        <p v-if="USE_MOCK" class="hint">Mock mode: admin / admin</p>
        <p class="hint"><HelpDrawer text /></p>
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
