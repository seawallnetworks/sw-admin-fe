<script setup lang="ts">
import { useRoute } from 'vue-router'
import { NCard, NEmpty } from 'naive-ui'

const route = useRoute()
</script>

<template>
  <NCard :title="route.meta.title">
    <NEmpty description="Coming soon" style="padding: 60px 0" />
  </NCard>
</template>
