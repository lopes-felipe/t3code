import { ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadRepository", (it) => {
  it.effect("round-trips archived_at through upsert and read paths", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadRepository;
      const threadId = ThreadId.makeUnsafe("thread-archived");
      const projectId = ProjectId.makeUnsafe("project-1");

      yield* repository.upsert({
        threadId,
        projectId,
        title: "Archived thread",
        model: "gpt-5-codex",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        archivedAt: "2026-03-10T09:00:00.000Z",
        createdAt: "2026-03-10T08:00:00.000Z",
        lastInteractionAt: "2026-03-10T08:30:00.000Z",
        updatedAt: "2026-03-10T09:00:00.000Z",
        deletedAt: null,
      });

      const row = yield* repository.getById({ threadId });
      const rows = yield* repository.listByProjectId({ projectId });

      assert.equal(row._tag, "Some");
      if (row._tag !== "Some") {
        throw new Error("Expected archived projection thread row.");
      }
      assert.equal(row.value.archivedAt, "2026-03-10T09:00:00.000Z");
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.archivedAt, "2026-03-10T09:00:00.000Z");
    }),
  );
});
