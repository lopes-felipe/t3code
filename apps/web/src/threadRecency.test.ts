import { ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "vitest";
import {
  beginCycle,
  advanceCycle,
  endCycle,
  pruneRecentThreads,
  recordThreadVisit,
  type ThreadRecencyState,
} from "./threadRecency";

const threadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

const ctrlTabShortcut = {
  key: "tab",
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  modKey: false,
} as const;

const plainTabShortcut = {
  key: "tab",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
} as const;

function state(recentThreadIds: string[]): ThreadRecencyState {
  return {
    recentThreadIds: recentThreadIds.map(threadId),
    activeCycle: null,
  };
}

describe("recordThreadVisit", () => {
  it("keeps unique most-recent-first ordering", () => {
    const initial = state(["thread-a", "thread-b", "thread-c"]);
    const next = recordThreadVisit(initial, threadId("thread-b"));

    assert.deepEqual(next.recentThreadIds, [
      threadId("thread-b"),
      threadId("thread-a"),
      threadId("thread-c"),
    ]);
  });
});

describe("pruneRecentThreads", () => {
  it("drops ineligible thread ids from recent order", () => {
    const next = pruneRecentThreads(
      state(["thread-a", "thread-b", "thread-c"]),
      [threadId("thread-a"), threadId("thread-c")],
      threadId("thread-a"),
    );

    assert.deepEqual(next.recentThreadIds, [threadId("thread-a"), threadId("thread-c")]);
  });

  it("prunes active cycle order and resets the index to the active route thread", () => {
    const initial: ThreadRecencyState = {
      recentThreadIds: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
      activeCycle: {
        order: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
        index: 2,
        heldModifiers: {
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    };

    const next = pruneRecentThreads(
      initial,
      [threadId("thread-a"), threadId("thread-c")],
      threadId("thread-c"),
    );

    assert.deepEqual(next.activeCycle, {
      order: [threadId("thread-a"), threadId("thread-c")],
      index: 1,
      heldModifiers: {
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      },
    });
  });

  it("terminates the cycle when the active route thread is no longer eligible", () => {
    const initial: ThreadRecencyState = {
      recentThreadIds: [threadId("thread-a"), threadId("thread-b")],
      activeCycle: {
        order: [threadId("thread-a"), threadId("thread-b")],
        index: 1,
        heldModifiers: {
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    };

    const next = pruneRecentThreads(initial, [threadId("thread-a")], threadId("thread-b"));

    assert.isNull(next.activeCycle);
  });
});

describe("cycle flow", () => {
  it("starts forward cycling from the second MRU thread", () => {
    const result = beginCycle(state(["thread-a", "thread-b", "thread-c"]), {
      direction: "next",
      activeThreadId: threadId("thread-a"),
      eligibleThreadIds: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
      shortcut: ctrlTabShortcut,
      platform: "Linux",
    });

    assert.strictEqual(result.targetThreadId, threadId("thread-b"));
    assert.deepEqual(result.state.activeCycle?.order, [
      threadId("thread-a"),
      threadId("thread-b"),
      threadId("thread-c"),
    ]);
    assert.strictEqual(result.state.activeCycle?.index, 1);
  });

  it("advances forward through the frozen order and wraps", () => {
    const started = beginCycle(state(["thread-a", "thread-b", "thread-c"]), {
      direction: "next",
      activeThreadId: threadId("thread-a"),
      eligibleThreadIds: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
      shortcut: ctrlTabShortcut,
      platform: "Linux",
    });
    const second = advanceCycle(started.state, "next");
    const third = advanceCycle(second.state, "next");

    assert.strictEqual(started.targetThreadId, threadId("thread-b"));
    assert.strictEqual(second.targetThreadId, threadId("thread-c"));
    assert.strictEqual(third.targetThreadId, threadId("thread-a"));
  });

  it("moves backward through the same frozen order", () => {
    const started = beginCycle(state(["thread-a", "thread-b", "thread-c"]), {
      direction: "next",
      activeThreadId: threadId("thread-a"),
      eligibleThreadIds: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
      shortcut: ctrlTabShortcut,
      platform: "Linux",
    });

    const previous = advanceCycle(started.state, "previous");
    assert.strictEqual(previous.targetThreadId, threadId("thread-a"));
  });

  it("commits the final thread when ending a cycle", () => {
    const started = beginCycle(state(["thread-a", "thread-b", "thread-c"]), {
      direction: "next",
      activeThreadId: threadId("thread-a"),
      eligibleThreadIds: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
      shortcut: ctrlTabShortcut,
      platform: "Linux",
    });

    const ended = endCycle(started.state, threadId("thread-b"));

    assert.deepEqual(ended.state.recentThreadIds, [
      threadId("thread-b"),
      threadId("thread-a"),
      threadId("thread-c"),
    ]);
    assert.isNull(ended.state.activeCycle);
    assert.strictEqual(ended.commitThreadId, threadId("thread-b"));
  });

  it("uses the first MRU thread when cycling from a non-thread route", () => {
    const result = beginCycle(state(["thread-b", "thread-c"]), {
      direction: "previous",
      activeThreadId: null,
      eligibleThreadIds: [threadId("thread-b"), threadId("thread-c")],
      shortcut: ctrlTabShortcut,
      platform: "Linux",
    });

    assert.strictEqual(result.targetThreadId, threadId("thread-b"));
    assert.strictEqual(result.state.activeCycle?.index, 0);
  });

  it("keeps the active cycle snapshot frozen across unrelated recent ordering", () => {
    const started = beginCycle(state(["thread-a", "thread-b", "thread-c"]), {
      direction: "next",
      activeThreadId: threadId("thread-a"),
      eligibleThreadIds: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
      shortcut: ctrlTabShortcut,
      platform: "Linux",
    });

    const visited = recordThreadVisit(started.state, threadId("thread-c"));
    assert.deepEqual(visited.activeCycle?.order, [
      threadId("thread-a"),
      threadId("thread-b"),
      threadId("thread-c"),
    ]);
  });

  it("treats no-modifier shortcuts as single-step switches", () => {
    const result = beginCycle(state(["thread-a", "thread-b", "thread-c"]), {
      direction: "next",
      activeThreadId: threadId("thread-a"),
      eligibleThreadIds: [threadId("thread-a"), threadId("thread-b"), threadId("thread-c")],
      shortcut: plainTabShortcut,
      platform: "Linux",
    });

    assert.strictEqual(result.targetThreadId, threadId("thread-b"));
    assert.strictEqual(result.commitThreadId, threadId("thread-b"));
    assert.isNull(result.state.activeCycle);
    assert.deepEqual(result.state.recentThreadIds, [
      threadId("thread-b"),
      threadId("thread-a"),
      threadId("thread-c"),
    ]);
  });
});
