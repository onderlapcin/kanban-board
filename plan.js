/* FEV Proje Takip – proje alt sayfaları (Genel bakış, Proje zaman çizelgesi, Tasarım rehberi, not sayfaları).
   Görev panosu şablonun kendi kodudur; bu dosya yalnızca diğer sayfaları çizer.
   Veri: her proje için tek belge  plans/<projeId>  (docs tablosu, görevlerle aynı erişim kuralı). */
(function () {
  'use strict';
  var COLORS = [['#B9052D','#fff'],['#3F3F3F','#fff'],['#0087A0','#fff'],['#ADC646','#000'],['#E67319','#000'],['#99CFD9','#000'],['#8A0321','#fff'],['#797979','#fff'],
    ['#1E5AA8','#fff'],['#6A4C93','#fff'],['#2E8B57','#fff'],['#00897B','#fff'],['#C2185B','#fff'],['#F2A900','#000'],
    ['#F4B6C2','#000'],['#FFCBA4','#000'],['#FFE29A','#000'],['#B8E0C8','#000'],['#B5D8F5','#000'],['#C9B6E4','#000'],['#D9C7B8','#000'],['#CFD8DC','#000']];
  var MON = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  var PAGE = {
    overview: { label: 'Genel bakış', icon: 'over' },
    board: { label: 'Görev panosu', icon: 'board', desc: 'Günlük görev takibi (Kanban)' },
    timeline: { label: 'Proje zaman çizelgesi', icon: 'time', desc: 'Gantt ve V-döngüsü: fazlar, iş paketleri, kilometre taşları' },
    guide: { label: 'Tasarım rehberi', icon: 'guide', desc: 'Sistem ve komponent kartları: gereksinimler, kurallar, clearance' },
    note: { label: 'Boş sayfa', icon: 'page', desc: 'Notlar, toplantı tutanakları, kararlar' }
  };
  var TEMPLATES = ['board', 'timeline', 'guide', 'note'];
  var VSTEPS = [
    { id: 'vehreq', l: 'Araç gereksinimleri', s: 'Müşteri / mevzuat', side: 'L', pair: 'vehval' },
    { id: 'sysreq', l: 'Sistem gereksinimleri', s: 'Sistem şartnamesi', side: 'L', pair: 'sysval' },
    { id: 'sysdes', l: 'Sistem tasarımı', s: 'Mimari, paketleme, simülasyon', side: 'L', pair: 'sysint' },
    { id: 'compdes', l: 'Komponent tasarımı', s: 'CAD, çizim, DFMEA', side: 'L', pair: 'comptest' },
    { id: 'impl', l: 'Prototip üretimi', s: 'Prototip parçaları', side: 'B' },
    { id: 'comptest', l: 'Komponent testleri', s: 'Basınç, sızdırmazlık, titreşim', side: 'R' },
    { id: 'sysint', l: 'Sistem entegrasyon testi', s: 'Test standı / HiL', side: 'R' },
    { id: 'sysval', l: 'Sistem validasyonu', s: 'İklim odası, performans', side: 'R' },
    { id: 'vehval', l: 'Araç validasyonu', s: 'Yol ve dayanım testleri', side: 'R' }
  ];
  var DSTAT = { draft: { l: 'Taslak', bg: '#DBDBDB', fg: '#3F3F3F' }, review: { l: 'İncelemede', bg: '#E67319', fg: '#fff' }, ok: { l: 'Onaylı', bg: '#2E8B57', fg: '#fff' } };
  var PCOLS = [['#797979','Gri'],['#0087A0','Petrol'],['#B9052D','Kırmızı'],['#E67319','Turuncu'],['#2E8B57','Yeşil'],['#ADC646','Limon'],['#1E5AA8','Mavi'],['#6A4C93','Mor']];
  var SEGMENTS = ['Binek araç', 'Ticari araç', 'Diğer'];

  /* ---------- durum ---------- */
  var remote = {}, local = {}, writeT = {}, dbObj = null, started = false;
  var UI = { tl: 'gantt', zoom: 'month', vSel: null, dg: {}, dgQ: '', modal: null, pop: null };
  var subOf = {};
  try { subOf = JSON.parse(localStorage.getItem('kb-sub') || '{}') || {}; } catch (e) { subOf = {}; }

  function app() { return window.__kbApp; }
  function st() { var a = app(); return (a && a.state) || {}; }
  function proj(pid) { return (st().projects || []).find(function (p) { return p.id === pid; }); }
  function tasksOf(pid) { return (st().tasks || []).filter(function (t) { return t.projectId === pid; }); }
  function person(id) { return (st().people || []).find(function (p) { return p.id === id; }); }
  function pname(id) {
    var p = person(id); if (!p) return '';
    var em = p.email || ''; return p.name || (em ? em.split('@')[0].replace(/[._-]+/g, ' ') : '') || (id === st().me ? 'Sen' : 'Ekip üyesi');
  }
  function ini(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toLocaleUpperCase('tr'); }).join('') || '?'; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function toast(m) { try { var a = app(); if (a && a.toast) a.toast(m); } catch (e) {} }
  function rerenderApp() { try { if (window.__kbRerender) window.__kbRerender(); } catch (e) {} }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function canEdit(pid) {
    var a = app(); if (!a) return false; if (a._isOwner) return true;
    var p = proj(pid), me = st().me; var m = p && (p.members || []).find(function (x) { return x.id === me; });
    return !!m && m.role !== 'view';
  }
  function statuses(pid) {
    var p = proj(pid); var s = (p && p.statuses) || null;
    if (!s) { try { s = app().statuses(); } catch (e) { s = []; } }
    return s || [];
  }
  function doneId(pid) { var s = statuses(pid); var d = s.find(function (x) { return x.done; }) || s[s.length - 1]; return d && d.id; }
  function members(pid) { var p = proj(pid); return ((p && p.members) || []).map(function (m) { return m.id; }); }

  function norm(d, pid) {
    d = d || {};
    var o = { projectId: pid, info: d.info || {}, roles: d.roles || {}, systems: d.systems || [], wps: d.wps || [], phases: d.phases || [], milestones: d.milestones || [], vcycle: d.vcycle || {}, components: d.components || [], pages: d.pages || [] };
    o.components.forEach(function (k) { k.reqs = k.reqs || []; k.rules = k.rules || []; k.clear = k.clear || []; k.std = k.std || []; });
    return o;
  }
  function plan(pid) {
    if (local[pid]) return local[pid];
    if (remote[pid]) return remote[pid];
    var d = norm(null, pid);
    if (tasksOf(pid).length) d.pages = [{ id: 'board', type: 'board' }];   // eski projeler: görev panosu açık kalsın
    return d;
  }
  function hasPage(pid, type) { return plan(pid).pages.some(function (p) { return p.type === type; }); }

  /* ---------- kayıt ---------- */
  function patch(pid, fn, opt) {
    opt = opt || {};
    var before = plan(pid), cur = clone(before); fn(cur); cur.projectId = pid; stamp(before, cur); local[pid] = cur;
    clearTimeout(writeT[pid]);
    writeT[pid] = setTimeout(function () { flush(pid); }, opt.now ? 0 : 600);
    if (opt.nav) rerenderApp();
    if (opt.render) refresh(true);
  }
  /* ---------- görmediğin değişiklikler ---------- */
  var COLLS = ['systems', 'wps', 'phases', 'milestones', 'components', 'pages'];
  function bare(o) { var c = {}; Object.keys(o || {}).forEach(function (k) { if (k !== 'u' && k !== 'ub') c[k] = o[k]; }); return JSON.stringify(c); }
  function stamp(a, b) {
    var me = st().me, now = Date.now(); if (!me) return;
    COLLS.forEach(function (c) {
      var old = {}; (a[c] || []).forEach(function (x) { old[x.id] = x; });
      (b[c] || []).forEach(function (x) { var o = old[x.id]; if (!o || bare(o) !== bare(x)) { x.u = now; x.ub = me; } });
    });
    if (JSON.stringify(a.info || {}) !== JSON.stringify(b.info || {}) || JSON.stringify(a.roles || {}) !== JSON.stringify(b.roles || {})) { b.infoU = now; b.infoUb = me; }
    if (JSON.stringify(a.vcycle || {}) !== JSON.stringify(b.vcycle || {})) { b.vcU = now; b.vcUb = me; }
  }
  var seen = null, seenBase = 0;
  function loadSeen() {
    var me = st().me; if (!me) return {};
    if (seen && seen.__me === me) return seen;
    try { seen = JSON.parse(localStorage.getItem('kb-pseen-' + me) || '{}') || {}; } catch (e) { seen = {}; }
    try { seenBase = +localStorage.getItem('kb-pseen0-' + me) || 0; if (!seenBase) { seenBase = Date.now(); localStorage.setItem('kb-pseen0-' + me, String(seenBase)); } } catch (e) { seenBase = Date.now(); }
    try { var g = +localStorage.getItem('kb-seen-' + me) || 0; if (g > seenBase) seenBase = g; } catch (e) {}
    seen.__me = me; return seen;
  }
  function seenAt(pid, page) { var m = loadSeen(); return Math.max(seenBase, m[pid + '|' + page] || 0); }
  function setSeen(pid, page, ts) {
    var m = loadSeen(), k = pid + '|' + page; if ((m[k] || 0) >= ts) return false;
    m[k] = ts; try { var c = {}; Object.keys(m).forEach(function (x) { if (x !== '__me') c[x] = m[x]; }); localStorage.setItem('kb-pseen-' + st().me, JSON.stringify(c)); } catch (e) {}
    return true;
  }
  function chgFor(pid, pg) {
    var p = plan(pid), me = st().me; if (!me) return 0;
    if (pg.type === 'board') { var a = app(); if (!a || !a.hlOf) return 0; return tasksOf(pid).reduce(function (n, t) { try { return n + (a.hlOf(t) ? 1 : 0); } catch (e) { return n; } }, 0); }
    var since = seenAt(pid, pg.id), n = 0;
    function cnt(list) { (list || []).forEach(function (x) { if (x.ub && x.ub !== me && x.u > since) n++; }); }
    if (pg.type === 'overview') { cnt(p.systems); cnt(p.wps); if (p.infoUb && p.infoUb !== me && p.infoU > since) n++; }
    else if (pg.type === 'timeline') { cnt(p.phases); cnt(p.milestones); cnt(p.wps); if (p.vcUb && p.vcUb !== me && p.vcU > since) n++; }
    else if (pg.type === 'guide') cnt(p.components);
    else if (pg.type === 'note') cnt([pg]);
    return n;
  }
  function chgTotal(pid) { return pagesOf(pid).reduce(function (n, pg) { return n + (pg.type === 'board' ? 0 : chgFor(pid, pg)); }, 0); }
  function markSeen(pids) {
    var now = Date.now();
    (pids || (st().projects || []).map(function (p) { return p.id; })).forEach(function (pid) { pagesOf(pid).forEach(function (pg) { setSeen(pid, pg.id, now); }); });
    rerenderApp(); refresh(true);
  }
  function flush(pid) {
    var data = local[pid]; if (!data || !dbObj) return;
    var sent = JSON.stringify(data);
    dbObj.doc('plans/' + pid).set(clone(data)).then(function () {
      remote[pid] = clone(data);
      if (local[pid] && JSON.stringify(local[pid]) === sent) delete local[pid];
    }, function (e) {
      toast('Proje sayfası kaydedilemedi' + (e && e.code === 'permission_denied' ? ' (yetki yok)' : ''));
    });
  }
  window.addEventListener('beforeunload', function () { Object.keys(writeT).forEach(function (k) { clearTimeout(writeT[k]); flush(k); }); });

  function start() {
    if (started || !window.claude) return; started = true;
    window.claude.use('db').then(function (db) {
      if (!db) { started = false; return; }
      dbObj = db;
      db.collection('plans').onSnapshot(function (snap) {
        var next = {};
        snap.docs.forEach(function (d) { next[d.id] = norm(d.data(), d.id); });
        remote = next;
        rerenderApp(); refresh();
      }, function () {});
    });
  }

  /* ---------- gezinme ---------- */
  function pagesOf(pid) {
    return [{ id: 'overview', type: 'overview' }].concat(plan(pid).pages);
  }
  function pageLabel(pg) { return pg.type === 'note' ? (pg.title || 'Başlıksız sayfa') : PAGE[pg.type].label; }
  function getSub(pid) {
    var s = subOf[pid] || 'overview';
    return pagesOf(pid).some(function (p) { return p.id === s; }) ? s : 'overview';
  }
  function setSub(pid, id) {
    subOf[pid] = id; try { localStorage.setItem('kb-sub', JSON.stringify(subOf)); } catch (e) {}
    UI.pop = null; closePop();
    var a = app(); if (a) a.setState({ currentProject: pid, page: 'project', projMenu: null, confirmDel: null, _sub: Date.now() });
  }
  function navFor(pid) {
    var cur = getSub(pid);
    return pagesOf(pid).map(function (pg) {
      var on = pg.id === cur, n = on && pg.type !== 'board' ? 0 : chgFor(pid, pg);
      return { chg: n, hasChg: n > 0, chgTitle: n + ' görmediğin değişiklik', id: pg.id, pid: pid, drag: pg.id !== 'overview' && canEdit(pid) ? 'true' : 'false', label: pageLabel(pg), icon: PAGE[pg.type].icon, bg: on ? 'var(--surface-page)' : 'transparent',
        border: on ? 'var(--border-default)' : 'transparent', color: on ? 'var(--text-accent)' : 'var(--text-secondary)', weight: on ? 600 : 400,
        onClick: function () { setSub(pid, pg.id); } };
    });
  }

  /* ---------- görev penceresi / kartlar için ---------- */
  function sysOpts(pid) { return [{ id: '', label: '—' }].concat(plan(pid).systems.map(function (s) { return { id: s.id, label: s.name || 'Adsız sistem' }; })); }
  function wpOpts(pid) { return [{ id: '', label: '—' }].concat(plan(pid).wps.map(function (w) { return { id: w.id, label: (w.code ? w.code + ' · ' : '') + (w.name || '') }; })); }
  function chipsFor(t) {
    var p = plan(t.projectId), out = [];
    var w = t.wp && p.wps.find(function (x) { return x.id === t.wp; });
    var s = t.sys && p.systems.find(function (x) { return x.id === t.sys; });
    if (w) out.push({ label: w.code || w.name, title: 'İş paketi: ' + (w.code ? w.code + ' · ' : '') + (w.name || '') });
    if (s) out.push({ label: s.name, title: 'Sistem: ' + s.name });
    return out;
  }

  /* ---------- yardımcı çizimler ---------- */
  function avatar(id, size) {
    var p = person(id); if (!p) return '';
    size = size || 24; var c = COLORS[(p.color || 0) % COLORS.length];
    return '<span class="pl-av" title="' + esc(pname(id)) + '" style="width:' + size + 'px;height:' + size + 'px;background:' + c[0] + ';color:' + c[1] + ';font-size:' + Math.round(size * .38) + 'px">' + esc(ini(pname(id))) + '</span>';
  }
  function pill(o) { return '<span class="pl-pill" style="background:' + o.bg + ';color:' + o.fg + '">' + esc(o.l) + '</span>'; }
  function mIdx(ym) { var p = String(ym).split('-'); return (+p[0]) * 12 + (+p[1] - 1); }
  function fmtM(ym) { if (!ym) return '—'; var p = ym.split('-'); return MON[+p[1] - 1] + ' ' + p[0]; }
  function fmtD(d) { if (!d) return '—'; var p = d.split('-'); return (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0]; }
  function fmtDs(d) { if (!d) return '—'; var p = d.split('-'); return (+p[2]) + ' ' + MON[+p[1] - 1]; }
  function dayFrac(d) { var p = d.split('-'); var dim = new Date(+p[0], +p[1], 0).getDate(); return (+p[2] - 1) / dim; }
  function daysTo(d) { return Math.round((new Date(d + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5); }
  function dueLbl(t, pid) {
    var T = todayStr(), done = t.status === doneId(pid);
    var tm = new Date(); tm.setDate(tm.getDate() + 1);
    var tms = tm.getFullYear() + '-' + String(tm.getMonth() + 1).padStart(2, '0') + '-' + String(tm.getDate()).padStart(2, '0');
    if (!t.due) return '<span class="pl-due">—</span>';
    if (done) return '<span class="pl-due">' + fmtDs(t.due) + '</span>';
    if (t.due === T) return '<span class="pl-due today">Bugün</span>';
    if (t.due === tms) return '<span class="pl-due">Yarın</span>';
    if (t.due < T) return '<span class="pl-due late">' + fmtDs(t.due) + '</span>';
    return '<span class="pl-due">' + fmtDs(t.due) + '</span>';
  }
  function taskRow(t, pid) {
    var s = statuses(pid).find(function (x) { return x.id === t.status; }) || statuses(pid)[0] || { color: '#797979', label: '' };
    return '<button type="button" class="pl-it pl-click" data-pa="task" data-id="' + esc(t.id) + '"><span class="pl-dot" style="background:' + s.color + '"></span><span class="pl-t"><b>' + esc(t.title || 'Başlıksız görev') + '</b><small>' + esc(s.label) + '</small></span>' + dueLbl(t, pid) +
      '<span class="pl-avs">' + (t.assignees || []).slice(0, 2).map(function (a) { return avatar(a, 22); }).join('') + '</span></button>';
  }
  function stats(pid) {
    var ts = tasksOf(pid), dId = doneId(pid), T = todayStr();
    var c = {}; statuses(pid).forEach(function (s) { c[s.id] = 0; });
    ts.forEach(function (t) { c[t.status] = (c[t.status] || 0) + 1; });
    var open = ts.filter(function (t) { return t.status !== dId; });
    var p = plan(pid);
    var wpPct = p.wps.length ? Math.round(p.wps.reduce(function (a, w) { return a + (+w.pct || 0); }, 0) / p.wps.length) : null;
    var taskPct = ts.length ? Math.round((ts.length - open.length) / ts.length * 100) : 0;
    var next = p.milestones.filter(function (m) { return !m.done && m.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    var dg = { draft: 0, review: 0, ok: 0 }; p.components.forEach(function (k) { dg[k.status || 'draft']++; });
    return { c: c, total: ts.length, open: open, over: open.filter(function (t) { return t.due && t.due < T; }).length, wpPct: wpPct, taskPct: taskPct, next: next, dg: dg };
  }
  function stack(pid, c, total) {
    var ss = statuses(pid);
    return '<div class="pl-stack">' + ss.map(function (s) { return c[s.id] ? '<span style="width:' + (c[s.id] / Math.max(1, total) * 100) + '%;background:' + s.color + '" title="' + esc(s.label) + ': ' + c[s.id] + '"></span>' : ''; }).join('') + '</div>' +
      '<div class="pl-legend">' + ss.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) + ' <b>' + (c[s.id] || 0) + '</b></span>'; }).join('') + '</div>';
  }
  function secT(title, btn) { return '<div class="pl-sec"><h2>' + esc(title) + '</h2>' + (btn || '') + '</div>'; }
  function editBtn(m, label, pid) { return canEdit(pid) ? '<button type="button" class="pl-btn sm" data-pa="modal" data-m="' + m + '">' + esc(label || 'Düzenle') + '</button>' : ''; }
  function sel(bind, val, opts, attrs) {
    return '<select data-b="' + esc(bind) + '"' + (attrs || '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val || '') === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function memberOpts(pid) { return [['', '—']].concat(members(pid).map(function (id) { return [id, pname(id)]; })); }
  function ro(pid) { return canEdit(pid) ? '' : ' disabled'; }

  /* ---------- Genel bakış ---------- */
  function pageOverview(pid) {
    var p = plan(pid), s = stats(pid), I = p.info, E = canEdit(pid);
    var h = '<div class="pl-in">';
    var meta = [['Segment', I.segment], ['Araç', I.vehicle], ['Müşteri', I.customer], ['Güncel faz', I.phase], ['SOP', I.sop ? fmtM(I.sop) : '']].filter(function (x) { return x[1]; });
    if (meta.length || I.summary) {
      h += '<div class="pl-intro">' + (I.summary ? '<div class="pl-sum">' + clean(I.summaryHtml != null ? I.summaryHtml : esc(I.summary).replace(/\n/g, '<br>')) + '</div>' : '') + '<div class="pl-meta">' + meta.map(function (x) { return '<span>' + x[0] + ': <b>' + esc(x[1]) + '</b></span>'; }).join('') + (E ? '<button type="button" class="pl-link" data-pa="modal" data-m="info">Bilgileri düzenle</button>' : '') + '</div></div>';
    } else if (E) {
      h += '<div class="pl-empty"><b>Proje bilgileri henüz girilmedi.</b><span>Araç, müşteri, segment, güncel faz ve SOP tarihini ekleyerek başla.</span><button type="button" class="pl-btn pri" data-pa="modal" data-m="info">Proje bilgilerini ekle</button></div>';
    }
    // KPI
    var prog = s.wpPct != null ? s.wpPct : s.taskPct;
    h += '<div class="pl-kpis"><div class="pl-kpi"><b class="acc">%' + prog + '</b><span>Genel ilerleme</span><em>' + (s.wpPct != null ? 'İş paketleri ortalaması' : 'Tamamlanan görev oranı') + '</em></div>' +
      '<div class="pl-kpi"><b>' + s.open.length + '</b><span>Açık görev</span><em>' + s.total + ' görevden</em></div>' +
      '<div class="pl-kpi"><b' + (s.over ? ' class="acc"' : '') + '>' + s.over + '</b><span>Geciken</span><em>Bitiş tarihi geçmiş</em></div>' +
      (s.next ? '<div class="pl-kpi"><b>' + daysTo(s.next.date) + ' gün</b><span>' + esc((s.next.code ? s.next.code + ' · ' : '') + (s.next.name || '')) + '</span><em>' + fmtD(s.next.date) + '</em></div>' : '') +
      (hasPage(pid, 'guide') ? '<div class="pl-kpi"><b>' + p.components.length + '</b><span>Tasarım kartı</span><em>' + s.dg.ok + ' onaylı · ' + s.dg.review + ' incelemede</em></div>' : '') + '</div>';
    // alt sayfalar
    h += secT('Alt sayfalar', E ? '<button type="button" class="pl-btn sm" data-kb-addpage="' + esc(pid) + '">+ Sayfa ekle</button>' : '');
    h += '<div class="pl-cards">';
    p.pages.forEach(function (pg) {
      if (pg.type === 'board') {
        var up = s.open.slice().sort(function (a, b) { return (a.due || '9') < (b.due || '9') ? -1 : 1; }).slice(0, 3);
        h += card(pg, stack(pid, s.c, s.total) + (up.length ? '<div class="pl-list">' + up.map(function (t) { return taskRow(t, pid); }).join('') + '</div>' : '<div class="pl-muted">Açık görev yok.</div>'));
      } else if (pg.type === 'timeline') {
        var T = todayStr().slice(0, 7);
        var cur = p.phases.find(function (x) { return x.start && x.end && x.start <= T && T < x.end; }) || p.phases.find(function (x) { return x.name === p.info.phase; });
        var body = '';
        if (cur) { var pc = Math.max(0, Math.min(100, Math.round((mIdx(T) + dayFrac(todayStr()) - mIdx(cur.start)) / Math.max(1, mIdx(cur.end) - mIdx(cur.start)) * 100)));
          body += '<div><div class="pl-row sm"><span>Faz: <b>' + esc(cur.name) + '</b> (' + fmtM(cur.start) + ' – ' + fmtM(cur.end) + ')</span><b>%' + pc + '</b></div><div class="pl-bar"><span style="width:' + pc + '%;background:' + (cur.color || '#B9052D') + '"></span></div></div>'; }
        var ms = p.milestones.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; }).slice(0, 4);
        body += ms.length ? '<div class="pl-list">' + ms.map(function (m) { return '<div class="pl-it"><span class="pl-chip' + (m.done ? ' ok' : '') + '">' + esc(m.code || '◆') + '</span><span class="pl-t"><b>' + esc(m.name || '') + '</b></span><span class="pl-muted sm">' + fmtD(m.date) + '</span></div>'; }).join('') + '</div>' : '<div class="pl-muted">Faz, iş paketi ve kilometre taşları henüz eklenmedi.</div>';
        h += card(pg, body);
      } else if (pg.type === 'guide') {
        var n = p.components.length, b2 = '';
        b2 += '<div class="pl-stack">' + ['ok', 'review', 'draft'].map(function (k) { return s.dg[k] ? '<span style="width:' + (s.dg[k] / Math.max(1, n) * 100) + '%;background:' + DSTAT[k].bg + '"></span>' : ''; }).join('') + '</div>';
        b2 += '<div class="pl-legend">' + ['ok', 'review', 'draft'].map(function (k) { return '<span><i style="background:' + DSTAT[k].bg + '"></i>' + DSTAT[k].l + ' <b>' + s.dg[k] + '</b></span>'; }).join('') + '</div>';
        b2 += n ? '<div class="pl-list">' + p.components.slice(0, 3).map(function (k) { var sy = p.systems.find(function (x) { return x.id === k.sys; }); return '<div class="pl-it"><span class="pl-t"><b>' + esc(k.name || 'Adsız komponent') + '</b><small>' + esc(sy ? sy.name : '') + (k.rev ? ' · Rev ' + esc(k.rev) : '') + '</small></span>' + pill(DSTAT[k.status || 'draft']) + '</div>'; }).join('') + '</div>' : '<div class="pl-muted">Henüz komponent kartı yok.</div>';
        h += card(pg, b2);
      } else {
        var txt = String(pg.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        h += card(pg, '<div class="pl-muted">' + esc(txt ? txt.slice(0, 160) + (txt.length > 160 ? '…' : '') : 'Boş sayfa') + '</div>');
      }
    });
    if (E) TEMPLATES.forEach(function (ty) {
      if (ty !== 'note' && hasPage(pid, ty)) return;
      if (ty === 'note') return;
      h += '<button type="button" class="pl-card pl-tpl" data-pa="addtpl" data-t="' + ty + '"><span class="pl-ico">' + ICO[PAGE[ty].icon] + '</span><b>' + PAGE[ty].label + '</b><small>' + PAGE[ty].desc + '</small><span class="pl-link">Şablonu ekle</span></button>';
    });
    h += '</div>';
    // ekip + kapsam
    var mem = members(pid);
    h += '<div class="pl-two"><div class="pl-box">' + secT('Ekip ve sorumluluklar') + '<div class="pl-list">' + (mem.length ? mem.map(function (id, i) {
      var n = s.open.filter(function (t) { return (t.assignees || []).indexOf(id) >= 0; }).length;
      return '<div class="pl-it">' + avatar(id, 34) + '<span class="pl-t"><b>' + esc(pname(id)) + '</b>' + (E ? '<input class="pl-inl" data-b="roles.' + esc(id) + '" value="' + esc(p.roles[id] || '') + '" placeholder="Projedeki rolü / sorumluluğu">' : '<small>' + esc(p.roles[id] || '') + '</small>') + '</span><span class="pl-muted sm nowrap">' + n + ' açık görev</span></div>';
    }).join('') : '<div class="pl-muted">Ekip yok.</div>') + '</div></div>';
    h += '<div class="pl-box">' + secT('Kapsamımız: iş paketleri', editBtn('wps', p.wps.length ? 'Düzenle' : '+ Ekle', pid)) + (p.wps.length ? '<div class="pl-list">' + p.wps.map(function (w) {
      var nt = tasksOf(pid).filter(function (t) { return t.wp === w.id && t.status !== doneId(pid); }).length;
      return '<div class="pl-it"><span class="pl-chip">' + esc(w.code || 'WP') + '</span><span class="pl-t"><b>' + esc(w.name || '') + '</b><small>' + (w.start ? fmtM(w.start) + ' – ' + fmtM(w.end) + ' · ' : '') + esc(pname(w.owner)) + (nt ? ' · ' + nt + ' açık görev' : '') + '</small><span class="pl-bar"><span style="width:' + (+w.pct || 0) + '%"></span></span></span><b class="sm nowrap">%' + (+w.pct || 0) + '</b></div>';
    }).join('') + '</div>' : '<div class="pl-muted">Projede yapmakla görevli olduğumuz işleri (iş paketleri) ekle.</div>' + (E ? '<div class="pl-row g8"><button type="button" class="pl-btn sm" data-pa="wpsStd">Hazır iş paketlerini ekle</button><span class="pl-muted sm">Mimari, paketleme, simülasyon, komponent tasarımı, DFMEA, prototip/test</span></div>' : '')) + '</div></div>';
    // sistemler
    h += '<div class="pl-box">' + secT('Sistemler', editBtn('systems', p.systems.length ? 'Düzenle' : '+ Ekle', pid)) + (p.systems.length ? '<div class="pl-scroll"><table class="pl-tbl"><thead><tr><th>Sistem</th><th>Sorumlu</th><th class="num">Komponent</th><th class="num">Açık görev</th><th>Tasarım durumu</th></tr></thead><tbody>' + p.systems.map(function (sy) {
      var ks = p.components.filter(function (k) { return k.sys === sy.id; });
      var ot = tasksOf(pid).filter(function (t) { return t.sys === sy.id && t.status !== doneId(pid); }).length;
      return '<tr><td><b class="fw5">' + esc(sy.name || '') + '</b></td><td><span class="pl-row g8">' + avatar(sy.owner, 22) + '<span class="sm">' + esc(pname(sy.owner)) + '</span></span></td><td class="num">' + ks.length + '</td><td class="num">' + ot + '</td><td>' + (ks.length ? ks.map(function (k) { return pill(DSTAT[k.status || 'draft']); }).join(' ') : '<span class="pl-muted sm">—</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="pl-muted">Projede üzerinde çalıştığımız sistemleri ekle (ör. batarya termal yönetimi, HVAC).</div>') + '</div>';
    return h + '</div>';
  }
  function card(pg, body) {
    return '<div class="pl-card pl-click" data-pa="sub" data-id="' + esc(pg.id) + '"><div class="pl-cardh"><span class="pl-ico">' + ICO[PAGE[pg.type].icon] + '</span><h3>' + esc(pageLabel(pg)) + '</h3><span class="pl-go">Aç →</span></div>' + body + '</div>';
  }

  /* ---------- Zaman çizelgesi ---------- */
  function pageTimeline(pid) {
    var p = plan(pid), E = canEdit(pid);
    var h = '<div class="pl-in wide"><div class="pl-tools"><div class="pl-seg"><button type="button" data-pa="tl" data-v="gantt" class="' + (UI.tl === 'gantt' ? 'on' : '') + '">Gantt</button><button type="button" data-pa="tl" data-v="v" class="' + (UI.tl === 'v' ? 'on' : '') + '">V-döngüsü</button></div>' +
      (UI.tl === 'gantt' ? '<div class="pl-seg"><button type="button" data-pa="zoom" data-v="month" class="' + (UI.zoom === 'month' ? 'on' : '') + '">Ay</button><button type="button" data-pa="zoom" data-v="quarter" class="' + (UI.zoom === 'quarter' ? 'on' : '') + '">Çeyrek</button></div>' : '') +
      '<span class="pl-sp"></span>' + (E ? (UI.tl === 'gantt' && (p.phases.length > 1 || p.wps.length > 1) ? '<button type="button" class="pl-btn sm" data-pa="sortall" title="Fazları ve iş paketlerini başlangıç tarihine göre sıralar">Başlangıca göre sırala</button>' : '') + '<button type="button" class="pl-btn sm" data-pa="modal" data-m="phases">Fazlar</button><button type="button" class="pl-btn sm" data-pa="modal" data-m="wps">İş paketleri</button><button type="button" class="pl-btn sm" data-pa="modal" data-m="milestones">Kilometre taşları</button>' : '') + '</div>';
    if (UI.tl === 'gantt') {
      if (!p.phases.length && !p.wps.length && !p.milestones.length) h += '<div class="pl-empty"><b>Zaman çizelgesi boş.</b><span>Proje fazlarını (Konsept, Ön tasarım, Detay tasarım…), iş paketlerini ve gate/kilometre taşlarını ekle; Gantt otomatik çizilir.</span>' + (E ? '<div class="pl-row g8"><button type="button" class="pl-btn pri" data-pa="modal" data-m="phases">Faz ekle</button><button type="button" class="pl-btn" data-pa="phasesStd">Standart fazları ekle</button></div>' : '') + '</div>';
      else h += gantt(pid);
    } else h += vcycle(pid);
    return h + '</div>';
  }
  function range(p) {
    var a = [], b = [];
    p.phases.forEach(function (x) { if (x.start) a.push(x.start); if (x.end) b.push(x.end); });
    p.wps.forEach(function (x) { if (x.start) a.push(x.start); if (x.end) b.push(x.end); });
    p.milestones.forEach(function (x) { if (x.date) { a.push(x.date.slice(0, 7)); b.push(x.date.slice(0, 7)); } });
    var s = p.info.start || a.sort()[0], e = p.info.end || b.sort().slice(-1)[0];
    var T = todayStr().slice(0, 7);
    if (!s) s = T; if (!e || e < s) { var y = +s.slice(0, 4) + 1; e = y + s.slice(4); }
    return [s, e];
  }
  function gantt(pid) {
    var p = plan(pid), r = range(p), m0 = mIdx(r[0]), m1 = mIdx(r[1]) + 1, nm = Math.max(1, m1 - m0);
    var mw = UI.zoom === 'month' ? 56 : 22, W = nm * mw;
    function x(ym, f) { return ((mIdx(ym) - m0) + (f || 0)) * mw; }
    function xd(d) { return x(d.slice(0, 7), dayFrac(d)); }
    function P(v) { return (Math.max(0, Math.min(W, v)) / W * 100).toFixed(4) + '%'; }
    var months = '', grid = '';
    for (var i = 0; i < nm; i++) {
      var mi = m0 + i, y = Math.floor(mi / 12), mo = mi % 12;
      if (UI.zoom === 'month') months += '<div style="width:' + P(mw) + '">' + (mo === 0 || i === 0 ? '<b>' + y + '</b>' : '&nbsp;') + '<span>' + MON[mo] + '</span></div>';
      else if (mo % 3 === 0 || i === 0) { var span = Math.min(3 - (mo % 3), nm - i); months += '<div style="width:' + P(span * mw) + '">' + (mo < 3 || i === 0 ? '<b>' + y + '</b>' : '&nbsp;') + '<span>Ç' + (Math.floor(mo / 3) + 1) + '</span></div>'; }
      grid += '<div style="width:' + P(mw) + ';' + (UI.zoom === 'quarter' && mo % 3 !== 0 ? 'border-left-color:transparent' : '') + '"></div>';
    }
    var T = todayStr(), tx = xd(T), showT = tx >= 0 && tx <= W;
    var today = showT ? '<div class="g-today" style="left:' + P(tx) + '"></div>' : '';
    var DR = canEdit(pid);
    function row(lab, cls, inner, dk, id, grp) { return '<div class="g-lab ' + cls + '"' + (dk ? ' data-gk="' + dk + '" data-gid="' + esc(id) + '" data-grp="' + esc(grp || '') + '"' + (DR ? ' draggable="true"' : '') : (grp != null ? ' data-gk="grp" data-grp="' + esc(grp) + '"' : '')) + '>' + (dk && DR ? '<span class="g-grip" aria-hidden="true">⋮⋮</span>' : '') + lab + '</div><div class="g-tl ' + cls + '"><div class="g-grid">' + grid + '</div>' + today + inner + '</div>'; }
    function bar(w, color) {
      if (!w.start) return '';
      var a = x(w.start), b = x(w.end || w.start, 1);
      return '<div class="g-bar" title="' + esc((w.code ? w.code + ' · ' : '') + (w.name || '') + ' · %' + (+w.pct || 0)) + '" style="left:' + P(a) + ';width:' + P(b - a) + ';background:' + color + '"><span class="fill" style="width:' + (+w.pct || 0) + '%"></span><span class="tx">' + (b - a > 110 ? esc(pname(w.owner)) : '') + '</span></div>';
    }
    function wpRow(w, color, grp) { return row('<span class="pl-chip">' + esc(w.code || 'WP') + '</span><span class="g-nm">' + esc(w.name || '') + '</span><small>%' + (+w.pct || 0) + '</small>', 'wp', bar(w, color), 'wp', w.id, grp); }
    var h = '<div class="gantt"><div class="g-wrap"><div class="g-tbl" style="grid-template-columns:max-content minmax(' + W + 'px,1fr)">';
    h += '<div class="g-lab g-head">Faz / iş paketi</div><div class="g-tl g-head"><div class="g-months">' + months + '</div>' + (showT ? '<div class="g-today-l" style="left:' + P(tx) + '">BUGÜN</div>' : '') + '</div>';
    if (p.milestones.length) h += row('Kilometre taşları', 'ph', p.milestones.filter(function (m) { return m.date; }).map(function (m) { var xx = xd(m.date); return '<span class="g-ms" title="' + esc((m.code ? m.code + ' · ' : '') + (m.name || '') + ' · ' + fmtD(m.date)) + '" style="left:' + P(xx) + ';background:' + (m.done ? '#2E8B57' : 'var(--surface-page)') + '"></span><span class="g-ms-l" style="left:calc(' + P(xx) + ' + 12px)">' + esc(m.code || m.name || '') + '</span>'; }).join(''));
    var used = {};
    p.phases.forEach(function (ph) {
      var c = ph.color || '#797979';
      var a = ph.start ? x(ph.start) : 0, b = ph.end ? x(ph.end) : a;
      h += row('<span class="pl-sw" style="background:' + c + '"></span>' + esc(ph.name || '') + '<small>' + (ph.start ? fmtM(ph.start) + ' – ' + fmtM(ph.end) : '') + '</small>', 'ph', ph.start ? '<div class="g-bar phase" style="left:' + P(a) + ';width:' + P(b - a) + ';background:' + c + '"></div>' : '', 'phase', ph.id, ph.id);
      p.wps.forEach(function (w) {
        if (used[w.id]) return;
        var manual = w.phase && p.phases.some(function (x) { return x.id === w.phase; });
        var hit = manual ? w.phase === ph.id : (w.start && ph.start && ph.end && w.start >= ph.start && w.start < ph.end);
        if (hit) { used[w.id] = 1; h += wpRow(w, c, ph.id); }
      });
    });
    var rest = p.wps.filter(function (w) { return !used[w.id]; });
    if (rest.length) { if (p.phases.length) h += row('Diğer iş paketleri', 'ph', '', null, null, ''); rest.forEach(function (w) { h += wpRow(w, '#0087A0', ''); }); }
    h += '</div></div></div><div class="pl-legend"><span><i class="dia" style="background:#2E8B57"></i>Tamamlanan kilometre taşı</span><span><i class="dia" style="background:var(--surface-page);border:1px solid var(--text-secondary)"></i>Planlanan kilometre taşı</span><span><i style="background:rgba(0,0,0,.3)"></i>Çubuğun koyu kısmı: gerçekleşen ilerleme</span><span><i style="background:#B9052D"></i>Bugün</span></div>';
    return h;
  }
  function vPct(p, id) {
    var ws = p.wps.filter(function (w) { return w.v === id; });
    if (ws.length) return { v: Math.round(ws.reduce(function (a, w) { return a + (+w.pct || 0); }, 0) / ws.length), auto: true };
    return { v: +p.vcycle[id] || 0, auto: false };
  }
  function vcycle(pid) {
    var p = plan(pid), BW = 190, BH = 64;
    var pos = {}; VSTEPS.forEach(function (n, i) { pos[n.id] = { x: 40 + i * 105, y: n.side === 'B' ? 430 : 40 + Math.min(i, 8 - i) * 100 }; });
    var sv = '<svg viewBox="0 0 1110 520" role="img" aria-label="V-döngüsü"><defs><marker id="plar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--text-muted)"/></marker></defs>';
    VSTEPS.filter(function (n) { return n.pair; }).forEach(function (n) {
      var a = pos[n.id], b = pos[n.pair], y = a.y + BH / 2;
      sv += '<line x1="' + (a.x + BW + 8) + '" y1="' + y + '" x2="' + (b.x - 8) + '" y2="' + y + '" stroke="var(--border-default)" stroke-width="1.5" stroke-dasharray="5 5"/>' + (b.x - a.x - BW < 80 ? '' : '<text x="' + ((a.x + BW + b.x) / 2) + '" y="' + (y - 6) + '" text-anchor="middle" font-size="11" fill="var(--text-muted)">doğrular</text>');
    });
    for (var i = 0; i < VSTEPS.length - 1; i++) {
      var A = VSTEPS[i], B = VSTEPS[i + 1], a = pos[A.id], b = pos[B.id], x1, y1, x2, y2;
      if (A.side === 'L') { x1 = a.x + BW * .5; y1 = a.y + BH; x2 = b.x + (B.side === 'B' ? BW * .2 : BW * .5); y2 = b.y - 2; }
      else { x1 = a.x + BW * (A.side === 'B' ? .8 : .7); y1 = a.y; x2 = b.x + BW * .5; y2 = b.y + BH + 2; }
      sv += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="var(--text-muted)" stroke-width="1.5" marker-end="url(#plar)"/>';
    }
    VSTEPS.forEach(function (n) {
      var q = pos[n.id], pc = vPct(p, n.id).v, col = pc >= 100 ? '#2E8B57' : (pc > 0 ? '#0087A0' : '#BDBDBD');
      sv += '<g class="vnode' + (UI.vSel === n.id ? ' sel' : '') + '" data-pa="v" data-id="' + n.id + '" tabindex="0" role="button" aria-label="' + esc(n.l) + ' %' + pc + '"><rect class="box" x="' + q.x + '" y="' + q.y + '" width="' + BW + '" height="' + BH + '" rx="6"/><rect x="' + q.x + '" y="' + q.y + '" width="5" height="' + BH + '" rx="2" fill="' + col + '"/>' +
        '<text x="' + (q.x + 16) + '" y="' + (q.y + 22) + '" font-size="13" font-weight="600">' + esc(n.l) + '</text><text class="sub" x="' + (q.x + 16) + '" y="' + (q.y + 38) + '">' + esc(n.s) + '</text>' +
        '<rect x="' + (q.x + 16) + '" y="' + (q.y + 48) + '" width="' + (BW - 62) + '" height="5" rx="2.5" fill="var(--surface-muted)"/><rect x="' + (q.x + 16) + '" y="' + (q.y + 48) + '" width="' + ((BW - 62) * pc / 100) + '" height="5" rx="2.5" fill="' + col + '"/><text x="' + (q.x + BW - 12) + '" y="' + (q.y + 54) + '" text-anchor="end" font-size="11" font-weight="600" class="pc">%' + pc + '</text></g>';
    });
    sv += '<text x="60" y="505" font-size="11" fill="var(--text-muted)" letter-spacing=".08em">TANIMLAMA VE TASARIM →</text><text x="1050" y="505" text-anchor="end" font-size="11" fill="var(--text-muted)" letter-spacing=".08em">← DOĞRULAMA VE VALİDASYON</text></svg>';
    var h = '<div class="pl-vwrap">' + sv + '</div><div class="pl-legend"><span><i style="background:#2E8B57"></i>Tamamlandı</span><span><i style="background:#0087A0"></i>Devam ediyor</span><span><i style="background:#BDBDBD"></i>Başlamadı</span><span class="pl-muted">Bir adıma tıkla: bağlı iş paketleri ve görevler aşağıda listelenir. İş paketlerine V-döngüsü adımı atadığında ilerleme otomatik hesaplanır.</span></div>';
    if (UI.vSel) {
      var n = VSTEPS.find(function (k) { return k.id === UI.vSel; }), vp = vPct(p, n.id);
      var ws = p.wps.filter(function (w) { return w.v === n.id; }), ids = ws.map(function (w) { return w.id; });
      var ts = tasksOf(pid).filter(function (t) { return ids.indexOf(t.wp) >= 0; });
      h += '<div class="pl-box">' + secT(n.l + ' · %' + vp.v) +
        (!vp.auto && canEdit(pid) ? '<label class="pl-row g8 sm">İlerleme (elle) <input type="number" min="0" max="100" class="pl-num" data-b="vcycle.' + n.id + '" data-t="num" value="' + vp.v + '"> %</label>' : '') +
        (ws.length ? '<div class="pl-list">' + ws.map(function (w) { return '<div class="pl-it"><span class="pl-chip">' + esc(w.code || 'WP') + '</span><span class="pl-t"><b>' + esc(w.name || '') + '</b><small>' + esc(pname(w.owner)) + (w.start ? ' · ' + fmtM(w.start) + ' – ' + fmtM(w.end) : '') + '</small></span><b class="sm">%' + (+w.pct || 0) + '</b></div>'; }).join('') + '</div>' : '<div class="pl-muted">Bu adıma bağlı iş paketi yok. İş paketleri penceresinden "V-döngüsü adımı" seçerek bağlayabilirsin.</div>') +
        (ts.length ? '<div class="pl-list">' + ts.map(function (t) { return taskRow(t, pid); }).join('') + '</div>' : '') + '</div>';
    }
    return h;
  }

  /* ---------- Tasarım rehberi ---------- */
  function pageGuide(pid) {
    var p = plan(pid), E = canEdit(pid);
    var comps = p.components;
    var selId = UI.dg[pid];
    if (!selId || !p.components.some(function (k) { return k.id === selId; })) selId = UI.dg[pid] = (comps[0] || p.components[0] || {}).id;
    var h = '<div class="pl-in">' + (E ? '<div class="pl-tools"><span class="pl-sp"></span><button type="button" class="pl-btn sm" data-pa="modal" data-m="systems">Sistemler</button><button type="button" class="pl-btn sm pri" data-pa="addcomp">+ Komponent kartı</button></div>' : '');
    if (!p.components.length) {
      h += '<div class="pl-empty"><b>Tasarım rehberi boş.</b><span>' + (p.systems.length ? 'Her komponent için gereksinimleri, tasarım kurallarını, clearance değerlerini ve standartları tek kartta topla.' : 'Önce projedeki sistemleri ekle, sonra her sistemin komponentleri için kart oluştur.') + '</span>' + (E ? (p.systems.length ? '<button type="button" class="pl-btn pri" data-pa="addcomp">İlk komponent kartını ekle</button>' : '<button type="button" class="pl-btn pri" data-pa="modal" data-m="systems">Sistem ekle</button>') : '') + '</div></div>';
      return h;
    }
    h += '<div class="pl-dg"><div class="pl-dgl">';
    var groups = p.systems.map(function (sy) { return { sys: sy.id, name: sy.name || 'Adsız sistem', ks: comps.filter(function (k) { return k.sys === sy.id; }) }; });
    var orphan = comps.filter(function (k) { return !p.systems.some(function (sy) { return sy.id === k.sys; }); });
    if (orphan.length) groups.push({ name: 'Sistem atanmamış', ks: orphan });
    groups.forEach(function (g) { h += '<div class="pl-dgg"><div class="pl-dgs">' + esc(g.name) + '</div>' + (!g.ks.length ? (E && g.sys ? '<button type="button" class="pl-dgadd" data-pa="addcomp" data-sys="' + esc(g.sys) + '">+ Kart ekle</button>' : '<div class="pl-dgnone">Henüz kart yok</div>') : '') + g.ks.map(function (k) { return '<button type="button" class="' + (k.id === selId ? 'on' : '') + '" data-pa="dg" data-id="' + esc(k.id) + '"><span>' + esc(k.name || 'Adsız komponent') + '</span>' + pill(DSTAT[k.status || 'draft']) + (k.ub && k.ub !== st().me && k.u > seenAt(pid, 'guide', true) ? '<span class="pl-new" title="Görmediğin değişiklik"></span>' : '') + '</button>'; }).join('') + '</div>'; });
    h += '</div>';
    var ki = p.components.findIndex(function (k) { return k.id === selId; }), k = p.components[ki];
    if (k) {
      var B = 'components.' + ki + '.', D = ro(pid);
      h += '<div class="pl-box pl-comp">';
      h += '<input class="pl-ttl" data-b="' + B + 'name" value="' + esc(k.name || '') + '" placeholder="Komponent adı"' + D + '>';
      h += '<div class="pl-props">' +
        '<label>Sistem' + sel(B + 'sys', k.sys, [['', '—']].concat(p.systems.map(function (s) { return [s.id, s.name || 'Adsız sistem']; })), D) + '</label>' +
        '<label>Onay durumu' + sel(B + 'status', k.status || 'draft', Object.keys(DSTAT).map(function (x) { return [x, DSTAT[x].l]; }), D) + '</label>' +
        '<label>Revizyon<input data-b="' + B + 'rev" value="' + esc(k.rev || '') + '" placeholder="A"' + D + '></label>' +
        '<div class="pl-plab">Sorumlular<div class="pl-owners">' + ownersOf(k).map(function (id) { return '<span class="pl-own">' + avatar(id, 22) + '<span>' + esc(pname(id)) + '</span>' + (E ? '<button type="button" class="pl-x" title="Sorumluyu çıkar" aria-label="' + esc(pname(id)) + ' sorumlulardan çıkar" data-pa="ownrm" data-cid="' + esc(k.id) + '" data-id="' + esc(id) + '">×</button>' : '') + '</span>'; }).join('') +
          (E ? '<button type="button" class="pl-ownadd" data-pa="ownpick" data-cid="' + esc(k.id) + '">+ Ekle</button>' : (ownersOf(k).length ? '' : '<span class="pl-muted">—</span>')) + '</div></div></div>';
      h += secT('Gereksinimler', E ? '<button type="button" class="pl-btn sm" data-pa="addrow" data-path="' + B + 'reqs" data-n="2">+ Satır</button>' : '');
      h += k.reqs.length ? '<div class="pl-scroll"><table class="pl-tbl ed"><thead><tr><th style="width:150px">Kod</th><th>Gereksinim</th>' + (E ? '<th style="width:36px"></th>' : '') + '</tr></thead><tbody>' + k.reqs.map(function (r, i) { return '<tr><td><input class="mono" data-b="' + B + 'reqs.' + i + '.0" value="' + esc(r[0] || '') + '" placeholder="REQ-01"' + D + '></td><td><input data-b="' + B + 'reqs.' + i + '.1" value="' + esc(r[1] || '') + '" placeholder="ör. Basınç düşümü ≤ 0,30 bar"' + D + '></td>' + (E ? '<td>' + delBtn(B + 'reqs', i) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' : '<div class="pl-muted">Gereksinim yok.</div>';
      var rulesHtml = k.rulesHtml != null ? k.rulesHtml : (k.rules.length ? '<ul>' + k.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '');
      h += secT('Tasarım kuralları') + '<div class="pl-notes kb-rte-ed" data-kind="plan" data-b="' + B + 'rulesHtml" data-t="html" data-lines="' + B + 'rules" contenteditable="' + (E ? 'true' : 'false') + '" data-ph="Kuralları yaz; listeye çevirmek için metni seçip madde işaretini kullan. Ör. Minimum bükme yarıçapı 3×D">' + clean(rulesHtml) + '</div>';
      h += secT('Clearance değerleri', E ? '<button type="button" class="pl-btn sm" data-pa="addrow" data-path="' + B + 'clear" data-n="3">+ Satır</button>' : '');
      h += k.clear.length ? '<div class="pl-scroll"><table class="pl-tbl ed"><thead><tr><th>Komşu parça / bölge</th><th class="num" style="width:120px">Statik (mm)</th><th class="num" style="width:120px">Dinamik (mm)</th>' + (E ? '<th style="width:36px"></th>' : '') + '</tr></thead><tbody>' + k.clear.map(function (c, i) { return '<tr><td><input data-b="' + B + 'clear.' + i + '.0" value="' + esc(c[0] || '') + '" placeholder="ör. Yüksek gerilim kabloları"' + D + '></td><td><input class="num" data-b="' + B + 'clear.' + i + '.1" value="' + esc(c[1] || '') + '"' + D + '></td><td><input class="num" data-b="' + B + 'clear.' + i + '.2" value="' + esc(c[2] || '') + '"' + D + '></td>' + (E ? '<td>' + delBtn(B + 'clear', i) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' : '<div class="pl-muted">Clearance değeri yok.</div>';
      h += secT('İlgili standartlar') + '<input class="pl-full" data-b="' + B + 'std" data-t="csv" value="' + esc(k.std.join(', ')) + '" placeholder="Virgülle ayır: SAE J2064, ISO 6469-1, UN ECE R100"' + D + '>' + (k.std.length ? '<div class="pl-chips">' + k.std.map(function (s) { return '<span class="pl-chip">' + esc(s) + '</span>'; }).join('') + '</div>' : '');
      var rel = tasksOf(pid).filter(function (t) { return k.sys && t.sys === k.sys && t.status !== doneId(pid); });
      if (rel.length) h += secT('Bu sistemle ilgili açık görevler') + '<div class="pl-list">' + rel.map(function (t) { return taskRow(t, pid); }).join('') + '</div>';
      h += secT('Serbest notlar') + '<div class="pl-notes kb-rte-ed" data-kind="plan" data-b="' + B + 'notes" data-t="html" data-cid="' + esc(k.id) + '" contenteditable="' + (E ? 'true' : 'false') + '" data-ph="Tasarım kararları, açık sorular, müşteri geri bildirimleri… Görsel yapıştırırsan ek olarak eklenir.">' + clean(k.notes || '') + '</div>';
      h += '<div class="pl-files" data-cid="' + esc(k.id) + '">' + filesHtml(pid, k) + '</div>';
      if (E) h += '<div class="pl-drop" data-pa="pickfile" data-cid="' + esc(k.id) + '" role="button" tabindex="0">Dosyaları buraya sürükle, yapıştır ya da <u>bilgisayardan seç</u><input type="file" multiple class="pl-file-in" data-cid="' + esc(k.id) + '" hidden></div>';
      if (E) h += '<div class="pl-row"><span class="pl-sp"></span><button type="button" class="pl-link red" data-pa="delcomp" data-id="' + esc(k.id) + '">Komponent kartını sil</button></div>';
      h += '</div>';
    }
    return h + '</div></div>';
  }
  var OFFICE = /\.(docx?|xlsx?|pptx?)$/i;
  function fmtSize(b) { b = +b || 0; return b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function openUrl(f) { if (OFFICE.test(f.name || '') && /^https?:/.test(f.url)) return 'https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(f.url); return f.url; }
  function filesHtml(pid, k) {
    var fs = k.files || [], E = canEdit(pid); if (!fs.length) return '';
    var img = fs.filter(function (f) { return /^image\//.test(f.type || ''); }), oth = fs.filter(function (f) { return !/^image\//.test(f.type || ''); });
    function x(f) { return E ? '<button type="button" class="pl-x" title="Eki kaldır" aria-label="Eki kaldır" data-pa="delfile" data-cid="' + esc(k.id) + '" data-fid="' + esc(f.id) + '">×</button>' : ''; }
    var h = '';
    if (img.length) h += '<div class="pl-imgs">' + img.map(function (f) { return '<div class="pl-imgit"><a href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(f.name) + '"><img src="' + esc(f.url) + '" alt="' + esc(f.name) + '" loading="lazy"></a>' + x(f) + '</div>'; }).join('') + '</div>';
    if (oth.length) h += '<div class="pl-list">' + oth.map(function (f) { var ext = (String(f.name || '').split('.').pop() || '').slice(0, 4).toUpperCase(); return '<div class="pl-it"><span class="pl-ext">' + esc(ext) + '</span><span class="pl-t"><a href="' + esc(openUrl(f)) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(f.name) + '</b></a><small>' + fmtSize(f.size) + '</small></span>' + x(f) + '</div>'; }).join('') + '</div>';
    return h;
  }
  function refreshFiles(pid, cid) {
    var k = plan(pid).components.find(function (c) { return c.id === cid; }); if (!k) return;
    document.querySelectorAll('.pl-files[data-cid="' + cid + '"]').forEach(function (el) { el.innerHTML = filesHtml(pid, k); });
  }
  function uploadFiles(pid, cid, list) {
    var files = Array.prototype.slice.call(list || []); if (!files.length || !canEdit(pid)) return;
    files.forEach(function (f) {
      if (f.size > 50 * 1048576) { toast(f.name + ' 50 MB sınırını aşıyor'); return; }
      var nm = f.name && f.name !== 'image.png' ? f.name : 'görsel-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.' + ((f.type || '').split('/')[1] || 'png');
      (window.claude ? window.claude.use('assets') : Promise.resolve(null)).then(function (as) {
        if (!as) { toast('Dosya yükleme iznin yok'); return; }
        toast(nm + ' yükleniyor…');
        return as.upload(f).then(function (r) {
          patch(pid, function (p) { var k = p.components.find(function (c) { return c.id === cid; }); if (k) { k.files = k.files || []; k.files.push({ id: uid(), name: nm, type: f.type || '', size: f.size || 0, url: r.url }); } });
          refreshFiles(pid, cid); toast(nm + ' eklendi');
        });
      }).catch(function () { toast(nm + ' yüklenemedi'); });
    });
  }
  function ownersOf(k) { return Array.isArray(k.owners) ? k.owners : (k.owner ? [k.owner] : []); }
  function setOwners(pid, cid, fn) {
    patch(pid, function (p) { var k = p.components.find(function (c) { return c.id === cid; }); if (!k) return; k.owners = fn(ownersOf(k).slice()); delete k.owner; }, { render: true });
  }
  function openOwnerPop(anchor, pid, cid) {
    closePop();
    var k = plan(pid).components.find(function (c) { return c.id === cid; }); if (!k) return;
    var cur = ownersOf(k), el = document.createElement('div'); el.id = 'kbpl-pop'; el.className = 'pl-pop'; el.setAttribute('data-pid', pid);
    el.innerHTML = '<div class="pl-poph">Sorumlu seç</div>' + members(pid).map(function (id) { var on = cur.indexOf(id) >= 0;
      return '<button type="button" data-pa="owntog" data-cid="' + esc(cid) + '" data-id="' + esc(id) + '" aria-pressed="' + on + '">' + avatar(id, 24) + '<span class="pl-t"><b>' + esc(pname(id)) + '</b></span><span class="pl-chk' + (on ? ' on' : '') + '">' + (on ? '✓' : '') + '</span></button>'; }).join('');
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect();
    el.style.top = Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8) + 'px';
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
  }
  function delBtn(path, i) { return '<button type="button" class="pl-x" title="Satırı sil" aria-label="Satırı sil" data-pa="delrow" data-path="' + esc(path) + '" data-i="' + i + '">×</button>'; }

  /* ---------- Not sayfası ---------- */
  function pageNote(pid, pgId) {
    var p = plan(pid), i = p.pages.findIndex(function (x) { return x.id === pgId; }), pg = p.pages[i], E = canEdit(pid);
    if (!pg) return '<div class="pl-in"><div class="pl-muted">Sayfa bulunamadı.</div></div>';
    var B = 'pages.' + i + '.';
    return '<div class="pl-in note"><input class="pl-ttl big" data-b="' + B + 'title" data-nav="1" value="' + esc(pg.title || '') + '" placeholder="Başlıksız sayfa"' + ro(pid) + '>' +
      '<div class="pl-body kb-rte-ed" data-kind="plan" data-b="' + B + 'body" data-t="html" contenteditable="' + (E ? 'true' : 'false') + '" data-ph="Yazmaya başla… Biçimlendirmek, başlık ya da liste yapmak için metni seç.">' + clean(pg.body || '') + '</div></div>';
  }

  /* ---------- güvenli HTML ---------- */
  var OK_TAGS = { H2: 1, H3: 1, P: 1, DIV: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, A: 1, SPAN: 1 };
  function clean(html) {
    if (window.__kbSanitize) { try { return window.__kbSanitize(String(html || '')); } catch (e) {} }
    var doc; try { doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html'); } catch (e) { return esc(html); }
    function walk(n) {
      var out = '';
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) { out += esc(c.nodeValue); return; }
        if (c.nodeType !== 1) return;
        var tg = c.tagName, inner = walk(c);
        if (!OK_TAGS[tg]) { out += inner; return; }
        if (tg === 'BR') { out += '<br>'; return; }
        if (tg === 'A') { var hr = c.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(hr)) out += '<a href="' + esc(hr) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'; else out += inner; return; }
        var t = tg.toLowerCase(); out += '<' + t + '>' + inner + '</' + t + '>';
      });
      return out;
    }
    return walk(doc.body);
  }

  /* ---------- sayfa çizimi ---------- */
  function htmlFor(pid, sub) {
    var pg = pagesOf(pid).find(function (x) { return x.id === sub; });
    if (!pg) return pageOverview(pid);
    if (pg.type === 'overview') return pageOverview(pid);
    if (pg.type === 'timeline') return pageTimeline(pid);
    if (pg.type === 'guide') return pageGuide(pid);
    if (pg.type === 'note') return pageNote(pid, pg.id);
    return '';
  }
  function sigFor(pid, sub) {
    var ts = tasksOf(pid).map(function (t) { return [t.id, t.title, t.status, t.due, t.assignees, t.sys, t.wp]; });
    var pr = proj(pid);
    return JSON.stringify([pid, sub, plan(pid), ts, pr && pr.members, pr && pr.statuses, (st().people || []).map(function (p) { return [p.id, p.name, p.color, p.email]; }), UI.tl, UI.zoom, UI.vSel, UI.dg[pid], UI.dgQ, canEdit(pid), todayStr()]);
  }
  function editingIn(el) {
    var a = document.activeElement;
    return a && el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }
  function renderHost(host, force) {
    var pid = host.getAttribute('data-pid'), sub = host.getAttribute('data-sub');
    if (!pid || !proj(pid)) return;
    var sig = sigFor(pid, sub);
    if (!force && host.__sig === sig && host.querySelector('.pl-in')) return;
    if (editingIn(host) && !force) { host.__dirty = true; return; }
    var gw = host.querySelector('.g-wrap'), gl = gw ? gw.scrollLeft : null, sameView = host.__view === pid + '|' + sub;
    var wasSeen = seenAt(pid, sub);
    host.innerHTML = htmlFor(pid, sub);
    host.__seenT && clearTimeout(host.__seenT);
    host.__seenT = setTimeout(function () { if (host.isConnected && host.getAttribute('data-sub') === sub && setSeen(pid, sub, Date.now())) rerenderApp(); }, 1500);
    host.__sig = sig; host.__dirty = false;
    if (!sameView) { host.scrollTop = 0; host.__view = pid + '|' + sub; }
    var ng = host.querySelector('.g-wrap');
    if (ng) { if (sameView && gl != null) ng.scrollLeft = gl; else { var gt = host.querySelector('.g-today'), lab = host.querySelector('.g-lab'); if (gt) ng.scrollLeft = Math.max(0, gt.offsetLeft + (lab ? lab.offsetWidth : 0) - ng.clientWidth / 2); } }
  }
  var refT = null;
  function refresh(force) {
    clearTimeout(refT);
    refT = setTimeout(function () {
      document.querySelectorAll('.kb-plan-host').forEach(function (h) { renderHost(h, force); });
      if (UI.modal && !editingIn(modalEl())) renderModal();
    }, force ? 0 : 40);
  }
  new MutationObserver(function () {
    document.querySelectorAll('.kb-plan-host').forEach(function (h) {
      var k = h.getAttribute('data-pid') + '|' + h.getAttribute('data-sub');
      if (h.__k !== k || !h.querySelector('.pl-in')) { h.__k = k; h.__sig = null; renderHost(h, true); }
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sub', 'data-pid'] });

  /* ---------- pencere (liste düzenleyici) ---------- */
  var MODALS = {
    info: { title: 'Proje bilgileri', form: true },
    systems: { title: 'Sistemler', list: 'systems', add: function () { return { id: uid(), name: '', owner: '' }; },
      cols: [['name', 'Sistem adı', 'text', 'ör. Batarya termal yönetimi'], ['owner', 'Sorumlu', 'member']] },
    wps: { title: 'İş paketleri', list: 'wps', sortKey: 'start', sortLabel: 'Başlangıca göre sırala', add: function (p) { return { id: uid(), code: 'WP' + (p.wps.length + 1), name: '', owner: '', start: '', end: '', pct: 0, v: '' }; },
      cols: [['code', 'Kod', 'text', 'WP1', 70], ['name', 'İş paketi', 'text', 'ör. 3B paketleme ve yerleşim'], ['owner', 'Sorumlu', 'member'], ['start', 'Başlangıç', 'month'], ['end', 'Bitiş', 'month'], ['pct', '%', 'num', '', 64], ['phase', 'Faz', 'phase'], ['v', 'V-döngüsü adımı', 'vstep']] },
    phases: { title: 'Proje fazları', list: 'phases', sortKey: 'start', sortLabel: 'Başlangıca göre sırala', add: function () { return { id: uid(), name: '', start: '', end: '', color: '#0087A0' }; },
      cols: [['name', 'Faz', 'text', 'ör. Detay tasarım'], ['start', 'Başlangıç', 'month'], ['end', 'Bitiş', 'month'], ['color', 'Renk', 'color']] },
    milestones: { title: 'Kilometre taşları / gate\'ler', list: 'milestones', sortKey: 'date', sortLabel: 'Tarihe göre sırala', add: function () { return { id: uid(), code: '', name: '', date: '', done: false }; },
      cols: [['code', 'Kod', 'text', 'G3', 70], ['name', 'Ad', 'text', 'ör. Tasarım dondurma'], ['date', 'Tarih', 'date'], ['done', 'Tamamlandı', 'chk']] }
  };
  function modalEl() { return document.getElementById('kbpl-modal'); }
  function openModal(pid, m) { UI.modal = { pid: pid, m: m }; renderModal(); setTimeout(function () { var f = modalEl() && modalEl().querySelector('input:not([type=checkbox]),textarea'); if (f) f.focus(); }, 30); }
  function closeModal() { UI.modal = null; var el = modalEl(); if (el) el.remove(); refresh(true); rerenderApp(); }
  function renderModal() {
    var el = modalEl(); if (!UI.modal) { if (el) el.remove(); return; }
    var pid = UI.modal.pid, M = MODALS[UI.modal.m], p = plan(pid);
    if (!el) { el = document.createElement('div'); el.id = 'kbpl-modal'; el.className = 'pl-mwrap'; document.body.appendChild(el); }
    var h = '<div class="pl-mscrim" data-pa="closem"></div><div class="pl-modal" role="dialog" aria-modal="true" aria-label="' + esc(M.title) + '" data-pid="' + esc(pid) + '"><div class="pl-mh"><h3>' + esc(M.title) + '</h3><button type="button" class="pl-x big" data-pa="closem" aria-label="Kapat">×</button></div><div class="pl-mb">';
    if (M.form) {
      var I = p.info;
      h += '<div class="pl-form">' +
        '<label>Segment' + sel('info.segment', I.segment, [['', '—']].concat(SEGMENTS.map(function (s) { return [s, s]; }))) + '</label>' +
        '<label>Araç<input data-b="info.vehicle" value="' + esc(I.vehicle || '') + '" placeholder="ör. 3,5 t elektrikli panelvan (N1)"></label>' +
        '<label>Müşteri<input data-b="info.customer" value="' + esc(I.customer || '') + '" placeholder="OEM adı"></label>' +
        '<label>Güncel faz' + (p.phases.length ? sel('info.phase', I.phase, [['', '—']].concat(p.phases.map(function (x) { return [x.name, x.name]; }))) : '<input data-b="info.phase" value="' + esc(I.phase || '') + '" placeholder="ör. Detay tasarım">') + '</label>' +
        '<label>Proje başlangıcı<input type="month" data-b="info.start" value="' + esc(I.start || '') + '"></label>' +
        '<label>Proje bitişi<input type="month" data-b="info.end" value="' + esc(I.end || '') + '"></label>' +
        '<label>SOP<input type="month" data-b="info.sop" value="' + esc(I.sop || '') + '"></label>' +
        '<div class="wide pl-flab">Kısa özet / kapsamımız<div class="pl-notes kb-rte-ed" data-kind="plan" data-b="info.summaryHtml" data-t="html" data-text="info.summary" contenteditable="true" data-ph="Projenin amacı ve bizim kapsamımız">' + clean(I.summaryHtml != null ? I.summaryHtml : esc(I.summary || '').replace(/\n/g, '<br>')) + '</div></div></div>';
    } else {
      var L = p[M.list];
      h += L.length ? '<div class="pl-scroll"><table class="pl-tbl ed"><thead><tr><th style="width:24px"></th>' + M.cols.map(function (c) { return '<th' + (c[4] ? ' style="width:' + c[4] + 'px"' : '') + '>' + esc(c[1]) + '</th>'; }).join('') + '<th style="width:36px"></th></tr></thead><tbody>' +
        L.map(function (row, i) {
          return '<tr data-mrow="' + i + '"><td class="pl-grip" draggable="true" title="Sürükleyerek sırala" aria-label="Sürükleyerek sırala">⋮⋮</td>' + M.cols.map(function (c) {
            var b = M.list + '.' + i + '.' + c[0], v = row[c[0]];
            if (c[2] === 'member') return '<td>' + sel(b, v, memberOpts(pid)) + '</td>';
            if (c[2] === 'phase') return '<td>' + sel(b, v, [['', 'Otomatik (başlangıca göre)']].concat(p.phases.map(function (x) { return [x.id, x.name || 'Adsız faz']; }))) + '</td>';
            if (c[2] === 'vstep') return '<td>' + sel(b, v, [['', '—']].concat(VSTEPS.map(function (s) { return [s.id, s.l]; }))) + '</td>';
            if (c[2] === 'color') return '<td>' + sel(b, v, PCOLS.map(function (x) { return [x[0], x[1]]; }), ' style="border-left:6px solid ' + (v || '#797979') + '"') + '</td>';
            if (c[2] === 'chk') return '<td class="ctr"><input type="checkbox" data-b="' + b + '" data-t="chk"' + (v ? ' checked' : '') + '></td>';
            if (c[2] === 'num') return '<td><input type="number" min="0" max="100" data-b="' + b + '" data-t="num" value="' + esc(v == null ? 0 : v) + '"></td>';
            return '<td><input' + (c[2] !== 'text' ? ' type="' + c[2] + '"' : '') + ' data-b="' + b + '" value="' + esc(v || '') + '" placeholder="' + esc(c[3] || '') + '"></td>';
          }).join('') + '<td>' + delBtn(M.list, i) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="pl-muted">Henüz kayıt yok.</div>';
      h += '<div class="pl-row g8"><button type="button" class="pl-btn" data-pa="addm">+ Satır ekle</button>' + (M.list === 'phases' && !L.length ? '<button type="button" class="pl-btn" data-pa="phasesStd">Standart otomotiv fazları</button>' : '') + (L.length > 1 && M.sortKey ? '<button type="button" class="pl-btn" data-pa="sortm">' + esc(M.sortLabel) + '</button>' : '') + (M.list === 'wps' ? '<button type="button" class="pl-btn" data-pa="wpsStd" title="' + esc(STD_WPS.map(function (x) { return x[0]; }).join(' · ')) + '">Hazır iş paketlerini ekle</button>' : '') + '</div>';
      if (M.list === 'wps') h += '<div class="pl-muted sm">Faz "Otomatik" ise iş paketi, başlangıç ayının düştüğü fazın altında gösterilir; elle seçersen Gantt seçtiğin fazı kullanır. Görevler, görev penceresindeki "İş paketi" alanından bu paketlere bağlanır. V-döngüsü adımı seçilen paketler V-döngüsü görünümünde ilerlemeyi besler.</div>';
      if (M.list === 'systems') h += '<div class="pl-muted sm">Görevler, görev penceresindeki "Sistem" alanından bu sistemlere bağlanır; tasarım kartları da sistemlere göre gruplanır.</div>';
    }
    h += '</div><div class="pl-mf"><span class="pl-muted sm">Değişiklikler otomatik kaydedilir.</span><button type="button" class="pl-btn pri" data-pa="closem">Tamam</button></div></div>';
    el.innerHTML = h;
  }

  /* ---------- sayfa ekle menüsü ---------- */
  function closePop() { var el = document.getElementById('kbpl-pop'); if (el) el.remove(); }
  function openPop(anchor, pid) {
    closePop();
    var cur = getSub(pid), curPg = plan(pid).pages.find(function (x) { return x.id === cur; });
    var el = document.createElement('div'); el.id = 'kbpl-pop'; el.className = 'pl-pop'; el.setAttribute('data-pid', pid);
    var h = '<div class="pl-poph">Şablondan sayfa ekle</div>';
    TEMPLATES.forEach(function (ty) {
      var has = ty !== 'note' && hasPage(pid, ty);
      h += '<button type="button" data-pa="addtpl" data-t="' + ty + '"' + (has ? ' disabled' : '') + '><span class="pl-ico">' + ICO[PAGE[ty].icon] + '</span><span class="pl-t"><b>' + PAGE[ty].label + '</b><small>' + (has ? 'Bu projede zaten var' : PAGE[ty].desc) + '</small></span></button>';
    });
    if (curPg) h += '<div class="pl-popsep"></div><button type="button" class="red" data-pa="rmpage" data-id="' + esc(curPg.id) + '"><span class="pl-t"><b>"' + esc(pageLabel(curPg)) + '" sayfasını kaldır</b><small>' + (curPg.type === 'board' ? 'Görevler silinmez; şablon yeniden eklendiğinde geri gelir' : curPg.type === 'note' ? 'Sayfa ve içeriği silinir' : 'İçerik saklanır; şablon yeniden eklendiğinde geri gelir') + '</small></span></button>';
    el.innerHTML = h; document.body.appendChild(el);
    var r = anchor.getBoundingClientRect(), w = el.offsetWidth;
    el.style.top = Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8) + 'px';
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  }
  // prototipteki hazır iş paketleri: [ad, V-döngüsü adımı, başlangıç ve bitiş (proje süresinin oranı)]
  var STD_WPS = [
    ['Sistem mimarisi ve gereksinimler', 'sysreq', 0, .22],
    ['3B paketleme ve yerleşim', 'sysdes', .1, .5],
    ['1B / CFD termal simülasyon', 'sysdes', .14, .54],
    ['Komponent tasarımı ve çizimler', 'compdes', .28, .62],
    ['DFMEA ve tasarım doğrulama', 'comptest', .38, .68],
    ['Prototip desteği ve test', 'sysint', .55, .86]
  ];
  function addStdWps(pid) {
    var p0 = plan(pid), r = range(p0), s0 = mIdx(r[0]), len = Math.max(6, mIdx(r[1]) - s0 + 1);
    function ym(n) { n = Math.round(n); return Math.floor(n / 12) + '-' + String(n % 12 + 1).padStart(2, '0'); }
    var added = 0;
    patch(pid, function (p) {
      var have = {}; p.wps.forEach(function (w) { have[String(w.name || '').toLocaleLowerCase('tr')] = 1; });
      var nums = p.wps.map(function (w) { var m = /^WP(\d+)$/i.exec(w.code || ''); return m ? +m[1] : 0; }), n = Math.max.apply(null, [0].concat(nums));
      STD_WPS.forEach(function (x) {
        if (have[x[0].toLocaleLowerCase('tr')]) return;
        n++; added++;
        p.wps.push({ id: uid(), code: 'WP' + n, name: x[0], owner: '', start: ym(s0 + x[2] * len), end: ym(s0 + Math.max(x[2] * len + 1, x[3] * len - 1)), pct: 0, v: x[1] });
      });
    }, { render: true });
    toast(added ? added + ' hazır iş paketi eklendi' : 'Hazır iş paketlerinin hepsi zaten ekli');
    if (UI.modal) renderModal();
  }
  var STD_PHASES = [['Konsept', '#797979'], ['Ön tasarım', '#0087A0'], ['Detay tasarım', '#B9052D'], ['Prototip ve test', '#E67319'], ['Seri öncesi / PPAP', '#2E8B57']];
  function addTemplate(pid, ty) {
    if (!canEdit(pid)) return;
    var id = ty === 'note' ? 'n_' + uid() : ty;
    patch(pid, function (p) {
      if (ty !== 'note' && p.pages.some(function (x) { return x.type === ty; })) return;
      p.pages.push(ty === 'note' ? { id: id, type: 'note', title: '', body: '' } : { id: id, type: ty });
    }, { now: true });
    closePop(); setSub(pid, id);
    if (ty === 'note') setTimeout(function () { var t = document.querySelector('.kb-plan-host .pl-ttl.big'); if (t) t.focus(); }, 120);
  }

  /* ---------- yol ile alan yazma ---------- */
  function setPath(o, path, v) {
    var ks = path.split('.');
    for (var i = 0; i < ks.length - 1; i++) { var k = ks[i]; if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; }
    o[ks[ks.length - 1]] = v;
  }
  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function pidOf(el) {
    var h = el.closest('.kb-plan-host'); if (h) return h.getAttribute('data-pid');
    var m = el.closest('.pl-modal,.pl-pop'); if (m) return m.getAttribute('data-pid');
    return null;
  }
  function valOf(el) {
    var t = el.getAttribute('data-t');
    if (t === 'chk') return !!el.checked;
    if (t === 'num') return Math.max(0, Math.min(100, Math.round(+el.value || 0)));
    if (t === 'lines') return el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (t === 'csv') return el.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (t === 'html') return clean(el.innerHTML);
    return el.value;
  }
  // tıklama sürerken DOM'u yenileme: aksi halde basılan düğme değişir ve tıklama kaybolur
  var ptrDown = false, ptrQ = [];
  document.addEventListener('pointerdown', function () { ptrDown = true; }, true);
  document.addEventListener('pointerup', function () { ptrDown = false; var q = ptrQ; ptrQ = []; if (q.length) setTimeout(function () { q.forEach(function (fn) { fn(); }); }, 0); }, true);
  function afterPointer(fn) { if (ptrDown) ptrQ.push(fn); else fn(); }
  function onField(e, structural) {
    var el = e.target.closest && e.target.closest('[data-b]'); if (!el) return;
    var pid = pidOf(el); if (!pid || !canEdit(pid)) return;
    var b = el.getAttribute('data-b'), v = valOf(el);
    var lines = el.getAttribute('data-lines'), txt = el.getAttribute('data-text');
    var plain = (lines || txt) ? String(el.innerText || '') : '';
    patch(pid, function (p) {
      setPath(p, b, v);
      if (lines) setPath(p, lines, plain.split('\n').map(function (x) { return x.trim(); }).filter(Boolean));
      if (txt) setPath(p, txt, plain.trim());
    }, { nav: el.hasAttribute('data-nav') || /^pages\./.test(b) });
    if (el.tagName === 'SELECT' && el.closest('.pl-modal') && /\.color$/.test(b)) el.style.borderLeftColor = v;
    if (structural && !el.closest('.pl-modal')) afterPointer(function () { refresh(true); });
  }

  document.addEventListener('input', function (e) {
    if (!e.target.closest) return;
    if (e.target.getAttribute('data-pa-input') === 'dgq') {
      UI.dgQ = e.target.value; var pos = e.target.selectionStart, host = e.target.closest('.kb-plan-host');
      if (host) { renderHost(host, true); var q = host.querySelector('[data-pa-input="dgq"]'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } }
      return;
    }
    if (e.target.closest('.kb-plan-host,.pl-modal')) onField(e, false);
  });
  document.addEventListener('change', function (e) {
    if (!e.target.closest || !e.target.closest('.kb-plan-host,.pl-modal')) return;
    if (e.target.classList.contains('pl-file-in')) { var hp = pidOf(e.target); uploadFiles(hp, e.target.getAttribute('data-cid'), e.target.files); e.target.value = ''; return; }
    var tg = e.target.tagName, ty = e.target.type;
    onField(e, tg === 'SELECT' || ty === 'checkbox' || ty === 'month' || ty === 'date' || ty === 'number');
  });
  document.addEventListener('focusout', function (e) {
    setTimeout(function () {
      document.querySelectorAll('.kb-plan-host').forEach(function (h) { if (h.__dirty && !editingIn(h)) renderHost(h, false); });
    }, 0);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (document.getElementById('kbpl-pop')) { closePop(); return; } if (UI.modal) { closeModal(); return; } }
    var dz = e.target.closest && e.target.closest('.kb-plan-host .pl-drop');
    if (dz && e.target === dz && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); var fi = dz.querySelector('.pl-file-in'); if (fi) fi.click(); return; }
    var vn = e.target.closest && e.target.closest('.kb-plan-host [data-pa="v"]');
    if (vn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); vn.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t.closest) return;
    var ap = t.closest('[data-kb-addpage]');
    if (ap) { e.preventDefault(); e.stopPropagation(); var pp = ap.getAttribute('data-kb-addpage'); if (document.getElementById('kbpl-pop')) closePop(); else openPop(ap, pp); return; }
    if (document.getElementById('kbpl-pop') && !t.closest('#kbpl-pop')) closePop();
    var a = t.closest('[data-pa]'); if (!a || !a.closest('.kb-plan-host,.pl-modal,.pl-pop,.pl-mwrap')) return;
    var act = a.getAttribute('data-pa'), pid = pidOf(a) || (UI.modal && UI.modal.pid);
    if (!pid) return;
    if (act === 'sub') { if (t.closest('[data-pa="task"]')) return; setSub(pid, a.getAttribute('data-id')); return; }
    if (act === 'task') { e.stopPropagation(); var ap2 = app(); if (ap2) ap2.setState({ openId: a.getAttribute('data-id') }); return; }
    if (act === 'modal') { openModal(pid, a.getAttribute('data-m')); return; }
    if (act === 'closem') { closeModal(); return; }
    if (act === 'addm') { var M = MODALS[UI.modal.m]; patch(pid, function (p) { p[M.list].push(M.add(p)); }); renderModal(); var rows = modalEl().querySelectorAll('tbody tr'); var last = rows[rows.length - 1]; var f = last && last.querySelector('input:not([type=checkbox])'); if (f) f.focus(); return; }
    if (act === 'sortm' || act === 'sortall') {
      var keys = act === 'sortall' ? [['phases', 'start'], ['wps', 'start'], ['milestones', 'date']] : [[MODALS[UI.modal.m].list, MODALS[UI.modal.m].sortKey]];
      patch(pid, function (p) { keys.forEach(function (k) { p[k[0]] = p[k[0]].map(function (x, i) { return [x, i]; }).sort(function (a, b) { var va = a[0][k[1]] || '9999', vb = b[0][k[1]] || '9999'; if (va !== vb) return va < vb ? -1 : 1; var ea = a[0].end || '', eb = b[0].end || ''; if (ea !== eb) return ea < eb ? -1 : 1; return a[1] - b[1]; }).map(function (x) { return x[0]; }); }); }, { render: true });
      if (UI.modal) renderModal(); toast('Başlangıç tarihine göre sıralandı'); return;
    }
    if (act === 'wpsStd') { if (canEdit(pid)) addStdWps(pid); return; }
    if (act === 'phasesStd') {
      var p0 = plan(pid), r = range(p0), s0 = mIdx(r[0]), len = Math.max(5, mIdx(r[1]) - s0), stp = len / 5;
      function ym(n) { n = Math.round(n); return Math.floor(n / 12) + '-' + String(n % 12 + 1).padStart(2, '0'); }
      patch(pid, function (p) { STD_PHASES.forEach(function (x, i) { p.phases.push({ id: uid(), name: x[0], color: x[1], start: ym(s0 + i * stp), end: ym(s0 + (i + 1) * stp) }); }); }, { render: true });
      if (UI.modal) renderModal(); else openModal(pid, 'phases');
      return;
    }
    if (act === 'delrow') { var path = a.getAttribute('data-path'), i = +a.getAttribute('data-i'); patch(pid, function (p) { var L = getPath(p, path); if (L) L.splice(i, 1); }); if (a.closest('.pl-modal')) renderModal(); else refresh(true); return; }
    if (act === 'addrow') { var pa = a.getAttribute('data-path'), n = +a.getAttribute('data-n') || 2; patch(pid, function (p) { var L = getPath(p, pa); if (!L) { setPath(p, pa, []); L = getPath(p, pa); } L.push(new Array(n).fill('')); }, { render: true }); return; }
    if (act === 'tl') { UI.tl = a.getAttribute('data-v'); refresh(true); return; }
    if (act === 'zoom') { UI.zoom = a.getAttribute('data-v'); refresh(true); return; }
    if (act === 'v') { var id = a.getAttribute('data-id'); UI.vSel = UI.vSel === id ? null : id; refresh(true); return; }
    if (act === 'dg') { UI.dg[pid] = a.getAttribute('data-id'); refresh(true); return; }
    if (act === 'addcomp') {
      var p1 = plan(pid); if (!p1.systems.length) { openModal(pid, 'systems'); return; }
      var cid = uid(), curSel = p1.components.find(function (k) { return k.id === UI.dg[pid]; });
      var wantSys = a.getAttribute('data-sys');
      patch(pid, function (p) { p.components.push({ id: cid, sys: wantSys || (curSel && curSel.sys) || p.systems[0].id, name: '', status: 'draft', rev: 'A', owners: st().me ? [st().me] : [], reqs: [], rules: [], clear: [], std: [], notes: '' }); });
      UI.dg[pid] = cid; UI.dgQ = ''; refresh(true);
      setTimeout(function () { var f = document.querySelector('.kb-plan-host .pl-comp .pl-ttl'); if (f) f.focus(); }, 60);
      return;
    }
    if (act === 'delcomp') {
      if (a.getAttribute('data-sure') !== '1') { a.setAttribute('data-sure', '1'); a.textContent = 'Emin misin? Tekrar tıkla'; return; }
      var did = a.getAttribute('data-id'); patch(pid, function (p) { p.components = p.components.filter(function (k) { return k.id !== did; }); }); UI.dg[pid] = null; refresh(true); toast('Komponent kartı silindi'); return;
    }
    if (act === 'ownpick') { if (document.getElementById('kbpl-pop')) { closePop(); return; } openOwnerPop(a, pid, a.getAttribute('data-cid')); return; }
    if (act === 'ownrm') { var rid2 = a.getAttribute('data-id'); setOwners(pid, a.getAttribute('data-cid'), function (o) { return o.filter(function (x) { return x !== rid2; }); }); return; }
    if (act === 'owntog') {
      var oc = a.getAttribute('data-cid'), oid = a.getAttribute('data-id');
      setOwners(pid, oc, function (o) { var i = o.indexOf(oid); if (i >= 0) o.splice(i, 1); else o.push(oid); return o; });
      var on = a.getAttribute('aria-pressed') !== 'true'; a.setAttribute('aria-pressed', on); var ck = a.querySelector('.pl-chk'); ck.className = 'pl-chk' + (on ? ' on' : ''); ck.textContent = on ? '✓' : '';
      return;
    }
    if (act === 'pickfile') { if (t.closest('input')) return; var fi = a.querySelector('.pl-file-in'); if (fi) fi.click(); return; }
    if (act === 'delfile') {
      var dc = a.getAttribute('data-cid'), df = a.getAttribute('data-fid');
      patch(pid, function (p) { var k = p.components.find(function (c) { return c.id === dc; }); if (k) k.files = (k.files || []).filter(function (f) { return f.id !== df; }); });
      refreshFiles(pid, dc); return;
    }
    if (act === 'addtpl') { if (!a.disabled) addTemplate(pid, a.getAttribute('data-t')); return; }
    if (act === 'rmpage') {
      var rid = a.getAttribute('data-id');
      patch(pid, function (p) { p.pages = p.pages.filter(function (x) { return x.id !== rid; }); }, { now: true });
      closePop(); setSub(pid, 'overview'); toast('Sayfa kaldırıldı'); return;
    }
    if (act === 'fmt') {
      var body = a.closest('.kb-plan-host').querySelector('.pl-body'); if (!body) return; body.focus();
      var f2 = a.getAttribute('data-f');
      try {
        if (f2 === 'b') document.execCommand('bold'); else if (f2 === 'i') document.execCommand('italic');
        else if (f2 === 'ul') document.execCommand('insertUnorderedList'); else if (f2 === 'ol') document.execCommand('insertOrderedList');
        else document.execCommand('formatBlock', false, f2);
      } catch (x) {}
      body.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
  });

  /* ---------- komponent ekleri: yapıştır / sürükle-bırak ---------- */
  document.addEventListener('paste', function (e) {
    var comp = e.target.closest && e.target.closest('.kb-plan-host .pl-comp'); if (!comp || !e.clipboardData) return;
    var files = [];
    Array.prototype.forEach.call(e.clipboardData.items || [], function (it) { if (it.kind === 'file') { var f = it.getAsFile(); if (f) files.push(f); } });
    if (!files.length) return;
    var zone = comp.querySelector('.pl-drop'); if (!zone) return;
    e.preventDefault(); e.stopPropagation();
    uploadFiles(pidOf(comp), zone.getAttribute('data-cid'), files);
  }, true);
  document.addEventListener('dragover', function (e) {
    var z = e.target.closest && e.target.closest('.kb-plan-host .pl-drop'); if (!z || sdrag) return;
    e.preventDefault(); z.classList.add('over');
  });
  document.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('.pl-drop'); if (z) z.classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    var z = e.target.closest && e.target.closest('.kb-plan-host .pl-drop'); if (!z || sdrag) return;
    e.preventDefault(); z.classList.remove('over');
    uploadFiles(pidOf(z), z.getAttribute('data-cid'), e.dataTransfer && e.dataTransfer.files);
  });

  /* ---------- alt sayfaları sürükleyerek sırala (kenar çubuğu ve sekmeler) ---------- */
  var sdrag = null, sover = null;
  function clearMarks() { document.querySelectorAll('[data-kb-sub]').forEach(function (b) { b.style.boxShadow = ''; b.style.opacity = ''; }); }
  document.addEventListener('dragstart', function (e) {
    var b = e.target.closest && e.target.closest('[data-kb-sub]'); if (!b) return;
    e.stopPropagation();
    if (b.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
    sdrag = { pid: b.getAttribute('data-kb-subpid'), id: b.getAttribute('data-kb-sub') }; sover = null;
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'sub:' + sdrag.id); } catch (x) {}
    setTimeout(function () { b.style.opacity = '.4'; }, 0);
  }, true);
  document.addEventListener('dragover', function (e) {
    if (!sdrag) return;
    e.stopPropagation(); e.preventDefault();
    var b = e.target.closest && e.target.closest('[data-kb-sub]');
    document.querySelectorAll('[data-kb-sub]').forEach(function (x) { if (x !== b) x.style.boxShadow = ''; });
    sover = null;
    if (!b || b.getAttribute('data-kb-subpid') !== sdrag.pid) return;
    var id = b.getAttribute('data-kb-sub'); if (id === 'overview' || id === sdrag.id) { b.style.boxShadow = ''; return; }
    var r = b.getBoundingClientRect(), hor = !!b.closest('.kb-subnav');
    var before = hor ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
    b.style.boxShadow = hor ? (before ? 'inset 3px 0 0 #B9052D' : 'inset -3px 0 0 #B9052D') : (before ? 'inset 0 2px 0 #B9052D' : 'inset 0 -2px 0 #B9052D');
    sover = { id: id, before: before };
    try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
  }, true);
  document.addEventListener('drop', function (e) {
    if (!sdrag) return;
    e.stopPropagation(); e.preventDefault();
    var d = sdrag, o = sover; sdrag = null; sover = null; clearMarks();
    if (!o) return;
    patch(d.pid, function (p) {
      var a = p.pages, i = a.findIndex(function (x) { return x.id === d.id; }); if (i < 0) return;
      var it = a.splice(i, 1)[0], j = a.findIndex(function (x) { return x.id === o.id; }); if (j < 0) { a.splice(i, 0, it); return; }
      a.splice(o.before ? j : j + 1, 0, it);
    }, { nav: true, now: true });
  }, true);
  document.addEventListener('dragend', function () { if (sdrag) { sdrag = null; sover = null; } clearMarks(); }, true);

  /* ---------- faz / iş paketi / liste satırlarını sürükleyerek sırala ---------- */
  var rdrag = null, rover = null;
  function rClear() { document.querySelectorAll('.g-lab[data-gk],tr[data-mrow]').forEach(function (x) { x.style.boxShadow = ''; x.style.opacity = ''; }); }
  function groupOf(p, w) {
    if (w.phase && p.phases.some(function (x) { return x.id === w.phase; })) return w.phase;
    var ph = p.phases.find(function (x) { return w.start && x.start && x.end && w.start >= x.start && w.start < x.end; });
    return ph ? ph.id : '';
  }
  function move(list, from, to, before) {
    var i = list.findIndex(function (x) { return x.id === from; }); if (i < 0) return null;
    var it = list.splice(i, 1)[0];
    var j = to == null ? -1 : list.findIndex(function (x) { return x.id === to; });
    if (j < 0) list.push(it); else list.splice(before ? j : j + 1, 0, it);
    return it;
  }
  document.addEventListener('dragstart', function (e) {
    var t = e.target; if (!t.closest) return;
    var g = t.closest('.kb-plan-host .g-lab[data-gk][draggable="true"]');
    var m = t.closest('.pl-modal td.pl-grip');
    if (!g && !m) return;
    e.stopPropagation();
    if (g) rdrag = { kind: g.getAttribute('data-gk'), id: g.getAttribute('data-gid'), pid: pidOf(g), el: g };
    else { var tr = m.closest('tr'); rdrag = { kind: 'mrow', i: +tr.getAttribute('data-mrow'), pid: UI.modal && UI.modal.pid, el: tr }; try { e.dataTransfer.setDragImage(tr, 20, 20); } catch (x) {} }
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'row'); } catch (x) {}
    setTimeout(function () { if (rdrag) rdrag.el.style.opacity = '.4'; }, 0);
  }, true);
  document.addEventListener('dragover', function (e) {
    if (!rdrag) return;
    e.stopPropagation(); e.preventDefault();
    var t = e.target.closest ? e.target : e.target.parentElement, tgt = null; rover = null;
    if (rdrag.kind === 'mrow') tgt = t.closest('.pl-modal tr[data-mrow]');
    else {
      tgt = t.closest('.kb-plan-host .g-lab[data-gk]');
      if (!tgt) { var tl = t.closest('.kb-plan-host .g-tl'); if (tl && tl.previousElementSibling && tl.previousElementSibling.matches('.g-lab[data-gk]')) tgt = tl.previousElementSibling; }
    }
    document.querySelectorAll('.g-lab[data-gk],tr[data-mrow]').forEach(function (x) { if (x !== tgt) x.style.boxShadow = ''; });
    if (!tgt || tgt === rdrag.el) return;
    var r = tgt.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2, gk = tgt.getAttribute('data-gk');
    if (rdrag.kind === 'phase' && gk !== 'phase') { tgt.style.boxShadow = ''; return; }
    if (rdrag.kind === 'wp' && gk !== 'wp') before = false;   // faz başlığına bırak: o fazın ilk paketi olur
    tgt.style.boxShadow = before ? 'inset 0 2px 0 #B9052D' : 'inset 0 -2px 0 #B9052D';
    rover = { el: tgt, before: before, gk: gk, id: tgt.getAttribute('data-gid'), grp: tgt.getAttribute('data-grp'), i: +tgt.getAttribute('data-mrow') };
    try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
  }, true);
  document.addEventListener('drop', function (e) {
    if (!rdrag) return;
    e.stopPropagation(); e.preventDefault();
    var d = rdrag, o = rover; rdrag = null; rover = null; rClear();
    if (!o || !d.pid || !canEdit(d.pid)) return;
    if (d.kind === 'mrow') {
      var M = MODALS[UI.modal.m]; if (!M || !M.list) return;
      patch(d.pid, function (p) { var L = p[M.list], it = L.splice(d.i, 1)[0]; var j = o.i > d.i ? o.i - 1 : o.i; L.splice(o.before ? j : j + 1, 0, it); }, { render: true });
      renderModal(); return;
    }
    if (d.kind === 'phase') { patch(d.pid, function (p) { move(p.phases, d.id, o.id, o.before); }, { render: true }); return; }
    if (d.kind === 'wp') {
      patch(d.pid, function (p) {
        var grp = o.grp || '';
        if (o.gk === 'wp') { var it = move(p.wps, d.id, o.id, o.before); if (it) it.phase = grp; return; }
        // faz başlığına (ya da "Diğer" başlığına) bırakıldı: o grubun en başına
        var first = p.wps.find(function (w) { return w.id !== d.id && groupOf(p, w) === grp; });
        var it2 = move(p.wps, d.id, first ? first.id : null, true); if (it2) it2.phase = grp;
      }, { render: true });
    }
  }, true);
  document.addEventListener('dragend', function () { if (rdrag) { rdrag = null; rover = null; } rClear(); }, true);

  /* ---------- simgeler ve stil ---------- */
  var SV = function (d) { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var ICO = {
    over: SV('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    board: SV('<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>'),
    time: SV('<line x1="3" y1="6" x2="13" y2="6"/><line x1="7" y1="12" x2="19" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>'),
    guide: SV('<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>'),
    page: SV('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>')
  };
  function mask(svgInner) { return 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + svgInner + '</svg>') + '")'; }
  var ICO_RAW = {
    over: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
    time: '<line x1="3" y1="6" x2="13" y2="6"/><line x1="7" y1="12" x2="19" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/>',
    guide: '<path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    page: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>'
  };
  var css = '.kb-subic{width:15px;height:15px;flex-shrink:0;display:inline-block;background:currentColor;-webkit-mask:center/contain no-repeat;mask:center/contain no-repeat}' +
    Object.keys(ICO_RAW).map(function (k) { return '.kb-subic[data-ic="' + k + '"]{-webkit-mask-image:' + mask(ICO_RAW[k]) + ';mask-image:' + mask(ICO_RAW[k]) + '}'; }).join('') +
    '.kb-plan-host{font-size:14px;line-height:1.5;color:var(--text-primary)}' +
    '.pl-in{max-width:1240px;padding:24px 40px 48px;display:flex;flex-direction:column;gap:22px}.pl-in.wide{max-width:none}.pl-in.note{max-width:860px}' +
    '.pl-in button,.pl-in input,.pl-in select,.pl-in textarea,.pl-modal button,.pl-modal input,.pl-modal select,.pl-modal textarea,.pl-pop button{font-family:inherit;color:inherit}' +
    '.pl-intro{display:flex;flex-direction:column;gap:8px}.pl-intro p{margin:0;max-width:80ch;color:var(--text-secondary);text-wrap:pretty}' +
    '.pl-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 18px;font-size:12px;color:var(--text-secondary)}.pl-meta b{color:var(--text-primary);font-weight:600}' +
    '.pl-link{border:0;background:transparent;padding:0;color:var(--text-accent);font-size:12px;font-weight:600;cursor:pointer}.pl-link:hover{text-decoration:underline}.pl-link.red{color:#B9052D}' +
    '.pl-btn{border:1px solid #B9052D;background:var(--surface-page);color:var(--text-accent);border-radius:5px;padding:7px 14px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap}.pl-btn:hover{background:rgba(185,5,45,.08)}.pl-btn.pri{background:#B9052D;color:#fff}.pl-btn.pri:hover{background:#8A0321}.pl-btn.sm{padding:4px 10px;font-size:12px}' +
    '.pl-empty{border:1px dashed var(--border-strong);border-radius:6px;padding:22px 24px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;color:var(--text-secondary)}.pl-empty b{color:var(--text-primary);font-size:15px}' +
    '.pl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}.pl-kpi{background:var(--surface-subtle);border-radius:6px;padding:16px 18px;display:flex;flex-direction:column;gap:2px;min-width:0}' +
    '.pl-kpi b{font-size:28px;font-weight:600;line-height:1.15;font-variant-numeric:tabular-nums}.pl-kpi b.acc{color:var(--text-accent)}.pl-kpi span{font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--text-secondary);text-transform:uppercase}.pl-kpi em{font-style:normal;font-size:12px;color:var(--text-muted)}' +
    '.pl-sec{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.pl-sec h2{margin:0;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;display:flex;flex-direction:column;gap:6px}.pl-sec h2::after{content:"";width:28px;height:2px;background:#B9052D}' +
    '.pl-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px;align-items:stretch}' +
    '.pl-card{border:1px solid var(--border-default);border-radius:6px;padding:18px 20px;display:flex;flex-direction:column;gap:12px;background:var(--surface-page);min-width:0;text-align:left}.pl-click{cursor:pointer}.pl-card.pl-click:hover{border-color:var(--text-muted)}' +
    '.pl-cardh{display:flex;align-items:center;gap:10px}.pl-cardh h3{margin:0;font-size:15px;font-weight:600}.pl-go{margin-left:auto;font-size:12px;color:var(--text-muted)}' +
    '.pl-ico{width:32px;height:32px;border-radius:6px;background:rgba(185,5,45,.10);color:var(--text-accent);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.pl-tpl{border-style:dashed;cursor:pointer;gap:6px;align-items:flex-start;color:var(--text-secondary)}.pl-tpl:hover{border-color:#B9052D}.pl-tpl b{color:var(--text-primary);font-size:15px}.pl-tpl small{font-size:12px}' +
    '.pl-stack{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--surface-muted)}' +
    '.pl-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--text-secondary);align-items:center}.pl-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:0}.pl-legend i.dia{transform:rotate(45deg)}' +
    '.pl-bar{display:block;height:6px;border-radius:3px;background:var(--surface-muted);overflow:hidden;margin-top:6px}.pl-bar>span{display:block;height:100%;background:#B9052D}' +
    '.pl-list{display:flex;flex-direction:column}.pl-it{display:flex;align-items:center;gap:12px;padding:10px 0;border:0;border-bottom:1px solid var(--surface-subtle);min-width:0;background:transparent;width:100%;text-align:left;font-size:13px}.pl-it:last-child{border-bottom:0}button.pl-it:hover{background:var(--surface-subtle)}' +
    '.pl-t{flex:1;min-width:0;display:flex;flex-direction:column}.pl-t b{font-size:13px;font-weight:500;overflow-wrap:anywhere}.pl-t small{font-size:12px;color:var(--text-muted)}' +
    '.pl-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}.pl-avs{display:inline-flex;gap:2px}' +
    '.pl-av{border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:600;flex-shrink:0}' +
    '.pl-pill{font-size:11px;font-weight:600;letter-spacing:.03em;padding:2px 8px;border-radius:3px;white-space:nowrap;display:inline-block}' +
    '.pl-chip{font-size:11px;font-weight:600;letter-spacing:.05em;padding:2px 8px;border-radius:3px;background:var(--surface-subtle);color:var(--text-secondary);border:1px solid var(--border-default);white-space:nowrap}.pl-chip.ok{background:#2E8B57;border-color:#2E8B57;color:#fff}.pl-chips{display:flex;flex-wrap:wrap;gap:6px}' +
    '.pl-due{font-size:12px;color:var(--text-secondary);white-space:nowrap;padding:1px 6px;border-radius:3px}.pl-due.today{color:var(--text-accent);font-weight:600;background:rgba(185,5,45,.10)}.pl-due.late{color:var(--text-accent);font-weight:600}' +
    '.pl-muted{color:var(--text-muted);font-size:13px}.sm{font-size:12px}.nowrap{white-space:nowrap}.fw5{font-weight:500}' +
    '.pl-row{display:flex;align-items:center;gap:12px;justify-content:space-between}.pl-row.sm{margin-bottom:0}.pl-row.g8{gap:8px;justify-content:flex-start}.pl-sp{flex:1}' +
    '.pl-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;align-items:start}' +
    '.pl-box{border:1px solid var(--border-default);border-radius:6px;padding:18px 20px;display:flex;flex-direction:column;gap:14px;min-width:0;background:var(--surface-page)}' +
    '.pl-inl{border:1px solid transparent;border-radius:4px;padding:2px 6px;margin-left:-6px;font-size:12px;color:var(--text-secondary);background:transparent;outline:none;width:100%}.pl-inl:hover{border-color:var(--border-default)}.pl-inl:focus{border-color:#B9052D;background:var(--surface-page)}' +
    '.pl-scroll{overflow-x:auto}.pl-tbl{width:100%;border-collapse:collapse;font-size:13px}.pl-tbl th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--text-muted);text-transform:uppercase;padding:8px 10px;border-bottom:1px solid var(--border-default);white-space:nowrap}' +
    '.pl-tbl td{padding:10px;border-bottom:1px solid var(--surface-subtle);vertical-align:middle}.pl-tbl tr:last-child td{border-bottom:0}.pl-tbl .num{text-align:right;font-variant-numeric:tabular-nums}.pl-tbl .ctr{text-align:center}' +
    '.pl-tbl.ed td{padding:4px 4px}.pl-tbl.ed input,.pl-tbl.ed select{width:100%;min-width:70px;border:1px solid transparent;border-radius:4px;padding:6px 8px;font-size:13px;background:transparent;outline:none}.pl-tbl.ed input:hover,.pl-tbl.ed select:hover{border-color:var(--border-default)}.pl-tbl.ed input:focus,.pl-tbl.ed select:focus{border-color:#B9052D;background:var(--surface-page)}.pl-tbl.ed input[type=checkbox]{width:auto;min-width:0;accent-color:#B9052D}' +
    '.pl-tbl.ed input.mono,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#0087A0}html[data-theme="dark"] .mono{color:#4FC3D6}' +
    '.pl-x{border:0;background:transparent;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;width:28px;height:28px;border-radius:4px}.pl-x:hover{background:var(--surface-subtle);color:var(--text-accent)}.pl-x.big{font-size:22px}' +
    '.pl-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
    '.pl-seg{display:inline-flex;border:1px solid var(--border-default);border-radius:5px;overflow:hidden}.pl-seg button{border:0;background:var(--surface-page);padding:6px 14px;font-size:12px;font-weight:500;cursor:pointer;color:var(--text-secondary)}.pl-seg button.on{background:#3F3F3F;color:#fff}' +
    '.pl-search,.pl-full{padding:8px 12px;border:1px solid var(--border-default);border-radius:5px;font-size:13px;outline:none;background:var(--surface-page);min-width:0}.pl-search{width:300px;max-width:100%}.pl-full{width:100%}.pl-search:focus,.pl-full:focus{border-color:#B9052D}' +
    /* gantt */
    '.gantt{border:1px solid var(--border-default);border-radius:6px;overflow:hidden}.g-wrap{overflow-x:auto}.g-tbl{display:grid;min-width:max-content}' +
    '.g-lab{position:sticky;left:0;background:var(--surface-page);z-index:2;padding:0 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--surface-subtle);border-right:1px solid var(--border-default);font-size:13px;min-height:38px;width:290px;box-sizing:border-box}' +
    '.g-lab.ph{font-weight:600;background:var(--surface-subtle)}.g-lab.wp{padding-left:28px}.g-lab small{color:var(--text-muted);font-size:11px;margin-left:auto;white-space:nowrap;font-weight:500}.g-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}' +
    '.g-tl{position:relative;border-bottom:1px solid var(--surface-subtle);min-height:38px}.g-tl.ph{background:var(--surface-subtle)}' +
    '.g-head{position:sticky;top:0;z-index:3;background:var(--surface-muted)!important;min-height:46px;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--text-secondary);text-transform:uppercase}.g-lab.g-head{z-index:4}' +
    '.g-months{display:flex;height:100%}.g-months div{border-left:1px solid var(--border-default);display:flex;flex-direction:column;justify-content:center;padding-left:6px;font-size:11px;white-space:nowrap;box-sizing:border-box}' +
    '.g-grid{position:absolute;inset:0;display:flex;pointer-events:none}.g-grid div{border-left:1px solid var(--surface-subtle);box-sizing:border-box}' +
    '.g-bar{min-width:6px;box-sizing:border-box;position:absolute;top:9px;height:20px;border-radius:4px;display:flex;align-items:center;overflow:hidden;font-size:11px;font-weight:600;color:#fff;white-space:nowrap}.g-bar .fill{position:absolute;inset:0 auto 0 0;background:rgba(0,0,0,.22)}.g-bar .tx{position:relative;padding:0 8px}.g-bar.phase{top:12px;height:14px;border-radius:3px;opacity:.9}' +
    '.g-ms{position:absolute;top:10px;width:16px;height:16px;transform:translateX(-8px) rotate(45deg);border:2px solid var(--surface-page);box-shadow:0 0 0 1px var(--text-secondary);z-index:1}.g-ms-l{position:absolute;top:9px;font-size:11px;font-weight:600;white-space:nowrap}' +
    '.g-today{position:absolute;top:0;bottom:0;width:2px;background:#B9052D;z-index:1;pointer-events:none}.g-today-l{position:absolute;bottom:3px;transform:translateX(-50%);background:#B9052D;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;letter-spacing:.04em;z-index:2}' +
    '.pl-sw{width:8px;height:8px;border-radius:2px;flex-shrink:0}' +
    '.g-lab[draggable="true"]{cursor:grab}.g-grip{color:var(--text-muted);font-size:11px;letter-spacing:-2px;margin-left:-8px;opacity:0;transition:opacity .12s;user-select:none}.g-lab:hover .g-grip{opacity:1}' +
    '.pl-tbl td.pl-grip{cursor:grab;color:var(--text-muted);font-size:12px;letter-spacing:-2px;text-align:center;user-select:none;padding:0 2px!important}.pl-tbl td.pl-grip:hover{color:var(--text-accent)}' +
    /* v */
    '.pl-vwrap{border:1px solid var(--border-default);border-radius:6px;padding:16px;overflow-x:auto}.pl-vwrap svg{display:block;width:100%;min-width:760px;height:auto;font-family:inherit}' +
    '.vnode{cursor:pointer}.vnode rect.box{fill:var(--surface-page);stroke:var(--border-default);stroke-width:1.5}.vnode:hover rect.box{stroke:var(--text-muted)}.vnode.sel rect.box{stroke:#B9052D;stroke-width:2.5}.vnode text{fill:var(--text-primary)}.vnode .sub{fill:var(--text-muted);font-size:11px}.vnode .pc{fill:var(--text-secondary)}' +
    '.pl-num{width:72px;padding:4px 8px;border:1px solid var(--border-default);border-radius:4px;background:var(--surface-page)}' +
    /* guide */
    '.pl-dg{display:grid;grid-template-columns:290px minmax(0,1fr);gap:20px;align-items:start}' +
    '.pl-dgl{display:flex;flex-direction:column;gap:12px;position:sticky;top:0}.pl-dgg{border:1px solid var(--border-default);border-radius:6px;overflow:hidden}.pl-dgg>:last-child{border-bottom:0!important}.pl-new{width:8px;height:8px;border-radius:50%;background:#B9052D;flex-shrink:0}.pl-dgs{padding:10px 14px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-secondary);background:var(--surface-subtle);border-bottom:1px solid var(--border-default)}' +
    '.pl-dgl button{display:flex;align-items:center;gap:8px;width:100%;border:0;border-bottom:1px solid var(--surface-subtle);background:var(--surface-page);text-align:left;padding:10px 14px;cursor:pointer;font-size:13px}.pl-dgl button>span:first-child{flex:1;min-width:0}.pl-dgl button:hover{background:var(--surface-subtle)}.pl-dgl button.on{background:rgba(185,5,45,.08);color:var(--text-accent);font-weight:600}' +
    '.pl-dgl button.pl-dgadd{color:var(--text-muted);font-size:12px;font-weight:600}.pl-dgl button.pl-dgadd:hover{color:var(--text-accent)}.pl-dgnone{padding:10px 14px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--surface-subtle)}' +
    '.pl-comp{gap:16px}.pl-ttl{font-size:22px;font-weight:600;border:1px solid transparent;border-radius:5px;padding:4px 6px;margin-left:-7px;outline:none;background:transparent;width:100%}.pl-ttl:hover{border-color:var(--border-default)}.pl-ttl:focus{border-color:#B9052D}.pl-ttl.big{font-size:30px;margin-left:-7px}' +
    '.pl-props,.pl-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 14px}.pl-props label,.pl-form label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;letter-spacing:.05em;color:var(--text-muted);text-transform:uppercase}.pl-props label.wide,.pl-form label.wide{grid-column:1/-1}' +
    '.pl-props input,.pl-props select,.pl-form input,.pl-form select,.pl-form textarea,.pl-area{font-size:13px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--text-primary);padding:7px 10px;border:1px solid var(--border-default);border-radius:5px;background:var(--surface-page);outline:none;width:100%;box-sizing:border-box}' +
    '.pl-props input:focus,.pl-props select:focus,.pl-form input:focus,.pl-form select:focus,.pl-form textarea:focus,.pl-area:focus{border-color:#B9052D}.pl-area{resize:vertical;line-height:1.6}.pl-form textarea{resize:vertical}' +
    '.pl-notes,.pl-body{outline:none;line-height:1.6}.pl-notes{min-height:90px;border:1px solid var(--border-default);border-radius:5px;padding:10px 12px}.pl-notes:focus{border-color:#B9052D}' +
    '.pl-notes:empty::before,.pl-body:empty::before{content:attr(data-ph);color:var(--text-muted)}.pl-body{min-height:340px;font-size:15px;line-height:1.7}.pl-body h2{font-size:20px;margin:18px 0 6px}.pl-body h3{font-size:16px;margin:14px 0 4px}.pl-body a,.pl-notes a{color:#0087A0}html[data-theme="dark"] .pl-body a,html[data-theme="dark"] .pl-notes a{color:#4FC3D6}' +
    '.pl-fmt{display:flex;gap:4px;flex-wrap:wrap;border:1px solid var(--border-default);border-radius:6px;padding:4px;background:var(--surface-subtle);width:max-content;max-width:100%}.pl-fmt button{border:0;background:transparent;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer}.pl-fmt button:hover{background:var(--surface-muted)}' +
    '.pl-in input:disabled,.pl-in select:disabled,.pl-in textarea:disabled{opacity:1;background:transparent;border-color:transparent;-webkit-text-fill-color:var(--text-primary);appearance:none}' +
    /* modal + pop */
    '.pl-mwrap{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px}.pl-mscrim{position:absolute;inset:0;background:rgba(0,0,0,.32)}' +
    '.pl-modal{position:relative;width:min(980px,100%);max-height:88vh;display:flex;flex-direction:column;background:var(--surface-page);color:var(--text-primary);border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-size:14px}' +
    '.pl-mh{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--border-default)}.pl-mh h3{margin:0;font-size:17px;font-weight:600}' +
    '.pl-mb{padding:16px 22px;overflow:auto;display:flex;flex-direction:column;gap:14px}.pl-mf{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 22px;border-top:1px solid var(--border-default)}' +
    '.pl-pop{position:fixed;z-index:70;width:320px;max-width:calc(100vw - 16px);background:var(--surface-page);color:var(--text-primary);border:1px solid var(--border-default);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:6px;display:flex;flex-direction:column;gap:2px;font-size:13px}' +
    '.pl-poph{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);padding:8px 10px 4px}' +
    '.pl-pop button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;border-radius:5px;padding:8px 10px;text-align:left;cursor:pointer}.pl-pop button:hover:not(:disabled){background:var(--surface-subtle)}.pl-pop button:disabled{opacity:.45;cursor:default}.pl-pop button.red b{color:#B9052D}html[data-theme="dark"] .pl-pop button.red b{color:#F2557A}.pl-popsep{height:1px;background:var(--border-default);margin:4px 6px}' +
    '.kb-subnav::-webkit-scrollbar{height:0}[data-kb-sub][draggable="true"]{cursor:grab}' +
    '.pl-plab{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;letter-spacing:.05em;color:var(--text-muted);text-transform:uppercase;grid-column:1/-1}' +
    '.pl-owners{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:36px;text-transform:none;letter-spacing:0}' +
    '.pl-own{display:inline-flex;align-items:center;gap:6px;padding:3px 4px 3px 4px;border:1px solid var(--border-default);border-radius:999px;font-size:13px;font-weight:500;color:var(--text-primary)}.pl-own>span:not(.pl-av){padding-right:2px}.pl-own .pl-x{width:22px;height:22px;font-size:15px;border-radius:50%}' +
    '.pl-ownadd{border:1px dashed var(--border-default);background:transparent;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer}.pl-ownadd:hover{border-color:#B9052D;color:var(--text-accent)}' +
    '.pl-chk{width:18px;height:18px;border:1.5px solid var(--border-strong);border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}.pl-chk.on{background:#B9052D;border-color:#B9052D}' +
    '.pl-drop{border:1.5px dashed var(--border-default);border-radius:6px;padding:14px;text-align:center;font-size:13px;color:var(--text-muted);cursor:pointer}.pl-drop:hover,.pl-drop.over{border-color:#B9052D;background:var(--surface-subtle);color:var(--text-secondary)}' +
    '.pl-files:empty{display:none}.pl-files{display:flex;flex-direction:column;gap:10px}.pl-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}' +
    '.pl-imgit{position:relative;border:1px solid var(--border-default);border-radius:6px;overflow:hidden;aspect-ratio:4/3;background:var(--surface-subtle)}.pl-imgit img{width:100%;height:100%;object-fit:cover;display:block}.pl-imgit .pl-x{position:absolute;top:4px;right:4px;background:var(--surface-page);box-shadow:0 1px 3px rgba(0,0,0,.2)}' +
    '.pl-ext{width:40px;height:40px;border-radius:5px;background:var(--surface-subtle);border:1px solid var(--border-default);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--text-secondary);flex-shrink:0}.pl-files .pl-t a{color:inherit;text-decoration:none}.pl-files .pl-t a:hover b{color:var(--text-accent);text-decoration:underline}' +
    '.pl-flab{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;letter-spacing:.05em;color:var(--text-muted);text-transform:uppercase;grid-column:1/-1}.pl-flab .pl-notes{font-size:13px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--text-primary);min-height:80px}' +
    '.pl-sum{max-width:80ch;color:var(--text-secondary);line-height:1.6}.pl-sum ul,.pl-sum ol,.pl-notes ul,.pl-notes ol,.pl-body ul,.pl-body ol{margin:4px 0;padding-left:22px}.pl-sum a{color:#0087A0}html[data-theme="dark"] .pl-sum a{color:#4FC3D6}' +
    '.pl-notes[contenteditable="false"],.pl-body[contenteditable="false"]{border-color:transparent;padding-left:0}' +
    '@media (max-width:768px){.pl-in{padding:16px 16px 40px}.pl-dg{grid-template-columns:1fr}.pl-dgl{position:static}.g-lab{width:170px}.pl-two{grid-template-columns:1fr}.pl-search{width:100%}.pl-mwrap{padding:0;align-items:flex-end}.pl-modal{max-height:92vh;border-radius:12px 12px 0 0}.kb-subnav{flex-wrap:nowrap!important;overflow-x:auto}.kb-subnav>*{flex-shrink:0}}';
  function injectCss() { if (document.getElementById('kbpl-css')) return; var s = document.createElement('style'); s.id = 'kbpl-css'; s.textContent = css; document.head.appendChild(s); }
  if (document.head) injectCss(); else document.addEventListener('DOMContentLoaded', injectCss);

  window.__kbPlan = {
    tick: function () { start(); refresh(); },
    getSub: getSub, setSub: setSub, navFor: navFor,
    hasBoard: function (pid) { return hasPage(pid, 'board'); },
    chgTotal: chgTotal, markSeen: markSeen,
    sysOpts: sysOpts, wpOpts: wpOpts, chipsFor: chipsFor,
    _plan: plan
  };
})();
