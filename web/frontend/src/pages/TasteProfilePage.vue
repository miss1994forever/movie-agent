<script setup lang="ts">
import { computed } from "vue";
import TasteProfilePanel from "../components/TasteProfilePanel.vue";
import { useRecommendationStore } from "../stores/recommendations";

const store = useRecommendationStore();

const useSavedTasteProfile = computed({
  get: () => store.useSavedTasteProfile,
  set: (value: boolean) => store.setUseSavedTasteProfile(value),
});
</script>

<template>
  <div class="page-stack">
    <TasteProfilePanel v-model:use-profile="useSavedTasteProfile" />
  </div>
</template>
