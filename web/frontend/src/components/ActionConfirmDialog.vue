<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation">
    <section class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" :disabled="busy" @click="emit('cancel')">Cancel</button>
        <button type="button" class="danger-button" :disabled="busy" @click="emit('confirm')">
          {{ busy ? "Working..." : "Confirm" }}
        </button>
      </div>
    </section>
  </div>
</template>
