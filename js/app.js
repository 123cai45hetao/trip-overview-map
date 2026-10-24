/* ═══════════════════════════════════════════
   行程总览 · Trip Overview
   腾讯位置服务 GL JS（用户自备 Key）
   数据仅存于浏览器 localStorage，无后端
   ═══════════════════════════════════════════ */

'use strict';

const KEY_STORAGE = 'trip-overview.tmap-key';
const SPOTS_STORAGE = 'trip-overview.spots';

const state = {
  hotel: null,   // { name, address, location:{lat,lng} }
  spots: [],     // { id, name, address, location, drive:{distance,duration}|null }
  map: null,
  markerLayer: null,
  lineLayer: null,
  routeLayer: null,
  activeSpotId: null,
  sdkReady: false,
  travelMode: 'transit', // transit（地铁+步行）/ walk / drive
};

const $ = (id) => document.getElementById(id);

/* ─────────── 内联 SVG 图标（避免外链资源） ─────────── */
const svgUrl = (inner, bg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">
    <path d="M17 1 C8.7 1 2 7.7 2 16 c0 11 15 27 15 27 s15 -16 15 -27 C32 7.7 25.3 1 17 1 Z" fill="${bg}" stroke="#fffdf8" stroke-width="2.5"/>
    ${inner}
  </svg>`
);
const ICON_HOTEL = svgUrl('<g fill="#fffdf8"><rect x="10" y="10" width="14" height="16" rx="1.5"/><g fill="#d95d39"><rect x="12.5" y="13" width="3" height="3"/><rect x="18.5" y="13" width="3" height="3"/><rect x="12.5" y="18.5" width="3" height="3"/><rect x="18.5" y="18.5" width="3" height="3"/><rect x="15" y="23" width="4" height="3"/></g></g>', '#d95d39');

// 带编号的目的地图钉（数字画进 SVG，与左侧列表序号对应）
const MAX_SPOT_STYLES = 50;
const ICON_SPOTS = Array.from({ length: MAX_SPOT_STYLES }, (_, i) =>
  svgUrl(`<text x="17" y="20" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#fffdf8">${i + 1}</text>`, '#22415e')
);

/* ─────────── 安全存储（localStorage 不可用时退化为内存） ─────────── */
const memoryStore = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return memoryStore[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { memoryStore[k] = v; } },
};

/* ─────────── 全局错误可见化 ─────────── */
function showFatal(msg) {
  let bar = document.getElementById('fatalBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fatalBar';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999;background:#b8472a;color:#fff;font:13px/1.6 sans-serif;padding:10px 16px;';
    document.body.appendChild(bar);
  }
  bar.textContent = '⚠ ' + msg;
}
window.addEventListener('error', (e) => showFatal(e.message || '脚本错误'));
window.addEventListener('unhandledrejection', (e) => showFatal(String(e.reason && e.reason.message || e.reason)));

/* ─────────── Key 管理 ─────────── */
function getKey() { return store.get(KEY_STORAGE) || ''; }

function showKeyModal() { $('keyModal').hidden = false; $('keyInput').value = getKey(); setTimeout(() => $('keyInput').focus(), 60); }

function hideKeyModal() { $('keyModal').hidden = true; }

$('keySaveBtn').addEventListener('click', onKeySave);
$('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onKeySave(); });

function onKeySave() {
  const key = $('keyInput').value.trim();
  if (!key) { $('keyErr').hidden = false; return; }
  $('keyErr').hidden = true;
  store.set(KEY_STORAGE, key);
  hideKeyModal();
  bootstrap();
}

$('settingsBtn').addEventListener('click', showKeyModal);

/* ─────────── SDK 加载 ─────────── */
function loadSDK(key) {
  return new Promise((resolve, reject) => {
    if (window.TMap) return resolve();
    const s = document.createElement('script');
    // 用户自备 Key 模式：key 显式传入，libraries=service 提供搜索 / 路线服务
    s.src = 'https://map.qq.com/api/gljs?v=1.exp&libraries=service&key=' + encodeURIComponent(key);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('SDK 加载失败，请检查网络'));
    document.head.appendChild(s);
  });
}

