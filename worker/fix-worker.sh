#!/bin/bash

set -e

PROJECT_DIR="$HOME/Downloads/api-monitor-saas-v1"
WORKER_DIR="$PROJECT_DIR/worker"
BACKEND_DIR="$PROJECT_DIR/backend"

echo "=================================="
echo " API Monitor Worker Auto Fixer"
echo "=================================="

if [ ! -d "$WORKER_DIR" ]; then
echo "❌ Worker directory not found"
exit 1
fi

cd "$WORKER_DIR"

echo ""
echo "1. Checking Node.js"

if ! command -v node >/dev/null 2>&1; then
echo "❌ Node.js not installed"
exit 1
fi

node -v
npm -v

echo ""
echo "2. Cleaning old dependencies"

rm -rf node_modules
rm -f package-lock.json

echo ""
echo "3. Installing dependencies"

npm install

echo ""
echo "4. Checking TypeScript"

if [ ! -f "node_modules/.bin/tsc" ]; then
echo "❌ TypeScript missing"
npm install typescript --save-dev
fi

echo "✅ TypeScript found"

echo ""
echo "5. Checking Prisma schema"

if [ -f "$BACKEND_DIR/prisma/schema.prisma" ]; then
echo "✅ Prisma schema found"
else
echo "❌ schema.prisma not found"
exit 1
fi

echo ""
echo "6. Syncing Prisma versions"

npm install prisma@5.22.0 --save-dev --save-exact
npm install @prisma/client@5.22.0 --save-exact

echo ""
echo "7. Generating Prisma Client"

if npx prisma generate --schema="$BACKEND_DIR/prisma/schema.prisma"; then
echo "✅ Prisma generated"
else
echo "❌ Prisma generation failed"
exit 1
fi

echo ""
echo "8. Running TypeScript compile"

if npx tsc; then
echo "✅ TypeScript compile successful"
else
echo ""
echo "⚠ TypeScript errors detected"
echo "Trying automatic build..."
fi

echo ""
echo "9. Running project build"

if npm run build; then
echo "✅ Worker build successful"
else
echo "❌ Worker build failed"
exit 1
fi

echo ""
echo "10. Returning to project root"

cd "$PROJECT_DIR"

echo ""
echo "11. Docker validation"

if command -v docker >/dev/null 2>&1; then
docker --version
else
echo "⚠ Docker not installed"
fi

echo ""
echo "=================================="
echo " Worker Fix Complete"
echo "=================================="
echo ""
echo "Next commands:"
echo "docker compose build worker"
echo "docker compose up -d"
