# Deploy Parts Search on Ubuntu with Git

This document describes how to install the application on a clean Ubuntu server. The code is deployed with Git, and the application runs with Docker Compose.

## End State

- The application code is stored in `/opt/parts-search`.
- Updates are deployed with `git pull` and a container rebuild.
- Configuration is stored in `/opt/parts-search/.env`.
- Search logs are written to `/opt/parts-search/logs/search.log`.
- The application is available at `http://SERVER_IP:3000`, or another external port if `3000` is already in use.
- The container restarts automatically after a server reboot.

## Requirements

- Ubuntu 22.04 or 24.04.
- SSH access to the server.
- A user with `sudo` permissions.
- A Git repository with the application code.
- Server access to the repository: deploy key, user SSH key, or HTTPS token.
- API credentials for the suppliers you want to enable.

The examples below use these placeholders:

- `USER` - the server user.
- `SERVER_IP` - the server IP address or DNS name.
- `REPO_URL` - the SSH or HTTPS repository URL, for example `git@github.com:org/parts-search.git`.

## 1. Connect to the Server

```bash
ssh USER@SERVER_IP
```

Update packages:

```bash
sudo apt update
sudo apt upgrade -y
```

Install basic tools:

```bash
sudo apt install -y ca-certificates curl git
```

Verify Git:

```bash
git --version
```

## 2. Configure Repository Access

If the repository is public, you can skip directly to cloning.

If the repository is private, the cleanest server setup is a dedicated SSH deploy key.

Create a key on the server:

```bash
ssh-keygen -t ed25519 -C "parts-search@SERVER_IP"
```

When the command asks for a path, you can keep the default:

```text
/home/USER/.ssh/id_ed25519
```

For a server deploy key, the passphrase is usually left empty so deployments do not require manual input.

Print the public key:

```bash
cat ~/.ssh/id_ed25519.pub
```

Add this public key to the repository:

- GitHub: repository `Settings` -> `Deploy keys` -> `Add deploy key`.
- Enable `Allow write access` only if the server needs to push changes. For deployment, read-only access is usually enough.

Verify access:

```bash
ssh -T git@github.com
```

For GitHub, a successful response can still say that shell access is not provided. That is normal.

## 3. Install Docker and Compose

Install Docker and the Compose plugin:

```bash
sudo apt install -y docker.io docker-compose-v2
```

Enable Docker on boot:

```bash
sudo systemctl enable --now docker
```

Verify the installation:

```bash
docker --version
docker compose version
```

To run Docker without `sudo`, add the user to the `docker` group:

```bash
sudo usermod -aG docker "$USER"
```

Then leave the SSH session and connect again:

```bash
exit
ssh USER@SERVER_IP
```

If you do not want to reconnect, use `sudo docker ...` in the following commands.

## 4. Clone the Application

Create the application parent directory:

```bash
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt
```

Clone the repository:

```bash
git clone REPO_URL /opt/parts-search
cd /opt/parts-search
```

Check the current branch and commit:

```bash
git status
git log -1 --oneline
```

The project should contain the main files and directories: `Dockerfile`, `compose.yaml`, `package.json`, `src/`, `public/`, and `.env.example`.

## 5. Configure `.env`

Create the config file:

```bash
cp .env.example .env
nano .env
```

At minimum, review these values:

```env
HOST=127.0.0.1
PORT=3000
HOST_PORT=3000

UNIQTRADE_EMAIL=
UNIQTRADE_PASSWORD=
UNIQTRADE_BROWSER_FINGERPRINT=parts-search-production

SEARCH_LOG_LEVEL=summary
SEARCH_LOG_FILE=logs/search.log
SEARCH_LOG_MAX_BYTES=1048576
SEARCH_LOG_MAX_FILES=5
```

For Docker Compose, `HOST` is forced to `0.0.0.0` inside the container by `compose.yaml`, so it is fine to keep `127.0.0.1` in `.env`.

`PORT` is the internal application port inside the container. `HOST_PORT` is the external port exposed on the server.

Fill in credentials only for the suppliers that should be enabled:

- `UNIQTRADE_EMAIL`, `UNIQTRADE_PASSWORD`, `UNIQTRADE_BROWSER_FINGERPRINT` - UniqTrade.
- `SLINE_API_KEY` - S-LINE.
- `TEHNOMIR_API_TOKEN` - Tehnomir.
- `AUTONOVA_LOGIN`, `AUTONOVA_PASSWORD`, `AUTONOVA_CLIENT_ID` - Autonova-D.
- `OPTIONAUTO_API_KEY`, `OPTIONAUTO_CLIENT_ID` - OptionAuto.

Save the file in `nano`: `Ctrl+O`, `Enter`, `Ctrl+X`.

Restrict permissions on the secrets file:

```bash
chmod 600 .env
```

Make sure `.env` is not tracked by Git:

```bash
git status --short
```

The `.env` file should be ignored. If it appears in `git status`, stop and add `.env` to `.gitignore` before continuing.

## 6. Start the Application

Before starting the application, check whether external port `3000` is free:

```bash
sudo ss -ltnp | grep ':3000'
```

If the command prints nothing, port `3000` is free.

If port `3000` is already in use, use `8080` as the external port. Keep `PORT=3000`, and change only `HOST_PORT` in `.env`:

```env
HOST_PORT=8080
```

In this case, the application will be available at `http://SERVER_IP:8080`, while internal checks from the server can still use `http://127.0.0.1:8080`.

From `/opt/parts-search`, run:

```bash
docker compose up -d --build
```

Check the status:

```bash
docker compose ps
```

Check startup logs:

```bash
docker compose logs --tail=100 parts-search
```

Check the health endpoint from the server:

```bash
curl http://127.0.0.1:3000/api/health
```