async function bootstrap() {
  const key = getKey();
  if (!key) { showKeyModal(); return; }
  if (state.sdkReady) { renderAll(); return; }
  if (location.protocol === 'file:') {
    showFatal('当前以 file:// 方式打开，地图服务可能受限。建议在项目目录运行 python -m http.server 8080 后访问 http://localhost:8080');
  }
  try {
    await loadSDK(key);
    state.sdkReady = true;
    initMap();
    restoreSpots();
    renderAll();
  } catch (err) {
    alert(err.message);
    showKeyModal();
  }
}

/* ─────────── 地图 ─────────── */
function initMap() {
  state.map = new TMap.Map('map', {
    zoom: 12,
    center: new TMap.LatLng(22.5405, 114.0586), // 默认深圳，可改为你常用的城市
    viewMode: '2D',
  });

  const spotStyles = {};
  for (let i = 0; i < MAX_SPOT_STYLES; i++) {
    spotStyles['spot-' + i] = new TMap.MarkerStyle({
      width: 34, height: 44, anchor: { x: 17, y: 44 }, src: ICON_SPOTS[i],
    });
  }

  state.markerLayer = new TMap.MultiMarker({
    map: state.map,
    styles: { hotel: new TMap.MarkerStyle({ width: 34, height: 44, anchor: { x: 17, y: 44 }, src: ICON_HOTEL }), ...spotStyles },
    geometries: [],
  });

  state.lineLayer = new TMap.MultiPolyline({
    map: state.map,
    styles: {
      dashed: new TMap.PolylineStyle({
        color: '#d95d39', width: 4, dashArray: [10, 8],
        lineCap: 'round',
      }),
    },
    geometries: [],
  });

  state.routeLayer = new TMap.MultiPolyline({
    map: state.map,
    styles: {
      drive: new TMap.PolylineStyle({
        color: '#22415e', width: 6,
        lineCap: 'round', arrow: true,
      }),
      fallback: new TMap.PolylineStyle({
        color: '#8a8172', width: 4, dashArray: [10, 8],
        lineCap: 'round',
      }),
    },
    geometries: [],
  });

  state.markerLayer.on('click', (e) => {
    const id = e.geometry && e.geometry.id;
    if (!id) return;
    if (id === 'hotel') {
      state.activeSpotId = null;
      clearRoute();
      focusMarker(state.hotel.location, 13);
      if (state.infoWindow) state.infoWindow.close();
      renderList();
      return;
    }
    const sid = String(id).slice(5);
    const s = state.spots.find((x) => x.id === sid);
    if (!s) return;
    state.activeSpotId = sid;
    focusMarker(s.location, 15);
    const straight = haversineKm(state.hotel.location, s.location);
    let html = `<b>${esc(s.name)}</b><span>距酒店 直线 ${straight.toFixed(1)} km`;
    if (s.drive) html += ` · ${modeLabel()}约 ${Math.max(1, Math.round(s.drive.duration / 60))} 分钟`;
    html += '</span>';
    if (state.infoWindow) {
      state.infoWindow.setPosition(new TMap.LatLng(s.location.lat, s.location.lng));
      state.infoWindow.setContent(`<div class="iw">${html}</div>`);
      state.infoWindow.open();
    }
    renderList();
  });

  // 气泡组件放在最后创建，且失败不影响地图与其他交互
  try {
    state.infoWindow = new TMap.InfoWindow({
      map: state.map,
      position: new TMap.LatLng(22.5405, 114.0586),
      offset: { x: 0, y: -46 },
      content: '',
      enableCustom: true,
    });
  } catch (err) {
    console.warn('InfoWindow 初始化失败', err);
    state.infoWindow = null;
  }

  state.map.on('click', () => state.infoWindow && state.infoWindow.close());
}

function focusMarker(loc, zoom) {
  if (!state.map) return;
  state.map.setZoom(zoom);
  state.map.panTo(new TMap.LatLng(loc.lat, loc.lng));
}

/* ─────────── 搜索联想 ─────────── */
let suggestService = null;
let suggestTimer = null;
const searchCache = new Map();   // 关键词 -> 结果数组，避免重复请求

// 最近使用的地点（点选输入框即出，免打字）
const HISTORY_KEY = 'trip-overview.history';
const HISTORY_MAX = 8;

function getHistory() {
  try { return JSON.parse(store.get(HISTORY_KEY) || '[]') || []; } catch (_) { return []; }
}

