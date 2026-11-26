/*
 * MintHRM Attendance Automation System — v2.1
 * Fills missing In/Out times + a chosen reason on "Manage My Attendance", clicks the row Save,
 * confirms the "Attendance Change Request" popup, then continues day by day, page by page.
 * The UI lives in a Shadow DOM so the HRM site's CSS can't break it (and vice versa).
 */
(() => {
  'use strict';
  if (window.__afsLoaded) return;
  window.__afsLoaded = true;

  /* =====================================================================
     Settings
     ===================================================================== */
  const uid = () => Math.random().toString(36).slice(2, 10);
  const DEFAULT_REASONS = [
    'Fingerprint Not Working',
    'Forgot to Punch',
    'Official Duty / Client Site Visit',
    'Work From Home'
  ].map((text) => ({ id: uid(), text }));

  const DEFAULTS = {
    inTime: '09:00',
    outTime: '17:30',
    reasons: DEFAULT_REASONS,
    defaultReasonId: DEFAULT_REASONS[0].id,
    fromDate: '',
    toDate: '',
    skipHoliday: true,
    keepPunches: true,
    delayMs: 700,
    collapsed: false,
    pos: null
  };

  let settings = JSON.parse(JSON.stringify(DEFAULTS));
  let selectedReasonId = null; // reason used for this run (starts as the default)

  function loadSettings() {
    return new Promise((res) => {
      try {
        chrome.storage.local.get('afsSettings', (d) => {
          const saved = (d && d.afsSettings) || {};
          // migrate v1 single "reason" string
          if (saved.reason && !saved.reasons) {
            const r = { id: uid(), text: saved.reason };
            saved.reasons = [r, ...DEFAULT_REASONS.filter((x) => x.text.toLowerCase() !== saved.reason.toLowerCase())];
            saved.defaultReasonId = r.id;
            delete saved.reason;
          }
          settings = { ...settings, ...saved };
          if (!Array.isArray(settings.reasons) || !settings.reasons.length) settings.reasons = DEFAULT_REASONS;
          if (!settings.reasons.some((r) => r.id === settings.defaultReasonId)) settings.defaultReasonId = settings.reasons[0].id;
          res();
        });
      } catch (_) { res(); }
    });
  }
  function persist() {
    try { chrome.storage.local.set({ afsSettings: settings }); } catch (_) { /* ignore */ }
  }
  const reasonById = (id) => settings.reasons.find((r) => r.id === id);
  const activeReason = () => (reasonById(selectedReasonId) || reasonById(settings.defaultReasonId) || settings.reasons[0]).text;

  /* =====================================================================
     Generic helpers (page side)
     ===================================================================== */
  let stopRequested = false;
  let running = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const isVisible = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    return el.offsetParent !== null || cs.position === 'fixed';
  };

  async function waitFor(fn, timeout = 20000, interval = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (stopRequested) throw new Error('Stopped by user');
      let v;
      try { v = fn(); } catch (_) { v = null; }
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function setValue(el, value) {
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const listRoot = () => $('.ajax_load_here');

  // Click a site link/button. The inline onclick still runs, but the `href="javascript:;"`
  // navigation is cancelled (it would only log a CSP warning from the extension context).
  function safeClick(el) {
    if (!el) return;
    if (el.tagName === 'A' && /^javascript:/i.test(el.getAttribute('href') || '')) {
      el.addEventListener('click', (e) => e.preventDefault(), { once: true });
    }
    el.click();
  }

  /* ---------- detect the AJAX list (searchAttendance) reloading ---------- */
  function markList() {
    const root = listRoot();
    if (!root) return;
    const m = document.createElement('span');
    m.className = 'afs-marker';
    m.style.display = 'none';
    root.appendChild(m);
  }

  async function waitListReload(timeout = 30000) {
    let lastLen = -1;
    let ok = await waitFor(() => {
      const root = listRoot();
      if (!root || root.querySelector('.afs-marker')) return false;
      if (!root.querySelector('.card-content-wrp, #pagination')) { lastLen = -1; return false; }
      const len = root.innerHTML.length;
      const stable = len === lastLen;
      lastLen = len;
      return stable;
    }, timeout, 250);
    if (!ok) {
      const root = listRoot();
      ok = root && !root.querySelector('.afs-marker');
    }
    await sleep(settings.delayMs);
    return !!ok;
  }

  /* ---------- site dialogs ---------- */
  function visibleSwal() {
    const s = $$('.sweet-alert').find((el) => el.classList.contains('showSweetAlert') || isVisible(el));
    return s && isVisible(s) ? s : null;
  }
  function closeSwal() {
    const s = visibleSwal();
    if (!s) return null;
    const msg = ((s.querySelector('h2')?.textContent || '') + ' ' + (s.querySelector('p')?.textContent || '')).trim();
    s.querySelector('button.confirm')?.click();
    return msg;
  }
  function lockOverlayOpen() {
    const o = $('#pendingAttendanceLockOverlay');
    return o && isVisible(o) ? o : null;
  }
  function closeLock() {
    const o = lockOverlayOpen();
    if (!o) return null;
    const msg = ($('#pendingAttendanceLockTitle')?.textContent || '') + ' ' + ($('#pendingAttendanceLockMessage')?.textContent || '');
    $('#pendingAttendanceLockBtn')?.click();
    return msg.trim() || 'Pending request lock';
  }

  /* ---------- pagination ---------- */
  function currentPage() {
    const c = $('#pagination .current, .paginations a.current');
    const n = c ? parseInt(c.textContent.trim(), 10) : 1;
    return Number.isFinite(n) ? n : 1;
  }
  const pageLinks = () => $$('#pagination a[onclick*="searchAttendance"], .paginations a[onclick*="searchAttendance"]');
  function maxVisiblePage() {
    let max = currentPage();
    pageLinks().forEach((a) => {
      const n = parseInt(a.textContent.trim(), 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    });
    return max;
  }
  const hasNextPage = () => pageLinks().some((a) => /next/i.test(a.textContent) && !a.classList.contains('disabled'));

  async function goToPage(p) {
    for (let guard = 0; guard < 60; guard++) {
      const cur = currentPage();
      if (cur === p) return true;
      let link = pageLinks().find((a) => a.textContent.trim() === String(p));
      if (!link) {
        const word = cur < p ? /next/i : /prev/i;
        link = pageLinks().find((a) => word.test(a.textContent) && !a.classList.contains('disabled'));
      }
      if (!link) return false;
      markList();
      safeClick(link);
      if (!(await waitListReload())) return false;
    }
    return currentPage() === p;
  }

  /* ---------- reading day rows ---------- */
  function scanRows() {
    const rows = [];
    $$('.ajax_load_here button.img-save[onclick^="Save("]').forEach((btn) => {
      const m = /Save\(\s*(\d+)\s*,\s*this\s*(?:,\s*(\d+))?\s*\)/.exec(btn.getAttribute('onclick') || '');
      if (!m) return;
      const [, id, shift] = m;
      const card = btn.closest('.card-content-wrp');
      const date = card?.querySelector('[title="Date"]')?.textContent.trim() || '';
      const day = card?.querySelector('.day')?.textContent.trim() || '';
      const suffix = shift ? `_${id}_${shift}` : `_${id}`;
      const inEl = document.getElementById('actualIn' + suffix);
      const outEl = document.getElementById('actualOut' + suffix);
      const reasonEl = document.getElementById('reason' + suffix);
      const header = card?.querySelector('h5.tip-wrp');
      const statusCls = header ? Array.from(header.classList).filter((c) => /^st_/.test(c)) : [];

      let skip = null;
      if (!shift || !inEl || !outEl || !reasonEl || /no shift listed/i.test(card?.textContent || '')) skip = 'No shift (off day)';
      else if (inEl.classList.contains('pending-punch-lock') || outEl.classList.contains('pending-punch-lock')) skip = 'Request already pending';
      else if (settings.skipHoliday && statusCls.length) skip = 'Holiday / leave';
      else if (settings.keepPunches && inEl.value.trim() && outEl.value.trim()) skip = 'Already has In & Out';

      rows.push({ id, shift, btn, card, date, day, inEl, outEl, reasonEl, skip, key: `${date}|${id}|${shift}` });
    });
    return rows;
  }

  const plannedTimes = (r) => ({
    in: settings.keepPunches && r.inEl.value.trim() ? r.inEl.value.trim() : settings.inTime,
    out: settings.keepPunches && r.outEl.value.trim() ? r.outEl.value.trim() : settings.outTime
  });

  /* ---------- submit one row ---------- */
  async function submitRow(row, reason) {
    row.card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.card?.classList.add('afs-highlight');
    await sleep(settings.delayMs);

    const t = plannedTimes(row);
    setValue(row.inEl, t.in);
    setValue(row.outEl, t.out);
    setValue(row.reasonEl, reason);

    $$('#myModal #saveBtn').forEach((b) => b.setAttribute('data-afs-old', '1'));
    row.btn.click();

    const res = await waitFor(() => {
      if (visibleSwal()) return { err: closeSwal() };
      if (lockOverlayOpen()) return { err: closeLock() };
      const b = $('#myModal #saveBtn:not([data-afs-old])');
      if (b && !b.disabled && isVisible($('#myModal'))) return { btn: b };
      return null;
    }, 20000);

    if (!res) throw new Error('Confirmation popup did not open');
    if (res.err) throw new Error(res.err);

    const modalTxt = $('#myModal .modal-body')?.textContent.replace(/\s+/g, ' ') || '';
    if (!modalTxt.includes(t.in) || !modalTxt.includes(t.out)) {
      $('#myModal .p-close')?.click();
      throw new Error(`Popup showed different times — not confirmed`);
    }

    await sleep(250);
    markList();
    res.btn.click();

    let lastMsg = '';
    const outcome = await waitFor(() => {
      if (lockOverlayOpen()) return { err: closeLock() };
      if (visibleSwal()) return { err: closeSwal() };
      const msg = $('#myModal .message.attendance');
      if (msg && isVisible(msg)) {
        lastMsg = msg.textContent.trim();
        if (/success/i.test(lastMsg)) return { ok: lastMsg };
      }
      if (listRoot() && !listRoot().querySelector('.afs-marker')) {
        return /success/i.test(lastMsg) || !lastMsg ? { ok: 'saved' } : { err: lastMsg };
      }
      return null;
    }, 30000);

    if (!outcome) throw new Error('No response after confirming');
    if (outcome.err) {
      $('#myModal .p-close')?.click();
      throw new Error(outcome.err);
    }
    await waitListReload();
    return `${t.in} → ${t.out}`;
  }

  /* ---------- date range ---------- */
  async function applyDateRange() {
    if (!settings.fromDate && !settings.toDate) return;
    if (settings.fromDate && settings.toDate && settings.fromDate > settings.toDate) throw new Error('"From" date is after "To" date');
    const from = $('#start_date'), to = $('#end_date');
    const same = (!settings.fromDate || from?.value === settings.fromDate) && (!settings.toDate || to?.value === settings.toDate);
    if (same && listRoot()?.querySelector('.card-content-wrp')) return;
    if (settings.fromDate && from) from.value = settings.fromDate;
    if (settings.toDate && to) to.value = settings.toDate;
    const btn = $('#search-form .btn-search');
    if (btn) {
      ui.setStatus(`Loading ${from?.value} → ${to?.value}…`);
      markList();
      btn.click();
      await waitListReload();
    }
  }

  /* ---------- scan all pages (used by Preview and before Submit) ---------- */
  async function scanAll() {
    const found = [];
    const seen = new Set();
    let page = 1;
    if (!(await goToPage(1))) throw new Error('Could not open page 1');
    while (!stopRequested) {
      ui.setStatus(`Scanning page ${page}…`);
      scanRows().forEach((r) => {
        if (seen.has(r.key)) return;
        seen.add(r.key);
        found.push({ key: r.key, date: r.date, day: r.day, skip: r.skip, times: r.skip ? null : plannedTimes(r) });
      });
      if (page < maxVisiblePage() || hasNextPage()) {
        page++;
        if (!(await goToPage(page))) throw new Error(`Could not open page ${page}`);
      } else break;
    }
    return found;
  }

  /* ---------- main run ---------- */
  async function run(dryRun) {
    if (running) return;
    const v = ui.validate();
    if (v) { ui.toast(v, 'err'); return; }

    running = true;
    stopRequested = false;
    ui.setRunning(true);
    ui.clearLog();
    const reason = activeReason();
    const stats = { ok: 0, skip: 0, fail: 0, total: 0 };

    try {
      await applyDateRange();
      const all = await scanAll();
      const todo = all.filter((r) => !r.skip);
      all.forEach((r) => {
        if (r.skip) { stats.skip++; ui.log(r, 'skip', r.skip); }
        else ui.log(r, 'plan', `${dryRun ? 'Will set' : 'Queued'} ${r.times.in} → ${r.times.out}`);
      });
      stats.total = todo.length;
      ui.setStats(stats);

      if (dryRun) {
        ui.setProgress(1);
        ui.setStatus(todo.length ? `${todo.length} day(s) ready to submit with “${reason}”.` : 'Nothing to submit — all days are complete.');
        ui.toast(todo.length ? `Preview: ${todo.length} day(s) will be submitted` : 'Nothing to submit', todo.length ? 'info' : 'ok');
        return;
      }
      if (!todo.length) {
        ui.setStatus('Nothing to submit — all days are complete.');
        ui.toast('Nothing to submit', 'ok');
        return;
      }

      const todoKeys = new Set(todo.map((r) => r.key));
      const attempted = new Set();
      let page = 1;
      while (!stopRequested && attempted.size < todoKeys.size) {
        if (currentPage() !== page && !(await goToPage(page))) throw new Error(`Could not open page ${page}`);
        const target = scanRows().find((r) => !r.skip && todoKeys.has(r.key) && !attempted.has(r.key));
        if (!target) {
          if (page < maxVisiblePage() || hasNextPage()) { page++; continue; }
          break;
        }
        attempted.add(target.key);
        ui.setStatus(`Submitting ${target.date} (${attempted.size} of ${stats.total})…`);
        const entry = { key: target.key, date: target.date, day: target.day };
        ui.log(entry, 'work', 'Submitting…');
        try {
          const t = await submitRow(target, reason);
          stats.ok++;
          ui.log(entry, 'ok', t);
        } catch (e) {
          if (stopRequested) { ui.log(entry, 'skip', 'Stopped'); break; }
          stats.fail++;
          ui.log(entry, 'fail', e.message);
          target.card?.classList.remove('afs-highlight');
          await sleep(settings.delayMs);
        }
        ui.setStats(stats);
        ui.setProgress((stats.ok + stats.fail) / stats.total);
      }
      // anything planned but never reached
      todo.filter((r) => !attempted.has(r.key)).forEach((r) => ui.log(r, 'fail', stopRequested ? 'Not processed (stopped)' : 'Row not found again'));

      if (stopRequested) {
        ui.setStatus(`Stopped — ${stats.ok} submitted, ${stats.fail} failed.`);
        ui.toast('Stopped', 'info');
      } else {
        ui.setProgress(1);
        ui.setStatus(`Done — ${stats.ok} submitted, ${stats.skip} skipped, ${stats.fail} failed.`);
        ui.toast(stats.fail ? `Finished with ${stats.fail} failure(s)` : `All done — ${stats.ok} day(s) submitted`, stats.fail ? 'err' : 'ok');
      }
    } catch (e) {
      if (stopRequested) { ui.setStatus('Stopped.'); ui.toast('Stopped', 'info'); }
      else { ui.setStatus('Error: ' + e.message); ui.toast(e.message, 'err'); }
    } finally {
      $$('.afs-highlight').forEach((el) => el.classList.remove('afs-highlight'));
      running = false;
      ui.setRunning(false);
    }
  }

  /* =====================================================================
     UI (Shadow DOM)
     ===================================================================== */
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif; }
  .wrap {
    --pri:#0d9488; --pri-d:#0f766e; --ok:#16a34a; --warn:#d97706; --err:#dc2626; --mut:#64748b;
    --bg:#ffffff; --bg2:#f1f5f9; --bd:#e2e8f0; --tx:#0f172a; --tx2:#475569; --sh:0 12px 40px rgba(15,23,42,.22);
    position: fixed; z-index: 2147483000; right: 20px; bottom: 20px; color: var(--tx); font-size: 13px; line-height: 1.4;
  }
  @media (prefers-color-scheme: dark) {
    .wrap { --bg:#1e293b; --bg2:#0f172a; --bd:#334155; --tx:#e2e8f0; --tx2:#94a3b8; --sh:0 12px 40px rgba(0,0,0,.5); }
  }
  /* ---------- pill (minimised) ---------- */
  .pill { display:none; align-items:center; gap:8px; padding:10px 16px 10px 12px; border:0; border-radius:999px;
    background:var(--pri); color:#fff; font-weight:600; font-size:13px; cursor:pointer; box-shadow:var(--sh); }
  .pill:hover { background:var(--pri-d); }
  .pill .dot { width:9px; height:9px; border-radius:50%; background:#86efac; }
  .wrap.running .pill .dot { background:#fde047; animation:pulse 1s infinite; }
  .wrap.collapsed .pill { display:flex; }
  .wrap.collapsed .card { display:none; }
  @keyframes pulse { 50% { opacity:.3; } }
  /* ---------- card ---------- */
  .card { width: 360px; background:var(--bg); border:1px solid var(--bd); border-radius:14px; box-shadow:var(--sh); overflow:hidden;
    display:flex; flex-direction:column; max-height: calc(100vh - 40px); }
  .head { display:flex; align-items:center; gap:10px; padding:12px 12px 12px 14px; background:linear-gradient(135deg,#0f766e,#14b8a6);
    color:#fff; cursor:move; user-select:none; }
  .logo { width:30px; height:30px; border-radius:8px; background:rgba(255,255,255,.18); display:grid; place-items:center; font-size:16px; }
  .ttl { flex:1; min-width:0; }
  .ttl em { display:block; font-style:normal; font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; opacity:.8; }
  .ttl b { display:block; font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ttl span { display:block; font-size:11.5px; opacity:.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .icon-btn { width:28px; height:28px; border:0; border-radius:7px; background:rgba(255,255,255,.15); color:#fff; cursor:pointer; font-size:15px; display:grid; place-items:center; }
  .icon-btn:hover { background:rgba(255,255,255,.3); }
  .tabs { display:flex; border-bottom:1px solid var(--bd); background:var(--bg); }
  .tab { flex:1; padding:10px 4px; border:0; background:none; color:var(--tx2); font-weight:600; font-size:12.5px; cursor:pointer; border-bottom:2px solid transparent; }
  .tab:hover { color:var(--tx); }
  .tab.on { color:var(--pri); border-bottom-color:var(--pri); }
  .wrap.running .tab:not(.on) { opacity:.4; pointer-events:none; }
  .body { padding:14px; overflow:auto; }
  .view { display:none; }
  .view.on { display:block; }
  /* ---------- form ---------- */
  .lbl { display:block; font-size:11.5px; font-weight:600; color:var(--tx2); margin:0 0 5px; text-transform:uppercase; letter-spacing:.03em; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
  .field { margin-bottom:12px; }
  input[type=time], input[type=date], input[type=text], select {
    width:100%; height:36px; padding:0 10px; border:1px solid var(--bd); border-radius:8px; background:var(--bg); color:var(--tx);
    font-size:13.5px; outline:none; transition:border-color .15s, box-shadow .15s; }
  input:focus, select:focus { border-color:var(--pri); box-shadow:0 0 0 3px rgba(13,148,136,.18); }
  input.bad { border-color:var(--err); box-shadow:0 0 0 3px rgba(220,38,38,.15); }
  .time-box { position:relative; }
  .time-box .hint { position:absolute; right:30px; top:9px; font-size:11px; color:var(--mut); pointer-events:none; }
  .row-sel { display:flex; gap:6px; }
  .row-sel select { flex:1; }
  .link-btn { border:1px solid var(--bd); background:var(--bg2); color:var(--tx2); border-radius:8px; padding:0 10px; height:36px; cursor:pointer; font-size:12.5px; font-weight:600; white-space:nowrap; }
  .link-btn:hover { color:var(--pri); border-color:var(--pri); }
  .summary { display:flex; flex-wrap:wrap; gap:6px; margin:-2px 0 12px; }
  .chip { display:inline-flex; align-items:center; gap:5px; padding:3px 9px; background:var(--bg2); border:1px solid var(--bd); border-radius:999px; font-size:11.5px; color:var(--tx2); cursor:default; }
  .chip.clk { cursor:pointer; font-weight:600; }
  .chip.clk:hover, .chip.clk.on { color:var(--pri); border-color:var(--pri); }
  /* ---------- buttons ---------- */
  .actions { display:flex; gap:8px; }
  .btn { height:40px; border:0; border-radius:9px; font-weight:700; font-size:13.5px; cursor:pointer; padding:0 14px; display:inline-flex; align-items:center; justify-content:center; gap:7px; transition:filter .15s, transform .05s; }
  .btn:active { transform:translateY(1px); }
  .btn:disabled { opacity:.5; cursor:default; }
  .btn.pri { flex:1; background:var(--ok); color:#fff; }
  .btn.pri:hover { filter:brightness(1.07); }
  .btn.sec { background:var(--bg2); color:var(--tx); border:1px solid var(--bd); }
  .btn.sec:hover { border-color:var(--pri); color:var(--pri); }
  .btn.stop { flex:1; background:var(--err); color:#fff; display:none; }
  .wrap.running .btn.stop { display:inline-flex; }
  .wrap.running .btn.pri, .wrap.running .btn.sec.pv { display:none; }
  .wrap.running .form-lock { opacity:.55; pointer-events:none; }
  /* ---------- progress / stats ---------- */
  .prog { height:6px; background:var(--bg2); border-radius:99px; overflow:hidden; margin:14px 0 8px; display:none; }
  .prog i { display:block; height:100%; width:0; background:linear-gradient(90deg,#22c55e,#16a34a); transition:width .35s; }
  .prog.show { display:block; }
  .status { font-size:12.5px; font-weight:600; color:var(--tx2); min-height:18px; margin-top:10px; }
  .stats { display:none; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:10px; }
  .stats.show { display:grid; }
  .stat { background:var(--bg2); border:1px solid var(--bd); border-radius:9px; padding:7px 4px; text-align:center; cursor:pointer; }
  .stat.on { border-color:var(--pri); }
  .stat b { display:block; font-size:17px; }
  .stat span { font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--tx2); }
  .stat.ok b { color:var(--ok); } .stat.sk b { color:var(--mut); } .stat.fl b { color:var(--err); }
  .log { margin-top:10px; max-height:210px; overflow:auto; border:1px solid var(--bd); border-radius:9px; display:none; }
  .log.show { display:block; }
  .li { display:flex; gap:8px; align-items:flex-start; padding:7px 10px; border-bottom:1px solid var(--bd); font-size:12.3px; }
  .li:last-child { border-bottom:0; }
  .li .ic { width:18px; height:18px; flex:none; border-radius:50%; display:grid; place-items:center; font-size:11px; color:#fff; margin-top:1px; }
  .li.ok .ic { background:var(--ok); } .li.fail .ic { background:var(--err); } .li.skip .ic { background:#94a3b8; }
  .li.plan .ic { background:var(--pri); } .li.work .ic { background:var(--warn); animation:pulse 1s infinite; }
  .li .d { font-weight:600; white-space:nowrap; }
  .li .d small { color:var(--mut); font-weight:500; margin-left:3px; }
  .li .m { color:var(--tx2); margin-left:auto; text-align:right; word-break:break-word; }
  .li.fail .m { color:var(--err); }
  .log-tools { display:none; justify-content:flex-end; gap:8px; margin-top:6px; }
  .log-tools.show { display:flex; }
  .mini { border:0; background:none; color:var(--pri); font-size:11.5px; font-weight:600; cursor:pointer; padding:2px 4px; }
  .mini:hover { text-decoration:underline; }
  /* ---------- reasons ---------- */
  .rs-help { font-size:12px; color:var(--tx2); margin:0 0 10px; }
  .rs-list { border:1px solid var(--bd); border-radius:10px; overflow:hidden; margin-bottom:10px; }
  .rs { display:flex; align-items:center; gap:8px; padding:6px 8px 6px 10px; border-bottom:1px solid var(--bd); background:var(--bg); }
  .rs:last-child { border-bottom:0; }
  .rs.def { background:rgba(13,148,136,.07); }
  .star { border:0; background:none; cursor:pointer; font-size:17px; color:#cbd5e1; padding:0 2px; line-height:1; }
  .star:hover { color:#f59e0b; }
  .rs.def .star { color:#f59e0b; }
  .rs .txt { flex:1; min-width:0; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:text; padding:6px 0; }
  .rs .badge { font-size:10px; font-weight:700; color:var(--pri); background:rgba(13,148,136,.12); padding:2px 7px; border-radius:99px; text-transform:uppercase; }
  .rs input { height:30px; flex:1; }
  .rs .x { border:0; background:none; cursor:pointer; color:var(--mut); width:26px; height:26px; border-radius:6px; font-size:14px; }
  .rs .x:hover { background:var(--bg2); color:var(--err); }
  .rs .x.ed:hover { color:var(--pri); }
  .add { display:flex; gap:6px; }
  .add input { flex:1; }
  .add .btn { height:36px; background:var(--pri); color:#fff; }
  /* ---------- options ---------- */
  .opt { display:flex; align-items:flex-start; gap:12px; padding:10px 0; border-bottom:1px solid var(--bd); cursor:pointer; }
  .opt:last-of-type { border-bottom:0; }
  .opt .t { flex:1; }
  .opt .t b { display:block; font-size:13px; font-weight:600; }
  .opt .t span { font-size:11.8px; color:var(--tx2); }
  .sw { position:relative; width:38px; height:22px; flex:none; margin-top:2px; }
  .sw input { opacity:0; width:0; height:0; position:absolute; }
  .sw i { position:absolute; inset:0; background:#cbd5e1; border-radius:99px; transition:.2s; }
  .sw i::after { content:""; position:absolute; left:3px; top:3px; width:16px; height:16px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .sw input:checked + i { background:var(--pri); }
  .sw input:checked + i::after { transform:translateX(16px); }
  .sect { font-size:11.5px; font-weight:700; color:var(--tx2); text-transform:uppercase; letter-spacing:.03em; margin:4px 0 8px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin:-4px 0 14px; }
  input[type=range] { width:100%; accent-color:var(--pri); }
  .foot { font-size:11px; color:var(--mut); text-align:center; padding:8px 0 0; }
  /* ---------- toast ---------- */
  .toast { position:absolute; left:50%; bottom:calc(100% + 10px); transform:translate(-50%,8px); white-space:nowrap; max-width:340px; overflow:hidden; text-overflow:ellipsis;
    padding:9px 14px; border-radius:9px; color:#fff; font-weight:600; font-size:12.5px; box-shadow:var(--sh); opacity:0; pointer-events:none; transition:.25s; background:#0f172a; }
  .toast.show { opacity:1; transform:translate(-50%,0); }
  .toast.ok { background:var(--ok); } .toast.err { background:var(--err); } .toast.info { background:var(--pri); }
  `;

  const HTML = `
  <div class="wrap" id="wrap">
    <div class="toast" id="toast"></div>
    <button class="pill" id="pill" title="Open MintHRM Attendance Automation System"><span class="dot"></span><span id="pillTxt">Attendance Automation</span></button>
    <div class="card">
      <div class="head" id="head">
        <div class="logo">⏱</div>
        <div class="ttl"><em>MintHRM</em><b>Attendance Automation System</b><span id="sub">Ready</span></div>
        <button class="icon-btn" id="minBtn" title="Minimise">—</button>
      </div>
      <div class="tabs">
        <button class="tab on" data-v="run">Submit</button>
        <button class="tab" data-v="reasons">Reasons</button>
        <button class="tab" data-v="opts">Options</button>
      </div>
      <div class="body">
        <!-- RUN -->
        <div class="view on" data-view="run">
          <div class="form-lock">
            <div class="grid2">
              <div><label class="lbl" for="inT">In time</label><input type="time" id="inT" required></div>
              <div><label class="lbl" for="outT">Out time</label><input type="time" id="outT" required></div>
            </div>
            <div class="field">
              <label class="lbl" for="rsSel">Reason</label>
              <div class="row-sel"><select id="rsSel"></select><button class="link-btn" id="rsManage" title="Add or edit reasons">Edit</button></div>
            </div>
            <div class="summary" id="summary"></div>
          </div>
          <div class="actions">
            <button class="btn sec pv" id="pvBtn" title="List the days that would be submitted — nothing is saved">Preview</button>
            <button class="btn pri" id="goBtn">▶ Fill &amp; Submit All</button>
            <button class="btn stop" id="stopBtn">■ Stop</button>
          </div>
          <div class="prog" id="prog"><i id="progBar"></i></div>
          <div class="status" id="status"></div>
          <div class="stats" id="stats">
            <div class="stat ok" data-f="ok"><b id="sOk">0</b><span>Submitted</span></div>
            <div class="stat sk" data-f="skip"><b id="sSk">0</b><span>Skipped</span></div>
            <div class="stat fl" data-f="fail"><b id="sFl">0</b><span>Failed</span></div>
          </div>
          <div class="log" id="log"></div>
          <div class="log-tools" id="logTools"><button class="mini" id="showAll">Show all</button><button class="mini" id="copyLog">Copy log</button></div>
        </div>
        <!-- REASONS -->
        <div class="view" data-view="reasons">
          <p class="rs-help">Click ★ to make a reason the default. Click a reason to rename it.</p>
          <div class="rs-list" id="rsList"></div>
          <div class="add"><input type="text" id="rsNew" placeholder="Add a new reason…" maxlength="150"><button class="btn" id="rsAdd">Add</button></div>
        </div>
        <!-- OPTIONS -->
        <div class="view" data-view="opts">
          <div class="sect">Date range</div>
          <div class="grid2">
            <div><label class="lbl" for="fromD">From</label><input type="date" id="fromD"></div>
            <div><label class="lbl" for="toD">To</label><input type="date" id="toD"></div>
          </div>
          <div class="chips">
            <button class="chip clk" data-r="7">Last 7 days</button>
            <button class="chip clk" data-r="month">This month</button>
            <button class="chip clk" data-r="lastmonth">Last month</button>
            <button class="chip clk" data-r="clear">Use page's range</button>
          </div>
          <div class="sect">Rules</div>
          <label class="opt"><div class="t"><b>Keep real fingerprint punches</b><span>Only fill missing times; skip days that already have both In and Out.</span></div><span class="sw"><input type="checkbox" id="keepP"><i></i></span></label>
          <label class="opt"><div class="t"><b>Skip holidays &amp; leave days</b><span>Days marked with the holiday / leave colour are left alone.</span></div><span class="sw"><input type="checkbox" id="skipH"><i></i></span></label>
          <div class="sect" style="margin-top:12px">Speed</div>
          <div class="field"><input type="range" id="speed" min="300" max="2000" step="100"><div class="chip" id="speedLbl" style="margin-top:6px"></div></div>
          <div class="foot">Off days (“No shift listed”) and days with a pending request are always skipped.<br><button class="mini" id="resetAll">Reset everything to defaults</button></div>
        </div>
      </div>
    </div>
  </div>`;

  const ui = (() => {
    let root, S, logFilter = 'all';
    const q = (s) => root.querySelector(s);
    const qa = (s) => Array.from(root.querySelectorAll(s));
    const logEntries = new Map(); // key -> {el, state}

    function mount() {
      const host = document.createElement('div');
      host.id = 'afs-host';
      document.documentElement.appendChild(host);
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style>${HTML}`;
      S = q('#wrap');

      // page-side highlight style (outside shadow)
      const st = document.createElement('style');
      st.textContent = '.afs-highlight{outline:3px solid #16a34a!important;outline-offset:2px;border-radius:6px;transition:outline .2s}';
      document.head.appendChild(st);

      fill();
      bind();
      if (settings.collapsed) S.classList.add('collapsed');
      if (settings.pos) place(settings.pos.x, settings.pos.y);
      window.addEventListener('resize', () => settings.pos && place(settings.pos.x, settings.pos.y));
    }

    /* ----- populate from settings ----- */
    function fill() {
      q('#inT').value = settings.inTime;
      q('#outT').value = settings.outTime;
      q('#fromD').value = settings.fromDate;
      q('#toD').value = settings.toDate;
      q('#keepP').checked = settings.keepPunches;
      q('#skipH').checked = settings.skipHoliday;
      q('#speed').value = settings.delayMs;
      renderReasons();
      renderSummary();
      speedLabel();
    }

    function renderReasons() {
      if (!reasonById(selectedReasonId)) selectedReasonId = settings.defaultReasonId;
      const sel = q('#rsSel');
      sel.innerHTML = '';
      settings.reasons.forEach((r) => {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.text + (r.id === settings.defaultReasonId ? '  (default)' : '');
        sel.appendChild(o);
      });
      sel.value = selectedReasonId;

      const list = q('#rsList');
      list.innerHTML = '';
      settings.reasons.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'rs' + (r.id === settings.defaultReasonId ? ' def' : '');
        const star = document.createElement('button');
        star.className = 'star';
        star.textContent = r.id === settings.defaultReasonId ? '★' : '☆';
        star.title = r.id === settings.defaultReasonId ? 'Default reason' : 'Make default';
        star.onclick = () => { settings.defaultReasonId = r.id; selectedReasonId = r.id; persist(); renderReasons(); toast('Default reason updated', 'ok'); };
        const txt = document.createElement('div');
        txt.className = 'txt';
        txt.textContent = r.text;
        txt.title = 'Click to rename';
        txt.onclick = () => startEdit(row, r);
        row.append(star, txt);
        if (r.id === settings.defaultReasonId) {
          const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'Default'; row.appendChild(b);
        }
        const ed = document.createElement('button');
        ed.className = 'x ed'; ed.textContent = '✎'; ed.title = 'Rename';
        ed.onclick = () => startEdit(row, r);
        const del = document.createElement('button');
        del.className = 'x'; del.textContent = '✕'; del.title = 'Delete';
        del.onclick = () => removeReason(r);
        row.append(ed, del);
        list.appendChild(row);
      });
    }

    function startEdit(row, r) {
      row.innerHTML = '';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = r.text; inp.maxLength = 150;
      const ok = document.createElement('button'); ok.className = 'x ed'; ok.textContent = '✓'; ok.title = 'Save';
      const cancel = document.createElement('button'); cancel.className = 'x'; cancel.textContent = '↺'; cancel.title = 'Cancel';
      const commit = () => {
        const v = inp.value.trim().replace(/\s+/g, ' ');
        if (!v) { inp.classList.add('bad'); return; }
        if (settings.reasons.some((x) => x.id !== r.id && x.text.toLowerCase() === v.toLowerCase())) { toast('That reason already exists', 'err'); inp.classList.add('bad'); return; }
        r.text = v; persist(); renderReasons(); renderSummary();
      };
      ok.onclick = commit;
      cancel.onclick = () => renderReasons();
      inp.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renderReasons(); };
      row.append(inp, ok, cancel);
      inp.focus(); inp.select();
    }

    function removeReason(r) {
      if (settings.reasons.length <= 1) { toast('Keep at least one reason', 'err'); return; }
      settings.reasons = settings.reasons.filter((x) => x.id !== r.id);
      if (settings.defaultReasonId === r.id) settings.defaultReasonId = settings.reasons[0].id;
      if (selectedReasonId === r.id) selectedReasonId = settings.defaultReasonId;
      persist(); renderReasons(); renderSummary();
      toast(`Deleted “${r.text}”`, 'info');
    }

    function addReason() {
      const inp = q('#rsNew');
      const v = inp.value.trim().replace(/\s+/g, ' ');
      if (!v) { inp.classList.add('bad'); inp.focus(); return; }
      if (settings.reasons.some((x) => x.text.toLowerCase() === v.toLowerCase())) { toast('That reason already exists', 'err'); inp.classList.add('bad'); return; }
      settings.reasons.push({ id: uid(), text: v });
      inp.value = ''; inp.classList.remove('bad');
      persist(); renderReasons();
      toast('Reason added', 'ok');
    }

    function renderSummary() {
      const s = q('#summary');
      s.innerHTML = '';
      const range = settings.fromDate || settings.toDate
        ? `📅 ${settings.fromDate || '…'} → ${settings.toDate || '…'}`
        : '📅 Page’s date range';
      const items = [
        [range, 'opts'],
        [settings.keepPunches ? '🔒 Keeps real punches' : '✏️ Overwrites punches', 'opts'],
        [settings.skipHoliday ? '🏖 Skips holidays' : '🏖 Includes holidays', 'opts']
      ];
      items.forEach(([t, v]) => {
        const c = document.createElement('button');
        c.className = 'chip clk'; c.textContent = t; c.title = 'Change in Options';
        c.onclick = () => showView(v);
        s.appendChild(c);
      });
    }

    function speedLabel() {
      const v = +settings.delayMs;
      q('#speedLbl').textContent = `Pause between steps: ${(v / 1000).toFixed(1)}s ${v <= 500 ? '(fast)' : v >= 1200 ? '(careful)' : '(normal)'}`;
    }

    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    function quickRange(kind) {
      const now = new Date();
      let f = '', t = '';
      if (kind === '7') { const a = new Date(now); a.setDate(a.getDate() - 6); f = ymd(a); t = ymd(now); }
      else if (kind === 'month') { f = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); t = ymd(now); }
      else if (kind === 'lastmonth') { f = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)); t = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
      settings.fromDate = f; settings.toDate = t;
      q('#fromD').value = f; q('#toD').value = t;
      persist(); renderSummary();
    }

    function showView(v) {
      if (running && v !== 'run') return;
      qa('.tab').forEach((t) => t.classList.toggle('on', t.dataset.v === v));
      qa('.view').forEach((t) => t.classList.toggle('on', t.dataset.view === v));
    }

    function validate() {
      const i = q('#inT'), o = q('#outT');
      [i, o].forEach((x) => x.classList.remove('bad'));
      if (!i.value) { i.classList.add('bad'); return 'Set an In time'; }
      if (!o.value) { o.classList.add('bad'); return 'Set an Out time'; }
      if (o.value <= i.value) { o.classList.add('bad'); return 'Out time must be after In time'; }
      if (settings.fromDate && settings.toDate && settings.fromDate > settings.toDate) { showView('opts'); return '“From” date is after “To” date'; }
      if (!activeReason()) return 'Choose a reason';
      return null;
    }

    /* ----- drag / position ----- */
    function place(x, y) {
      const w = S.offsetWidth || 360, h = S.offsetHeight || 60;
      x = Math.min(Math.max(0, x), window.innerWidth - Math.min(w, 120));
      y = Math.min(Math.max(0, y), window.innerHeight - 50);
      Object.assign(S.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
      void h;
    }
    function dragFrom(handle) {
      let moved = false;
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || (e.target.closest('button') && handle.id !== 'pill')) return;
        const r = S.getBoundingClientRect();
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        moved = false;
        const mv = (ev) => {
          if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 4) moved = true;
          if (moved) place(ev.clientX - dx, ev.clientY - dy);
        };
        const up = () => {
          document.removeEventListener('mousemove', mv, true);
          document.removeEventListener('mouseup', up, true);
          if (moved) { const r2 = S.getBoundingClientRect(); settings.pos = { x: r2.left, y: r2.top }; persist(); }
        };
        document.addEventListener('mousemove', mv, true);
        document.addEventListener('mouseup', up, true);
      });
      return () => moved;
    }

    function setCollapsed(c) {
      S.classList.toggle('collapsed', c);
      settings.collapsed = c; persist();
      if (settings.pos) requestAnimationFrame(() => place(settings.pos.x, settings.pos.y));
    }

    /* ----- bind events ----- */
    function bind() {
      qa('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.v)));
      q('#minBtn').onclick = () => setCollapsed(true);
      dragFrom(q('#head'));
      const pillMoved = dragFrom(q('#pill'));
      q('#pill').addEventListener('click', () => { if (!pillMoved()) setCollapsed(false); });

      q('#inT').onchange = () => { settings.inTime = q('#inT').value; q('#inT').classList.remove('bad'); persist(); };
      q('#outT').onchange = () => { settings.outTime = q('#outT').value; q('#outT').classList.remove('bad'); persist(); };
      q('#rsSel').onchange = () => { selectedReasonId = q('#rsSel').value; };
      q('#rsManage').onclick = () => showView('reasons');
      q('#rsAdd').onclick = addReason;
      q('#rsNew').onkeydown = (e) => { q('#rsNew').classList.remove('bad'); if (e.key === 'Enter') addReason(); };

      q('#fromD').onchange = () => { settings.fromDate = q('#fromD').value; persist(); renderSummary(); };
      q('#toD').onchange = () => { settings.toDate = q('#toD').value; persist(); renderSummary(); };
      qa('.chips .chip').forEach((c) => c.onclick = () => quickRange(c.dataset.r));
      q('#keepP').onchange = () => { settings.keepPunches = q('#keepP').checked; persist(); renderSummary(); };
      q('#skipH').onchange = () => { settings.skipHoliday = q('#skipH').checked; persist(); renderSummary(); };
      q('#speed').oninput = () => { settings.delayMs = +q('#speed').value; speedLabel(); persist(); };
      q('#resetAll').onclick = () => {
        if (!confirm('Reset times, reasons and options to the defaults?')) return;
        settings = JSON.parse(JSON.stringify({ ...DEFAULTS, reasons: DEFAULT_REASONS, pos: settings.pos }));
        selectedReasonId = settings.defaultReasonId;
        persist(); fill(); toast('Reset to defaults', 'info');
      };

      q('#goBtn').onclick = () => run(false);
      q('#pvBtn').onclick = () => run(true);
      q('#stopBtn').onclick = () => { stopRequested = true; setStatus('Stopping after this step…'); };

      qa('.stat').forEach((s) => s.onclick = () => filterLog(logFilter === s.dataset.f ? 'all' : s.dataset.f));
      q('#showAll').onclick = () => filterLog('all');
      q('#copyLog').onclick = () => {
        const txt = Array.from(logEntries.values()).map((e) => e.el.innerText.replace(/\n/g, '  ')).join('\n');
        navigator.clipboard.writeText(txt).then(() => toast('Log copied', 'ok'), () => toast('Copy failed', 'err'));
      };
    }

    /* ----- run-time output ----- */
    function setStatus(t) { q('#status').textContent = t; q('#sub').textContent = t.length > 42 ? t.slice(0, 40) + '…' : t; q('#pillTxt').textContent = running ? t.slice(0, 32) : 'Attendance Automation'; }
    function setRunning(r) {
      S.classList.toggle('running', r);
      if (r) { showView('run'); q('#prog').classList.add('show'); setProgress(0); q('#stats').classList.add('show'); }
      if (!r) q('#pillTxt').textContent = 'Attendance Automation';
    }
    function setProgress(f) { q('#progBar').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
    function setStats(s) { q('#sOk').textContent = s.ok; q('#sSk').textContent = s.skip; q('#sFl').textContent = s.fail; }
    function clearLog() { q('#log').innerHTML = ''; logEntries.clear(); filterLog('all'); q('#log').classList.remove('show'); q('#logTools').classList.remove('show'); setStats({ ok: 0, skip: 0, fail: 0 }); }

    const ICON = { ok: '✓', fail: '!', skip: '–', plan: '→', work: '…' };
    function log(entry, state, msg) {
      let e = logEntries.get(entry.key);
      if (!e) {
        const el = document.createElement('div');
        e = { el, state };
        logEntries.set(entry.key, e);
        q('#log').appendChild(el);
      }
      e.state = state;
      e.el.className = 'li ' + state;
      e.el.innerHTML = '';
      const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = ICON[state] || '•';
      const d = document.createElement('span'); d.className = 'd'; d.textContent = entry.date || '—';
      if (entry.day) { const sm = document.createElement('small'); sm.textContent = entry.day; d.appendChild(sm); }
      const m = document.createElement('span'); m.className = 'm'; m.textContent = msg;
      e.el.append(ic, d, m);
      applyFilter(e);
      q('#log').classList.add('show'); q('#logTools').classList.add('show');
      if (state === 'work') e.el.scrollIntoView({ block: 'nearest' });
    }
    function applyFilter(e) {
      const st = e.state === 'plan' || e.state === 'work' ? 'ok' : e.state;
      e.el.style.display = logFilter === 'all' || logFilter === st ? '' : 'none';
    }
    function filterLog(f) {
      logFilter = f;
      qa('.stat').forEach((s) => s.classList.toggle('on', s.dataset.f === f));
      logEntries.forEach(applyFilter);
    }

    let toastT;
    function toast(msg, kind = 'info') {
      const t = q('#toast');
      t.textContent = msg;
      t.className = 'toast show ' + kind;
      clearTimeout(toastT);
      toastT = setTimeout(() => { t.className = 'toast ' + kind; }, 3200);
    }

    return { mount, setStatus, setRunning, setProgress, setStats, clearLog, log, toast, validate };
  })();

  /* =====================================================================
     Boot
     ===================================================================== */
  loadSettings().then(() => {
    selectedReasonId = settings.defaultReasonId;
    ui.mount();
    ui.setStatus('Ready');
  });

  // toolbar popup → page messages
  try {
    chrome.runtime.onMessage.addListener((msg, _s, reply) => {
      if (msg && msg.type === 'afs-show') { document.getElementById('afs-host')?.shadowRoot?.querySelector('#pill')?.click(); reply({ ok: true }); }
    });
  } catch (_) { /* ignore */ }
})();
