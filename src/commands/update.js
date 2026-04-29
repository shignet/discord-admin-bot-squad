// src/commands/update.js
// /update master|instance|all_instances
//
// Rebuilds Squad server instances from the master. Never stops or starts any
// systemd service — that is left to the admin via /server restart.
//
// Permission: SENIOR_ADMIN only (all subcommands).

import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import { startInstanceUpdate, startMasterUpdate, spawnLogFollow } from '../lib/gameupdate.js';
import { runSystemctl } from '../lib/systemctl.js';
import { respondViaAudit, COLOR } from '../lib/audit.js';
import { ROLE } from '../lib/permissions.js';
import { config } from '../config.js';

// How often we edit the Discord message with fresh log output.
const LOG_EDIT_INTERVAL_MS = 4_000;
// Number of log lines shown in the live preview.
const LIVE_LINES = 12;
// Max chars in a log snippet (Discord message limit headroom).
const MAX_SNIPPET_CHARS = 1_400;
// Confirmation timeout for all_instances.
const CONFIRM_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

const instanceChoices = config.squadInstances.map((i) => ({ name: i, value: i }));

export const data = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Rebuild Squad server instances. Does NOT stop or restart any service.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('master')
      .setDescription('Download the latest version from Steam via SteamCMD. No service is restarted.'),
  )
  .addSubcommand((s) =>
    s
      .setName('instance')
      .setDescription('Rebuild one instance from the master copy. No service is stopped or started.')
      .addStringOption((o) =>
        o
          .setName('target')
          .setDescription('Which instance to rebuild.')
          .setRequired(true)
          .addChoices(...instanceChoices),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('all_instances')
      .setDescription('Rebuild every instance sequentially. No services are stopped or started.'),
  );

// All subcommands require SENIOR_ADMIN.
export const requiredRoles = [ROLE.SENIOR_ADMIN];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function execute(interaction, { logger }) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'master') return executeMaster(interaction, logger);
  if (sub === 'instance') return executeInstance(interaction, logger);
  if (sub === 'all_instances') return executeAllInstances(interaction, logger);
}

// ---------------------------------------------------------------------------
// /update master
// ---------------------------------------------------------------------------

async function executeMaster(interaction, logger) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply('⏳ Starting SteamCMD update of master instance…');

  const { result, logLines } = await runWithLiveLogs(
    () => startMasterUpdate(),
    'squad-gameupdate-master.service',
    'master',
    interaction,
  );

  logger.info({ ok: result.ok, code: result.code }, '/update master finished');

  await respondViaAudit(interaction, buildUpdateEmbed('/update master', 'master', result, logLines, null));
}

// ---------------------------------------------------------------------------
// /update instance
// ---------------------------------------------------------------------------

async function executeInstance(interaction, logger) {
  const target = interaction.options.getString('target', true);

  // Backend allowlist — Discord choices are a UI hint, never trusted.
  if (!config.squadInstances.includes(target)) {
    await interaction.reply({
      content: `Instance \`${target}\` is not in the configured allowlist.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Warn if the corresponding server service is still running.
  const runningService = `squad-${target}.service`;
  const isRunning = await checkServiceActive(runningService);
  if (isRunning) {
    await interaction.editReply(
      `⚠️ **${target}** is currently running.\n` +
        'Files will be rebuilt on disk, but the running server is unaffected until you manually restart it.\n' +
        `Use \`/server restart\` → \`${runningService}\` when ready.\n\n` +
        `⏳ Rebuilding \`${target}\`…`,
    );
    await sleep(2_500);
  } else {
    await interaction.editReply(`⏳ Rebuilding \`${target}\`…`);
  }

  const serviceUnit = `squad-gameupdate@${target}.service`;

  const { result, logLines } = await runWithLiveLogs(
    () => startInstanceUpdate(target, config.squadInstances),
    serviceUnit,
    target,
    interaction,
  );

  logger.info({ target, ok: result.ok, code: result.code }, '/update instance finished');

  await respondViaAudit(
    interaction,
    buildUpdateEmbed(`/update instance — ${target}`, target, result, logLines, runningService),
  );
}

// ---------------------------------------------------------------------------
// /update all_instances
// ---------------------------------------------------------------------------

async function executeAllInstances(interaction, logger) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const confirmed = await confirmAllInstances(interaction);
  if (!confirmed) return;

  const total = config.squadInstances.length;
  const results = [];

  for (const [idx, instance] of config.squadInstances.entries()) {
    const n = `${idx + 1}/${total}`;

    const progressHeader = results.map(formatSummaryLine).join('\n');
    await interaction.editReply(
      (progressHeader ? progressHeader + '\n' : '') +
        `⏳ **[${n}]** Rebuilding \`${instance}\`…`,
    );

    const serviceUnit = `squad-gameupdate@${instance}.service`;

    const { result, logLines } = await runWithLiveLogs(
      () => startInstanceUpdate(instance, config.squadInstances),
      serviceUnit,
      `${instance} [${n}]`,
      interaction,
    );

    logger.info({ instance, ok: result.ok, code: result.code }, '/update all_instances — instance done');
    results.push({ instance, result, logLines });

    // Brief status between instances
    await interaction.editReply(results.map(formatSummaryLine).join('\n') + '\n⏳ Continuing…');
    await sleep(1_000);
  }

  const allOk = results.every((r) => r.result.ok);
  const summary = results.map(formatSummaryLine).join('\n');
  const embed = new EmbedBuilder()
    .setColor(allOk ? COLOR.success : COLOR.failure)
    .setTitle(allOk ? '✅ /update all_instances — all rebuilt' : '⚠️ /update all_instances — some failed')
    .setDescription(summary);
  if (allOk) {
    embed.addFields({
      name: '💡 Next step',
      value: 'Use `/server restart` for each instance when you are ready to apply the update.',
    });
  }
  await respondViaAudit(interaction, embed);
}

