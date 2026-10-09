#!/bin/bash
# 클라우드 세션(Claude Code on the web)이 시작될 때 의존성을 자동으로 설치한다.
# 어떤 경우에도 exit 0으로 끝나 세션 시작을 막지 않는다.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund || echo "[install_pkgs] npm ci 실패 (세션은 계속 진행)"
elif [ -f package.json ]; then
  npm install --no-audit --no-fund || echo "[install_pkgs] npm install 실패 (세션은 계속 진행)"
fi

exit 0
