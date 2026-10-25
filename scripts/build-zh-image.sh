#!/usr/bin/env bash
# Build the Simplified-Chinese Agent Vault image from this fork.
#
# The localization lives entirely in the web build (web/plugins + dictionary),
# so building this repository with its own Dockerfile produces the Chinese
# image. No host-side Node.js or Go toolchain is required.
#
# Usage:
#   ./scripts/build-zh-image.sh [options]
#
# Options:
#   --image NAME          Image repository (default: agent-vault-cn)
#   --tag TAG             Image tag (default: git describe, e.g. 0.40.2-1-g121c5c5)
#                         An explicit tag is never promoted to latest.
#   --push                Push the built tag (and latest, if promoted) after building
#   --no-cache            Disable Docker layer cache
#   --platform PLATFORM   Target platform, e.g. linux/amd64 or linux/arm64
#   -h, --help            Show this help
#
# Environment overrides:
#   VERSION, COMMIT, BUILD_DATE   Build metadata injected into the binary
#   POSTHOG_API_KEY               Optional PostHog key compiled into the binary
#
# Examples:
#   ./scripts/build-zh-image.sh
#   ./scripts/build-zh-image.sh --tag 0.40.2-cn --push
#   ./scripts/build-zh-image.sh --platform linux/arm64 --tag arm64-test

set -euo pipefail

IMAGE="agent-vault-cn"
TAG=""
PUSH=0
NO_CACHE=0
PLATFORM=""
POSTHOG_API_KEY="${POSTHOG_API_KEY:-}"

usage() {
  sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE="${2:?--image requires a value}"; shift 2 ;;
    --tag) TAG="${2:?--tag requires a value}"; shift 2 ;;
    --push) PUSH=1; shift ;;
    --no-cache) NO_CACHE=1; shift ;;
    --platform) PLATFORM="${2:?--platform requires a value}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed or not on PATH" >&2
  exit 1
fi

VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"
COMMIT="${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
PROMOTE_LATEST=0
if [[ -z "$TAG" ]]; then
  TAG="${VERSION#v}"
  PROMOTE_LATEST=1
fi

if [[ ! -f Dockerfile ]]; then
  echo "error: Dockerfile not found in $ROOT" >&2
  exit 1
fi

build_args=(
  build
  -f Dockerfile
  -t "${IMAGE}:${TAG}"
  --build-arg "VERSION=${VERSION}"
  --build-arg "COMMIT=${COMMIT}"
  --build-arg "BUILD_DATE=${BUILD_DATE}"
  --build-arg "POSTHOG_API_KEY=${POSTHOG_API_KEY}"
)
[[ "$NO_CACHE" == 1 ]] && build_args+=(--no-cache)
[[ -n "$PLATFORM" ]] && build_args+=(--platform "$PLATFORM")
build_args+=(.)

echo "==> Building ${IMAGE}:${TAG}"
echo "    version: ${VERSION}"
echo "    commit:  ${COMMIT}"
echo "    date:    ${BUILD_DATE}"
echo

docker "${build_args[@]}"

if [[ "$PROMOTE_LATEST" == 1 && "$TAG" != "latest" ]]; then
  docker tag "${IMAGE}:${TAG}" "${IMAGE}:latest"
  echo "==> Tagged ${IMAGE}:latest"
fi

if [[ "$PUSH" == 1 ]]; then
  echo "==> Pushing ${IMAGE}:${TAG}"
  docker push "${IMAGE}:${TAG}"
  if [[ "$PROMOTE_LATEST" == 1 && "$TAG" != "latest" ]]; then
    docker push "${IMAGE}:latest"
  fi
fi

echo
echo "Done: ${IMAGE}:${TAG}"
docker image inspect "${IMAGE}:${TAG}" \
  --format '    size: {{.Size}} bytes  created: {{.Created}}' 2>/dev/null || true
