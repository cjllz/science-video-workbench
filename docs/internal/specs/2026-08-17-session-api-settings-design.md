# Session-scoped API Settings Design

## Goal

Allow each trusted LAN browser session to submit its own script-planning and video-generation API configuration without exposing secrets to other users, storing secrets in the browser, or turning the shared-password application into an account system.

## Scope

- Add an API settings dialog to the authenticated workbench.
- Configure the script planner separately from the video provider.
- Support DeepSeek, OpenAI-compatible, and Ark script planners.
- Support Ark Seedance as the user-configurable video provider.
- Keep the generic HTTP video provider administrator-managed through environment variables.
- Store user-submitted settings only in server process memory and isolate them by browser session.
- Fall back independently to administrator environment configuration when a session has not configured a script or video provider.
- Preserve the existing local planner and motion-card fallbacks when neither session nor administrator configuration is available.

## Alternatives considered

### Server-memory session settings

This is the selected approach. Secrets remain on the server, are scoped to a unique authenticated session, and disappear on logout, session expiry, or server restart. It fits the trusted-LAN and shared-password deployment without introducing permanent secret storage.

### Browser storage

Keeping keys in `localStorage` would be simpler, but exposes long-lived secrets to browser scripts and requires sending them repeatedly with job commands. This approach is rejected.

### Encrypted database storage

Persistent encrypted settings require user accounts, a server master key, key rotation, and ownership rules. This is outside the current LAN-only scope and is deferred until the application has real user identities.

## Session identity and secret storage

Authenticated session tokens will include a cryptographically random session identifier in addition to their expiry and signature. The server validates the signed token and exposes the session identifier only to trusted server-side request handling.

An in-memory credential store maps session identifiers to normalized provider settings. It never writes settings to SQLite, job records, event records, generated output, or application logs. Expired entries are removed lazily when sessions are read or updated. Logging out deletes the session's settings before clearing the cookie.

Session API settings are available only when LAN authentication is enabled. Local development with authentication disabled continues to use administrator environment settings and local fallbacks.

## Configuration model

Script settings contain:

- mode: server default, DeepSeek, OpenAI-compatible, or Ark;
- API key for non-default modes;
- model name;
- base URL for DeepSeek and OpenAI-compatible modes.

Video settings contain:

- mode: server default or Ark Seedance;
- Ark API key for the Ark mode;
- Seedance model name;
- maximum generated shots, constrained to the existing supported range.

Selecting server default removes that part of the session override. Script and video settings are independent, so a session can provide one and inherit the other.

## API contract

Authenticated endpoints will provide:

- `GET /api/settings/providers`: return effective non-secret settings and source metadata for script and video providers.
- `PUT /api/settings/providers`: validate and replace the current session's script and video settings.
- `DELETE /api/settings/providers`: remove all provider settings for the current session and restore server defaults.

Responses never contain API keys. Each section returns only provider, model, base URL where applicable, connection status, source (`session`, `server`, or `local`), and a boolean indicating whether the session has supplied a key.

Each non-default section update uses an explicit key action: `keep` retains the current session key without returning it to the browser, while `replace` requires a non-empty new key. Initial configuration and provider changes require `replace`; `keep` is valid only when that session already has a key for the same provider. Server-default mode removes the corresponding override and does not accept a key. This lets a user edit one section without re-entering the other section's secret.

Validation constrains provider modes, URL schemes, model and URL lengths, generated-shot limits, and request body size. Provider errors are normalized before being returned to the client and must not include authorization headers or submitted keys.

## Task data flow

Provider modules will accept an explicit resolved configuration rather than reading mutable global state during work. Environment variables remain the administrator fallback used by a configuration resolver.

When a user creates a job, confirms a script for rendering, retries a failed job, or submits a retouch operation, the route resolves the current session settings and passes an immutable configuration snapshot into the corresponding enqueue operation. The in-process worker retains that snapshot only for the duration of the queued or running operation.

This means the browser session that initiates an operation supplies its API configuration, even when acting on a job visible in the shared workspace. Changing settings does not alter work already queued or running. If the user logs out after work starts, the captured operation can finish, but later operations require new settings or use administrator defaults.

After a server restart, session settings and queued snapshots are gone. Existing restart recovery continues to mark interrupted work as failed. Retrying uses the settings of the session that performs the retry.

## Client experience

The authenticated top bar gains an API settings icon button. It opens one compact dialog with separate Script API and Video API sections.

Each section uses a provider selector and only shows fields relevant to that provider. Secret inputs are always blank on open and display saved state separately as `Configured for this session`. The dialog shows whether each effective provider comes from the current session, the server default, or local fallback.

Saving replaces the submitted session configuration and refreshes the provider status used by the existing generation form. Clearing personal settings asks for confirmation, removes both overrides, and immediately refreshes status. No API key is stored in React persistence, browser storage, URLs, or query parameters.

## Error handling

- Invalid settings return `400` with field-level validation information.
- Missing or expired authentication continues to return `401`.
- A provider authorization, quota, timeout, or unavailable error fails the affected job through the existing job error flow with a concise provider-specific message.
- A missing session override falls back to the administrator setting for that provider section, then to the existing local behavior.
- Settings are never echoed back after a failed save.

## Testing and verification

Focused tests will cover:

- unique signed session identifiers and compatibility with expiry and invalid-cookie handling;
- isolation of in-memory settings between two sessions;
- logout, explicit clearing, and expiry cleanup;
- independent script/video fallback to environment configuration;
- route validation and API-key redaction;
- explicit planner and video configuration selection in queued work;
- client dialog save, clear, and status-refresh behavior where practical.

The complete existing suite must remain green. Final verification includes the production build, dependency audit, authenticated HTTP smoke tests with two separate cookie jars, and desktop/mobile browser checks of the settings dialog.

## Non-goals

- Persistent personal API keys.
- User accounts, roles, or ownership of shared jobs and materials.
- Billing, usage quotas, or per-user cost reporting.
- Exposing the generic HTTP video adapter to user configuration.
- Verifying a video API key by creating a billable test video.
