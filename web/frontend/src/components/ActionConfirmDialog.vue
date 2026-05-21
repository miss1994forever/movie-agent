<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
  action?: string;
  rating?: number;
  review?: string;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
  "update:rating": [number];
  "update:review": [string];
}>();
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation">
    <section class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <label v-if="action === 'rate' || action === 'review'" class="dialog-field">
        <span>Rating</span>
        <select
          :value="rating ?? 8"
          :disabled="busy"
          @change="emit('update:rating', Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="value in [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]" :key="value" :value="value">
            {{ value / 2 }} stars
          </option>
        </select>
      </label>
      <label v-if="action === 'review'" class="dialog-field">
        <span>Review</span>
        <textarea
          :value="review ?? ''"
          rows="5"
          :disabled="busy"
          placeholder="Write your Letterboxd review"
          @input="emit('update:review', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" :disabled="busy" @click="emit('cancel')">Cancel</button>
        <button type="button" class="danger-button" :disabled="busy" @click="emit('confirm')">
          {{ busy ? "Working..." : "Confirm" }}
        </button>
      </div>
    </section>
  </div>
</template>
