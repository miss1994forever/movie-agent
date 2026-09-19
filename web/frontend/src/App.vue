<script setup lang="ts">
import { ref } from "vue";
import AppShell from "./components/AppShell.vue";
import HistoryPage from "./pages/HistoryPage.vue";
import HomePage from "./pages/HomePage.vue";
import TasteProfilePage from "./pages/TasteProfilePage.vue";
import ManualPreferencesPage from "./pages/ManualPreferencesPage.vue";
import { liveMode } from "./locale";

const active = ref<"home" | "history" | "taste">("home");
</script>

<template>
  <AppShell :active="active" @change="active = $event">
    <HomePage v-if="active === 'home'" />
    <HistoryPage v-else-if="active === 'history'" />
    <ManualPreferencesPage v-else-if="active === 'taste' && liveMode" />
    <TasteProfilePage v-else-if="active === 'taste'" />
  </AppShell>
</template>
