import { describe, expect, it } from "vitest";

import { buildPlanImplementationThreadTitle } from "./proposedPlan";
import { buildNewThreadTitle, normalizeGeneratedThreadTitle } from "./threadTitle";

describe("buildNewThreadTitle", () => {
  it("preserves the full trimmed seed text for new threads", () => {
    expect(
      buildNewThreadTitle({
        draftText:
          "   This generated title is intentionally much longer than fifty characters and should remain intact   ",
        firstImageName: null,
      }),
    ).toBe(
      "This generated title is intentionally much longer than fifty characters and should remain intact",
    );
  });

  it("falls back to the first image name when the draft text is empty", () => {
    expect(
      buildNewThreadTitle({
        draftText: "",
        firstImageName: "screenshot.png",
      }),
    ).toBe("Image: screenshot.png");
  });

  it("treats whitespace-only draft text as empty before falling back to the first image name", () => {
    expect(
      buildNewThreadTitle({
        draftText: "   ",
        firstImageName: "photo.jpg",
      }),
    ).toBe("Image: photo.jpg");
  });

  it("falls back to the generic new-thread title when there is no text or image", () => {
    expect(
      buildNewThreadTitle({
        draftText: "",
        firstImageName: null,
      }),
    ).toBe("New thread");
  });
});

describe("normalizeGeneratedThreadTitle", () => {
  it("preserves the full generated implementation title", () => {
    expect(
      normalizeGeneratedThreadTitle(
        buildPlanImplementationThreadTitle(
          "# Refactor the thread sidebar resizing behavior without truncating the generated title",
        ),
      ),
    ).toBe(
      "Implement Refactor the thread sidebar resizing behavior without truncating the generated title",
    );
  });
});
