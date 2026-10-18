<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import {
  NButton, NCard, NDataTable, NForm, NFormItem, NInput, NInputNumber, NModal, NPopconfirm, NRadioButton,
  NRadioGroup, NSelect, NSpace, NSwitch, NTag, useMessage, type DataTableColumns, type FormInst, type FormRules,
} from 'naive-ui'
import {
  createAclRule, deleteAclRule, listAclRules, refreshPendingChanges, updateAclRule,
  type AclAction, type AclRule, type AclRuleInput, type Protocol,
} from '../api'

const message = useMessage()

// ---------- list ----------

// The backend returns the whole rule set in one call (rule counts are small);
// searching, filtering and paging all happen here in the browser.

const keyword = ref('')
const action = ref<AclAction | null>(null)
const allRules = ref<AclRule[]>([])
const loading = ref(false)

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return allRules.value
    .filter((r) => !action.value || r.action === action.value)
    .filter((r) => !kw || r.name.toLowerCase().includes(kw) || r.source.includes(kw))
    .sort((a, b) => a.priority - b.priority)
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  showSizePicker: true,
  pageSizes: [10, 20, 50],
  prefix: ({ itemCount }: { itemCount: number | undefined }) => `共 ${itemCount ?? 0} 条`,
})

async function load() {
  loading.value = true
  try {
    allRules.value = await listAclRules()
  } catch {
    // error already shown by api.ts
  } finally {
    loading.value = false
  }
}

// A new search or filter starts again from the first page.
watch([keyword, action], () => {
  pagination.page = 1
})
// After a delete the last page may be gone; step back to the last one that exists.
watch(rows, (list) => {
  const lastPage = Math.max(1, Math.ceil(list.length / pagination.pageSize))
  if (pagination.page > lastPage) pagination.page = lastPage
})

function onPageChange(page: number) {
  pagination.page = page
}
function onPageSizeChange(size: number) {
  pagination.pageSize = size
  pagination.page = 1
}

onMounted(load)

/** Run a mutation, then refresh the list and the "unsaved changes" counter. */
async function mutate(fn: () => Promise<unknown>, okText: string) {
  await fn()
  message.success(okText)
  refreshPendingChanges().catch(() => {})
  await load()
}

async function onToggle(row: AclRule, enabled: boolean) {
  row.enabled = enabled
  try {
    await mutate(() => updateAclRule(row.id, { enabled }), enabled ? '规则已启用' : '规则已停用')
  } catch {
    row.enabled = !enabled
  }
}

async function onDelete(row: AclRule) {
  await mutate(() => deleteAclRule(row.id), '规则已删除').catch(() => {})
}

// ---------- add / edit dialog ----------

const protocolLabels: Record<Protocol, string> = { tcp: 'TCP', udp: 'UDP', icmp: 'ICMP', any: 'ANY' }
const protocolOptions = (Object.keys(protocolLabels) as Protocol[]).map((p) => ({ label: protocolLabels[p], value: p }))
const portless = (p: Protocol) => p === 'icmp' || p === 'any'
const actionOptions = [
  { label: '允许', value: 'allow' },
  { label: '拒绝', value: 'deny' },
]

/** The dialog's fields: a rule, with the port as the input box's text ('' for any port). */
type RuleForm = Omit<AclRuleInput, 'port'> & { port: string }

const emptyForm = (): RuleForm => ({
  priority: 100,
  name: '',
  source: '',
  protocol: 'tcp',
  port: '',
  action: 'deny',
  enabled: true,
})

const showEditor = ref(false)
const editingId = ref<number | null>(null)
const form = ref<RuleForm>(emptyForm())
const formRef = ref<FormInst | null>(null)
const submitting = ref(false)

const formRules: FormRules = {
  name: { required: true, message: '请输入规则名称', trigger: 'blur' },
  source: { required: true, message: '请输入源地址，例如 10.0.0.0/8', trigger: 'blur' },
  priority: { required: true, type: 'number', message: '请输入优先级', trigger: 'blur' },
}

function openEditor(row?: AclRule) {
  editingId.value = row?.id ?? null
  form.value = row
    ? { priority: row.priority, name: row.name, source: row.source, protocol: row.protocol, port: row.port ?? '', action: row.action, enabled: row.enabled }
    : emptyForm()
  showEditor.value = true
}

