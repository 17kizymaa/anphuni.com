# Pipeline MVP Deployment Guide

## What Was Implemented

The MVP now includes:

- User registration and login
- Session cookie authentication
- Protected workflow routes (projects, assets, metrics, transitions)
- Client-scope restriction to `rhythm-reactions-cic`
- Registration cap of 2 users

## Important Hosting Note

This MVP is a Node.js server app (API runtime). GitHub Pages cannot run this backend.

Use this split:

- GitHub: source control
- Render/Railway/Fly.io: run the Node server
- names.co.uk DNS: point anphuni.com to the deployed app

## Recommended Fast Path (Render)

1. Push this repo to GitHub.
2. In Render, create a new Web Service from the GitHub repo.
3. Build command: none needed (or `npm ci` if you prefer explicit install).
4. Start command: `npm run mvp:server`
5. Set root directory to repository root (`anphuni.com`).
6. Deploy and confirm service URL works.
7. In Render custom domains, add:
   - `anphuni.com`
   - `www.anphuni.com`
8. Render will show DNS targets. Add those in names.co.uk DNS.

## names.co.uk DNS Configuration

Use the values from your hosting platform dashboard if they differ. Typical setup:

- Host `www`: CNAME to your Render/Fly/Railway app domain
- Host `@` (apex):
  - Either ALIAS/ANAME if names.co.uk supports it
  - Or URL forwarding from `anphuni.com` -> `https://www.anphuni.com` (301)

## If You Want Static Marketing Site on GitHub Pages

Use this only for static pages (not API runtime):

- In GitHub Pages settings, set custom domain to `www.anphuni.com`
- names.co.uk CNAME `www` -> `your-user-name.github.io`
- Optionally forward apex `anphuni.com` -> `https://www.anphuni.com`

## Security and Production Basics

Before go-live:

- Force HTTPS in hosting dashboard
- Keep HttpOnly session cookie enabled (already implemented)
- Add secure cookie in production behind TLS
- Rotate seeded/demo accounts
- Back up `data/state.json` or move to managed DB

## API Auth Endpoints

- POST `/auth/register`
- POST `/auth/login`
- POST `/auth/logout`
- GET `/auth/me`

## Current Scope Constraints

- Maximum users: 2
- Allowed client key: `rhythm-reactions-cic`
- All pipeline routes require authentication

