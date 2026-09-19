import { ref, watch } from "vue";
import type { MovieRecommendation, RecommendationJob } from "./api/types";

export type Language = "zh" | "en";
export const liveMode = Boolean(import.meta.env.VITE_LIVE_API_URL);
const key = "movie-rec.language";
const stored = localStorage.getItem(key);
export const language = ref<Language>(
  stored === "zh" || stored === "en" ? stored : navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en",
);
watch(language, (value) => {
  localStorage.setItem(key, value);
  document.documentElement.lang = value === "zh" ? "zh-CN" : "en";
}, { immediate: true });

const messages = {
  zh: {
    brand: "今夜放映", themeLight: "切换浅色模式", themeDark: "切换深色模式",
    recommend: "推荐", history: "历史记录", taste: liveMode ? "观影偏好" : "口味画像",
    status: "交互演示 · 虚构示例数据 · 记录只保存在此浏览器",
    heroEyebrow: "A CINEMA FOR YOUR MOOD", heroTitle: "今晚的电影，\n从你的心情开始。", heroSubtitle: "说说此刻想看什么，等幕布打开，遇见适合今晚的电影。",
    moodLabel: "此刻想看",
    moodPlaceholder: "例如：今晚有点累，想看一部轻松又有余味的电影。",
    moodChips: ["轻松但不空洞", "想看一点科幻", "悬疑但不压抑", "今晚需要治愈"],
    getRecommendations: "为今晚选一部", recommending: "正在挑选…",
    boardLabel: "TONIGHT'S PICK", boardWaiting: "YOUR FILM AWAITS", stageWaiting: "幕布打开，今晚的电影就会出现。", stageLoading: "正在为今晚挑选电影…", stageFirst: "今晚的第一部", stageSecond: "另一部选择", featureHeading: "为什么是它", curtainReplay: "重放开幕", cancel: "取消推荐", demoFootnote: liveMode ? "实时 AI 推荐 · 图片来自 TMDB · 记录仅保存在此浏览器" : "交互演示使用虚构口味数据，推荐记录仅保存在此浏览器。", noBackdrop: "电影画面示意",
    latest: "最近一次推荐", historyTitle: "历史记录", refresh: "刷新", loading: "加载中…",
    noHistory: "还没有推荐记录。", saved: "已保存的推荐", select: "选择一条推荐记录。",
    delete: "删除", profileEyebrow: "示例口味画像", profileTitle: "虚构观众的观影地图",
    profileRefresh: "刷新口味画像", profileToggle: "使用虚构口味画像进行推荐",
    profileLoading: "正在加载示例画像…", profileEmpty: "暂无口味画像。",
    currentTaste: "目前偏好", unexplored: "值得探索",
    summary: "这位虚构观众偏爱情感细腻的国际电影、安静的视觉叙事、温和的幽默，以及关于记忆和日常生活的故事。",
    exploration: "可以继续探索轻巧的美食喜剧、有人情味的科幻片、当代女性导演作品，以及东亚和欧洲的精致影像。",
    resultHeading: "演示版推荐",
    resultNote: "结果基于虚构的口味画像和少量人工精选影片，在你的浏览器中按关键词匹配。这里没有连接个人账号或 AI 服务。",
    directedBy: "导演：", reason: "这部电影的气质与当前心情相合：",
    categories: {
      "perfect-days-2023": "温柔、沉静、富于思考",
      tampopo: "幽默、温暖、充满美食趣味",
      "columbus-2017": "平静、亲密、富于建筑美感",
      "after-yang": "科幻、记忆与家庭",
      "the-handmaiden": "悬疑、浪漫、风格鲜明",
      "petite-maman": "温柔、关于失去与家庭",
    },
    featureNotes: {
      "perfect-days-2023": "如果你今晚想要一点安静和暖意，这部电影会把日常里的小事拍得很有分量。它不急着制造转折，适合想放慢脚步、带着余味结束一天的时候。",
      tampopo: "想轻松一点，又不想看完就忘？这部电影把料理、幽默和人情味放在一起，节奏活泼，像一顿意外丰盛的晚餐。",
      "columbus-2017": "如果想看一部安静但有余味的电影，这里的建筑、留白和对话会让情绪慢慢浮出来。它适合愿意停下来，认真看两个人如何靠近的夜晚。",
      "after-yang": "想看科幻，但不想被紧张情节追着跑？它借一个未来设定谈记忆、家庭和失去，节奏轻柔，也给思考留出了空间。",
      "the-handmaiden": "如果今晚想被情节牢牢抓住，这部电影会用层层翻转和鲜明的视觉风格带你进入故事。它更浓烈，适合想看悬疑与情感交织的一晚。",
      "petite-maman": "如果你需要一部温柔的电影，它用很轻的笔触靠近失去、童年与亲密关系。片长不长，情绪却会在结束后慢慢留下来。",
    },
  },
  en: {
    brand: "Tonight’s Screening", themeLight: "Switch to light theme", themeDark: "Switch to dark theme",
    recommend: "Recommend", history: "History", taste: liveMode ? "Preferences" : "Taste Profile",
    status: "Interactive demo · fictional sample data · saved in this browser",
    heroEyebrow: "A CINEMA FOR YOUR MOOD", heroTitle: "Tonight’s film starts\nwith how you feel.", heroSubtitle: "Tell us what you’re in the mood for. When the curtains open, your film awaits.",
    moodLabel: "Tonight, I’m looking for",
    moodPlaceholder: "For example: I'm a little tired tonight and want something smart, light, and not too long.",
    moodChips: ["Light but lasting", "Thoughtful sci-fi", "Gentle suspense", "Something healing"],
    getRecommendations: "Find tonight’s film", recommending: "Choosing your films…",
    boardLabel: "TONIGHT'S PICK", boardWaiting: "YOUR FILM AWAITS", stageWaiting: "Your film appears when the curtains open.", stageLoading: "Choosing a film for tonight…", stageFirst: "Tonight’s first pick", stageSecond: "Another possibility", featureHeading: "WHY THIS FILM", curtainReplay: "Replay curtain", cancel: "Cancel recommendation", demoFootnote: liveMode ? "Live AI recommendations · TMDB imagery · History stays in this browser." : "Interactive demo with fictional taste data. History stays in this browser.", noBackdrop: "Illustrative film scene",
    latest: "Latest Recommendation", historyTitle: "History", refresh: "Refresh", loading: "Loading...",
    noHistory: "No recommendation history yet.", saved: "Saved Recommendation", select: "Select a recommendation.",
    delete: "Delete", profileEyebrow: "Sample Taste Profile", profileTitle: "Fictional Viewer Film Map",
    profileRefresh: "Refresh taste profile", profileToggle: "Use fictional taste profile for recommendations",
    profileLoading: "Loading fictional demo profile...", profileEmpty: "No taste profile available.",
    currentTaste: "Current Taste", unexplored: "Unexplored Directions",
    summary: "This fictional demo viewer gravitates toward emotionally precise international films, quiet visual storytelling, gentle humor, and stories about memory and everyday ritual.",
    exploration: "Explore playful food comedies, humane speculative fiction, contemporary women directors, and visually rigorous films from East Asian and European cinema.",
    resultHeading: "Portfolio Demo Recommendation",
    resultNote: "This result uses fictional sample taste data. Recommendations are selected from a small curated catalog in your browser; no account or AI service is connected.",
    directedBy: "Directed by ", reason: "A choice for this mood: ",
    categories: {
      "perfect-days-2023": "gentle, reflective, quiet",
      tampopo: "funny, warm, food",
      "columbus-2017": "calm, architecture, intimate",
      "after-yang": "science fiction, memory, family",
      "the-handmaiden": "thriller, romance, stylized",
      "petite-maman": "gentle, grief, family",
    },
    featureNotes: {
      "perfect-days-2023": "For a night that calls for quiet and warmth, this film finds weight in the smallest daily rituals. It takes its time, leaving room to slow down and carry a little of it into tomorrow.",
      tampopo: "Want something light that still stays with you? Food, humor, and human warmth meet in a playful film that feels like a surprisingly generous dinner.",
      "columbus-2017": "Architecture, pauses, and conversation let the feeling of this film emerge slowly. Choose it when you want to settle in and watch two people gradually grow closer.",
      "after-yang": "In the mood for science fiction without a relentless plot? Its future setting opens a gentle story about memory, family, and loss, with space to think as you watch.",
      "the-handmaiden": "If you want a film that pulls you firmly into its story, expect layered turns and a striking visual style. This is the more intense pick for a night of suspense and feeling.",
      "petite-maman": "A gentle choice when you need one: it approaches loss, childhood, and closeness with a light touch. Its short running time leaves a feeling that lingers afterward.",
    },
  },
} as const;
export function copy() { return messages[language.value]; }

