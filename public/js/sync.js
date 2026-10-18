import { api,checkReachability } from './api.js'; import { all, get, put, remove } from './db.js'; import { encrypt, decrypt, isUnlocked } from './offline-auth.js';import{recoverOperation,batchOperations,summarize}from'./sync-core.js';
const listeners = new Set(); let syncing = false; let timer,reachability='CHECKING',lastProbe=0,onlineHandler,focusHandler,visibilityHandler;
function notify(state) { listeners.forEach(fn => fn(state)); }
export function onSyncState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function saveSnapshot(pack,markSynced=true) { if (!isUnlocked()) return; const now=new Date().toISOString();pack.offlinePackVersion=pack.offlinePackVersion||3;if(markSynced){pack.lastSyncedAt=now;await put('syncState', { id: 'last-sync', at: now });}await put('settings', { id: 'authorized-pack', encrypted: await encrypt(pack), savedAt: now }); }
export async function readSnapshot() { const row = await get('settings', 'authorized-pack'); return row?.encrypted ? decrypt(row.encrypted) : null; }
export async function queueOperation({ entityType, action, payload, baseUpdatedAt = '' }) {
  if (!isUnlocked()) throw new Error('Enable Offline Access before saving offline changes.');
  if(action==='teacherWorkspace.save'){
    const existing=(await operations()).find(op=>op.action===action&&['PENDING','FAILED'].includes(op.status)&&op.payload?.assignmentId===payload?.assignmentId&&op.payload?.sessionId===payload?.sessionId&&op.payload?.termId===payload?.termId);
    if(existing){existing.payload=payload;existing.status='PENDING';existing.retryCount=0;existing.lastError='';existing.updatedAt=new Date().toISOString();await put('outbox',{id:existing.operationId,encrypted:await encrypt(existing)});notify(await status());return existing;}
  }
  const operation = { operationId: crypto.randomUUID(), entityType, action, payload, createdAt: new Date().toISOString(), baseUpdatedAt, status: 'PENDING', retryCount: 0, lastError: '' };
  await put('outbox', { id: operation.operationId, encrypted: await encrypt(operation) }); notify(await status()); return operation;
}
async function operations() { const rows=await all('outbox'),result=[];for(const row of rows){try{let op=await decrypt(row.encrypted),recovered=recoverOperation(op);if(recovered!==op)await put('outbox',{id:recovered.operationId,encrypted:await encrypt(recovered)});result.push(recovered);}catch{}}return result; }
export async function outbox() { return isUnlocked() ? operations() : []; }
export async function probe(force=false){if(force||Date.now()-lastProbe>30000){reachability=await checkReachability();lastProbe=Date.now();}return reachability;}
export async function status() { const ops = isUnlocked() ? await operations() : [],counts=summarize(ops),sync=await get('syncState','last-sync');if(!navigator.onLine)reachability='OFFLINE';else if(reachability==='OFFLINE')reachability='CHECKING';return {online:reachability==='ONLINE',connection:reachability,syncing, syncingCount:counts.syncing,pending:counts.pending,failed:counts.failed,conflicts:counts.conflicts,lastSync:sync?.at||''}; }
export async function refreshSnapshot() { if (!isUnlocked()||await probe(true)!=='ONLINE') return null; const pack = await api.snapshot(); await saveSnapshot(pack); return pack; }
export async function syncNow() {
  if (syncing || !isUnlocked()||await probe(true)!=='ONLINE') return status(); syncing = true; notify(await status());
  let pending=[];
  try {
    pending = batchOperations(await operations(),50);
    if (pending.length) {
      for(const x of pending){x.status='SYNCING';x.syncStartedAt=new Date().toISOString();x.updatedAt=x.syncStartedAt;await put('outbox',{id:x.operationId,encrypted:await encrypt(x)});}
      const response = await api.push(pending);
      for (const outcome of response.results || []) {
        const source = pending.find(x => x.operationId === outcome.operationId); if (!source) continue;
        if (outcome.status === 'SYNCED') await remove('outbox', source.operationId);
        else { source.status = outcome.status === 'CONFLICT' ? 'CONFLICT' : 'FAILED'; source.retryCount += 1; source.lastError = outcome.message || ''; if (outcome.current) source.serverVersion = outcome.current; await put('outbox', { id: source.operationId, encrypted: await encrypt(source) }); }
      }
      for(const source of pending){if(await get('outbox',source.operationId)){const current=(await operations()).find(x=>x.operationId===source.operationId);if(current?.status==='SYNCING'){current.status='FAILED';current.retryCount+=1;current.lastError='The server did not return an outcome for this operation.';await put('outbox',{id:current.operationId,encrypted:await encrypt(current)});}}}
    }
    await refreshSnapshot();
  } catch(error){for(const source of pending){const row=await get('outbox',source.operationId);if(!row)continue;const current=await decrypt(row.encrypted);if(current.status==='SYNCING'){current.status='FAILED';current.retryCount+=1;current.lastError=error?.code==='NETWORK_ERROR'?'SAIRS server was unreachable.':'Synchronization was interrupted.';current.updatedAt=new Date().toISOString();await put('outbox',{id:current.operationId,encrypted:await encrypt(current)});}}throw error;
  } finally { syncing = false; notify(await status()); }
  return status();
}
export async function resolveConflict(operationId, resolution) { const row = await get('outbox', operationId); if (!row) return; const op = await decrypt(row.encrypted); if (resolution === 'SERVER') return remove('outbox', operationId); await remove('outbox', operationId); op.operationId = crypto.randomUUID(); op.status = 'PENDING'; op.baseUpdatedAt = op.serverVersion?.UpdatedAt || ''; op.lastError = ''; await put('outbox', { id: op.operationId, encrypted: await encrypt(op) }); }
export async function retryFailed(){for(const op of(await operations()).filter(x=>x.status==='FAILED')){op.status='PENDING';op.lastError='';op.updatedAt=new Date().toISOString();await put('outbox',{id:op.operationId,encrypted:await encrypt(op)});}return syncNow();}
export function startAutomaticSync() { stopAutomaticSync();const attempt=async(force=false)=>{if(document.visibilityState!=='visible')return;await probe(force);notify(await status());if(reachability==='ONLINE'&&isUnlocked())await syncNow();};onlineHandler=()=>attempt(true).catch(()=>{});focusHandler=()=>attempt(false).catch(()=>{});visibilityHandler=()=>attempt(false).catch(()=>{});addEventListener('online',onlineHandler);addEventListener('focus',focusHandler);document.addEventListener('visibilitychange',visibilityHandler);timer=setInterval(focusHandler,5*60*1000);attempt(true).catch(()=>{}); }
export function stopAutomaticSync() { clearInterval(timer);if(onlineHandler)removeEventListener('online',onlineHandler);if(focusHandler)removeEventListener('focus',focusHandler);if(visibilityHandler)document.removeEventListener('visibilitychange',visibilityHandler);onlineHandler=focusHandler=visibilityHandler=null; }
