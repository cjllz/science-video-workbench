# Science Video Studio

This repository contains a runnable science-video generation MVP. It accepts a topic or script and can produce a short narrated MP4 with captions and generated or programmatic shots.

## Start

Requirements: Node.js 20 or newer and Python 3.10 or newer.

```powershell
npm install
npm run setup:tts
npm run dev
```

Open `http://127.0.0.1:5173`.

Production mode:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:8787` locally. With the default `HOST=0.0.0.0`, other devices on the same LAN can open `http://<computer-lan-ip>:8787`.

## Workflow

1. Enter a topic and keywords, or paste/import a TXT, Markdown, or DOCX script.
2. Generate the script. The job stops at the storyboard instead of spending video-generation credits immediately.
3. Edit shot order, duration, narration, headline, and visual direction.
4. Upload image, video, audio, CSV, or XLSX materials. Every upload becomes an editable `@variable`.
5. Insert variables into shots and choose their role, mode, and placement. Data bindings also select chart type and columns.
6. Save the script, then explicitly confirm to run preflight and start Seedance/rendering.
7. Review the MP4 and submit feedback. Accepted, highly rated videos become structural examples for similar future scripts.

After a video is complete, the shot-retouch timeline treats every item as a continuous time segment. Editing narration, subtitles, chart settings, overlay placement, or a material's relative start/end time uses `Recompose` and does not call Seedance. Changing people, actions, or scene composition uses `Regenerate shot`, which calls Seedance only for the selected segment and reuses cached provider clips for every unchanged shot. The previous MP4, captions, poster, plan, and provider clips are archived before processing and can be restored from the version strip.

Images and videos use `exact overlay` by default, preserving the uploaded pixels in local post-production. `AI reference`, `first frame`, and `last frame` send material to Seedance and therefore require a publicly reachable HTTPS material URL. Configure `MATERIAL_PUBLIC_BASE_URL` to an origin that exposes the same `/materials/...` paths; the confirmation preflight blocks inaccessible AI references. CSV/XLSX values are rendered locally and are never redrawn by the video model.

## Completed-shot material editing

The shot retouch workspace supports adding, uploading, replacing, and removing material bindings after a video is complete:

- `Apply and recompose` preserves the generated shot and locally applies exact image/video overlays, uploaded data charts, narration, and subtitles.
- `Edit existing shot` sends the selected continuous provider clip to Seedance as `reference_video`, together with any `AI reference` materials.
- `Regenerate shot` creates the selected shot again without using the previous video.

Ark result URLs are recorded for 23 hours after generation so a new shot can be edited directly. For durable editing, configure `OUTPUT_PUBLIC_BASE_URL` as a public HTTPS origin that exposes `/outputs/...`; production deployments should serve that origin from TOS or equivalent object storage. Uploaded AI-reference materials likewise require `MATERIAL_PUBLIC_BASE_URL`. Exact overlays and data charts stay local and do not require public storage.

## Configuration

`HOST` controls the server listen address and defaults to `0.0.0.0` for LAN access. Set it to `127.0.0.1` to restrict the workbench to this computer.

The planner supports an OpenAI-compatible `chat/completions` endpoint through `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`.

Topic-only planning can use a direct DeepSeek-compatible endpoint through `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL`; this takes priority over Ark text planning. If no direct planner is configured, an existing `ARK_API_KEY` can use `ARK_TEXT_MODEL` with thinking disabled. Video generation uses `ARK_VIDEO_MODEL` and `ARK_MAX_GENERATED_SHOTS`; the default video model is `doubao-seedance-2-0-mini-260615`. Its native audio is disabled because the workbench adds controlled narration during final composition. Without external providers, the application falls back to local planning and animated information cards.

## Verification

```powershell
npm test
npm run build
```

Medical content still requires authoritative citations and human review before publication.