function pushHistory(place) {
  try {
    const list = getHistory().filter((p) => !(p.name === place.name && p.address === place.address));
    list.unshift({ name: place.name, address: place.address, location: place.location });
    store.set(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch (_) { /* 忽略 */ }
}

/* 下拉项点选手势：位移小于阈值才算点选，否则视为滚动 */
function bindTapSelect(el, onPick) {
  let startY = null;
  el.addEventListener('pointerdown', (ev) => { startY = ev.clientY; });
  el.addEventListener('pointercancel', () => { startY = null; });
  el.addEventListener('pointerup', (ev) => {
    if (startY === null) return;
    const moved = Math.abs(ev.clientY - startY);
    startY = null;
    if (moved < 8) onPick(ev);
  });
}

function renderHistory(listEl, items, onPick, inputEl) {
  listEl.innerHTML = '<div class="suggest-item suggest-title"><small>最近使用</small></div>' +
    items.map((p, i) =>
      `<div class="suggest-item" data-i="${i}"><b>${esc(p.name)}</b><small>${esc(p.address || '')}</small></div>`
    ).join('');
  listEl.hidden = false;
  listEl.querySelectorAll('.suggest-item[data-i]').forEach((el) => {
    bindTapSelect(el, () => {
      const p = items[Number(el.dataset.i)];
      if (!p) return;
      listEl.hidden = true;
      inputEl.value = '';
      onPick(p);
    });
  });
}

function bindSuggest(inputEl, boxEl, listEl, onPick) {
  const showHistory = () => {
    const h = getHistory();
    if (h.length) renderHistory(listEl, h, onPick, inputEl);
  };

  inputEl.addEventListener('focus', () => { if (!inputEl.value.trim()) showHistory(); });

  inputEl.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const kw = inputEl.value.trim();
    if (kw.length < 2) { listEl.hidden = true; listEl.innerHTML = ''; return; }
    // 命中缓存立即渲染，不发请求
    if (searchCache.has(kw)) { renderItems(searchCache.get(kw)); return; }
    suggestTimer = setTimeout(async () => {
      try {
        listEl.innerHTML = '<div class="suggest-item"><small>搜索中…</small></div>';
        listEl.hidden = false;
        if (!suggestService) suggestService = new TMap.service.Suggestion({ pageSize: 8, region: '', regionFix: false });
        const params = { keyword: kw };
        if (state.hotel) {
          params.location = new TMap.LatLng(state.hotel.location.lat, state.hotel.location.lng);
        }
        const res = await suggestService.getSuggestions(params);
        const items = ((res && res.data) || []).map((it) => ({
          name: it.title, address: it.address || '', location: { lat: it.location.lat, lng: it.location.lng },
        }));
        searchCache.set(kw, items);
        renderItems(items);
      } catch (err) {
        console.warn('联想失败', err);
        listEl.innerHTML = `<div class="suggest-item"><small>搜索失败：${esc(err && err.message || err)}<br>请确认 Key 已启用 WebServiceAPI</small></div>`;
        listEl.hidden = false;
      }
    }, 400);
  });

  function renderItems(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="suggest-item"><small>没有找到相关地点</small></div>';
      listEl.hidden = false;
      return;
    }
    listEl.innerHTML = items.slice(0, 8).map((it, i) =>
      `<div class="suggest-item" data-i="${i}"><b>${esc(it.name)}</b><small>${esc(it.address || '')}</small></div>`
    ).join('');
    listEl.hidden = false;
    listEl.querySelectorAll('.suggest-item[data-i]').forEach((el) => {
      bindTapSelect(el, () => {
        const it = items[Number(el.dataset.i)];
        if (!it) return;
        listEl.hidden = true;
        inputEl.value = '';
        pushHistory(it);
        onPick(it);
      });
    });
  }

  inputEl.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 200));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ─────────── 数据操作 ─────────── */
function setHotel(h) {
  state.hotel = h;
  state.spots.forEach((s) => (s.drive = null)); // 酒店变了，旧路线作废
  persist();
  renderAll();
}

function addSpot(s) {
  if (!state.hotel) { alert('请先在上方选择入住酒店'); return; }
  if (state.spots.length >= 20) { alert('最多添加 20 个目的地'); return; }
  state.spots.push({ id: 'spot-' + Date.now() + '-' + Math.floor(Math.random() * 1e4), drive: null, ...s });
  persist();
  renderAll();
}

