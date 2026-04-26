# discord-admin-bot-squad

Discord slash-command bot for administering Squad game server instances.

## Capabilities

| Command | Subcommand | Effect | Senior Admin | Admin |
| --- | --- | --- | :---: | :---: |
| `/server` | `start` / `stop` / `restart` | `sudo systemctl <action> <instance>` — `instance` is a required dropdown, sourced from `SQUAD_SERVICES` | ✅ | ❌ |
| `/server` | `status` | `sudo systemctl status <instance>` | ✅ | ✅ |
| `/patreonadmin` | `add` / `remove` / `list` | Edits `Admin=<id>:TrainAdmin` lines in `Admins.cfg` | ✅ | ✅ |
| `/mod` | `add` / `remove` / `list` | Edits the `export DSG_MOD_LIST="…"` line in `config.sh` | ✅ | ❌ |
| `/gameupdate` | — | `sudo systemctl start --wait squad-gameupdate.service` — triggers the Squad update via a dedicated, unsandboxed systemd unit. Affected instance(s) must be restarted manually afterwards. | ✅ | ❌ |

Player IDs accept **SteamID64** (`^7656119\d{10}$`) or **EOS ID** (`^[0-9a-f]{32}$`, lowercase only). Mod IDs accept digits only (`^\d{1,20}$`).

## Security design

- **Strict allowlist validation** on every user-supplied value. No blocklists, no silent normalization.
- **Defense in depth** — IDs are re-validated immediately before being written to disk.
- **`execFile` only** — `sudo` and `systemctl` are invoked with an argument array, never a shell string.
- **Minimal sudoers whitelist** — the `discord` user can only run the exact `systemctl <action> <instance>` argv combinations defined in `systemd/sudoers.d-discord-admin-bot-squad`. **Adding a new instance is a deliberate two-place edit** (sudoers + `SQUAD_SERVICES` in `.env`) so that granting access to a production instance never happens by configuration slip.
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
sudo install -d -o discord -g discord -m 0755 /opt/bots/discord-admin-bot-squad
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
sudo -u discord git clone https://github.com/shignet/discord-admin-bot-squad.git /opt/bots/discord-admin-bot-squad
sudo -u discord --preserve-env=PATH bash -lc '
  cd /opt/bots/discord-admin-bot-squad &&
  npm ci --omit=dev &&
  cp -n .env.example .env
'
sudo -u discord $EDITOR /opt/bots/discord-admin-bot-squad/.env   # fill in tokens, role IDs, paths, SQUAD_SERVICES
sudo chmod 0640 /opt/bots/discord-admin-bot-squad/.env
sudo chown discord:discord /opt/bots/discord-admin-bot-squad/.env
```

### 4. Register the slash commands

```bash
sudo -u discord bash -lc 'cd /opt/bots/discord-admin-bot-squad && npm run deploy-commands'
```

Re-run after any change to command definitions or to `SQUAD_SERVICES`.

### 5. Install the sudoers allow-list

Edit `systemd/sudoers.d-discord-admin-bot-squad` first and uncomment the blocks for **exactly** the services you listed in `SQUAD_SERVICES`. The two files must stay in lock-step — see *Operational notes* below.

```bash
sudo install -m 0440 -o root -g root \
  systemd/sudoers.d-discord-admin-bot-squad /etc/sudoers.d/discord-admin-bot-squad
sudo visudo -c           # must print "parsed OK"
```

### 6. Install the systemd units

The bot itself runs hardened (read-only `/opt`, `LockPersonality=true`). SteamCMD
and the GameUpdate script can't run inside that sandbox, so `/gameupdate` triggers
a separate, unsandboxed unit (`squad-gameupdate.service`) instead.

```bash
sudo install -m 0644 systemd/squad-gameupdate.service \
  /etc/systemd/system/squad-gameupdate.service
```



```bash
sudo install -m 0644 systemd/discord-admin-bot-squad.service \
  /etc/systemd/system/discord-admin-bot-squad.service

