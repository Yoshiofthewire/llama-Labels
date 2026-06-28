# Backend

## Purpose

Go module owning the email classification engine, HTTP API server, IMAP integration, Ollama integration, polling loop, configuration, state persistence, health tracking, logging, and PII redaction.

## Ownership

All code under `backend/`. Produces the `llama-lab` binary consumed by the container at runtime.

## Local Contracts

- Go 1.26.4; dependencies limited to `go-imap` and `yaml.v3`
- Entry point: `cmd/main.go` → `app.Run(os.Args)`
- All business logic lives under `internal/`; `cmd/` contains only the entry point
- Binary output: `llama-lab`, deployed to `/app/bin/llama-lab` in the container
- HTTP API listens on `WEB_PORT` (default 5866)
- Three runtime modes: `daemon` (poller only), `server` (API only), `all` (both)
- Secrets (IMAP password, Ollama auth) are encrypted at rest under `SECRET_DIR`
- State is persisted as JSON under `STATE_DIR`: checkpoint (last processed IMAP UID), processed set, decisions log
- Logs are structured JSON, written to stdout and a rotating file (16 MB max × 8 backups) under `LOG_DIR`

### Internal Package Layout

| Package | Responsibility |
|---------|---------------|
| `app/` | Mode flag parsing; bootstrap logger, config, poller, API server |
| `api/` | 18 HTTP endpoints; scrypt session auth; config/IMAP/Ollama/health/decisions/logs/tuning |
| `adapters/imap/` | IMAP UID-based email fetching; credential decrypt |
| `adapters/llama/` | Ollama `/api/generate` HTTP calls; 3s inter-request pacing; retry backoff |
| `processor/` | Timed polling loop (~90s default); orchestrates fetch → redact → classify → label → persist |
| `config/` | YAML config load/init; `Config` struct used across all packages |
| `state/` | Checkpoint, processed-set, and decisions JSON persistence |
| `health/` | Health status; sticky `aiCreditsExhausted` flag |
| `logging/` | Structured logger; rotating file writer |
| `redaction/` | Regex-based PII masking applied to sender, subject, and body before prompting Ollama |

### Classification Loop (daemon mode)

1. Poller fires on timer
2. Fetch unread emails from IMAP since last checkpoint
3. Apply redaction patterns to sender, subject, body
4. POST to Ollama `/api/generate` with tuning prompt + redacted email text
5. Fuzzy-match Ollama response against the label allowlist
6. Apply matched label as an IMAP keyword
7. Persist decision (messageId, sender, subject, label, status, timestamp)
8. Advance checkpoint to next UID

### API Contract (consumed by frontend)

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/password`
- `GET/PUT /api/config` — full config read/write; changes broadcast to running poller
- `GET/POST/DELETE /api/imap/config`, `POST /api/imap/test`
- `GET/PUT /api/tuning` — TUNING.md read/write
- `POST /api/llama/auth`, `POST /api/llama/test`
- `GET /api/health`, `GET /api/status`
- `GET /api/decisions?limit=N`
- `GET /api/logs` (stream), `GET /api/logs/list`

## Work Guidance

- Build: `cd backend && go build ./cmd/...`
- Test: `cd backend && go test ./...`
- Keep adapter packages free of direct state mutation; they communicate via interfaces and channels defined in `processor/`
- PII redaction must be applied before any text is sent to Ollama
- Do not add dependencies outside the go.mod without explicit approval

## Verification

- `go build ./cmd/...` must succeed with zero errors
- `go vet ./...` must pass

## Child DOX Index

- `internal/adapters/` — external protocol clients (IMAP + Ollama); see [internal/adapters/AGENTS.md](internal/adapters/AGENTS.md)
