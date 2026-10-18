import { api } from './api.js'; import { hasOfflineAccess, unlockOffline, lockOffline, removeOfflineWorkspace } from './offline-auth.js';
export const auth = {
  user: null, offline: false,
  async restore() { try { const session = await api.session(); this.user = session.user; this.offline = false; return session; } catch { return null; } },
  async login(email, password) { const result = await api.login(email, password); this.user = result.user; this.offline = false; return result; },
  async changePassword(currentPassword, newPassword) { const result = await api.changePassword(currentPassword, newPassword); this.user = result.user; return result; },
  async canUnlock() { return hasOfflineAccess(); },
  async unlock(pin) { await unlockOffline(pin); this.offline = true; this.user = { role: 'OFFLINE' }; return true; },
  lock(){lockOffline();this.offline=false;},
  async logout() { try { if (navigator.onLine) await api.logout(); } finally { lockOffline(); await removeOfflineWorkspace(); this.user = null; this.offline = false; } }
};
