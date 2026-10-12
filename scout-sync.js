/* Sodville Scout shared sync. Load AFTER the existing Scout inline script.
   Existing localStorage remains the offline source; this module never clears it. */
(() => {
  'use strict';
  const API = 'https://sodville-command-api.onrender.com/api/scout/sync';
  const LEDGER_KEY = 'sodvilleScoutSyncLedgerV1';
  const KINDS = ['users', 'sessions', 'tasks', 'observations', 'geoMarks'];
  const $ = id => document.getElementById(id);
  let ledger;
  try { ledger = JSON.parse(localStorage.getItem(LEDGER_KEY) || '{}'); }
  catch { ledger = {}; }
  for (const k of KINDS) ledger[k] ||= {};
  let working = false, scheduled = null;

  function snapshot(obj) { return JSON.stringify(obj); }
  function records(kind) {
    return Array.isArray(db[kind]) ? db[kind] : (db[kind] = []);
  }
  function storeLedger() { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); }
  function status(message) {
    let el = $('sodvilleSyncStatus');
    if (!el) {
      el = document.createElement('small');
      el.id = 'sodvilleSyncStatus';
      el.style.cssText = 'display:block;padding:3px 10px;font-size:11px;color:#31583a';
      (document.querySelector('header') || document.body).appendChild(el);
    }
    el.textContent = message;
  }
  function localChanges() {
    const changes = [];
    for (const kind of KINDS) {
      const items = records(kind);
      const existing = new Set();
      for (const item of items) {
        if (!item || typeof item.id !== 'string' || !item.id) continue;
        existing.add(item.id);
        const signature = snapshot(item);
        if (ledger[kind][item.id] !== signature) {
          changes.push({ kind, id: item.id, data: item, deleted: false });
        }
      }
      // Deleted records use tombstones. Do not delete employee sessions.
      if (kind !== 'sessions' && kind !== 'users') {
        for (const id of Object.keys(ledger[kind])) {
          if (!existing.has(id) && ledger[kind][id] !== null) {
            changes.push({ kind, id, data: { id }, deleted: true });
          }
        }
      }
    }
    return changes;
  }
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options, cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (!response.ok) throw new Error('Sync HTTP ' + response.status);
    return response.json();
  }
  function mergeRemote(remote, dirtyKeys) {
    let changed = false;
    for (const r of remote) {
      if (!KINDS.includes(r.kind) || typeof r.id !== 'string') continue;
      const key = r.kind + ':' + r.id;
      if (dirtyKeys.has(key)) continue;
      const items = records(r.kind);
      const idx = items.findIndex(x => x && x.id === r.id);
      if (r.deleted) {
        if (idx >= 0) { items.splice(idx, 1); changed = true; }
        ledger[r.kind][r.id] = null;
      } else if (r.data && r.data.id === r.id) {
        const sig = snapshot(r.data);
        if (idx < 0) { items.push(r.data); changed = true; }
        else if (snapshot(items[idx]) !== sig) { items[idx] = r.data; changed = true; }
        ledger[r.kind][r.id] = sig;
      }
    }
    if (changed) {
      // Bypass save() hook to avoid generating a false local edit.
      localStorage.setItem('sodvilleScoutV1', JSON.stringify(db));
      if (typeof renderUsers === 'function') renderUsers();
      if (typeof refresh === 'function') refresh();
      if (typeof renderGeoMarks === 'function') renderGeoMarks();
      if (typeof refreshMapPinCount === 'function') refreshMapPinCount();
    }
    storeLedger();
  }
  async function sync() {
    if (working || !navigator.onLine) { if (!navigator.onLine) status('Scout: saved offline'); return; }
    working = true;
    status('Scout: synchronizing…');
    try {
      const changes = localChanges();
      // Send changes before reading server data, preserving edits made offline.
      for (let i = 0; i < changes.length; i += 50) {
        const batch = changes.slice(i, i + 50);
        await request(API, { method: 'POST', body: JSON.stringify({ records: batch }) });
        for (const item of batch) ledger[item.kind][item.id] = item.deleted ? null : snapshot(item.data);
        storeLedger();
      }
      const selected = db.currentUserId || '';
      const response = await request(API + '?userId=' + encodeURIComponent(selected));
      // If someone edited a record while the network request ran, keep their local edit.
      const dirtyNow = new Set(localChanges().map(x => x.kind + ':' + x.id));
      mergeRemote(response.records || [], dirtyNow);
      status('Scout: synced ' + new Date().toLocaleTimeString());
    } catch (error) {
      console.warn('Sodville Scout sync:', error);
      status('Scout: saved locally; sync will retry');
    } finally {
      working = false;
      if (localChanges().length) schedule();
    }
  }
  function schedule() {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => { scheduled = null; sync(); }, 1200);
  }
  window.sodvilleSyncChanged = schedule;
  window.sodvilleSyncNow = sync;
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  // Dropdown selection is not necessarily saved through save() on all builds.
  $('scoutSelect')?.addEventListener('change', () => setTimeout(sync, 100));
  setInterval(sync, 60000);
  setTimeout(sync, 1500);
})();
