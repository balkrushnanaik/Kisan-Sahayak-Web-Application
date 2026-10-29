# Kisan Sahayak

Kisan Sahayak is a mobile-first MERN marketplace for agricultural work and machinery rental. It is designed for farmers, agricultural labourers and machinery providers, with multiple roles allowed on one account. The first release records agreed work/rental terms; it does **not** move money or pretend an external payment was completed.

> **Implementation status:** this repository contains the application source and local-development configuration. It has not been verified as production-ready in this environment because npm package installation could not reach `registry.npmjs.org` (`EAI_AGAIN`) and no MongoDB server was running here. Run the checks below in an environment with dependencies installed and MongoDB available before relying on it.

## Stack

- React 18, TypeScript, Vite, React Router, Tailwind CSS, TanStack Query, React Hook Form, Zod, i18next.
- Node.js, Express, TypeScript, Mongoose, MongoDB, session cookies, bcrypt, Helmet and rate limiting.
- Vitest and Testing Library unit/client tests; Playwright E2E coverage includes sign-in, job posting/application/offer acceptance, direct invitation negotiation, machinery booking, authorization and responsive landing-page checks.

## Project layout

```text
kisan-sahayak/
├── client/                 # React, Vite, UI, i18n and API client
├── server/                 # Express API, models, routes, business services
│   ├── src/modules/         # reserved for extraction as feature modules grow
│   ├── src/routes/          # auth, jobs, labourers, offers, assignments, machinery, bookings, notifications, admin
│   ├── src/models/          # MongoDB/Mongoose schemas and indexes
│   └── tests/               # backend unit tests
├── docs/                   # supplementary docs
├── docker-compose.yml       # local single-node MongoDB replica set
├── .env.example
└── package.json             # npm workspaces and root scripts
```

## Requirements

- Node.js 20 or newer and npm.
- MongoDB 7 for local development, configured as a single-node replica set. A replica set is needed for transaction-based machinery booking confirmation.
- Network access to the npm registry to install packages.

## Local setup

1. Install dependencies from the project root:

   ```bash
   npm install
   ```

2. Start the local MongoDB replica set:

   ```bash
   docker compose up -d mongo mongo-init
   docker compose logs mongo-init
   ```

   The host-published database URL is `mongodb://127.0.0.1:27017/kisan_sahayak?replicaSet=rs0`.

3. Configure the backend environment:

   ```bash
   cp server/.env.example server/.env
   ```

   Replace `SESSION_SECRET` with a random secret at least 32 characters long. Keep `COOKIE_SECURE=false` for local HTTP development only. Never commit `.env` files.

4. Optional: configure the frontend API URL by copying `client/.env.example` to `client/.env`. The default points to `http://localhost:4000/api/v1`.

5. Seed example accounts and records (optional):

   ```bash
   # Set DEMO_PASSWORD in server/.env to a unique password of at least 12 characters.
   npm run seed
   ```

   Demo identifiers are `demo.farmer@kisansahayak.example`, `demo.worker@kisansahayak.example`, and `demo.provider@kisansahayak.example`. Their password is exactly the `DEMO_PASSWORD` value you configured. These are demonstration accounts, not real marketplace users.

6. Run the web client and API in separate terminals or together:

   ```bash
   npm run dev
   ```

   Frontend: `http://localhost:5173`  
   API readiness: `http://localhost:4000/healthz`  
   API overview: `http://localhost:4000/api/v1`

## Useful commands

```bash
npm run dev             # start client and server together
npm run dev:client      # Vite only
npm run dev:server      # API only
npm run typecheck       # TypeScript checks
npm test                # automated tests
npm run build           # client production build + compiled server
npm run e2e:install     # one-time Playwright Chromium install
npm run test:e2e         # browser journeys; requires local MongoDB replica set and server/.env
npm run seed             # seed demonstration data
npm run seed:admin       # securely create/promote an admin using configured credentials

### Administrator setup

Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 16 characters in `server/.env`, then run `npm run seed:admin`. The script will create the account or add the admin role to the configured account and set the supplied password. Run this only intentionally against the correct database. Do not leave administrator credentials in a deployment shell history or commit them.

## Backend API

The REST API is versioned under `/api/v1`. `/api/v1/docs` returns an overview of route groups. Core groups include:

- `/auth` — registration, login, logout, session identity, role activation and profile updates.
- `/jobs`, `/labourers`, `/applications` — job search, posting, applications and applicant inbox.
- `/work-requests`, `/assignments` — direct work offers, counter-offers, agreement confirmation and assignment progress.
- `/machinery`, `/bookings` — equipment listings, rental requests, negotiation and confirmation.
- `/notifications`, `/reviews`, `/reports`, `/dashboard` — user activity and operational records.
- `/admin` — restricted summaries, moderation queues, user status actions and audit history.

Mutating API calls require `X-Requested-With: XMLHttpRequest`; the frontend API client sets it. Session cookies are HttpOnly. For production, configure `CLIENT_URL`, `SERVER_URL`, `MONGODB_URI`, a unique `SESSION_SECRET`, `COOKIE_SECURE=true`, HTTPS, and an allowed CORS origin.

## External service configuration and limitations

- **Location:** manual village/district entry works without a map provider. Browser geolocation is requested only when the user clicks the location action. Proximity search needs real coordinates on profile/location records; no fake distance is generated.
- **Email, SMS and OTP:** delivery is not simulated. Password recovery returns a documented “not configured” response until a real token-delivery provider is integrated.
- **Images:** local filesystem uploads are for development only. Production uploads are disabled while `STORAGE_PROVIDER=local`; configure an object-storage implementation before production use. Listing forms also accept direct HTTPS image URLs.
- **Payments:** no in-app payments, transfers or checkout exist. The system records agreed rates and booking/assignment state only.
- **Language coverage:** English, Marathi and Hindi dictionaries power the shared navigation, public landing content and common labels. Some deeper workflow forms and admin copy still contain English-only text and need a complete localization pass before the localization acceptance criterion is met.
- **Legal texts:** Privacy and Terms pages are drafts requiring jurisdiction-specific review and finalized operator contact/retention information before launch.
- **Verification and trust:** the application does not claim identity verification, guaranteed labour availability, or guaranteed work quality.

## Test and build checklist

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` after installing dependencies and the Playwright Chromium browser. The E2E config starts the API and UI and expects the disposable MongoDB replica set to be running. Then use separate accounts to test at minimum: register/login/logout; role activation; create/publish a job; labourer search/apply; farmer review and offer; negotiation and assignment confirmation; machinery create/edit/remove; booking confirmation/conflict handling; notifications; access-denied cases; and mobile layouts at 390px and 360px. Do not run destructive tests against production data.

The Playwright suite is configured with `playwright.config.ts` and `e2e/marketplace.spec.ts`. It starts both desktop Chromium and a 360px mobile Chromium project. Start Docker MongoDB and complete the local setup first; Playwright starts the API and Vite server for the test run. Install its browser once with `npm run e2e:install`. The suite creates uniquely named test accounts and sample marketplace records in the configured database; use a disposable development/test database, never production. The suite is an initial automation baseline, not a substitute for a broader staged release test. Confirm real execution results before deployment.
