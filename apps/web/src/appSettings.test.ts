import { DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER } from "@t3tools/contracts";

import { describe, expect, it } from "vitest";

import {
  getAppModelOptions,
  getSlashModelOptions,
  normalizeCustomModelSlugs,
  parsePersistedAppSettings,
  resolveAuxiliaryAppModelSelection,
  resolveAppModelSelection,
} from "./appSettings";

describe("parsePersistedAppSettings", () => {
  it("defaults git status auto-refresh to true", () => {
    expect(parsePersistedAppSettings(null).enableGitStatusAutoRefresh).toBe(true);
  });

  it("defaults thread status notifications to true", () => {
    expect(parsePersistedAppSettings(null).enableThreadStatusNotifications).toBe(true);
  });

  it("decodes older persisted settings payloads with git status auto-refresh enabled", () => {
    const parsed = parsePersistedAppSettings(
      JSON.stringify({
        codexBinaryPath: "",
        codexHomePath: "",
        confirmThreadDelete: true,
        enableAssistantStreaming: false,
        codexServiceTier: "auto",
        customCodexModels: [],
      }),
    );

    expect(parsed.enableGitStatusAutoRefresh).toBe(true);
    expect(parsed.enableThreadStatusNotifications).toBe(true);
    expect(parsed.codexThreadTitleModel).toBe(DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex);
  });

  it("restores a persisted thread title model selection", () => {
    const parsed = parsePersistedAppSettings(
      JSON.stringify({
        codexBinaryPath: "",
        codexHomePath: "",
        confirmThreadDelete: true,
        enableAssistantStreaming: false,
        enableGitStatusAutoRefresh: true,
        enableThreadStatusNotifications: true,
        customCodexModels: ["custom/thread-title-model"],
        codexThreadTitleModel: "custom/thread-title-model",
      }),
    );

    expect(parsed.codexThreadTitleModel).toBe("custom/thread-title-model");
  });
});

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });
});

describe("resolveAuxiliaryAppModelSelection", () => {
  it("preserves saved auxiliary custom model slugs", () => {
    expect(
      resolveAuxiliaryAppModelSelection(
        "codex",
        ["galapagos-alpha"],
        "galapagos-alpha",
        DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex,
      ),
    ).toBe("galapagos-alpha");
  });

  it("falls back to the auxiliary default when the selection is empty", () => {
    expect(
      resolveAuxiliaryAppModelSelection(
        "codex",
        [],
        "",
        DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex,
      ),
    ).toBe(DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex);
  });

  it("falls back to the auxiliary default when a custom model slug was removed", () => {
    expect(
      resolveAuxiliaryAppModelSelection(
        "codex",
        [],
        "removed-custom-model",
        DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex,
      ),
    ).toBe(DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex);
  });

  it("matches built-in model names case-insensitively", () => {
    expect(
      resolveAuxiliaryAppModelSelection(
        "codex",
        [],
        "gpt-5.3 codex",
        DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex,
      ),
    ).toBe("gpt-5.3-codex");
  });
});

describe("getSlashModelOptions", () => {
  it("includes saved custom model slugs for /model command suggestions", () => {
    const options = getSlashModelOptions("codex", ["custom/internal-model"], "", "gpt-5.3-codex");

    expect(options.some((option) => option.slug === "custom/internal-model")).toBe(true);
  });

  it("filters slash-model suggestions across built-in and custom model names", () => {
    const options = getSlashModelOptions("codex", ["openai/gpt-oss-120b"], "oss", "gpt-5.3-codex");

    expect(options.map((option) => option.slug)).toEqual(["openai/gpt-oss-120b"]);
  });
});
