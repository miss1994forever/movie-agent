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
    .replace(/(^|[^*])\*(?!\s)(.+?)(?<!\s)\*/g, "$1<em>$2</em>")
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
      if (lines.every((line) => /^\d+[.)]\s+/.test(line.trim()))) {
        const firstNumber = Number(lines[0].trim().match(/^(\d+)/)?.[1] ?? "1");
        const items = lines
          .map((line) => `<li>${renderInline(line.trim().replace(/^\d+[.)]\s+/, ""))}</li>`)
          .join("");
        return `<ol${firstNumber > 1 ? ` start="${firstNumber}"` : ""}>${items}</ol>`;
      }
      return `<p>${lines.map(renderInline).join("<br>")}</p>`;
    })
    .join("");
}
