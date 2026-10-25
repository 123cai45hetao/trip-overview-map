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
  labelLayer: null,   // 路线分段编号图层
  routeGeoms: [],     // 最近一次画出的路线几何（供开关重绘）
  showRoute: true,    // 是否在地图上显示路线
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

// 每段路线一种颜色，便于区分
const ROUTE_COLORS = ['#22415e', '#d95d39', '#3e7a4e', '#7b4b94', '#b8860b', '#1f7a8c', '#8a3b5c', '#4a6d3f'];

// 路线分段编号小圆点（颜色与该段路线一致，标在路段中点）
const circleUrl = (n, bg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10.5" fill="${bg}" stroke="#fffdf8" stroke-width="2"/>
    <text x="12" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#fffdf8">${n}</text>
  </svg>`
);
const MAX_LEG_STYLES = 50;
const ICON_LEGS = Array.from({ length: MAX_LEG_STYLES }, (_, i) => circleUrl(i + 1, ROUTE_COLORS[i % ROUTE_COLORS.length]));

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
    styles: (() => {
      const styles = {
        fallback: new TMap.PolylineStyle({ color: '#8a8172', width: 4, dashArray: [10, 8], lineCap: 'round' }),
      };
      ROUTE_COLORS.forEach((c, i) => {
        styles['c' + i] = new TMap.PolylineStyle({ color: c, width: 6, lineCap: 'round', arrow: true });
        styles['cd' + i] = new TMap.PolylineStyle({ color: c, width: 4, dashArray: [8, 8], lineCap: 'round' });
      });
      return styles;
    })(),
    geometries: [],
  });

  const legStyles = {};
  for (let i = 0; i < MAX_LEG_STYLES; i++) {
    legStyles['leg-' + i] = new TMap.MarkerStyle({ width: 24, height: 24, anchor: { x: 12, y: 12 }, src: ICON_LEGS[i] });
  }
  state.labelLayer = new TMap.MultiMarker({ map: state.map, styles: legStyles, geometries: [] });

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

/* 深度递归提取返回结果中的所有折线字段：
   不管藏在 steps / lines / walks 哪一层，字段名是 polyline / coors / coordinates 都能挖到。
   数字串=压缩坐标自动解压；对象数组=已解压坐标直接用。 */
function collectPolylines(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    if (node.length > 1 && typeof node[0] === 'number') {
      const p = decompressPolyline(node);
      if (p && p.length > 1) out.push({ path: p, dashed: false });
      return; // 坐标串不再往下递归
    }
    node.forEach((n) => collectPolylines(n, out));
    return;
  }
  const walking = String(node.mode || '') === 'WALKING';
  Object.keys(node).forEach((k) => {
    if (k === 'polyline' || k === 'coors' || k === 'coordinates' || k === 'polylines') {
      const p = decompressPolyline(node[k]);
      if (p && p.length > 1) out.push({ path: p, dashed: walking });
    } else {
      collectPolylines(node[k], out);
    }
  });
}

/* 按指定出行方式请求两点间真实路线：
   transit（地铁+步行）/ walk（步行）/ drive（驾车）
   返回 { distance(米), duration(秒), paths: [每段一条折线], summary: [描述] } */
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
    collectPolylines(route, polys); // 深度提取所有步行+公交折线
    const summary = [];
    (route.steps || []).forEach((step) => {
      if (step.mode === 'TRANSIT' && Array.isArray(step.lines) && step.lines[0]) {
        const p = decompressPolyline(step.lines[0].polyline); // 公交/地铁段取所选线路的折线
        if (p && p.length > 1) polys.push({ path: p, dashed: false });
        const l = step.lines[0];
        const name = l.title || l.name || '公交';
        const on = l.geton && l.geton.title, off = l.getoff && l.getoff.title;
        summary.push(`${name}${on ? `（${on} → ${off || '?'}）` : ''}`);
      } else if (step.polyline) {
        const p = decompressPolyline(step.polyline); // 步行段
        if (p && p.length > 1) polys.push({ path: p, dashed: true });
        summary.push(`步行${Math.round(step.distance || 0)}米`);
      }
    });
    return { distance: route.distance || 0, duration: (route.duration || 0) * 60, paths: polys, summary }; // duration 官方单位为分钟
  }

  if (mode === 'walk') {
    if (!services.walk) services.walk = new TMap.service.Walking();
    const res = await services.walk.search({ from: f, to: t });
    const r = getFirstRoute(res);
    const p = decompressPolyline(r.polyline);
    return { distance: r.distance || 0, duration: (r.duration || 0) * 60, paths: p ? [{ path: p, dashed: false }] : [], summary: [`步行全程${((r.distance || 0) / 1000).toFixed(1)}公里`] };
  }

  if (!services.drive) services.drive = new TMap.service.Driving({ policy: 'LEAST_TIME' });
  const res = await services.drive.search({ from: f, to: t });
  const r = getFirstRoute(res);
  const p = decompressPolyline(r.polyline);
  return { distance: r.distance || 0, duration: (r.duration || 0) * 60, paths: p ? [{ path: p, dashed: false }] : [], summary: [`驾车全程${((r.distance || 0) / 1000).toFixed(1)}公里`] };
}

function modeLabel() {
  return { transit: '公交地铁', walk: '步行', drive: '驾车' }[state.travelMode] || '';
}

function drawPaths(paths, colorIdx = 0, seq = null) {
  if (!state.map || !paths) return;
  const ci = colorIdx % ROUTE_COLORS.length;
  let longest = null; // 用于放编号标记：取最长一段折线的中点
  paths.forEach((seg, i) => {
    const p = seg && seg.path ? seg.path : seg; // 兼容 {path,dashed} 与裸折线两种格式
    const dashed = !!(seg && seg.dashed);
    const ll = p.map((pt) => (pt instanceof TMap.LatLng ? pt : new TMap.LatLng(pt.lat, pt.lng)));
    if (ll.length > 1) {
      state.routeGeoms.push({ type: 'path', styleId: (dashed ? 'cd' : 'c') + ci, paths: ll });
      if (!dashed && (!longest || ll.length > longest.length)) longest = ll;
    }
  });
  if (seq != null && longest) {
    const mid = longest[Math.floor(longest.length / 2)];
    state.routeGeoms.push({ type: 'label', seq, lat: mid.lat, lng: mid.lng });
  }
  renderRouteGeoms();
}

function drawStraight(a, b, seq = null) {
  if (!state.map) return;
  state.routeGeoms.push({
    type: 'path', styleId: 'fallback',
    paths: [new TMap.LatLng(a.lat, a.lng), new TMap.LatLng(b.lat, b.lng)],
  });
  if (seq != null) {
    state.routeGeoms.push({ type: 'label', seq, lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  }
  renderRouteGeoms();
}

/* 折线抽稀：点数过多时按跨度等距采样（保留首尾点），
   大幅降低移动端 webview 的渲染/内存压力，视觉上几乎无差别 */
function thinPath(ll, max = 200) {
  if (ll.length <= max) return ll;
  const out = [];
  const step = (ll.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(ll[Math.round(i * step)]);
  return out;
}

/* 按开关状态重绘路线与编号（关闭开关只隐藏，不清空记录） */
function renderRouteGeoms() {
  if (!state.routeLayer) return;
  try {
    state.routeLayer.setGeometries([]);
    if (state.labelLayer) state.labelLayer.setGeometries([]);
    if (!state.showRoute) return;
    const polys = [], labels = [];
    state.routeGeoms.forEach((g, i) => {
      if (g.type === 'path') {
        polys.push({ id: 'rg-' + i, styleId: g.styleId, paths: thinPath(g.paths) });
      } else if (g.type === 'label' && g.seq <= MAX_LEG_STYLES) {
        labels.push({ id: 'lg-' + i, styleId: 'leg-' + (g.seq - 1), position: new TMap.LatLng(g.lat, g.lng) });
      }
    });
    state.routeLayer.add(polys);
    if (state.labelLayer && labels.length) state.labelLayer.add(labels);
  } catch (err) {
    console.warn('路线渲染异常，已跳过本轮', err); // 渲染失败不能拖垮整个页面
  }
}

/* ── 移动端地图看门狗：容器塌陷/渲染丢失时自动恢复 ── */
function checkMapHealth() {
  if (!state.map) return;
  const wrap = document.querySelector('.map-wrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  if (rect.height < 40 && window.innerHeight > 200) {
    wrap.style.height = ''; // 清掉可能的内联高度塌陷，交回样式表
    notifyMapResize();
  }
  // 页面在视口内但地图容器可见时，周期性让地图重算（iOS 工具栏伸缩导致 dvh 漂移）
  if (rect.height > 60 && rect.top < window.innerHeight && !document.hidden) notifyMapResize();
}
setInterval(checkMapHealth, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { notifyMapResize(); checkMapHealth(); } });
window.addEventListener('orientationchange', () => setTimeout(() => { notifyMapResize(); checkMapHealth(); }, 420));

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
  $('departRow').hidden = !(state.hotel && state.spots.length >= 2);
  $('routeToggleWrap').hidden = !(state.hotel && state.spots.length >= 2);
  $('sortNote').hidden = !(state.hotel && state.spots.length >= 2);
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
    const winTxt = s.fixed ? ` · 📌${fmtMin(s.fixed.arrive)}-${fmtMin(s.fixed.leave)}` : '';
    let distHtml;
    if (s.drive) {
      distHtml = `🚗 ${(s.drive.distance / 1000).toFixed(1)} km · ${Math.round(s.drive.duration / 60)} 分钟${winTxt}`;
    } else if (straight != null) {
      distHtml = `直线 ${straight.toFixed(1)} km${winTxt}`;
    } else {
      distHtml = winTxt ? winTxt.replace(' · ', '') : '';
    }
    return `<li class="spot-row ${state.activeSpotId === s.id ? 'active' : ''}" data-id="${s.id}">
      <span class="spot-idx">${i + 1}</span>
      <div class="spot-main"><b>${esc(s.name)}</b><small>${esc(s.address || '')}</small>${distHtml ? `<span class="spot-dist">${distHtml}</span>` : ''}</div>
      <div class="spot-acts">
        <button class="row-x act-time" title="设置可游玩时间段">⏰</button>
        <button class="row-x act-route" title="查看路线">🧭</button>
        <button class="row-x act-del" title="删除">✕</button>
      </div>
    </li>`;
  }).join('');

  ul.querySelectorAll('.spot-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.act-del').addEventListener('click', () => removeSpot(id));
    row.querySelector('.act-route').addEventListener('click', () => toggleRoute(id));
    row.querySelector('.act-time').addEventListener('click', () => editTimeWindow(id));
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
  state.routeGeoms = [];
  if (state.routeLayer) state.routeLayer.setGeometries([]);
  if (state.labelLayer) state.labelLayer.setGeometries([]);
  if (state.infoWindow) state.infoWindow.close();
  const box = $('routeDetail');
  if (box) { box.hidden = true; box.innerHTML = ''; }
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
  for (const mode of [state.travelMode, 'walk', 'drive']) {
    const leg = await fetchLegCached(mode, state.hotel.location, spot.location);
    if (leg && leg.paths && leg.paths.length) {
      spot.drive = { distance: leg.distance, duration: leg.duration };
      drawPaths(leg.paths, 0);
      done = true;
      break;
    }
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

/* ─────────── 智能排序：以真实交通耗时为权重 ───────────
   1) 先两两获取酒店+景点之间的真实公交/地铁路线耗时，填入时间矩阵
   2) 用状压 DP 求耗时最短的游览顺序（开放路径：酒店出发走完所有景点）
   查不到公交方案的点对自动降级：步行耗时 → 直线估算 */
const legCache = new Map();
const legKey = (mode, a, b) =>
  mode + '|' + a.lat.toFixed(5) + ',' + a.lng.toFixed(5) + '|' + b.lat.toFixed(5) + ',' + b.lng.toFixed(5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReqAt = 0;

async function fetchLegCached(mode, a, b, retries = 2) {
  const k = legKey(mode, a, b);
  if (legCache.has(k)) return legCache.get(k);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // QPS 节流：距上次请求不足 300ms 就等待，避免触发限流
      const wait = lastReqAt + 300 - Date.now();
      if (wait > 0) await sleep(wait);
      lastReqAt = Date.now();
      const v = await fetchLeg(mode, a, b);
      if (v) { legCache.set(k, v); return v; } // 只缓存成功结果
    } catch (err) { /* 退避重试 */ }
    if (attempt < retries) await sleep(500 * (attempt + 1));
  }
  return null;
}

function getCachedLeg(mode, a, b) {
  return legCache.get(legKey(mode, a, b)) || legCache.get(legKey(mode, b, a)) || null;
}

async function applySmartSort() {
  if (!state.hotel || state.spots.length < 2) return;
  const btn = $('sortBtn');
  btn.disabled = true;
  try {
    await runSmartSort(btn);
  } catch (err) {
    console.warn('排序异常', err);
    showToast('排序出错，请重试');
  } finally {
    btn.disabled = false;
  }
}

async function runSmartSort(btn) {

  const pts = [state.hotel.location, ...state.spots.map((s) => s.location)];
  const m = pts.length;
  const pairs = (m * (m - 1)) / 2;
  const dur = Array.from({ length: m }, () => new Array(m).fill(null));

  // 1) 预取所有点对的真实交通耗时
  let done = 0, estimated = false;
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      let d = null;
      try {
        const leg = await fetchLegCached(state.travelMode, pts[i], pts[j]);
        if (leg) d = leg.duration;
      } catch (_) { /* 忽略 */ }
      if (d == null) {
        try {
          const w = await fetchLegCached('walk', pts[i], pts[j]);
          if (w) d = w.duration * 1.3; // 公交换乘通常比纯步行慢，加权修正
        } catch (_) { /* 忽略 */ }
      }
      if (d == null) {
        d = (haversineKm(pts[i], pts[j]) / 4.8) * 3600; // 直线按 4.8km/h 估算
        estimated = true;
      }
      dur[i][j] = dur[j][i] = d;
      done++;
      btn.textContent = `⏳ 获取真实交通耗时…（${done}/${pairs}）`;
    }
  }

  // 2) 锚点排程：优先满足锚点时间约束，无解则回退纯耗时最优
  const depart = (() => {
    const v = $('departTime').value || '09:00';
    const p = v.split(':');
    return (+p[0]) * 60 + (+p[1]);
  })();
  const meta = [null, ...state.spots];
  const durM = dur.map((row) => row.map((v) => v / 60));
  let anchorOk = true, times = null;
  let order = (m - 1) <= 12 ? solveAnchors(durM, meta, depart, m - 1, true) : null;
  if (order) {
    times = order.times;
  } else {
    if (state.spots.some((s) => s.fixed)) anchorOk = false; // 锚点约束塞不下，回退纯耗时最优
    const pred = new Array(m).fill(0);
    order = { seq: (m - 1) <= 12 ? solveDP(dur, pred, m - 1, true) : solveGreedy(dur, pred, m - 1) };
  }
  state.spots = order.seq.map((i) => state.spots[i]);
  state.activeSpotId = null;
  persist();
  renderAll();

  // 3) 画真实路线（优先用缓存，降级链：所选模式 → 步行 → 驾车 → 直线）
  clearRoute();
  let totalS = 0, anyStraight = false;
  const seq = [pts[0], ...state.spots.map((s) => s.location), pts[0]]; // 闭环回到酒店
  for (let i = 0; i < seq.length - 1; i++) {
    let used = null;
    for (const mode of [state.travelMode, 'walk', 'drive']) {
      let leg = null;
      try { leg = await fetchLegCached(mode, seq[i], seq[i + 1]); } catch (_) { /* 服务失败按无结果处理 */ }
      if (leg && leg.paths && leg.paths.length) { used = leg; break; }
    }
    if (used) {
      drawPaths(used.paths, i, i + 1);
      totalS += used.duration;
    } else {
      drawStraight(seq[i], seq[i + 1], i + 1);
      totalS += (haversineKm(seq[i], seq[i + 1]) / 4.8) * 3600;
      anyStraight = true;
    }
  }
  renderStats();
  btn.disabled = false;
  btn.textContent = '🧭 智能排序 · 最省时路线';

  // 分段行程单：仅显示交通耗时与到达/离开时刻（不展示地铁/公交细节）
  const box = $('routeDetail');
  const rows = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const fromName = i === 0 ? '🏨 酒店' : `${i}. ${state.spots[i - 1].name}`;
    const toName = i + 1 < seq.length - 1 ? `${i + 1}. ${state.spots[i].name}` : '🏨 酒店';
    let used = null, usedMode = null;
    for (const mode of [state.travelMode, 'walk', 'drive']) {
      const leg = getCachedLeg(mode, seq[i], seq[i + 1]);
      if (leg && leg.paths && leg.paths.length) { used = leg; usedMode = mode; break; }
    }
    let min, sub;
    if (used) {
      min = used.duration;
      sub = usedMode !== state.travelMode ? `（按${usedMode === 'walk' ? '步行' : '驾车'}估算）` : '';
    } else {
      min = (haversineKm(seq[i], seq[i + 1]) / 4.8) * 3600;
      sub = '（直线估算）';
    }
    let arriveTxt;
    if (times && i < times.length) {
      arriveTxt = `预计 ${fmtMin(times[i].arrive)} 到达 · ${fmtMin(times[i].depart)} 离开`;
      if (times[i].wait > 0.5) arriveTxt += ` · 等待 ${Math.round(times[i].wait)} 分钟`;
    } else {
      // 无 times（回退方案）：按交通耗时 + 1 小时游玩累计到达/离开时刻
      let acc = depart;
      for (let k = 0; k < i; k++) acc += dur[k][k + 1] / 60 + STAY_MIN;
      arriveTxt = `预计 ${fmtMin(acc + dur[i][i + 1] / 60)} 到达${i + 1 < seq.length - 1 ? ` · ${fmtMin(acc + dur[i][i + 1] / 60 + STAY_MIN)} 离开` : ''}`;
    }
    rows.push(`<li><b>${fromName} → ${toName}</b><small>约 ${Math.max(1, Math.round(min / 60))} 分钟${sub} · ${arriveTxt}</small></li>`);
  }
  box.innerHTML = `<div class="rd-title">📋 行程方案（${modeLabel()} · 闭环全程约 ${Math.max(1, Math.round(totalS / 60))} 分钟）</div><ol>${rows.join('')}</ol><p class="rd-note">ℹ️ 总耗时相近的方案不止一个，重复排序可能给出不同顺序，均为较优路线。</p>`;
  box.hidden = false;
  showToast(`排序完成：全程约 ${Math.max(1, Math.round(totalS / 60))} 分钟${anchorOk ? '' : ' ⚠ 锚点时间约束无法满足，已按最省时排序'}${anyStraight || estimated ? '（含估算路段）' : ''}`);
}

function solveDP(dist, pred, n, closed = true) {
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
    const total = dp[FULL][i] + (closed ? dist[i][0] : 0); // 闭环才加返回起点的路程
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

function fmtMin(v) {
  return `${String(Math.floor(((v % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(Math.round(v) % 60).padStart(2, '0')}`;
}

/* 宽松解析时间段：接受 13:00-15:00 / 13点-15点 / 13:00 到 15:00 / 13-15 /
   下午1点到3点 / 1:30pm-3pm / １３：００～１５：００ 等写法，返回 [arrive, leave] 分钟 */
function parseTimeRange(raw) {
  let t = String(raw)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角数字
    .replace(/：/g, ':')
    .replace(/．|。/g, '.')
    .replace(/点半|点半钟/g, ':30')
    .replace(/半/g, ':30')
    .replace(/点|時|时/g, ':')
    .replace(/分/g, '')
    .replace(/～|~|—|–|─|―|－|至|到|between|-/gi, '-')
    .replace(/上午|am?(?=\d)/gi, (s) => (s.toLowerCase() === 'am' ? 'AM' : s))
    .replace(/\s+/g, '');
  // 上午/下午/晚上/中午/早上 → 12 小时制换算
  let pmOffset = 0;
  if (/下午|傍晚|晚上|PM/i.test(t)) pmOffset = 720;
  else if (/中午/.test(t)) pmOffset = 0;
  t = t.replace(/早上|上午|中午|下午|傍晚|晚上|AM|PM/gi, '');
  const times = t.split('-').filter(Boolean);
  if (times.length !== 2) return null;
  const parseOne = (str) => {
    let mm = str.match(/^(\d{1,2})(?::(\d{1,2})?)?(?::\d{1,2})?\.?$/); // 13 / 13: / 13:30 / 13:30:00 / 13.30
    if (!mm) return null;
    const h = +mm[1], mi = +(mm[2] || 0);
    if (h > 24 || mi > 59) return null;
    let v = h * 60 + mi + pmOffset;
    // 下午3点=15:00，但"下午12点"仍算 12:00
    if (pmOffset && h < 12) v = h * 60 + mi + 720;
    return ((v % 1440) + 1440) % 1440;
  };
  const arrive = parseOne(times[0]);
  const leave = parseOne(times[1]);
  if (arrive == null || leave == null) return null;
  return [arrive, leave];
}

function editTimeWindow(id) {
  const s = state.spots.find((x) => x.id === id);
  if (!s) return;
  const cur = s.fixed ? `${fmtMin(s.fixed.arrive)}-${fmtMin(s.fixed.leave)}` : '';
  const input = prompt(`「${s.name}」的到达和离开时间\n格式随意，例如：13:00-15:00、13点-15点、13:00 到 15:00（留空清除）\n排序时保证 13:00 到达、15:00 离开`, cur);
  if (input === null) return;
  const t = input.trim();
  if (!t) {
    s.fixed = null;
  } else {
    const parsed = parseTimeRange(t);
    if (!parsed) { alert('没认出来，示例：13:00-15:00 或 13点-15点'); return; }
    const arrive = parsed[0], leave = parsed[1];
    if (parsed[1] <= parsed[0]) { alert('离开时间要晚于到达时间'); return; }
    s.fixed = { arrive, leave };
  }
  persist();
  renderList();
  showToast('时间已保存，请重新点「智能排序」生效');
}

const STAY_MIN = 60; // 未设时间的景点默认游玩时长（分钟）

/* 锚点排程 DP：
   - 设了到达/离开时间的景点是锚点：到达不得晚于约定到达时刻（可早到等待），
     按约定离开时刻离开；约定之间的空隙必须容得下中间景点（交通+1小时游玩）
   - 未设时间的景点：到达后游玩 STAY_MIN 分钟
   - DP 状态 = (已去过的景点集合, 当前所在景点)，值 = 最早离开时刻（可证贪心最优） */
function solveAnchors(durM, meta, depart, n, closed) {
  const m = n + 1, FULL = (1 << m) - 1, INF = Infinity;
  const size = 1 << m;
  const dp = Array.from({ length: size }, () => new Array(m).fill(INF));
  const parent = Array.from({ length: size }, () => new Array(m).fill(-1));
  dp[1][0] = depart;
  for (let mask = 1; mask <= FULL; mask++) {
    for (let i = 0; i < m; i++) {
      if (dp[mask][i] === INF || !(mask & (1 << i))) continue;
      for (let j = 1; j < m; j++) {
        if (mask & (1 << j)) continue;
        const arrive = dp[mask][i] + durM[i][j];
        const fx = meta[j] && meta[j].fixed;
        let departJ;
        if (fx) {
          if (arrive > fx.arrive) continue; // 赶不上约定的到达时间，此路不通
          departJ = fx.leave;
        } else {
          departJ = arrive + STAY_MIN;
        }
        const nm = mask | (1 << j);
        if (departJ < dp[nm][j]) { dp[nm][j] = departJ; parent[nm][j] = i; }
      }
    }
  }
  let best = INF, last = -1;
  for (let i = 1; i < m; i++) {
    if (dp[FULL][i] === INF) continue;
    const end = dp[FULL][i] + (closed ? durM[i][0] : 0);
    if (end < best) { best = end; last = i; }
  }
  if (last < 0) return null; // 无解
  const seq = [];
  let cur = last, mask = FULL;
  while (cur > 0) { seq.push(cur - 1); const p = parent[mask][cur]; mask ^= (1 << cur); cur = p; }
  seq.reverse();

  // 按顺序模拟出每个点的到达/离开时刻
  const times = [];
  let clock = depart;
  let prev = 0;
  seq.forEach((spotIdx) => {
    const pi = prev + 1, ci = spotIdx + 1;
    const raw = clock + durM[pi][ci];
    const fx = meta[ci] && meta[ci].fixed;
    const arrive = fx ? fx.arrive : raw;
    const dep = fx ? fx.leave : arrive + STAY_MIN;
    times.push({ arrive, depart: dep, wait: arrive - raw });
    clock = dep;
    prev = spotIdx;
  });
  return { seq, times };
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

/* ── 手机版底部抽屉：下拉把手收起搜索面板看大地图，上拉展开 ── */
let resizeTimer = null;
function notifyMapResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => window.dispatchEvent(new Event('resize')), 330); // 让地图重算尺寸
}
function setSheet(collapsed) {
  $('panel').classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('sheet-down', collapsed);
  $('sheetGripTxt').textContent = collapsed ? '▲ 上拉展开行程单' : '▼ 下拉收起，看大地图';
  notifyMapResize();
}
$('sheetGrip').addEventListener('click', () => setSheet(!$('panel').classList.contains('collapsed')));
// 把手拖拽：下拉 >40px 收起，上拉 >40px 展开
(() => {
  let startY = null;
  const grip = $('sheetGrip');
  grip.addEventListener('pointerdown', (e) => { startY = e.clientY; e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (dy > 40) { setSheet(true); startY = null; }
    else if (dy < -40) { setSheet(false); startY = null; }
  });
  grip.addEventListener('pointerup', () => { startY = null; });
  grip.addEventListener('pointercancel', () => { startY = null; });
})();

/* 路线显示开关：记住偏好，切换时只隐藏/重绘，不清掉已算好的路线 */
const SHOW_ROUTE_KEY = 'trip-overview.show-route';
state.showRoute = store.get(SHOW_ROUTE_KEY) !== '0';
$('routeToggle').checked = state.showRoute;
$('routeToggle').addEventListener('change', (e) => {
  state.showRoute = e.target.checked;
  store.set(SHOW_ROUTE_KEY, state.showRoute ? '1' : '0');
  renderRouteGeoms();
  showToast(state.showRoute ? '已显示路线' : '已隐藏路线（排序结果保留）');
});

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
