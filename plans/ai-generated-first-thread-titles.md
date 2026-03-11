# AI-Generated First-Thread Titles

## Summary

Replace the current client-side "use the first message text as the thread title" behavior with a server-side async title-generation step:

- New threads still get created immediately so the first turn is not blocked.
- The initial persisted title for first-send threads becomes the placeholder `"New thread"`.
- On the first user message only, the server sends the raw user-authored prompt plus attachments to a lightweight Codex title-generation path.
- When the generated title returns, the server renames the thread if the user has not already renamed it.
- If generation fails, the server falls back to a capped heuristic title instead of leaving the thread as `"New thread"`.

This keeps turn-start latency unchanged, fixes image-only sends, and keeps the model choice configurable without adding any persistence migration.

Key files:

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/appSettings.ts`
- `apps/web/src/routes/_chat.settings.tsx`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/git/Services/TextGeneration.ts`
- `apps/server/src/git/Layers/CodexTextGeneration.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/decider.ts`

## Public API / Type Changes

- Add `DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER` to `packages/contracts/src/model.ts`.
- Add `DEFAULT_NEW_THREAD_TITLE` to `packages/contracts/src/orchestration.ts`.
- Add optional `titleGenerationModel` to all three turn-start schemas:
  - `ClientThreadTurnStartCommand`
  - `ThreadTurnStartCommand`
  - `ThreadTurnStartRequestedPayload`
- Add optional `titleSourceText` to those same three turn-start schemas so image-only sends do not derive titles from `IMAGE_ONLY_BOOTSTRAP_PROMPT`.
- Add `codexThreadTitleModel` to persisted web app settings in `apps/web/src/appSettings.ts`.
- Extend the existing `TextGeneration` service with `generateThreadTitle(...)` instead of creating a new service or layer.

## Constants And Defaults

Define shared client/server constants in contracts:

- `DEFAULT_NEW_THREAD_TITLE = "New thread"`
- `DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER = { codex: "gpt-5.3-codex" }`

Use the existing low-reasoning Codex generation path as the baseline:

- keep `reasoning_effort = low` for title generation
- do not add dynamic pricing or latency ranking in this change
- do not assume `gpt-5.3-codex-spark` until there is a confirmed reason to prefer it over the already-used `gpt-5.3-codex`

## Web Changes

Add a configurable app-level setting for the thread-title model in `apps/web/src/appSettings.ts`.

- Add `codexThreadTitleModel: string`.
- Default it to `DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex`.
- Keep it as a per-device preference alongside the existing app settings.

Do not reuse `resolveAppModelSelection(...)` as-is for this setting, because it falls back to the main chat model.

- Add a dedicated resolver for auxiliary configured models, or extend `resolveAppModelSelection(...)` with an explicit `fallbackModel` parameter.
- Use that resolver for the thread-title model so invalid, empty, or removed custom slugs fall back to `DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex`, not `DEFAULT_MODEL_BY_PROVIDER.codex`.

Expose the setting in `apps/web/src/routes/_chat.settings.tsx`.

- Add a control in the Codex settings section.
- Reuse the existing built-in and custom model option machinery.
- Persist the raw slug in app settings.
- Resolve the effective slug with the new auxiliary-model resolver before dispatch.

Change first-send behavior in `apps/web/src/components/ChatView.tsx`.

- For local draft threads created on first send, call `thread.create` with `title: DEFAULT_NEW_THREAD_TITLE` instead of the first message text.
- Remove the current first-message `thread.meta.update` call that writes the heuristic title to the server thread.
- Include `titleGenerationModel` on every `thread.turn.start` dispatch using the resolved app setting.
- Include `titleSourceText` on every `thread.turn.start` dispatch using the raw trimmed composer text before `IMAGE_ONLY_BOOTSTRAP_PROMPT` substitution.
- Keep `message.text` unchanged for provider turn behavior:
  - non-empty text -> actual trimmed text
  - image-only send -> `IMAGE_ONLY_BOOTSTRAP_PROMPT`
- Leave "Implement plan in new thread" behavior unchanged. That flow already derives a separate title and is naturally excluded because it does not start from `DEFAULT_NEW_THREAD_TITLE`.

