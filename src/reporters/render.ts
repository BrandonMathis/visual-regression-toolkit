import type { Difference, VisualResult } from "../contracts/types.js";
const esc = (value: string): string =>
  [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char] ?? char,
    );
const markdownEscape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]/g, " ");
const reportHref = (value: string): string => {
  if (value.startsWith(".visual-regression/result/"))
    return value.slice(".visual-regression/result/".length);
  if (value.startsWith(".visual-regression/"))
    return `../${value.slice(".visual-regression/".length)}`;
  return value;
};
const evidenceLinks = (item: Difference, htmlOutput: boolean): string =>
  [
    ["expected", item.expectedPath],
    ["actual", item.actualPath],
    ["diff", item.diffPath],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) =>
      htmlOutput
        ? `<a href="${esc(reportHref(value))}">${label}</a>`
        : `[${label}](${reportHref(value)})`,
    )
    .join(" / ");
const line = (kind: string, item: Difference): string =>
  `| ${kind} | ${markdownEscape(item.project)} | ${markdownEscape(item.route)} | ${evidenceLinks(item, false)} |`;
export function markdown(result: VisualResult): string {
  const differences = [
    ...result.changed.map((x) => ["Changed", x] as const),
    ...result.added.map((x) => ["Added", x] as const),
    ...result.removed.map((x) => ["Removed", x] as const),
  ].slice(0, 500);
  return [
    `# Visual regression: ${result.status}`,
    "",
    `Operation: \`${result.operation}\``,
    `Screenshots: ${result.screenshotTotal}`,
    result.error
      ? `Error: \`${result.error.code}\` — ${markdownEscape(result.error.message)}`
      : "",
    "",
    "| Result | Project | Route | Evidence |",
    "|---|---|---|---|",
    ...differences.map(([kind, item]) => line(kind, item)),
    differences.length === 500 ? "| … | truncated | … |" : "",
    "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}
export function html(result: VisualResult): string {
  const rows = [
    ...result.changed.map((x) => ["Changed", x] as const),
    ...result.added.map((x) => ["Added", x] as const),
    ...result.removed.map((x) => ["Removed", x] as const),
  ]
    .slice(0, 500)
    .map(
      ([kind, item]) =>
        `<tr><td>${kind}</td><td>${esc(item.project)}</td><td>${esc(item.route)}</td><td>${evidenceLinks(item, true)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Visual regression: ${esc(result.status)}</title><style>body{font-family:system-ui;margin:2rem;color:#171717}table{border-collapse:collapse}td,th{padding:.5rem;border:1px solid #aaa}code{background:#eee;padding:.2rem}</style><h1>Visual regression: ${esc(result.status)}</h1><p>Operation: <code>${esc(result.operation)}</code></p>${result.error ? `<p><strong>${esc(result.error.code)}</strong>: ${esc(result.error.message)}</p>` : ""}<table><thead><tr><th>Result</th><th>Project</th><th>Route</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`;
}
