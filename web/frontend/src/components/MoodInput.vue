<script setup lang="ts">
import { Send } from "lucide-vue-next";

const props = defineProps<{
  loading: boolean;
  modelValue: string;
}>();

const emit = defineEmits<{
  submit: [string];
  "update:modelValue": [string];
}>();

const quickMoods = [
  "想看轻松但有余味的电影",
  "从 watchlist 里挑一部今晚适合看的",
  "想看王家卫那种氛围，但不要太沉重",
  "刚考完试，想看治愈一点的",
];

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
    <label for="mood">What's your mood today?</label>
    <textarea
      id="mood"
      :value="modelValue"
      rows="5"
      placeholder="比如：今天有点累，想看一部轻松、聪明、不要太长的电影"
      @input="updateMood(($event.target as HTMLTextAreaElement).value)"
      @keydown.meta.enter.prevent="submit"
      @keydown.ctrl.enter.prevent="submit"
    />
    <div class="chips">
      <button v-for="item in quickMoods" :key="item" type="button" @click="updateMood(item)">
        {{ item }}
      </button>
    </div>
    <button class="primary-button" type="button" :disabled="loading || !modelValue.trim()" @click="submit">
      <Send :size="18" />
      <span>{{ loading ? "Recommending..." : "Get Recommendations" }}</span>
    </button>
  </section>
</template>
