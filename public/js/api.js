export class ApiError extends Error { constructor(message, code = 'SERVER_ERROR', status = 0) { super(message); this.code = code; this.status = status; } }
export async function request(path, options = {}) {
  if (!navigator.onLine) throw new ApiError('You are offline.', 'OFFLINE');
  const csrf=document.cookie.split('; ').find(x=>x.startsWith('sairs_csrf='))?.split('=').slice(1).join('=');
  let response;try{response=await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json',...(options.method&&options.method!=='GET'&&csrf?{'X-CSRF-Token':decodeURIComponent(csrf)}:{}), ...(options.headers || {}) }, ...options });}catch{throw new ApiError('SAIRS server is currently unreachable.','NETWORK_ERROR');}
  let body; try { body = await response.json(); } catch { body = { success: false, message: 'Invalid server response.' }; }
  if (!response.ok || !body.success) throw new ApiError(body.message || 'Request failed.', body.code || 'SERVER_ERROR', response.status);
  return body.data ?? body;
}
export function connectionState(browserOnline,healthReachable){return!browserOnline?'OFFLINE':healthReachable?'ONLINE':'UNAVAILABLE';}
export async function checkReachability(){if(!navigator.onLine)return connectionState(false,false);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch('/health',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal});if(!response.ok)return connectionState(true,false);const body=await response.json();return connectionState(true,body?.status==='healthy'&&body?.database==='connected');}catch{return connectionState(true,false);}finally{clearTimeout(timer);}}
export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  session: () => request('/api/auth/session'), changePassword: (currentPassword, newPassword) => request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }), logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
  snapshot: () => request('/api/sync/snapshot'), push: operations => request('/api/sync/push', { method: 'POST', body: JSON.stringify({ operations }) }),
  get: path => request(path), post: (path, payload) => request(path, { method: 'POST', body: JSON.stringify(payload || {}) })
};
