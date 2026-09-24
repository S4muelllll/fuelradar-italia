const state = {
  fuelType: localStorage.getItem('fuelType') || '1-x',
  fuelName: 'Benzina',
  radius: Number(localStorage.getItem('radius') || 10),
  coords: JSON.parse(localStorage.getItem('coords') || 'null'),
  placeLabel: localStorage.getItem('placeLabel') || '',
  stations: [],
  previousBest: null,
  alerts: JSON.parse(localStorage.getItem('alerts') || '[]'),
  loading: false,
  map: null,
  markers: [],
  userMarker: null,
  refreshTimer: null,
  notifyGranted: false,
  lastQueryKey: null
};

const fuelNames = { '1-x':'Benzina', '2-x':'Diesel', '3-x':'Metano', '4-x':'GPL' };
const api = (path, opts={}) => fetch(path, { headers:{'Content-Type':'application/json'}, ...opts }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Errore'); return data; });
const $ = id => document.getElementById(id);

function formatPrice(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(3).replace('.', ',') + ' €' : '—'; }
function formatPriceShort(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(3).replace('.', ',') : '—'; }
function formatTime(isoOrDate) {
  if (!isoOrDate) return '—';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('it-IT', { hour:'2-digit', minute:'2-digit' }).format(d);
}
function parseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;
  const m = String(value).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}+01:00`);
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function stationFuel(station) {
  return station?.fuels?.find(f => String(f.fuelId) + '-x' === state.fuelType || fuelNamesMatch(f.name));
}
function fuelNamesMatch(name) {
  const n = String(name || '').toLowerCase();
  return (state.fuelType === '1-x' && n.includes('benzina')) ||
    (state.fuelType === '2-x' && (n.includes('diesel') || n.includes('gasolio'))) ||
    (state.fuelType === '3-x' && n.includes('metano')) ||
    (state.fuelType === '4-x' && n.includes('gpl'));
}
function getPrice(station) { const f = stationFuel(station); return f ? Number(f.price) : NaN; }

function initMap() {
  state.map = L.map('map', { zoomControl:true, attributionControl:true }).setView([42.8, 12.6], 5.5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap contributors' }).addTo(state.map);
}
function clearMarkers() {
  state.markers.forEach(m => m.remove());
  state.markers = [];
}
function drawMap() {
  if (!state.map) return;
  clearMarkers();
  if (state.coords) {
    const marker = L.circleMarker([state.coords.lat,state.coords.lng], { radius:8, color:'#66a0ff', fillColor:'#66a0ff', fillOpacity:.9, weight:2 }).addTo(state.map);
    marker.bindTooltip('La tua posizione', {direction:'top'});
    state.userMarker = marker;
  }
  const valid = state.stations.filter(s => Number.isFinite(getPrice(s)) && s.location?.lat != null);
  if (!valid.length) return;
  const best = Math.min(...valid.map(getPrice));
  valid.forEach(s => {
    const price = getPrice(s);
    const isBest = Math.abs(price - best) < 0.0005;
    const marker = L.circleMarker([Number(s.location.lat),Number(s.location.lng)], {
      radius: isBest ? 9 : 7,
      color: isBest ? '#c7ff55' : '#b6c1bc',
      fillColor: isBest ? '#c7ff55' : '#b6c1bc',
      fillOpacity: .95,
      weight: isBest ? 3 : 2
    }).addTo(state.map);
    marker.bindPopup(`<strong>${escapeHtml(s.brand || s.id || 'Distributore')}</strong><br><span class="popup-price">${formatPriceShort(price)} €/L</span><br><span class="popup-muted">${escapeHtml(s.address || '')}</span>`);
    state.markers.push(marker);
  });
  const points = valid.map(s => [Number(s.location.lat),Number(s.location.lng)]);
  if (state.coords) points.push([state.coords.lat,state.coords.lng]);
  state.map.fitBounds(points, {padding:[24,24], maxZoom:14});
}
function setMapFocus() { document.getElementById('map-focus').scrollIntoView({ behavior:'smooth', block:'start' }); }

function setLocation(lat, lng, label) {
  state.coords = { lat:Number(lat), lng:Number(lng) };
  state.placeLabel = label || 'Posizione selezionata';
  localStorage.setItem('coords', JSON.stringify(state.coords));
  localStorage.setItem('placeLabel', state.placeLabel);
  $('locationChip').textContent = state.placeLabel;
  refreshData({announce:true});
}

async function useGeolocation() {
  if (!navigator.geolocation) return toast('La geolocalizzazione non è supportata da questo browser.');
  $('locateBtn').textContent = '◎ Richiesta posizione…';
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const {latitude, longitude} = pos.coords;
      state.coords = {lat:latitude,lng:longitude};
      state.placeLabel = `La mia posizione · ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
      localStorage.setItem('coords', JSON.stringify(state.coords));
      localStorage.setItem('placeLabel', state.placeLabel);
      $('locationChip').textContent = state.placeLabel;
      if (state.map) state.map.setView([latitude,longitude],13);
      await refreshData({announce:true});
    } finally { $('locateBtn').innerHTML = '<span>◎</span> Usa la mia posizione'; }
  }, err => {
    $('locateBtn').innerHTML = '<span>◎</span> Usa la mia posizione';
    toast(err.code === 1 ? 'Permesso posizione negato. Puoi cercare una città.' : 'Non riesco a ottenere la posizione.');
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:120000});
}

