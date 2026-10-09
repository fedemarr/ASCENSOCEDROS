const $ = (selector, parent = document) => parent.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ticket: '<path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V7Zm12 0v3m0 3v2m0 2v2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="m10 13 4-4m-5 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 1 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1"/><path d="m21 15-5-5L5 20"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  location: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  logout: '<path d="M9 21H3V3h6m7 14 5-5-5-5m5 5H9"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
const brand = () => `<a class="brand" href="/"><img src="/assets/escudo.png" alt="Escudo de Los Cedros"><span>LOS CEDROS<small>RUGBY CLUB · NIGHT</small></span></a>`;
const dateLabel = (event) => event.date ? new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Buenos_Aires' }).format(new Date(`${event.date}T12:00:00-03:00`)) : 'Fecha a confirmar';
const timeLabel = (time) => time ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Buenos_Aires' }).format(new Date(time)) : '';
const state = { user: null, event: null, view: 'inviters', q: '', filter: 'all', inviter: '', page: 1, inviters: [], guests: [], stats: {}, stream: null, connected: false };
let searchTimer; let listSequence = 0; let refreshSequence = 0; let toastTimer;
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'LosCedros', ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && state.user) { state.user = null; state.stream?.close(); await renderLogin(); }
    throw new Error(data.error || 'No pudimos completar la operación.');
  }
  return data;
}
function toast(message, error = false) {
  const box = $('#toast'); box.textContent = message; box.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => box.className = '', 4500);
}
function modal(html) {
  $('#modal-content').innerHTML = `<button class="modal-close icon-button" aria-label="Cerrar">${icon('close')}</button>${html}`;
  $('.modal-close').onclick = () => $('#modal').close(); $('#modal').showModal();
}
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) $('#modal').close(); });
function errorBox(form, message) { const box = $('.form-error', form); box.textContent = message; box.hidden = false; }
async function submitting(form, action) {
  const button = $('button[type="submit"]', form); const text = button.innerHTML;
  button.disabled = true; button.textContent = 'Guardando…'; $('.form-error', form)?.setAttribute('hidden', '');
  try { await action(); } catch (error) { errorBox(form, error.message); }
  finally { if (button.isConnected) { button.disabled = false; button.innerHTML = text; } }
}
function eventDetails(event) {
  return `<div class="event-details"><span>${icon('calendar')} ${esc(dateLabel(event))}</span><span>${icon('clock')} ${esc(event.time ? `${event.time} H` : 'Horario a confirmar')}</span><span>${icon('location')} ${esc(event.location)}</span></div>`;
}
async function prepareDocumentPhoto(file) {
  // Keep the original 5 MB upload choice, but fit the request below Vercel's body limit.
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 25_000_000) throw new Error('La foto tiene demasiada resolución. Elegí una imagen más pequeña.');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', .82);
    if (photo.length > 3_730_000) throw new Error('Elegí una foto más pequeña del DNI.');
    return photo;
  } finally { bitmap.close(); }
}
function flyer(event, compact = false) {
  const words = event.title.trim().split(/\s+/); const last = words.pop();
  return `<div class="flyer ${compact ? 'compact' : ''}" id="flyer"><div class="flyer-photo"></div><div class="flyer-shade"></div><div class="flyer-top"><span class="eyebrow">EL CLUB. LOS AMIGOS. LA NOCHE.</span><img src="/assets/escudo.png" alt="Los Cedros Rugby Club"></div><div class="flyer-body"><span class="flyer-kicker">NOS VEMOS EN CASA</span><h1>${esc(words.join(' '))}<br><em>${esc(last)}</em><span class="title-dot">.</span></h1><p>${esc(event.subtitle)}</p><div class="flyer-rule"></div>${eventDetails(event)}</div><div class="flyer-bottom"><span>AZUL Y AMARILLO.<br>SIEMPRE.</span><span class="flyer-number">LC<span> / NIGHT</span></span></div></div>`;
}
async function renderLanding() {
  document.title = 'Los Cedros Night · El club. Los amigos. La noche.';
  const event = state.event;
  $('#app').innerHTML = `<div class="public-shell"><header class="public-header">${brand()}<a class="staff-link" href="/login">Acceso del equipo ${icon('arrow')}</a></header><main class="landing"><div class="hero-copy"><span class="eyebrow"><span class="yellow-dot"></span> LOS CEDROS RUGBY CLUB</span><h2>Hay noches que<br>son <em>del club.</em></h2><p>${esc(event.description)}</p><div class="invite-note">${icon('ticket')}<div><strong>Tu invitación empieza con un link.</strong><span>Pedíselo a quien te invita y reservá tu lugar.</span></div></div><div class="hero-footer"><span>01 / UNA NOCHE, NUESTROS COLORES</span><span>BUENOS AIRES · ARGENTINA</span></div></div>${flyer(event)}</main><footer class="public-footer"><span>© Los Cedros Rugby Club</span><span>Una noche para compartir.</span></footer></div>`;
}
async function renderInvitation(slug) {
  const token = new URLSearchParams(location.search).get('token') || '';
  const endpoint = `/api/invitation/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`;
  let invitation;
  try { invitation = await api(endpoint); }
  catch (error) {
    $('#app').innerHTML = `<div class="public-shell"><header class="public-header">${brand()}</header><main class="invalid-link">${icon('ticket')}<h1>No pudimos abrir tu invitación</h1><p>${esc(error.message)}</p><a class="button secondary" href="/">Volver al inicio</a></main></div>`; return;
  }
  state.event = invitation.event;
  $('#app').innerHTML = `<div class="public-shell"><header class="public-header">${brand()}<span class="header-tag">INVITACIÓN PERSONAL</span></header><main class="invitation-layout">${flyer(invitation.event, true)}<section class="registration"><span class="eyebrow">TU LUGAR EN LA NOCHE</span><h2>Nos vemos<br><em>en Los Cedros.</em></h2><div class="inviter-banner">${icon('people')}<div><span>ESTÁS INVITADO POR:</span><strong>${esc(invitation.name.toLocaleUpperCase('es-AR'))}</strong></div></div>${invitation.available ? `<p class="registration-intro">Completá tus datos como figuran en tu DNI. En la entrada te buscamos por nombre o documento.</p><form id="registration-form"><div class="form-row"><label>Nombre<input name="first_name" autocomplete="given-name" required minlength="2" maxlength="80" placeholder="Tu nombre"></label><label>Apellido<input name="last_name" autocomplete="family-name" required minlength="2" maxlength="80" placeholder="Tu apellido"></label></div><label>DNI<input name="dni" inputmode="numeric" pattern="[0-9. ]{7,12}" maxlength="12" required placeholder="Sin puntos ni espacios" autocomplete="off"></label><label class="upload-label">Foto del DNI<span class="upload-box">${icon('photo')}<strong id="upload-name">Elegir foto del documento</strong><span>JPG, PNG o WebP · hasta 5 MB</span><input id="photo-input" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></span></label><p class="privacy-note">${icon('shield')} Tu foto se guarda de forma privada y solo puede verla el equipo autorizado.</p><label class="checkbox-label"><input type="checkbox" name="consent" required><span>Acepto que mis datos y la foto del DNI se utilicen para gestionar mi invitación y verificar mi identidad en el ingreso.</span></label><p class="form-error" role="alert" hidden></p><button type="submit" class="button primary full">Confirmar mi invitación ${icon('arrow')}</button></form>` : `<div class="empty-state">${icon('ticket')}<h3>El cupo está completo</h3><p>Contactá a ${esc(invitation.name)} para consultar disponibilidad.</p></div>`}</section></main><footer class="public-footer"><span>Los Cedros Rugby Club</span><span>Tu DNI es tu acceso.</span></footer></div>`;
  const form = $('#registration-form'); if (!form) return;
  $('#photo-input').onchange = (e) => { $('#upload-name').textContent = e.target.files[0]?.name || 'Elegir foto del documento'; };
  form.onsubmit = (e) => { e.preventDefault(); submitting(form, async () => {
    const fields = new FormData(form); const file = fields.get('photo');
    if (!file.size || file.size > 5_000_000) throw new Error('Elegí una foto del DNI de hasta 5 MB.');
    let photo;
    try { photo = await prepareDocumentPhoto(file); }
    catch (e) { throw new Error(e.message.includes('resolución') || e.message.includes('pequeña') ? e.message : 'No pudimos leer la foto. Elegí una imagen JPG, PNG o WebP válida.'); }
    const result = await api(endpoint, { method: 'POST', body: { first_name: fields.get('first_name'), last_name: fields.get('last_name'), dni: fields.get('dni'), photo, consent: fields.get('consent') === 'on' } });
    $('.registration').innerHTML = `<div class="registration-success"><div class="success-icon">${icon('check')}</div><span class="eyebrow">YA ESTÁS EN LA LISTA</span><h2>¡Adentro,<br><em>${esc(result.first_name)}!</em></h2><p>Tu registro quedó confirmado a nombre de <strong>${esc(result.first_name)} ${esc(result.last_name)}</strong>.</p><div class="success-summary"><span>Te invita</span><strong>${esc(result.inviter_name)}</strong></div><p>El día del evento presentá tu DNI. El equipo de seguridad te buscará en la lista.</p>${eventDetails(invitation.event)}<a href="/" class="button secondary full">Volver al inicio ${icon('arrow')}</a></div>`;
  }); };
}
async function renderLogin() {
  document.title = 'Acceso del equipo · Los Cedros Night';
  $('#app').innerHTML = `<div class="public-shell"><header class="public-header">${brand()}<a class="staff-link" href="/">Volver al inicio ${icon('arrow')}</a></header><main class="login-layout"><div class="login-copy"><span class="eyebrow">EL EQUIPO DETRÁS DE LA NOCHE</span><h1>Todo listo.<br><em>Puertas abiertas.</em></h1><p>Administración y seguridad, conectadas en tiempo real.</p><div class="login-colors"><span></span><span></span><span></span></div></div><section class="login-card"><div class="login-icon">${icon('shield')}</div><span class="eyebrow">ACCESO DEL EQUIPO</span><h2>Bienvenido.</h2><p>Ingresá con tu cuenta de administración o seguridad.</p><form id="login-form"><label>Usuario<input name="username" autocomplete="username" placeholder="Tu usuario" required maxlength="80"></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required maxlength="256"></label><p class="form-error" role="alert" hidden></p><button type="submit" class="button primary full">Iniciar sesión ${icon('arrow')}</button></form><p class="login-help">Acceso exclusivo para el equipo de Los Cedros.</p></section></main></div>`;
  const form = $('#login-form');
  form.onsubmit = (e) => { e.preventDefault(); submitting(form, async () => {
    const fields = new FormData(form); const data = await api('/api/login', { method: 'POST', body: Object.fromEntries(fields) });
    state.user = data.user; state.view = state.user.role === 'admin' ? 'inviters' : 'guests';
    history.replaceState({}, '', state.user.role === 'admin' ? '/admin' : '/seguridad'); await renderDashboard();
  }); };
}
function nav() {
  const admin = state.user.role === 'admin';
  return `<nav class="dashboard-nav" aria-label="Panel"><button data-view="inviters" class="${state.view === 'inviters' ? 'selected' : ''}" ${admin ? '' : 'hidden'}>${icon('ticket')}<span>Invitadores</span></button><button data-view="guests" class="${state.view === 'guests' ? 'selected' : ''}">${icon('people')}<span>${admin ? 'Invitados' : 'Control de ingreso'}</span></button><button data-view="event" class="${state.view === 'event' ? 'selected' : ''}" ${admin ? '' : 'hidden'}>${icon('settings')}<span>Evento y flyer</span></button></nav>`;
}
async function renderDashboard() {
  const admin = state.user.role === 'admin';
  if (!admin) state.view = 'guests';
  document.title = `${admin ? 'Administración' : 'Control de ingreso'} · Los Cedros Night`;
  $('#app').innerHTML = `<div class="dashboard"><aside class="sidebar">${brand()}<div class="sidebar-label">GESTIÓN DEL EVENTO</div><div id="navigation">${nav()}</div><div class="sidebar-bottom"><div class="club-colors"><span></span><span></span><span></span></div><p>Los colores de siempre.<br>Una noche distinta.</p><span class="edition">LOS CEDROS / NIGHT</span></div></aside><div class="dashboard-main"><header class="dashboard-header"><div class="breadcrumbs">Los Cedros Night <span>/</span> <strong>${admin ? 'Administración' : 'Seguridad'}</strong></div><div class="header-actions"><span class="live-status" id="live-status"><i></i><span>Conectando…</span></span><span class="user-badge">${icon('shield')} ${esc(state.user.username)}</span><button id="logout" class="icon-button" title="Cerrar sesión" aria-label="Cerrar sesión">${icon('logout')}</button></div></header><main class="dashboard-content"><div id="page-heading"></div><div id="stats" class="stats-grid"></div><div id="view-content"></div></main><footer class="dashboard-footer"><span>LOS CEDROS RUGBY CLUB</span><span>Control de ingreso por DNI</span></footer></div></div>`;
  $('#logout').onclick = async () => { try { await api('/api/logout', { method: 'POST', body: {} }); state.stream?.close(); state.user = null; location.href = '/login'; } catch (e) { toast(e.message, true); } };
  $('.dashboard').classList.toggle('security', !admin);
  $('#navigation').onclick = async (e) => { const button = e.target.closest('[data-view]'); if (!button) return; state.view = button.dataset.view; state.page = 1; state.inviter = ''; state.q = ''; state.filter = 'all'; $('#navigation').innerHTML = nav(); await renderView(); };
  await refreshDashboard(); await renderView(); connectStream();
}
function renderStats() {
  if (!$('#stats')) return;
  const s = state.stats; const admin = state.user.role === 'admin';
  const entries = [['Registrados', s.registered, 'people', 'Lista del evento'], ['Ingresaron', s.entered, 'check', 'Presencia confirmada'], ['Por ingresar', s.pending, 'clock', 'Invitados habilitados'], [admin ? 'Cupos disponibles' : 'Accesos revocados', admin ? s.available : s.revoked, 'ticket', admin ? 'En links activos' : 'Consultar a administración']];
  $('#stats').innerHTML = entries.map(([label, number, symbol, sub], i) => `<div class="stat-card ${i === 1 ? 'featured' : ''}"><div class="stat-label">${esc(label)}<span>${icon(symbol)}</span></div><strong>${number ?? 0}<small>${i === 1 ? 'EN EL CLUB' : ''}</small></strong><span class="stat-sub">${sub}</span></div>`).join('');
}
async function refreshDashboard() {
  const sequence = ++refreshSequence;
  try {
    const [stats, inv] = await Promise.all([api('/api/stats'), state.user.role === 'admin' ? api('/api/inviters') : Promise.resolve(null)]);
    if (sequence !== refreshSequence || !state.user) return;
    state.stats = stats; if (inv) state.inviters = inv.inviters; renderStats();
    if (state.view === 'inviters' && $('#inviter-list')) renderInviters();
    if (state.view === 'guests' && $('#guest-list')) await loadGuests();
  } catch (e) { toast(e.message, true); }
}
function connectStream() {
  state.stream?.close(); const stream = new EventSource('/api/events'); state.stream = stream;
  const status = (connected) => { state.connected = connected; const badge = $('#live-status'); if (badge) { badge.classList.toggle('offline', !connected); $('span', badge).textContent = connected ? 'En tiempo real' : 'Reconectando…'; } };
  stream.addEventListener('connected', () => { status(true); refreshDashboard(); });
  stream.addEventListener('update', () => {
    refreshDashboard();
    const detail = $('#guest-detail');
    if (detail && $('#modal').open) refreshGuestDetail(detail.dataset.id);
  });
  stream.onerror = () => { status(false); };
}
async function renderView() {
  if (!state.user || !$('#view-content')) return;
  const security = state.user.role === 'security';
  const headings = { inviters: ['INVITACIONES', 'La noche empieza con vos.', 'Creá links, asigná cupos y seguí a cada invitador.'], guests: ['CONTROL DE INGRESO', security ? 'Bienvenidos al club.' : 'Todos en una misma lista.', 'Buscá por nombre, apellido o DNI. Verificá la identidad y registrá el ingreso.'], event: ['IDENTIDAD DEL EVENTO', 'Nuestra noche, nuestros colores.', 'Actualizá los datos de la invitación y descargá el flyer.'] };
  const [label, title, text] = headings[state.view];
  $('#page-heading').innerHTML = `<div class="page-heading"><div><span class="eyebrow">${label}</span><h1>${title}</h1><p>${text}</p></div>${state.view === 'inviters' ? `<button class="button primary" id="new-inviter">${icon('plus')} Nuevo invitador</button>` : state.view === 'guests' ? '<span class="heading-note">IDENTIDAD VERIFICADA. INGRESO REGISTRADO.</span>' : ''}</div>`;
  if (state.view === 'inviters') {
    $('#view-content').innerHTML = `<section class="panel"><div class="panel-header"><div><h2>Invitadores <span class="count-badge" id="inviter-count">${state.inviters.length}</span></h2><p>Un link por persona. Un lugar para cada invitado.</p></div><label class="search-field small">${icon('search')}<input id="inviter-search" placeholder="Buscar invitador" aria-label="Buscar invitador"></label></div><div id="inviter-list"></div></section><div class="info-strip">${icon('shield')}<span>Cada link tiene un token privado. El cupo se controla automáticamente y un mismo DNI se registra una sola vez.</span></div>`;
    $('#new-inviter').onclick = newInviter; $('#inviter-search').oninput = renderInviters; renderInviters();
  } else if (state.view === 'guests') {
    $('#view-content').innerHTML = `<section class="panel guest-panel"><div class="guest-toolbar"><label class="search-field guest-search">${icon('search')}<input id="guest-search" type="search" placeholder="Nombre, apellido o DNI…" value="${esc(state.q)}" aria-label="Buscar invitados por nombre, apellido o DNI" autocomplete="off"></label>${security ? '' : `<select id="inviter-filter" aria-label="Filtrar por invitador"><option value="">Todos los invitadores</option>${state.inviters.map((i) => `<option value="${i.id}" ${state.inviter === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>`}</div><div class="guest-filters"><div class="tabs" role="group" aria-label="Filtrar por estado">${[['all','Todos'],['pending','Por ingresar'],['entered','Ingresaron'],['revoked','Revocados']].map(([key,label]) => `<button data-filter="${key}" class="${state.filter === key ? 'active' : ''}">${label}</button>`).join('')}</div><span id="guest-count" aria-live="polite"></span></div><div id="guest-list"><div class="empty-state">Buscando invitados…</div></div><div id="pagination" class="pagination"></div></section>`;
    $('#guest-search').oninput = (e) => { state.q = e.target.value; state.page = 1; clearTimeout(searchTimer); listSequence++; searchTimer = setTimeout(loadGuests, 180); };
    if ($('#inviter-filter')) $('#inviter-filter').onchange = (e) => { state.inviter = e.target.value; state.page = 1; loadGuests(); };
    $('.tabs').onclick = (e) => { const b = e.target.closest('[data-filter]'); if (!b) return; state.filter = b.dataset.filter; state.page = 1; document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === state.filter)); loadGuests(); };
    await loadGuests();
  } else await renderEventEditor();
}
function invitationLink(i) { return `${location.origin}/invitacion/${i.slug}?token=${i.token}`; }
function renderInviters() {
  const container = $('#inviter-list'); if (!container) return;
  const search = ($('#inviter-search')?.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = state.inviters.filter((i) => i.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(search));
  $('#inviter-count').textContent = state.inviters.length;
  if (!list.length) { container.innerHTML = `<div class="empty-state">${icon('ticket')}<h3>${state.inviters.length ? 'No encontramos ese invitador' : 'La lista empieza con un invitador'}</h3><p>${state.inviters.length ? 'Probá con otro nombre.' : 'Creá el primer link y asignale un cupo para empezar a invitar.'}</p>${state.inviters.length ? '' : '<button class="button secondary" id="empty-create">Crear primer invitador</button>'}</div>`; $('#empty-create')?.addEventListener('click', newInviter); return; }
  container.innerHTML = `<div class="inviter-table-head"><span>INVITADOR</span><span>REGISTRADOS</span><span>INGRESARON</span><span>DISPONIBLES</span><span>LINK Y ACCIONES</span></div>${list.map((i) => `<article class="inviter-row ${i.active ? '' : 'is-revoked'}"><div class="inviter-person"><span class="avatar">${esc(i.name.split(' ').filter(Boolean).slice(0,2).map((n) => n[0]).join(''))}</span><div><button class="person-name" data-inviter-guests="${i.id}">${esc(i.name)}</button><span class="person-meta">${i.active ? 'Link activo' : 'Acceso revocado'} · Cupo ${i.capacity}</span></div></div><div class="inviter-metric"><span>Registrados</span><strong>${i.registered}<small> / ${i.capacity}</small></strong><div class="capacity-track"><i style-placeholder="${Math.round(i.registered / (i.capacity || 1) * 100)}"></i></div></div><div class="inviter-metric"><span>Ingresaron</span><strong class="blue-text">${i.entered}</strong></div><div class="inviter-metric"><span>Disponibles</span><strong>${i.active ? i.available : 0}</strong></div><div class="inviter-actions"><button class="button tiny secondary" data-copy="${i.id}" ${i.active ? '' : 'disabled'}>${icon('copy')} Copiar link</button><button class="icon-button" data-edit="${i.id}" aria-label="Administrar ${esc(i.name)}" title="Administrar invitador">${icon('settings')}</button></div></article>`).join('')}`;
  // CSS is kept external; progress uses semantic meter elements instead of inline styles.
  container.querySelectorAll('.capacity-track').forEach((track) => { const value = track.firstElementChild.getAttribute('style-placeholder'); track.innerHTML = `<meter min="0" max="100" value="${value}" aria-label="Porcentaje de cupo utilizado"></meter>`; });
  container.onclick = async (e) => {
    const copy = e.target.closest('[data-copy]'); const edit = e.target.closest('[data-edit]'); const guests = e.target.closest('[data-inviter-guests]');
    if (copy) { await copyLink(state.inviters.find((i) => i.id === copy.dataset.copy)); }
    if (edit) editInviter(state.inviters.find((i) => i.id === edit.dataset.edit));
    if (guests) { state.inviter = guests.dataset.inviterGuests; state.view = 'guests'; state.q = ''; state.page = 1; state.filter = 'all'; $('#navigation').innerHTML = nav(); await renderView(); }
  };
}
async function copyLink(inviter) {
  const link = invitationLink(inviter);
  try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(link); toast('Link copiado. Ya podés compartirlo.'); }
  catch { modal(`<span class="eyebrow">LINK DE INVITACIÓN</span><h2>${esc(inviter.name)}</h2><p>Copiá este link completo para compartirlo.</p><label>Link privado<input id="copy-link-input" value="${esc(link)}" readonly></label><a class="button primary full" href="https://wa.me/?text=${encodeURIComponent(`Te invito a Los Cedros Night. Registrate acá: ${link}`)}" target="_blank" rel="noopener noreferrer">Compartir por WhatsApp ${icon('arrow')}</a>`); $('#copy-link-input').select(); }
}
function newInviter() {
  modal(`<span class="eyebrow">UNA PERSONA. UN LINK.</span><h2>Nuevo invitador</h2><p>Sus invitados quedarán asociados automáticamente a su nombre.</p><form id="inviter-form"><label>Nombre y apellido<input name="name" required minlength="2" maxlength="80" placeholder="Ej. Juan Pérez"></label><label>Cupo de invitados<input name="capacity" type="number" min="1" max="10000" value="10" required></label><p class="form-error" role="alert" hidden></p><button type="submit" class="button primary full">Generar link ${icon('link')}</button></form>`);
  const form = $('#inviter-form'); form.onsubmit = (e) => { e.preventDefault(); submitting(form, async () => {
    const fields = new FormData(form); const result = await api('/api/inviters', { method: 'POST', body: { name: fields.get('name'), capacity: Number(fields.get('capacity')) } });
    $('#modal').close(); await refreshDashboard(); editInviter(result.inviter); toast('Invitador creado. Su link ya está listo.');
  }); };
}
function editInviter(i) {
  modal(`<span class="eyebrow">GESTIÓN DEL INVITADOR</span><h2>${esc(i.name)}</h2><div class="mini-stats"><span><strong>${i.registered}</strong>Registrados</span><span><strong>${i.entered}</strong>Ingresaron</span><span><strong>${i.active ? i.available : 0}</strong>Disponibles</span></div><label>Link de invitación<input readonly value="${esc(invitationLink(i))}" id="inviter-link"></label><div class="form-row link-buttons"><button class="button secondary" id="modal-copy">${icon('copy')} Copiar</button><a class="button secondary" href="https://wa.me/?text=${encodeURIComponent(`Te invito a Los Cedros Night. Registrate acá: ${invitationLink(i)}`)}" target="_blank" rel="noopener noreferrer">WhatsApp ${icon('arrow')}</a></div><form id="edit-inviter-form"><label>Cupo total<input name="capacity" type="number" min="${i.registered}" max="10000" value="${i.capacity}" required></label><p class="small-note">Los registros revocados conservan su cupo. Aumentá el cupo si necesitás más invitaciones.</p><p class="form-error" role="alert" hidden></p><button type="submit" class="button primary full">Guardar cupo ${icon('check')}</button></form><div class="modal-divider"></div><button class="button ${i.active ? 'danger' : 'secondary'} full" id="toggle-inviter">${i.active ? 'Revocar link y acceso de sus invitados' : 'Reactivar link y accesos'}</button><button class="text-button full" id="rotate-link">Renovar token del link</button><p class="small-note">Renovar invalida el link anterior y mantiene a los invitados registrados.</p>`);
  $('#modal-copy').onclick = () => copyLink(i);
  const form = $('#edit-inviter-form'); form.onsubmit = (e) => { e.preventDefault(); submitting(form, async () => { await api(`/api/inviters/${i.id}`, { method: 'PATCH', body: { capacity: Number(new FormData(form).get('capacity')) } }); $('#modal').close(); await refreshDashboard(); toast('Cupo actualizado.'); }); };
  $('#toggle-inviter').onclick = () => confirmAction(i.active ? '¿Revocar este acceso?' : '¿Reactivar este acceso?', i.active ? `El link de ${i.name} dejará de aceptar registros y sus invitados no podrán ingresar. Los datos y las horas de ingreso se conservan.` : 'El link y los invitados sin revocación individual volverán a estar habilitados.', async () => { await api(`/api/inviters/${i.id}`, { method: 'PATCH', body: { active: !i.active } }); await refreshDashboard(); toast(i.active ? 'Acceso revocado.' : 'Acceso reactivado.'); });
  $('#rotate-link').onclick = () => confirmAction('¿Renovar el link?', 'El link que ya compartiste dejará de funcionar. Compartí el nuevo link con el invitador.', async () => { const result = await api(`/api/inviters/${i.id}`, { method: 'PATCH', body: { rotate: true } }); await refreshDashboard(); editInviter(result.inviter); toast('Nuevo link generado.'); });
}
function confirmAction(title, description, action) {
  modal(`<span class="eyebrow">CONFIRMAR ACCIÓN</span><h2>${esc(title)}</h2><p>${esc(description)}</p><p class="form-error" role="alert" hidden></p><div class="form-row"><button id="cancel-action" class="button secondary">Cancelar</button><button id="confirm-action" class="button primary">Confirmar</button></div>`);
  $('#cancel-action').onclick = () => $('#modal').close();
  $('#confirm-action').onclick = async (e) => { e.currentTarget.disabled = true; const content = $('#modal-content'); try { $('#modal').close(); await action(); } catch (error) { toast(error.message, true); if (content.isConnected) $('#modal').close(); } };
}
async function loadGuests() {
  const sequence = ++listSequence;
  try {
    const params = new URLSearchParams({ q: state.q, state: state.filter, inviter: state.inviter, page: state.page });
    const data = await api(`/api/guests?${params}`);
    if (sequence !== listSequence || !$('#guest-list') || state.view !== 'guests') return;
    state.guests = data.guests;
    $('#guest-count').textContent = `${data.total} ${data.total === 1 ? 'invitado' : 'invitados'}`;
    if (!data.guests.length) $('#guest-list').innerHTML = `<div class="empty-state">${icon('search')}<h3>${state.q ? 'No encontramos coincidencias' : 'Todavía no hay invitados en esta lista'}</h3><p>${state.q ? 'Probá con el apellido o el DNI sin puntos.' : 'Los registros aparecerán acá en tiempo real.'}</p></div>`;
    else $('#guest-list').innerHTML = `<div class="guest-table-head"><span>INVITADO / DNI</span><span>INVITADO POR</span><span>ESTADO</span><span>ACCESO</span></div>${data.guests.map((g) => {
      const revoked = g.revoked || !g.inviter_active;
      return `<article class="guest-row ${revoked ? 'is-revoked' : ''}" data-guest="${g.id}"><div class="guest-person"><span class="avatar">${esc(g.first_name[0])}${esc(g.last_name[0])}</span><div><button class="person-name" data-detail="${g.id}">${esc(g.first_name)} ${esc(g.last_name)}</button><span class="person-meta">DNI ${esc(g.dni)}</span></div></div><div class="guest-inviter"><span class="mobile-label">Invitado por</span>${esc(g.inviter_name)}</div><div class="guest-state"><span class="status-pill ${revoked ? 'revoked' : g.entered_at ? 'entered' : 'pending'}">${icon(revoked ? 'close' : g.entered_at ? 'check' : 'clock')}${revoked ? 'Revocado' : g.entered_at ? 'Ingresó' : 'Por ingresar'}</span>${g.entered_at ? `<span class="entry-time">${timeLabel(g.entered_at)} h</span>` : ''}</div><div class="guest-actions"><button class="icon-button" data-detail="${g.id}" title="Ver DNI y detalle" aria-label="Ver DNI de ${esc(g.first_name)} ${esc(g.last_name)}">${icon('photo')}</button><button class="button ${revoked || g.entered_at ? 'secondary' : 'primary'} tiny" data-enter="${g.id}" ${revoked || g.entered_at ? 'disabled' : ''}>${icon('check')} ${g.entered_at ? 'Ingresó' : 'INGRESÓ'}</button></div></article>`;
    }).join('')}`;
    $('#guest-list').onclick = async (e) => { const detail = e.target.closest('[data-detail]'); const enter = e.target.closest('[data-enter]'); if (detail) guestDetail(state.guests.find((g) => g.id === detail.dataset.detail)); if (enter) enterGuest(enter.dataset.enter, enter); };
    $('#pagination').innerHTML = data.pages > 1 ? `<button class="button secondary tiny" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>Anterior</button><span>Página ${data.page} de ${data.pages}</span><button class="button secondary tiny" id="next-page" ${data.page >= data.pages ? 'disabled' : ''}>Siguiente</button>` : '';
    $('#prev-page')?.addEventListener('click', () => { state.page--; loadGuests(); }); $('#next-page')?.addEventListener('click', () => { state.page++; loadGuests(); });
  } catch (e) { if (sequence === listSequence && $('#guest-list')) { $('#guest-list').innerHTML = `<div class="empty-state"><h3>No pudimos cargar la lista</h3><p>${esc(e.message)}</p><button id="retry-guests" class="button secondary">Reintentar</button></div>`; $('#retry-guests').onclick = loadGuests; } }
}
async function enterGuest(id, button) {
  button.disabled = true;
  try { const data = await api(`/api/guests/${id}/enter`, { method: 'POST', body: {} }); toast(data.already_entered ? `Ya ingresó a las ${timeLabel(data.entered_at)}.` : `Ingreso registrado a las ${timeLabel(data.entered_at)}.`); await refreshDashboard(); if ($('#guest-detail')?.dataset.id === id) refreshGuestDetail(id); }
  catch (e) { toast(e.message, true); if (button.isConnected) button.disabled = false; }
}
function guestDetail(g) {
  if (!g) return;
  const revoked = g.revoked || !g.inviter_active;
  modal(`<div id="guest-detail" data-id="${g.id}"><span class="eyebrow">VERIFICACIÓN DE IDENTIDAD</span><h2>${esc(g.first_name)} ${esc(g.last_name)}</h2><div class="detail-dni">DNI <strong>${esc(g.dni)}</strong></div><div class="success-summary"><span>Invitado por</span><strong>${esc(g.inviter_name)}</strong></div><div class="document-photo"><img src="/api/guests/${g.id}/photo" alt="Foto del DNI de ${esc(g.first_name)} ${esc(g.last_name)}"><p class="photo-error" hidden>No pudimos cargar la foto. Cerrá y volvé a abrir el detalle.</p></div><p class="privacy-note">${icon('shield')} Documento privado · acceso exclusivo del equipo</p><div id="detail-entry">${detailEntry(g)}</div><button class="button ${revoked || g.entered_at ? 'secondary' : 'primary'} full" id="detail-enter" ${revoked || g.entered_at ? 'disabled' : ''}>${icon('check')} ${revoked ? 'Acceso revocado' : g.entered_at ? 'Ingreso registrado' : 'INGRESÓ'}</button>${state.user.role === 'admin' ? `<button class="text-button full" id="guest-revoke">${g.revoked ? 'Restaurar acceso individual' : 'Revocar acceso de este invitado'}</button>` : ''}</div>`);
  $('.document-photo img').onerror = () => { $('.photo-error').hidden = false; };
  $('#detail-enter').onclick = (e) => enterGuest(g.id, e.currentTarget);
  bindGuestRevoke(g);
}
function bindGuestRevoke(g) {
  const button = $('#guest-revoke'); if (!button) return;
  button.onclick = () => confirmAction(g.revoked ? '¿Restaurar este acceso?' : '¿Revocar este acceso?', `Invitado: ${g.first_name} ${g.last_name}. DNI ${g.dni}. ${!g.inviter_active ? 'El link del invitador está revocado: debe reactivarse también para permitir el ingreso.' : ''}`, async () => { await api(`/api/guests/${g.id}/revoke`, { method: 'POST', body: { revoked: !g.revoked } }); await refreshDashboard(); toast(g.revoked ? 'Acceso restaurado.' : 'Acceso revocado.'); });
}
function detailEntry(g) { return g.revoked || !g.inviter_active ? '<p class="detail-status revoked">Acceso revocado. Consultá a administración.</p>' : g.entered_at ? `<p class="detail-status entered">${icon('check')} Ya ingresó a las ${timeLabel(g.entered_at)} h.</p>` : '<p class="detail-status">Verificá la foto y el DNI antes de registrar el ingreso.</p>'; }
async function refreshGuestDetail(id) {
  try {
    const data = await api(`/api/guests?q=${encodeURIComponent(state.guests.find((g) => g.id === id)?.dni || $('#guest-detail .detail-dni strong')?.textContent || '')}`);
    const guest = data.guests.find((g) => g.id === id); const detail = $('#guest-detail');
    if (!guest || !detail || detail.dataset.id !== id) return;
    $('#detail-entry').innerHTML = detailEntry(guest);
    const button = $('#detail-enter'); button.disabled = !!(guest.entered_at || guest.revoked || !guest.inviter_active);
    button.innerHTML = `${icon('check')} ${guest.revoked || !guest.inviter_active ? 'Acceso revocado' : guest.entered_at ? 'Ingreso registrado' : 'INGRESÓ'}`;
    if ($('#guest-revoke')) $('#guest-revoke').textContent = guest.revoked ? 'Restaurar acceso individual' : 'Revocar acceso de este invitado';
    bindGuestRevoke(guest);
  } catch (e) { toast(e.message, true); }
}
async function renderEventEditor() {
  const event = await api('/api/event'); state.event = event;
  if (state.view !== 'event' || !$('#view-content')) return;
  $('#view-content').innerHTML = `<div class="event-editor"><section class="panel event-form-panel"><div class="panel-header"><div><h2>Datos del evento</h2><p>Se actualizan en todos los links de invitación.</p></div></div><form id="event-form"><label>Título<input name="title" value="${esc(event.title)}" required minlength="2" maxlength="120"></label><label>Frase del flyer<input name="subtitle" value="${esc(event.subtitle)}" maxlength="120"></label><div class="form-row"><label>Fecha<input name="date" type="date" value="${esc(event.date)}"></label><label>Horario (Argentina)<input name="time" type="time" value="${esc(event.time)}"></label></div><label>Lugar<input name="location" value="${esc(event.location)}" required minlength="2" maxlength="120"></label><label>Descripción<textarea name="description" rows="4" maxlength="600">${esc(event.description)}</textarea></label><p class="small-note">La fecha y el horario vacíos se muestran como “a confirmar”.</p><p class="form-error" role="alert" hidden></p><button type="submit" class="button primary full">Guardar datos ${icon('check')}</button></form></section><div class="flyer-preview">${flyer(event, true)}<button class="button secondary full" id="download-flyer">${icon('download')} Descargar flyer PNG</button><p class="small-note">Incluye el escudo y la foto del club que compartiste.</p></div></div>`;
  const form = $('#event-form'); form.onsubmit = (e) => { e.preventDefault(); submitting(form, async () => { state.event = await api('/api/settings', { method: 'PATCH', body: Object.fromEntries(new FormData(form)) }); await renderEventEditor(); toast('Evento y flyer actualizados.'); }); };
  $('#download-flyer').onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { await downloadFlyer(event); } catch { toast('No pudimos generar el flyer. Volvé a intentar.', true); } finally { b.disabled = false; } };
}
async function downloadFlyer(event) {
  const load = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
  const [photo, logo] = await Promise.all([load('/assets/club.jpeg'), load('/assets/escudo.png')]);
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1440; const ctx = canvas.getContext('2d');
  const scale = Math.max(1080 / photo.width, 1440 / photo.height); ctx.drawImage(photo, (1080-photo.width*scale)/2, (1440-photo.height*scale)/2,photo.width*scale,photo.height*scale);
  const shade = ctx.createLinearGradient(0,0,0,1440); shade.addColorStop(0,'rgba(4,16,35,.45)'); shade.addColorStop(.45,'rgba(4,16,35,.73)'); shade.addColorStop(1,'rgba(4,16,35,.98)'); ctx.fillStyle = shade; ctx.fillRect(0,0,1080,1440);
  ctx.fillStyle = '#f4dc36'; ctx.fillRect(0,0,1080,12); ctx.drawImage(logo,858,65,135,135);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial'; ctx.fillText('EL CLUB. LOS AMIGOS. LA NOCHE.',75,113);
  ctx.fillStyle = '#f4dc36'; ctx.font = 'bold 24px Arial'; ctx.fillText('NOS VEMOS EN CASA',75,425);
  const words = event.title.trim().split(/\s+/); const last = words.pop();
  const fitText = (text, y, color, size = 120) => { ctx.fillStyle = color; while (size > 30) { ctx.font = `900 ${size}px Arial`; if (ctx.measureText(text).width < 930) break; size--; } ctx.fillText(text,75,y); };
  fitText(words.join(' '),570,'#fff'); fitText(`${last}.`,710,'#f4dc36',156);
  ctx.fillStyle = '#fff'; ctx.font = '30px Arial';
  const wrap = (text, y, maxWidth = 920, lineHeight = 43) => { let line = ''; for (const word of text.split(/\s+/)) { const candidate = `${line}${word} `; if (ctx.measureText(candidate).width > maxWidth && line) { ctx.fillText(line.trim(),75,y); y += lineHeight; line = `${word} `; } else line = candidate; } ctx.fillText(line.trim(),75,y); return y + lineHeight; };
  wrap(event.subtitle,790); ctx.fillStyle = '#f4dc36'; ctx.fillRect(75,900,930,2);
  ctx.font = 'bold 32px Arial'; ctx.fillStyle = '#fff'; ctx.fillText(dateLabel(event).toUpperCase(),75,978); ctx.fillText(event.time ? `${event.time} H` : 'HORARIO A CONFIRMAR',75,1038);
  ctx.font = '28px Arial'; wrap(event.location,1100);
  ctx.fillStyle = '#f4dc36'; ctx.font = 'bold 25px Arial'; ctx.fillText('AZUL Y AMARILLO. SIEMPRE.',75,1340); ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial'; ctx.fillText('LOS CEDROS / NIGHT',745,1340);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve,'image/png')); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'los-cedros-night-flyer.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
async function boot() {
  try {
    const [event, data] = await Promise.all([api('/api/event'), api('/api/session')]); state.event = event; state.user = data.user;
    const path = location.pathname; const match = /^\/invitacion\/([^/]+)$/.exec(path);
    if (match) await renderInvitation(match[1]);
    else if (path === '/') await renderLanding();
    else if (state.user) { state.view = state.user.role === 'admin' ? 'inviters' : 'guests'; await renderDashboard(); }
    else await renderLogin();
  } catch (error) { $('#app').innerHTML = `<main class="invalid-link"><h1>No pudimos conectar</h1><p>${esc(error.message)}</p><button class="button primary" id="retry-boot">Reintentar</button></main>`; $('#retry-boot').onclick = boot; }
}
boot();