async function onSubmit() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const port = form.value.port.trim()
  const data: AclRuleInput = { ...form.value, port: portless(form.value.protocol) || !port ? null : port }
  submitting.value = true
  try {
    if (editingId.value === null) {
      await mutate(() => createAclRule(data), '规则已添加')
    } else {
      const id = editingId.value
      await mutate(() => updateAclRule(id, data), '规则已更新')
    }
    showEditor.value = false
  } catch {
    // keep dialog open
  } finally {
    submitting.value = false
  }
}

// ---------- table ----------

const columns: DataTableColumns<AclRule> = [
  { title: '优先级', key: 'priority', width: 80 },
  { title: '名称', key: 'name', ellipsis: { tooltip: true } },
  { title: '源地址', key: 'source' },
  { title: '协议/端口', key: 'protocol', render: (r) => protocolLabels[r.protocol] + (portless(r.protocol) ? '' : ` / ${r.port ?? '全部'}`) },
  {
    title: '动作',
    key: 'action',
    width: 80,
    render: (r) =>
      h(NTag, { type: r.action === 'allow' ? 'success' : 'error', size: 'small' }, () =>
        r.action === 'allow' ? '允许' : '拒绝',
      ),
  },
  { title: '命中次数', key: 'hits', width: 110, render: (r) => r.hits.toLocaleString('zh-CN') },
  {
    title: '启用',
    key: 'enabled',
    width: 70,
    render: (r) => h(NSwitch, { value: r.enabled, size: 'small', onUpdateValue: (v: boolean) => onToggle(r, v) }),
  },
  {
    title: '操作',
    key: 'ops',
    width: 130,
    render: (r) =>
      h(NSpace, { size: 4 }, () => [
        h(NButton, { size: 'small', text: true, type: 'primary', onClick: () => openEditor(r) }, () => '编辑'),
        h(
          NPopconfirm,
          { onPositiveClick: () => onDelete(r) },
          {
            trigger: () => h(NButton, { size: 'small', text: true, type: 'error' }, () => '删除'),
            default: () => `确定删除规则「${r.name}」吗？`,
          },
        ),
      ]),
  },
]
</script>

<template>
  <NCard>
    <NSpace justify="space-between" style="margin-bottom: 16px">
      <NSpace>
        <NInput v-model:value="keyword" placeholder="搜索名称或源地址" clearable style="width: 240px" />
        <NSelect
          v-model:value="action"
          :options="actionOptions"
          placeholder="全部动作"
          clearable
          style="width: 140px"
        />
      </NSpace>
      <NButton type="primary" @click="openEditor()">添加规则</NButton>
    </NSpace>

    <NDataTable
      :columns="columns"
      :data="rows"
      :loading="loading"
      :pagination="pagination"
      :row-key="(r: AclRule) => r.id"
      @update:page="onPageChange"
      @update:page-size="onPageSizeChange"
    />
  </NCard>

  <NModal
    v-model:show="showEditor"
    preset="card"
    :title="editingId === null ? '添加规则' : '编辑规则'"
    style="width: 520px"
    :mask-closable="false"
  >
    <NForm ref="formRef" :model="form" :rules="formRules" label-placement="left" label-width="80">
      <NFormItem label="名称" path="name">
        <NInput v-model:value="form.name" />
      </NFormItem>
      <NFormItem label="优先级" path="priority">
        <NInputNumber
          :value="form.priority"
          :min="1" :max="65535"
          style="width: 100%"
          @update:value="(v) => (form.priority = v ?? 1)"
        />
      </NFormItem>
      <NFormItem label="源地址" path="source">
        <NInput v-model:value="form.source" placeholder="IP 或 CIDR，例如 192.168.1.0/24" />
      </NFormItem>
      <NFormItem label="协议">
        <NSelect v-model:value="form.protocol" :options="protocolOptions" />
      </NFormItem>
      <NFormItem label="端口">
        <NInput
          v-model:value="form.port"
          placeholder="例如 80、8000-8080，留空表示全部"
          :disabled="portless(form.protocol)"
        />
      </NFormItem>
      <NFormItem label="动作">
        <NRadioGroup v-model:value="form.action">
          <NRadioButton value="allow">允许</NRadioButton>
          <NRadioButton value="deny">拒绝</NRadioButton>
        </NRadioGroup>
      </NFormItem>
      <NFormItem label="启用">
        <NSwitch v-model:value="form.enabled" />
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showEditor = false">取消</NButton>
        <NButton type="primary" :loading="submitting" @click="onSubmit">确定</NButton>
      </NSpace>
    </template>
  </NModal>
</template>