If you changed the external port to `8080`, use:

```bash
curl http://127.0.0.1:8080/api/health
```

The expected result is JSON with `"ok":true`.

## 7. Open the Firewall Port

If `ufw` is enabled, allow the application port:

```bash
sudo ufw allow 3000/tcp
sudo ufw status
```

If you changed the external port to `8080`, allow `8080` instead:

```bash
sudo ufw allow 8080/tcp
sudo ufw status
```

Then open this URL in a browser:

```text
http://SERVER_IP:3000
```

Or, if you changed the external port:

```text
http://SERVER_IP:8080
```

## 8. Verify Search

Open the UI in a browser and run a test search by part article.

You can also check the API directly:

```bash
curl "http://127.0.0.1:3000/api/parts/search?q=OC90&brand=MAHLE"
```

Use `8080` instead of `3000` if you changed the external port.

If a supplier is not configured, `/api/health` will show it as `configured:false`.

## 9. View Logs

Container logs:

```bash
docker compose logs -f parts-search
```

Search logs:

```bash
tail -f logs/search.log
```

If you need more details from supplier responses, temporarily set:

```env
SEARCH_LOG_LEVEL=raw
```

After changing `.env`, restart the container:

```bash
docker compose up -d
```

Do not leave `raw` enabled unless needed: logs will grow faster, even though sensitive fields are redacted by the application.

## 10. Deploy Updates with Git

Before updating, check the current version:

```bash
cd /opt/parts-search
git status
git log -1 --oneline
```

The working tree should be clean. Usually the only local file is `.env`, but it should be ignored by `.gitignore` and should not appear in `git status`.

Pull the latest code:

```bash
git pull --ff-only
```

Rebuild and restart the container:

```bash
docker compose up -d --build
```

Verify the deployment:

```bash
docker compose ps
docker compose logs --tail=100 parts-search
curl http://127.0.0.1:3000/api/health
```

Use the configured `HOST_PORT` instead of `3000` in the health URL if you changed it.

To deploy a specific branch:

```bash
git fetch origin
git switch BRANCH_NAME
git pull --ff-only
docker compose up -d --build
```

To deploy a specific tag:

```bash
git fetch --tags
git checkout TAG_NAME
docker compose up -d --build
```

For production, prefer deploying from a stable branch or tag, not a random commit.

## 11. Roll Back to a Previous Version

View recent history:

```bash
cd /opt/parts-search
git log --oneline -10
```

Check out the required commit or tag:

```bash
git checkout COMMIT_OR_TAG
docker compose up -d --build
```

Verify:

```bash
docker compose ps
curl http://127.0.0.1:3000/api/health
```

Use the configured `HOST_PORT` instead of `3000` in the health URL if you changed it.

To return to the main branch:

```bash
git switch main
git pull --ff-only
docker compose up -d --build
```

If the main branch is not named `main`, use the actual branch name.

## 12. Common Issues

### `Permission denied (publickey)` during `git clone` or `git pull`

Check which key the server uses:

```bash
ssh -T git@github.com
```

Check that the public key is added to the repository deploy keys:

```bash
cat ~/.ssh/id_ed25519.pub
```

### `docker compose` is not found

Check the package:

```bash
sudo apt install -y docker-compose-v2
docker compose version
```

### Docker requires `sudo`

Check the user groups:

```bash
groups
```

If the `docker` group is missing, run:

```bash
sudo usermod -aG docker "$USER"
```

Then leave the SSH session and connect again.

### Port 3000 is already in use

Check what is listening on the port:

```bash
sudo ss -ltnp | grep ':3000'
```

Use `8080` as the next default choice unless it is also busy:

```bash
sudo ss -ltnp | grep ':8080'
```

If `8080` is free, change the external port in `.env`:

```env
HOST_PORT=8080
```

After that, the application will be available at `http://SERVER_IP:8080`.

### Health endpoint does not respond

Check the container and recent logs:

```bash
docker compose ps
docker compose logs --tail=200 parts-search
```

Common causes:

- invalid `.env`;
- Docker image build failed;
- port is already in use;
- the server cannot reach a supplier API;
- after `git pull`, `.env.example` changed but `.env` was not updated.

### UI opens, but search returns errors

Check:

```bash
curl http://127.0.0.1:3000/api/health
tail -n 100 logs/search.log
```

Use the configured `HOST_PORT` instead of `3000` in the health URL if you changed it.

If a provider is shown as `configured:false`, the required variables for that provider are missing in `.env`.

## 13. Alternative Without Docker: Node.js + systemd

Use this option only if Docker cannot be installed. The application requires Node.js 20 or newer.

Install Node.js:

```bash
sudo apt update
sudo apt install -y nodejs npm
node --version
```

If the Node.js version is lower than 20, install Node.js 20 from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

The code can still be deployed with Git:

```bash
git clone REPO_URL /opt/parts-search
cd /opt/parts-search
cp .env.example .env
nano .env
```

Test the application:

```bash
npm start
```

Stop the process with `Ctrl+C`, then create a systemd unit:

```bash
sudo nano /etc/systemd/system/parts-search.service
```

Contents:

```ini
[Unit]
Description=Parts Search
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/parts-search
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Give ownership to the service user:

```bash
sudo chown -R www-data:www-data /opt/parts-search
sudo chmod 600 /opt/parts-search/.env
```

Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now parts-search
sudo systemctl status parts-search
```

Deploy updates without Docker:

```bash
cd /opt/parts-search
git pull --ff-only
sudo systemctl restart parts-search
sudo systemctl status parts-search
```

View systemd logs:

```bash
journalctl -u parts-search -f
```

Verify:

```bash
curl http://127.0.0.1:3000/api/health
```
