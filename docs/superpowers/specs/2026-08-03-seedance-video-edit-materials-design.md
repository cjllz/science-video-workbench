# Seedance Video Edit And Retouch Materials

## Goal

Allow a user to add, replace, or remove material on a completed shot and choose whether the material is composited exactly or used by Seedance to edit the existing continuous video segment.

## User Actions

The retouch editor exposes three distinct actions:

1. **Apply and recompose** keeps the generated shot unchanged and applies exact overlays, charts, narration, and subtitle changes locally.
2. **Edit existing shot** sends the current provider clip as `reference_video` plus the selected AI-reference materials and an edit instruction to Seedance.
3. **Regenerate shot** generates the selected shot from its prompt and reference materials without using the previous video.

Each material binding can be added from the library, uploaded in place, replaced while retaining timing and placement, or removed. Image and video materials default to exact display so their pixels are preserved. Data defaults to a local chart. The user can explicitly choose `Integrate into scene` for an image or video when Seedance should redraw it into the shot.

## Provider Contract

Seedance video editing uses the existing shot clip as:

```json
{
  "type": "video_url",
  "video_url": { "url": "https://..." },
  "role": "reference_video"
}
```

The request also contains the shot edit instruction and any material references. A video-edit request must never silently fall back to text-only regeneration. If the reference video or AI-reference material has no provider-accessible HTTPS URL, preflight fails with an actionable message.

New Ark generations persist the returned provider URL and its observed creation time in a per-job asset manifest. This URL can be reused while available. `OUTPUT_PUBLIC_BASE_URL` provides a durable fallback for locally cached provider clips when the deployment exposes `/outputs` over public HTTPS. Production deployments should back that origin with TOS or another object store because Ark result URLs expire.

## Data And Revisions

`ShotRetouchInput` carries a visual action of `none`, `edit`, or `regenerate`. The existing boolean is accepted temporarily for compatibility.

The provider asset manifest records, per shot, the local filename, provider, source URL, and creation time. Revision archive and restore include the manifest so rolling back also restores the correct editable source lineage.

Before any retouch request, the current plan and output are archived. Provider failure leaves the archived version available and keeps the current cached shot; it does not replace the shot with a motion card.

## UI

Both the script overview and selected-shot editor contain the same material section with:

- an existing-material selector and Add button;
- an Upload button;
- one row per binding with preview/name, a simple purpose selector, Replace, and Remove;
- three clearly named processing actions matching the user actions above.

The purpose selector maps user language to the provider contract: `Integrate into scene` uses an AI reference, `Show data` uses a local chart/table, and `Display as-is` uses an exact overlay. A newly attached material spans the whole selected shot by default. Placement, start/end offsets, and data-column controls remain available under a collapsed `Advanced settings` section. AI references apply to the complete selected segment and do not expose irrelevant placement controls.

## Validation And Tests

- Unit tests verify default bindings, add/replace behavior, request construction with `reference_video`, URL selection, and manifest archive/restore.
- Server tests verify invalid edit requests fail before queueing.
- Existing renderer tests continue to cover exact overlay timing.
- Browser QA verifies adding and replacing materials, action availability, shot seeking, desktop/mobile layout, and zero console errors.

## Out Of Scope

- Pixel-perfect object masking or deterministic inpainting guarantees.
- A full nonlinear timeline editor.
- Automatic TOS account provisioning without storage credentials.
