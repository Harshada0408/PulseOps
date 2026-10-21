#!/bin/bash
# API Monitor SaaS - Production Deployment Script

set -e

VERSION=${1:-$(git describe --tags --always)}
ENV=${2:-production}

echo "Deploying API Monitor SaaS v$VERSION to $ENV..."

# Build images
echo "Building Docker images..."
docker build -t api-monitor-backend:$VERSION ./backend
docker build -t api-monitor-frontend:$VERSION ./frontend
docker build -t api-monitor-worker:$VERSION ./worker

# Tag latest
docker tag api-monitor-backend:$VERSION api-monitor-backend:latest
docker tag api-monitor-frontend:$VERSION api-monitor-frontend:latest
docker tag api-monitor-worker:$VERSION api-monitor-worker:latest

# Deploy
echo "Deploying..."
if [ "$ENV" = "production" ]; then
    docker compose -f docker-compose.prod.yml down
    docker compose -f docker-compose.prod.yml up -d

    # Run migrations
    echo "Running database migrations..."
    docker compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy

    # Health check
    echo "Health check..."
    sleep 10
    curl -f http://localhost:3001/health || {
        echo "Health check failed! Rolling back..."
        docker compose -f docker-compose.prod.yml down
        exit 1
    }
fi

# Cleanup
docker system prune -f

echo "Deployment complete!"
echo "Version: $VERSION"
echo "Environment: $ENV"
