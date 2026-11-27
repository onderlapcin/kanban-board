/* FEV Kanban – Supabase bağlantı katmanı.
   Board kodu verilere window.claude.use('user' | 'db' | 'assets') üzerinden ulaşır;
   bu dosya o arayüzü Supabase (giriş, veritabanı, dosya depolama) ile sağlar. */
(function () {
  'use strict';
  var C = window.KB_CONFIG || {};
  var OWNER = String(C.OWNER_EMAIL || '').trim().toLowerCase();
  var BUCKET = C.BUCKET || 'attachments';
  var sb = null, session = null, noAccess = false;

  /* ---------- aydınlık / karanlık mod (tercih bu tarayıcıda saklanır; varsayılan aydınlık) ---------- */
  var THEME_KEY = 'kb-theme';
  function readTheme() { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } }
  var theme = readTheme();
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
    var m = document.querySelector('meta[name="color-scheme"]');
    if (!m) { m = document.createElement('meta'); m.name = 'color-scheme'; (document.head || document.documentElement).appendChild(m); }
    m.content = theme;
  }
  (function () {
    var st = document.createElement('style');
    st.id = 'kb-theme-css';
    st.textContent =
      'html[data-theme="dark"]{color-scheme:dark;' +
        '--text-primary:#F1F1F3;--text-secondary:#C9C9CE;--text-muted:#8E8E95;--text-accent:#F2557A;--text-inverse:#FFFFFF;' +
        '--link:#F2557A;--link-visited:#F2557A;' +
        '--surface-page:#18191C;--surface-subtle:#222428;--surface-muted:#34363B;--surface-dark:#45474D;' +
        '--border-default:#34363B;--border-strong:#6A6C73;' +
        '--fev-white:#18191C;--fev-black:#F1F1F3;--fev-grey-100:#222428;--fev-grey-200:#34363B;--fev-grey-800:#C9C9CE;--fev-grey-900:#E0E0E4;--fev-grey-500:#8E8E95}' +
      'html[data-theme="dark"],html[data-theme="dark"] body{background:#18191C;color:#F1F1F3}' +
      'html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] textarea{background-color:#18191C;color:#F1F1F3}' +
      'html[data-theme="dark"] input::placeholder,html[data-theme="dark"] textarea::placeholder{color:#7A7A82}' +
      /* tasarım sistemi düğmeleri: kırmızı/koyu zemin üstünde yazı beyaz kalsın */
      'html[data-theme="dark"] [style*="color: var(--fev-white)"]{color:#fff!important}' +
      'html[data-theme="dark"] button[style*="background: var(--fev-grey-800)"]{background:#45474D!important}' +
      'html,body,aside,main,div,span,button,input,select,textarea{transition:background-color .15s,border-color .15s,color .15s}';
    (document.head || document.documentElement).appendChild(st);
  })();
  applyTheme();
  try { document.documentElement.lang = 'tr'; } catch (e) {}   // büyük harfe çevirmede İ/I doğru olsun

  /* ---------- yeni sürüm uyarısı: site güncellenince açık sayfalara "Yenile" bildirimi ---------- */
  (function () {
    var shownFor = null, bar = null;
    function show(v) {
      if (shownFor === v) return; shownFor = v;
      if (!styled) { document.head.appendChild(h('style', { text: CSS })); styled = true; }
      if (bar) bar.remove();
      var reload = h('button', { class: 'kbx-upd-go', type: 'button', text: 'Yenile' });
      reload.addEventListener('click', function () { location.reload(); });
      var close = h('button', { class: 'kbx-upd-x', type: 'button', 'aria-label': 'Kapat', title: 'Kapat', text: '×' });
      close.addEventListener('click', function () { bar.remove(); bar = null; });
      bar = h('div', { class: 'kbx kbx-upd', role: 'status' }, [
        h('span', { class: 'kbx-upd-dot' }),
        h('span', { class: 'kbx-upd-t', text: 'Kanban board güncellendi. Yeni sürümü görmek için sayfayı yenile.' }),
        reload, close
      ]);
      document.body.appendChild(bar);
    }
    function check() {
      if (!window.KB_BUILD || document.hidden) return;
      fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.v && j.v !== window.KB_BUILD) show(j.v); })
        .catch(function () {});
    }
    setTimeout(check, 15000);
    setInterval(check, 60 * 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    window.addEventListener('focus', check);
  })();

  /* ---------- telefon düzeni (yalnızca dar ekranlarda; bilgisayar görünümü değişmez) ---------- */
  var PHONE_MQ = '(max-width: 768px)';
  function isPhone() { try { return window.matchMedia(PHONE_MQ).matches; } catch (e) { return false; } }
  var phoneSideOpen = false;   // telefonda menü her açılışta kapalı başlar
  function rerender() { try { if (window.__kbRerender) window.__kbRerender(); } catch (e) {} }
  try { window.matchMedia(PHONE_MQ).addEventListener('change', function () { phoneSideOpen = false; rerender(); }); } catch (e) {}
  // profil penceresi açıkken dışına tıklanırsa kapat
  document.addEventListener('pointerdown', function (e) {
    var t = e.target;
    if (!t || !t.closest || !document.querySelector('.kb-profile')) return;
    if (t.closest('.kb-profile') || t.closest('.kb-profcard')) return;
    if (window.__kbCloseProfile) window.__kbCloseProfile();
  }, true);
  document.addEventListener('click', function (e) {
    if (isPhone() && phoneSideOpen && e.target && e.target.closest && e.target.closest('[data-kb-nav]')) {
      setTimeout(function () { phoneSideOpen = false; rerender(); }, 0);
    }
  }, true);
  (function () {
    var st = document.createElement('style');
    st.id = 'kb-phone-css';
    st.textContent =
      '.kb-scrim,.kb-mbtn{display:none}' +
      '@media ' + PHONE_MQ + '{' +
        '.kb-root{height:100vh!important;height:100dvh!important}' +
        '.kb-rail{display:none!important}' +
        '.kb-aside{position:fixed!important;left:0;top:0;bottom:0;z-index:26;width:min(300px,86vw)!important;box-shadow:4px 0 24px rgba(0,0,0,.25)}' +
        '.kb-scrim{display:block;position:fixed;inset:0;z-index:25;background:rgba(0,0,0,.35)}' +
        '.kb-mbtn{display:flex;align-items:center;justify-content:center;position:fixed;top:12px;left:12px;z-index:16;width:38px;height:38px;border-radius:6px;border:1px solid var(--border-default);background:var(--surface-page);color:var(--text-primary);box-shadow:0 1px 6px rgba(0,0,0,.12);cursor:pointer;padding:0}' +
        '.kb-phead{padding:60px 16px 0!important;gap:14px!important}' +
        '.kb-phead h1,.kb-home h1{font-size:21px!important}' +
        '.kb-ptitle{gap:12px!important}' +
        '.kb-tools{flex-direction:column;align-items:stretch!important;gap:8px!important}' +
        '.kb-tabs{gap:18px!important;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}' +
        '.kb-tabs button{flex-shrink:0}' +
        '.kb-search{width:100%!important;flex:1;min-width:0}' +
        '.kb-sec{padding:14px 16px 20px!important;scroll-snap-type:x mandatory}' +
        '.kb-cols{gap:12px!important}' +
        '.kb-col{width:84vw!important;scroll-snap-align:start}' +
        '.kb-home{padding:60px 16px 24px!important;gap:20px!important}' +
        '.kb-charts{grid-template-columns:1fr!important}' +
        '.kb-chartin{grid-template-columns:1fr!important}' +
        '.kb-foot{display:none!important}' +
        '.kb-detail{width:100%!important}' +
        '.kb-modalwrap{padding:0!important}' +
        '.kb-modal{width:100%!important;height:100%;max-height:100%!important;border-radius:0!important;padding:22px 16px!important}' +
        '.kbx-fab{bottom:14px!important;right:12px!important;padding:8px 12px!important}' +
      '}';
    (document.head || document.documentElement).appendChild(st);
  })();

  function client() {
    if (sb) return sb;
    var lib = window.supabase;
    if (!lib || !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) return null;
    sb = lib.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
    return sb;
  }

  function cleanUrl() {
    try {
      var u = new URL(location.href), dirty = false;
      ['code', 'error', 'error_code', 'error_description', 'state'].forEach(function (k) {
        if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; }
      });
      if (dirty) history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) {}
  }

  var authError = '';
  try {
    var q = new URLSearchParams(location.search);
    authError = q.get('error_description') || q.get('error') || '';
  } catch (e) {}

  var ready = (async function () {
    var c = client();
    if (!c) return null;
    try {
      var r = await c.auth.getSession();
      session = r && r.data ? r.data.session : null;
    } catch (e) { session = null; }
    cleanUrl();
    c.auth.onAuthStateChange(function (ev, s) {
      var had = !!session;
      session = s;
      if (ev === 'SIGNED_OUT' && had) location.reload();
    });
    if (session) {
      try {
        var a = await c.rpc('board_access');
        noAccess = !(a && a.data === true);
      } catch (e) { noAccess = true; }
    }
    return session;
  })();

  // Kullanıcı adıyla kayıtlar, e-posta gönderilmeyen bu alan adı altında tutulur.
  var USER_DOMAIN = String(C.USERNAME_DOMAIN || 'users.onderlapcin.github.io').toLowerCase();
  function rawEmail() { return String((session && session.user && session.user.email) || '').toLowerCase(); }
  function usernameOf(em) { return em && em.slice(-(USER_DOMAIN.length + 1)) === '@' + USER_DOMAIN ? em.split('@')[0] : ''; }
  // Gerçek e-posta (kullanıcı adı hesaplarında boş)
  function email() { var e = rawEmail(); return usernameOf(e) ? '' : e; }

  /* ---------- user ---------- */
  var user = {
    me: async function () {
      var u = session.user, m = u.user_metadata || {}, un = usernameOf(rawEmail());
      return { id: u.id, name: un || m.full_name || m.name || '', email: email() || null, avatarUrl: '', color: '#B9052D',
        isOwner: !!OWNER && email() === OWNER, canEdit: !!OWNER && email() === OWNER };
    },
    id: async function () { return session.user.id; },
    email: async function () { return email() || null; },
    isOwner: function () { return !!OWNER && email() === OWNER; },
    canEdit: function () { return !!OWNER && email() === OWNER; },
    can: async function () { return null; },
    profiles: async function () { return {}; }
  };

  /* ---------- db: Firestore benzeri küçük arayüz, tek "docs" tablosu ---------- */
  var cache = new Map();          // path -> data
  var loaded = false, loading = null;
  var subs = [];
  var notifyT = null;

  function collOf(path) { var s = path.split('/'); s.pop(); return s.join('/'); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  async function loadAll() {
    var c = client(), all = [], from = 0, size = 1000;
    for (;;) {
      var r = await c.from('docs').select('path,coll,data').range(from, from + size - 1);
      if (r.error) throw r.error;
      all = all.concat(r.data || []);
      if (!r.data || r.data.length < size) break;
      from += size;
    }
    var next = new Map();
    all.forEach(function (row) { next.set(row.path, row.data); });
    var changed = !loaded || next.size !== cache.size;
    if (!changed) next.forEach(function (v, k) { if (!changed && JSON.stringify(cache.get(k)) !== JSON.stringify(v)) changed = true; });
    cache = next; loaded = true;
    if (changed) notify();
  }

  function snapFor(s) {
    if (s.kind === 'col') {
      var docs = [];
      cache.forEach(function (v, k) {
        if (collOf(k) === s.path) docs.push({ id: k.split('/').pop(), exists: true, data: (function (d) { return function () { return clone(d); }; })(v), metadata: { fromCache: false, hasPendingWrites: false } });
      });
      return { docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: function () { return []; } };
    }
    var has = cache.has(s.path), d = cache.get(s.path);
    return { id: s.path.split('/').pop(), exists: has, data: function () { return has ? clone(d) : undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }

  function notify() {
    clearTimeout(notifyT);
    notifyT = setTimeout(function () {
      subs.forEach(function (s) { if (!s.dead) { try { s.next(snapFor(s)); } catch (e) { console.error(e); } } });
    }, 30);
  }

  var channel = null;
  function startRealtime() {
    if (channel) return;
    var c = client();
    channel = c.channel('kb-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, function (p) {
        if (p.eventType === 'DELETE') { var op = p.old && p.old.path; if (op && cache.has(op)) { cache.delete(op); notify(); } return; }
        var row = p.new; if (!row || !row.path) return;
        if (JSON.stringify(cache.get(row.path)) !== JSON.stringify(row.data)) { cache.set(row.path, row.data); notify(); }
      })
      .subscribe(function (st) { if (st === 'SUBSCRIBED' && loaded) loadAll().catch(function () {}); });
    // Kaçırılan değişikliklere (ve ekipten çıkarılmaya) karşı: sekmeye dönünce ve 30 sn'de bir yeniden oku
    document.addEventListener('visibilitychange', function () { if (!document.hidden) loadAll().catch(function () {}); });
    setInterval(function () { if (!document.hidden) loadAll().catch(function () {}); }, 30000);
  }

  function ensureLoaded() {
    if (!loading) loading = loadAll().then(startRealtime);
    return loading;
  }

  function err(e) {
    var m = (e && (e.message || e.details)) || 'unknown';
    var code = /row-level security|permission|not allowed|42501/i.test(m + (e && e.code)) ? 'permission_denied'
      : /too large|payload/i.test(m) ? 'invalid_argument' : 'unavailable';
    var x = new Error(m); x.code = code; return x;
  }

  function ref(path) {
    var isCol = path.split('/').length % 2 === 1;
    return {
      path: path, id: path.split('/').pop(),
      onSnapshot: function (next, onErr) {
        var s = { path: path, kind: isCol ? 'col' : 'doc', next: next, dead: false };
        subs.push(s);
        ensureLoaded().then(function () { if (!s.dead) next(snapFor(s)); }, function (e) { if (onErr) onErr(err(e)); });
        return function () { s.dead = true; };
      },
      get: async function () { await ensureLoaded(); return snapFor({ path: path, kind: 'doc' }); },
      set: async function (data) {
        var r = await client().from('docs').upsert({ path: path, coll: collOf(path), data: data }, { onConflict: 'path' });
        if (r.error) throw err(r.error);
        cache.set(path, clone(data)); notify();
      },
      delete: async function () {
        var r = await client().from('docs').delete().eq('path', path);
        if (r.error) throw err(r.error);
        cache.delete(path); notify();
      },
      acquire: async function () { return { acquired: true }; },
      doc: function (id) { return ref(path + '/' + id); },
      collection: function (id) { return ref(path + '/' + id); }
    };
  }
  var db = { doc: ref, collection: ref };

  /* ---------- assets: ekler Supabase Storage'a ---------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  var assets = {
    upload: async function (blob) {
      var name = String((blob && blob.name) || 'dosya').replace(/[^\w.\-]+/g, '_').slice(-80);
      var path = uuid() + '/' + name;
      var r = await client().storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
      if (r.error) throw err(r.error);
      var pu = client().storage.from(BUCKET).getPublicUrl(path);
      return { id: path, url: pu.data.publicUrl, sizeBytes: blob.size || 0, contentType: blob.type || '' };
    },
    list: async function () { return { assets: [], usage: {} }; },
    delete: async function () {}
  };

  window.claude = {
    use: async function (name) {
      await ready;
      if (!session) return null;
      if (name === 'user') return user;
      if (name === 'db') return noAccess ? null : db;
      if (name === 'assets') return noAccess ? null : assets;
      return null;
    }
  };

  window.__kb = {
    configured: !!client(),
    authError: authError,
    ready: ready,
    hasNoAccess: function () { return noAccess; },
    isDark: function () { return theme === 'dark'; },
    isSideHidden: function () {
      if (isPhone()) return !phoneSideOpen;
      try { return localStorage.getItem('kb-side') === 'hidden'; } catch (e) { return false; }
    },
    toggleSide: function () {
      if (isPhone()) { phoneSideOpen = !phoneSideOpen; return !phoneSideOpen; }
      var hide = !window.__kb.isSideHidden();
      try { localStorage.setItem('kb-side', hide ? 'hidden' : 'shown'); } catch (e) {}
      return hide;
    },
    deleteAuthUser: function (id) { var c = client(); return c ? c.rpc('kb_delete_user', { target: id }) : Promise.resolve({ error: { message: 'Bağlantı yok' } }); },
    setEditing: function (pid, taskId) {
      pid = pid || ''; taskId = taskId || null;
      if (pid === pres.me && taskId === pres.task) return;
      pres.me = pid; pres.task = taskId; presPush();
    },
    editorsOf: function (taskId) { return (taskId && pres.others[taskId]) || []; },
    _presence: presApply,
    isUsernameAccount: function () { return !!(session && usernameOf(rawEmail())); },
    toggleTheme: function () {
      theme = theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
      applyTheme();
      return theme === 'dark';
    },
    signIn: function (provider) {
      var c = client();
      if (!c) { alert('Board henüz yapılandırılmadı (config.js).'); return; }
      var opts = { redirectTo: location.origin + location.pathname };
      if (provider === 'azure') opts.scopes = 'email';
      c.auth.signInWithOAuth({ provider: provider, options: opts });
    },
    signOut: async function () {
      var c = client();
      try { if (c) await c.auth.signOut(); } catch (e) {}
      location.reload();
    }
  };

  /* =====================================================================
     Arayüz: giriş ekranı (Google + kullanıcı adı/şifre), onay bekleme
     ekranı ve yöneticinin onay paneli. Board'un kendi ekranlarının üstünde
     çalışır; board koduna dokunmaz.
     ===================================================================== */
  var CSS = '' +
    '.kbx{--r:#B9052D;--rd:#8A0321;--t:#000;--t2:#3F3F3F;--m:#797979;--b:#DBDBDB;--s:#F2F2F2;--w:#fff;font-family:Poppins,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--t);box-sizing:border-box}' +
    '.kbx *{box-sizing:border-box;font-family:inherit}' +
    '.kbx-upd{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483600;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);padding:10px 10px 10px 16px;border-radius:8px;background:var(--w);color:var(--t);border:1px solid var(--b);box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:13px}' +
    '.kbx-upd-dot{width:8px;height:8px;border-radius:50%;background:var(--r);flex-shrink:0}' +
    '.kbx-upd-t{line-height:1.35}' +
    '.kbx-upd-go{border:0;background:var(--r);color:#fff;border-radius:5px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0}' +
    '.kbx-upd-x{border:0;background:transparent;color:var(--m);font-size:18px;line-height:1;cursor:pointer;padding:2px 6px;flex-shrink:0}' +
    '.kbx-appr{display:flex;flex-direction:column;gap:6px;padding-bottom:6px;border-bottom:1px solid var(--b);margin-bottom:4px}' +
    '.kbx-apph{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--t2)}' +
    '.kbx-appp{font-size:12px;line-height:1.4;color:var(--m);margin:0}' +
    'html[data-theme="dark"] .kbx{--t:#F1F1F3;--t2:#C9C9CE;--m:#8E8E95;--b:#34363B;--s:#26282C;--w:#18191C}' +
    'html[data-theme="dark"] .kbx-tabs button.on,html[data-theme="dark"] .kbx-av{background:#45474D}' +
    'html[data-theme="dark"] .kbx-err{color:#F2557A}' +
    'html[data-theme="dark"] .kbx-acts button.del{color:#FF8A80;border-color:#5A2A2E}html[data-theme="dark"] .kbx-acts button.del:hover{background:#3A1F22}' +
    'html[data-theme="dark"] .kbx-panel{background:rgba(0,0,0,.6)}' +
    '.kbx-ov{position:fixed;inset:0;z-index:2147483600;background:var(--w);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}' +
    '.kbx-card{width:100%;max-width:340px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}' +
    '.kbx-logo{width:48px;height:48px;background:var(--r);display:flex;align-items:flex-start;justify-content:center;gap:4px;padding-top:12px}' +
    '.kbx-logo i{display:block;width:7px;background:#fff}' +
    '.kbx h1{margin:0;font-size:20px;font-weight:600}' +
    '.kbx p{margin:0;font-size:13px;line-height:1.5;color:var(--t2)}' +
    '.kbx-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:10px 16px;border:1px solid var(--b);border-radius:5px;background:var(--w);color:var(--t);font-size:13px;font-weight:500;cursor:pointer}' +
    '.kbx-btn:hover{background:var(--s)}' +
    '.kbx-btn.pri{background:var(--r);border-color:var(--r);color:#fff}.kbx-btn.pri:hover{background:var(--rd)}' +
    '.kbx-btn[disabled]{opacity:.6;cursor:default}' +
    '.kbx-or{display:flex;align-items:center;gap:10px;width:100%;color:var(--m);font-size:11px}.kbx-or:before,.kbx-or:after{content:"";flex:1;height:1px;background:var(--b)}' +
    '.kbx-tabs{display:flex;width:100%;border:1px solid var(--b);border-radius:5px;overflow:hidden}' +
    '.kbx-tabs button{flex:1;border:0;background:var(--w);padding:8px;font-size:12px;font-weight:500;color:var(--t2);cursor:pointer}' +
    '.kbx-tabs button.on{background:var(--t2);color:#fff}' +
    '.kbx-form{display:flex;flex-direction:column;gap:8px;width:100%;text-align:left}' +
    '.kbx-form label{font-size:11px;color:var(--t2)}' +
    '.kbx-form input{width:100%;padding:9px 10px;border:1px solid var(--b);border-radius:5px;font-size:13px;outline:none;background:var(--w);color:var(--t)}' +
    '.kbx-form input:focus{border-color:var(--r)}' +
    '.kbx-hint{font-size:11px;color:var(--m);line-height:1.4}' +
    '.kbx-err{font-size:12px;color:var(--r);line-height:1.4;min-height:0}' +
    '.kbx-fab{position:fixed;right:16px;bottom:60px;z-index:15;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;background:var(--r);color:#fff;font-size:12px;font-weight:600;padding:9px 14px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18)}' +
    '.kbx-fab b{background:#fff;color:var(--r);border-radius:999px;min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;padding:0 6px}' +
    '.kbx-fab.idle{background:var(--w);color:var(--t2);border:1px solid var(--b);box-shadow:0 1px 6px rgba(0,0,0,.10)}.kbx-fab.idle b{background:var(--s);color:var(--m)}.kbx-fab.idle:hover{border-color:var(--r);color:var(--r)}' +
    '.kbx-panel{position:fixed;inset:0;z-index:2147483550;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.kbx-pbox{background:var(--w);width:100%;max-width:520px;max-height:85vh;overflow:auto;border-radius:6px;padding:22px;display:flex;flex-direction:column;gap:12px;text-align:left}' +
    '.kbx-ph{display:flex;align-items:center;justify-content:space-between;gap:10px}.kbx-ph h2{margin:0;font-size:17px;font-weight:600}' +
    '.kbx-x{border:1px solid var(--b);background:var(--w);border-radius:5px;width:30px;height:30px;cursor:pointer;font-size:16px;line-height:1;color:var(--t)}' +
    '.kbx-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--s);flex-wrap:wrap}' +
    '.kbx-av{width:34px;height:34px;border-radius:50%;background:var(--t2);color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.kbx-who{flex:1;min-width:140px;display:flex;flex-direction:column;gap:2px}.kbx-who strong{font-size:13px;font-weight:500;overflow-wrap:anywhere}.kbx-who span{font-size:11px;color:var(--m);overflow-wrap:anywhere}' +
    '.kbx-acts{display:flex;gap:6px}.kbx-acts button{border:1px solid var(--b);background:var(--w);border-radius:5px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--t)}' +
    '.kbx-acts button.ok{background:var(--r);border-color:var(--r);color:#fff}' +
    '.kbx-acts button.del{color:#b42318;border-color:#f1c0bb}.kbx-acts button.del:hover{background:#fdecea}.kbx-sec{font-size:12px;font-weight:600;color:var(--m);margin:18px 0 6px}' +
    '.kbx-tag{font-size:10px;font-weight:600;color:var(--m);border:1px solid var(--b);border-radius:9px;padding:0 6px;line-height:16px}' +
    '.kbx-empty{font-size:13px;color:var(--m);padding:12px 0}' +
    '.kbx-link{border:0;background:transparent;color:var(--m);font-size:12px;cursor:pointer;padding:0;text-decoration:underline}';

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function svg(markup) { var s = document.createElement('span'); s.style.display = 'inline-flex'; s.innerHTML = markup; return s; }
  function logo() { return h('div', { class: 'kbx-logo' }, [h('i', { style: 'height:24px' }), h('i', { style: 'height:16px' }), h('i', { style: 'height:20px' })]); }
  var GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

  var styled = false;
  function mount(el) {
    if (!styled) { document.head.appendChild(h('style', { text: CSS })); styled = true; }
    el.classList.add('kbx');
    document.body.appendChild(el);
    return el;
  }

  var UNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
  function authMsg(e) {
    var m = String((e && (e.message || e.error_description)) || e || '');
    if (/already registered|already exists/i.test(m)) return 'Bu kullanıcı adı alınmış. Başka bir ad dene ya da giriş yap.';
    if (/invalid login credentials/i.test(m)) return 'Kullanıcı adı veya şifre hatalı.';
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return 'Şifre en az 6 karakter olmalı.';
    if (/rate limit|too many/i.test(m)) return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
    if (/signups? not allowed|disabled/i.test(m)) return 'Yeni kayıtlar şu an kapalı.';
    return m || 'Bir hata oluştu, tekrar dene.';
  }

  /* ---------- giriş ekranı ---------- */
  function renderLogin() {
    var mode = 'in';
    var ov = h('div', { class: 'kbx-ov', role: 'dialog', 'aria-label': 'Giriş' });
    var card = h('div', { class: 'kbx-card' });
    var err = h('div', { class: 'kbx-err', role: 'alert' });
    if (authError) err.textContent = 'Giriş tamamlanamadı: ' + authError;
    var uIn = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '30', placeholder: 'ör. mehmet.kaya' });
    var pIn = h('input', { type: 'password', autocomplete: 'current-password', maxlength: '72' });
    var p2In = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' });
    var p2Wrap = h('div', { class: 'kbx-form', style: 'display:none' }, [h('label', { text: 'Şifre (tekrar)' }), p2In]);
    var hint = h('div', { class: 'kbx-hint', style: 'display:none', text: 'Şifre en az 6 karakter olmalıdır (harf, rakam veya sembol fark etmez). Kaydın, yönetici onaylayınca etkinleşir.' });
    var submit = h('button', { class: 'kbx-btn pri', type: 'submit', text: 'Giriş yap' });
    var tIn = h('button', { type: 'button', class: 'on', text: 'Giriş yap' });
    var tUp = h('button', { type: 'button', text: 'Kayıt ol' });
    function setMode(m) {
      mode = m; err.textContent = '';
      tIn.className = m === 'in' ? 'on' : ''; tUp.className = m === 'up' ? 'on' : '';
      p2Wrap.style.display = m === 'up' ? '' : 'none'; hint.style.display = m === 'up' ? '' : 'none';
      submit.textContent = m === 'up' ? 'Kayıt ol' : 'Giriş yap';
      pIn.setAttribute('autocomplete', m === 'up' ? 'new-password' : 'current-password');
    }
    tIn.addEventListener('click', function () { setMode('in'); });
    tUp.addEventListener('click', function () { setMode('up'); });
    var form = h('form', { class: 'kbx-form', novalidate: '' }, [
      h('label', { text: 'Kullanıcı adı' }), uIn,
      h('label', { text: 'Şifre' }), pIn
    ]);
    form.appendChild(p2Wrap); form.appendChild(hint); form.appendChild(err); form.appendChild(submit);
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault(); err.textContent = '';
      var un = uIn.value.trim().toLowerCase(), pw = pIn.value;
      if (!UNAME_RE.test(un)) { err.textContent = 'Kullanıcı adı 3–30 karakter olmalı; küçük harf, rakam, nokta, tire veya alt çizgi içerebilir.'; return; }
      if (pw.length < 6) { err.textContent = 'Şifre en az 6 karakter olmalı.'; return; }
      if (mode === 'up' && pw !== p2In.value) { err.textContent = 'Şifreler eşleşmiyor.'; return; }
      var c = client(); if (!c) { err.textContent = 'Board henüz yapılandırılmadı.'; return; }
      submit.disabled = true; submit.textContent = mode === 'up' ? 'Kaydediliyor…' : 'Giriş yapılıyor…';
      try {
        var em = un + '@' + USER_DOMAIN, r;
        if (mode === 'up') {
          r = await c.auth.signUp({ email: em, password: pw, options: { data: { username: un } } });
          if (!r.error && r.data && !r.data.session) r = await c.auth.signInWithPassword({ email: em, password: pw });
        } else {
          r = await c.auth.signInWithPassword({ email: em, password: pw });
        }
        if (r.error) throw r.error;
        location.reload();
      } catch (e) {
        err.textContent = authMsg(e);
        submit.disabled = false; submit.textContent = mode === 'up' ? 'Kayıt ol' : 'Giriş yap';
      }
    });
    var g = h('button', { class: 'kbx-btn', type: 'button', onclick: function () { window.__kb.signIn('google'); } }, [svg(GOOGLE_SVG), 'Google ile giriş yap']);
    [logo(), h('h1', { text: 'Giriş gerekli' }),
      h('p', { text: "Bu kanban board'a erişmek için Google hesabınla ya da kullanıcı adınla giriş yap." }),
      g, h('div', { class: 'kbx-or', text: 'veya' }), h('div', { class: 'kbx-tabs' }, [tIn, tUp]), form
    ].forEach(function (k) { card.appendChild(k); });
    ov.appendChild(card);
    mount(ov);
  }

  /* ---------- onay bekleme ekranı ---------- */
  async function renderPending() {
    var c = client(), status = 'pending';
    try {
      var r = await c.from('access_requests').select('status').eq('user_id', session.user.id);
      var row = r && r.data && r.data[0];
      if (!row) { await c.from('access_requests').insert({}); }
      else status = row.status;
    } catch (e) {}
    var who = usernameOf(rawEmail()) || email() || '';
    var ov = h('div', { class: 'kbx-ov', role: 'dialog', 'aria-label': 'Onay bekleniyor' });
    var card = h('div', { class: 'kbx-card' }, [
      logo(),
      h('h1', { text: status === 'rejected' ? 'Kayıt isteğin reddedildi' : 'Onay bekleniyor' }),
      h('p', { text: status === 'rejected'
        ? 'Board yöneticisi bu hesabın erişim isteğini onaylamadı. Bir hata olduğunu düşünüyorsan yöneticiyle iletişime geç.'
        : "Hesabın oluşturuldu. Board yöneticisi onayladığında board'a erişebileceksin; bu sayfa onay gelince kendiliğinden açılır." }),
      who ? h('p', { style: 'font-size:12px;color:var(--m)', text: 'Giriş yapılan hesap: ' + who }) : null,
      h('button', { class: 'kbx-btn', type: 'button', onclick: function () { window.__kb.signOut(); }, text: 'Farklı hesapla giriş yap' })
    ]);
    ov.appendChild(card); mount(ov);
    setInterval(async function () {
      if (document.hidden) return;
      try { var a = await c.rpc('board_access'); if (a && a.data === true) location.reload(); } catch (e) {}
    }, 15000);
  }

  /* ---------- yönetici onay paneli ---------- */
  function initials(s) { s = String(s || '?').replace(/@.*/, '').replace(/[._-]+/g, ' ').trim(); var p = s.split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  async function approve(req) {
    await ensureLoaded();
    var meta = clone(cache.get('board/meta'));
    if (!meta || !Array.isArray(meta.projects)) throw new Error('Board verisi okunamadı');
    var now = Date.now(), id = req.user_id;
    var people = (meta.people || []).filter(function (p) { return p.id !== id; });
    var prev = (meta.people || []).find(function (p) { return p.id === id; }) || {};
    people.push({ id: id, name: prev.name || req.username || req.display_name || '', email: req.email || prev.email || '', claude: true,
      color: typeof prev.color === 'number' ? prev.color : people.length % 8, u: now });
    meta.people = people;
    meta.projects = meta.projects.map(function (p) {
      var members = (p.members || []).slice();
      if (!members.some(function (m) { return m.id === id; })) members.push({ id: id, role: 'edit' });
      return Object.assign({}, p, { members: members, removed: (p.removed || []).filter(function (x) { return x !== id; }), u: now });
    });
    await ref('board/meta').set(meta);
    var d = await client().from('access_requests').delete().eq('user_id', id);
    if (d.error) throw d.error;
  }

  // Ekipte olmayan bir hesabı Supabase'den tamamen siler (sunucu tarafında yalnızca yönetici yapabilir)
  async function deleteAccount(id, label) {
    if (!confirm('"' + label + '" hesabı tamamen silinsin mi?\n\nKişi giriş yapamaz ve listeden kalkar. Bu işlem geri alınamaz.')) return false;
    var r = await client().rpc('kb_delete_user', { target: id });
    if (r.error) throw r.error;
    await ensureLoaded();
    var meta = clone(cache.get('board/meta'));
    if (meta && Array.isArray(meta.people) && meta.people.some(function (p) { return p.id === id; })) {
      var now = Date.now();
      meta.people = meta.people.filter(function (p) { return p.id !== id; });
      meta.gone = Object.assign({}, meta.gone || {}); meta.gone[id] = now;   // açık sekmelerdeki eski kopyalar kişiyi geri getirmesin
      await ref('board/meta').set(meta);
    }
    return true;
  }
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function formerMembers() {
    var meta = cache.get('board/meta');
    if (!meta || !Array.isArray(meta.people)) return [];
    var inTeam = {};
    (meta.projects || []).forEach(function (p) { (p.members || []).forEach(function (m) { inTeam[m.id] = 1; }); });
    var me = session && session.user && session.user.id;
    return meta.people.filter(function (p) { return p && UUID_RE.test(String(p.id)) && !inTeam[p.id] && p.id !== me; });
  }

  function initOwnerPanel() {
    // Erişim istekleri "Ekibi yönet" (Paylaş) penceresinin içinde gösterilir; bekleyen sayısı Paylaş düğmesinde görünür
    var c = client(), rows = [], pending = 0;
    if (!styled) { document.head.appendChild(h('style', { text: CSS })); styled = true; }
    window.__kb.pendingCount = function () { return pending; };
    async function load() {
      var r = await c.from('access_requests').select('user_id,email,username,display_name,provider,status,created_at').order('created_at', { ascending: true });
      rows = (r && r.data) || [];
      var n = rows.filter(function (x) { return x.status === 'pending'; }).length;
      if (n !== pending) { pending = n; rerender(); }
      var el = document.getElementById('kb-approvals');
      if (el) draw(el);
      return rows;
    }
    function delBtn(id, label) {
      var b = h('button', { class: 'del', type: 'button', text: 'Hesabı sil' });
      b.addEventListener('click', async function () {
        b.disabled = true; b.textContent = 'Siliniyor…';
        try { if (await deleteAccount(id, label)) { await load(); } else { b.disabled = false; b.textContent = 'Hesabı sil'; } }
        catch (e) { b.disabled = false; b.textContent = 'Hesabı sil'; alert('Silinemedi: ' + (e.message || e)); }
      });
      return b;
    }
    function draw(el) {
      var pend = rows.filter(function (x) { return x.status === 'pending'; }), rej = rows.filter(function (x) { return x.status === 'rejected'; });
      el.textContent = '';
      if (!pend.length && !rej.length) { el.style.display = 'none'; el.__kbDrawn = true; return; }
      var box = h('div', { class: 'kbx kbx-appr' });
      box.appendChild(h('span', { class: 'kbx-apph', text: 'ONAY BEKLEYENLER' + (pend.length ? ' · ' + pend.length : '') }));
      box.appendChild(h('p', { class: 'kbx-appp', text: 'Onayladığın kişi tüm projelere "Düzenleyebilir" olarak eklenir; aşağıdaki ekip listesinden istediğin projeden çıkarabilirsin.' }));
      if (!pend.length) box.appendChild(h('div', { class: 'kbx-empty', text: 'Bekleyen istek yok.' }));
      pend.concat(rej).forEach(function (req) {
        var label = req.username || req.display_name || req.email || 'Kullanıcı';
        var sub = req.username ? 'Kullanıcı adıyla kayıt' : (req.email || '');
        var acts = h('div', { class: 'kbx-acts' });
        var okB = h('button', { class: 'ok', type: 'button', text: 'Onayla' });
        okB.addEventListener('click', async function () {
          okB.disabled = true; okB.textContent = 'Onaylanıyor…';
          try { await approve(req); await load(); }
          catch (e) { okB.disabled = false; okB.textContent = 'Onayla'; alert('Onaylanamadı: ' + (e.message || e)); }
        });
        acts.appendChild(okB);
        if (req.status === 'pending') {
          var noB = h('button', { type: 'button', text: 'Reddet' });
          noB.addEventListener('click', async function () {
            noB.disabled = true;
            var u = await c.from('access_requests').update({ status: 'rejected' }).eq('user_id', req.user_id);
            if (u.error) { noB.disabled = false; alert('Reddedilemedi: ' + u.error.message); return; }
            await load();
          });
          acts.appendChild(noB);
        } else {
          acts.appendChild(delBtn(req.user_id, label));
        }
        box.appendChild(h('div', { class: 'kbx-row' }, [
          h('span', { class: 'kbx-av', text: initials(label) }),
          h('div', { class: 'kbx-who' }, [
            h('strong', {}, [label + ' ', req.status === 'rejected' ? h('span', { class: 'kbx-tag', text: 'Reddedildi' }) : null]),
            h('span', { text: sub + (req.created_at ? ' · ' + fmtDate(req.created_at) : '') })
          ]),
          acts
        ]));
      });
      el.appendChild(box);
      el.style.display = 'block';
      el.__kbDrawn = true;
    }
    // pencere her açıldığında bölümü doldur
    new MutationObserver(function () {
      var el = document.getElementById('kb-approvals');
      if (el && !el.__kbDrawn) { draw(el); load().catch(function () {}); }
    }).observe(document.body, { childList: true, subtree: true });
    load().catch(function () {});
    setInterval(function () { if (!document.hidden) load().catch(function () {}); }, 30000);
  }


  /* ---------- canlı varlık: kim hangi görevi şu an açık tutuyor (Supabase Realtime presence) ---------- */
  var pres = { ch: null, ready: false, me: '', task: null, others: {}, sig: '{}', t: null };
  function presApply(state) {
    var o = {}, myKey = session && session.user && session.user.id;
    Object.keys(state || {}).forEach(function (k) {
      if (k === myKey) return;
      (state[k] || []).forEach(function (m) {
        if (!m || !m.task || !m.pid) return;
        var a = o[m.task] || (o[m.task] = []);
        if (!a.some(function (x) { return x.pid === m.pid; })) a.push({ pid: m.pid });
      });
    });
    var sig = JSON.stringify(o);
    if (sig !== pres.sig) { pres.sig = sig; pres.others = o; rerender(); }
  }
  function presTrackNow() {
    var ch = pres.ch;
    if (!ch || !pres.ready) return;
    try {
      pres.dirty = false;
      var r = ch.track({ pid: pres.me || '', task: pres.task || null, at: Date.now() });
      var fail = function () { if (ch === pres.ch) { pres.dirty = true; setTimeout(presEnsure, 3000); } };
      if (r && r.then) r.then(function (res) { if (res !== 'ok') fail(); }, fail);
    } catch (e) {}
  }
  function presPush() {
    clearTimeout(pres.t);
    pres.t = setTimeout(presTrackNow, 60);
  }
  function presStart() {
    var c = client();
    if (pres.ch || !c || !c.channel || !session) return;
    try {
      var ch = c.channel('kb-presence', { config: { presence: { key: session.user.id } } });
      if (!ch || typeof ch.track !== 'function' || typeof ch.presenceState !== 'function') return;
      ch.on('presence', { event: 'sync' }, function () { if (ch === pres.ch) presApply(ch.presenceState()); });
      pres.ch = ch; pres.ready = false;
      ch.subscribe(function (st) {
        if (ch !== pres.ch) return;
        if (st === 'SUBSCRIBED') { pres.ready = true; pres.joinSince = 0; presTrackNow(); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { pres.ready = false; setTimeout(presEnsure, 3000); }
      });
    } catch (e) {}
  }
  // Bağlantı koptuysa (ör. sekme arka planda uzun süre kaldıysa) kanalı yeniden kur ve durumu tekrar bildir
  function presEnsure() {
    if (!session || noAccess) return;
    var ch = pres.ch;
    if (!ch) { presStart(); return; }
    var st = ch.state;
    if (st === 'joined') { if (pres.ready && pres.dirty) presTrackNow(); return; }
    if (st === 'joining') {
      if (!pres.joinSince) pres.joinSince = Date.now();
      if (Date.now() - pres.joinSince < 15000) return;   // takılı kaldıysa yeniden kur
    }
    pres.joinSince = 0;
    pres.ch = null; pres.ready = false;
    try { client().removeChannel(ch); } catch (e) {}
    presStart();
  }
  setInterval(function () { if (!document.hidden) presEnsure(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) presEnsure(); });
  window.addEventListener('online', function () { setTimeout(presEnsure, 1000); });


  /* ---------- zengin metin: açıklama (sabit çubuk) ve alt görevler (seçince açılan çubuk) ---------- */
  (function () {
    var TEXT = [['#B9052D', 'Kırmızı'], ['#0087A0', 'Petrol'], ['#E67319', 'Turuncu'], ['#2E8B57', 'Yeşil'], ['#797979', 'Gri']];
    var HILITE = [['#FFE29A', 'Sarı'], ['#B8E0C8', 'Nane'], ['#B5D8F5', 'Açık mavi'], ['#F4B6C2', 'Pembe'], ['#C9B6E4', 'Lavanta']];
    var ALLOWED = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', BR: 'br', DIV: 'div', P: 'div', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', IMG: 'img', UL: 'ul', OL: 'ol', LI: 'li', SPAN: 'span', FONT: 'span', MARK: 'span', A: 'a' };
    function okHref(h) { h = String(h || '').trim(); return /^(https?:\/\/|mailto:)/i.test(h) ? h : ''; }
    var COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i;
    function cleanStyle(el) {
      var out = [], st = el.style;
      var c = st && st.color; if (el.tagName === 'FONT' && el.getAttribute('color')) c = el.getAttribute('color');
      if (c && COLOR_RE.test(c.trim())) out.push('color:' + c.trim());
      var bg = st && (st.backgroundColor || ''); if (el.tagName === 'MARK' && !bg) bg = '#FFE29A';
      if (bg && COLOR_RE.test(bg.trim()) && !/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i.test(bg.trim())) out.push('background-color:' + bg.trim());
      var fw = st && st.fontWeight; if (fw && (fw === 'bold' || +fw >= 600)) out.push('font-weight:700');
      if (st && st.fontStyle === 'italic') out.push('font-style:italic');
      var td = st && (st.textDecorationLine || st.textDecoration || ''); if (/underline/.test(td) && /line-through/.test(td)) out.push('text-decoration:underline line-through'); else if (/underline/.test(td)) out.push('text-decoration:underline'); else if (/line-through/.test(td)) out.push('text-decoration:line-through');
      return out.join(';');
    }
    function sanitize(html) {
      var src = document.createElement('div'); src.innerHTML = html || '';
      var dst = document.createElement('div');
      (function walk(from, to) {
        Array.prototype.forEach.call(from.childNodes, function (n) {
          if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); return; }
          if (n.nodeType !== 1) return;
          var tag = ALLOWED[n.tagName];
          if (!tag) { walk(n, to); return; }       // bilinmeyen etiket: içeriği kalsın, etiketi gitsin
          if (tag === 'a' && !okHref(n.getAttribute('href'))) { walk(n, to); return; }
          if (tag === 'img') {   // yalnızca yüklenmiş (https) görseller
            var src = String(n.getAttribute('src') || '');
            if (!/^https:\/\//i.test(src)) return;
            var im = document.createElement('img'); im.setAttribute('src', src); im.setAttribute('alt', String(n.getAttribute('alt') || '').slice(0, 200));
            var w = n.getAttribute('data-w'); if (/^[sml]$/.test(w || '')) im.setAttribute('data-w', w);
            var px = Math.round(+n.getAttribute('data-px') || 0), pc = Math.round(+n.getAttribute('data-pct') || 0);
            if (px >= 40 && px <= 6000) { im.setAttribute('data-px', String(px)); im.setAttribute('style', 'width:' + px + 'px;max-width:none'); }
            else if (pc >= 10 && pc <= 100) { im.setAttribute('data-pct', String(pc)); im.setAttribute('style', 'width:' + pc + '%'); }
            to.appendChild(im); return;
          }
          var el = document.createElement(tag);
          if (tag === 'a') { el.setAttribute('href', okHref(n.getAttribute('href'))); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
          var s = cleanStyle(n);
          if (tag === 'span') { if (!s) { walk(n, to); return; } el.setAttribute('style', s); }
          else if (s && tag !== 'br') el.setAttribute('style', s);
          if (tag === 'div' && n.getAttribute && /^[01]$/.test(n.getAttribute('data-chk') || '')) el.setAttribute('data-chk', n.getAttribute('data-chk'));
          if (tag !== 'br') walk(n, el);
          to.appendChild(el);
        });
      })(src, dst);
      var h = dst.innerHTML;
      if (!dst.textContent.trim() && !/<li|data-chk|<img/i.test(h)) return '';
      return h;
    }
    function textOf(el) { return (el.innerText || el.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
    function api() { return window.__kbRte || {}; }

    var css = document.createElement('style');
    css.textContent =
      '.kb-rte-tb{display:flex;flex-wrap:wrap;align-items:center;gap:2px;border:1px solid var(--border-default);border-bottom:0;border-radius:5px 5px 0 0;padding:4px 6px;background:var(--surface-subtle)}' +
      '.kb-rte-tb button,.kb-rte-fl button{width:30px;height:28px;border:0;border-radius:4px;background:transparent;color:var(--text-primary);cursor:pointer;font:600 13px inherit;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;padding:0}' +
      '.kb-rte-tb button:hover,.kb-rte-fl button:hover{background:var(--surface-muted)}' +
      '.kb-rte-tb .sep,.kb-rte-fl .sep{width:1px;height:18px;background:var(--border-default);margin:0 4px}' +
      '.kb-rte-ed{outline:none;word-break:break-word}.kb-rte-fl.kb-nolist .kb-ls,.kb-rte-fl.kb-nohead .kb-hs,.kb-rte-fl:not(.kb-hasimg) .kb-is{display:none}.kb-rte-fl button.kb-red{color:#B9052D}.kb-rte-fl button.kb-dd{width:auto;padding:0 6px;gap:3px}' +
      '.kb-rte-pop.kb-rte-menu{display:flex;flex-direction:column;gap:2px;padding:4px;min-width:200px}.kb-rte-menu button{display:flex;align-items:center;gap:10px;border:0;background:transparent;border-radius:4px;padding:7px 10px;text-align:left;cursor:pointer;font-family:inherit;font-size:13px;color:var(--text-primary)}.kb-rte-menu button:hover{background:var(--surface-subtle)}' +
      '.kb-rte-ed h2{font-size:20px;font-weight:600;margin:14px 0 6px;line-height:1.3}.kb-rte-ed h3{font-size:16px;font-weight:600;margin:12px 0 4px;line-height:1.35}.kb-rte-ed h2:first-child,.kb-rte-ed h3:first-child{margin-top:0}' +
      '.kb-html-view h2{font-size:18px;font-weight:600;margin:10px 0 4px;line-height:1.3;color:var(--text-primary)}.kb-html-view h3{font-size:15px;font-weight:600;margin:8px 0 2px;line-height:1.35;color:var(--text-primary)}.kb-html-view h2:first-child,.kb-html-view h3:first-child{margin-top:0}' +
      '.kb-rte-ed img,.kb-html-view img{display:block;max-width:100%;height:auto;margin:8px 0;border-radius:4px}.kb-rte-ed img[data-w="s"],.kb-html-view img[data-w="s"]{width:33%}.kb-rte-ed img[data-w="m"],.kb-html-view img[data-w="m"]{width:60%}.kb-rte-ed img[data-w="l"],.kb-html-view img[data-w="l"]{width:100%}' +
      '@media (max-width:768px){.kb-rte-ed img,.kb-html-view img{max-width:100%!important;height:auto!important}}' +
      '.kb-rte-ed[data-kind="cmt"],.kb-rte-ed[data-kind="cmte"]{min-height:1.5em;padding:8px 12px;border:1px solid var(--border-default);border-radius:5px;font-size:13px;line-height:1.5;color:var(--text-primary);background:var(--surface-page)}.kb-rte-ed[data-kind="cmte"]{font-size:14px;min-height:4.5em}.kb-rte-ed[data-kind="cmt"]:focus,.kb-rte-ed[data-kind="cmte"]:focus{border-color:#B9052D}' +
      '.kb-rte-ed ul,.kb-rte-ed ol,.kb-html-view ul,.kb-html-view ol{margin:4px 0;padding-left:22px}.kb-html-view a{color:#0087A0;text-decoration:underline;text-underline-offset:2px;word-break:break-all}html[data-theme="dark"] .kb-html-view a{color:#4FC3D6}' +
      '.kb-html-view div[data-chk]{position:relative;padding-left:26px}.kb-html-view div[data-chk]::before{content:"";position:absolute;left:2px;top:.22em;width:14px;height:14px;border:1.5px solid var(--text-muted);border-radius:3px;box-sizing:border-box}.kb-html-view div[data-chk="1"]::before{background:#B9052D;border-color:#B9052D}.kb-html-view div[data-chk="1"]{color:var(--text-muted);text-decoration:line-through}' +
      '.kb-rte-ed[data-kind="desc"]{min-height:120px;border:1px solid var(--border-default);border-radius:5px;padding:12px;font-size:14px;line-height:1.55;color:var(--text-primary);background:var(--surface-page)}' +
      '.kb-rte-ed[data-kind="desc"]:focus{border-color:#B9052D}' +
      '.kb-rte-ed[data-kind="desc"] ul,.kb-rte-ed[data-kind="desc"] ol{margin:4px 0;padding-left:22px}' +
      '.kb-rte-ed[data-kind="sub"]{min-height:1.4em;line-height:1.4;padding:0 2px;border-bottom:1px dashed transparent}' +
      '.kb-rte-ed[data-kind="sub"]:focus{border-bottom-color:var(--border-default)}' +
      'html[data-theme="dark"] .kb-rte-ed a{color:#4FC3D6}' +
      '.kb-rte-ed a{color:#0087A0;text-decoration:underline;text-underline-offset:2px;cursor:pointer;word-break:break-all}' +
      '.kb-rte-lp{position:fixed;z-index:62;background:var(--surface-page);border:1px solid var(--border-default);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px;display:flex;flex-direction:column;gap:8px;width:300px;max-width:calc(100vw - 16px);font-size:12px;color:var(--text-secondary)}' +
      '.kb-rte-lp input{width:100%;padding:6px 8px;border:1px solid var(--border-default);border-radius:4px;font:inherit;font-size:13px;color:var(--text-primary);background:var(--surface-page);outline:none}.kb-rte-lp input:focus{border-color:#B9052D}' +
      '.kb-rte-lp .row{display:flex;gap:8px;justify-content:flex-end;align-items:center}' +
      '.kb-rte-lp button{border:1px solid var(--border-default);background:var(--surface-page);color:var(--text-primary);border-radius:4px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer}' +
      '.kb-rte-lp button.pri{background:#B9052D;border-color:#B9052D;color:#fff;font-weight:600}.kb-rte-lp button.lnk{border:0;padding:4px 6px;color:var(--text-accent);background:transparent}' +
      '.kb-rte-lp .host{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)}' +
      '.kb-rte-ed:empty::before{content:attr(data-ph);color:var(--text-muted);pointer-events:none}' +
      '.kb-rte-ed div[data-chk]{position:relative;padding-left:26px;min-height:1.55em}' +
      '.kb-rte-ed div[data-chk]::before{content:"";position:absolute;left:2px;top:.22em;width:14px;height:14px;border:1.5px solid var(--text-muted);border-radius:3px;background:var(--surface-page);cursor:pointer;box-sizing:border-box}' +
      '.kb-rte-ed div[data-chk="1"]::before{background:#B9052D;border-color:#B9052D}' +
      '.kb-rte-ed div[data-chk="1"]::after{content:"✓";position:absolute;left:4px;top:.05em;font-size:11px;font-weight:700;color:#fff;pointer-events:none}' +
      '.kb-rte-ed div[data-chk="1"]{color:var(--text-muted);text-decoration:line-through}' +
      '.kb-rte-fl{position:fixed;z-index:60;display:flex;align-items:center;gap:2px;background:var(--surface-page);border:1px solid var(--border-default);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px 6px}' +
      '.kb-rte-pop{position:fixed;z-index:61;background:var(--surface-page);border:1px solid var(--border-default);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:8px;display:grid;grid-template-columns:repeat(6,22px);gap:6px}' +
      '.kb-rte-sw{width:22px;height:22px;border-radius:50%;border:1px solid rgba(0,0,0,.15);cursor:pointer;padding:0;position:relative}' +
      '.kb-rte-sw.none{background:var(--surface-page)}.kb-rte-sw.none::after{content:"";position:absolute;left:2px;right:2px;top:9px;height:2px;background:#B9052D;transform:rotate(-45deg)}' +
      /* koyu modda: koyu kırmızı yazı açılsın, vurgulu metin koyu kalsın */
      'html[data-theme="dark"] .kb-rte-ed [style*="background-color"]{color:#1a1a1a}' +
      'html[data-theme="dark"] .kb-rte-ed [style*="color:rgb(185, 5, 45)"],html[data-theme="dark"] .kb-rte-ed [style*="color:#b9052d"],html[data-theme="dark"] .kb-rte-ed [style*="color: rgb(185, 5, 45)"],html[data-theme="dark"] .kb-rte-ed [style*="color:#B9052D"],html[data-theme="dark"] .kb-rte-ed [style*="color: #B9052D"]{color:#F2557A!important}' +
      'html[data-theme="dark"] .kb-rte-ed [style*="color: rgb(121, 121, 121)"],html[data-theme="dark"] .kb-rte-ed [style*="color:rgb(121, 121, 121)"]{color:#A0A0A8!important}';
    (document.head || document.documentElement).appendChild(css);

    var ICON = {
      color: '<span style="font-weight:600;border-bottom:3px solid #B9052D;line-height:1">A</span>',
      hilite: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l-6 6v3h3l6-6"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/><rect x="3" y="21" width="18" height="2" fill="#FFE29A" stroke="none"/></svg>',
      list: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>',
      strike: '<span style="text-decoration:line-through;font-weight:500">S</span>',
      olist: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="2" y="8.5" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2" y="14.5" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2" y="20.5" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>',
      check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1.5"/><polyline points="4.6 7.6 6.2 9.2 8.8 6"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><line x1="13" y1="7.5" x2="21" y2="7.5"/><line x1="13" y1="17.5" x2="21" y2="17.5"/></svg>',
      link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
      trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
      clear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><line x1="3" y1="3" x2="21" y2="21" stroke="#B9052D"/></svg>'
    };
    var saved = null, pop = null, fl = null;
    function saveSel() { var s = window.getSelection(); if (s.rangeCount) saved = s.getRangeAt(0).cloneRange(); }
    function restoreSel() { if (!saved) return; var s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); }
    function edOfSel() { var s = window.getSelection(); var n = s.anchorNode; n = n && (n.nodeType === 1 ? n : n.parentElement); return n && n.closest ? n.closest('.kb-rte-ed') : null; }
    function exec(cmd, val) {
      restoreSel();
      var css = cmd === 'foreColor' || cmd === 'hiliteColor';
      try { document.execCommand('styleWithCSS', false, css); } catch (e) {}
      try { document.execCommand(cmd, false, val == null ? null : val); } catch (e) {}
      try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
      saveSel();
      var ed = edOfSel(); if (ed) queueSave(ed, true);
    }
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    function shortUrl(u) {
      try { var x = new URL(u); var p = x.pathname.replace(/\/+$/, ''); var seg = p.split('/').filter(Boolean)[0];
        return x.hostname.replace(/^www\./, '') + (seg ? '/' + (seg.length > 18 ? seg.slice(0, 18) + '…' : seg) + (p.split('/').filter(Boolean).length > 1 || x.search ? '/…' : '') : (x.search ? '/…' : ''));
      } catch (e) { return u.length > 40 ? u.slice(0, 40) + '…' : u; }
    }
    function normUrl(u) { u = String(u || '').trim(); if (!u) return ''; if (/^www\./i.test(u)) u = 'https://' + u; if (!/^[a-z]+:/i.test(u) && /\./.test(u)) u = 'https://' + u; return okHref(u); }
    function anchorOfSel() { var s = window.getSelection(); if (!s.rangeCount) return null; var n = s.anchorNode; n = n && (n.nodeType === 1 ? n : n.parentElement); return n && n.closest ? n.closest('.kb-rte-ed a') : null; }
    function escHtml(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function openLinkPop(rect, existing) {
      closePop();
      restoreSel();
      var ed = edOfSel(); if (!ed) return;
      var a = existing || anchorOfSel(), s = window.getSelection();
      if (a) { var r = document.createRange(); r.selectNodeContents(a); s.removeAllRanges(); s.addRange(r); }
      saveSel();
      var selText = s.toString();
      pop = document.createElement('div'); pop.className = 'kb-rte-lp';
      var t = document.createElement('input'); t.placeholder = 'Görünen metin (ör. Clearance raporu)'; t.value = selText;
      var u = document.createElement('input'); u.placeholder = 'Bağlantı (https://…)'; u.value = a ? a.getAttribute('href') : (/^https?:\/\//i.test(selText.trim()) ? selText.trim() : '');
      if (u.value && t.value.trim() === u.value.trim()) t.value = '';
      var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'pri'; ok.textContent = a ? 'Güncelle' : 'Ekle';
      var cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Vazgeç';
      var row = document.createElement('div'); row.className = 'row';
      if (a) { var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'lnk'; rm.textContent = 'Bağlantıyı kaldır'; rm.style.marginRight = 'auto';
        rm.addEventListener('click', function () { restoreSel(); try { document.execCommand('unlink'); } catch (e) {} closePop(); queueSave(ed, true); ed.focus(); }); row.appendChild(rm); }
      row.appendChild(cancel); row.appendChild(ok);
      var l1 = document.createElement('span'); l1.textContent = 'Metin'; var l2 = document.createElement('span'); l2.textContent = 'Bağlantı';
      [l1, t, l2, u, row].forEach(function (x) { pop.appendChild(x); });
      function apply() {
        var href = normUrl(u.value); if (!href) { u.focus(); u.style.borderColor = '#B9052D'; return; }
        var txt = t.value.trim() || shortUrl(href);
        restoreSel(); ed.focus(); restoreSel();
        try { document.execCommand('insertHTML', false, '<a href="' + escHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escHtml(txt) + '</a>&nbsp;'); } catch (e) {}
        closePop(); queueSave(ed, true);
      }
      ok.addEventListener('click', apply);
      cancel.addEventListener('click', function () { closePop(); restoreSel(); ed.focus(); });
      [t, u].forEach(function (inp) { inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); restoreSel(); ed.focus(); } }); });
      document.body.appendChild(pop);
      pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + 'px';
      pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
      (u.value ? t : u).focus();
    }
    function openLinkBubble(a, ed) {
      closePop();
      var r = document.createRange(); r.selectNodeContents(a); saved = r;
      pop = document.createElement('div'); pop.className = 'kb-rte-lp'; pop.style.flexDirection = 'row'; pop.style.alignItems = 'center'; pop.style.width = 'auto';
      var host = document.createElement('span'); host.className = 'host'; host.textContent = a.getAttribute('href'); host.title = a.getAttribute('href');
      var open = document.createElement('button'); open.type = 'button'; open.className = 'pri'; open.textContent = 'Aç';
      open.addEventListener('click', function () { window.open(a.getAttribute('href'), '_blank', 'noopener'); closePop(); });
      var edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Düzenle';
      var rc = a.getBoundingClientRect();
      edit.addEventListener('click', function () { openLinkPop(rc, a); });
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'lnk'; rm.textContent = 'Kaldır';
      rm.addEventListener('click', function () { var s = window.getSelection(); ed.focus(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('unlink'); } catch (e) {} closePop(); queueSave(ed, true); });
      [host, open, edit, rm].forEach(function (x) { pop.appendChild(x); });
      document.body.appendChild(pop);
      pop.style.maxWidth = Math.min(420, window.innerWidth - 16) + 'px';
      pop.style.top = (rc.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(rc.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    }
    function openPop(btn, kind) {
      closePop();
      pop = document.createElement('div'); pop.className = 'kb-rte-pop';
      (kind === 'color' ? TEXT : HILITE).forEach(function (c) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'kb-rte-sw'; b.style.background = c[0]; b.title = c[1];
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function () { exec(kind === 'color' ? 'foreColor' : 'hiliteColor', c[0]); closePop(); });
        pop.appendChild(b);
      });
      var none = document.createElement('button'); none.type = 'button'; none.className = 'kb-rte-sw none'; none.title = kind === 'color' ? 'Varsayılan renk' : 'Vurguyu kaldır';
      none.addEventListener('mousedown', function (e) { e.preventDefault(); });
      none.addEventListener('click', function () {
        if (kind === 'color') exec('foreColor', getComputedStyle(edOfSel() || document.body).color); else exec('hiliteColor', 'transparent');
        closePop();
      });
      pop.appendChild(none);
      document.body.appendChild(pop);
      var r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    }
    // imlecin bulunduğu satır: editör içindeki en içteki <div>
    function blockOf(ed, node) {
      var n = node && (node.nodeType === 1 ? node : node.parentElement);
      while (n && n !== ed) { if (n.tagName === 'DIV') return n; if (n.tagName === 'LI') return null; n = n.parentElement; }
      return null;
    }
    function toggleCheck() {
      restoreSel();
      var ed = edOfSel(); if (!ed || ed.getAttribute('data-kind') === 'sub') return;
      var s = window.getSelection(), an = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
      if (an && an.closest && an.closest('li')) return;
      var b = blockOf(ed, s.anchorNode);
      if (!b || b.tagName !== 'DIV') {
        try { document.execCommand('formatBlock', false, 'div'); } catch (e) {}
        s = window.getSelection(); b = blockOf(ed, s.anchorNode);
      }
      if (!b || b.tagName !== 'DIV') return;
      var range = s.rangeCount ? s.getRangeAt(0) : null, blocks = [b];
      if (range && !range.collapsed) {
        blocks = Array.prototype.filter.call(ed.querySelectorAll('div'), function (d) { return range.intersectsNode(d) && !d.querySelector('div,ul,ol'); });
        if (!blocks.length) blocks = [b];
      }
      var on = !b.hasAttribute('data-chk');
      blocks.forEach(function (x) { if (on) x.setAttribute('data-chk', '0'); else x.removeAttribute('data-chk'); });
      saveSel(); queueSave(ed, true);
    }
    // açılır grup: seçenekler listesi
    function openMenu(btn, items) {
      closePop();
      pop = document.createElement('div'); pop.className = 'kb-rte-pop kb-rte-menu'; pop.setAttribute('role', 'menu');
      items.forEach(function (it) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.innerHTML = it[1];
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function () { closePop(); it[2](); });
        pop.appendChild(b);
      });
      document.body.appendChild(pop);
      var r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    }
    function setBlock(tag) {
      restoreSel();
      var ed = edOfSel(); if (!ed) return;
      var s = window.getSelection(), an = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
      var li = an && an.closest && an.closest('li');
      if (li && ed.contains(li) && tag !== 'div') { var l = li.parentElement; try { document.execCommand(l && l.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList'); } catch (e) {} }
      var chk = an && an.closest && an.closest('div[data-chk]'); if (chk && ed.contains(chk) && tag !== 'div') chk.removeAttribute('data-chk');
      try { document.execCommand('formatBlock', false, '<' + tag + '>'); } catch (e) {}
      saveSel(); queueSave(ed, true);
    }
    var CHEV = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
    function makeButtons(bar, withList, compact) {
      if (compact) {   // seçince açılan çubuk: başlıklar ve listeler açılır grupta
        var defs2 = [
          ['@@style', '<span style="font-weight:600;font-size:12px">Aa</span>' + CHEV, 'Metin stili: başlık, alt başlık, metin', 'H'], ['|', 'H'],
          ['bold', '<b>B</b>', 'Kalın (Ctrl+B)'], ['italic', '<i style="font-weight:500">I</i>', 'İtalik (Ctrl+I)'], ['underline', '<span style="text-decoration:underline;font-weight:500">U</span>', 'Altı çizili (Ctrl+U)'], ['strikeThrough', ICON.strike, 'Üstü çizili'], ['|'],
          ['@color', ICON.color, 'Yazı rengi'], ['@hilite', ICON.hilite, 'Vurgula'], ['|', 'L'],
          ['@@lists', ICON.list + CHEV, 'Listeler: madde işaretli, numaralı, onay kutulu', 'L'], ['|'],
          ['@@link', ICON.link, 'Bağlantı ekle (Ctrl+K)'], ['removeFormat', ICON.clear, 'Biçimi temizle'], ['|', 'I'], ['@@delimg', ICON.trash, 'Görseli sil', 'I']];
        defs2.forEach(function (d) {
          if (d[0] === '|') { var sp = document.createElement('span'); sp.className = 'sep' + (d[1] === 'L' ? ' kb-ls' : d[1] === 'H' ? ' kb-hs' : d[1] === 'I' ? ' kb-is' : ''); bar.appendChild(sp); return; }
          var b = document.createElement('button'); b.type = 'button'; b.innerHTML = d[1]; b.title = d[2]; b.setAttribute('aria-label', d[2]);
          if (d[3] === 'L') b.className = 'kb-ls kb-dd'; if (d[3] === 'H') b.className = 'kb-hs kb-dd'; if (d[3] === 'I') b.className = 'kb-is kb-red';
          if (d[0].indexOf('@@') === 0 && d[0] !== '@@link') b.setAttribute('aria-haspopup', 'menu');
          b.addEventListener('mousedown', function (e) { e.preventDefault(); saveSel(); });
          b.addEventListener('click', function () {
            if (d[0] === '@@style') { if (pop) { closePop(); return; } openMenu(b, [
              ['h2', '<span style="font-size:17px;font-weight:600">Başlık</span>', function () { setBlock('h2'); }],
              ['h3', '<span style="font-size:14px;font-weight:600">Alt başlık</span>', function () { setBlock('h3'); }],
              ['div', '<span style="font-size:13px">Metin</span>', function () { setBlock('div'); }]]); }
            else if (d[0] === '@@lists') { if (pop) { closePop(); return; } openMenu(b, [
              ['ul', ICON.list + '<span>Madde işaretli liste</span>', function () { exec('insertUnorderedList'); }],
              ['ol', ICON.olist + '<span>Numaralı liste</span>', function () { exec('insertOrderedList'); }],
              ['chk', ICON.check + '<span>Onay kutulu liste</span>', function () { toggleCheck(); }]]); }
            else if (d[0] === '@@delimg') {
              restoreSel(); var ed0 = edOfSel(), sl = window.getSelection();
              if (sl.rangeCount) { var rg = sl.getRangeAt(0), imgs = []; if (ed0) Array.prototype.forEach.call(ed0.querySelectorAll('img'), function (im) { if (rg.intersectsNode(im)) imgs.push(im); }); imgs.forEach(function (im) { im.remove(); }); }
              hideFl(); if (ed0) queueSave(ed0, true);
              document.dispatchEvent(new CustomEvent('kb-img-removed'));
            }
            else if (d[0] === '@@link') { if (pop) { closePop(); return; } openLinkPop(b.getBoundingClientRect()); }
            else if (d[0].charAt(0) === '@') { if (pop) { closePop(); return; } openPop(b, d[0].slice(1)); }
            else if (d[0] === 'removeFormat') { exec('removeFormat'); exec('hiliteColor', 'transparent'); }
            else exec(d[0]);
          });
          bar.appendChild(b);
        });
        return;
      }
      var defs = [['bold', '<b>B</b>', 'Kalın (Ctrl+B)'], ['italic', '<i style="font-weight:500">I</i>', 'İtalik (Ctrl+I)'], ['underline', '<span style="text-decoration:underline;font-weight:500">U</span>', 'Altı çizili (Ctrl+U)'], ['strikeThrough', ICON.strike, 'Üstü çizili'], ['|'],
        ['@color', ICON.color, 'Yazı rengi'], ['@hilite', ICON.hilite, 'Vurgula']];
      if (withList) defs.push(['|', 'L'], ['insertUnorderedList', ICON.list, 'Madde işaretli liste', 'L'], ['insertOrderedList', ICON.olist, 'Numaralı liste', 'L'], ['@@check', ICON.check, 'Onay kutulu liste', 'L']);
      defs.push(['@@link', ICON.link, 'Bağlantı ekle (Ctrl+K)']);
      defs.push(['removeFormat', ICON.clear, 'Biçimi temizle']);
      defs.forEach(function (d) {
        if (d[0] === '|') { var sp = document.createElement('span'); sp.className = 'sep' + (d[1] === 'L' ? ' kb-ls' : ''); bar.appendChild(sp); return; }
        var b = document.createElement('button'); b.type = 'button'; if (d[3] === 'L') b.className = 'kb-ls'; b.innerHTML = d[1]; b.title = d[2]; b.setAttribute('aria-label', d[2]);
        b.addEventListener('mousedown', function (e) { e.preventDefault(); saveSel(); });
        b.addEventListener('click', function () {
          if (d[0] === '@@check') toggleCheck();
          else if (d[0] === '@@link') { if (pop) { closePop(); return; } openLinkPop(b.getBoundingClientRect()); }
          else if (d[0].charAt(0) === '@') { if (pop) { closePop(); return; } openPop(b, d[0].slice(1)); }
          else if (d[0] === 'removeFormat') { exec('removeFormat'); exec('hiliteColor', 'transparent'); }
          else exec(d[0]);
        });
        bar.appendChild(b);
      });
    }
    document.addEventListener('mousedown', function (e) { if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.kb-rte-tb,.kb-rte-fl'))) closePop(); }, true);

    // kaydet
    function queueSave(ed, soon) {
      if (!ed.__host) { ed.dispatchEvent(new Event('input', { bubbles: true })); return; }
      clearTimeout(ed.__t);
      ed.__t = setTimeout(function () { flush(ed); }, soon ? 50 : 500);
    }
    function flush(ed) {
      clearTimeout(ed.__t);
      var host = ed.__host; if (!host || !host.isConnected) return;
      var html = sanitize(ed.innerHTML), text = textOf(ed);
      if (html === host.__last) return;
      host.__last = html;
      try { if (api().set) api().set(host.__kind, host.__key, html, text); } catch (e) {}
    }

    function build(host) {
      var kind = host.getAttribute('data-kind'), key = host.getAttribute('data-key');
      host.__kind = kind; host.__key = key;
      host.textContent = '';
      var ed = document.createElement('div');
      ed.className = 'kb-rte-ed'; ed.setAttribute('data-kind', kind); ed.contentEditable = 'true'; ed.spellcheck = true;
      ed.setAttribute('data-ph', host.getAttribute('data-ph') || '');
      ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', kind === 'desc' ? 'true' : 'false');
      ed.__host = host;
      var v = api().get ? api().get(kind, key) : '';
      host.__last = sanitize(v || ''); ed.innerHTML = host.__last;
      ed.addEventListener('input', function () { if (!textOf(ed) && !/<li/i.test(ed.innerHTML)) ed.innerHTML = ''; queueSave(ed); });
      ed.addEventListener('blur', function () { flush(ed); });
      ed.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('a');
        if (!a || !ed.contains(a)) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { window.open(a.getAttribute('href'), '_blank', 'noopener'); return; }
        openLinkBubble(a, ed);
      });
      ed.addEventListener('mousedown', function (e) {
        var t = e.target;
        if (t && t.matches && t.matches('div[data-chk]') && e.offsetX < 22) {
          e.preventDefault();
          t.setAttribute('data-chk', t.getAttribute('data-chk') === '1' ? '0' : '1');
          queueSave(ed, true);
        }
      });
      ed.addEventListener('keydown', function (e) {
        if ((kind === 'cmt' || kind === 'cmte') && e.key === 'Enter' && !e.shiftKey) {
          var an = window.getSelection().anchorNode, li = an && (an.nodeType === 1 ? an : an.parentElement);
          li = li && li.closest && li.closest('li,div[data-chk]');
          if (li && ed.contains(li) && li.textContent.trim()) {
            if (li.tagName === 'DIV') setTimeout(function () { var nb = blockOf(ed, window.getSelection().anchorNode); if (nb && nb !== li && nb.hasAttribute('data-chk')) nb.setAttribute('data-chk', '0'); }, 0);
            return;
          }
          if (li && ed.contains(li) && li.tagName === 'DIV') { e.preventDefault(); li.removeAttribute('data-chk'); queueSave(ed, true); return; }
          if (li && ed.contains(li) && li.tagName === 'LI') { e.preventDefault(); var lst = li.parentElement; try { document.execCommand(lst && lst.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList'); } catch (err) {} queueSave(ed, true); return; }
          e.preventDefault();
          var h0 = sanitize(ed.innerHTML).replace(/(<br\s*\/?>|<li><br><\/li>|<div><br><\/div>)+$/i, '').replace(/(<li><br><\/li>)+(<\/[uo]l>)$/i, '$2'), t0 = textOf(ed);
          flush(ed);
          try { if (api().enter) api().enter(kind, key, h0, t0); } catch (err) {}
          if (kind === 'cmt' && t0.trim()) { ed.innerHTML = ''; host.__last = ''; }
          return;
        }
        if ((kind === 'cmt' || kind === 'cmte') && e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          try { if (!document.execCommand('insertLineBreak')) document.execCommand('insertHTML', false, '<br><br>'); } catch (err) {}
          queueSave(ed); return;
        }
        if (kind === 'sub' && e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {   // Shift+Enter: aynı alt görevde yeni satır
            try { if (!document.execCommand('insertLineBreak')) document.execCommand('insertHTML', false, '<br><br>'); } catch (err) {}
            queueSave(ed);
          } else ed.blur();
        }
        if (kind === 'desc' && e.key === 'Enter' && !e.shiftKey) {
          var bl = blockOf(ed, window.getSelection().anchorNode);
          if (bl && bl.hasAttribute && bl.hasAttribute('data-chk')) {
            if (!bl.textContent.trim()) { e.preventDefault(); bl.removeAttribute('data-chk'); queueSave(ed, true); return; }
            setTimeout(function () { var nb = blockOf(ed, window.getSelection().anchorNode); if (nb && nb !== bl && nb.hasAttribute('data-chk')) nb.setAttribute('data-chk', '0'); }, 0);
          }
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); saveSel(); var rr = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).getBoundingClientRect() : ed.getBoundingClientRect(); if (!rr.width && !rr.height) rr = ed.getBoundingClientRect(); openLinkPop(rr); return; }
        if (e.key === 'Escape') { e.stopPropagation(); ed.blur(); }
      });
      ed.addEventListener('paste', function (e) {
        var cd = e.clipboardData; if (!cd) return;
        var hasFile = Array.prototype.some.call(cd.items || [], function (it) { return it.kind === 'file'; });
        if (hasFile) return;                         // görseller göreve ek olarak yapıştırılır
        e.preventDefault(); e.stopPropagation();
        var txt = cd.getData('text/plain') || '';
        var one = txt.trim();
        if (/^(https?:\/\/|www\.)\S+$/i.test(one)) {          // yalnızca bir bağlantı yapıştırıldı: kısa, tıklanabilir bağlantı yap
          var href = normUrl(one), sel = window.getSelection(), label = sel.toString().trim();
          if (href) {
            try { document.execCommand('insertHTML', false, '<a href="' + escHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escHtml(label || shortUrl(href)) + '</a>&nbsp;'); } catch (err) {}
            queueSave(ed, true); return;
          }
        }
        if (kind === 'sub') txt = txt.replace(/\s*\n+\s*/g, ' ');
        try { document.execCommand('insertText', false, txt); } catch (err) {}
      });
      host.appendChild(ed);
      host.__built = key;
    }
    function scan() {
      document.querySelectorAll('.kb-rte-host').forEach(function (host) {
        if (host.__built !== host.getAttribute('data-key') || !host.querySelector('.kb-rte-ed')) build(host);
      });
    }
    // şablon her çizildiğinde: odakta olmayan editörleri kayıttaki değerle eşitle
    window.__kbRteRefresh = function () {
      scan();
      document.querySelectorAll('.kb-rte-host').forEach(function (host) {
        var ed = host.querySelector('.kb-rte-ed'); if (!ed || document.activeElement === ed) return;
        var v = sanitize((api().get && api().get(host.__kind, host.__key)) || '');
        if (v !== host.__last) { host.__last = v; ed.innerHTML = v; }
      });
    };
    function views() {
      document.querySelectorAll('.kb-html-view').forEach(function (v) {
        var h = v.getAttribute('data-html') || '';
        if (v.__h !== h) { v.__h = h; v.innerHTML = sanitize(h); }
      });
    }
    new MutationObserver(function () { scan(); views(); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-html'] });
    window.__kbSanitize = sanitize;
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('.kb-rte-ed[data-kind="plan"] a'); if (!a) return;
      var ed = a.closest('.kb-rte-ed');
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || !ed.isContentEditable) { window.open(a.getAttribute('href'), '_blank', 'noopener'); return; }
      openLinkBubble(a, ed);
    });
    document.addEventListener('mousedown', function (e) {
      var t = e.target;
      if (!(t && t.matches && t.matches('.kb-rte-ed[data-kind="plan"] div[data-chk]') && e.offsetX < 22)) return;
      var ed = t.closest('.kb-rte-ed'); if (!ed.isContentEditable) return;
      e.preventDefault(); t.setAttribute('data-chk', t.getAttribute('data-chk') === '1' ? '0' : '1');
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.addEventListener('keydown', function (e) {
      var ed = e.target && e.target.closest && e.target.closest('.kb-rte-ed[data-kind="plan"]'); if (!ed) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); saveSel(); var rr = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).getBoundingClientRect() : ed.getBoundingClientRect(); if (!rr.width && !rr.height) rr = ed.getBoundingClientRect(); openLinkPop(rr); }
    });

    // alt görevlerde seçince açılan çubuk
    function hideFl() { if (fl) fl.style.display = 'none'; }
    function placeFl() {
      var s = window.getSelection();
      if (!s.rangeCount || s.isCollapsed) { hideFl(); return; }
      var ed = edOfSel();
      if (!ed || !ed.isContentEditable) { hideFl(); return; }
      if (!fl) {
        fl = document.createElement('div'); fl.className = 'kb-rte-fl'; fl.setAttribute('role', 'toolbar'); fl.setAttribute('aria-label', 'Metin biçimlendirme');
        makeButtons(fl, true, true); document.body.appendChild(fl);
      }
      fl.classList.toggle('kb-nolist', ed.getAttribute('data-kind') === 'sub');   // alt görevler tek satır: liste yok
      fl.classList.toggle('kb-nohead', ed.getAttribute('data-kind') === 'sub');   // alt görevlerde başlık yok
      var hasImg = false; try { var rg0 = s.getRangeAt(0); hasImg = Array.prototype.some.call(ed.querySelectorAll('img'), function (im) { return rg0.intersectsNode(im); }); } catch (e) {}
      fl.classList.toggle('kb-hasimg', hasImg);
      fl.style.display = 'flex';
      var r = s.getRangeAt(0).getBoundingClientRect(), w = fl.offsetWidth, h = fl.offsetHeight;
      var top = r.top - h - 8; if (top < 8) top = r.bottom + 8;
      fl.style.top = top + 'px'; fl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
      saveSel();
    }
    document.addEventListener('selectionchange', function () {
      if (pop || (document.activeElement && document.activeElement.closest && document.activeElement.closest('.kb-rte-fl'))) return;
      placeFl();
    });
    document.addEventListener('scroll', function () { if (fl && fl.style.display !== 'none') placeFl(); }, true);
  })();

  function boot() {
    ready.then(function () {
      if (!client()) return;
      if (!session) { renderLogin(); return; }
      if (noAccess) { renderPending(); return; }
      presStart();
      if (OWNER && email() === OWNER) initOwnerPanel();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
