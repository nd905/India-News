#!/bin/bash
# Run this script to deploy to Cloudflare Pages
# Requirements: wrangler logged in (npx wrangler login)

echo "Building project..."
npm run build

echo "Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist --project-name india-newshorts

echo "Done! Visit https://india-newshorts.pages.dev"
