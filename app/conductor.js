/* AutoAmigo · Pantalla de la app del conductor.
 * La app (Kotlin) envía el estado con AA.estado(json) y recibe las acciones por AndroidAA.accion(nombre, json).
 * Todo lo que se ve aquí sale de Firebase a través de la app; esta página no guarda nada.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  // ---------- Puente con la app ----------
  function accion(nombre, datos) {
    try {
      if (window.AndroidAA && window.AndroidAA.accion) window.AndroidAA.accion(nombre, JSON.stringify(datos || {}));
      else console.log('[AA] acción', nombre, datos);
    } catch (e) { console.log('[AA] error', e); }
  }

  // Estado que llega de la app (D) y estado propio de la pantalla (U)
  var D = null;
  var U = { pantalla: 'inicio', antesBandeja: 'inicio', menu: false, mini: false, codigo: '', msgRec: null, recargando: false, fin: null, confirmar: null, ocupadoBtn: false };

  function dineroC(c) { return '$' + ((c || 0) / 100).toFixed(2); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function iniciales(n) { return String(n || '').split(' ').filter(Boolean).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase(); }
  function aviso(t) { var a = $('#aviso'); a.textContent = t; a.hidden = false; clearTimeout(aviso.t); aviso.t = setTimeout(function () { a.hidden = true; }, 3500); }
  function distKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x)) * 1.3; // las calles no son línea recta
  }
  function minutos(km) { return Math.max(1, Math.round(km / 0.42)); } // ≈ 25 km/h en ciudad
  function tieneCoord(p) { return p && typeof p.lat === 'number' && typeof p.lng === 'number'; }

  // ---------- Carro (cambia de color según el carro registrado) ----------
  function oscurecer(hex, f) {
    var n = parseInt(String(hex || '#F4F5F7').replace('#', ''), 16);
    if (!isFinite(n)) n = 0xF4F5F7;
    var r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * f) + ',' + Math.round(g * f) + ',' + Math.round(b * f) + ')';
  }
  function carroSVG(c) {
    c = /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#F4F5F7';
    var sombra = oscurecer(c, 0.72), luz = 'rgba(255,255,255,.55)';
    return '<svg viewBox="0 0 220 104" width="100%" aria-label="Carro del conductor">' +
      '<ellipse cx="112" cy="92" rx="98" ry="7" fill="rgba(16,24,40,.18)"/>' +
      '<path d="M14 66c0-9 5-14 14-16l30-6 26-20c6-5 13-7 21-7h42c9 0 16 3 22 9l20 19 15 3c9 2 14 8 14 17v10c0 4-3 7-7 7H21c-4 0-7-3-7-7z" fill="' + c + '" stroke="' + sombra + '" stroke-width="1.5"/>' +
      '<path d="M14 72h196v4c0 4-3 7-7 7H21c-4 0-7-3-7-7z" fill="' + sombra + '"/>' +
      '<path d="M66 46l22-17c5-4 10-6 17-6h17v23z" fill="#1C2433"/>' +
      '<path d="M128 23h11c7 0 12 2 17 7l16 16h-44z" fill="#1C2433"/>' +
      '<path d="M70 44l18-14c4-3 8-4 13-4" stroke="' + luz + '" stroke-width="2" fill="none"/>' +
      '<path d="M124 23v24M62 50h132" stroke="' + sombra + '" stroke-width="1.2"/>' +
      '<rect x="112" y="54" width="12" height="3" rx="1.5" fill="' + sombra + '"/>' +
      '<path d="M196 56c5 0 10 2 12 6h-12z" fill="#FFE9A8"/><path d="M16 58h9v6h-11z" fill="#E5252A"/>' +
      '<circle cx="56" cy="78" r="16" fill="#1C2129"/><circle cx="56" cy="78" r="8" fill="#B8BEC8"/><circle cx="56" cy="78" r="3" fill="#596273"/>' +
      '<circle cx="170" cy="78" r="16" fill="#1C2129"/><circle cx="170" cy="78" r="8" fill="#B8BEC8"/><circle cx="170" cy="78" r="3" fill="#596273"/>' +
      '</svg>';
  }

  function saludo() {
    var h = new Date().getHours();
    var s = h >= 6 && h < 12 ? 'Buenos días' : (h >= 12 && h < 18 ? 'Buenas tardes' : 'Buenas noches');
    $('#saludo-txt').textContent = '¡' + s + ', que tengas una excelente jornada!';
  }

  // ---------- Mapa ----------
  var M = MapaAA.crear('mapa', [-2.17, -79.9224], 13);
  function listo(f) { if (M.__listo) f(); else M.__listos.push(f); }
  var yoEl = document.createElement('div'); yoEl.className = 'yo gris'; yoEl.innerHTML = '<div class="halo"></div><div class="punto"></div>';
  var yoMk = null, primeraVez = true;
  function pinV(color) {
    var el = document.createElement('div');
    el.innerHTML = '<svg class="pin-v" width="40" height="52" viewBox="0 0 40 52"><path d="M20 50C20 50 4 31 4 19a16 16 0 1 1 32 0c0 12-16 31-16 31z" fill="' + color + '" stroke="#fff" stroke-width="2"/><circle cx="20" cy="19" r="6.5" fill="#fff"/></svg>';
    return el;
  }
  var mkO = null, mkD = null;
  function marcador(mk, p, color) {
    if (!tieneCoord(p)) { if (mk) mk.remove(); return null; }
    if (!mk) mk = new maplibregl.Marker({ element: pinV(color), anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(M);
    else mk.setLngLat([p.lng, p.lat]);
    return mk;
  }
  function enViaje() { return !!(D && (D.oferta || D.carrera)); }
  function relleno() {
    var alto = M.getContainer().clientHeight;
    return enViaje() ? { top: 140, bottom: Math.round(($('#hoja').offsetHeight || alto * 0.5) + 30), left: 50, right: 50 } : { top: 30, bottom: 30, left: 30, right: 30 };
  }
  function ponerRuta(coords) {
    listo(function () {
      var datos = { type: 'FeatureCollection', features: coords ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }] : [] };
      if (M.getSource('v-ruta')) { M.getSource('v-ruta').setData(datos); return; }
      M.addSource('v-ruta', { type: 'geojson', data: datos });
      M.addLayer({ id: 'v-ruta-brillo', type: 'line', source: 'v-ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3B82F6', 'line-width': 12, 'line-blur': 7, 'line-opacity': .55 } });
      M.addLayer({ id: 'v-ruta', type: 'line', source: 'v-ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4C8DFF', 'line-width': 4.5 } });
    });
  }
  // Ruta por las calles (servicio gratuito OSRM). Se recalcula solo si cambian los puntos o te mueves bastante.
  var R = { clave: '', desde: null, pedido: 0, km: null, min: null, ultimo: 0 };
  function trazar(a, b, clave) {
    if (!tieneCoord(a) || !tieneCoord(b)) { R.clave = ''; R.km = R.min = null; ponerRuta(null); return; }
    var movido = R.desde ? distKm(R.desde, a) / 1.3 : 99;
    var ahora = Date.now();
    if (clave === R.clave && (movido < 0.15 || ahora - R.ultimo < 20000)) return;
    var nueva = clave !== R.clave;
    R.clave = clave; R.desde = { lat: a.lat, lng: a.lng }; R.ultimo = ahora;
    if (nueva) { R.km = R.min = null; ponerRuta([[a.lng, a.lat], [b.lng, b.lat]]); }
    var pedido = ++R.pedido;
    fetch('https://router.project-osrm.org/route/v1/driving/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (pedido !== R.pedido || !j.routes || !j.routes[0]) return;
        var rt = j.routes[0];
        R.km = rt.distance / 1000; R.min = Math.max(1, Math.round(rt.duration / 60 * 1.25)); // +25% por tráfico
        ponerRuta(rt.geometry.coordinates);
        pintarHoja(true);
      }).catch(function () {});
  }
  function verRuta() {
    var c = D && (D.carrera || D.oferta); if (!c) return;
    var b = new maplibregl.LngLatBounds(), n = 0;
    [D.yo, c.o, c.d].forEach(function (p) { if (tieneCoord(p)) { b.extend([p.lng, p.lat]); n++; } });
    if (n >= 2) M.fitBounds(b, { padding: relleno(), maxZoom: 16, duration: 600 });
    else centrar();
  }
  function centrar() {
    if (!D || !tieneCoord(D.yo)) { aviso('Todavía no hay señal GPS.'); return; }
    M.easeTo({ center: [D.yo.lng, D.yo.lat], zoom: Math.max(M.getZoom(), 15), duration: 600 });
  }
  function pintarMapa() {
    var yo = D && D.yo;
    if (tieneCoord(yo)) {
      if (!yoMk) yoMk = new maplibregl.Marker({ element: yoEl }).setLngLat([yo.lng, yo.lat]).addTo(M);
      else yoMk.setLngLat([yo.lng, yo.lat]);
      if (primeraVez) { primeraVez = false; M.jumpTo({ center: [yo.lng, yo.lat], zoom: 15 }); }
    }
    yoEl.className = 'yo ' + (D && (D.estado === 'conectado' || D.carrera) ? '' : 'gris');
    var c = D && (D.carrera || D.oferta);
    mkO = marcador(mkO, c && c.o, '#E5252A');
    mkD = marcador(mkD, c && c.d, '#1570EF');
    if (!c) { trazar(null, null, ''); return; }
    // Oferta: recogida → destino. Aceptada: yo → recogida. En ejecución: yo → destino.
    if (D.oferta) trazar(c.o, tieneCoord(c.d) ? c.d : null, 'o' + c.id);
    else if (c.estado === 'aceptada') trazar(yo, c.o, 'a' + c.id);
    else trazar(yo, c.d, 'e' + c.id);
  }

  // ---------- Textos ----------
  var NOMBRE_ESTADO = { conectado: 'Conectado', desconectado: 'Desconectado', ocupado: 'Ocupado' };
  var ICONO_PIN = function (c) { return '<svg width="26" height="32" viewBox="0 0 40 52"><path d="M20 50C20 50 4 31 4 19a16 16 0 1 1 32 0c0 12-16 31-16 31z" fill="' + c + '"/><circle cx="20" cy="19" r="6.5" fill="#fff"/></svg>'; };
  var ESTRELLA_P = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#101828"><path d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.3l6.6-.8z"/></svg>';
  var PERSONA_P = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#344054"><circle cx="12" cy="8" r="4.5"/><path d="M3.5 21c0-4.7 3.8-7.5 8.5-7.5s8.5 2.8 8.5 7.5z"/></svg>';
  function puntoHTML(p, color, defecto) {
    p = p || {};
    return '<div class="p">' + ICONO_PIN(color) + '<div><b>' + esc(p.dir || defecto) + '</b>' + (p.ref ? '<small>' + esc(p.ref) + '</small>' : '') + '</div></div>';
  }
  function puntosHTML(c, soloUno) {
    var o = puntoHTML(c.o, '#E5252A', 'Recogida');
    var d = puntoHTML(c.d, '#1570EF', 'Se indica al subir');
    if (soloUno === 'o') return '<div class="puntos">' + o + '</div>';
    if (soloUno === 'd') return '<div class="puntos">' + d + '</div>';
    return '<div class="puntos">' + o + d + '</div>';
  }
  function califTxt(c) { return typeof c.calif === 'number' && c.calif > 0 ? c.calif.toFixed(1) : 'Nuevo'; }
  function viajesTxt(c) { return typeof c.viajes === 'number' ? String(c.viajes) : '—'; }
  function valorTxt(c) {
    if (c.fijoC) return dineroC(c.fijoC);
    if (c.estado === 'ejecucion' && c.taxi) return dineroC(c.cobrarC);
    return c.estC ? dineroC(c.estC) : 'Taxímetro';
  }
  // km y minutos: los de la ruta si ya llegaron, si no un cálculo en línea recta
  function kmMin(desde, hasta) {
    if (R.km != null && R.min != null) return { km: R.km, min: R.min };
    var k = distKm(desde, hasta);
    return k == null ? null : { km: k, min: minutos(k) };
  }

  // ---------- Hoja: nueva carrera ----------
  function hojaOferta(o) {
    var L = 2 * Math.PI * 18;
    var km = o.km != null ? o.km : distKm(D.yo, o.o);
    var h = '<button class="tirador" aria-label="Deslizar"></button>' +
      '<span class="etiqueta">Nueva carrera</span>' + (o.programada ? '<span class="prog">Programada · recoger ' + esc(o.programada) + '</span>' : '') +
      '<div class="datos"><div><div class="km">' + (km != null ? km.toFixed(1) + ' km' : '—') + '</div><div class="min">' + (km != null ? minutos(km) + ' min para recoger' : 'Sin GPS') + '</div></div>' +
      '<div class="valor"><b>' + (o.fijoC ? dineroC(o.fijoC) : (o.estC ? dineroC(o.estC) : '$—')) + '</b><small>' + (o.fijoC ? 'Pactada' : 'Taxímetro') + '</small></div></div>' +
      puntosHTML(o) +
      '<div class="chips"><div class="chip"><b><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.3l6.6-.8z"/></svg>' + califTxt(o) + '</b><small>Calificación</small></div>' +
      '<div class="chip"><b><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4.5"/><path d="M3.5 21c0-4.7 3.8-7.5 8.5-7.5s8.5 2.8 8.5 7.5z"/></svg>' + viajesTxt(o) + '</b><small>Viajes realizados</small></div>' +
      '<div class="chip"><b><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6a1 1 0 0 1 1 1v2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3V4a1 1 0 0 1 1-1zm1 3h4V5h-4z"/></svg>' + (o.equipaje ? 'Sí' : 'No') + '</b><small>Equipaje grande</small></div></div>';
    if (o.esperandoAprobacion) {
      h += '<div class="aprob">Tu saldo es bajo: la central está revisando si puedes tomar esta carrera…</div>';
    } else {
      h += '<div class="botones"><button class="btn-gris" id="b-rechazar"' + (o.ocupado ? ' disabled' : '') + '>Rechazar</button>' +
        '<button class="btn-acep" id="b-aceptar"' + (o.ocupado ? ' disabled' : '') + '>Aceptar<span class="ruedita"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="18" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="4"/>' +
        '<circle id="rueda" cx="21" cy="21" r="18" fill="none" stroke="#F04438" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + L.toFixed(1) + '" stroke-dashoffset="0"/></svg><span id="rueda-n"></span></span></button></div>';
    }
    return h;
  }

  // ---------- Hoja: carrera aceptada / en ejecución ----------
  function hojaCarrera(c) {
    var enCurso = c.estado === 'ejecucion';
    var meta = enCurso ? c.d : c.o;
    var km = kmMin(D.yo, meta);
    var llegue = enCurso || (tieneCoord(D.yo) && tieneCoord(c.o) && distKm(D.yo, c.o) / 1.3 < 0.08);
    var h = '<button class="tirador" aria-label="Deslizar"></button>' +
      '<div class="cliente"><div class="foto-c">' + esc(iniciales(c.cliente) || '?') + '</div><div class="nom"><b>' + esc(c.cliente || 'Cliente') + '</b>' +
      '<small>' + califTxt(c) + ' ' + ESTRELLA_P + '<i></i>' + PERSONA_P + ' ' + viajesTxt(c) + ' viajes</small></div>' +
      '<button class="circ" id="b-whatsapp" aria-label="Mensaje por WhatsApp"><svg width="23" height="23" viewBox="0 0 24 24"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5z" fill="var(--navy)"/><path d="M9 7.3c.3 0 .6.1.8.5l.9 2.1c.1.3 0 .5-.1.7l-.6.7c-.1.2-.1.4 0 .6.7 1.2 1.7 2.1 2.9 2.8.2.1.4.1.6-.1l.7-.8c.2-.2.4-.3.7-.2l2 .9c.4.2.5.4.5.7 0 .9-.6 2-1.8 2.2-1 .2-2.3 0-4.5-1.3-2.4-1.5-3.8-3.7-4.1-4.6-.4-1.1-.2-2.2.4-2.9.4-.6.9-.8 1.5-.8z" fill="#fff"/></svg></button>' +
      '<button class="circ" id="b-llamar" aria-label="Llamar"><svg width="22" height="22" viewBox="0 0 24 24" fill="var(--navy)"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg></button></div>' +
      '<div class="datos"><div><div class="km">' + (km ? km.km.toFixed(1) + ' km' : '—') + '</div><div class="min">' +
      (enCurso ? (km ? km.min + ' min para llegar al destino' : 'Destino: pregunta al pasajero') : (llegue ? 'Ya llegaste donde el cliente' : (km ? km.min + ' min para recoger' : 'Sin GPS'))) + '</div></div>' +
      '<div class="valor"><b>' + valorTxt(c) + '</b><small>' + (c.fijoC ? 'Pactada' : 'Taxímetro') + '</small></div></div>';
    if (c.manual && !enCurso) h += '<div class="aprob solo-grande" style="background:#E6EEFF;color:#090145">La central te asignó esta carrera.</div>';
    h += '<div class="solo-grande">' + puntosHTML(c) + '</div>';
    h += '<div class="solo-mini">' + puntosHTML(c, llegue ? 'd' : 'o') + '</div>';
    if (enCurso && c.taxi) {
      var t = c.taxi;
      h += '<div class="taxi solo-grande"><div><div class="t">TAXÍMETRO</div><div class="i">' + (t.metros / 1000).toFixed(2) + ' km · ' + Math.floor(t.esperaSeg / 60) + ':' + String(t.esperaSeg % 60).padStart(2, '0') + ' detenido' +
        (t.mostradoC < D.cfg.minimaC ? '<br>Mínimo a cobrar ' + dineroC(D.cfg.minimaC) : '') + '</div></div><div class="v">' + dineroC(t.mostradoC) + '</div></div>';
    }
    if (c.exacta) h += '<div class="exacta solo-grande">Dirección exacta: ' + esc(c.exacta) + '</div>';
    if (c.notas) h += '<div class="exacta solo-grande" style="background:#F2F4F7">Nota: ' + esc(c.notas) + '</div>';
    if (!enCurso) h += '<button class="btn-cancelar solo-grande" id="b-cancelar"' + (c.ocupado ? ' disabled' : '') + '>Cancelar carrera</button>';
    h += enCurso
      ? '<button class="btn-final" id="b-finalizar"' + (c.ocupado ? ' disabled' : '') + '>Finalizar · cobrar ' + dineroC(c.cobrarC) + '</button>'
      : '<button class="btn-final" id="b-iniciar"' + (c.ocupado ? ' disabled' : '') + '>' + (c.fijoC ? 'Iniciar carrera' : 'Iniciar taxímetro') + '</button>';
    return h;
  }

  var ultimaHoja = '', tocando = false;
  function pintarHoja(forzar) {
    if (!D) return;
    var html = D.oferta ? hojaOferta(D.oferta) : (D.carrera ? hojaCarrera(D.carrera) : '');
    // No se cambia la hoja mientras el dedo está encima (así no se pierde el toque en un botón)
    if ((forzar || html !== ultimaHoja) && (!tocando || !html)) { $('#hoja').innerHTML = html; ultimaHoja = html; }
    $('#hoja').classList.toggle('mini', U.mini && !D.oferta);
    pintarRueda();
  }
  function pintarRueda() {
    var r = $('#rueda'); if (!r || !D || !D.oferta) return;
    var L = 2 * Math.PI * 18, total = D.oferta.totalSeg || 20, resta = Math.max(0, Math.min(total, D.oferta.restaSeg));
    r.setAttribute('stroke-dashoffset', (L * (1 - resta / total)).toFixed(1)); $('#rueda-n').textContent = resta;
  }
  $('#hoja').addEventListener('pointerdown', function () { tocando = true; }, true);
  function soltarHoja() { setTimeout(function () { tocando = false; pintarHoja(false); }, 350); }
  $('#hoja').addEventListener('pointerup', soltarHoja, true);
  $('#hoja').addEventListener('pointercancel', soltarHoja, true);

  // ---------- Secciones ----------
  function seccionHTML(p) {
    if (p === 'bandeja') {
      var lista = (D.bandeja || []).slice().sort(function (a, b) { return (a.km == null ? 1e9 : a.km) - (b.km == null ? 1e9 : b.km); });
      return '<h2>Bandeja de carreras</h2><p style="margin:-6px 0 14px;color:var(--gris);font-size:14px">Carreras que ningún conductor ha aceptado, de la más cercana a la más lejana.</p>' +
        (lista.length ? lista.map(function (c) {
          return '<div class="item-b"><div class="fila"><div><div class="km">' + (c.km != null ? c.km.toFixed(1) + ' km' : '—') + '</div><small style="color:var(--gris)">' + (c.km != null ? minutos(c.km) + ' min para recoger' : '') + (c.programada ? ' · programada ' + esc(c.programada) : '') + '</small></div>' +
            '<div class="val">' + (c.fijoC ? dineroC(c.fijoC) : (c.estC ? dineroC(c.estC) : '$—')) + '<small>' + (c.fijoC ? 'Pactada' : 'Taxímetro') + '</small></div></div>' +
            '<div class="dirs"><div><i style="background:var(--rojo)"></i>' + esc((c.o || {}).dir || 'Recogida') + '</div><div><i style="background:var(--azul)"></i>' + esc((c.d || {}).dir || 'Se indica al subir') + '</div></div>' +
            (c.programada ? '' : '<button class="btn-azul" data-tomar="' + esc(c.id) + '">Aceptar</button>') + '</div>';
        }).join('') : '<div class="vacio">No hay carreras en la bandeja.</div>');
    }
    if (p === 'carreras') {
      var hechas = (D.hechas || []);
      return '<h2>Mis carreras</h2><p style="margin:-6px 0 14px;color:var(--gris);font-size:14px">Carreras de hoy.</p>' + (hechas.length ? hechas.map(function (h) {
        return '<div class="item-b"><div class="fila"><b>#' + esc(h.numero) + ' · ' + esc(h.cliente) + '</b><b>' + dineroC(h.cobradoC) + '</b></div><div class="dirs" style="margin-bottom:0">' + esc(h.o || '—') + ' → ' + esc(h.d || '—') + '<br><small style="color:var(--gris)">' + esc(h.hora) + ' · comisión ' + dineroC(h.comC) + '</small></div></div>';
      }).join('') : '<div class="vacio">Hoy todavía no tienes carreras.</div>');
    }
    if (p === 'billetera') {
      var bajo = D.saldoC < D.minimoC
        ? '<div class="bajo"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z"/></svg>Sin saldo no te llegan carreras. Recarga para seguir trabajando.</div>' : '';
      var msg = U.msgRec ? '<div class="msg-rec ' + U.msgRec.c + '">' + esc(U.msgRec.t) + '</div>' : '';
      var movs = (D.movs || []).map(function (m) {
        return '<div class="mov ' + m.tipo + '"><span class="ic">' + (m.tipo === 'mas'
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 11l1.6-4.3A2 2 0 0 1 8.5 5.4h7a2 2 0 0 1 1.9 1.3L19 11a2 2 0 0 1 1 1.7V17a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.3A2 2 0 0 1 5 11zm2.2-.3h9.6l-1.1-3.1a.5.5 0 0 0-.5-.3H8.8a.5.5 0 0 0-.5.3z"/></svg>') +
          '</span><div class="t"><b>' + esc(m.texto) + '</b><small>' + esc(m.det) + ' · ' + esc(m.hora) + '</small></div><div class="m">' + (m.tipo === 'mas' ? '+' : '−') + dineroC(m.montoC) + '</div></div>';
      }).join('');
      return '<h2>Mi billetera</h2>' +
        '<div class="saldo-card"><small>Disponible</small><div class="monto">' + dineroC(D.saldoC) + '</div>' +
        '<div class="sub"><div><b>' + dineroC(D.consumidoHoyC) + '</b><span>Consumido hoy</span></div><div><b>' + D.carrerasHoy + '</b><span>Carreras hoy</span></div></div></div>' + bajo +
        '<div class="recargar"><h3>Recargar</h3><p>Escribe los 10 números de recarga que te dio la central de AutoAmigo.</p>' +
        '<input class="codigo" id="codigo" maxlength="10" inputmode="numeric" pattern="[0-9]*" autocomplete="off" spellcheck="false" placeholder="Números" value="' + esc(U.codigo) + '">' +
        '<button class="btn-azul" id="b-recargar"' + (U.recargando ? ' disabled' : '') + '>' + (U.recargando ? 'Verificando…' : 'Recargar') + '</button>' + msg + '</div>' +
        '<div class="movs"><h3>Movimientos de hoy</h3>' + (movs || '<div class="vacio">Todavía no tienes movimientos hoy.</div>') + '</div>';
    }
    if (p === 'perfil') {
      var pf = D.perfil || {};
      return '<h2>Mi perfil</h2><div class="item-b"><div class="fila" style="justify-content:flex-start;gap:12px"><div class="avatar" style="width:56px;height:56px;font-size:20px">' + esc(iniciales(pf.nombre)) + '</div>' +
        '<div><b style="font-size:18px">' + esc(pf.nombre) + '</b><br><small style="color:var(--gris)">Unidad ' + esc(pf.unidad) + (pf.placa ? ' · Placa ' + esc(pf.placa) : '') + '</small></div></div></div>' +
        '<div class="vacio">Pronto podrás ver y editar más datos de tu perfil aquí.</div>' + (D.version ? '<p style="text-align:center;color:var(--gris);font-size:12.5px;margin-top:14px">Versión ' + esc(D.version) + '</p>' : '');
    }
    if (p === 'ayuda') {
      return '<h2>Ayuda y soporte</h2><div class="vacio">Si tienes un problema con una carrera o con tu saldo, comunícate con la central de AutoAmigo.</div>';
    }
    return '';
  }

  // ---------- Render general ----------
  var ultimaSec = '';
  function render() {
    if (!D) return;
    var p = $('#pantalla');
    var viaje = enViaje();
    var antes = p.classList.contains('viaje');
    p.classList.toggle('viaje', viaje);
    p.classList.toggle('menu-abierto', U.menu);
    var pf = D.perfil || {};
    $('#iniciales').textContent = iniciales(pf.nombre);
    $('#lat-ini').textContent = iniciales(pf.nombre);
    $('#lat-nombre').textContent = pf.nombre || '';
    $('#lat-unidad').textContent = pf.unidad ? 'Unidad ' + pf.unidad : '';
    $('#nombre').textContent = String(pf.nombre || '').split(' ')[0] || '';
    if (render.color !== pf.colorCarro) { render.color = pf.colorCarro; $('#carro').innerHTML = carroSVG(pf.colorCarro); }
    $('#punto-estado').className = D.estado;
    $('#estado-txt').textContent = NOMBRE_ESTADO[D.estado] || 'Desconectado';
    $('#campana-punto').hidden = !(D.bandeja && D.bandeja.length);
    $('#k-carreras').textContent = D.carrerasHoy;
    $('#k-saldo').textContent = $('#v-saldo').textContent = dineroC(D.saldoC);
    $('#k-consumido').textContent = $('#v-consumido').textContent = dineroC(D.consumidoHoyC);
    // Aviso en el inicio (GPS, saldo, error)
    var al = $('#alerta-inicio'), txt = '', clase = 'amarilla', boton = '';
    if (D.error) { txt = 'Problema con la conexión: ' + D.error; clase = 'roja'; }
    else if (D.estado !== 'desconectado' && D.ubicacionApagada) { txt = 'La ubicación del teléfono está apagada. Actívala para recibir carreras.'; clase = 'roja'; boton = '<button data-accion="abrirUbicacion">Activar</button>'; }
    else if (D.saldoC < D.minimoC) { txt = 'Sin saldo no te llegan carreras.'; clase = 'roja'; boton = '<button data-ir="billetera">Recargar</button>'; }
    else if (D.estado === 'conectado' && !tieneCoord(D.yo)) { txt = 'Buscando señal GPS…'; }
    al.className = 'alerta-inicio ' + clase; al.hidden = !txt;
    if (txt) al.innerHTML = '<span>' + esc(txt) + '</span>' + boton;
    // Deslizar: gris desconectado, verde conectado
    var con = D.estado !== 'desconectado';
    $('#deslizar').classList.toggle('off', !con);
    $('#desl-txt').textContent = con ? 'Desconectarme' : 'Conectarme';
    $('#perilla-ic').setAttribute('fill', con ? '#12B76A' : '#98A2B3');
    // Barra y menú
    $$('.barra button, .lateral button[data-ir]').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-ir') === U.pantalla); });
    // Secciones
    var sec = U.pantalla !== 'inicio' && !viaje;
    $('#seccion').hidden = !sec;
    $('#b-centrar').hidden = sec;
    if (sec) { var hs = seccionHTML(U.pantalla); if (hs !== ultimaSec) { $('#seccion-cuerpo').innerHTML = hs; ultimaSec = hs; } } else ultimaSec = '';
    // Hoja del viaje
    pintarHoja(false);
    $('#b-ruta').style.display = viaje ? 'flex' : 'none';
    var abajo = viaje ? ($('#hoja').offsetHeight + 16) + 'px' : '16px';
    $('#b-centrar').style.bottom = abajo; $('#b-ruta').style.bottom = abajo;
    pintarMapa();
    if (antes !== viaje) {
      if (!viaje) U.mini = false;
      setTimeout(function () { M.resize(); if (viaje) verRuta(); else if (D && tieneCoord(D.yo)) centrar(); }, 40);
    }
    if (D.carrera && render.enfoque !== D.carrera.id + D.carrera.estado) { render.enfoque = D.carrera.id + D.carrera.estado; setTimeout(verRuta, 80); }
    if (!D.carrera) render.enfoque = '';
  }

  // ---------- Carrera completada ----------
  var ESTRELLA = '<svg viewBox="0 0 24 24"><path d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.3l6.6-.8z"/></svg>';
  function pintarFin() {
    var f = U.fin, el = $('#fin');
    if (!f) { el.hidden = true; return; }
    var filas = [['Recogida', f.o || '—'], ['Destino', f.d || '—'], ['Distancia', ((f.metros || 0) / 1000).toFixed(2) + ' km'], ['Tiempo', Math.max(1, Math.round((f.seg || 0) / 60)) + ' min']];
    var nota = '';
    if (f.fijo) filas.push(['Precio pactado', dineroC(f.totalC)]);
    else {
      filas.push(['Arranque', dineroC(f.arranqueC)], ['Recorrido', dineroC(f.recorridoC)],
        ['Tiempo detenido (' + Math.floor((f.esperaSeg || 0) / 60) + ':' + String((f.esperaSeg || 0) % 60).padStart(2, '0') + ')', dineroC(f.esperaC)],
        ['Taxímetro marcó', dineroC(f.marcadoC)]);
      if (f.marcadoC < f.minimaC) nota = '<div class="nota-min">El taxímetro marcó menos de ' + dineroC(f.minimaC) + ', se cobra la carrera mínima.</div>';
    }
    var est = '';
    for (var i = 1; i <= 5; i++) est += '<button data-estrella="' + i + '" class="' + (i <= (f.estrellas || 0) ? 'on' : '') + '" aria-label="' + i + ' estrellas">' + ESTRELLA + '</button>';
    el.innerHTML =
      '<div class="check"><i style="left:8px;top:58px;background:var(--rojo)"></i><i style="left:14px;top:18px;background:#5B8CFF;border-radius:50%"></i>' +
      '<i style="right:6px;top:10px;background:#8DB4FF;border-radius:50%"></i><i style="right:18px;top:40px;background:#5B8CFF;border-radius:50%"></i><i style="right:2px;top:70px;background:var(--rojo)"></i>' +
      '<div class="c"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div></div>' +
      '<h2>¡Carrera completada!</h2>' +
      '<div class="total">' + dineroC(f.totalC) + '</div><div class="total-t">Total a cobrar' + (f.fijo ? ' · Pactada' : ' · Taxímetro') + '</div>' + nota +
      '<div class="filas">' + filas.map(function (r) { return '<div class="fila"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('') + '</div>' +
      '<div class="calif">Califica al cliente</div><div class="estrellas">' + est + '</div>' +
      '<div class="razon' + (f.estrellas && f.estrellas <= 3 ? ' abierta' : '') + '"><label for="razon">Razón</label>' +
      '<textarea id="razon" maxlength="300" placeholder="Explica por qué le das ' + (f.estrellas || 0) + ' estrella' + (f.estrellas === 1 ? '' : 's') + '">' + esc(f.razon || '') + '</textarea></div>' +
      '<div class="espacio"></div><div class="pie"><button class="btn-final" id="b-continuar">Continuar</button></div>';
    el.hidden = false;
  }
  $('#fin').addEventListener('input', function (e) {
    if (e.target.id === 'razon') { U.fin.razon = e.target.value; e.target.parentNode.classList.remove('error'); }
  });
  $('#fin').addEventListener('click', function (e) {
    var b = e.target.closest('[data-estrella]');
    if (b) {
      U.fin.estrellas = Number(b.getAttribute('data-estrella')); pintarFin();
      if (U.fin.estrellas <= 3) setTimeout(function () { var r = $('#razon'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 320);
      return;
    }
    if (e.target.closest('#b-continuar')) {
      var f = U.fin, n = f.estrellas || 0;
      if (n && n <= 3 && (f.razon || '').trim().length < 5) {
        $('#fin .razon').classList.add('error'); $('#razon').focus();
        aviso('Escribe la razón de tu calificación.'); return;
      }
      if (n) accion('calificar', { id: f.id, estrellas: n, razon: n <= 3 ? (f.razon || '').trim() : '' });
      U.fin = null; pintarFin();
      aviso(n ? 'Gracias, calificaste al cliente con ' + n + ' estrella' + (n > 1 ? 's' : '') + '.' : 'Listo, ya estás libre para otra carrera.');
    }
  });

  // ---------- Confirmaciones ----------
  function confirmar(tit, txt, si, no, alAceptar) {
    $('#confirmar-tit').textContent = tit; $('#confirmar-txt').textContent = txt;
    $('#c-si').textContent = si; $('#c-no').textContent = no;
    U.confirmar = alAceptar; $('#confirmar').hidden = false;
  }

  // ---------- Navegación ----------
  function irA(p) {
    if (p !== U.pantalla) U.msgRec = null;
    U.pantalla = p; U.menu = false; render();
  }
  function alternarMenu() { U.menu = !U.menu; $('#estados').hidden = true; $('#estado-btn').classList.remove('abierto'); render(); }

  // ---------- Eventos ----------
  $('#ham').addEventListener('click', alternarMenu);
  $('#ham-v').addEventListener('click', alternarMenu);
  $('#velo').addEventListener('click', alternarMenu);
  $('#estado-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    var ab = $('#estados').hidden; $('#estados').hidden = !ab; this.classList.toggle('abierto', ab);
    $$('#estados button').forEach(function (b) { b.classList.toggle('sel', D && b.getAttribute('data-e') === D.estado); });
  });
  $('#estados').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('#estados').hidden = true; $('#estado-btn').classList.remove('abierto');
    var est = b.getAttribute('data-e');
    if (D && est === D.estado) return;
    if (est === 'desconectado' && D && D.carrera) { aviso('Termina tu carrera antes de desconectarte.'); return; }
    accion(est === 'conectado' ? 'conectar' : (est === 'ocupado' ? 'ocupado' : 'desconectar'));
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#estados') && !e.target.closest('#estado-btn')) { $('#estados').hidden = true; $('#estado-btn').classList.remove('abierto'); } });
  $('#campana').addEventListener('click', function () {
    if (U.pantalla === 'bandeja') { irA(U.antesBandeja || 'inicio'); return; }
    U.antesBandeja = U.pantalla; irA('bandeja');
  });
  $('#salir').addEventListener('click', function () {
    U.menu = false; render();
    if (D && D.carrera) { aviso('Termina tu carrera antes de cerrar sesión.'); return; }
    confirmar('¿Cerrar sesión?', 'Dejarás de recibir carreras hasta que vuelvas a entrar.', 'Sí, cerrar sesión', 'No, volver', function () { accion('salir'); });
  });
  document.addEventListener('click', function (e) {
    var ir = e.target.closest('[data-ir]');
    if (ir) {
      var dest = ir.getAttribute('data-ir');
      if (enViaje() && dest !== 'inicio') { U.menu = false; render(); aviso('Termina la carrera para abrir "' + ir.textContent.trim() + '".'); return; }
      irA(dest); return;
    }
    var ac = e.target.closest('[data-accion]'); if (ac) { accion(ac.getAttribute('data-accion')); return; }
    var t = e.target.closest('[data-tomar]');
    if (t) {
      var id = t.getAttribute('data-tomar');
      confirmar('¿Aceptar esta carrera?', 'Te la asignamos si nadie la tomó antes.', 'Sí, aceptar', 'No', function () { accion('tomar', { id: id }); irA('inicio'); });
      return;
    }
    if (e.target.closest('#b-rechazar')) { if (D.oferta) accion('rechazar', { id: D.oferta.id }); return; }
    if (e.target.closest('#b-aceptar')) { if (D.oferta) accion('aceptar', { id: D.oferta.id }); return; }
    if (e.target.closest('#b-iniciar')) { accion('iniciar'); return; }
    if (e.target.closest('#b-finalizar')) { accion('finalizar'); return; }
    if (e.target.closest('#b-whatsapp')) { accion('whatsapp'); return; }
    if (e.target.closest('#b-llamar')) { accion('llamar'); return; }
    if (e.target.closest('#b-recargar')) { recargar(); return; }
    if (e.target.closest('#b-cancelar')) {
      confirmar('¿Estás seguro de cancelar la carrera?', 'La carrera de ' + ((D.carrera || {}).cliente || 'este cliente') + ' se le ofrecerá a otro conductor. Esta acción no se puede deshacer.',
        'Sí, cancelar carrera', 'No, seguir con la carrera', function () { accion('cancelar'); });
      return;
    }
    if (e.target.closest('#c-no') || e.target.id === 'confirmar') { $('#confirmar').hidden = true; U.confirmar = null; return; }
    if (e.target.closest('#c-si')) { $('#confirmar').hidden = true; var f = U.confirmar; U.confirmar = null; if (f) f(); return; }
  });
  $('#b-centrar').addEventListener('click', centrar);
  $('#b-ruta').addEventListener('click', verRuta);

  // Recarga con los 10 números
  function recargar() {
    var k = (U.codigo || '').replace(/\D/g, '');
    if (k.length !== 10) { U.msgRec = { c: 'mal', t: 'Escribe los 10 números completos.' }; render(); var i = $('#codigo'); if (i) i.classList.add('error'); return; }
    U.recargando = true; U.msgRec = null; render();
    accion('recargar', { codigo: k });
  }
  document.addEventListener('input', function (e) {
    if (e.target.id === 'codigo') { U.codigo = e.target.value.replace(/\D/g, '').slice(0, 10); e.target.value = U.codigo; e.target.classList.remove('error'); }
  });
  document.addEventListener('keydown', function (e) { if (e.target.id === 'codigo' && e.key === 'Enter') recargar(); });

  // Hoja: la rayita gris la achica o la agranda (tocar o deslizar)
  (function () {
    var y0 = null, hoja = $('#hoja');
    hoja.addEventListener('pointerdown', function (e) { if (!e.target.closest('.tirador')) return; y0 = e.clientY; });
    hoja.addEventListener('pointerup', function (e) {
      if (y0 == null) return; var dy = e.clientY - y0; y0 = null;
      if (D && D.oferta) return;
      U.mini = dy > 25 ? true : (dy < -25 ? false : !U.mini);
      pintarHoja(false); setTimeout(render, 30);
    });
  })();

  // Deslizar para conectarse / desconectarse
  (function () {
    var caja = $('#deslizar'), per = $('#perilla'), x0 = null, max = 0;
    caja.addEventListener('pointerdown', function (e) {
      x0 = e.clientX; max = caja.clientWidth - per.offsetWidth - 14; per.classList.add('arrastrando');
      try { caja.setPointerCapture(e.pointerId); } catch (er) {}
    });
    caja.addEventListener('pointermove', function (e) {
      if (x0 == null) return; var dx = Math.max(0, Math.min(max, e.clientX - x0)); per.style.left = (7 + dx) + 'px';
    });
    function soltar(e) {
      if (x0 == null) return; var dx = e.clientX - x0; x0 = null; per.classList.remove('arrastrando'); per.style.left = '7px';
      if (!D) return;
      if (dx > max * 0.8) {
        if (D.estado === 'desconectado') accion('conectar');
        else if (D.carrera) aviso('Termina tu carrera antes de desconectarte.');
        else accion('desconectar');
      } else if (Math.abs(dx) < 5) aviso('Desliza hacia la derecha.');
    }
    caja.addEventListener('pointerup', soltar);
    caja.addEventListener('pointercancel', soltar);
  })();

  // ---------- Lo que llama la app ----------
  window.AA = {
    estado: function (json) {
      try { D = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
      if (!D) return;
      $('#cargando').hidden = true;
      if (D.oferta || D.carrera) { U.menu = false; if (U.pantalla !== 'inicio') U.pantalla = 'inicio'; }
      render();
    },
    aviso: function (t) { aviso(t); },
    recarga: function (ok, msg) { U.recargando = false; U.msgRec = { c: ok ? 'ok' : 'mal', t: msg }; if (ok) U.codigo = ''; render(); },
    fin: function (json) {
      try { U.fin = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
      U.fin.estrellas = 0; U.fin.razon = ''; U.mini = false; pintarFin();
    },
    // Botón "atrás" del teléfono: true si la página lo usó
    atras: function () {
      if (!$('#confirmar').hidden) { $('#confirmar').hidden = true; U.confirmar = null; return true; }
      if (U.menu) { alternarMenu(); return true; }
      if (U.fin) return true;
      if (U.pantalla !== 'inicio' && !enViaje()) { irA('inicio'); return true; }
      return false;
    },
    cargando: function (t) { $('#cargando-txt').textContent = t; }
  };

  // Cada segundo: la cuenta regresiva de la oferta corre sola entre un estado y otro
  setInterval(function () {
    if (D && D.oferta && !D.oferta.esperandoAprobacion) {
      D.oferta.restaSeg = Math.max(0, D.oferta.restaSeg - 1);
      pintarRueda();
    }
  }, 1000);

  $('#carro').innerHTML = carroSVG('#F4F5F7');
  saludo(); setInterval(saludo, 60000);
  accion('lista');
})();