function removeSpot(id) {
  state.spots = state.spots.filter((s) => s.id !== id);
  if (state.activeSpotId === id) { state.activeSpotId = null; clearRoute(); }
  persist();
  renderAll();
}

function persist() {
  try {
    store.set(SPOTS_STORAGE, JSON.stringify({ hotel: state.hotel, spots: state.spots }));
  } catch (_) { /* 忽略 */ }
}

function restoreSpots() {
  try {
    const raw = JSON.parse(store.get(SPOTS_STORAGE) || 'null');
    if (raw && raw.hotel && Array.isArray(raw.spots)) {
      state.hotel = raw.hotel;
      state.spots = raw.spots.map((s) => ({ ...s, drive: null }));
    }
  } catch (_) { /* 忽略 */ }
}

/* ─────────── 距离 ─────────── */
function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const services = {};

function getFirstRoute(res) {
  const routes = (res && res.result && res.result.routes) || (res && res.routes) || [];
  if (!routes[0]) throw new Error('未找到路线');
  return routes[0];
}

// WebService 返回的路线坐标经过前向差分压缩，需解压
function decompressPolyline(coords) {
  if (!coords || typeof coords[0] !== 'number') return coords || null; // 已是坐标对象/点对
  const kr = 1000000;
  for (let i = 2; i < coords.length; i++) coords[i] = coords[i - 2] + coords[i] / kr;
  const out = [];
  for (let i = 0; i < coords.length; i += 2) out.push({ lat: coords[i], lng: coords[i + 1] });
  return out;
}

/* 按指定出行方式请求两点间真实路线：
   transit（地铁+步行）/ walk（步行）/ drive（驾车）
   返回 { distance(米), duration(秒), paths: [每段一条折线] } */
async function fetchLeg(mode, from, to) {
  const f = new TMap.LatLng(from.lat, from.lng);
  const t = new TMap.LatLng(to.lat, to.lng);

  if (mode === 'transit') {
    if (!services.transit) services.transit = new TMap.service.Transit();
    const res = await services.transit.search({ from: f, to: t });
    const routes = (res && res.result && res.result.routes) || (res && res.routes) || [];
    if (!routes.length) throw new Error('未找到公交方案');
    // 地铁优先：返回的多个方案里优先挑含地铁线路的
    const hasSubway = (r) => (r.steps || []).some((s) =>
      s.mode === 'TRANSIT' && Array.isArray(s.lines) && s.lines[0] &&
      (String(s.lines[0].vehicle || '').toUpperCase().includes('SUBWAY') || /地铁|轨道/.test(String(s.lines[0].title || '')))
    );
    const route = routes.find(hasSubway) || routes[0];
    const polys = [];
    (route.steps || []).forEach((step) => {
      if (step.mode === 'TRANSIT' && Array.isArray(step.lines) && step.lines[0]) {
        const p = decompressPolyline(step.lines[0].polyline); // 公交/地铁段取所选线路的折线
        if (p && p.length > 1) polys.push(p);
      } else if (step.polyline) {
        const p = decompressPolyline(step.polyline); // 步行段
        if (p && p.length > 1) polys.push(p);
      }
    });
    return { distance: route.distance || 0, duration: (route.duration || 0) * 60, paths: polys }; // duration 官方单位为分钟
  }

  if (mode === 'walk') {
    if (!services.walk) services.walk = new TMap.service.Walking();
    const res = await services.walk.search({ from: f, to: t });
    const r = getFirstRoute(res);
    return { distance: r.distance || 0, duration: (r.duration || 0) * 60, paths: [decompressPolyline(r.polyline)].filter(Boolean) };
  }

  if (!services.drive) services.drive = new TMap.service.Driving({ policy: 'LEAST_TIME' });
  const res = await services.drive.search({ from: f, to: t });
  const r = getFirstRoute(res);
  return { distance: r.distance || 0, duration: (r.duration || 0) * 60, paths: [decompressPolyline(r.polyline)].filter(Boolean) };
}

function modeLabel() {
  return { transit: '公交地铁', walk: '步行', drive: '驾车' }[state.travelMode] || '';
}

function drawPaths(paths) {
  if (!state.map || !paths) return;
  paths.forEach((p, i) => {
    const ll = p.map((pt) => (pt instanceof TMap.LatLng ? pt : new TMap.LatLng(pt.lat, pt.lng)));
    if (ll.length > 1) {
      state.routeLayer.add({ id: 'leg-' + Date.now() + '-' + i + '-' + Math.floor(Math.random() * 1e4), styleId: 'drive', paths: ll });
    }
  });
}

