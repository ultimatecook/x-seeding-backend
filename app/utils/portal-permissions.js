/**
 * Portal permission helpers.
 * Role hierarchy: Owner > Editor > Viewer
 */

export const ROLE_RANK = { Viewer: 0, Editor: 1, Owner: 2 };

function atLeast(role, required) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[required] ?? 99);
}

export const can = {
  // Seedings
  viewSeedings:    (role) => atLeast(role, 'Viewer'),
  createSeeding:   (role) => atLeast(role, 'Editor'),
  updateSeeding:   (role) => atLeast(role, 'Editor'),  // status, tracking
  deleteSeeding:   (role) => atLeast(role, 'Editor'),

  // Influencers
  viewInfluencers:   (role) => atLeast(role, 'Viewer'),
  createInfluencer:  (role) => atLeast(role, 'Editor'),
  editInfluencer:    (role) => atLeast(role, 'Editor'),
  deleteInfluencer:  (role) => atLeast(role, 'Editor'),

  // Campaigns
  viewCampaigns:   (role) => atLeast(role, 'Viewer'),
  createCampaign:  (role) => atLeast(role, 'Editor'),
  editCampaign:    (role) => atLeast(role, 'Editor'),
  deleteCampaign:  (role) => atLeast(role, 'Editor'),

  // Settings / team management
  viewSettings:    (role) => atLeast(role, 'Owner'),
  manageUsers:     (role) => atLeast(role, 'Owner'),

  // Audit log
  viewAuditLog:    (role) => atLeast(role, 'Owner'),
};

/**
 * Throws a 403 Response if the user doesn't have the required permission.
 * Use in loaders/actions.
 */
export function requirePermission(role, permission) {
  if (!can[permission]?.(role)) {
    throw new Response('Forbidden', { status: 403 });
  }
}
