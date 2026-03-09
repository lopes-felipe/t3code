import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  gitBranchesQueryOptions,
  gitMutationKeys,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
  gitStatusQueryOptions,
} from "./gitReactQuery";

describe("gitMutationKeys", () => {
  it("scopes stacked action keys by cwd", () => {
    expect(gitMutationKeys.runStackedAction("/repo/a")).not.toEqual(
      gitMutationKeys.runStackedAction("/repo/b"),
    );
  });

  it("scopes pull keys by cwd", () => {
    expect(gitMutationKeys.pull("/repo/a")).not.toEqual(gitMutationKeys.pull("/repo/b"));
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();

  it("attaches cwd-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({ cwd: "/repo/a", queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.runStackedAction("/repo/a"));
  });

  it("attaches cwd-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({ cwd: "/repo/a", queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.pull("/repo/a"));
  });
});

describe("gitStatusQueryOptions", () => {
  it("keeps background refresh behavior enabled by default", () => {
    const options = gitStatusQueryOptions({ cwd: "/repo/a", autoRefresh: true });

    expect(options.refetchInterval).toBe(15_000);
    expect(options.refetchOnWindowFocus).toBe("always");
    expect(options.refetchOnReconnect).toBe("always");
  });

  it("disables interval, focus, and reconnect refreshes when auto-refresh is off", () => {
    const options = gitStatusQueryOptions({ cwd: "/repo/a", autoRefresh: false });

    expect(options.refetchInterval).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
  });

  it("preserves sidebar timing overrides when auto-refresh stays enabled", () => {
    const options = gitStatusQueryOptions({
      cwd: "/repo/a",
      autoRefresh: true,
      staleTimeMs: 30_000,
      refetchIntervalMs: 60_000,
    });

    expect(options.staleTime).toBe(30_000);
    expect(options.refetchInterval).toBe(60_000);
    expect(options.refetchOnWindowFocus).toBe("always");
    expect(options.refetchOnReconnect).toBe("always");
  });
});

describe("gitBranchesQueryOptions", () => {
  it("keeps branch refresh behavior enabled by default", () => {
    const options = gitBranchesQueryOptions({ cwd: "/repo/a", autoRefresh: true });

    expect(options.refetchInterval).toBe(60_000);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchOnReconnect).toBe(true);
  });

  it("disables branch interval, focus, and reconnect refreshes when auto-refresh is off", () => {
    const options = gitBranchesQueryOptions({ cwd: "/repo/a", autoRefresh: false });

    expect(options.refetchInterval).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
  });
});
