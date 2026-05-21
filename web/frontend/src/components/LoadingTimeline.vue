<script setup lang="ts">
defineProps<{
  active: boolean;
}>();
</script>

<template>
  <section v-if="active" class="timeline" aria-live="polite">
    <div class="pulse" />
    <ol>
      <li>Reading your Letterboxd context</li>
      <li>Searching and verifying candidate films</li>
      <li>Curating the final recommendation</li>
    </ol>
  </section>
</template>
