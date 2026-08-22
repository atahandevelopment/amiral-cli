/**
 * Phase 13 — Provider-neutral text/JSON extraction helpers.
 *
 * Moved verbatim from opencode-adapter.ts so that any provider (and the
 * planner CLI) can recover structured output from raw provider text.
 * opencode-adapter.ts re-exports these for backward compatibility.
 */

/**
 * Extract the final assistant text from OpenCode JSON event output.
 * Non-JSON log lines are ignored.
 */
export function extractTextEvents(stdout: string): string {
  const texts: string[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        part?: {
          type?: string;
          text?: string;
        };
      };

      if (
        event.type === "text" &&
        event.part?.type === "text" &&
        typeof event.part.text === "string"
      ) {
        texts.push(event.part.text);
      }
    } catch {
      // OpenCode'un JSON olmayan loglarını görmezden gel.
    }
  }

  // OpenCode text events are incremental chunks of one assistant response.
  // Adding separators corrupts fragmented JSON (for example `{` + `"a":1}`).
  return texts.join("").trim();
}

/**
 * Extract the first JSON object from provider text output.
 *
 * Handles fenced code blocks and raw or embedded JSON objects.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  return extractJsonObjects<T>(text)[0] ?? null;
}

/**
 * Extract complete JSON object candidates without being confused by braces in
 * JSON strings. Candidates remain ordered so callers can apply domain
 * validation and select the first object that satisfies their contract.
 */
export function extractJsonObjects<T = unknown>(text: string): T[] {
  if (!text) {
    return [];
  }

  const results: T[] = [];
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          results.push(JSON.parse(text.slice(start, index + 1)) as T);
          // A valid outer object already contains its nested objects; preserve
          // top-level candidate order without returning those internals.
          start = index;
        } catch { /* Resume at the next opening brace after malformed noise. */ }
        break;
      }
    }
  }
  return results;
}
