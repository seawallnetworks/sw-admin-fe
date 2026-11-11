<script setup lang="ts">
// An access list entry's source or destination: Any, one host, or a network in CIDR form.
import { NInput, NRadioButton, NRadioGroup, NSpace } from 'naive-ui'
import type { AddrField, AddrKind } from '../ace'

const model = defineModel<AddrField>({ required: true })

function setKind(kind: AddrKind) {
  model.value = { kind, value: kind === model.value.kind ? model.value.value : '' }
}
</script>

<template>
  <NSpace vertical :size="6" style="width: 100%">
    <NRadioGroup :value="model.kind" size="small" @update:value="setKind">
      <NRadioButton value="any">Any</NRadioButton>
      <NRadioButton value="host">Host</NRadioButton>
      <NRadioButton value="network">Network</NRadioButton>
    </NRadioGroup>
    <NInput
      v-if="model.kind !== 'any'"
      :value="model.value"
      :placeholder="model.kind === 'host' ? 'For example 192.168.1.10' : 'For example 192.168.1.0/24'"
      @update:value="(v: string) => (model = { ...model, value: v })"
    />
  </NSpace>
</template>
