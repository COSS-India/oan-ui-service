export const environment = {
  // API base URL. Env-overridable (VITE_API_BASE_URL) so the UI can target a
  // local/sandbox/prod backend without a rebuild. Falls back to the MahaPocra prod URL.
  apiUrl: import.meta.env.VITE_API_BASE_URL || 'https://prodaskvistaar.mahapocra.gov.in',
  // Maintenance mode toggle, driven by VITE_MAINTENANCE_MODE=true (see .env.example).
  maintenanceMode: import.meta.env.VITE_MAINTENANCE_MODE === 'true',
  guestUserLimit: 10,
};
