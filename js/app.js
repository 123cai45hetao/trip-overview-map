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
const ICON_SPOT  = svgUrl('<circle cx="17" cy="15" r="7" fill="none" stroke="#fffdf8" stroke-width="2.5"/><circle cx="17" cy="15" r="2.4" fill="#fffdf8"/>', '#22415e');

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

  state.markerLayer = new TMap.MultiMarker({
    map: state.map,
    styles: {
      hotel: new TMap.MarkerStyle({ width: 34, height: 44, anchor: { x: 17, y: 44 }, src: ICON_HOTEL }),
      spot:  new TMap.MarkerStyle({ width: 34, height: 44, anchor: { x: 17, y: 44 }, src: ICON_SPOT }),
    },
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
    },
    geometries: [],
  });

  state.markerLayer.on('click', (e) => {
    const id = e.geometry && e.geometry.id;
    if (id && String(id).startsWith('spot-')) {
      state.activeSpotId = String(id).slice(5);
      renderList();
    }
  });
}

/* ─────────── 搜索联想 ─────────── */
let suggestService = null;
let suggestTimer = null;

function bindSuggest(inputEl, boxEl, listEl, onPick) {
  inputEl.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const kw = inputEl.value.trim();
    if (kw.length < 2) { listEl.hidden = true; listEl.innerHTML = ''; return; }
    suggestTimer = setTimeout(async () => {
      try {
        if (!suggestService) suggestService = new TMap.service.Suggestion({ pagination: false });
        const res = await suggestService.search({ keyword: kw, region: '', regionFix: 0 });
        const items = (res && res.data) || [];
        if (!items.length) { listEl.hidden = true; return; }
        listEl.innerHTML = items.slice(0, 8).map((it, i) =>
          `<div class="suggest-item" data-i="${i}"><b>${esc(it.title)}</b><small>${esc(it.address || '')}</small></div>`
        ).join('');
        listEl.hidden = false;
        listEl.querySelectorAll('.suggest-item').forEach((el) => {
          el.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            const it = items[Number(el.dataset.i)];
            listEl.hidden = true;
            inputEl.value = '';
            onPick({
              name: it.title,
              address: it.address || '',
              location: { lat: it.location.lat, lng: it.location.lng },
            });
          });
        });
      } catch (err) {
        console.warn('联想失败', err);
        listEl.hidden = true;
      }
    }, 250);
  });
  inputEl.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 150));
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

let drivingService = null;
async function fetchDrive(from, to) {
  if (!drivingService) drivingService = new TMap.service.Driving({ policy: 'LEAST_TIME' });
  const res = await drivingService.search({ from: new TMap.LatLng(from.lat, from.lng), to: new TMap.LatLng(to.lat, to.lng) });
  const route = res && res.routes && res.routes[0];
  if (!route) return null;
  return {
    distance: route.distance || 0,   // 米
    duration: route.duration || 0,   // 秒
    path: route.coordinates || route.coors || route.polyline || null,
  };
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
    geoms.push({ id: s.id, styleId: 'spot', position: new TMap.LatLng(s.location.lat, s.location.lng), properties: { index: i + 1 } });
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
}

async function toggleRoute(id) {
  if (!state.hotel || !state.map) return;
  if (state.activeSpotId === id && state.routeLayer.getGeometries().length) {
    state.activeSpotId = null;
    clearRoute();
    renderList();
    return;
  }
  state.activeSpotId = id;
  const spot = state.spots.find((s) => s.id === id);
  if (!spot) return;
  clearRoute();
  renderList();
  try {
    const drive = await fetchDrive(state.hotel.location, spot.location);
    if (!drive) throw new Error('no route');
    spot.drive = { distance: drive.distance, duration: drive.duration };
    persist();
    if (drive.path && drive.path.length > 1) {
      const paths = drive.path.map((p) =>
        p instanceof TMap.LatLng ? p : new TMap.LatLng(p.lat !== undefined ? p.lat : p[0], p.lng !== undefined ? p.lng : p[1])
      );
      state.routeLayer.setGeometries([{ id: 'route-' + id, styleId: 'drive', paths }]);
    }
    renderList();
    renderStats();
  } catch (err) {
    console.warn('路线规划失败', err);
    const straight = haversineKm(state.hotel.location, spot.location);
    spot.drive = { distance: straight * 1000 * 1.3, duration: (straight / 30) * 3600 };
    persist();
    renderList();
    renderStats();
  }
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

$('sheetToggle').addEventListener('click', () => {
  $('panel').classList.toggle('collapsed');
  $('sheetToggle').textContent = $('panel').classList.contains('collapsed') ? '▼ 行程单' : '▲ 收起';
});

/* ─────────── 启动 ─────────── */
bootstrap();
