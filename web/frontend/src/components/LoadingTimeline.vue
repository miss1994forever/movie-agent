<script setup lang="ts">
import type { AgentStatus } from "../api/types";

const props = defineProps<{
  active: boolean;
  stage?: string;
  agents?: AgentStatus[];
  events?: string[];
}>();

const stageLabels: Record<string, string> = {
  queued: "Queued",
  starting: "Starting backend job",
  checking_letterboxd: "Checking Letterboxd",
  running_crewai: "Running Taste Analyst / Film Scout / Curator",
  parsing_results: "Parsing recommendation results",
  finished: "Finished",
  failed: "Failed",
};
</script>

<template>
  <section v-if="active" class="timeline" aria-live="polite">
    <div class="pulse" />
    <div>
      <strong>{{ stageLabels[props.stage || ""] || props.stage || "Running" }}</strong>
      <ol>
        <li :class="{ done: ['running_crewai', 'parsing_results', 'finished'].includes(props.stage || '') }">
          Connect to MCP and check Letterboxd
        </li>
        <li :class="{ done: ['parsing_results', 'finished'].includes(props.stage || '') }">
          Run the crewAI recommendation pipeline
        </li>
        <li :class="{ done: props.stage === 'finished' }">
          Parse movie cards and save history
        </li>
      </ol>
      <div v-if="props.agents?.length" class="agent-status-list">
        <article v-for="agent in props.agents" :key="agent.name" :class="agent.status">
          <span>{{ agent.status }}</span>
          <strong>{{ agent.name }}</strong>
          <p>{{ agent.detail }}</p>
        </article>
      </div>
      <ul v-if="props.events?.length" class="crew-events">
        <li v-for="event in props.events.slice(-5)" :key="event">{{ event }}</li>
      </ul>
    </div>
  </section>
</template>