async function searchPlace() {
  const q = $('searchInput').value.trim();
  if (q.length < 2) return toast('Scrivi almeno 2 caratteri.');
  const box = $('searchResults'); box.classList.remove('show');
  try {
    $('searchBtn').textContent = '…';
    const results = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`).then(async r => { const d=await r.json(); if(!r.ok) throw new Error(d.error); return d; });
    if (!results.length) return toast('Località non trovata.');
    box.innerHTML = results.map((r,i)=>`<button class="search-result" data-result="${i}"><strong>${escapeHtml(r.label.split(',').slice(0,2).join(', '))}</strong><span>${escapeHtml(r.label)}</span></button>`).join('');
    box.classList.add('show');
    box.querySelectorAll('[data-result]').forEach(btn=>btn.addEventListener('click',()=>{
      const r=results[Number(btn.dataset.result)];
      box.classList.remove('show'); $('searchInput').value = r.label.split(',').slice(0,2).join(', ');
      setLocation(r.lat,r.lng,r.label.split(',').slice(0,3).join(', '));
    }));
  } catch(e) { toast(e.message || 'Ricerca non disponibile.'); }
  finally { $('searchBtn').textContent='Cerca'; }
}

async function refreshData({announce=false}={}) {
  if (!state.coords || state.loading) return;
  state.loading = true;
  updateStatus('Aggiornamento…');
  try {
    const data = await api('/api/zone', {method:'POST',body:JSON.stringify({lat:state.coords.lat,lng:state.coords.lng,radius:state.radius,fuelType:state.fuelType,priceOrder:'asc'})});
    const stations = Array.isArray(data.results) ? data.results : [];
    const previous = state.stations;
    const queryKey = JSON.stringify({lat:Number(state.coords.lat).toFixed(5),lng:Number(state.coords.lng).toFixed(5),radius:state.radius,fuel:state.fuelType});
    state.stations = stations;
    renderData(data);
    if (state.lastQueryKey === queryKey) detectChange(previous, stations);
    state.lastQueryKey = queryKey;
    drawMap();
    if (announce) toast(`Prezzi aggiornati: ${stations.length} distributori trovati.`);
  } catch (e) {
    updateStatus('Dati non disponibili');
    renderError(e.message);
  } finally {
    state.loading = false;
    setTimeout(()=>updateStatus('Live'),1200);
  }
}

function renderData(data) {
  $('listTitle').textContent = `I più convenienti · ${fuelNames[state.fuelType]}`;
  $('heroBestFuel').textContent = fuelNames[state.fuelType];
  const withPrice = state.stations.filter(s=>Number.isFinite(getPrice(s)));
  if (!withPrice.length) { renderError('Nessun prezzo disponibile per questa tipologia nella zona.'); return; }
  withPrice.sort((a,b)=>getPrice(a)-getPrice(b));
  const best = withPrice[0];
  const bestPrice = getPrice(best);
  const avg = withPrice.reduce((sum,s)=>sum+getPrice(s),0)/withPrice.length;
  $('heroBestPrice').textContent = formatPriceShort(bestPrice);
  $('bestPrice').textContent = formatPrice(bestPrice);
  $('bestStation').textContent = `${best.brand || best.name || 'Distributore'} · ${best.distance != null ? Number(best.distance).toFixed(1)+' km' : 'distanza n/d'}`;
  $('avgPrice').textContent = formatPrice(avg);
  $('avgDelta').textContent = `risparmi ${(avg - bestPrice).toFixed(3).replace('.',',')} €/L vs media`; 
  $('stationCount').textContent = withPrice.length;
  const dates = withPrice.map(s=>parseServerDate(stationFuel(s)?.insertDate || s.insertDate)).filter(Boolean).sort((a,b)=>b-a);
  const latest = dates[0];
  $('lastUpdate').textContent = formatTime(latest);
  $('lastUpdateSub').textContent = latest ? `ultimo dato gestore · ${latest.toLocaleDateString('it-IT')}` : (data.meta?.source || 'Fonte live');
  const older = withPrice.filter(s => { const d=parseServerDate(stationFuel(s)?.insertDate || s.insertDate); return d && (Date.now()-d.getTime()>12*3600*1000); }).length;
  $('dataStatus').textContent = older ? `Live · ${older} dati non recentissimi` : 'Live';
  $('stationList').innerHTML = withPrice.map((s,i)=>stationRow(s,i,bestPrice)).join('');
  $('stationList').querySelectorAll('.station-row').forEach((row,i)=>row.addEventListener('click',()=>openStation(withPrice[i])));
}
function stationRow(s,i,bestPrice) {
  const price=getPrice(s), f=stationFuel(s); const isBest=Math.abs(price-bestPrice)<.0005;
  const distance = s.distance != null ? `${Number(s.distance).toFixed(1).replace('.',',')} km` : '—';
  const updated = parseServerDate(f?.insertDate || s.insertDate);
  return `<div class="station-row ${isBest?'best-row':''}">
    <div>
      <div class="station-top"><span class="rank">${i+1}</span><span class="station-name">${escapeHtml(s.brand || s.name || 'Distributore')}</span>${isBest?'<span class="badge" style="color:#c7ff55">BEST</span>':''}</div>
      <div class="station-meta">${escapeHtml(s.address || 'Indirizzo non disponibile')}</div>
      <div class="station-badges"><span class="badge ${f?.isSelf?'self':''}">${f?.isSelf?'Self':'Servito'}</span><span class="badge">dato ${updated?formatTime(updated):'—'}</span></div>
    </div>
    <div class="station-right"><div class="station-price">${formatPriceShort(price)}<span style="font-size:9px;color:#65736b"> €/L</span></div><div class="station-distance">${distance}</div></div>
  </div>`;
}
function renderError(message) {
  $('stationList').innerHTML = `<div class="empty-state"><div class="empty-icon">!</div><h3>Dati live non disponibili</h3><p>${escapeHtml(message || 'Riprovare tra poco.')}</p></div>`;
  $('heroBestPrice').textContent='—'; $('bestPrice').textContent='—'; $('avgPrice').textContent='—'; $('stationCount').textContent='—'; $('lastUpdate').textContent='—';
}

function detectChange(previous, current) {
  if (!previous.length || !current.length) return;
  const oldBest = Math.min(...previous.map(getPrice).filter(Number.isFinite));
  const newBest = Math.min(...current.map(getPrice).filter(Number.isFinite));
  if (!Number.isFinite(oldBest)||!Number.isFinite(newBest)) return;
  const threshold = Math.max(.001, Number($('threshold').value)||.005);
  const diff = newBest-oldBest;
  if (Math.abs(diff) < threshold) return;
  const direction = diff > 0 ? 'up' : 'down';
  const text = diff > 0 ? `Il miglior prezzo è salito di ${diff.toFixed(3)} €/L` : `Il miglior prezzo è sceso di ${Math.abs(diff).toFixed(3)} €/L`;
  addAlert(direction, text, `${formatPriceShort(oldBest)} → ${formatPriceShort(newBest)} €/L`);
  if (state.notifyGranted && document.visibilityState !== 'visible') new Notification('FuelRadar Italia', { body:`${text}. Ora ${formatPriceShort(newBest)} €/L.` });
}
function addAlert(type, title, detail) {
  state.alerts.unshift({type,title,detail,at:new Date().toISOString()}); state.alerts=state.alerts.slice(0,20); localStorage.setItem('alerts',JSON.stringify(state.alerts)); renderAlerts();
}
function renderAlerts() {
  $('alertBadge').textContent = Math.min(state.alerts.length,99);
  $('alertFeed').innerHTML = state.alerts.length ? state.alerts.slice(0,8).map(a=>`<div class="alert-item ${a.type}"><div class="alert-icon">${a.type==='up'?'↑':'↓'}</div><div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.detail)} · ${formatTime(a.at)}</span></div></div>`).join('') : '<div class="feed-empty">Nessun cambiamento rilevato ancora.</div>';
}

function openStation(s) {
  const f=stationFuel(s), price=getPrice(s), d=parseServerDate(f?.insertDate || s.insertDate);
  $('modalContent').innerHTML=`<span class="section-kicker">DETTAGLIO DISTRIBUTORE</span><h2 id="modalTitle" style="margin:6px 0 4px;font-size:25px">${escapeHtml(s.brand || s.name || 'Distributore')}</h2><p style="color:#7f8d86;font-size:11px;margin:0">${escapeHtml(s.address || 'Indirizzo non disponibile')}</p><div class="detail-grid"><div class="detail-cell"><span>${fuelNames[state.fuelType]}</span><strong>${formatPrice(price)}/L</strong></div><div class="detail-cell"><span>Distanza</span><strong>${s.distance!=null?Number(s.distance).toFixed(2).replace('.',',')+' km':'—'}</strong></div><div class="detail-cell"><span>Modalità</span><strong>${f?.isSelf?'Self service':'Servito'}</strong></div><div class="detail-cell"><span>Ultimo invio</span><strong>${d?d.toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'}):'—'}</strong></div></div><button class="search-btn" style="width:100%;border-radius:12px" id="routeBtn">Apri indicazioni</button>`;
  $('routeBtn').onclick=()=>{ if(s.location?.lat!=null){ const u=`https://www.google.com/maps/dir/?api=1&destination=${s.location.lat},${s.location.lng}`; window.open(u,'_blank','noopener'); } };
  $('modal').classList.remove('hidden');
}

