import { config } from '../config.js';

export const ROLE = Object.freeze({
  SENIOR_ADMIN: config.roles.seniorAdminIds,
  ADMIN: config.roles.adminIds,
});

export function hasRequiredRole(interaction, requiredRoleIds) {
  if (!interaction.inCachedGuild()) return false;
  const memberRoles = interaction.member.roles.cache;
  const flat = requiredRoleIds.flat();
  return flat.some((roleId) => memberRoles.has(roleId));
}
