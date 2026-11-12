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

For an app in Google OAuth testing mode, add each Gmail account that will connect in Google Cloud Console under **Google Auth Platform > Audience > Test users**. Testing-only OAuth apps can reject users who are not listed with `Error 403: access_denied`. Publish or verify the app before allowing Gmail users outside the test-user list.
5. Set the client ID, secret, redirect URI, and required secrets in `.env`.

## Run

First, make sure MongoDB and Redis are running and that the backend and worker use the same `MONGODB_URI` and `REDIS_URL` values from the project-root `.env`. The app now prefers the root `.env` over any stale service-local `.env` files, so local development defaults to `mongodb://127.0.0.1:27017/cold_email` and `redis://127.0.0.1:6379` unless you explicitly override them.

With Docker Desktop:
```powershell
Set-Location "D:\Automated cold email platform\cold-email-platform"
Copy-Item .env.example .env
docker compose up -d mongo redis
```

Set the required secrets in `.env` before starting the applications. Install the backend, worker, and frontend dependencies once, then start the services from the project folder. By default, the development launcher starts the backend and separate worker. Set `RUN_WORKER=true` to run the worker inside the backend process instead; the launcher then skips the separate worker. The launcher retries backend and worker processes if they exit:

```powershell
Set-Location "D:\Automated cold email platform\cold-email-platform"
npm --prefix backend install
npm --prefix worker install
npm --prefix frontend install
npm run dev
```

Press Ctrl+C to stop all three services. You can also start the services in separate terminals:

Backend (API, port 4000):

```powershell
Set-Location "D:\Automated cold email platform\cold-email-platform\backend"
npm install
npm run dev
```

Worker (recipient parsing and campaign jobs):

```powershell
Set-Location "D:\Automated cold email platform\cold-email-platform\worker"
npm install
npm run dev
```

Frontend (port 3000):

```powershell
Set-Location "D:\Automated cold email platform\cold-email-platform\frontend"
npm install
npm run dev
```

Open `http://localhost:3000`. Check `http://localhost:4000/api/health` to see whether the parsing worker heartbeat is alive.

Alternatively, run all services in containers from the project directory with `docker compose up --build`. The backend and worker containers restart automatically if they exit. To start or restart only the recipient processor and its dependencies, run `docker compose up -d --build worker`. The Compose configuration connects containers to MongoDB and Redis by their service names; keep `127.0.0.1` in `.env` for applications you run directly on your host.

To run the upload parser checks (a generated multi-sheet XLSX and `sample-recruiters.csv`), run:

```powershell
Set-Location "D:\Automated cold email platform\cold-email-platform\worker"
npm run test:upload-parser
```

## Render single-service deployment

To run the API and BullMQ workers in one Render web service, keep the service root directory at the repository root so the backend build can access the worker package. Use these commands:

```text
Build: npm install --prefix worker && npm install --prefix backend && npm run build --prefix backend
Start: npm start --prefix backend
```

Set `RUN_WORKER=true` in the Render service environment, along with `MONGODB_URI`, `REDIS_URL`, and the other backend environment variables. The backend build bundles the worker runtime into `backend/dist`, while its embedded worker uses the backend's established MongoDB connection and parse queue. Do not start a second worker service for this deployment. Docker Compose keeps `RUN_WORKER=false` and continues to run the standalone `worker` service.

## Using the app

1. Register and sign in.
2. Set the default resume link under Settings.
3. Connect Gmail under Settings.
4. Create or edit templates under Templates.
5. Create a campaign, upload recipients, review them, compose, confirm, and launch.
