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
    var c = client(), fab = null, rows = [];
    // Yönetici için her zaman görünen düğme; bekleyen varsa kırmızı ve sayılı
    function drawFab(n) {
      if (!fab) fab = mount(h('button', { class: 'kbx-fab idle', type: 'button', title: 'Erişim isteklerini aç', onclick: openPanel }));
      fab.textContent = '';
      fab.appendChild(document.createTextNode('Onay bekleyenler'));
      fab.appendChild(h('b', { text: String(n) }));
      fab.className = 'kbx-fab' + (n ? '' : ' idle');
      fab.setAttribute('aria-label', 'Onay bekleyenler: ' + n);
    }
    drawFab(0);
    async function load() {
      var r = await c.from('access_requests').select('user_id,email,username,display_name,provider,status,created_at').order('created_at', { ascending: true });
      rows = (r && r.data) || [];
      var n = rows.filter(function (x) { return x.status === 'pending'; }).length;
      drawFab(n);
      return rows;
    }
    function openPanel() {
      var box = h('div', { class: 'kbx-pbox' });
      var panel = h('div', { class: 'kbx-panel', role: 'dialog', 'aria-label': 'Onay bekleyenler', onclick: function (e) { if (e.target === panel) panel.remove(); } }, [box]);
      function draw() {
        box.textContent = '';
        box.appendChild(h('div', { class: 'kbx-ph' }, [h('h2', { text: 'Erişim istekleri' }), h('button', { class: 'kbx-x', type: 'button', 'aria-label': 'Kapat', text: '×', onclick: function () { panel.remove(); } })]));
        box.appendChild(h('p', { text: 'Onayladığın kişi ekibe eklenir ve tüm projelerde düzenleyebilir olarak başlar. Ekip listesinden istediğin projeden çıkarabilirsin.' }));
        var pend = rows.filter(function (x) { return x.status === 'pending'; }), rej = rows.filter(function (x) { return x.status === 'rejected'; });
        if (!pend.length) box.appendChild(h('div', { class: 'kbx-empty', text: 'Bekleyen istek yok.' }));
        pend.concat(rej).forEach(function (req) {
          var label = req.username || req.display_name || req.email || 'Kullanıcı';
          var sub = req.username ? 'Kullanıcı adıyla kayıt' : (req.email || '');
          var acts = h('div', { class: 'kbx-acts' });
          var okB = h('button', { class: 'ok', type: 'button', text: 'Onayla' });
          okB.addEventListener('click', async function () {
            okB.disabled = true; okB.textContent = 'Onaylanıyor…';
            try { await approve(req); await load(); draw(); }
            catch (e) { okB.disabled = false; okB.textContent = 'Onayla'; alert('Onaylanamadı: ' + (e.message || e)); }
          });
          acts.appendChild(okB);
          if (req.status === 'pending') {
            var noB = h('button', { type: 'button', text: 'Reddet' });
            noB.addEventListener('click', async function () {
              noB.disabled = true;
              var u = await c.from('access_requests').update({ status: 'rejected' }).eq('user_id', req.user_id);
              if (u.error) { noB.disabled = false; alert('Reddedilemedi: ' + u.error.message); return; }
              await load(); draw();
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
        var reqIds = {}; rows.forEach(function (x) { reqIds[x.user_id] = 1; });
        var former = formerMembers().filter(function (p) { return !reqIds[p.id]; });
        if (former.length) {
          box.appendChild(h('h3', { class: 'kbx-sec', text: 'Ekipte olmayan hesaplar' }));
          former.forEach(function (p) {
            var label = p.name || p.email || 'Kullanıcı';
            box.appendChild(h('div', { class: 'kbx-row' }, [
              h('span', { class: 'kbx-av', text: initials(label) }),
              h('div', { class: 'kbx-who' }, [h('strong', { text: label }), h('span', { text: p.email && p.name ? p.email : 'Hiçbir projede değil' })]),
              h('div', { class: 'kbx-acts' }, [delBtn(p.id, label)])
            ]));
          });
        }
      }
      function delBtn(id, label) {
        var b = h('button', { class: 'del', type: 'button', text: 'Hesabı sil' });
        b.addEventListener('click', async function () {
          b.disabled = true; b.textContent = 'Siliniyor…';
          try { if (await deleteAccount(id, label)) { await load(); } draw(); }
          catch (e) { b.disabled = false; b.textContent = 'Hesabı sil'; alert('Silinemedi: ' + (e.message || e)); }
        });
        return b;
      }
      load().then(draw, draw);
      mount(panel);
    }
    load().catch(function () {});
    setInterval(function () { if (!document.hidden) load().catch(function () {}); }, 30000);
    window.__kb.openApprovals = openPanel;
  }

  function boot() {
    ready.then(function () {
      if (!client()) return;
      if (!session) { renderLogin(); return; }
      if (noAccess) { renderPending(); return; }
      if (OWNER && email() === OWNER) initOwnerPanel();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