// ---------------------------------------------------------------------------
// Core: run update + stream logs to Discord
// ---------------------------------------------------------------------------

/**
 * Runs updateFn() while concurrently following journalctl and editing the
 * interaction message every LOG_EDIT_INTERVAL_MS milliseconds.
 *
 * @param {() => Promise<{ok, code, stdout, stderr}>} updateFn
 * @param {string} serviceUnit  Full unit name, e.g. squad-gameupdate@public.service
 * @param {string} label        Human-readable label shown in the live preview
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {{ result, logLines: string[] }}
 */
async function runWithLiveLogs(updateFn, serviceUnit, label, interaction) {
  const logLines = [];

  // Spawn journalctl -f *before* starting the service so we don't miss early lines.
  const logProc = spawnLogFollow(serviceUnit);

  logProc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter((l) => l.trim());
    logLines.push(...lines);
  });
  logProc.stderr.on('data', (chunk) => {
    // journalctl sometimes writes connection messages to stderr — include them for debugging.
    const lines = chunk.toString().split('\n').filter((l) => l.trim());
    logLines.push(...lines.map((l) => `[journal] ${l}`));
  });

  const startedAt = Date.now();

  // Periodically edit the Discord message with the latest log tail.
  const editInterval = setInterval(async () => {
    const elapsed = Math.round((Date.now() - startedAt) / 1_000);
    const snippet = truncate(logLines.slice(-LIVE_LINES).join('\n'), MAX_SNIPPET_CHARS) || '(waiting for output…)';
    await interaction
      .editReply(`⏳ **${label}** — ${elapsed}s elapsed\n\`\`\`\n${snippet}\n\`\`\``)
      .catch(() => {}); // Silently ignore expired-token errors
  }, LOG_EDIT_INTERVAL_MS);

  let result;
  try {
    // startInstanceUpdate / startMasterUpdate each call systemctl start --wait,
    // which blocks until the oneshot exits.  Node's event loop is unblocked.
    result = await updateFn();
  } finally {
    clearInterval(editInterval);
    logProc.kill('SIGTERM');
    // Small pause so journalctl can flush any last lines before we read logLines.
    await sleep(600);
  }

  return { result, logLines };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUpdateEmbed(title, label, result, logLines, restartService) {
  const ok = result.ok;
  const embed = new EmbedBuilder()
    .setColor(ok ? COLOR.success : COLOR.failure)
    .setTitle(`${ok ? '✅' : '❌'} ${title}`)
    .setDescription(
      ok
        ? `\`${label}\` rebuilt successfully.`
        : `\`${label}\` failed (exit ${result.code}).`,
    );

  const lastLines = logLines.slice(-15).join('\n');
  if (lastLines) {
    embed.addFields({ name: 'Recent log', value: '```\n' + truncate(lastLines, 1_000) + '\n```' });
  }

  if (ok && restartService) {
    embed.addFields({
      name: '💡 Next step',
      value: `Use \`/server restart\` → \`${restartService}\` when you are ready to apply the update.`,
    });
  }
  return embed;
}

function formatSummaryLine({ instance, result }) {
  return result.ok ? `✅ \`${instance}\`` : `❌ \`${instance}\` (exit ${result.code})`;
}

async function confirmAllInstances(interaction) {
  const confirmId = `update:all:confirm:${interaction.id}`;
  const cancelId = `update:all:cancel:${interaction.id}`;
  const instances = config.squadInstances.join(', ');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel('Yes, rebuild all')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const msg = await interaction.editReply({
    content:
      `⚙️ Rebuild all instances: \`${instances}\`?\n` +
      '**No services will be stopped or started.** Use `/server restart` when ready.\n' +
      `Confirm within ${CONFIRM_TIMEOUT_MS / 1_000}s.`,
    components: [row],
  });

  try {
    const btn = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) =>
        i.user.id === interaction.user.id &&
        (i.customId === confirmId || i.customId === cancelId),
      time: CONFIRM_TIMEOUT_MS,
    });

    if (btn.customId === cancelId) {
      await btn.update({ content: '❌ Update cancelled.', components: [] });
      return false;
    }

    await btn.update({ content: '⏳ Starting rebuild of all instances…', components: [] });
    return true;
  } catch {
    await interaction.editReply({
      content: '⏱️ Confirmation timed out. Update not started.',
      components: [],
    });
    return false;
  }
}

/**
 * Checks whether a Squad server service is currently active.
 * Uses the existing runSystemctl wrapper (it's already whitelisted in sudoers).
 */
async function checkServiceActive(serviceName) {
  try {
    if (!config.squadServices.includes(serviceName)) return false;
    const res = await runSystemctl('is-active', serviceName);
    return res.stdout.trim() === 'active';
  } catch {
    return false;
  }
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}…` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
