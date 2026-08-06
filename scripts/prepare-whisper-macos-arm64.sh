#!/usr/bin/env bash
# Build the Apple-Silicon Whisper CLI that upstream releases do not publish.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="v1.9.2"
EXPECTED_COMMIT="306c88f4d1286aec1bf96e544632897886af5501"
WORK_DIR="${TMPDIR:-/tmp}/fac-transcript-whisper.cpp-${REF}"
DEST="$ROOT/vendor/whisper.cpp/darwin-arm64"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This preparation script must run on an Apple Silicon Mac." >&2
  exit 1
fi
command -v git >/dev/null || { echo "Install Xcode Command Line Tools: xcode-select --install" >&2; exit 1; }
command -v cmake >/dev/null || { echo "Install CMake (for example: brew install cmake)." >&2; exit 1; }

rm -rf "$WORK_DIR"
git clone --depth 1 --branch "$REF" https://github.com/ggml-org/whisper.cpp.git "$WORK_DIR"
ACTUAL_COMMIT="$(git -C "$WORK_DIR" rev-parse HEAD)"
[[ "$ACTUAL_COMMIT" == "$EXPECTED_COMMIT" ]] || {
  echo "Unexpected whisper.cpp commit for $REF: $ACTUAL_COMMIT" >&2
  exit 1
}
cmake -S "$WORK_DIR" -B "$WORK_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_EXAMPLES=ON
cmake --build "$WORK_DIR/build" --config Release --target whisper-cli -j"$(sysctl -n hw.ncpu)"

BINARY="$WORK_DIR/build/bin/whisper-cli"
[[ -x "$BINARY" ]] || { echo "whisper-cli was not produced by whisper.cpp $REF." >&2; exit 1; }
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$BINARY" "$DEST/whisper-cli"
# Keep Metal runtime sidecars if this whisper.cpp revision emits them.
find "$WORK_DIR/build" -type f \( -name '*.metallib' -o -name 'ggml-metal.metal' \) -exec cp {} "$DEST/" \;
printf '%s\n' "$REF" > "$DEST/WHISPER_CPP_VERSION"
chmod 755 "$DEST/whisper-cli"
printf 'Prepared %s (%s)\n' "$DEST/whisper-cli" "$REF"