function drawStraight(a, b) {
  if (!state.map) return;
  state.routeLayer.add({
    id: 'straight-' + Date.now(),
    styleId: 'fallback',
    paths: [new TMap.LatLng(a.lat, a.lng), new TMap.LatLng(b.lat, b.lng)],
  });
}

/* 整条闭环（酒店→各目的地→酒店）逐段请求真实路线并绘制 */
async function drawFullRoute() {
  clearRoute();
  if (!state.hotel || state.spots.length < 1) return { totalKm: 0, totalMin: 0, ok: true };
  const seq = [state.hotel.location, ...state.spots.map((s) => s.location), state.hotel.location];
  let totalM = 0, totalS = 0, ok = true;
  for (let i = 0; i < seq.length - 1; i++) {
    let done = false;
    // 降级链：所选模式 → 步行 → 直线估算
    for (const mode of [state.travelMode, 'walk']) {
      try {
        const leg = await fetchLeg(mode, seq[i], seq[i + 1]);
        totalM += leg.distance;
        totalS += leg.duration;
        if (leg.paths && leg.paths.length) drawPaths(leg.paths);
        else throw new Error('empty');
        done = true;
        break;
      } catch (err) {
        /* 尝试下一级 */
      }
    }
    if (!done) {
      console.warn('路段无法规划，按直线估算', seq[i], '→', seq[i + 1]);
      ok = false;
      drawStraight(seq[i], seq[i + 1]);
      const d = haversineKm(seq[i], seq[i + 1]);
      totalM += d * 1000;
      totalS += (d / 4.8) * 3600; // 按 4.8km/h 步行估算
    }
  }
  return { totalKm: totalM / 1000, totalMin: Math.round(totalS / 60), ok };
}

/* ─────────── 渲染 ─────────── */
function renderAll() {
  renderHotel();
  renderList();
  renderMarkers();
  renderStats();
  $('mapEmpty').hidden = !!(state.hotel && state.map);
  $('mapEmpty').style.display = (state.hotel && state.map) ? 'none' : '';
  const hasAny = !!(state.hotel || state.spots.length);
  $('fitBtn').hidden = !hasAny;
  $('sortBtn').hidden = !(state.hotel && state.spots.length >= 2);
  $('modeTabs').hidden = !(state.hotel && state.spots.length >= 1);
}

function renderHotel() {
  const box = $('hotelPicked');
  if (!state.hotel) { box.hidden = true; return; }
  box.hidden = false;
  $('hotelPickedName').textContent = state.hotel.name;
  $('hotelPickedAddr').textContent = state.hotel.address || '';
}

function renderList() {
  const ul = $('spotList');
  $('emptyHint').style.display = state.spots.length ? 'none' : '';
  ul.innerHTML = state.spots.map((s, i) => {
    const straight = state.hotel ? haversineKm(state.hotel.location, s.location) : null;
    let distHtml;
    if (s.drive) {
      distHtml = `<span class="spot-dist">🚗 ${(s.drive.distance / 1000).toFixed(1)} km · ${Math.round(s.drive.duration / 60)} 分钟</span>`;
    } else if (straight != null) {
      distHtml = `<span class="spot-dist">直线 ${straight.toFixed(1)} km</span>`;
    } else {
      distHtml = '';
    }
    return `<li class="spot-row ${state.activeSpotId === s.id ? 'active' : ''}" data-id="${s.id}">
      <span class="spot-idx">${i + 1}</span>
      <div class="spot-main"><b>${esc(s.name)}</b><small>${esc(s.address || '')}</small></div>
      ${distHtml}
      <div class="spot-acts">
        <button class="row-x act-route" title="查看驾车路线">🚗</button>
        <button class="row-x act-del" title="删除">✕</button>
      </div>
    </li>`;
  }).join('');

  ul.querySelectorAll('.spot-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.act-del').addEventListener('click', () => removeSpot(id));
    row.querySelector('.act-route').addEventListener('click', () => toggleRoute(id));
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const s = state.spots.find((x) => x.id === id);
      if (s && state.map) state.map.panTo(new TMap.LatLng(s.location.lat, s.location.lng));
      state.activeSpotId = id;
      renderList();
    });
  });
}

