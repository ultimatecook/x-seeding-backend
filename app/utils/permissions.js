export const ROLE_ORDER = {
  Viewer: 0,
  Editor: 1,
  Admin: 2,
  Owner: 3,
};

export function hasRole(role, minimumRole) {
  return ROLE_ORDER[role] >= ROLE_ORDER[minimumRole];
}

export function can(role, action) {
  const matrix = {
    manageMembers: ['Owner', 'Admin'],
    writeOperational: ['Owner', 'Admin', 'Editor'],
    readOperational: ['Owner', 'Admin', 'Editor', 'Viewer'],
  };

  return matrix[action]?.includes(role) || false;
}
