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
  "Something light but lingering",
  "Pick something from my watchlist for tonight",
  "A Wong Kar-wai mood, but not too heavy",
  "I just finished exams and want something healing",
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
      placeholder="For example: I'm a little tired tonight and want something smart, light, and not too long."
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