## Contract Changes

Extend `packages/contracts/src/orchestration.ts`.

- Add `DEFAULT_NEW_THREAD_TITLE`.
- Add optional `titleGenerationModel: TrimmedNonEmptyString` to:
  - `ClientThreadTurnStartCommand`
  - `ThreadTurnStartCommand`
  - `ThreadTurnStartRequestedPayload`
- Add optional `titleSourceText: Schema.String` to those same three schemas.

The `titleSourceText` field exists specifically so image-only first turns can preserve the real user-authored title input, including the empty-string case, instead of forcing the server to infer from `IMAGE_ONLY_BOOTSTRAP_PROMPT`.

Update the decider in `apps/server/src/orchestration/decider.ts`.

- When building `thread.turn-start-requested`, forward both:
  - `titleGenerationModel`
  - `titleSourceText`

This is required so the configured model and the raw title source survive the client decode path and actually reach `ProviderCommandReactor`.

No persistence migration is required because neither field needs to be projected into stored thread rows.

## Server Text Generation Changes

Do not add a new title-generation service or extract a new shared Codex helper in this change.

Extend the existing server text-generation surface instead:

- add `generateThreadTitle(...)` to `apps/server/src/git/Services/TextGeneration.ts`
- implement it in `apps/server/src/git/Layers/CodexTextGeneration.ts`
- keep using the existing private `runCodexJson(...)` helper in that file
- keep using the existing layer wiring through `serverLayers.ts`

`generateThreadTitle(...)` should accept:

- `cwd`
- `message`
- optional `attachments`
- `model`

Prompt contract:

- Return JSON with key `title`
- Title must be a short one-line thread title
- Prefer 2-6 words
- Describe the user’s requested task, not the assistant response
- No markdown
- No quotes
- No trailing punctuation
- If images are attached, use them as primary context for visual or UI issues
- Be specific, but do not copy the full prompt verbatim

Generation safety:

- Truncate very long `message` input before sending it to Codex so title generation does not consume excessive context.
- Reuse the existing low-reasoning configuration already used for branch-name generation.

Sanitization rules after model output:

- trim whitespace
- take the first line only
- strip surrounding quotes and backticks
- strip trailing punctuation such as `.`
- cap to a reasonable maximum length, e.g. 80 characters
- treat empty output after sanitization as a generation failure

## Orchestration / Reactor Changes

