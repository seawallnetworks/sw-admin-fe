<script setup lang="ts">
// An access list entry's source or destination port (TCP and UDP only): any, one port, a range,
// or above or below a port.
import { NInputNumber, NSelect, NSpace } from 'naive-ui'
import type { PortField, PortOp } from '../ace'

const model = defineModel<PortField>({ required: true })

const opOptions: { label: string; value: PortOp }[] = [
  { label: 'Any port', value: 'any' },
  { label: 'Equal to', value: 'eq' },
  { label: 'Range', value: 'range' },
  { label: 'Greater than', value: 'gt' },
  { label: 'Less than', value: 'lt' },
]

const set = (patch: Partial<PortField>) => (model.value = { ...model.value, ...patch })
</script>

<template>
  <NSpace vertical :size="6" style="width: 100%">
    <NSpace :size="8" :wrap="false" align="center">
      <NSelect
        :value="model.op"
        :options="opOptions"
        size="small"
        style="width: 140px"
        @update:value="(op: PortOp) => set({ op })"
      />
      <template v-if="model.op !== 'any'">
        <NInputNumber
          :value="model.port"
          :min="1" :max="65535"
          :show-button="false"
          size="small"
          placeholder="Port"
          style="width: 100px"
          @update:value="(port: number | null) => set({ port })"
        />
        <template v-if="model.op === 'range'">
          <span>to</span>
          <NInputNumber
            :value="model.to"
            :min="1" :max="65535"
            :show-button="false"
            size="small"
            placeholder="Port"
            style="width: 100px"
            @update:value="(to: number | null) => set({ to })"
          />
        </template>
      </template>
    </NSpace>
  </NSpace>
</template>