function updateStatus(text) { $('dataStatus').textContent=text; }
function toast(message) { const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),3000); }
function requestNotifications() {
  if (!('Notification' in window)) return toast('Le notifiche non sono supportate.');
  Notification.requestPermission().then(p=>{ state.notifyGranted=p==='granted'; toast(p==='granted'?'Notifiche attivate.':'Notifiche non attivate.'); });
}
function startAutoRefresh() {
  clearInterval(state.refreshTimer);
  if ($('autoRefresh').checked) state.refreshTimer=setInterval(()=>refreshData(),120000);
}

$('fuelTabs').addEventListener('click', e=>{const b=e.target.closest('.fuel-tab');if(!b)return;state.fuelType=b.dataset.fuel;state.fuelName=fuelNames[state.fuelType];localStorage.setItem('fuelType',state.fuelType);document.querySelectorAll('.fuel-tab').forEach(x=>x.classList.toggle('active',x===b));refreshData();});
$('radius').addEventListener('input', e=>{state.radius=Number(e.target.value);$('radiusValue').textContent=`${state.radius} km`;localStorage.setItem('radius',state.radius);});
$('radius').addEventListener('change',()=>refreshData());
$('locateBtn').addEventListener('click',useGeolocation); $('searchBtn').addEventListener('click',searchPlace); $('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchPlace();});
$('refreshBtn').addEventListener('click',()=>refreshData({announce:true})); $('notifyBtn').addEventListener('click',requestNotifications); $('fitMapBtn').addEventListener('click',setMapFocus);
$('autoRefresh').addEventListener('change',startAutoRefresh); $('threshold').addEventListener('change',()=>localStorage.setItem('threshold',$('threshold').value));
$('menuBtn').addEventListener('click',()=>document.body.classList.toggle('sidebar-open'));
document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.body.classList.remove('sidebar-open'); if(btn.dataset.section==='map-focus')setMapFocus(); else if(btn.dataset.section==='alerts')$('alerts').scrollIntoView({behavior:'smooth'}); else window.scrollTo({top:0,behavior:'smooth'});}));
document.querySelectorAll('[data-close-modal]').forEach(x=>x.addEventListener('click',()=> $('modal').classList.add('hidden')));

(function init(){
  state.fuelName=fuelNames[state.fuelType]; $('radius').value=state.radius; $('radiusValue').textContent=`${state.radius} km`; $('locationChip').textContent=state.placeLabel || 'Posizione non impostata'; $('threshold').value=localStorage.getItem('threshold') || '0.005';
  document.querySelectorAll('.fuel-tab').forEach(b=>b.classList.toggle('active',b.dataset.fuel===state.fuelType));
  renderAlerts(); initMap();
  if (state.coords) { state.map.setView([state.coords.lat,state.coords.lng],13); refreshData(); }
  startAutoRefresh();
})();
