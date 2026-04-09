import { describe, expect, it } from 'vitest';
import { can, hasRole } from '../../app/utils/permissions';

describe('authz matrix', () => {
  it('evalua jerarquia de roles correctamente', () => {
    expect(hasRole('Owner', 'Admin')).toBe(true);
    expect(hasRole('Editor', 'Viewer')).toBe(true);
    expect(hasRole('Viewer', 'Editor')).toBe(false);
  });

  it('aplica permisos por accion', () => {
    expect(can('Admin', 'manageMembers')).toBe(true);
    expect(can('Editor', 'manageMembers')).toBe(false);
    expect(can('Viewer', 'readOperational')).toBe(true);
    expect(can('Viewer', 'writeOperational')).toBe(false);
  });
});
