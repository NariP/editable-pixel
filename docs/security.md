# Local security model

Editable Pixel handles user-selected image and document files on the local computer. The security goal is to keep those files local, make every write explicit, and prevent an unrelated web page or process from controlling an editor session.

## Trust boundaries

```text
system browser / Codex browser
          │ per-session token + validated Origin/Host
          ▼
127.0.0.1 session server
          │ daemon token in mode-0600 OS temp registry
          ▼
CLI / stdio MCP
          │ canonical Project/Document + allowed output directory
          ▼
local filesystem
```

The server does not listen on LAN interfaces. The operating system assigns an available port. HTTP and WebSocket requests validate `Host`; browser-originated requests also validate `Origin` against that exact loopback port. The daemon registry lives at `~/.editable-pixel/server.json` with a private parent directory and file mode; this stable per-user location remains discoverable when Codex or Claude sanitizes temporary-directory environment variables.

## Tokens

- The daemon receives a random 256-bit bearer token.
- Every session receives separate random bootstrap and persistent tokens.
- The bootstrap token appears only in the initial URL and is consumed once during WebSocket upgrade.
- The browser stores the persistent token in session storage and removes the bootstrap query from history.
- Closing a session revokes both tokens and clears pending patches and client state.
- The daemon registry is written under the operating-system temporary directory with directory mode `0700` and file mode `0600` where supported.

Never paste or commit a launch URL or registry contents. They authorize local actions while alive.

## Filesystem access

Project/Document paths and the allowed output directory are resolved to canonical real paths. The server rejects input and output-directory symlinks, traversal names, and writes outside the session's output root. Persistence uses an exclusive temporary file followed by atomic rename; Project writes also require the expected Project revision.

Before apply, undo, or redo, the server compares the current file fingerprint with the value observed when it last read or wrote the document. An external change produces `FILE_CONFLICT` instead of an overwrite.

## Mutation safety

The browser and MCP update the same canonical Selection. A Selection transaction changes selection metadata only; it never paints pixels. The primary `use_editable_pixel` path accepts a strict action union rather than arbitrary code, validates coordinates, target IDs, palette, schema, Selection requirements, file fingerprint, and revision, then immediately persists and broadcasts one actor-tagged History transaction. User and AI actions share Undo and Redo.

The legacy Patch path remains available for explicit review workflows. Those patches carry a base revision, before-values, affected bounds, selection, and an outside-selection hash. Preview does not write; Apply checks the revision and invariants again before persistence. Screenshot is a read-only visual context and QA tool, not an authorization token or mandatory approval gate.

The browser keeps temporarily disconnected pixel edits in an ordered in-memory patch queue and retains the visible local result. Reconnect resends unacknowledged patches from their original base revisions. A divergent server revision produces a visible conflict instead of silently replacing either side. Project autosave uses the same explicit `saving`, `reconnecting`, `failed`, and `conflict` distinction.

There is no HTTP or MCP route for arbitrary shell execution. Semantic browser commands are a strict discriminated union and execute only while that authenticated session's web client is connected. `import_files` accepts absolute regular files only, rejects symlinks and unsupported media, and enforces per-file and aggregate limits before forwarding bytes over the protected loopback session. JSON requests, uploads, patch counts, WebSocket payloads, image counts/sizes, and request rates are limited.

## Network behavior

Core conversion, editing, rendering, server, CLI, and MCP paths perform no external network request. Optional dependency installation and release publication are separate developer actions. A local background-removal implementation must be explicitly supplied; the product does not silently upload an image to a remote service.

## Residual risks

- Any process running as the same operating-system user may be able to inspect that user's memory or temporary files; OS account isolation remains required.
- A malicious native dependency could act outside the JavaScript-level boundary. Keep dependencies and lockfiles reviewed and current.
- A user or agent can intentionally apply a destructive validated action. Use shared History and Undo immediately, and keep source control or backups for valuable assets.
- Browser session storage protects against accidental URL reuse, not a compromised browser profile.

Report suspected vulnerabilities through the private process in [SECURITY.md](../SECURITY.md).