# Drop-in for the directories the bot legitimately writes to:
sudo systemctl edit discord-admin-bot-squad
# [Service]
# ReadWritePaths=/opt/squad/Configs/supporter-train

sudo systemctl daemon-reload
sudo systemctl enable --now discord-admin-bot-squad
sudo journalctl -u discord-admin-bot-squad -f
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
| `ADMIN_ROLE_ID` | Role that may edit TrainAdmin and view status |
| `AUDIT_CHANNEL_ID` | Channel that receives one embed per executed command |
| `SQUAD_SERVICES` | Comma-separated list of systemd unit names. Each entry must also be whitelisted in `/etc/sudoers.d/discord-admin-bot-squad` |
| `ADMINS_CFG_PATH` | Absolute path to the supporter-train `Admins.cfg` |
| `CONFIG_SH_PATH` | Absolute path to the supporter-train `config.sh` |
| `LOG_LEVEL` | Optional pino level (`info` by default) |

## Operational notes

- **Change to `Admins.cfg` or `config.sh` needs a server restart** to take effect. The bot does not restart the service automatically; it reminds the user in the reply.
- **Logs** land in `journald` (`journalctl -u discord-admin-bot-squad -f`). Structured JSON via pino.
- **Backups** are written next to each managed file as `<name>.bak.<UTC-timestamp>`. Oldest are pruned after the tenth.
- **Adding or renaming an instance** requires updating both `SQUAD_SERVICES` in `.env` and the allow-list in `/etc/sudoers.d/discord-admin-bot-squad`. The bot re-registers its `/server` slash-command choices on the next `npm run deploy-commands` run.
- **`/gameupdate` does not stop or restart any server.** The script only updates the game files; a Senior Admin must issue `/server restart <instance>` afterwards for each affected instance. The command has a 20-minute timeout to accommodate slow SteamCMD downloads.
- **Never run `git` under `sudo`** in `/opt/bots/discord-admin-bot-squad` — the repo is owned by the `discord` user and running git as root triggers a "dubious ownership" error. Use `sudo -u discord git -C /opt/bots/discord-admin-bot-squad <cmd>` instead.

## Project layout

```
src/
  index.js             Entry point, event wiring
  deploy-commands.js   Registers slash commands with Discord
  config.js            Loads + validates .env
  commandLoader.js     Dynamic command discovery
  commands/
    server.js          /server start|stop|restart|status
    patreonadmin.js    /patreonadmin add|remove|list
    mod.js             /mod add|remove|list
    gameupdate.js      /gameupdate (triggers squad-gameupdate.service)
  lib/
    systemctl.js       execFile-based sudo/systemctl wrapper
    systemctlGuard.js  Allowlist gates for actions and unit names (pre-execFile)
    gameUpdate.js      Triggers squad-gameupdate.service and streams its journal
    adminsCfg.js       Admins.cfg reader/editor
    configSh.js        config.sh reader/editor (DSG_MOD_LIST line only)
    atomicFile.js      Atomic write + timestamped backups
    validation.js      Allowlist regexes for Steam / EOS / mod IDs
    permissions.js     Role-gate helper
    audit.js           Audit-channel embed poster
    logger.js          pino logger
systemd/
  discord-admin-bot-squad.service
  squad-gameupdate.service          Oneshot unit triggered by /gameupdate
  sudoers.d-discord-admin-bot-squad
test/
  adminsCfg.test.js    Admins.cfg editor tests
  atomicFile.test.js   Atomic-write + backup rotation tests
  configSh.test.js     config.sh editor tests
  systemctlGuard.test.js  Action/unit-name allowlist tests
  validation.test.js   Steam / EOS / mod ID regex tests
```

## Tests

```bash
npm test
```

Runs the Node built-in test runner against `test/**/*.test.js`. No network, no real `systemctl` — the guard layer and file editors are covered in isolation.
