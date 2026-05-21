<script setup lang="ts">
import { ref } from "vue";
import AppShell from "./components/AppShell.vue";
import HistoryPage from "./pages/HistoryPage.vue";
import HomePage from "./pages/HomePage.vue";
import SettingsPage from "./pages/SettingsPage.vue";

const active = ref<"home" | "history" | "settings">("home");
</script>

<template>
  <AppShell :active="active" @change="active = $event">
    <HomePage v-if="active === 'home'" />
    <HistoryPage v-else-if="active === 'history'" />
    <SettingsPage v-else />
  </AppShell>
</template>
