# Cold Email Automation Platform

## Prerequisites

- Node.js 20+
- Docker Desktop
- A Google Cloud OAuth web client with Gmail API enabled

## Local setup

```cmd
cd "d:\Automated cold email platform\cold-email-platform"
copy .env.example .env
docker compose up -d mongo redis
```

Generate secrets:

```cmd
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Put the hex value in `TOKEN_ENCRYPTION_KEY`. Put separate random strings in the JWT and OAuth state variables.

## Google OAuth

1. Create a Google Cloud project and enable Gmail API.
2. Configure the OAuth consent screen with Gmail scope `https://www.googleapis.com/auth/gmail.send`, `openid`, and `email`.
3. Create a Web OAuth client.
4. Add `http://localhost:4000/api/gmail/callback` as an authorized redirect URI.
5. Set the client ID, secret, redirect URI, and required secrets in `.env`.

## Run

Backend:

```cmd
cd "d:\Automated cold email platform\cold-email-platform\backend"
npm install
npm run dev
```

Worker:

```cmd
cd "d:\Automated cold email platform\cold-email-platform\worker"
npm install
npm run dev
```

Frontend:

```cmd
cd "d:\Automated cold email platform\cold-email-platform\frontend"
npm install
npm run dev
```

Open `http://localhost:3000`.

## Using the app

1. Register and sign in.
2. Set the default resume link under Settings.
3. Connect Gmail under Settings.
4. Create or edit templates under Templates.
5. Create a campaign, upload recipients, review them, compose, confirm, and launch.
