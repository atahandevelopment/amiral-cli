import { symbols } from "./symbols.js"; import { renderTable } from "./table.js"; import type { GlobalOptions } from "../context.js";
export class Output {
  constructor(public readonly options: GlobalOptions) {}
  json(value: unknown) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
  private line(label: string, text: string) { if (!this.options.quiet && !this.options.json) process.stdout.write(`[${label}] ${text}\n`); }
  success(text: string) { this.line(symbols.success, text); } info(text: string) { this.line(symbols.info, text); } warn(text: string) { this.line(symbols.warn, text); }
  error(text: string) { process.stderr.write(`[${symbols.error}] ${text}\n`); }
  section(text: string) { if (!this.options.quiet && !this.options.json) process.stdout.write(`\n${text}\n`); }
  table(headers: string[], rows: unknown[][]) { if (!this.options.quiet && !this.options.json) process.stdout.write(`${renderTable(headers, rows)}\n`); }
}
