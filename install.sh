#!/bin/sh

set -eu

package_name="editable-pixel"
action="install"
prefix="${EDITABLE_PIXEL_PREFIX:-}"
version="${EDITABLE_PIXEL_VERSION:-latest}"
package_spec="${EDITABLE_PIXEL_PACKAGE_SPEC:-}"

usage() {
  cat <<'EOF'
Install or remove Editable Pixel on macOS and Linux.

Usage:
  sh install.sh [--version <version>] [--prefix <directory>]
  sh install.sh --uninstall [--prefix <directory>]

Options:
  --version <version>   npm version to install (default: latest)
  --prefix <directory>  install under a custom npm prefix
  --uninstall           remove Editable Pixel from the selected prefix
  -h, --help            show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || { echo "Missing value for --version." >&2; exit 2; }
      version="$2"
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || { echo "Missing value for --prefix." >&2; exit 2; }
      prefix="$2"
      shift 2
      ;;
    --uninstall)
      action="uninstall"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v node >/dev/null 2>&1 || {
  echo "Editable Pixel requires Node.js 24 or newer: https://nodejs.org" >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "Editable Pixel requires npm, which is included with Node.js." >&2
  exit 1
}

# Mirrors the `engines.node` floor in packages/pixel-cli/package.json (>=24.0.0).
# The floor is a whole major, so only the major is compared: a minor term here
# would be dead code that silently rots the next time the floor moves.
# tests/manifests/runtime-versions.test.ts keeps the two in step.
node -e '
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 24) process.exit(1);
' || {
  echo "Editable Pixel requires Node.js 24 or newer; found $(node --version)." >&2
  exit 1
}

if [ -n "$prefix" ]; then
  npm_prefix="$prefix"
else
  npm_prefix="$(npm prefix --global)"
fi

if [ "$action" = "uninstall" ]; then
  if [ -n "$prefix" ]; then
    npm uninstall --global --prefix "$prefix" "$package_name"
  else
    npm uninstall --global "$package_name"
  fi
  echo "Removed Editable Pixel from $npm_prefix."
  exit 0
fi

if [ -z "$package_spec" ]; then
  package_spec="${package_name}@${version}"
fi

if [ -n "$prefix" ]; then
  npm install --global --prefix "$prefix" "$package_spec"
else
  npm install --global "$package_spec"
fi

binary="$npm_prefix/bin/editable-pixel"
if [ ! -x "$binary" ]; then
  echo "Installation finished, but the editable-pixel executable was not found at $binary." >&2
  exit 1
fi

installed_version="$("$binary" --version)"
echo "Installed Editable Pixel $installed_version."
echo "Run: $binary open"
case ":${PATH:-}:" in
  *":$npm_prefix/bin:"*) ;;
  *) echo "Add $npm_prefix/bin to PATH to run editable-pixel directly." ;;
esac
