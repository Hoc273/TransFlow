/**
 * Static RBAC matrix (09b A.5.3 / Q-RBAC1 / 06b §2.3).
 * UI-only — BE is the security boundary.
 */
export type Role =
  | 'ADMIN'
  | 'PM'
  | 'TRANSLATOR'
  | 'PROOFREADER'
  | 'CLIENT'
  | 'LEAD'
  | 'MEMBER'

export type PermissionAction =
  | 'workspace.manage_members'
  | 'workspace.manage_providers'
  | 'project.create'
  | 'project.manage'
  | 'document.upload'
  | 'batch.create'
  | 'batch.retry'
  | 'batch.download'
  | 'job.start'
  | 'segment.edit'
  | 'segment.approve'
  | 'qa.apply'
  | 'qa.resolve'
  | 'qa.override'
  | 'glossary.crud'
  | 'tm.crud'
  | 'dashboard.usage'
  | 'workspace.view'

const ALL_ROLES: Role[] = ['ADMIN', 'PM', 'TRANSLATOR', 'PROOFREADER', 'CLIENT', 'LEAD', 'MEMBER']
const ADMIN_PM: Role[] = ['ADMIN', 'PM', 'LEAD']
const ADMIN_PM_TRANSLATOR: Role[] = ['ADMIN', 'PM', 'TRANSLATOR', 'LEAD', 'MEMBER']
const ADMIN_PM_PROOFREADER: Role[] = ['ADMIN', 'PM', 'PROOFREADER', 'LEAD', 'MEMBER']

const MATRIX: Record<PermissionAction, Role[]> = {
  'workspace.view': ALL_ROLES,
  'workspace.manage_members': ['ADMIN', 'LEAD'],
  'workspace.manage_providers': ['ADMIN', 'LEAD'],
  'project.create': ADMIN_PM,
  'project.manage': ADMIN_PM,
  'document.upload': ADMIN_PM_TRANSLATOR,
  'batch.create': ADMIN_PM_TRANSLATOR,
  'batch.retry': ADMIN_PM_TRANSLATOR,
  'batch.download': ADMIN_PM_TRANSLATOR,
  'job.start': ADMIN_PM_TRANSLATOR,
  'segment.edit': ['ADMIN', 'PM', 'TRANSLATOR', 'PROOFREADER', 'LEAD', 'MEMBER'],
  'segment.approve': ADMIN_PM_PROOFREADER,
  'qa.apply': ADMIN_PM_PROOFREADER,
  'qa.resolve': ADMIN_PM_PROOFREADER,
  'qa.override': ['ADMIN', 'PM', 'LEAD'],
  'glossary.crud': ['ADMIN', 'PM', 'LEAD'],
  'tm.crud': ['ADMIN', 'PM', 'LEAD'],
  'dashboard.usage': ['ADMIN', 'PM', 'LEAD'],
}

export function can(role: Role | null | undefined, action: PermissionAction): boolean {
  if (!role) return false
  return MATRIX[action]?.includes(role) ?? false
}

export function isRole(value: unknown): value is Role {
  return (
    value === 'ADMIN' ||
    value === 'PM' ||
    value === 'TRANSLATOR' ||
    value === 'PROOFREADER' ||
    value === 'CLIENT' ||
    value === 'LEAD' ||
    value === 'MEMBER'
  )
}
