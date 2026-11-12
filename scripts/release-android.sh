#!/usr/bin/env bash
#
# Builds the signed Android release package and, with --publish, publishes it
# as the GitHub release that installed copies of the app update themselves from.
#
# Usage: scripts/release-android.sh [--publish]
#
# The version comes from app.json. The signing key is read from the
# environment, or from the file named by TWITTER_CLEAR_SIGNING_ENV
# (default: ~/.config/twitter-clear/signing.env):
#
#   TWITTER_CLEAR_KEYSTORE           path of the keystore
#   TWITTER_CLEAR_KEYSTORE_PASSWORD  its password, also used for the key
#   TWITTER_CLEAR_KEY_ALIAS          alias of the signing key
#
# Every release must be signed with the same key: Android refuses to install an
# update whose signature differs from that of the installed app.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "error: $*" >&2
  exit 1
}

publish=false
case "${1:-}" in
  "") ;;
  --publish) publish=true ;;
  *) fail "unknown argument '$1' (usage: $0 [--publish])" ;;
esac

signing_env="${TWITTER_CLEAR_SIGNING_ENV:-$HOME/.config/twitter-clear/signing.env}"
if [ -f "$signing_env" ]; then
  # shellcheck source=/dev/null
  source "$signing_env"
fi
: "${TWITTER_CLEAR_KEYSTORE:?set the signing key variables or create $signing_env}"
: "${TWITTER_CLEAR_KEYSTORE_PASSWORD:?missing keystore password}"
: "${TWITTER_CLEAR_KEY_ALIAS:?missing key alias}"
[ -f "$TWITTER_CLEAR_KEYSTORE" ] || fail "keystore not found: $TWITTER_CLEAR_KEYSTORE"
export TWITTER_CLEAR_KEYSTORE_PASSWORD

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -d "$ANDROID_HOME" ] || fail "Android SDK not found; set ANDROID_HOME"
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  export JAVA_HOME
fi

version="$(node -p "require('./app.json').expo.version")"
tag="v$version"
package="dist/TwitterClear-$version-arm64.apk"

if $publish; then
  [ -z "$(git status --porcelain)" ] || fail "commit your changes before publishing"
  if gh release view "$tag" >/dev/null 2>&1; then
    fail "release $tag already exists; raise the version in app.json"
  fi
fi

echo "==> Building Twitter Clear $version"
npx expo prebuild --platform android --no-install --clean

# The key is passed through the environment rather than as arguments so the
# password does not show up in the process list.
(
  cd android
  env \
    NODE_ENV=production \
    "ORG_GRADLE_PROJECT_android.injected.signing.store.file=$TWITTER_CLEAR_KEYSTORE" \
    "ORG_GRADLE_PROJECT_android.injected.signing.store.password=$TWITTER_CLEAR_KEYSTORE_PASSWORD" \
    "ORG_GRADLE_PROJECT_android.injected.signing.key.alias=$TWITTER_CLEAR_KEY_ALIAS" \
    "ORG_GRADLE_PROJECT_android.injected.signing.key.password=$TWITTER_CLEAR_KEYSTORE_PASSWORD" \
    ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
)

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "$package"

# A build that silently fell back to another key could never update an
# installed copy, so the signature is checked before anything is published.
apksigner="$(find "$ANDROID_HOME/build-tools" -name apksigner | sort -V | tail -n 1)"
[ -n "$apksigner" ] || fail "apksigner not found under $ANDROID_HOME/build-tools"
expected="$(keytool -list -keystore "$TWITTER_CLEAR_KEYSTORE" -alias "$TWITTER_CLEAR_KEY_ALIAS" \
  -storepass:env TWITTER_CLEAR_KEYSTORE_PASSWORD |
  sed -n 's/.*(SHA-256): //p' | tr -d ':' | tr 'A-F' 'a-f')"
[ -n "$expected" ] || fail "could not read the release key's fingerprint"
"$apksigner" verify --print-certs "$package" | grep -q "SHA-256 digest: $expected" ||
  fail "$package is not signed with the release key"

echo "==> Built $package"

if $publish; then
  gh release create "$tag" "$package" \
    --target "$(git rev-parse HEAD)" \
    --title "Twitter Clear $version" \
    --generate-notes
  echo "==> Published $tag"
fi