Implement first-message title generation in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`.

Add a helper parallel to the existing worktree-branch generation flow, for example `maybeGenerateThreadTitleForFirstTurn`.

Trigger point:

- inside `processTurnStartRequested`
- after resolving the thread and current user message
- fork it asynchronously before `sendTurnForThread`
- do not await it before starting the provider turn

Eligibility rules:

- only run when the thread has exactly one user message
- that user message must match the current `event.payload.messageId`
- only run when the current thread title is exactly `DEFAULT_NEW_THREAD_TITLE`

Title-generation input source:

- use `event.payload.titleSourceText` when present
- otherwise fall back to the persisted user message text for backwards compatibility
- if the chosen source text is empty, rely on attachments as the primary context

This avoids bad titles for image-only turns and keeps older event shapes compatible.

Model resolution:

- use `event.payload.titleGenerationModel` when present
- otherwise use `DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex`

Success path:

1. Generate the title from `titleSourceText` plus attachments.
2. Re-read the current thread state.
3. If the thread no longer exists, stop.
4. If the current title is no longer `DEFAULT_NEW_THREAD_TITLE`, stop.
5. If the thread no longer has exactly one user message, stop.
6. If the first user message no longer matches `event.payload.messageId`, stop.
7. Dispatch `thread.meta.update` with the generated title.

Failure path:

- Log a warning only; do not append a noisy thread activity entry.
- Build a fallback title from:
  - `titleSourceText` when non-empty
  - otherwise the first attached image filename
  - otherwise `DEFAULT_NEW_THREAD_TITLE`
- Apply the same one-line sanitization and 80-character cap to fallback titles.
- Re-read the thread and apply the fallback only if the same success-path guards still hold:
  - thread exists
  - title is still `DEFAULT_NEW_THREAD_TITLE`
  - thread still has exactly one user message
  - first user message still matches `event.payload.messageId`

This keeps success and failure behavior symmetric if a second message arrives before generation completes.

## Behavioral Rules

- The first user turn on a new thread must not wait for title generation.
- Newly created first-send threads start with `DEFAULT_NEW_THREAD_TITLE` as the stored title.
- The server is the source of truth for title generation and rename application.
- Auto-generated titles only apply to the first user message of a thread.
- Image-only sends must generate titles from `titleSourceText` plus attachments, not from `IMAGE_ONLY_BOOTSTRAP_PROMPT`.
- If the user manually renames the thread before the async title arrives, the generated title must be ignored.
- If title generation fails, the thread still gets a capped heuristic fallback title.
- Existing manual rename behavior remains unchanged.
- Existing plan-implementation thread naming remains unchanged.

## Test Cases and Scenarios

- Add app-settings tests:
  - older persisted settings payloads decode with the new `codexThreadTitleModel` default.
  - updating settings persists and restores the selected title model.
  - invalid, empty, or removed custom slugs fall back to `DEFAULT_THREAD_TITLE_MODEL_BY_PROVIDER.codex`.
- Add contract tests:
  - `ClientThreadTurnStartCommand` decodes with and without `titleGenerationModel`.
  - `ThreadTurnStartCommand` decodes with and without `titleGenerationModel`.
  - `ThreadTurnStartRequestedPayload` decodes with and without `titleGenerationModel`.
  - all three decode `titleSourceText`, including the empty-string image-only case.
- Add decider tests:
  - `thread.turn.start` forwards `titleGenerationModel` into `thread.turn-start-requested`.
  - `thread.turn.start` forwards `titleSourceText` into `thread.turn-start-requested`.
- Add ChatView flow tests:
  - first send for a local draft creates the thread with `DEFAULT_NEW_THREAD_TITLE`.
  - first send no longer dispatches title-setting `thread.meta.update`.
  - `thread.turn.start` includes the resolved `titleGenerationModel`.
  - `thread.turn.start` includes `titleSourceText = ""` for image-only sends while still using `IMAGE_ONLY_BOOTSTRAP_PROMPT` for `message.text`.
- Add text-generation tests:
  - valid model output is parsed and sanitized correctly.
  - invalid structured output returns a typed error.
  - non-zero Codex exit returns a typed error.
  - image attachments are included when generating a title.
  - very long user messages are truncated before prompt construction.
- Add `ProviderCommandReactor` tests:
  - first user message triggers async title generation and still starts the provider turn immediately.
  - generated title dispatches `thread.meta.update`.
  - configured `titleGenerationModel` is used when present.
  - default title model is used when absent.
  - second and later user messages do not trigger title generation.
  - manually renamed threads are not overwritten.
  - fallback heuristic title is applied when generation fails.
  - no update is dispatched if a second user message arrives before success or failure completes.
  - no update is dispatched if the thread is deleted before the async result returns.
  - rapid resend or duplicate first-turn processing does not double-apply titles.

## Validation / Acceptance

- Creating a new thread and sending the first message no longer uses the raw message text as the persisted thread title.
- The first assistant turn starts without waiting for title generation.
- The thread is renamed shortly afterward using the generated title.
- Image-only sends produce image-informed titles instead of titles derived from the bootstrap placeholder text.
- If the user renames the thread before the async result arrives, that rename wins.
- If the model call fails, the thread still receives a usable capped fallback title.
- Existing rename flows, plan-implementation thread creation, and standard turn-start behavior are unchanged.

## Assumptions and Defaults

- Default title-generation model is `gpt-5.3-codex`.
- Title model configuration remains app-level because you explicitly chose a configurable setting over a fixed hardcoded model.
- The async rename path is preferred over blocking first-turn start.
- Auto-titleing only applies to the first user message of a thread.
- The auto-rename guard is `thread.title === DEFAULT_NEW_THREAD_TITLE` at the moment the server tries to apply the result.
- `titleSourceText` is the authoritative input for title generation when present.
- No database migration is required for this feature.
- When implementation is done, `bun fmt`, `bun lint`, and `bun typecheck` must all pass. If tests are run, use `bun run test`, never `bun test`.
