# Linux Docker Deployment Design

## Goal

Turn the existing single-host LAN workbench into a repeatable, maintainable Linux server deployment without changing its single-instance SQLite and local-file architecture. The release must include an operator guide detailed enough for a new administrator to install, configure, secure, upgrade, back up, restore, and troubleshoot the service.

## Deployment boundary

The supported production topology is one Linux host running Docker Compose. It contains one application container and one Caddy container. The application remains a single process because rendering coordination, session API settings, SQLite, and generated media are process-local or host-local.

Kubernetes, replicas, a remote database, Redis, and object-storage migration are not part of this work. Public object storage remains optional and is needed only when an external video provider must fetch AI-reference materials or prior video output.

## Architecture

```text
Trusted LAN clients
        |
        | HTTPS on 443
        v
Caddy with an internal CA
        |
        | private Compose network
        v
Single Node application container
        |
        v
Host bind-mounted data directory
        |
        +--> local rotating backups
        +--> optional NAS/removable-disk mirror
```

Only Caddy publishes host ports. The application port is exposed only to the Compose network. Host firewall instructions restrict ports 80 and 443 to the configured LAN subnet, and the guide explicitly prohibits router port forwarding.

## Container image

Use a multi-stage image based on the official Node 22 Debian slim image. The build stage installs locked npm dependencies and compiles server and client output. The runtime stage contains only production Node dependencies and the built application.

The runtime image also installs:

- Python 3 and an isolated virtual environment;
- the pinned `edge-tts` requirement;
- Debian's system ffmpeg package;
- Noto CJK fonts;
- CA certificates, curl, and `tini`.

The renderer resolves ffmpeg in this order: validated `FFMPEG_PATH`, optional bundled `ffmpeg-static`, then a system `ffmpeg` executable. Docker sets `FFMPEG_PATH=/usr/bin/ffmpeg`. This removes the container's runtime dependence on one architecture-specific bundled binary while preserving local-development compatibility.

The final container runs as a non-root user, uses `tini` as PID 1, has a read-only root filesystem, receives a writable `/tmp` tmpfs, and writes persistent content only under `/app/data`.

## Compose services

`compose.yaml` defines:

- `app`: locally built image, one replica, private port 8787, bind-mounted data, environment file, health check, restart policy, log rotation, no-new-privileges, and a stop grace period longer than the application shutdown deadline;
- `caddy`: official Caddy 2 image, ports 80/443, private upstream to `app:8787`, persistent Caddy data/config volumes, health-aware dependency ordering, restart policy, and log rotation.

Deployment configuration lives in a non-secret checked-in example. Real secrets live in `deploy/.env.production`, are ignored by Git, and the guide requires mode `0600`. Compose must not embed API keys or the LAN password.

## Internal HTTPS

Caddy serves `https://<LAN_HOST>` with `tls internal` and redirects HTTP to HTTPS. The deployment guide explains how to:

1. set a stable LAN IP or DHCP reservation;
2. set `LAN_HOST` to that IP or a local DNS name;
3. start Caddy so its local CA is created;
4. export the Caddy root certificate;
5. install and trust it on Windows, macOS, Linux, iOS, and Android clients;
6. verify the certificate fingerprint before trusting it.

The Node application trusts exactly one reverse proxy hop when `TRUST_PROXY=1`, allowing Express to recognize forwarded HTTPS and issue Secure session cookies. Security headers are set at Caddy. The guide makes clear that anyone who trusts the private CA can trust certificates minted by that CA, so the CA data and root key must remain server-only; clients receive only the root certificate.

## Runtime configuration validation

Add one focused runtime-config module that parses environment variables before creating the Express app. It validates:

- `PORT` is an integer from 1 through 65535;
- `HOST` is non-empty;
- `MAX_CONCURRENT_RENDERS` is an integer in a conservative supported range;
- `LAN_ACCESS_TOKEN` is present and sufficiently long whenever `HOST` is not loopback;
- `TRUST_PROXY` is one of the supported explicit values;
- `FFMPEG_PATH`, when supplied, is an absolute path;
- provider URLs use HTTP(S), models stay within length limits, and numeric provider limits are valid.

Invalid production configuration fails startup with field names and safe messages but never prints secret values. Loopback development remains able to run without LAN authentication.

## Dependency preflight and readiness

Keep `/api/health` as a cheap liveness endpoint that only proves the Node event loop can answer. Add public `/api/ready` for container orchestration. Readiness checks:

- SQLite can execute `SELECT 1`;
- the data directory exists and can create/remove a small probe file;
- the resolved ffmpeg binary exists and successfully reports a version;
- Python can import `edge_tts`;
- shutdown has not started.

External paid providers are not contacted by readiness checks. Dependency probes that spawn processes run once at startup and are cached; the database and writable-directory checks remain lightweight runtime checks. A failed readiness response uses status 503 and component names only, without paths, commands, environment contents, or keys.

Docker health checks call the loopback readiness endpoint inside the application container. Caddy starts only after the application is healthy.

