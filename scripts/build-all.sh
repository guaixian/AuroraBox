#!/bin/bash
# AuroraBox Multi-Target Build Script
#
# Builds for the current platform. Use GitHub Actions for cross-platform.
#
# Usage:
#   ./scripts/build-all.sh              # Build all packages for current arch
#   ./scripts/build-all.sh linux        # Linux only (deb+rpm+AppImage)
#   ./scripts/build-all.sh --target aarch64-unknown-linux-gnu  # specific target

set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[build]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*"; }

# ── Detect platform ──────────────────────────────────────────────────
OS=$(uname -s)
ARCH=$(uname -m)
RUST_TARGET=""

case "$OS" in
    Linux)   OS_LINUX=1 ;;
    Darwin)  OS_MACOS=1 ;;
    MINGW*|MSYS*|CYGWIN*) OS_WINDOWS=1 ;;
esac

case "$ARCH" in
    x86_64|amd64)  RUST_TARGET="x86_64-unknown-linux-gnu" ; ARCH_LABEL="amd64" ;;
    aarch64|arm64) RUST_TARGET="aarch64-unknown-linux-gnu"; ARCH_LABEL="arm64" ;;
    armv7l)        RUST_TARGET="armv7-unknown-linux-gnueabihf"; ARCH_LABEL="armv7" ;;
esac

# Override from CLI
TARGET_ARG="${1:-}"
if [[ "$TARGET_ARG" == --target ]] && [[ -n "${2:-}" ]]; then
    RUST_TARGET="$2"
fi

log "Platform: $OS $ARCH ($ARCH_LABEL)"
log "Rust target: $RUST_TARGET"
echo ""

# ── Prerequisites ────────────────────────────────────────────────────
if ! command -v deno &>/dev/null; then err "deno not found"; exit 1; fi
if ! command -v cargo &>/dev/null; then err "cargo not found"; exit 1; fi

# Ensure the Rust target is installed
if ! rustup target list --installed 2>/dev/null | grep -q "$RUST_TARGET"; then
    warn "Installing Rust target: $RUST_TARGET"
    rustup target add "$RUST_TARGET"
fi

# ── Frontend build ──────────────────────────────────────────────────
log "Building frontend..."
deno task build
echo ""

# ── Platform-specific builds ─────────────────────────────────────────

if [[ -n "${OS_LINUX:-}" ]]; then
    log "=== Linux Build ==="
    log "Checking system libs..."
    for lib in webkit2gtk-4.1 gtk+-3.0 libsoup-3.0; do
        pkg-config --exists "$lib" || warn "$lib not found — install with: sudo apt-get install lib${lib}-dev"
    done

    log "Building Linux packages (deb + rpm)..."
    deno task tauri build --bundles deb,rpm 2>&1 | tail -20

    BUNDLE_DIR="src-tauri/target/release/bundle"
    echo ""
    log "=== Build Results ==="
    ls -lh "$BUNDLE_DIR"/deb/*.deb 2>/dev/null  || warn "No .deb found"
    ls -lh "$BUNDLE_DIR"/rpm/*.rpm 2>/dev/null || warn "No .rpm found (rpmbuild not installed?)"
    echo ""

elif [[ -n "${OS_MACOS:-}" ]]; then
    log "=== macOS Build ==="
    log "Building macOS app + DMG..."
    deno task tauri build --bundles dmg,app 2>&1 | tail -20
    echo ""
    log "=== Build Results ==="
    ls -lh src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || warn "No .dmg"
    ls -lh src-tauri/target/release/bundle/macos/*.app 2>/dev/null || warn "No .app"

elif [[ -n "${OS_WINDOWS:-}" ]]; then
    log "=== Windows Build ==="
    log "Building Windows MSI/NSIS..."
    deno task tauri build --bundles msi,nsis 2>&1 | tail -20
fi

log "Done!"
