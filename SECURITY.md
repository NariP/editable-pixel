# Security Policy

## Supported versions

Security fixes are applied to the latest published release. Before the first public release, fixes are made on the default branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private **Report a vulnerability** form for this repository. Include the affected version, operating system, reproduction steps, impact, and whether a token or local file was exposed. Remove real secrets and personal images from the report.

You should receive an acknowledgement after the report is reviewed. Publication and disclosure timing will be coordinated with the reporter after a fix is available.

## Security boundary

Editable Pixel is a local application, not a network service. Its default server:

- binds only to `127.0.0.1` on an operating-system-assigned port;
- authenticates daemon and per-session requests with random bearer tokens;
- exchanges a one-time browser bootstrap token for a persistent session token;
- validates HTTP Host and Origin values;
- canonicalizes allowed document and output paths and rejects symlinks and traversal;
- limits request, image, patch, and request-rate sizes;
- never exposes an arbitrary shell-command endpoint;
- performs conversion, rendering, and editing without an external network call.

Treat a one-time launch URL and the local registry file as secrets. Do not paste, log, commit, or share them. Close unused sessions to revoke their tokens.

The tool can overwrite an opened Pixel Document only through an explicit patch apply, undo, or redo operation. It uses a file fingerprint to reject writes after an external on-disk change and writes documents atomically.

See [docs/security.md](./docs/security.md) for implementation details and residual risks.
