#!/bin/bash
set -euo pipefail
[[ "$(uname -s)" == "Darwin" ]] || { echo "Native iOS compilation requires macOS and Xcode." >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")" && pwd)"
xcodebuild -version
for tool in git go node yarn xcodegen pod; do command -v "$tool" >/dev/null || { echo "Missing build dependency: $tool" >&2; exit 1; }; done
mkdir -p "$ROOT/Frameworks" "$ROOT/.build"
if [[ ! -d "$ROOT/.build/TorrServer" ]]; then git clone --depth 1 --branch MatriX.150 https://github.com/YouROK/TorrServer.git "$ROOT/.build/TorrServer"; fi
# The upstream mobile wrapper leaves HTTP IPs empty. Bind explicitly to loopback.
python3 - "$ROOT/.build/TorrServer/server/mobile/torrserverkit/torrserverkit.go" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); source=p.read_text()
if 'IPs:      []string{"127.0.0.1"},' not in source:
    anchor='\t\tPort:     portStr,\n'
    assert source.count(anchor)==1
    p.write_text(source.replace(anchor,anchor+'\t\tIPs:      []string{"127.0.0.1"},\n'))
PY
(cd "$ROOT/.build/TorrServer" && IOS_VERSION_MIN=16.0 ./build-ios.sh)
ditto "$ROOT/.build/TorrServer/dist/TorrServerKit.xcframework" "$ROOT/Frameworks/TorrServerKit.xcframework"
cd "$ROOT"
xcodegen generate
pod install
echo "Open KawaiiFlex.xcworkspace. Choose an iPhone simulator and run Product → Test."
echo "Device installation and TestFlight require your own Apple signing configuration."
