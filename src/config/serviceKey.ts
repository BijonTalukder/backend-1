// Duplicated in `D:\larning flutter\backend\src\config\hisabboiServiceAccount.ts` —
// no shared package between the repos. Rotating requires editing both.
export const ADMIN_PANEL_SERVICE_KEY = 'hisabboi-admin-panel-internal-2026';
export const ADMIN_PANEL_SERVICE_KEY_HEADER = 'x-internal-service-key';

export const ADMIN_PANEL_SERVICE_IDENTITY = {
  id: '000000000000000000000001',
  email: 'service@admin-panel.internal',
  role: 'super_admin' as const,
};
