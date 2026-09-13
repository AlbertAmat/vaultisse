#!/usr/bin/env bash
set -e

# --- Paths ---
ROOT_DIR="$(pwd)"
DIST_DIR="$ROOT_DIR/dist"

# --- Clean old dist ---
echo "Cleaning old dist folder..."
rm -rf "$DIST_DIR"
mkdir "$DIST_DIR"

# --- Build CLIENT ---
echo ""
echo ""
echo ""
echo "============================================="
echo "Building client..."
cd "$ROOT_DIR/client"
npm install
npm run build

# Move client build to root/dist/client
mv "$ROOT_DIR/client/dist" "$DIST_DIR/client"

# --- Build SERVER ---
echo ""
echo ""
echo ""
echo "============================================="
echo "Building server..."
cd "$ROOT_DIR/server"
npm install
npx tsc

# Move server build to root/dist/server
mkdir "$DIST_DIR/server"
cp -r "$ROOT_DIR/server/dist" "$DIST_DIR/server/dist"
cp "$ROOT_DIR/server/package.json" "$DIST_DIR/server/"
cp "$ROOT_DIR/server/package-lock.json" "$DIST_DIR/server/" || true

# Copy assets
echo "Copying assets..."
cp -r "$ROOT_DIR/server/src/assets" "$DIST_DIR/server/dist/assets"

# Upgrade SQL files applied automatically on startup (see
# server/src/migrate/index.ts) - not part of either build above.
mkdir -p "$DIST_DIR/assets"
cp -r "$ROOT_DIR/assets/db" "$DIST_DIR/assets/db"

# (Optional) copy .env if you need it
# cp "$ROOT_DIR/server/.env" "$DIST_DIR/server/" || true

# Install server dependencies in dist
echo "Installing server dependencies in dist..."
cd "$DIST_DIR/server"
npm install --production

echo ""
echo ""
echo ""
echo ""
echo ""
echo "============================================="

# --- Create zip of the dist folder ---
ZIP_FILE="$ROOT_DIR/dist.zip"
echo "Creating zip file $ZIP_FILE..."
cd "$ROOT_DIR"
zip -r "$ZIP_FILE" dist

echo "Zip file created successfully!"


echo "Build complete! Final structure:"
