# discord-admin-bot

Discord slash-command bot for administering Squad game server instances.

## Capabilities

| Command | Subcommand | Effect | Senior Admin | Admin |
| --- | --- | --- | :---: | :---: |
| `/server` | `start` / `stop` / `restart` | `sudo systemctl <action> <instance>` — `instance` is a required dropdown, sourced from `SQUAD_SERVICES` | ✅ | ❌ |
| `/server` | `status` | `sudo systemctl status <instance>` | ✅ | ✅ |
| `/trainadmin` | `add` / `remove` / `list` | Edits `Admin=<id>:TrainAdmins` lines in `Admins.cfg` | ✅ | ✅ |
| `/mod` | `add` / `remove` / `list` | Edits the `export DSG_MOD_LIST="…"` line in `config.sh` | ✅ | ❌ |

Player IDs accept **SteamID64** (`^7656119\d{10}$`) or **EOS ID** (`^[0-9a-f]{32}$`, lowercase only). Mod IDs accept digits only (`^\d{1,20}$`).

## Security design

- **Strict allowlist validation** on every user-supplied value. No blocklists, no silent normalization.
- **Defense in depth** — IDs are re-validated immediately before being written to disk.
- **`execFile` only** — `sudo` and `systemctl` are invoked with an argument array, never a shell string.
- **Minimal sudoers whitelist** — the `discord` user can only run the exact `systemctl <action> <instance>` argv combinations defined in `systemd/sudoers.d-discord-admin-bot`. **Adding a new instance is a deliberate two-place edit** (sudoers + `SQUAD_SERVICES` in `.env`) so that granting access to a production instance never happens by configuration slip.
- **Atomic writes with timestamped backups** — config-file writes happen as `copy → tmp-file → rename`, keeping the last ten backups per file.
- **Per-subcommand role checks server-side** — Discord's `setDefaultMemberPermissions` is treated as a UI hint only; the bot enforces the real gate.
- **Audit log** — every executed command is posted to `AUDIT_CHANNEL_ID`, including user tag, action, outcome, and backup path.

## Prerequisites

- Node.js ≥ 20
- A Discord application with a bot user and `applications.commands` scope
- A dedicated Linux system user (example: `discord`) that will run the bot
- The Squad instance running as a systemd service (example: `squad-public.service`)

## Installation

```bash
# As root / via your config-management system
useradd -r -s /usr/sbin/nologin discord
install -d -o discord -g discord /opt/discord-admin-bot

# As `discord`
cd /opt/discord-admin-bot
git clone <this-repo> .
npm ci --omit=dev
cp .env.example .env
# Fill in .env with your tokens, role IDs, channel ID, and absolute paths.

# Register slash commands once (and again whenever commands change)
npm run deploy-commands

# As root
install -m 0440 -o root -g root systemd/sudoers.d-discord-admin-bot /etc/sudoers.d/discord-admin-bot
visudo -c    # must print "parsed OK"

install -m 0644 systemd/discord-admin-bot.service /etc/systemd/system/discord-admin-bot.service
# Add a drop-in to grant write access to the Squad config directories, e.g.:
#   systemctl edit discord-admin-bot
#   [Service]
#   ReadWritePaths=/home/supporter-train/SquadGame/ServerConfig /home/supporter-train/Configs/supporter-train
systemctl daemon-reload
systemctl enable --now discord-admin-bot
```

## .env reference

See [`.env.example`](./.env.example). All values are required unless explicitly noted.

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token (keep secret) |
| `DISCORD_CLIENT_ID` | Application ID — used when registering guild commands |
| `DISCORD_GUILD_ID` | The single guild the bot serves |
| `SENIOR_ADMIN_ROLE_ID` | Role that may control the server and edit mods |
| `ADMIN_ROLE_ID` | Role that may edit TrainAdmins and view status |
| `AUDIT_CHANNEL_ID` | Channel that receives one embed per executed command |
| `SQUAD_SERVICES` | Comma-separated list of systemd unit names. Each entry must also be whitelisted in `/etc/sudoers.d/discord-admin-bot` |
| `ADMINS_CFG_PATH` | Absolute path to the supporter-train `Admins.cfg` |
| `CONFIG_SH_PATH` | Absolute path to the supporter-train `config.sh` |
| `LOG_LEVEL` | Optional pino level (`info` by default) |

## Operational notes

- **Change to `Admins.cfg` or `config.sh` needs a server restart** to take effect. The bot does not restart the service automatically; it reminds the user in the reply.
- **Logs** land in `journald` (`journalctl -u discord-admin-bot -f`). Structured JSON via pino.
- **Backups** are written next to each managed file as `<name>.bak.<UTC-timestamp>`. Oldest are pruned after the tenth.
- **Adding or renaming an instance** requires updating both `SQUAD_SERVICES` in `.env` and the allow-list in `/etc/sudoers.d/discord-admin-bot`. The bot re-registers its `/server` slash-command choices on the next `npm run deploy-commands` run.

## Project layout

```
src/
  index.js             Entry point, event wiring
  deploy-commands.js   Registers slash commands with Discord
  config.js            Loads + validates .env
  commandLoader.js     Dynamic command discovery
  commands/
    server.js          /server start|stop|restart|status
    trainadmin.js      /trainadmin add|remove|list
    mod.js             /mod add|remove|list
  lib/
    systemctl.js       execFile-based sudo/systemctl wrapper
    adminsCfg.js       Admins.cfg reader/editor
    configSh.js        config.sh reader/editor (DSG_MOD_LIST line only)
    atomicFile.js      Atomic write + timestamped backups
    validation.js      Allowlist regexes for Steam / EOS / mod IDs
    permissions.js     Role-gate helper
    audit.js           Audit-channel embed poster
    logger.js          pino logger
systemd/
  discord-admin-bot.service
  sudoers.d-discord-admin-bot
```