## Graceful shutdown

The server stores the `http.Server` returned by `listen` and handles `SIGTERM` and `SIGINT` once. Shutdown proceeds as follows:

1. mark the process unready;
2. reject new job-creating, rendering, retry, and retouch commands with 503;
3. stop accepting new HTTP connections;
4. wait up to 30 seconds for tracked in-process planning/rendering/retouch promises;
5. close SQLite;
6. exit successfully if drained, or exit after recording that unfinished jobs will be recovered as failed on restart.

Compose uses a 45-second stop grace period. The existing restart reconciliation remains authoritative for interrupted jobs.

## Storage

The deployment binds `${DATA_DIR}` on the host to `/app/data`. SQLite, WAL files, uploads, generated media, revisions, and manifests remain in this tree so one backup covers the complete application state.

Startup creates required subdirectories and verifies ownership. The guide recommends a dedicated location such as `/srv/science-video-workbench/data`, not a user's home directory. It includes disk-sizing guidance, free-space checks, and a warning that output and revision storage grow continuously unless the operator archives old projects.

## Backup and restore

Host-side scripts live under `deploy/` and use explicit resolved paths. They refuse root, empty, home, repository-root, and unresolved targets.

The backup flow:

1. acquire a host `flock` so backups cannot overlap;
2. ask a maintenance command inside the app whether any job is queued or active;
3. refuse to proceed while work is active unless the operator deliberately retries later;
4. stop only the application container;
5. create a timestamped compressed archive of the complete data directory in a temporary destination;
6. calculate SHA-256 and write a manifest containing timestamp, application commit/version, architecture, and archive size;
7. atomically rename the completed archive and manifest into the backup directory;
8. restart the app and wait for readiness in a `trap`, including on backup failure;
9. prune local backups older than the configured retention period;
10. optionally copy completed archive, checksum, and manifest files to `BACKUP_MIRROR_DIR` using rsync.

The restore script requires an explicit archive plus `--confirm-restore`. It verifies checksum, stops the app, creates a safety backup of the current data, extracts into a sibling temporary directory, validates the SQLite database and expected directory layout, swaps the data directory, fixes ownership, starts the app, and verifies readiness. If validation or startup fails, it restores the safety copy automatically.

The guide includes manual commands for listing, verifying, restoring, and periodically testing backups. It states plainly that a backup on the same disk is not disaster recovery; the NAS/removable copy is the second copy.

## Upgrade and rollback

The documented upgrade procedure is:

1. confirm no active jobs;
2. create and verify a backup;
3. record the current Git commit and image ID;
4. fetch and check out the intended release commit or tag;
5. rebuild with pulled base images;
6. start Compose and wait for readiness;
7. run authenticated smoke checks;
8. retain the previous image and backup until acceptance.

Rollback checks out the recorded commit, recreates the prior image, and starts it. If a future release changes stored data incompatibly, the operator restores the pre-upgrade backup. This project currently performs idempotent schema initialization rather than versioned migrations, so the guide requires a backup before every upgrade.

## Operator documentation

Create one canonical, detailed Chinese guide at `docs/deployment/linux-docker.md`. It contains:

- architecture and supported scope;
- hardware, OS, network, storage, and account prerequisites;
- CPU architecture detection with `uname -m`;
- Docker Engine and Compose verification;
- repository checkout and directory ownership;
- every environment variable with examples and security notes;
- first build and startup;
- Caddy root certificate export and client trust procedures;
- firewall rules for common Linux firewalls;
- API/provider connectivity requirements;
- normal start/stop/restart/log/status commands;
- backup scheduling with systemd timer or cron, restore drills, and NAS mirror configuration;
- release upgrades and rollback;
- health/readiness interpretation;
- troubleshooting decision trees for TLS, login, provider, ffmpeg, TTS, SQLite, permissions, disk, and container health;
- security checklist and release acceptance checklist;
- complete removal instructions that preserve data by default.

README receives only a concise production entry point linking to the canonical guide.

## Testing and verification

Automated coverage includes:

- runtime configuration acceptance and failure cases;
- readiness result aggregation and secret-safe errors;
- shutdown admission and bounded pipeline drain behavior;
- maintenance idle/active detection;
- shell syntax checks for deployment scripts;
- static Compose configuration validation;
- existing application tests and production build.

Release verification additionally builds the container, runs Compose on loopback test ports, checks liveness/readiness, verifies HTTP-to-HTTPS behavior where the environment permits, confirms the app port is not published, tests restart persistence with a marker in the data directory, exercises a backup and restore round trip with test data, checks image user/read-only filesystem settings, and runs the production dependency audit.

## Non-goals

- Public internet exposure.
- Multiple application replicas.
- Zero-downtime backup or upgrade.
- Automatic deletion of user projects or generated output.
- Automatic provider API calls during health checks.
- Automatic distribution of the private CA root certificate to client devices.
- Replacing SQLite or local storage.
