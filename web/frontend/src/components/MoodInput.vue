<script setup lang="ts">
import { Send } from "lucide-vue-next";
import { copy } from "../locale";

const props = defineProps<{
  loading: boolean;
  disabled?: boolean;
  modelValue: string;
}>();

const emit = defineEmits<{
  submit: [string];
  "update:modelValue": [string];
}>();

function submit() {
  const value = props.modelValue.trim();
  if (value) emit("submit", value);
}

function updateMood(value: string) {
  emit("update:modelValue", value);
}

</script>

<template>
  <section class="mood-panel">
    <label for="mood">{{ copy().moodLabel }}</label>
    <textarea
      id="mood"
      :value="modelValue"
      rows="3"
      :placeholder="copy().moodPlaceholder"
      @input="updateMood(($event.target as HTMLTextAreaElement).value)"
      @keydown.meta.enter.prevent="submit"
      @keydown.ctrl.enter.prevent="submit"
    />
    <div class="chips">
      <button v-for="item in copy().moodChips" :key="item" type="button" @click="updateMood(item)">
        {{ item }}
      </button>
    </div>
    <button class="primary-button" type="button" :disabled="loading || disabled || !modelValue.trim()" @click="submit">
      <Send :size="18" />
      <span>{{ loading ? copy().recommending : copy().getRecommendations }}</span>
    </button>
  </section>
</template>
