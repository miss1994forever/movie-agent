function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}

export function renderMarkdown(markdown: string): string {
  const blocks = markdown.trim().split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      const first = lines[0] ?? "";
      if (/^#{1,3}\s+/.test(first)) {
        const level = Math.min(first.match(/^#+/)?.[0].length ?? 2, 3);
        return `<h${level}>${renderInline(first.replace(/^#{1,3}\s+/, ""))}</h${level}>`;
      }
      if (lines.every((line) => /^[-*•]\s+/.test(line.trim()))) {
        const items = lines
          .map((line) => `<li>${renderInline(line.trim().replace(/^[-*•]\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${lines.map(renderInline).join("<br>")}</p>`;
    })
    .join("");
}
