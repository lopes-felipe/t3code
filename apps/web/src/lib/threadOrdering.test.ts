import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId } from "@t3tools/contracts";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
} from "../types";
import {
  getMostRecentThreadForProject,
  sortProjectsByActivity,
  sortThreadsByActivity,
} from "./threadOrdering";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Project",
    cwd: "/tmp/project-1",
    model: "gpt-5-codex",
    createdAt: "2026-03-01T00:00:00.000Z",
    expanded: true,
    scripts: [],
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    lastInteractionAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: undefined,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("threadOrdering", () => {
  it("sorts threads by lastInteractionAt, then createdAt, then thread id", () => {
    const threads = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        createdAt: "2026-03-01T00:00:00.000Z",
        lastInteractionAt: "2026-03-02T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-3"),
        createdAt: "2026-03-01T00:00:00.000Z",
        lastInteractionAt: "2026-03-02T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        createdAt: "2026-03-03T00:00:00.000Z",
        lastInteractionAt: "2026-03-02T00:00:00.000Z",
      }),
    ];

    expect(sortThreadsByActivity(threads).map((thread) => thread.id)).toEqual([
      "thread-2",
      "thread-3",
      "thread-1",
    ]);
  });

  it("sorts projects by hottest child activity, then createdAt, then project id", () => {
    const projects = [
      makeProject({
        id: ProjectId.makeUnsafe("project-1"),
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
      makeProject({
        id: ProjectId.makeUnsafe("project-3"),
        cwd: "/tmp/project-3",
        name: "Project 3",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
      makeProject({
        id: ProjectId.makeUnsafe("project-2"),
        cwd: "/tmp/project-2",
        name: "Project 2",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    ];
    const threads = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        lastInteractionAt: "2026-03-02T00:00:00.000Z",
      }),
    ];

    expect(sortProjectsByActivity(projects, threads).map((project) => project.id)).toEqual([
      "project-3",
      "project-2",
      "project-1",
    ]);
  });

  it("ignores archived threads for most recent thread selection", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const activeThread = makeThread({
      id: ThreadId.makeUnsafe("thread-active"),
      projectId,
      lastInteractionAt: "2026-03-02T00:00:00.000Z",
    });
    const archivedThread = makeThread({
      id: ThreadId.makeUnsafe("thread-archived"),
      projectId,
      archivedAt: "2026-03-03T00:00:00.000Z",
      lastInteractionAt: "2026-03-04T00:00:00.000Z",
    });

    expect(getMostRecentThreadForProject(projectId, [activeThread, archivedThread])?.id).toBe(
      activeThread.id,
    );
  });
});
