import { describe, expect, it } from "vitest";

import {
  buildFallbackThreadTitle,
  sanitizeThreadTitle,
  stripWrappingQuotes,
  THREAD_TITLE_MAX_CHARS,
  trimToMaxChars,
} from "./threadTitle.ts";

describe("trimToMaxChars", () => {
  it("returns the original value when already within the limit", () => {
    expect(trimToMaxChars("short", 10)).toBe("short");
  });

  it("trims overly long values and removes trailing whitespace", () => {
    expect(trimToMaxChars("1234567890   ", 10)).toBe("1234567890");
  });
});

describe("stripWrappingQuotes", () => {
  it("removes matching surrounding quotes and backticks", () => {
    expect(stripWrappingQuotes(' "title" ')).toBe("title");
    expect(stripWrappingQuotes("`title`")).toBe("title");
  });
});

describe("sanitizeThreadTitle", () => {
  it("keeps only the first line and strips wrapping quotes and trailing punctuation", () => {
    expect(sanitizeThreadTitle(' "Fix sidebar layout."\nignore me')).toBe("Fix sidebar layout");
  });

  it("caps titles to the shared maximum length", () => {
    const raw = `  ${"a".repeat(THREAD_TITLE_MAX_CHARS + 5)}  `;
    expect(sanitizeThreadTitle(raw)).toHaveLength(THREAD_TITLE_MAX_CHARS);
  });
});

describe("buildFallbackThreadTitle", () => {
  it("uses the sanitized text when present", () => {
    expect(
      buildFallbackThreadTitle({
        titleSourceText: "  Fix oversized drawer.  ",
        attachments: [],
      }),
    ).toBe("Fix oversized drawer");
  });

  it("falls back to the first image name when the text is empty", () => {
    expect(
      buildFallbackThreadTitle({
        titleSourceText: "   ",
        attachments: [
          {
            type: "image",
            id: "att-1",
            name: "mockup-final.png",
            mimeType: "image/png",
            sizeBytes: 42,
          },
        ],
      }),
    ).toBe("mockup-final.png");
  });

  it("falls back to the default placeholder when no text or images are available", () => {
    expect(
      buildFallbackThreadTitle({
        titleSourceText: "   ",
        attachments: [],
      }),
    ).toBe("New thread");
  });
});
