const routes = new Map(); let current = '';
export function register(name, loader) { routes.set(name, loader); }
export async function navigate(name, context) { if (!routes.has(name)) name = 'dashboard'; current = name; history.replaceState({}, '', `#/${name}`); document.querySelectorAll('[data-route]').forEach(x => x.classList.toggle('active', x.dataset.route === name)); return routes.get(name)(context); }
export function initialRoute() { return location.hash.replace(/^#\//, '') || 'dashboard'; }
export function currentRoute() { return current; }
