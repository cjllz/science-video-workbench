# Shot Retouch Design

## Goal

Allow a completed science video to be adjusted by continuous shot segment rather than by individual frame or by regenerating the entire video.

## User Flow

1. A completed job keeps the playable MP4 visible.
2. A shot timeline shows each segment with its absolute start/end time.
3. Selecting a shot opens controls for headline, narration, visual prompt, and bound-material timing/placement.
4. `Recompose` applies narration, subtitle, chart, timing, and overlay changes without calling Seedance.
5. `Regenerate shot` calls Seedance only for the selected complete segment, then recomposes the full video from cached unchanged shots.
6. The previous plan and output files are archived before each retouch and can be restored.

## Architecture

- A pure retouch validator applies a patch to exactly one shot and keeps total duration unchanged in the first version.
- The pipeline loads cached `provider-<index>.mp4` files for unchanged generated shots. It regenerates only the selected target when requested.
- The renderer applies exact overlays only during each binding's relative `startOffset`/`endOffset` interval.
- A revision table records the prior plan and archived output URLs before processing begins.
- The completed-video UI owns a local editable copy of the selected shot and submits one of the two explicit retouch modes.

## Failure Handling

- Retouch is allowed only for completed jobs with a plan and output.
- Invalid material intervals, missing variables, and duration drift fail before queueing.
- If retouch fails, the archived output remains available and the job reports the error.
- Provider failure for a requested visual regeneration falls back to the previous cached provider clip when available; otherwise it uses the local motion card.

## Verification

- Unit tests cover single-shot patching, interval validation, and cached provider selection.
- Existing render/preflight tests remain green.
- Browser QA covers desktop/mobile timeline selection, local recompose submission, and the visible processing state.
