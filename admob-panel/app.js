/* AdMob Kazanç Paneli — kişisel, salt-okunur AdMob paneli.
   Veri: AdMob API v1 (networkReport). Giriş: Google OAuth (tarayıcıda, sunucusuz). */
(function () {
  'use strict';

  const CFG = window.ADMOB_CONFIG || {};
  const THEMES = window.THEMES;
  const SCOPE = 'https://www.googleapis.com/auth/admob.readonly';
  const API = 'https://admob.googleapis.com/v1/';
  const DEMO = !CFG.CLIENT_ID;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const S = {
    period: 'bugun', cur: LS.get('cur', 'TRY'), tab: 'ozet', app: 'all',
    theme: LS.get('theme', 'orman'), showThemes: false,
    loading: false, error: '', needLogin: false, updated: null,
    apps: [], daily: {}, lifetime: {}, countries: {}, countriesLoading: false
  };

  // ---------- yardımcılar ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d) => (isFinite(n) ? n : 0).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v) => S.cur === 'TRY' ? '₺' + nf(v, 2) : nf(v, 2) + ' $';
  const pctf = (v, d) => isFinite(v) ? '%' + nf(v * 100, d) : '–';
  const ymd = (dt) => dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0');
  const dObj = (dt) => ({ year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() });
  const addDays = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };
  const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
  const zero = () => ({ e: 0, imp: 0, clk: 0, req: 0, mat: 0 });
  const add = (a, b) => { a.e += b.e; a.imp += b.imp; a.clk += b.clk; a.req += b.req; a.mat += b.mat; return a; };
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['tr'], { type: 'region' }); } catch (e) {}
  const countryName = (c) => { try { return (regionNames && regionNames.of(c)) || c; } catch (e) { return c; } };

  const PERIODS = {
    bugun: { label: 'Bugün', hero: 'Bugünkü kazanç', prevLabel: 'dünle kıyasla', days: 1 },
    dun: { label: 'Dün', hero: 'Dünkü kazanç', prevLabel: 'önceki günle kıyasla', days: 1 },
    hafta: { label: '7 Gün', hero: 'Son 7 günün kazancı', prevLabel: 'önceki 7 günle kıyasla', days: 7 },
    ay: { label: '30 Gün', hero: 'Son 30 günün kazancı', prevLabel: 'önceki 30 günle kıyasla', days: 30 }
  };
  function ranges(per) {
    const t = today0();
    const off = per === 'dun' ? 1 : 0;
    const n = PERIODS[per].days;
    const end = addDays(t, -off), start = addDays(end, -(n - 1));
    return { start, end, pStart: addDays(start, -n), pEnd: addDays(start, -1) };
  }
  function sumDaily(start, end, appId) {
    const out = zero();
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const day = S.daily[ymd(d)];
      if (!day) continue;
      for (const id in day) if (appId === 'all' || appId === id) add(out, day[id]);
    }
    return out;
  }

  // ---------- Google girişi (yönlendirme ile; iPhone ana ekran uygulamasında da çalışır) ----------
  const redirectUri = () => CFG.REDIRECT_URI || (location.origin + location.pathname);
  function readTokenFromHash() {
    if (!location.hash || location.hash.indexOf('access_token=') < 0) return;
    const p = new URLSearchParams(location.hash.slice(1));
    const tok = p.get('access_token'), exp = Number(p.get('expires_in') || 3600);
    if (tok && p.get('state') === LS.get('oauthState', '')) {
      LS.set('tok', { t: tok, exp: Date.now() + (exp - 60) * 1000 });
    }
    LS.del('oauthState');
    history.replaceState(null, '', location.pathname + location.search);
  }
  function token() { const t = LS.get('tok', null); return t && t.exp > Date.now() ? t.t : null; }
  function login() {
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    LS.set('oauthState', state);
    const q = new URLSearchParams({
      client_id: CFG.CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token',
      scope: SCOPE, include_granted_scopes: 'true', state
    });
    const hint = LS.get('loginHint', '');
    if (hint) q.set('login_hint', hint);
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
  }
  function logout() { LS.del('tok'); S.needLogin = true; S.apps = []; S.daily = {}; S.lifetime = {}; S.countries = {}; render(); }

  async function api(path, body) {
    const tok = token();
    if (!tok) { const e = new Error('login'); e.login = true; throw e; }
    const r = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 401) { LS.del('tok'); const e = new Error('login'); e.login = true; throw e; }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error && j.error.message) || ('AdMob hatası ' + r.status));
    return j;
  }
  let account = null;
  async function report(start, end, dims) {
    const body = { reportSpec: {
      dateRange: { startDate: dObj(start), endDate: dObj(end) },
      dimensions: dims,
      metrics: ['ESTIMATED_EARNINGS', 'IMPRESSIONS', 'CLICKS', 'AD_REQUESTS', 'MATCHED_REQUESTS'],
      localizationSettings: { currencyCode: S.cur, languageCode: 'tr-TR' }
    } };
    const res = await api(account + '/networkReport:generate', body);
    const rows = [];
    (res || []).forEach((it) => {
      if (!it.row) return;
      const dv = it.row.dimensionValues || {}, mv = it.row.metricValues || {};
      const iv = (k) => Number((mv[k] && mv[k].integerValue) || 0);
      rows.push({
        dim: dv,
        m: { e: Number((mv.ESTIMATED_EARNINGS && mv.ESTIMATED_EARNINGS.microsValue) || 0) / 1e6,
             imp: iv('IMPRESSIONS'), clk: iv('CLICKS'), req: iv('AD_REQUESTS'), mat: iv('MATCHED_REQUESTS') }
      });
    });
    return rows;
  }

  // App Store ikonları (JSONP; Apple'ın herkese açık arama servisi)
  function itunesIcon(id) {
    return new Promise((resolve) => {
      const cb = '_it' + id.replace(/\W/g, '') + Date.now();
      const s = document.createElement('script');
      const done = (v) => { delete window[cb]; s.remove(); resolve(v); };
      window[cb] = (j) => done(j && j.results && j.results[0] && (j.results[0].artworkUrl100 || j.results[0].artworkUrl60));
      s.onerror = () => done(null);
      s.src = 'https://itunes.apple.com/lookup?id=' + encodeURIComponent(id) + '&callback=' + cb;
      document.head.appendChild(s);
      setTimeout(() => window[cb] && done(null), 8000);
    });
  }

  async function loadAll() {
    if (DEMO) { loadDemo(); return; }
    if (!token()) { S.needLogin = true; render(); return; }
    S.loading = true; S.error = ''; S.needLogin = false; render();
    try {
      if (!account) {
        const acc = await api('accounts');
        if (!acc || !acc.account || !acc.account.length) throw new Error('Bu Google hesabında AdMob hesabı bulunamadı.');
        account = acc.account[0].name;
      }
      // Uygulamalar
      const appsRes = await api(account + '/apps?pageSize=100');
      const iconCache = LS.get('icons', {});
      const apps = ((appsRes && appsRes.apps) || []).map((a) => ({
        id: a.appId,
        name: (a.linkedAppInfo && a.linkedAppInfo.displayName) || (a.manualAppInfo && a.manualAppInfo.displayName) || a.appId,
        platform: a.platform === 'IOS' ? 'iOS' : a.platform === 'ANDROID' ? 'Android' : '',
        storeId: a.linkedAppInfo && a.linkedAppInfo.appStoreId,
        icon: iconCache[a.appId] || null
      }));
      // Son 60 gün, gün × uygulama
      const t = today0();
      const [dailyRows, lifeRows] = await Promise.all([
        report(addDays(t, -59), t, ['DATE', 'APP']),
        lifetimeRows(t)
      ]);
      const daily = {};
      dailyRows.forEach((r) => {
        const d = r.dim.DATE && r.dim.DATE.value, id = r.dim.APP && r.dim.APP.value;
        if (!d || !id) return;
        (daily[d] = daily[d] || {})[id] = add(daily[d][id] || zero(), r.m);
        if (!apps.find((a) => a.id === id)) apps.push({ id, name: (r.dim.APP.displayLabel || id), platform: '', icon: null });
      });
      const life = {};
      lifeRows.forEach((r) => { const id = r.dim.APP && r.dim.APP.value; if (id) life[id] = add(life[id] || zero(), r.m); });
      S.apps = apps; S.daily = daily; S.lifetime = life; S.countries = {};
      S.updated = new Date();
      if (S.app !== 'all' && !apps.find((a) => a.id === S.app)) S.app = 'all';
      // İkonlar arka planda
      apps.filter((a) => a.platform === 'iOS' && a.storeId && !a.icon).forEach(async (a) => {
        const u = await itunesIcon(a.storeId);
        if (u) { a.icon = u; iconCache[a.id] = u; LS.set('icons', iconCache); render(); }
      });
    } catch (e) {
      if (e.login) S.needLogin = true; else S.error = e.message || String(e);
    }
    S.loading = false; render();
    if (S.tab === 'countries') loadCountries();
  }
  async function lifetimeRows(t) {
    // Uzun tarih aralığını yıllara bölerek sorgula (2018'den bugüne).
    const calls = [];
    for (let y = 2018; y <= t.getFullYear(); y++) {
      const s = new Date(y, 0, 1), e = y === t.getFullYear() ? t : new Date(y, 11, 31);
      calls.push(report(s, e, ['MONTH', 'APP']).catch(() => []));
    }
    return (await Promise.all(calls)).flat();
  }
  async function loadCountries() {
    const key = S.cur + '|' + S.period;
    if (S.countries[key] || S.countriesLoading) return;
    if (DEMO) { S.countries[key] = demoCountries(); render(); return; }
    S.countriesLoading = true; render();
    try {
      const r = ranges(S.period);
      const rows = await report(r.start, r.end, ['COUNTRY', 'APP']);
      S.countries[key] = rows.map((x) => ({ c: x.dim.COUNTRY && x.dim.COUNTRY.value, app: x.dim.APP && x.dim.APP.value, m: x.m })).filter((x) => x.c);
    } catch (e) {
      if (e.login) S.needLogin = true; else S.error = e.message || String(e);
    }
    S.countriesLoading = false; render();
  }

  // ---------- örnek veri (Client ID girilmeden önce) ----------
  function loadDemo() {
    const rate = S.cur === 'TRY' ? 43 : 1;
    S.apps = [
      { id: 'demo1', name: 'Barista Akademi', platform: 'iOS', icon: null },
      { id: 'demo2', name: 'Suşi Akademi', platform: 'iOS', icon: null },
      { id: 'demo3', name: 'Pizza Akademi', platform: 'iOS', icon: null },
      { id: 'demo4', name: 'Barista Akademi', platform: 'Android', icon: null }
    ];
    const share = { demo1: [0.50, 0.46], demo4: [0.24, 0.24], demo2: [0.17, 0.19], demo3: [0.09, 0.11] };
    const t = today0(); S.daily = {}; S.lifetime = {};
    for (let i = 0; i < 60; i++) {
      const d = addDays(t, -i), base = 3.2 + Math.sin(i * 1.7) * 0.6 + (60 - i) * 0.012;
      const imp = Math.round(base * 120);
      S.daily[ymd(d)] = {};
      for (const id in share) {
        const im = Math.round(imp * share[id][1]);
        const req = Math.round(im / (0.92 * 0.78));
        const m = { e: base * share[id][0] * rate, imp: im, clk: Math.round(im * 0.024), req, mat: Math.round(req * 0.92) };
        S.daily[ymd(d)][id] = m;
        S.lifetime[id] = add(S.lifetime[id] || zero(), m);
      }
    }
    for (const id in S.lifetime) S.lifetime[id].e *= 2.2;
    S.updated = new Date(); S.loading = false; S.countries = {};
    render();
  }
  function demoCountries() {
    const r = ranges(S.period), out = [];
    const C = [['US', 0.34, 0.10], ['DE', 0.22, 0.14], ['GB', 0.12, 0.08], ['TR', 0.11, 0.46], ['NL', 0.08, 0.07], ['FR', 0.07, 0.08], ['JP', 0.06, 0.07]];
    S.apps.forEach((a) => {
      const tot = sumDaily(r.start, r.end, a.id);
      C.forEach((c) => out.push({ c: c[0], app: a.id, m: { e: tot.e * c[1], imp: Math.round(tot.imp * c[2]), clk: 0, req: 0, mat: 0 } }));
    });
    return out;
  }

  // ---------- görünüm ----------
  function T() {
    const b = THEMES[S.theme] || THEMES.orman;
    return Object.assign({}, b, {
      rs: Math.max(4, Math.round(b.r * 0.7)),
      fontStack: "'" + b.font + "', system-ui, sans-serif",
      headStack: "'" + b.head + "', system-ui, sans-serif"
    });
  }
  function pBadge(a, t, on) {
    if (!a || !a.platform) return '';
    const ios = a.platform === 'iOS';
    const bg = on ? t.onAccent : (ios ? t.chip : t.tagBg), fg = on ? t.accent : (ios ? t.text : t.tagFg);
    return `<span style="flex:none;font-size:10px;font-weight:700;line-height:1;padding:3px 6px;border-radius:6px;background:${bg};color:${fg}">${esc(a.platform)}</span>`;
  }
  function appIcon(a, size, t, on) {
    const r = Math.round(size * 0.27);
    if (a && !a.icon) { const twin = S.apps.find((o) => o.icon && o.name === a.name); if (twin) a = Object.assign({}, a, { icon: twin.icon }); }
    if (a && a.icon) return `<img class="appicon" src="${esc(a.icon)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:${r}px;flex:none">`;
    const bg = on ? t.onAccent : t.chip, fg = on ? t.accent : t.text;
    return `<span aria-hidden="true" style="width:${size}px;height:${size}px;flex:none;border-radius:${r}px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.42)}px;font-weight:800">${esc((a ? a.name : '?').charAt(0))}</span>`;
  }
  const ICON_REFRESH = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  const ICON_PALETTE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/></svg>';
  const ICON_ALL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>';

  function render() {
    const t = T();
    document.documentElement.style.setProperty('--bg', t.bg);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', t.bg);
    const root = document.getElementById('app');
    root.style.background = t.bg; root.style.color = t.text; root.style.fontFamily = t.fontStack;

    if (S.needLogin && !DEMO) { root.innerHTML = loginView(t); return; }

    const card = `background:${t.surface};border:1px solid ${t.border};border-radius:${t.r}px`;
    const iconBtn = `width:44px;height:44px;flex:none;border:1px solid ${t.border};border-radius:${t.rs}px;background:${t.surface};color:${t.text};display:flex;align-items:center;justify-content:center;padding:0`;
    const r = ranges(S.period), P = PERIODS[S.period];
    const cur = sumDaily(r.start, r.end, 'all'), prev = sumDaily(r.pStart, r.pEnd, 'all');
    const delta = prev.e > 0 ? (cur.e - prev.e) / prev.e : null;
    const upd = S.updated ? S.updated.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) + ' · ' + S.updated.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) + '’de güncellendi' : 'Yükleniyor…';

    let h = `<div style="flex:none;padding:16px 20px 0;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em;font-family:${t.headStack};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Kazançlar</h1>
          <div style="display:flex;align-items:center;gap:8px;flex:none">
            <button data-act="refresh" aria-label="Verileri yenile" style="${iconBtn}"><span class="${S.loading ? 'spin' : ''}" style="display:flex">${ICON_REFRESH}</span></button>
            <button data-act="themes" aria-label="Tema seç" style="${iconBtn}">${ICON_PALETTE}</button>
            <div style="display:flex;background:${t.chip};border-radius:${t.rs}px;padding:3px;gap:2px">
              ${[['TRY', '₺'], ['USD', '$']].map((c) => `<button data-cur="${c[0]}" aria-pressed="${S.cur === c[0]}" style="min-width:44px;min-height:36px;border:0;border-radius:${Math.max(3, t.rs - 4)}px;font-size:14px;font-weight:700;background:${S.cur === c[0] ? t.surface : 'transparent'};color:${S.cur === c[0] ? t.text : t.muted}">${c[1]}</button>`).join('')}
            </div>
          </div>
        </div>
        <div style="font-size:12px;color:${t.muted}">${esc(upd)}${DEMO ? ' · Örnek veri' : ''}</div>
      </div>
      <div style="${card};padding:14px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:4px;background:${t.seg};border-radius:${t.rs}px;padding:4px">
          ${Object.keys(PERIODS).map((k) => `<button data-period="${k}" aria-pressed="${k === S.period}" style="flex:1 1 0;min-width:0;white-space:nowrap;min-height:44px;border:0;border-radius:${Math.max(3, t.rs - 4)}px;font-size:13px;font-weight:700;background:${k === S.period ? t.accent : 'transparent'};color:${k === S.period ? t.onAccent : t.segOff}">${PERIODS[k].label}</button>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <div style="font-size:13px;color:${t.muted}">${P.hero}</div>
          <div style="font-size:40px;font-weight:700;letter-spacing:-0.03em;line-height:1.1;font-family:${t.headStack}">${money(cur.e)}</div>
          <div style="font-size:13px;font-weight:700;color:${delta === null ? t.muted : delta >= 0 ? t.up : t.down}">${delta === null ? '–' : (delta >= 0 ? '▲ +' : '▼ −') + nf(Math.abs(delta * 100), 1) + '%'} <span style="font-weight:400;color:${t.muted}">${P.prevLabel}</span></div>
        </div>
      </div>
      <div role="tablist" style="display:flex;gap:2px;border-bottom:1px solid ${t.border}">
        ${[['ozet', 'Özet'], ['apps', 'Uygulamalar'], ['countries', 'Ülkeler'], ['hours', 'Saatler']].map((x) => `<button role="tab" data-tab="${x[0]}" aria-selected="${S.tab === x[0]}" style="flex:1 1 auto;min-width:0;padding:0 4px;white-space:nowrap;min-height:48px;border:0;background:transparent;border-bottom:3px solid ${S.tab === x[0] ? t.accent : 'transparent'};margin-bottom:-1px;font-size:14px;font-weight:700;font-family:${t.headStack};color:${S.tab === x[0] ? t.text : t.muted}">${x[1]}</button>`).join('')}
      </div>
    </div>
    <div class="scroll">`;

    if (S.error) h += `<div role="alert" style="${card};padding:14px;font-size:13px;line-height:1.5;color:${t.down}">${esc(S.error)}</div>`;

    if (S.tab === 'ozet') h += ozet(t, r, card);
    else if (S.tab === 'apps') h += appsTab(t, r, card);
    else if (S.tab === 'countries') h += countriesTab(t, card);
    else h += hoursTab(t, card);

    h += `<div style="font-size:12px;line-height:1.5;color:${t.muted};padding:0 4px">Bugünün rakamları tahminidir ve AdMob’dan birkaç saat gecikmeyle gelir.${DEMO ? '' : ` <button data-act="logout" style="border:0;background:transparent;color:${t.muted};text-decoration:underline;padding:0;font-size:12px">Çıkış yap</button>`}</div></div>`;

    if (S.showThemes) h += themeSheet(t);
    root.innerHTML = h;
    const on = root.querySelector('.chips button[aria-pressed="true"]');
    if (on) { const c = on.parentElement; c.scrollLeft = Math.max(0, on.offsetLeft - 20 - c.offsetLeft + 0); }
  }

  function ozet(t, r, card) {
    const A = S.app === 'all' ? null : S.apps.find((a) => a.id === S.app);
    const m = sumDaily(r.start, r.end, S.app);
    let life = zero();
    for (const id in S.lifetime) if (S.app === 'all' || S.app === id) add(life, S.lifetime[id]);
    const chips = [{ id: 'all', name: 'Tümü' }].concat(S.apps).map((a) => {
      const on = S.app === a.id;
      const ic = a.id === 'all'
        ? `<span style="width:28px;height:28px;flex:none;border-radius:8px;background:${on ? t.onAccent : t.chip};color:${on ? t.accent : t.text};display:flex;align-items:center;justify-content:center">${ICON_ALL}</span>`
        : appIcon(a, 28, t, on);
      return `<button data-app="${esc(a.id)}" aria-pressed="${on}" style="flex:none;min-height:40px;padding:0 14px 0 5px;display:flex;align-items:center;gap:8px;border:1px solid ${on ? t.accent : t.border};border-radius:999px;background:${on ? t.accent : t.surface};color:${on ? t.onAccent : t.text};font-size:13px;font-weight:700">${ic}${esc(a.name)}${a.id === 'all' ? '' : pBadge(a, t, on)}</button>`;
    }).join('');
    const tiles = [
      ['Tahmini kazanç', money(m.e)],
      ['Gösterim BGBM', m.imp ? money(m.e / m.imp * 1000) : '–'],
      ['Gösterimler', nf(m.imp, 0)],
      ['Tıklamalar', nf(m.clk, 0)],
      ['İstekler', nf(m.req, 0)],
      ['Gösterim TO', pctf(m.clk / m.imp, 2)],
      ['Eşleşme oranı', pctf(m.mat / m.req, 1)],
      ['Gösterim oranı', pctf(m.imp / m.mat, 1)]
    ].map((x) => `<div style="${card.replace(t.r + 'px', t.rs + 'px')};padding:9px 12px;display:flex;flex-direction:column;gap:2px;min-width:0"><div style="font-size:12px;color:${t.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x[0]}</div><div style="font-size:18px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x[1]}</div></div>`).join('');
    return `<div class="chips">${chips}</div>
      <div style="background:${t.heroBg};color:${t.heroText};border-radius:${t.r}px;padding:14px 16px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px">
        <div style="font-size:12px;color:${t.heroMuted}">${A ? esc(A.name) + (A.platform ? ' (' + esc(A.platform) + ')' : '') + ' · toplam kazanç' : 'Şu ana kadar toplam kazanç'}</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:-0.02em;font-family:${t.headStack}">${money(life.e)}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${tiles}</div>`;
  }

  function bar(pct, t, h) {
    return `<div style="height:${h}px;background:${t.track};border-radius:3px"><div style="height:${h}px;width:${Math.max(0, Math.min(100, pct))}%;background:${t.accent};border-radius:3px"></div></div>`;
  }

  function appsTab(t, r, card) {
    const rows = S.apps.map((a) => ({ a, m: sumDaily(r.start, r.end, a.id) })).sort((x, y) => y.m.e - x.m.e);
    const max = Math.max(0.0001, ...rows.map((x) => x.m.e));
    if (!rows.length) return `<div style="${card};padding:18px;font-size:14px;color:${t.muted}">${S.loading ? 'Yükleniyor…' : 'Uygulama bulunamadı.'}</div>`;
    return `<div style="${card};padding:18px;display:flex;flex-direction:column;gap:14px">${rows.map((x) => `
      <button data-app-open="${esc(x.a.id)}" style="border:0;background:transparent;padding:0;color:inherit;text-align:left;display:flex;align-items:center;gap:12px">
        ${appIcon(x.a, 44, t, false)}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><span style="min-width:0;display:flex;align-items:center;gap:6px"><span style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.a.name)}</span>${pBadge(x.a, t, false)}</span><span style="font-size:15px;font-weight:700;flex:none">${money(x.m.e)}</span></div>
          ${bar(x.m.e / max * 100, t, 6)}
          <div style="font-size:12px;color:${t.muted}">${nf(x.m.imp, 0)} gösterim</div>
        </div>
      </button>`).join('')}</div>`;
  }

  function countriesTab(t, card) {
    const key = S.cur + '|' + S.period;
    const data = S.countries[key];
    const chips = [{ id: 'all', name: 'Tümü' }].concat(S.apps).map((a) => {
      const on = S.app === a.id;
      return `<button data-app="${esc(a.id)}" aria-pressed="${on}" style="flex:none;min-height:36px;padding:0 12px;border:1px solid ${on ? t.accent : t.border};border-radius:999px;background:${on ? t.accent : t.surface};color:${on ? t.onAccent : t.text};display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700">${esc(a.name)}${a.id === 'all' ? '' : pBadge(a, t, on)}</button>`;
    }).join('');
    if (!data) return `<div class="chips">${chips}</div><div style="${card};padding:18px;font-size:14px;color:${t.muted}">Yükleniyor…</div>`;
    const agg = {};
    data.forEach((x) => { if (S.app === 'all' || x.app === S.app) agg[x.c] = add(agg[x.c] || zero(), x.m); });
    const rows = Object.keys(agg).map((c) => ({ c, m: agg[c] })).sort((a, b) => b.m.e - a.m.e || b.m.imp - a.m.imp);
    const max = Math.max(0.0001, ...rows.map((x) => x.m.e));
    if (!rows.length) return `<div class="chips">${chips}</div><div style="${card};padding:18px;font-size:14px;color:${t.muted}">Bu dönemde veri yok.</div>`;
    return `<div class="chips">${chips}</div><div style="${card};padding:18px;display:flex;flex-direction:column;gap:14px">${rows.map((x) => `
      <div style="display:flex;align-items:center;gap:12px">
        ${/^[A-Z]{2}$/.test(x.c) ? `<img class="flag" src="https://flagcdn.com/${x.c.toLowerCase()}.svg" alt="" onerror="this.style.visibility='hidden'" style="box-shadow:0 0 0 1px ${t.border}">` : `<span class="flag" style="background:${t.chip}"></span>`}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><span style="font-size:14px;font-weight:600">${esc(countryName(x.c))}</span><span style="font-size:14px;font-weight:700;flex:none">${money(x.m.e)}</span></div>
          ${bar(x.m.e / max * 100, t, 5)}
          <div style="font-size:12px;color:${t.muted}">${nf(x.m.imp, 0)} gösterim</div>
        </div>
      </div>`).join('')}</div>`;
  }

  function hoursTab(t, card) {
    const tag = `font-size:11px;font-weight:600;color:${t.tagFg};background:${t.tagBg};border-radius:8px;padding:4px 8px`;
    return `<div style="${card};padding:18px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0;font-size:15px;font-weight:700">Saatlere göre reklam</h2><span style="${tag}">Firebase bağlanınca</span></div>
        <div style="font-size:13px;line-height:1.5;color:${t.muted}">AdMob saatlik veri vermiyor. Oyunlarına Firebase Analytics eklendiğinde burada gün içindeki reklam yoğunluğu görünecek.</div>
      </div>
      <div style="${card};padding:18px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0;font-size:15px;font-weight:700">Kullanıcılar</h2><span style="${tag}">Firebase bağlanınca</span></div>
        <div style="font-size:13px;line-height:1.5;color:${t.muted}">Aktif kullanıcı, kullanıcı başına reklam ve reklam aralığı Firebase verisiyle gelecek.</div>
      </div>`;
  }

  function themeSheet(t) {
    return `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;flex-direction:column;justify-content:flex-end;z-index:5">
      <button data-act="closeThemes" aria-label="Kapat" style="flex:1;border:0;background:transparent"></button>
      <div role="dialog" aria-label="Tema seç" style="background:${t.surface};color:${t.text};border-radius:${t.r}px ${t.r}px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;font-size:18px;font-weight:700;font-family:${t.headStack}">Tema</h2>
          <button data-act="closeThemes" style="min-height:44px;min-width:44px;border:0;background:transparent;color:${t.accent === t.surface ? t.text : t.accent};font-size:15px;font-weight:700">Bitti</button></div>
        <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px">
          ${Object.keys(THEMES).map((k) => { const o = THEMES[k], on = k === S.theme; return `<button data-theme="${k}" aria-pressed="${on}" aria-label="${esc(o.n)}" style="border:0;background:transparent;padding:0;display:flex;flex-direction:column;align-items:center;gap:6px;color:${on ? t.text : t.muted}">
            <span style="width:52px;height:52px;border-radius:50%;background:${o.bg};box-shadow:0 0 0 ${on ? 3 : 0}px ${t.text},inset 0 0 0 1px rgba(0,0,0,0.12);display:flex;align-items:center;justify-content:center"><span style="width:22px;height:22px;border-radius:50%;background:${o.accent}"></span></span>
            <span style="font-size:11px;font-weight:600">${esc(o.n)}</span></button>`; }).join('')}
        </div>
      </div>
    </div>`;
  }

  function loginView(t) {
    return `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:32px">
      <h1 style="margin:0;font-size:30px;font-weight:700;font-family:${t.headStack}">Kazançlar</h1>
      <p style="margin:0;font-size:15px;line-height:1.5;color:${t.muted}">AdMob verilerini görmek için AdMob hesabının bağlı olduğu Google hesabıyla giriş yap. Uygulama yalnızca okuma izni ister.</p>
      ${S.error ? `<div role="alert" style="font-size:13px;color:${t.down}">${esc(S.error)}</div>` : ''}
      <button data-act="login" style="min-height:52px;border:0;border-radius:${t.rs}px;background:${t.accent};color:${t.onAccent};font-size:16px;font-weight:700">Google ile giriş yap</button>
    </div>`;
  }

  // ---------- olaylar ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.period) { S.period = d.period; render(); if (S.tab === 'countries') loadCountries(); }
    else if (d.cur) { if (S.cur !== d.cur) { S.cur = d.cur; LS.set('cur', S.cur); loadAll(); } }
    else if (d.tab) { S.tab = d.tab; render(); if (S.tab === 'countries') loadCountries(); const sc = document.querySelector('.scroll'); if (sc) sc.scrollTop = 0; }
    else if (d.app) { S.app = d.app; render(); }
    else if (d.appOpen) { S.app = d.appOpen; S.tab = 'ozet'; render(); }
    else if (d.theme) { S.theme = d.theme; LS.set('theme', S.theme); render(); }
    else if (d.act === 'themes') { S.showThemes = true; render(); }
    else if (d.act === 'closeThemes') { S.showThemes = false; render(); }
    else if (d.act === 'refresh') { if (!S.loading) loadAll(); }
    else if (d.act === 'login') login();
    else if (d.act === 'logout') logout();
  });
  // Uygulamaya geri dönülünce (5 dk'dan eskiyse) kendiliğinden yenile
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.updated && Date.now() - S.updated > 5 * 60 * 1000 && !S.loading) loadAll();
  });

  readTokenFromHash();
  render();
  loadAll();
})();
