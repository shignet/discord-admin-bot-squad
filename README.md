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
- Linux host with these user accounts already in place:
  - **your admin user** — a personal account with `sudo` rights. All install steps run from here; there is no interactive `root`.
  - **`squad`** — runs each Squad instance (`squad-train.service`, `squad-public.service`, …) and owns `Admins.cfg` / `config.sh`.
  - **`discord`** — dedicated service account that runs this bot. Created below.

The bot needs to read **and** write config files owned by `squad`. It gets that access by being a supplementary member of the `squad` group, plus an SGID bit on the target directory so new files (tmp writes, `*.bak.*`) inherit `group=squad`.

## Installation

All commands below run **as your admin user** — prefix with `sudo` where shown.

### 1. Create the `discord` service account and its tree

```bash
sudo useradd -r -s /usr/sbin/nologin -G squad discord
sudo install -d -o discord -g discord -m 0750 /opt/discord-admin-bot
```

Verify: `id discord` must list `squad` as a supplementary group.

### 2. Prepare the Squad config directory for group writes

Replace `/opt/squad/Configs/supporter-train` with the real directory that holds your `Admins.cfg` and `config.sh`.

```bash
CFGDIR=/opt/squad/Configs/supporter-train

sudo chgrp squad   "$CFGDIR"
sudo chmod 2775    "$CFGDIR"    # 2xxx = SGID: new files inherit group=squad

sudo chgrp squad   "$CFGDIR"/Admins.cfg "$CFGDIR"/config.sh
sudo chmod 0660    "$CFGDIR"/Admins.cfg "$CFGDIR"/config.sh
```

Sanity check — create a file as `discord` and confirm group inheritance:

```bash
sudo -u discord touch "$CFGDIR/.perm-test" && ls -l "$CFGDIR/.perm-test"
# -rw-r----- 1 discord squad … .perm-test
sudo rm "$CFGDIR/.perm-test"
```

### 3. Clone and install as the `discord` user

```bash
sudo -u discord git clone https://github.com/shignet/discord-admin-bot-squad.git /opt/discord-admin-bot
sudo -u discord --preserve-env=PATH bash -lc '
  cd /opt/discord-admin-bot &&
  npm ci --omit=dev &&
  cp -n .env.example .env
'
sudo -u discord $EDITOR /opt/discord-admin-bot/.env   # fill in tokens, role IDs, paths, SQUAD_SERVICES
sudo chmod 0640 /opt/discord-admin-bot/.env
sudo chown discord:discord /opt/discord-admin-bot/.env
```

### 4. Register the slash commands

```bash
sudo -u discord bash -lc 'cd /opt/discord-admin-bot && npm run deploy-commands'
```

Re-run after any change to command definitions or to `SQUAD_SERVICES`.

### 5. Install the sudoers allow-list

Edit `systemd/sudoers.d-discord-admin-bot` first and uncomment the blocks for **exactly** the services you listed in `SQUAD_SERVICES`. The two files must stay in lock-step — see *Operational notes* below.

```bash
sudo install -m 0440 -o root -g root \
  systemd/sudoers.d-discord-admin-bot /etc/sudoers.d/discord-admin-bot
sudo visudo -c           # must print "parsed OK"
```

### 6. Install the systemd unit

```bash
sudo install -m 0644 systemd/discord-admin-bot.service \
  /etc/systemd/system/discord-admin-bot.service

# Drop-in for the directories the bot legitimately writes to:
sudo systemctl edit discord-admin-bot
# [Service]
# ReadWritePaths=/opt/squad/Configs/supporter-train

sudo systemctl daemon-reload
sudo systemctl enable --now discord-admin-bot
sudo journalctl -u discord-admin-bot -f
```

You should see `Commands loaded` and `Bot ready` within a second or two.

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
