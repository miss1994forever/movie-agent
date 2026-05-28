import { createApp } from "vue";
import { createPinia } from "pinia";
import "vant/lib/index.css";
import "./styles.css";
import App from "./App.vue";
import { useAppStore } from "./stores/app";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
useAppStore(pinia).initTheme();
app.mount("#app");