function renderMarkers() {
  if (!state.map) return;
  const geoms = [];
  if (state.hotel) {
    geoms.push({ id: 'hotel', styleId: 'hotel', position: new TMap.LatLng(state.hotel.location.lat, state.hotel.location.lng) });
  }
  state.spots.forEach((s, i) => {
    geoms.push({ id: s.id, styleId: 'spot-' + i, position: new TMap.LatLng(s.location.lat, s.location.lng), properties: { index: i + 1 } });
  });
  state.markerLayer.setGeometries(geoms);

  const lines = (state.hotel && state.spots.length)
    ? state.spots.map((s, i) => ({
        id: 'line-' + i,
        styleId: 'dashed',
        paths: [new TMap.LatLng(state.hotel.location.lat, state.hotel.location.lng), new TMap.LatLng(s.location.lat, s.location.lng)],
      }))
    : [];
  state.lineLayer.setGeometries(lines);

  if (state.hotel || state.spots.length) fitBounds();
}

function renderStats() {
  $('statCount').textContent = state.spots.length;
  if (state.hotel && state.spots.length) {
    const straight = state.spots.reduce((sum, s) => sum + haversineKm(state.hotel.location, s.location), 0);
    $('statStraight').textContent = straight.toFixed(1);
    const drives = state.spots.filter((s) => s.drive);
    $('statDrive').textContent = drives.length
      ? (drives.reduce((sum, s) => sum + s.drive.distance, 0) / 1000).toFixed(1)
      : '—';
  } else {
    $('statStraight').textContent = '—';
    $('statDrive').textContent = '—';
  }
}

function fitBounds() {
  const pts = [];
  if (state.hotel) pts.push(state.hotel.location);
  state.spots.forEach((s) => pts.push(s.location));
  if (!pts.length || !state.map) return;
  const latlngs = pts.map((p) => new TMap.LatLng(p.lat, p.lng));
  const bounds = new TMap.LatLngBounds();
  latlngs.forEach((p) => bounds.extend(p));
  state.map.fitBounds(bounds, { padding: 70 });
}

/* ─────────── 驾车路线 ─────────── */
function clearRoute() {
  if (state.routeLayer) state.routeLayer.setGeometries([]);
  if (state.infoWindow) state.infoWindow.close();
}

async function toggleRoute(id) {
  if (!state.hotel || !state.map) return;
  const spot = state.spots.find((s) => s.id === id);
  if (!spot) return;
  if (state.activeSpotId === id && state.routeLayer.getGeometries().length) {
    state.activeSpotId = null;
    clearRoute();
    renderList();
    return;
  }
  state.activeSpotId = id;
  clearRoute();
  renderList();
  showToast('路线计算中…');
  let done = false;
  for (const mode of [state.travelMode, 'walk']) {
    try {
      const leg = await fetchLeg(mode, state.hotel.location, spot.location);
      spot.drive = { distance: leg.distance, duration: leg.duration };
      if (leg.paths && leg.paths.length) { drawPaths(leg.paths); done = true; break; }
    } catch (err) { /* 尝试下一级 */ }
  }
  if (!done) {
    const straight = haversineKm(state.hotel.location, spot.location);
    spot.drive = { distance: straight * 1300, duration: (straight / 4.8) * 3600 };
    drawStraight(state.hotel.location, spot.location);
    showToast('该路段未查到方案，已按直线估算');
  } else {
    showToast(`${modeLabel()} ${(spot.drive.distance / 1000).toFixed(1)} km · 约 ${Math.max(1, Math.round(spot.drive.duration / 60))} 分钟`);
  }
  persist();
  renderList();
  renderStats();
}

/* ─────────── 智能排序：带偏序约束的最短闭环（状压 DP / 贪心降级） ───────────
   点 0 = 酒店（起点），1..n = 目的地。
   pred[j]（可选）：游览 j 前必须先去过哪些点的位掩码（预留接口，默认全 0）。
   n ≤ 12 用状态压缩 DP 求全局最优；n > 12 自动降级为贪心最近邻。 */
