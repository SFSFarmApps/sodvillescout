/* Sodville Scout shared sync. Load AFTER the existing Scout inline script.
   Existing localStorage remains the offline source; this module never clears it. */
(() => {
  'use strict';
  const API = 'https://sodville-command-api.onrender.com/api/scout/sync';
  const LEDGER_KEY = 'sodvilleScoutSyncLedgerV1';
  const KINDS = ['users', 'sessions', 'tasks', 'observations', 'geoMarks', 'laborLogs'];
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
      el.style.cssText = 'display:block;padding:3px 10px;font-size:11px;color:#f0f8ed';
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
      if (kind !== 'sessions' && kind !== 'users' && kind !== 'laborLogs') {
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

  // Editable scouting time records. This augments the existing timer without
  // replacing the original Start / End Scouting Day workflow.
  function installTimeEditor() {
    const timer = $('sessionBtn');
    if (!timer || $('editScoutTimeBtn')) return;
    const editBtn = document.createElement('button');
    editBtn.id = 'editScoutTimeBtn';
    editBtn.type = 'button';
    editBtn.textContent = 'Edit Scouting Time';
    editBtn.style.cssText = 'font-size:12px;padding:9px 10px;min-height:40px;background:#f2f6ee;color:#173b25;border:1px solid #b4c6b8;border-radius:8px;cursor:pointer';
    timer.insertAdjacentElement('afterend', editBtn);

    const overlay = document.createElement('div');
    overlay.id = 'scoutTimeEditor';
    overlay.hidden = true;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);padding:16px;overflow:auto;display:none;align-items:flex-start;justify-content:center';
    overlay.innerHTML = `
      <section role="dialog" aria-modal="true" aria-label="Edit scouting time" style="background:white;color:#173b25;border-radius:12px;padding:20px;max-width:440px;width:100%;margin:7vh auto;box-shadow:0 8px 35px #0004">
        <h2 style="margin:0 0 8px;font-size:20px">Edit Scouting Time</h2>
        <p style="font-size:13px;margin:0 0 14px">Correct a missed clock-out or an incorrect start/end time. Changes are saved and synchronized.</p>
        <label style="display:block;margin-bottom:12px">Scouting session
          <select id="scoutTimeSessionSelect" style="display:block;width:100%;padding:10px;margin-top:5px"></select>
        </label>
        <label style="display:block;margin-bottom:12px">Start date and time
          <input id="scoutTimeStartInput" type="datetime-local" step="60" style="display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:5px">
        </label>
        <label style="display:block;margin-bottom:12px">End date and time
          <input id="scoutTimeEndInput" type="datetime-local" step="60" style="display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:5px">
        </label>
        <p id="scoutTimeEditorHelp" style="font-size:12px;color:#596c5d">For a session still running, enter the time you actually stopped working.</p>
        <p id="scoutTimeEditorError" role="alert" style="font-size:13px;color:#a32020;min-height:1em"></p>
        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
          <button id="scoutTimeCancel" type="button" style="padding:11px 14px">Cancel</button>
          <button id="scoutTimeSave" type="button" style="padding:11px 14px;background:#173b25;color:white;border-radius:7px">Save corrected time</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    const select = $('scoutTimeSessionSelect');
    const startInput = $('scoutTimeStartInput');
    const endInput = $('scoutTimeEndInput');
    const error = $('scoutTimeEditorError');
    const asLocal = value => {
      if (!value) return '';
      const d = new Date(value);
      if (!Number.isFinite(d.getTime())) return '';
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    };
    const display = value => new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
    const currentSessions = () => {
      const id = db.currentUserId || (typeof currentUser === 'function' ? currentUser()?.id : '');
      return (db.sessions || []).filter(s => s && (s.userId === id || (!s.userId && id === 'default-andrew')))
        .sort((a,b) => new Date(b.start) - new Date(a.start));
    };
    const populate = () => {
      const sessions = currentSessions();
      select.replaceChildren();
      for (const session of sessions) {
        const option = document.createElement('option');
        option.value = session.id;
        option.textContent = display(session.start) + (session.end ? ' — ' + display(session.end) : ' — STILL RUNNING');
        select.appendChild(option);
      }
      const hasSessions = sessions.length > 0;
      $('scoutTimeSave').disabled = !hasSessions;
      if (!hasSessions) {
        const option = document.createElement('option');
        option.textContent = 'No sessions for this scout';
        select.appendChild(option);
      }
      loadSelected();
    };
    const loadSelected = () => {
      const session = (db.sessions || []).find(s => s.id === select.value);
      startInput.value = session ? asLocal(session.start) : '';
      endInput.value = session ? asLocal(session.end) : '';
      $('scoutTimeEditorHelp').textContent = session && !session.end
        ? 'This session is still running. Enter the time you actually finished to clock out retroactively.'
        : 'You can correct either time. Both are required to save.';
      error.textContent = '';
    };
    editBtn.addEventListener('click', () => {
      populate();
      overlay.hidden = false;
      overlay.style.display = 'flex';
    });
    select.addEventListener('change', loadSelected);
    const close = () => { overlay.hidden = true; overlay.style.display = 'none'; };
    $('scoutTimeCancel').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    $('scoutTimeSave').addEventListener('click', () => {
      const session = (db.sessions || []).find(s => s.id === select.value);
      if (!session) { error.textContent = 'Choose a scouting session.'; return; }
      const start = new Date(startInput.value);
      const end = new Date(endInput.value);
      if (!startInput.value || !endInput.value || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
        error.textContent = 'Enter valid start and end times.'; return;
      }
      if (end <= start) { error.textContent = 'End time must be after start time.'; return; }
      if (end.getTime() > Date.now() + 60000) { error.textContent = 'End time cannot be in the future.'; return; }
      const other = currentSessions().filter(s => s.id !== session.id);
      if (other.some(s => {
        const a = new Date(s.start).getTime();
        const b = s.end ? new Date(s.end).getTime() : Date.now();
        return start.getTime() < b && end.getTime() > a;
      })) { error.textContent = 'These times overlap another scouting session. Check the dates and times.'; return; }
      session.start = start.toISOString();
      session.end = end.toISOString();
      session.timeEditedAt = new Date().toISOString();
      if (typeof save === 'function') save();
      else localStorage.setItem('sodvilleScoutV1', JSON.stringify(db));
      if (typeof refresh === 'function') refresh();
      if (typeof renderDashboard === 'function') renderDashboard();
      close();
      schedule();
    });
  }
  installTimeEditor();


  // Independent bulk task editor: the modal has its own selection checkboxes,
  // so it works even when the legacy task-list selection handler is unavailable.
  function installTaskUrgencyEditor() {
    const complete = $('completeSelectedTasks');
    if (!complete || $('changeTaskUrgencyBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'changeTaskUrgencyBtn';
    btn.type = 'button';
    btn.textContent = 'Urgency';
    btn.disabled = false;
    btn.style.cssText = 'padding:7px 10px;border:1px solid #b4c6b8;border-radius:7px;background:#f2f6ee;color:#173b25;font-weight:700;cursor:pointer';
    complete.insertAdjacentElement('beforebegin', btn);

    const overlay = document.createElement('div');
    overlay.id = 'taskUrgencyEditorOverlay';
    overlay.hidden = true;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.55);padding:12px;overflow:auto;display:none;align-items:flex-start;justify-content:center';
    overlay.innerHTML = `
      <section role="dialog" aria-modal="true" aria-label="Change task urgency" style="background:white;color:#173b25;border-radius:12px;padding:18px;max-width:460px;width:100%;margin:4vh auto;box-shadow:0 8px 35px #0004">
        <h2 style="margin:0 0 8px;font-size:20px">Change Task Urgency</h2>
        <p style="font-size:13px;margin:0 0 10px">Select one or more tasks to update.</p>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-weight:700"><input id="taskUrgencySelectAll" type="checkbox"> Select all outstanding tasks</label>
        <div id="taskUrgencyChoices" style="max-height:40vh;overflow:auto;border:1px solid #d7e2d7;border-radius:8px;padding:6px"></div>
        <p id="taskUrgencyCount" style="font-size:13px;margin:10px 0"></p>
        <label style="display:block;margin:12px 0;font-weight:700">New urgency
          <select id="taskUrgencyValue" style="display:block;width:100%;padding:11px;margin-top:6px">
            <option value="Urgent">Urgent — Red</option>
            <option value="High">High — Yellow</option>
            <option value="Normal" selected>Normal — Green</option>
            <option value="Low">Low</option>
          </select>
        </label>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          <button id="taskUrgencyCancel" type="button" style="padding:11px 14px">Cancel</button>
          <button id="taskUrgencySave" type="button" style="padding:11px 14px;background:#173b25;color:white;border-radius:7px">Save urgency</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const choices = $('taskUrgencyChoices');
    const count = $('taskUrgencyCount');
    const allBox = $('taskUrgencySelectAll');
    const saveBtn = $('taskUrgencySave');
    const selectedInputs = () => Array.from(choices.querySelectorAll('input[data-urgency-task-id]:checked'));
    const updateCount = () => {
      const n = selectedInputs().length;
      count.textContent = n + ' task' + (n === 1 ? '' : 's') + ' selected';
      saveBtn.disabled = n === 0;
      const total = choices.querySelectorAll('input[data-urgency-task-id]').length;
      allBox.checked = total > 0 && n === total;
    };
    const close = () => { overlay.hidden = true; overlay.style.display = 'none'; };
    btn.addEventListener('click', () => {
      const preselected = new Set(Array.from(document.querySelectorAll('.taskSelect:checked'), el => String(el.dataset.taskId)));
      const tasks = (db.tasks || []).filter(t => t && t.id && !['Complete','Completed','Closed'].includes(t.status))
        .sort((a,b) => ({Urgent:0,High:1,Normal:2,Low:3}[a.priority || 'Normal'] ?? 2) - ({Urgent:0,High:1,Normal:2,Low:3}[b.priority || 'Normal'] ?? 2));
      choices.replaceChildren();
      for (const task of tasks) {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid #e9eee9;font-size:14px';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.dataset.urgencyTaskId = String(task.id);
        check.checked = preselected.has(String(task.id));
        check.style.cssText = 'width:20px;height:20px;flex-shrink:0';
        const desc = document.createElement('span');
        desc.textContent = (task.name || 'Unnamed task') + ' — ' + (task.priority || 'Normal');
        label.append(check, desc);
        choices.appendChild(label);
      }
      if (!tasks.length) choices.textContent = 'No outstanding tasks.';
      overlay.hidden = false;
      overlay.style.display = 'flex';
      updateCount();
    });
    choices.addEventListener('change', updateCount);
    allBox.addEventListener('change', () => {
      choices.querySelectorAll('input[data-urgency-task-id]').forEach(x => { x.checked = allBox.checked; });
      updateCount();
    });
    $('taskUrgencyCancel').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    saveBtn.addEventListener('click', () => {
      const priority = $('taskUrgencyValue').value;
      if (!['Urgent','High','Normal','Low'].includes(priority)) return;
      const ids = new Set(selectedInputs().map(x => x.dataset.urgencyTaskId));
      if (!ids.size) return;
      let changed = 0;
      for (const task of db.tasks || []) {
        if (ids.has(String(task.id)) && !['Complete','Completed','Closed'].includes(task.status)) {
          task.priority = priority;
          changed++;
        }
      }
      if (!changed) return;
      if (typeof save === 'function') save();
      else localStorage.setItem('sodvilleScoutV1', JSON.stringify(db));
      close();
      if (typeof refresh === 'function') refresh();
      if (typeof renderDashboard === 'function') renderDashboard();
      if (typeof showToast === 'function') showToast('Urgency updated for ' + changed + ' task' + (changed === 1 ? '' : 's'));
      schedule();
    });
  }
  installTaskUrgencyEditor();


  window.sodvilleSyncChanged = schedule;
  window.sodvilleSyncNow = sync;
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  // Dropdown selection is not necessarily saved through save() on all builds.
  $('scoutSelect')?.addEventListener('change', () => setTimeout(sync, 100));
  setInterval(sync, 60000);
  setTimeout(sync, 1500);
})();
