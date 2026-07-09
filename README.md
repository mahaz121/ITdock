# ITDock

ITDock is a self-hosted IT asset management system for tracking equipment,
employees, assignments, maintenance, subscriptions, custody documents, and
audit history.

## Features

- Asset inventory for physical, consumable, and subscription assets
- Employee, company, project, location, and department management
- Asset assignment, return, vacation handover, and resignation workflows
- Maintenance, warranty, renewal, scrap, and audit tracking
- Custody and asset-document uploads
- Dashboard statistics, notifications, charts, and exports
- Role-based access for super admins, IT admins, technicians, and viewers
- JWT authentication, optional TOTP two-factor authentication, and API keys

## Requirements

The recommended Linux installation uses:

- Ubuntu 24.04 LTS
- Node.js 20
- MongoDB Community 8.0
- 2 GB RAM minimum; 4 GB recommended
- 10 GB of available disk space

## Quick start on Ubuntu 24.04

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git build-essential

# Install Node.js 20.
curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs

# Install MongoDB Community 8.0.
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc |
  sudo gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" |
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod

# Download ITDock.
git clone https://github.com/mahaz121/ITdock.git itdock
cd itdock

# Install exactly the dependencies recorded in package-lock.json.
npm ci

# Configure the application.
cp .env.example .env
JWT_SECRET="$(openssl rand -hex 32)"
API_KEY_SALT="$(openssl rand -hex 32)"
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
printf '\nAPI_KEY_SALT=%s\n' "$API_KEY_SALT" >> .env

# Build and start.
npm run build
npm start
```

Open `http://SERVER_IP:3000`, then sign in with:

```text
Username: admin
Password: admin
```

Change the default password immediately. `npm start` runs in the foreground;
use the production section in [INSTALL.md](./INSTALL.md) to keep ITDock running
with PM2 and place it behind HTTPS.

## Verify the installation

```bash
curl http://127.0.0.1:3000/api/health
```

A working installation returns HTTP 200 with `"ok": true` and
`"db": "connected"`.

## Documentation

- [Complete Linux installation and production guide](./INSTALL.md)
- [Additional deployment notes](./DEPLOYMENT.md)
- [Category reset notes](./CATEGORIES_RESET.md)

## Configuration

ITDock reads its configuration from `.env`.

| Variable | Purpose | Example |
| --- | --- | --- |
| `MONGO_URL` | MongoDB connection URI | `mongodb://127.0.0.1:27017` |
| `DB_NAME` | MongoDB database name | `itdock` |
| `JWT_SECRET` | Signs authentication tokens; use a random value | `openssl rand -hex 32` |
| `API_KEY_SALT` | Hashes API keys; use a different random value | `openssl rand -hex 32` |
| `NEXT_PUBLIC_BASE_URL` | Public application URL | `https://itdock.example.com` |
| `CORS_ORIGINS` | Allowed web origin | `https://itdock.example.com` |
| `UPLOAD_DIR` | Persistent document storage | `/var/lib/itdock/uploads` |

Never commit a populated `.env` file.

## Common commands

```bash
# Development server
npm run dev

# Production build
npm run build

# Production server
npm start

# Health check
curl http://127.0.0.1:3000/api/health
```

## Technology

- Next.js 14 and React 18
- MongoDB
- Tailwind CSS, shadcn/ui, and Radix UI
- Recharts
- JWT, bcrypt, and TOTP authentication

## Project structure

```text
app/
  api/[[...path]]/route.js   API endpoints
  page.js                    Main browser application
  layout.js                  Root layout
components/ui/               Shared UI components
lib/
  auth.js                    Authentication and authorization helpers
  db.js                      MongoDB connection
  mail.js                    SMTP integration
uploads/                     Development upload storage
```

## Security checklist

Before exposing ITDock to a network:

- Change the default `admin` password.
- Generate unique `JWT_SECRET` and `API_KEY_SALT` values.
- Set `CORS_ORIGINS` to the application domain instead of `*`.
- Enable MongoDB authentication.
- Use HTTPS through a reverse proxy.
- Restrict ports 3000 and 27017 from public access.
- Back up both MongoDB and the upload directory.
- Keep Node.js and npm dependencies patched.

## License

No license has been specified yet.
