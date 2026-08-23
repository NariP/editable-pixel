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
          │ canonical opened document + allowed output directory
          ▼
local filesystem
```

The server does not listen on LAN interfaces. The operating system assigns an available port. HTTP and WebSocket requests validate `Host`; browser-originated requests also validate `Origin` against that exact loopback port.

## Tokens

- The daemon receives a random 256-bit bearer token.
- Every session receives separate random bootstrap and persistent tokens.
- The bootstrap token appears only in the initial URL and is consumed once during WebSocket upgrade.
- The browser stores the persistent token in session storage and removes the bootstrap query from history.
- Closing a session revokes both tokens and clears pending patches and client state.
- The daemon registry is written under the operating-system temporary directory with directory mode `0700` and file mode `0600` where supported.

Never paste or commit a launch URL or registry contents. They authorize local actions while alive.

## Filesystem access

The document path and allowed output directory are resolved to canonical real paths. The server rejects document and output-directory symlinks, traversal names, and writes outside the session's output root. Document persistence uses an exclusive temporary file followed by atomic rename.

Before apply, undo, or redo, the server compares the current file fingerprint with the value observed when it last read or wrote the document. An external change produces `FILE_CONFLICT` instead of an overwrite.

## Mutation safety

The browser's selection update changes selection metadata only; it never creates an image edit. Agent edits are patches with a base revision, before-values, affected bounds, selection, and an outside-selection hash. Preview does not write. Apply checks the revision and invariants again, then persists and broadcasts the new document.

There is no HTTP or MCP route for arbitrary shell execution. JSON requests, uploads, patch counts, WebSocket payloads, image counts/sizes, and request rates are limited.

## Network behavior

Core conversion, editing, rendering, server, CLI, and MCP paths perform no external network request. Optional dependency installation and release publication are separate developer actions. A local background-removal implementation must be explicitly supplied; the product does not silently upload an image to a remote service.

## Residual risks

- Any process running as the same operating-system user may be able to inspect that user's memory or temporary files; OS account isolation remains required.
- A malicious native dependency could act outside the JavaScript-level boundary. Keep dependencies and lockfiles reviewed and current.
- A user can intentionally apply a destructive in-selection patch. Review the preview and keep source control or backups for valuable assets.
- Browser session storage protects against accidental URL reuse, not a compromised browser profile.

Report suspected vulnerabilities through the private process in [SECURITY.md](../SECURITY.md).
