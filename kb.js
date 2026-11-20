/* FEV Kanban – Supabase bağlantı katmanı.
   Board kodu verilere window.claude.use('user' | 'db' | 'assets') üzerinden ulaşır;
   bu dosya o arayüzü Supabase (giriş, veritabanı, dosya depolama) ile sağlar. */
(function () {
  'use strict';
  var C = window.KB_CONFIG || {};
  var OWNER = String(C.OWNER_EMAIL || '').trim().toLowerCase();
  var BUCKET = C.BUCKET || 'attachments';
  var sb = null, session = null, noAccess = false;

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

  function email() { return String((session && session.user && session.user.email) || '').toLowerCase(); }

  /* ---------- user ---------- */
  var user = {
    me: async function () {
      var u = session.user, m = u.user_metadata || {};
      return { id: u.id, name: m.full_name || m.name || '', email: email() || null, avatarUrl: '', color: '#B9052D',
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
})();