function optimizeOrder(hotelLoc, spots) {
  const n = spots.length;
  const order = spots.map((_, i) => i + 1); // 默认原序（1..n）
  if (n < 2) return order;

  const pts = [hotelLoc, ...spots.map((s) => s.location)];
  const m = n + 1;
  const dist = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) => (i === j ? 0 : haversineKm(pts[i], pts[j])))
  );
  const pred = new Array(m).fill(0);

  if (n <= 12) return solveDP(dist, pred, n);
  return solveGreedy(dist, pred, n);
}

function solveDP(dist, pred, n) {
  const m = n + 1, FULL = (1 << m) - 1;
  const INF = Infinity;
  const size = 1 << m;
  const dp = Array.from({ length: size }, () => new Array(m).fill(INF));
  const parent = Array.from({ length: size }, () => new Array(m).fill(-1));
  dp[1][0] = 0;

  for (let mask = 1; mask <= FULL; mask++) {
    for (let i = 0; i < m; i++) {
      if (dp[mask][i] === INF || !(mask & (1 << i))) continue;
      for (let j = 1; j < m; j++) {
        if (mask & (1 << j)) continue;
        if ((pred[j] & ~mask) !== 0) continue; // 前置点未全部去过
        const nm = mask | (1 << j);
        const nd = dp[mask][i] + dist[i][j];
        if (nd < dp[nm][j]) { dp[nm][j] = nd; parent[nm][j] = i; }
      }
    }
  }

  let best = INF, last = -1;
  for (let i = 1; i < m; i++) {
    if (dp[FULL][i] === INF) continue;
    const total = dp[FULL][i] + dist[i][0]; // 闭环：返回酒店
    if (total < best) { best = total; last = i; }
  }

  const seq = [];
  let cur = last, mask = FULL;
  while (cur > 0) {
    seq.push(cur - 1);
    const prev = parent[mask][cur];
    mask ^= (1 << cur);
    cur = prev;
  }
  seq.reverse();
  return seq;
}

function solveGreedy(dist, pred, n) {
  const m = n + 1;
  const visited = new Array(m).fill(false);
  visited[0] = true;
  const seq = [];
  let cur = 0;
  let mask = 1;
  for (let step = 0; step < n; step++) {
    let bestJ = -1, bestD = Infinity;
    for (let j = 1; j < m; j++) {
      if (visited[j] || (pred[j] & ~mask) !== 0) continue;
      if (dist[cur][j] < bestD) { bestD = dist[cur][j]; bestJ = j; }
    }
    if (bestJ < 0) break;
    visited[bestJ] = true;
    mask |= (1 << bestJ);
    seq.push(bestJ - 1);
    cur = bestJ;
  }
  return seq;
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function applySmartSort() {
  if (!state.hotel || state.spots.length < 2) return;
  const btn = $('sortBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 计算最优顺序…';
  const order = optimizeOrder(state.hotel.location, state.spots);
  state.spots = order.map((i) => state.spots[i]);
  state.activeSpotId = null;
  persist();
  renderAll();
  const { totalKm, totalMin, ok } = await drawFullRoute();
  renderStats();
  btn.disabled = false;
  btn.textContent = '🧭 智能排序 · 最短路线闭环';
  showToast(`闭环全程约 ${totalKm.toFixed(1)} km · ${modeLabel()}约 ${Math.max(1, totalMin)} 分钟${ok ? '' : '（部分路段为估算）'}`);
}

/* ─────────── 事件绑定 ─────────── */
bindSuggest($('hotelInput'), $('hotelBox'), $('hotelSuggest'), setHotel);
bindSuggest($('spotInput'), $('spotBox'), $('spotSuggest'), addSpot);

$('hotelClear').addEventListener('click', () => {
  state.hotel = null;
  state.spots.forEach((s) => (s.drive = null));
  state.activeSpotId = null;
  clearRoute();
  persist();
  renderAll();
});

$('fitBtn').addEventListener('click', fitBounds);

$('sortBtn').addEventListener('click', applySmartSort);

$('modeTabs').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    state.travelMode = b.dataset.mode;
    $('modeTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    clearRoute();
    state.spots.forEach((s) => (s.drive = null));
    persist();
    renderList();
    renderStats();
  });
});

$('sheetToggle').addEventListener('click', () => {
  $('panel').classList.toggle('collapsed');
  $('sheetToggle').textContent = $('panel').classList.contains('collapsed') ? '▼ 行程单' : '▲ 收起';
});

/* ─────────── 启动 ─────────── */
bootstrap();
