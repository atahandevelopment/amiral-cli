export function renderTable(headers: string[], rows: unknown[][]): string {
  const values = [headers, ...rows.map(r => r.map(v => v == null ? "" : String(v)))];
  const widths = headers.map((_, i) => Math.max(...values.map(r => String(r[i] ?? "").length)));
  return values.map((r, index) => r.map((v, i) => String(v ?? "").padEnd(widths[i])).join("  ").trimEnd() + (index === 0 ? `\n${widths.map(w => "-".repeat(w)).join("  ")}` : "")).join("\n");
}
