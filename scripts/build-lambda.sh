#!/usr/bin/env bash
# Linux twin of build-lambda.ps1: builds backend/build/lambda.zip for AWS Lambda.
# Used by .github/workflows/deploy.yml. Run from anywhere.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
BUILD_DIR="$BACKEND_DIR/build/lambda"
ZIP_PATH="$BACKEND_DIR/build/lambda.zip"
PYTHON="${PYTHON:-python}"

echo "==> Cleaning $BUILD_DIR"
rm -rf "$BUILD_DIR" "$ZIP_PATH"
mkdir -p "$BUILD_DIR"

echo "==> Installing runtime dependencies (Linux wheels)"
"$PYTHON" -m pip install \
    --quiet \
    --no-compile \
    --disable-pip-version-check \
    --target "$BUILD_DIR" \
    -r "$BACKEND_DIR/requirements-lambda.txt"

echo "==> Copying application code"
cp -r "$BACKEND_DIR/apps" "$BUILD_DIR/apps"
cp -r "$BACKEND_DIR/config" "$BUILD_DIR/config"
cp "$BACKEND_DIR/manage.py" "$BUILD_DIR/manage.py"

find "$BUILD_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$BUILD_DIR" -type f -name '*.pyc' -delete

echo "==> Collecting static files"
rm -rf "$BACKEND_DIR/staticfiles"
(
    cd "$BACKEND_DIR"
    DJANGO_DEBUG=1 \
    DJANGO_SECRET_KEY='build-only-not-a-secret' \
    DJANGO_ALLOWED_HOSTS='*' \
    AWS_LAMBDA_FUNCTION_NAME='' \
    DATABASE_URL='' \
    MEDIA_BUCKET='' \
        "$PYTHON" manage.py collectstatic --noinput
)
if [ ! -d "$BACKEND_DIR/staticfiles" ]; then
    echo "collectstatic did not produce backend/staticfiles." >&2
    exit 1
fi
cp -r "$BACKEND_DIR/staticfiles" "$BUILD_DIR/staticfiles"

UNZIPPED_MB=$(du -sm "$BUILD_DIR" | cut -f1)
echo "Unzipped size: ${UNZIPPED_MB} MB"
if [ "$UNZIPPED_MB" -gt 250 ]; then
    echo "The bundle is ${UNZIPPED_MB} MB, over Lambda's 250 MB unzipped limit." >&2
    exit 1
fi

echo "==> Creating zip"
(
    cd "$BUILD_DIR"
    zip -q -r -X "$ZIP_PATH" .
)

for entry in config/lambda_handler.py config/lambda_jobs.py config/lambda_warm.py; do
    if ! unzip -Z1 "$ZIP_PATH" | grep -qx "$entry"; then
        echo "The zip is missing $entry." >&2
        exit 1
    fi
done
if ! unzip -Z1 "$ZIP_PATH" | grep -q '^staticfiles/'; then
    echo "The zip is missing collected static files." >&2
    exit 1
fi

ZIP_MB=$(du -m "$ZIP_PATH" | cut -f1)
echo "Lambda package: $ZIP_PATH (${ZIP_MB} MB)"
