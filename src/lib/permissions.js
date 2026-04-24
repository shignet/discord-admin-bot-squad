import { config } from '../config.js';

export const ROLE = Object.freeze({
  SENIOR_ADMIN: config.roles.seniorAdminId,
  ADMIN: config.roles.adminId,
});

export function hasRequiredRole(interaction, requiredRoleIds) {
  if (!interaction.inCachedGuild()) return false;
  const memberRoles = interaction.member.roles.cache;
  return requiredRoleIds.some((roleId) => memberRoles.has(roleId));
}
