from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DemoMovie:
    title: str
    year: int
    slug: str
    director: str
    themes: tuple[str, ...]


class DemoTasteDataProvider:
    """Deterministic, fictional taste data for screenshots and public demos."""

    movies = (
        DemoMovie("Perfect Days", 2023, "perfect-days-2023", "Wim Wenders", ("gentle", "reflective", "quiet")),
        DemoMovie("Tampopo", 1985, "tampopo", "Juzo Itami", ("funny", "warm", "food")),
        DemoMovie("Columbus", 2017, "columbus-2017", "Kogonada", ("calm", "architecture", "intimate")),
        DemoMovie("After Yang", 2021, "after-yang", "Kogonada", ("science fiction", "memory", "family")),
        DemoMovie("The Handmaiden", 2016, "the-handmaiden", "Park Chan-wook", ("thriller", "romance", "stylized")),
        DemoMovie("Petite Maman", 2021, "petite-maman", "Celine Sciamma", ("gentle", "grief", "family")),
    )

    @property
    def source(self) -> str:
        return "demo"

    def context_text(self) -> str:
        return (
            "DEMO PROFILE — fictional sample data, not a real Letterboxd member.\n"
            "Preferences: emotionally precise films, quiet visual storytelling, international cinema, "
            "gentle humor, memory, intimacy, and carefully composed images.\n"
            "Avoid: empty spectacle and recommendations presented as evidence-backed when source data is unavailable."
        )

    def profile_sections(self) -> tuple[str, str]:
        return (
            "This fictional demo viewer gravitates toward emotionally precise international films, "
            "quiet visual storytelling, gentle humor, and stories about memory, intimacy, and everyday ritual.",
            "Explore playful food comedies, humane speculative fiction, contemporary women directors, "
            "and visually rigorous films from East Asian and European cinema.",
        )

    def recommend(self, mood: str, count: int = 2) -> list[DemoMovie]:
        normalized = mood.casefold()
        groups = (
            (("轻松", "开心", "搞笑", "fun", "funny", "warm"), ("tampopo", "perfect-days-2023")),
            (("科幻", "未来", "科技", "sci-fi", "science", "future"), ("after-yang", "columbus-2017")),
            (("紧张", "悬疑", "刺激", "thriller", "tense"), ("the-handmaiden", "after-yang")),
            (("治愈", "安静", "平静", "难过", "quiet", "calm", "sad"), ("perfect-days-2023", "petite-maman")),
        )
        selected_slugs = ("perfect-days-2023", "tampopo")
        for keywords, slugs in groups:
            if any(keyword in normalized for keyword in keywords):
                selected_slugs = slugs
                break
        by_slug = {movie.slug: movie for movie in self.movies}
        return [by_slug[slug] for slug in selected_slugs[:count]]