export function localizedMovie(movie: MovieRecommendation): MovieRecommendation {
  const title = (language.value === "zh" ? movie.title_zh : movie.title_en) || movie.title;
  if (movie.reason_zh || movie.reason_en) return { ...movie, title, reason: (language.value === "zh" ? movie.reason_zh : movie.reason_en) || movie.reason };
  const themes = copy().categories[movie.slug as keyof typeof messages.zh.categories];
  if (!themes) return { ...movie, title };
  return { ...movie, title, reason: language.value === "zh" ? `一部${themes}的电影，适合此刻的心情。` : `A ${themes} choice for this mood.` };
}

export function localizedFeatureNote(movie: MovieRecommendation): string {
  if (movie.reason_zh || movie.reason_en) return (language.value === "zh" ? movie.reason_zh : movie.reason_en) || movie.reason || "";
  const notes: Record<string, string> = copy().featureNotes;
  return notes[movie.slug || ""] || movie.reason || "";
}

export function localizedResult(job: RecommendationJob): string {
  const c = copy();
  const details = job.movies.map((raw) => {
    const movie = localizedMovie(raw);
    const director = movie.director ? (language.value === "zh" ? `${c.directedBy}${movie.director}。` : `${c.directedBy}${movie.director}. `) : "";
    return `### ${movie.title} (${movie.year || ""})\n\n${director}${movie.reason || ""}`;
  }).join("\n\n");
  return `## ${liveMode ? (language.value === "zh" ? "实时电影推荐" : "Live Film Recommendations") : c.resultHeading}\n\n${liveMode ? "" : `${c.resultNote}\n\n`}${details}`;
}
