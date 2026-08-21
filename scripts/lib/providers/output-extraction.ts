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

  return texts.join("\n").trim();
}

/**
 * Extract the first JSON object from provider text output.
 *
 * Handles fenced code blocks and raw or embedded JSON objects.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  if (!text) {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  const candidates = [fenced?.[1]?.trim(), text.trim()].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // devam
    }

    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        // devam
      }
    }
  }

  return null;
}
