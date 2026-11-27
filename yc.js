/* Canlı ortak yazım (Google Dokümanlar gibi): zengin metin kutuları Yjs ile harf harf birleşir.
   - Her metin kutusu (görev açıklaması, alt görev, proje notları, boş sayfalar…) bir anahtarla eşleşir.
   - Aynı kutuyu açık tutan herkes, o projenin özel canlı kanalı üzerinden değişiklikleri anında alışverir.
   - Kalıcı kayıt eskisi gibi belgeye yazılır (kb.js birleştirmeli yazma); Yjs yalnızca açık oturumları eşitler.
   - Karşı tarafın imleci ve seçimi, kişinin renginde gösterilir. */
(function () {
  'use strict';
  var Y = null, yLoad = null, failed = false;
  var TAB = Math.random().toString(36).slice(2, 10);       // bu sekme
  var entries = new Map();                                  // anahtar -> oturum
  var chans = new Map();                                    // proje -> kanal
  var cursors = new Map();                                  // anahtar -> Map(sekme -> {o, n, bg, fg, at})
  var WAIT = 1200;                                          // açılışta diğerlerinin cevabını bekleme süresi

  function kb() { return window.__kb || {}; }
  function app() { return window.__kbApp || null; }
  function P() { return window.__kbPlan || {}; }
  function san(h) { var s = window.__kbSanitize; var o = s ? s(String(h || '')) : String(h || ''); return o.replace(/​/g, ''); }

  function loadY() {
    if (!yLoad) yLoad = import(new URL('vendor/y/index.js', document.baseURI).href).then(function (m) { Y = m; return m; }, function (e) { failed = true; console.warn('[yc] Yjs yüklenemedi', e); throw e; });
    return yLoad;
  }

  /* ---------- ikili veri <-> metin (kanal JSON taşır) ---------- */
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) || 1; }

  /* ---------- taşıma: projenin özel Realtime kanalı (testte BroadcastChannel) ---------- */
  function chanFor(pid) {
    if (chans.has(pid)) return chans.get(pid);
    var ch = { pid: pid, ok: false, q: [], send: null, close: null };
    chans.set(pid, ch);
    if (window.__kbYBus && window.__kbYBus.send) {   // yerel test: mesajlar test düzeneği üzerinden
      window.__kbYOnMsg = onMsg;
      ch.send = function (m) { window.__kbYBus.send(pid, m); }; ch.ok = true;
      return ch;
    }
    var c = kb().sb && kb().sb();
    if (!c || typeof c.channel !== 'function') return ch;
    try { var tk = kb().token && kb().token(); if (tk && c.realtime && c.realtime.setAuth) c.realtime.setAuth(tk); } catch (x) {}
    var rc = c.channel('kby:' + pid, { config: { private: true, broadcast: { self: false, ack: false } } });
    rc.on('broadcast', { event: 'y' }, function (p) { onMsg(pid, p && p.payload); });
    rc.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        ch.ok = true; var q = ch.q; ch.q = [];
        q.forEach(function (m) { ch.send(m); });
        entries.forEach(function (e) { if (e.pid === pid && e.ready) ask(e); });   // yeniden bağlanınca eşitle
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { ch.ok = false; }
    });
    ch.send = function (m) { try { rc.send({ type: 'broadcast', event: 'y', payload: m }); } catch (e) {} };
    ch.close = function () { try { c.removeChannel(rc); } catch (e) {} };
    return ch;
  }
  function send(pid, m) {
    m.f = TAB; var ch = chanFor(pid);
    if (!ch.send) return;
    if (ch.ok) ch.send(m); else if (ch.q.length < 200) ch.q.push(m);
  }

  /* ---------- oturum ---------- */
  function entry(k, pid) {
    var e = entries.get(k);
    if (e) return e;
    e = { k: k, pid: pid, doc: null, text: null, ready: false, eds: new Set(), edited: 0, html0: null, waitT: null, out: [], outT: null, dropT: null, gen: 0 };
    entries.set(k, e);
    newDoc(e);
    return e;
  }
  function newDoc(e) {
    if (e.doc) try { e.doc.destroy(); } catch (x) {}
    e.gen++;
    var g = e.gen, d = new Y.Doc(), t = d.getText('h');
    e.doc = d; e.text = t;
    d.on('update', function (u, origin) {
      if (g !== e.gen || origin === 'net' || origin === 'init') return;
      e.out.push(u);
      if (!e.outT) e.outT = setTimeout(function () { flushOut(e); }, 40);
    });
    t.observe(function (ev, tr) {
      if (g !== e.gen || tr.origin === 'loc') return;
      paintAll(e);
    });
  }
  function flushOut(e) {
    e.outT = null; if (!e.out.length) return;
    var u = e.out.length === 1 ? e.out[0] : Y.mergeUpdates(e.out); e.out = [];
    send(e.pid, { t: 'u', k: e.k, u: b64(u) });
  }
  function ask(e) { send(e.pid, { t: 'q', k: e.k, sv: b64(Y.encodeStateVector(e.doc)) }); }

  // kimse cevap vermezse: kayıttaki metinle başla. Aynı metinle başlayan herkes aynı yapıyı üretsin diye
  // istemci numarası metnin özetinden türetilir (sonradan birleşince çift metin oluşmaz).
  function initFrom(e, html) {
    if (e.ready) return;
    clearTimeout(e.waitT);
    var d0 = new Y.Doc(); d0.clientID = hash(e.k + '|' + html);
    if (html) d0.getText('h').insert(0, html);
    Y.applyUpdate(e.doc, Y.encodeStateAsUpdate(d0), 'init'); d0.destroy();
    e.html0 = html; e.ready = true;
    paintAll(e);
  }

  function onMsg(pid, m) {
    if (!m || m.f === TAB || !m.k || !Y) return;
    var e = entries.get(m.k);
    if (m.t === 'c') { setCursor(m); return; }
    if (m.t === 'bye') { var cm = cursors.get(m.k); if (cm && cm.delete(m.f)) drawCursors(); return; }
    if (!e) return;
    if (m.t === 'q') {                                  // biri bu kutuyu açtı: elimdekini ver
      if (!e.ready) return;
      var sv = m.sv ? unb64(m.sv) : null;
      send(pid, { t: 's', k: e.k, to: m.f, u: b64(Y.encodeStateAsUpdate(e.doc, sv || undefined)), sv: b64(Y.encodeStateVector(e.doc)) });
      return;
    }
    if (m.t === 's') {
      if (m.to !== TAB) { if (e.ready) applyNet(e, m.u); return; }
      if (e.ready && !e.edited) {                       // kendi başlangıcımı bırak, ortak oturuma katıl
        if (e.html0 != null && sameLineage(e, m.u)) { applyNet(e, m.u); }
        else { newDoc(e); applyNet(e, m.u); e.ready = true; paintAll(e); }
      } else {
        applyNet(e, m.u);
        if (!e.ready) { clearTimeout(e.waitT); e.ready = true; paintAll(e); }
      }
      if (m.sv) { var back = Y.encodeStateAsUpdate(e.doc, unb64(m.sv)); if (back.length > 2) send(pid, { t: 'u', k: e.k, u: b64(back) }); }
      return;
    }
    if (m.t === 'u') {
      applyNet(e, m.u);
      if (!e.ready && (!e.askAt || Date.now() - e.askAt > 400)) { e.askAt = Date.now(); ask(e); }   // biri yazıyor: durumu tekrar iste
    }
  }
  // gelen durum benim başlangıç yapımı (aynı metin özeti) içeriyorsa birleştirmek güvenli
  function sameLineage(e, u64) {
    try { var id = hash(e.k + '|' + e.html0), sv = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(unb64(u64))); return e.html0 === '' ? true : sv.has(id); } catch (x) { return false; }
  }
  // uzaktan gelen işlenmeden önce: bekleyen yerel değişiklikleri hemen ortak metne yaz (son harf kaybolmasın)
  function syncLocal(e) {
    e.eds.forEach(function (ed) {
      var rec = ed.__yMo ? ed.__yMo.takeRecords() : [];
      if (ed.__yLT || rec.length) { clearTimeout(ed.__yLT); ed.__yLT = null; if (e.ready) local(ed); }
    });
  }
  function applyNet(e, u64) {
    if (e.ready) syncLocal(e);
    try { Y.applyUpdate(e.doc, unb64(u64), 'net'); } catch (x) { console.warn('[yc] güncelleme uygulanamadı', x); }
  }

  /* ---------- editörlere bağlama ---------- */
  function keyOf(ed) {
    if (ed.__host) {
      var kind = ed.__host.__kind, key = String(ed.__host.__key || ''), a = app();
      if (kind !== 'desc' && kind !== 'sub') return null;           // yorum taslakları kişisel
      var tid = key.split('|')[0], t = a && (a.state.tasks || []).find(function (x) { return x.id === tid; });
      if (!t || !t.projectId) return null;
      return { k: 'tasks/' + tid + '#' + (kind === 'desc' ? 'desc' : 'sub/' + key.split('|')[1]), pid: t.projectId };
    }
    if (ed.getAttribute('data-kind') === 'plan' && ed.hasAttribute('data-b')) {
      var h = ed.closest('.kb-plan-host,.pl-modal,.pl-pop'), pid = h && h.getAttribute('data-pid');
      if (!pid || !P().yKey) return null;
      var k = P().yKey(pid, ed.getAttribute('data-b'));
      return k ? { k: k, pid: pid } : null;
    }
    return null;
  }
  function curHtml(ed) { return san(ed.innerHTML); }

  function attach(ed) {
    var ki = keyOf(ed); if (!ki) return;
    if (ed.__yK === ki.k && ed.__yOn) return;
    if (ed.__yK && ed.__yK !== ki.k) detach(ed);
    var e = entry(ki.k, ki.pid);
    clearTimeout(e.dropT); e.dropT = null;
    ed.__yK = ki.k; ed.__yOn = true; e.eds.add(ed);
    ed.__yText = textOf(ed); ed.__yBase = curHtml(ed);
    if (!ed.__yMo) {
      ed.__yMo = new MutationObserver(function () { if (!ed.__yApplying) schedLocal(ed); });
      ed.__yMo.observe(ed, { childList: true, subtree: true, characterData: true, attributes: true });
    }
    if (e.ready) { paint(e, ed); return; }
    if (e.eds.size === 1 && !e.waitT) {
      ask(e);
      var html = curHtml(ed);
      e.waitT = setTimeout(function () { e.waitT = null; if (!e.ready) initFrom(e, html); }, WAIT);
    }
  }
  function detach(ed) {
    var k = ed.__yK, e = k && entries.get(k);
    if (ed.__yMo) { ed.__yMo.disconnect(); ed.__yMo = null; }
    ed.__yOn = false; ed.__yK = null; clearTimeout(ed.__yLT);
    if (!e) return;
    e.eds.delete(ed);
    if (!e.eds.size) {
      send(e.pid, { t: 'bye', k: k });
      e.dropT = setTimeout(function () { if (e.eds.size) return; flushOut(e); try { e.doc.destroy(); } catch (x) {} entries.delete(k); clearTimeout(e.waitT); }, 4000);
    }
  }

  // yerel değişiklik: kutunun HTML'ini ortak metne en küçük farkla işle
  function schedLocal(ed) { clearTimeout(ed.__yLT); ed.__yLT = setTimeout(function () { ed.__yLT = null; local(ed); }, 30); }
  function local(ed) {
    var e = ed.__yK && entries.get(ed.__yK); if (!e || !ed.isConnected) return;
    var html = curHtml(ed);
    if (!e.ready) {                                    // cevap beklenirken yazmaya başladı: hemen kayıttaki metinle başla
      initFrom(e, ed.__yBase != null ? ed.__yBase : html);
    }
    var old = e.text.toString();
    if (html === old) return;
    var p = 0, ol = old.length, nl = html.length;
    while (p < ol && p < nl && old.charCodeAt(p) === html.charCodeAt(p)) p++;
    var s = 0;
    while (s < ol - p && s < nl - p && old.charCodeAt(ol - 1 - s) === html.charCodeAt(nl - 1 - s)) s++;
    e.doc.transact(function () {
      if (ol - p - s > 0) e.text.delete(p, ol - p - s);
      if (nl - p - s > 0) e.text.insert(p, html.slice(p, nl - s));
    }, 'loc');
    e.edited = Date.now();
    var nt = textOf(ed); shiftCursors(e.k, ed.__yText || '', nt); ed.__yText = nt;
    e.eds.forEach(function (o) { if (o !== ed) paint(e, o); });
    drawCursors();
  }

  /* ---------- uzaktan gelen metni kutuya işle (imleç yerinde kalsın) ---------- */
  function paintAll(e) { e.eds.forEach(function (ed) { paint(e, ed); }); drawCursors(); onRemote(e); }
  function paint(e, ed) {
    if (!e.ready || !ed.isConnected) return;
    var html = e.text.toString();
    if (curHtml(ed) === html) return;
    var sel = window.getSelection(), has = sel.rangeCount && ed.contains(sel.anchorNode), s0 = 0, s1 = 0, oldT = textOf(ed);
    if (has) { s0 = offOf(ed, sel.anchorNode, sel.anchorOffset); s1 = offOf(ed, sel.focusNode, sel.focusOffset); }
    ed.__yApplying = true;
    try {
      var tpl = document.createElement('template'); tpl.innerHTML = html;
      morph(ed, tpl.content);
    } finally { if (ed.__yMo) ed.__yMo.takeRecords(); ed.__yApplying = false; }
    var newT = textOf(ed);
    if (has) { setSel(ed, adj(s0, oldT, newT), adj(s1, oldT, newT)); }
    ed.__yText = newT;
  }
  // uzaktan değişiklik geldikten sonra: bu oturumda ben de yazdıysam güncel hali ben de kaydederim
  // (böylece son yazan kim olursa olsun kayıttaki metin herkesinkini içerir). Yazmadıysam yazan kaydeder.
  function onRemote(e) {
    e.eds.forEach(function (ed) {
      if (ed.__host) {
        if (e.edited) { clearTimeout(ed.__ySave); ed.__ySave = setTimeout(function () { ed.dispatchEvent(new Event('blur')); }, 1500); }
        else ed.__host.__last = san(ed.innerHTML);
      } else if (e.edited && ed.isContentEditable) {
        clearTimeout(ed.__ySave); ed.__ySave = setTimeout(function () { if (ed.isConnected) ed.dispatchEvent(new Event('input', { bubbles: true })); }, 1500);
      }
    });
  }

  function morph(from, to) {
    var fc = from.firstChild, tc = to.firstChild;
    while (tc) {
      var next = tc.nextSibling;
      if (!fc) { from.appendChild(tc); tc = next; continue; }
      if (fc.nodeType === tc.nodeType && fc.nodeName === tc.nodeName) {
        if (fc.nodeType === 3 || fc.nodeType === 8) { if (fc.nodeValue !== tc.nodeValue) fc.nodeValue = tc.nodeValue; }
        else if (fc.nodeType === 1) { attrs(fc, tc); morph(fc, tc); }
        fc = fc.nextSibling; tc = next; continue;
      }
      var nf = fc.nextSibling;                            // bir düğüm silinmiş olabilir
      if (nf && nf.nodeType === tc.nodeType && nf.nodeName === tc.nodeName) { from.removeChild(fc); fc = nf; continue; }
      from.insertBefore(tc, fc); tc = next;
    }
    while (fc) { var n = fc.nextSibling; from.removeChild(fc); fc = n; }
  }
  function attrs(a, b) {
    var i, n;
    for (i = a.attributes.length - 1; i >= 0; i--) { n = a.attributes[i].name; if (!b.hasAttribute(n)) a.removeAttribute(n); }
    for (i = 0; i < b.attributes.length; i++) { n = b.attributes[i]; if (a.getAttribute(n.name) !== n.value) a.setAttribute(n.name, n.value); }
  }

  /* ---------- metin konumları ---------- */
  function textOf(ed) { return ed.textContent || ''; }
  function offOf(ed, node, off) {
    try { var r = document.createRange(); r.setStart(ed, 0); r.setEnd(node, off); return r.toString().length; } catch (x) { return 0; }
  }
  function posAt(ed, o) {
    var w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT), n, last = null;
    while ((n = w.nextNode())) { var l = n.nodeValue.length; if (o <= l) return { n: n, o: o }; o -= l; last = n; }
    return last ? { n: last, o: last.nodeValue.length } : { n: ed, o: ed.childNodes.length };
  }
  function setSel(ed, a, b) {
    try { var p = posAt(ed, a), q = posAt(ed, b), s = window.getSelection(); s.setBaseAndExtent(p.n, p.o, q.n, q.o); } catch (x) {}
  }
  function adj(o, oldT, newT) {
    var p = 0, ol = oldT.length, nl = newT.length;
    while (p < ol && p < nl && oldT.charCodeAt(p) === newT.charCodeAt(p)) p++;
    var s = 0;
    while (s < ol - p && s < nl - p && oldT.charCodeAt(ol - 1 - s) === newT.charCodeAt(nl - 1 - s)) s++;
    if (o <= p) return o;
    if (o >= ol - s) return o + (nl - ol);
    return nl - s;
  }

  /* ---------- karşı tarafın imleci ---------- */
  var layer = null, lastSent = '', curT = null, beatT = null;
  function setCursor(m) {
    var cm = cursors.get(m.k); if (!cm) { cm = new Map(); cursors.set(m.k, cm); }
    if (!m.o) cm.delete(m.f); else cm.set(m.f, { o: m.o, n: m.n || '?', bg: m.bg || '#797979', fg: m.fg || '#fff', at: Date.now() });
    drawCursors();
  }
  function shiftCursors(k, oldT, newT) {
    var cm = cursors.get(k); if (!cm) return;
    cm.forEach(function (c) { c.o = [adj(c.o[0], oldT, newT), adj(c.o[1], oldT, newT)]; });
  }
  function drawCursors() {
    if (!layer) {
      layer = document.createElement('div'); layer.className = 'kb-yc-layer'; document.body.appendChild(layer);
      var st = document.createElement('style');
      st.textContent = '.kb-yc-layer{position:fixed;inset:0;pointer-events:none;z-index:58}' +
        '.kb-yc-c{position:fixed;width:2px;margin-left:-1px}' +
        '.kb-yc-c b{position:absolute;left:-1px;bottom:100%;font:600 10px/1.4 Poppins,sans-serif;padding:0 4px;border-radius:3px 3px 3px 0;white-space:nowrap}' +
        '.kb-yc-s{position:fixed;opacity:.22}';
      document.head.appendChild(st);
    }
    var h = '', now = Date.now();
    cursors.forEach(function (cm, k) {
      var e = entries.get(k); if (!e || !e.ready) return;
      cm.forEach(function (c, f) {
        if (now - c.at > 60000) { cm.delete(f); return; }
        e.eds.forEach(function (ed) {
          if (!ed.isConnected) return;
          var box = ed.getBoundingClientRect(); if (!box.width && !box.height) return;
          try {
            var a = Math.min(c.o[0], c.o[1]), b = Math.max(c.o[0], c.o[1]), p = posAt(ed, a), q = posAt(ed, b), r = document.createRange();
            r.setStart(p.n, p.o); r.setEnd(q.n, q.o);
            if (b > a) Array.prototype.forEach.call(r.getClientRects(), function (x) { h += '<div class="kb-yc-s" style="left:' + x.left + 'px;top:' + x.top + 'px;width:' + x.width + 'px;height:' + x.height + 'px;background:' + c.bg + '"></div>'; });
            var cr = document.createRange(); var fp = c.o[1] >= c.o[0] ? q : p; cr.setStart(fp.n, fp.o); cr.collapse(true);
            var rs = cr.getClientRects(), x0 = rs.length ? rs[0] : null;
            if (!x0) { var bx = (fp.n.nodeType === 1 ? fp.n : fp.n.parentElement).getBoundingClientRect(); x0 = { left: bx.left + 2, top: bx.top, height: 18 }; }
            if (x0.top < box.top - 4 || x0.top > box.bottom + 4) return;
            h += '<div class="kb-yc-c" style="left:' + x0.left + 'px;top:' + x0.top + 'px;height:' + (x0.height || 18) + 'px;background:' + c.bg + '"><b style="background:' + c.bg + ';color:' + c.fg + '">' + esc(c.n) + '</b></div>';
          } catch (x) {}
        });
      });
    });
    if (layer.__h !== h) { layer.__h = h; layer.innerHTML = h; }
  }
  function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function myStyle() {
    var me = (P().me && P().me()) || kb().uid && kb().uid(), w = P().who ? P().who(me) : null;
    return w ? { n: w.name.split(/\s+/)[0], bg: w.bg, fg: w.fg } : { n: 'Ekip üyesi', bg: '#797979', fg: '#fff' };
  }
  function sendCursor() {
    curT = null;
    var s = window.getSelection(), n = s.anchorNode, el = n && (n.nodeType === 1 ? n : n.parentElement), ed = el && el.closest && el.closest('.kb-rte-ed');
    var e = ed && ed.__yOn && entries.get(ed.__yK);
    var msg = null;
    if (e && document.activeElement && (document.activeElement === ed || ed.contains(document.activeElement))) {
      var st = myStyle();
      msg = { t: 'c', k: e.k, o: [offOf(ed, s.anchorNode, s.anchorOffset), offOf(ed, s.focusNode, s.focusOffset)], n: st.n, bg: st.bg, fg: st.fg };
    }
    var sig = msg ? JSON.stringify(msg) : '';
    if (sig === lastSent) return;
    if (!msg && lastSent) { var prev = JSON.parse(lastSent); if (entries.has(prev.k)) send(entries.get(prev.k).pid, { t: 'c', k: prev.k, o: null }); }
    lastSent = sig;
    if (msg) send(e.pid, msg);
  }
  document.addEventListener('selectionchange', function () { if (!curT) curT = setTimeout(sendCursor, 80); });
  document.addEventListener('focusout', function () { setTimeout(sendCursor, 0); });
  beatT = setInterval(function () { if (lastSent) { var m = JSON.parse(lastSent); var e = entries.get(m.k); if (e) send(e.pid, m); } drawCursors(); }, 15000);
  var rafP = false;
  function redraw() { if (rafP) return; rafP = true; requestAnimationFrame(function () { rafP = false; drawCursors(); }); }
  document.addEventListener('scroll', redraw, true); window.addEventListener('resize', redraw);

  /* ---------- sayfadaki editörleri izle ---------- */
  var scanT = null;
  function scan() {
    scanT = null;
    if (failed || !kb().uid || !kb().uid()) return;
    var eds = document.querySelectorAll('.kb-rte-host .kb-rte-ed, .kb-rte-ed[data-kind="plan"][data-b]');
    if (!eds.length && !entries.size) return;
    if (!Y) { loadY().then(scan, function () {}); return; }
    var live = new Set();
    eds.forEach(function (ed) { live.add(ed); attach(ed); });
    entries.forEach(function (e) { e.eds.forEach(function (ed) { if (!ed.isConnected || !live.has(ed)) detach(ed); }); });
  }
  function sched() { if (!scanT) scanT = setTimeout(scan, 60); }
  new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) { var t = ms[i].target; if (t.nodeType !== 1 || !t.closest || t.closest('.kb-yc-layer,.kb-rte-ed')) continue; sched(); return; }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('beforeunload', function () { entries.forEach(function (e) { flushOut(e); send(e.pid, { t: 'bye', k: e.k }); }); });
  setInterval(sched, 3000);

  window.__kbY = {
    _entries: entries, _cursors: cursors,
    textOf: function (k) { var e = entries.get(k); return e && e.ready ? e.text.toString() : null; },
    active: function (k) { var e = entries.get(k); return !!(e && e.ready); }
  };
})();
