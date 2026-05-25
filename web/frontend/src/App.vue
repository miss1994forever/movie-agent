<script setup lang="ts">
import { ref } from "vue";
import AppShell from "./components/AppShell.vue";
import HistoryPage from "./pages/HistoryPage.vue";
import HomePage from "./pages/HomePage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import TasteProfilePage from "./pages/TasteProfilePage.vue";

const active = ref<"home" | "history" | "taste" | "settings">("home");
</script>

<template>
  <AppShell :active="active" @change="active = $event">
    <HomePage v-if="active === 'home'" />
    <HistoryPage v-else-if="active === 'history'" />
    <TasteProfilePage v-else-if="active === 'taste'" />
    <SettingsPage v-else />
  </AppShell>
</template>
