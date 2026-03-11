import { type ChatAttachment, DEFAULT_NEW_THREAD_TITLE } from "@t3tools/contracts";

export const THREAD_TITLE_MAX_CHARS = 80;

export function trimToMaxChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(0, maxChars).trimEnd();
}

export function stripWrappingQuotes(value: string): string {
  let normalized = value.trim();
  while (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'")) ||
    (normalized.startsWith("`") && normalized.endsWith("`"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

export function sanitizeThreadTitle(value: string): string {
  const singleLine = value.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutWrappingQuotes = stripWrappingQuotes(singleLine);
  const withoutTrailingPunctuation = withoutWrappingQuotes.replace(/[.?!,:;]+$/g, "").trim();
  return trimToMaxChars(withoutTrailingPunctuation, THREAD_TITLE_MAX_CHARS)
    .replace(/[.?!,:;]+$/g, "")
    .trim();
}

export function buildFallbackThreadTitle(input: {
  readonly titleSourceText: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}): string {
  const firstImageName = input.attachments.find((attachment) => attachment.type === "image")?.name;
  const candidates = [input.titleSourceText, firstImageName];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = sanitizeThreadTitle(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return DEFAULT_NEW_THREAD_TITLE;
}
