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
  var U = { periodo: 'hoy', persDesde: '', persHasta: '', menuPeriodo: false, errRango: '', periodoMov: 'hoy', movDesde: '', movHasta: '', menuPeriodoMov: false, errRangoMov: '', pantalla: 'inicio', antesBandeja: 'inicio', menu: false, mini: false, codigo: '', msgRec: null, recargando: false, fin: null, confirmar: null, ocupadoBtn: false };

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
  var yoEl = document.createElement('div'); yoEl.className = 'yo gris'; yoEl.innerHTML = '<div class="halo"></div><div class="punto"></div><svg class="nav-ic" width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="21" fill="#fff"/><path d="M23 7 12.5 35a1 1 0 0 0 1.5 1.2L23 30.6l9 5.6a1 1 0 0 0 1.5-1.2z" fill="#1570EF"/></svg>';
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
    var alto = M.getContainer().clientHeight, gr = $('#pantalla').classList.contains('hoja-grande');
    return enViaje() ? { top: gr ? 40 : 140, bottom: Math.round(($('#hoja').offsetHeight || alto * 0.5) + 30 + (gr ? ($('#nav-pie').offsetHeight || 0) + 10 : 0)), left: 50, right: 50 } : { top: 30, bottom: 30, left: 30, right: 30 };
  }
  // Espacio libre del mapa para seguir al carro (arriba las pastillas, abajo el cuadro y la barra de minutos)
  function rellenoCarro() {
    var alto = M.getContainer().clientHeight;
    if ($('#pantalla').classList.contains('hoja-grande')) return { top: 40, bottom: Math.min(Math.round(alto * 0.72), ($('#hoja').offsetHeight || 0) + ($('#nav-pie').offsetHeight || 0) + 40), left: 40, right: 40 };
    var abajo = ($('#hoja').offsetHeight || 0) + ($('#nav-pie').offsetHeight || 0) + 40;
    return { top: Math.min(170, Math.round(alto * 0.22)), bottom: Math.min(Math.round(alto * 0.62), abajo), left: 40, right: 40 };
  }
  // El mapa gira para que el carro vaya siempre de frente (la brújula lo endereza)
  function rumboSeguir() { return NAV.girar !== false ? (NAV.rumbo || 0) : 0; }
  // Yendo a la recogida: el carro y el punto de recogida juntos, de frente
  function vistaRecogida(dur) {
    var c = D && D.carrera; if (!c || !tieneCoord(D.yo) || !tieneCoord(c.o)) return;
    var b = new maplibregl.LngLatBounds(); b.extend([D.yo.lng, D.yo.lat]); b.extend([c.o.lng, c.o.lat]);
    M.fitBounds(b, { padding: relleno(), maxZoom: 16.5, bearing: rumboSeguir(), duration: dur });
  }
  // ---------- Movimiento suave como Google Maps ----------
  // Cada ubicación nueva: el carro se desliza desde donde se ve hasta la nueva (en el tiempo que tardó en llegar);
  // si el mapa lo sigue, lo acompaña en cada cuadro: el carro queda quieto en la pantalla y el mapa se desliza.
  var SV = { de: null, a: null, t0: 0, dur: 0, ult: 0, vista: null, trans: 0, resto: null };
  function posSuave(t) {
    if (!SV.a) return null; if (!SV.de || !SV.dur) return SV.a;
    var k = Math.max(0, Math.min(1, (t - SV.t0) / SV.dur));
    return { lat: SV.de.lat + (SV.a.lat - SV.de.lat) * k, lng: SV.de.lng + (SV.a.lng - SV.de.lng) * k };
  }
  function nuevaPosSuave(p) {
    var ahora = Date.now(), visto = SV.vista || posSuave(ahora);
    if (!visto || metrosEntre(visto, p) > 400) { SV.de = null; SV.a = p; SV.dur = 0; SV.vista = p; }
    else { SV.de = visto; SV.a = p; SV.dur = SV.ult ? Math.max(250, Math.min(6000, ahora - SV.ult)) : 1000; }
    SV.t0 = ahora; SV.ult = ahora;
  }
  function siguiendo() { return !!(D && D.carrera && ((NAV.activo && NAV.sigue) || (!NAV.activo && NAV.sigueFuera))); }
  (function () {
    var orig = M.easeTo.bind(M);
    M.easeTo = function (o) {
      o = o || {};
      var dur = o.duration == null ? 500 : o.duration, fin = Date.now() + dur;
      if (o.center && SV.a && Math.abs(o.center[0] - SV.a.lng) < 1e-7 && Math.abs(o.center[1] - SV.a.lat) < 1e-7) { var pf = posSuave(fin); o = Object.assign({}, o, { center: [pf.lng, pf.lat] }); }
      SV.trans = Math.max(SV.trans, fin); SV.pCam = null;
      return orig(o);
    };
    var origF = M.fitBounds.bind(M);
    M.fitBounds = function (b, o) { var d = o && o.duration != null ? o.duration : 500; SV.trans = Math.max(SV.trans, Date.now() + d); SV.pCam = null; return origF(b, o); };
  })();
  // Con el dedo en el mapa, el mapa es tuyo: deja de seguir al carro apenas lo mueves (como en Google Maps) y no se le pelea
  (function () {
    var caja = document.getElementById('mapa').parentNode, x0 = 0, y0 = 0;   // el mapa y lo que flota encima
    function abajo(x, y) { SV.dedo = true; SV.pCam = null; x0 = x; y0 = y; }
    function mueve(x, y, varios) { if (!SV.dedo) return; if (varios || Math.abs(x - x0) + Math.abs(y - y0) > 6) { if (siguiendo()) { NAV.sigueFuera = false; NAV.autoFit = false; if (NAV.activo && NAV.sigue) { NAV.sigue = false; pintarNav(); } } } }
    function arriba() { setTimeout(function () { SV.dedo = false; }, 60); }
    caja.addEventListener('touchstart', function (e) { var t = e.touches[0]; abajo(t.clientX, t.clientY); if (e.touches.length > 1) mueve(0, 0, true); }, { passive: true });
    caja.addEventListener('touchmove', function (e) { var t = e.touches[0]; mueve(t.clientX, t.clientY, e.touches.length > 1); }, { passive: true });
    caja.addEventListener('touchend', function (e) { if (!e.touches.length) arriba(); }, { passive: true });
    caja.addEventListener('touchcancel', arriba, { passive: true });
    caja.addEventListener('mousedown', function (e) { abajo(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { mueve(e.clientX, e.clientY, false); });
    window.addEventListener('mouseup', arriba);
    caja.addEventListener('wheel', function () { if (siguiendo()) { NAV.sigueFuera = false; NAV.autoFit = false; if (NAV.activo && NAV.sigue) { NAV.sigue = false; pintarNav(); } } }, { passive: true });
  })();
  function NAV_META() { return (NAV.activo ? (NAV.rumbo || 0) : rumboSeguir()); }
  (function cuadro() {
    try {
      var ahora = Date.now(), yo = D && D.yo;
      if (tieneCoord(yo) && (!SV.a || yo.lat !== SV.a.lat || yo.lng !== SV.a.lng)) nuevaPosSuave({ lat: yo.lat, lng: yo.lng });
      var p = posSuave(ahora);
      if (p && yoMk) {
        SV.vista = p; yoMk.setLngLat([p.lng, p.lat]);
        if (SV.resto && SV.resto.length > 1 && ahora - (SV.tRuta || 0) > 160 && (!SV.pRuta || metrosEntre(SV.pRuta, p) > 1.5)) { SV.tRuta = ahora; SV.pRuta = p; SV.resto[0] = [p.lng, p.lat]; ponerRuta(SV.resto); }
        if (siguiendo() && ahora >= SV.trans && !SV.dedo && (!SV.pCam || SV.pCam.lat !== p.lat || SV.pCam.lng !== p.lng || Math.abs((((NAV_META() - (M.getBearing ? M.getBearing() : 0)) + 540) % 360) - 180) > 0.3)) {
        SV.pCam = p;
          var cur = M.getBearing ? M.getBearing() : 0, meta = NAV.activo ? (NAV.rumbo || 0) : rumboSeguir(), dif = ((meta - cur + 540) % 360) - 180;
          M.jumpTo({ center: [p.lng, p.lat], bearing: Math.abs(dif) < 0.3 ? meta : cur + dif * 0.08 });
        }
      }
    } catch (e) {}
    requestAnimationFrame(cuadro);
  })();
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
  function verRuta(dur) {
    if (NAV.activo) return;
    var c = D && (D.carrera || D.oferta); if (!c) return;
    var b = new maplibregl.LngLatBounds(), n = 0;
    [D.yo, c.o, c.d].forEach(function (p) { if (tieneCoord(p)) { b.extend([p.lng, p.lat]); n++; } });
    if (n >= 2) M.fitBounds(b, { padding: relleno(), maxZoom: 16, duration: dur || 600 });
    else centrar();
  }
  function centrar() {
    if (!D || !tieneCoord(D.yo)) { aviso('Todavía no hay señal GPS.'); return; }
    if (D.carrera) {   // en la carrera: va al carro y lo sigue de frente (hasta que muevas el mapa)
      if (NAV.activo) { NAV.sigue = true; pintarNav(); seguirNav(); M.easeTo(vistaNav(600)); return; }
      NAV.sigueFuera = true; NAV.girar = true;
      M.easeTo({ center: [D.yo.lng, D.yo.lat], bearing: rumboSeguir(), pitch: 0, zoom: 14.8, duration: 600, padding: rellenoCarro() });
      return;
    }
    M.easeTo({ center: [D.yo.lng, D.yo.lat], zoom: Math.max(M.getZoom(), 15), bearing: 0, pitch: 0, duration: 600 });
  }
  // Fuera de la navegación: sigue al carro de frente (flechita) o muestra carro y recogida juntos
  function seguirFuera() {
    var c = D && D.carrera; if (!c || NAV.activo || !tieneCoord(D.yo)) return;
    if (NAV.antF && metrosEntre(NAV.antF, D.yo) > 3) NAV.rumbo = rumboEntre(NAV.antF, D.yo);
    if (!NAV.antF || metrosEntre(NAV.antF, D.yo) > 3) NAV.antF = { lat: D.yo.lat, lng: D.yo.lng };
    if (!NAV.sigueFuera && NAV.autoFit !== false && c.estado === 'aceptada' && Date.now() - (seguirFuera.t || 0) > 900 && Date.now() >= SV.trans) { seguirFuera.t = Date.now(); vistaRecogida(900); }
  }
  function pintarMapa() {
    var yo = D && D.yo;
    if (tieneCoord(yo)) {
      if (!yoMk) yoMk = new maplibregl.Marker({ element: yoEl, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat([yo.lng, yo.lat]).addTo(M);
      if (primeraVez) { primeraVez = false; M.jumpTo({ center: [yo.lng, yo.lat], zoom: 15 }); }
    }
    yoEl.className = 'yo ' + (D && (D.estado === 'conectado' || D.carrera) ? '' : 'gris') + (NAV.activo ? ' flecha' : '');
    var c = D && (D.carrera || D.oferta);
    mkO = marcador(mkO, c && c.o, '#E5252A');
    mkD = marcador(mkD, c && c.d, '#1570EF');
    if (NAV.activo) return; // la navegación dibuja su propia ruta
    if (!c) { trazar(null, null, ''); return; }
    // Oferta: recogida → destino. Aceptada: yo → recogida. En ejecución: yo → destino.
    if (D.oferta) trazar(c.o, tieneCoord(c.d) ? c.d : null, 'o' + c.id);
    else if (c.estado === 'aceptada') trazar(yo, c.o, 'a' + c.id);
    else trazar(yo, c.d, 'e' + c.id);
  }


  // ---------- Navegación tipo GPS (como Waze / Google Maps) ----------
  var NAV = { sigue: true, margen: 45, activo: false, obj: '', ruta: null, pasos: [], paso: 0, total: 0, dur: 0, fuera: 0, recalc: false, rumbo: 0, ant: null, pedido: 0, llego: false, falta: 0, idCarrera: '' };
  var DIRS = { 'right': 'a la derecha', 'left': 'a la izquierda', 'slight right': 'ligeramente a la derecha', 'slight left': 'ligeramente a la izquierda', 'sharp right': 'cerrado a la derecha', 'sharp left': 'cerrado a la izquierda', 'straight': 'recto', 'uturn': 'en U' };
  var GIROS = { 'straight': 0, 'slight right': 35, 'right': 90, 'sharp right': 135, 'uturn': 180, 'sharp left': -135, 'left': -90, 'slight left': -35 };
  var ORD = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta'];
  function metrosEntre(a, b) { return distKm(a, b) / 1.3 * 1000; }
  function rumboEntre(a, b) {
    var r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    var x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function textoPaso(p) {
    var m = p.mod || '', d = DIRS[m] || '';
    switch (p.tipo) {
      case 'depart': return 'Avanza' + (p.nombre ? ' por ' + p.nombre : '');
      case 'arrive': return NAV.obj === 'o' ? 'Llegas a la recogida' : 'Llegas al destino';
      case 'roundabout': case 'rotary': case 'roundabout turn': case 'exit roundabout': case 'exit rotary':
        return 'En la redondela, toma la ' + (ORD[p.salida] || '') + ' salida';
      case 'continue': case 'new name': return m && m !== 'straight' ? 'Continúa ' + d : 'Continúa recto';
      case 'merge': return 'Incorpórate ' + d;
      case 'on ramp': return 'Toma la rampa ' + d;
      case 'off ramp': return 'Toma la salida ' + d;
      case 'fork': return 'En la bifurcación, mantente ' + d;
      case 'end of road': return 'Al final de la calle, gira ' + d;
      default: return m === 'uturn' ? 'Da la vuelta en U' : (m === 'straight' ? 'Sigue recto' : 'Gira ' + d);
    }
  }
  function iconoPaso(p) {
    if (p.tipo === 'arrive') return '<svg width="30" height="30" viewBox="0 0 40 52"><path d="M20 50C20 50 4 31 4 19a16 16 0 1 1 32 0c0 12-16 31-16 31z" fill="#fff"/><circle cx="20" cy="19" r="6.5" fill="#090145"/></svg>';
    if (/roundabout|rotary/.test(p.tipo)) return '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="10" r="5"/><path d="M12 15v7M17 10h4"/></svg>';
    var g = GIROS[p.mod] || 0;
    return '<svg width="30" height="30" viewBox="0 0 24 24" style="transform:rotate(' + g + 'deg)" fill="#fff"><path d="M12 2 6 9h4v13h4V9h4z"/></svg>';
  }
  function distTxt(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : (m < 50 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50) + ' m'; }
  function proyectar(pos, r) {
    var mejor = { d: 1e9, i: 0, pt: { lat: r[0][1], lng: r[0][0] } }, kx = Math.cos(pos.lat * Math.PI / 180) * 111320, ky = 110540;
    for (var i = 0; i < r.length - 1; i++) {
      var ax = (r[i][0] - pos.lng) * kx, ay = (r[i][1] - pos.lat) * ky, bx = (r[i + 1][0] - pos.lng) * kx, by = (r[i + 1][1] - pos.lat) * ky;
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      var px = ax + t * dx, py = ay + t * dy, d = Math.sqrt(px * px + py * py);
      if (d < mejor.d) mejor = { d: d, i: i, pt: { lat: r[i][1] + t * (r[i + 1][1] - r[i][1]), lng: r[i][0] + t * (r[i + 1][0] - r[i][0]) } };
    }
    return mejor;
  }
  function metaNav() { var c = D && D.carrera; return c ? (NAV.obj === 'o' ? c.o : c.d) : null; }
  function rutaNav(a, b) {
    if (!tieneCoord(a) || !tieneCoord(b)) { NAV.recalc = false; NAV.ruta = null; pintarNav(); return; }
    var pedido = ++NAV.pedido;
    NAV.recalc = true; pintarNav();
    var listoRuta = function () { NAV.paso = Math.min(1, NAV.pasos.length - 1); NAV.recalc = false; NAV.fuera = 0; NAV.fueraDesde = 0; NAV.margen = Math.min(100, Math.max(40, proyectar(D.yo, NAV.ruta).d + 25)); ponerRuta(NAV.ruta); seguirNav(); };
    var recta = function () {
      if (pedido !== NAV.pedido) return;
      NAV.ruta = [[a.lng, a.lat], [b.lng, b.lat]]; NAV.total = metrosEntre(a, b); NAV.dur = NAV.total / 7;
      NAV.pasos = [{ tipo: 'depart', loc: [a.lng, a.lat] }, { tipo: 'arrive', loc: [b.lng, b.lat] }];
      listoRuta();
    };
    fetch('https://router.project-osrm.org/route/v1/driving/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson&steps=true')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (pedido !== NAV.pedido) return;
        if (!j.routes || !j.routes[0]) { recta(); return; }
        var rt = j.routes[0];
        NAV.ruta = rt.geometry.coordinates; NAV.total = rt.distance; NAV.dur = rt.duration * 1.25;
        NAV.pasos = rt.legs[0].steps.map(function (st) { return { tipo: st.maneuver.type, mod: st.maneuver.modifier, salida: st.maneuver.exit, nombre: st.name, loc: st.maneuver.location }; });
        listoRuta();
      }).catch(recta);
  }
  function iniciarNav() {
    var c = D && D.carrera; if (!c) return;
    if (!tieneCoord(D.yo)) { aviso('Todavía no hay señal GPS.'); return; }
    NAV.activo = true; NAV.sigue = true; NAV.llego = false; NAV.obj = c.estado === 'ejecucion' ? 'd' : 'o'; NAV.ant = null; NAV.idCarrera = c.id;
    if (!tieneCoord(metaNav())) { NAV.activo = false; aviso('Esta carrera no tiene el destino en el mapa.'); return; }
    try { yoMk && yoMk.setRotationAlignment && yoMk.setRotationAlignment('map'); } catch (e) {}
    U.mini = true; NAV.sigueFuera = false;
    rutaNav(D.yo, metaNav());
    render();
    if (!NAV.rumbo) NAV.rumbo = rumboEntre(D.yo, metaNav());
    M.easeTo(vistaNav(900));   // de una sola vez: acerca, gira de frente y queda plano (mientras llega la ruta)
  }
  function salirNav() {
    if (!NAV.activo) return;
    NAV.activo = false; NAV.pedido++; R.clave = ''; SV.resto = null;
    try { yoMk && yoMk.setRotation && yoMk.setRotation(0); } catch (e) {}
    // El cuadro de abajo se queda del tamaño en que lo dejaste; el mapa sigue al carro de frente
    render();
    if (D && D.carrera && tieneCoord(D.yo)) { NAV.sigueFuera = true; NAV.girar = true; NAV.antF = null; M.easeTo({ center: [D.yo.lng, D.yo.lat], bearing: rumboSeguir(), pitch: 0, zoom: 14.8, duration: 600, padding: rellenoCarro() }); }
    else { M.easeTo({ pitch: 0, bearing: 0, duration: 600 }); setTimeout(verRuta, 650); }
  }
  // Cada ubicación nueva: avanza las instrucciones, recorta la ruta y recalcula si te sales
  function seguirNav() {
    if (!NAV.activo || !NAV.ruta || !D || !tieneCoord(D.yo)) { pintarNav(); return; }
    var pos = D.yo;
    if (NAV.ant && metrosEntre(NAV.ant, pos) > 3) NAV.rumbo = rumboEntre(NAV.ant, pos);
    var movio = !NAV.ant || metrosEntre(NAV.ant, pos) > 0.5;
    NAV.ant = { lat: pos.lat, lng: pos.lng };
    var pr = proyectar(pos, NAV.ruta);
    if (!NAV.recalc && movio) {
      // Te saliste de la ruta: recalcula rápido (1,5 s fuera, o enseguida si ya vas lejos), como Google Maps
      if (pr.d > NAV.margen) { if (!NAV.fueraDesde) NAV.fueraDesde = Date.now(); if (Date.now() - NAV.fueraDesde >= 1500 || pr.d > NAV.margen + 60) { NAV.fueraDesde = 0; rutaNav(pos, metaNav()); return; } }
      else { NAV.fueraDesde = 0; NAV.fuera = 0; if (pr.d < 40) NAV.margen = 40; }
    }
    if (NAV.rumbo === 0 && pr.i < NAV.ruta.length - 1) NAV.rumbo = rumboEntre(pos, { lat: NAV.ruta[pr.i + 1][1], lng: NAV.ruta[pr.i + 1][0] });
    // Hacia dónde va: la dirección de la calle unos 25 m más adelante en la ruta (no salta de lado en las esquinas ni con el GPS)
    if (pr.d < 30) {
      var ad = { lat: pr.pt.lat, lng: pr.pt.lng }, falta25 = 25;
      for (var q = pr.i + 1; q < NAV.ruta.length && falta25 > 0; q++) {
        var nx = { lat: NAV.ruta[q][1], lng: NAV.ruta[q][0] }, dq = metrosEntre(ad, nx);
        if (dq >= falta25) { var fq = falta25 / dq; ad = { lat: ad.lat + (nx.lat - ad.lat) * fq, lng: ad.lng + (nx.lng - ad.lng) * fq }; falta25 = 0; } else { ad = nx; falta25 -= dq; }
      }
      if (metrosEntre(pos, ad) > 3) NAV.rumbo = rumboEntre(pr.pt, ad);
    }
    var resto = [[pos.lng, pos.lat]].concat(NAV.ruta.slice(pr.i + 1));
    SV.resto = resto.slice(); ponerRuta(SV.resto.map(function (c, i) { return i === 0 && SV.vista ? [SV.vista.lng, SV.vista.lat] : c; }));
    var falta = 0; for (var k = 0; k < resto.length - 1; k++) falta += metrosEntre({ lat: resto[k][1], lng: resto[k][0] }, { lat: resto[k + 1][1], lng: resto[k + 1][0] });
    NAV.falta = falta;
    while (NAV.paso < NAV.pasos.length - 1 && metrosEntre(pos, { lat: NAV.pasos[NAV.paso].loc[1], lng: NAV.pasos[NAV.paso].loc[0] }) < 20) NAV.paso++;
    NAV.llego = falta < 50;
    try { yoMk && yoMk.setRotation && yoMk.setRotation(NAV.sigue && M.getBearing ? M.getBearing() : NAV.rumbo); } catch (e) {}
    // Siguiendo: el mapa gira para que la flecha vaya siempre hacia adelante, plano (sin inclinarse); al entrar acerca una vez
    if (NAV.sigue && Date.now() >= SV.trans && (Math.abs(M.getZoom() - vistaNav(0).zoom) > 0.05 || (M.getPitch && M.getPitch() > 1))) M.easeTo(vistaNav(900));   // nunca corta un movimiento que ya está en camino
    pintarNav();
  }
  // Cámara de la navegación: con el cuadro abierto se aleja un poco (15.5) para ver avanzar la flecha
  function vistaNav(dur) {
    var gr = $('#pantalla').classList.contains('hoja-grande');
    return { center: [D.yo.lng, D.yo.lat], bearing: NAV.rumbo, pitch: 0, zoom: gr ? 15.5 : 17, duration: dur,
      padding: { top: gr ? 100 : 200, bottom: ($('#hoja').offsetHeight || 200) + 90, left: 20, right: 20 } };
  }
  function pintarNav() {
    var p = $('#pantalla'), c = D && D.carrera;
    p.classList.toggle('navegando', NAV.activo);
    p.classList.toggle('con-carrera', !!c && !NAV.activo);
    p.classList.toggle('hoja-grande', !!c && !$('#hoja').classList.contains('mini'));
    p.classList.toggle('taxi-on', !!(c && c.estado === 'ejecucion'));
    yoEl.classList.toggle('flecha', NAV.activo);
    var bc = $('#nav-centrar');
    if (!NAV.activo) {
      bc.hidden = true;
      if (c) { // Antes de iniciar: minutos, km y hora de llegada, con Iniciar a la derecha
        var km = kmMin(D.yo, c.estado === 'ejecucion' ? c.d : c.o);
        if (km) {
          var lg = new Date(Date.now() + km.min * 60000);
          $('#nav-min').textContent = km.min + ' min';
          $('#nav-info').textContent = km.km.toFixed(1) + ' km · llegada ' + lg.getHours() + ':' + String(lg.getMinutes()).padStart(2, '0') + ' · ' + (c.estado === 'ejecucion' ? 'al destino' : 'a la recogida');
        } else { $('#nav-min').textContent = '—'; $('#nav-info').textContent = c.estado === 'ejecucion' ? 'Destino: pregunta al pasajero' : 'Sin GPS'; }
        $('#nav-pie').style.bottom = (($('#hoja').offsetHeight || 0) + 10) + 'px';
      }
      return;
    }
    var top = $('#nav-top');
    top.classList.toggle('recalc', NAV.recalc); top.classList.toggle('llego', !NAV.recalc && NAV.llego);
    if (NAV.recalc) { $('#nav-ic').innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>'; $('#nav-dist').textContent = ''; $('#nav-txt').textContent = 'Recalculando ruta…'; $('#nav-calle').textContent = ''; }
    else if (NAV.llego) { $('#nav-ic').innerHTML = iconoPaso({ tipo: 'arrive' }); $('#nav-dist').textContent = ''; $('#nav-txt').textContent = NAV.obj === 'o' ? 'Llegaste a la recogida' : 'Llegaste al destino'; $('#nav-calle').textContent = (metaNav() || {}).dir || ''; }
    else {
      var ps = NAV.pasos[NAV.paso] || { tipo: 'arrive' };
      var dm = ps.loc && tieneCoord(D.yo) ? metrosEntre(D.yo, { lat: ps.loc[1], lng: ps.loc[0] }) : NAV.falta;
      $('#nav-ic').innerHTML = iconoPaso(ps);
      $('#nav-dist').textContent = distTxt(dm);
      $('#nav-txt').textContent = textoPaso(ps);
      $('#nav-calle').textContent = ps.tipo === 'arrive' ? ((metaNav() || {}).dir || '') : (ps.nombre ? 'por ' + ps.nombre : '');
    }
    var falta = NAV.falta || 0, min = Math.max(1, Math.round(NAV.total ? NAV.dur * falta / NAV.total / 60 : falta / 7 / 60));
    var llegada = new Date(Date.now() + min * 60000);
    $('#nav-min').textContent = min + ' min';
    $('#nav-info').textContent = distTxt(falta) + ' · llegada ' + llegada.getHours() + ':' + String(llegada.getMinutes()).padStart(2, '0') + ' · ' + (NAV.obj === 'o' ? 'a la recogida' : 'al destino');
    $('#nav-pie').style.bottom = (($('#hoja').offsetHeight || 0) + 10) + 'px';
    bc.hidden = NAV.sigue;
    bc.style.bottom = (($('#hoja').offsetHeight || 0) + ($('#nav-pie').offsetHeight || 0) + 22) + 'px';
  }
  // Si mueves o acercas el mapa con los dedos, deja de seguirte hasta que toques "Centrar"
  function dejarDeSeguir(e) {
    if (!e || !e.originalEvent) return;
    NAV.sigueFuera = false; NAV.autoFit = false;
    if (NAV.activo && NAV.sigue) { NAV.sigue = false; pintarNav(); }
  }
  // Centrado: mientras el mapa gira con el carro, la flecha queda siempre derechita hacia arriba
  try { M.on('move', function () { if (NAV.activo && NAV.sigue && yoMk) { try { yoMk.setRotation(M.getBearing()); } catch (e) {} } }); } catch (er) {}
  // Gestos con dos dedos (girar e inclinar) y brújula, como la app del cliente
  try { M.touchZoomRotate.enableRotation(); M.touchPitch.enable(); M.dragRotate.enable(); } catch (e) {}
  function pintarBrujula() {
    var b = $('#b-brujula'); if (!b) return;
    var br = M.getBearing ? M.getBearing() : 0, pt = M.getPitch ? M.getPitch() : 0;
    b.hidden = Math.abs(br) < 1 && pt < 1;
    $('#brujula-aguja').style.transform = 'rotate(' + (-br) + 'deg)';
    b.style.bottom = (parseFloat($('#b-centrar').style.bottom || '16') + 58) + 'px';
  }
  try { M.on('rotate', pintarBrujula); M.on('pitch', pintarBrujula); M.on('moveend', pintarBrujula); } catch (e) {}
  $('#b-brujula').addEventListener('click', function () { NAV.girar = false; M.easeTo({ bearing: 0, pitch: 0, duration: 500 }); });
  ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(function (ev) { try { M.on(ev, dejarDeSeguir); } catch (er) {} });
  $('#nav-centrar').addEventListener('click', function () { NAV.sigue = true; pintarNav(); seguirNav(); if (D && tieneCoord(D.yo)) M.easeTo(vistaNav(600)); });   // vuelve suave al carro
  $('#b-nav').addEventListener('click', iniciarNav);
  $('#nav-salir').addEventListener('click', salirNav);
  // Con cada estado nuevo de la app
  function alEstadoNav() {
    var c = D && D.carrera;
    if (NAV.activo && (!c || c.id !== NAV.idCarrera)) { salirNav(); return; }
    if (NAV.activo && NAV.obj === 'o' && c.estado === 'ejecucion') { NAV.obj = 'd'; NAV.llego = false; rutaNav(D.yo, metaNav()); return; } // pasó a ir al destino
    if (NAV.activo && !NAV.recalc) seguirNav(); else pintarNav();
    seguirFuera();
    if (c) { var px = ($('#hoja').offsetHeight || 0) + ($('#nav-pie').offsetHeight || 0) + 22, cabe = $('#pantalla').clientHeight - px > 120; $('#b-brujula').style.bottom = (px + 58) + 'px'; $('#b-centrar').style.bottom = $('#b-ruta').style.bottom = px + 'px'; $('#b-centrar').style.visibility = $('#b-ruta').style.visibility = cabe ? '' : 'hidden'; } else { $('#b-centrar').style.visibility = $('#b-ruta').style.visibility = ''; }
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

  var ultimaHoja = '', tocando = false, ANIM_HOJA = { activa: false };
  var GPS_LOCAL = { lat: 0, lng: 0, t: 0 };
  function pintarHoja(forzar) {
    if (!D) return;
    var html = D.oferta ? hojaOferta(D.oferta) : (D.carrera ? hojaCarrera(D.carrera) : '');
    // No se cambia la hoja mientras el dedo está encima (así no se pierde el toque en un botón)
    if ((forzar || html !== ultimaHoja) && (!tocando || !html)) { $('#hoja').innerHTML = html; ultimaHoja = html; }
    if (!ANIM_HOJA.activa) $('#hoja').classList.toggle('mini', !!U.mini && !D.oferta);
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

  // ---------- Historial (carreras finalizadas y recargas de los últimos 60 días) ----------
  // La app nueva lo manda con AA.historial(); con la app anterior se usa solo lo de hoy.
  var HIST = null;
  function carrerasHist() {
    if (HIST && HIST.carreras) return HIST.carreras;
    var ahora = Date.now();
    return (D.hechas || []).map(function (h) { return { t: h.t || ahora, cliente: h.cliente, o: h.o, d: h.d, cobradoC: h.cobradoC || 0, comC: h.comC || 0, metros: h.metros || 0 }; });
  }
  function movsHist() {
    if (HIST && HIST.carreras) {
      var l = HIST.carreras.filter(function (h) { return h.comC > 0; }).map(function (h) { return { tipo: 'menos', montoC: h.comC, texto: 'Comisión carrera' + (h.numero ? ' #' + h.numero : ''), det: h.o || '', t: h.t }; });
      (HIST.recargas || []).forEach(function (r) { l.push({ tipo: 'mas', montoC: r.montoC, texto: 'Recarga', det: 'Recarga ' + (r.codigo || ''), t: r.t }); });
      return l;
    }
    var ahora = Date.now();
    return (D.movs || []).map(function (m) { return { tipo: m.tipo, montoC: m.montoC, texto: m.texto, det: m.det, t: m.t || ahora }; });
  }
  function inicioDia(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function leerFecha(v) { var p = v.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); }
  function fechaCorta(ms) { var d = new Date(ms); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); }
  function fechaInput(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function horaDe(ms) { var d = new Date(ms); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  // [desde, hasta, texto del botón, esHoy] para hoy / 7 / 30 / personalizado
  function rangoDe(periodo, desde, hasta, textoHoy) {
    var hoy0 = inicioDia(Date.now()), fin = hoy0 + 86400000 - 1;
    if (periodo === '7') return [hoy0 - 6 * 86400000, fin, 'Últimos 7 días', false];
    if (periodo === '30') return [hoy0 - 29 * 86400000, fin, 'Últimos 30 días', false];
    if (periodo === 'pers' && desde && hasta) {
      var a = leerFecha(desde), b = leerFecha(hasta) + 86400000 - 1;
      return [a, b, 'Del ' + fechaCorta(a) + ' al ' + fechaCorta(b), false];
    }
    return [hoy0, fin, textoHoy, true];
  }
  var FLECHA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';
  function opciones(atributo, actual, textoHoy) {
    return '<div class="periodos">' + [['hoy', textoHoy], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['pers', 'Personalizado']].map(function (x) {
      return '<button ' + atributo + '="' + x[0] + '" class="' + (actual === x[0] ? 'sel' : '') + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function cuadroFechas(idDesde, idHasta, desde, hasta, idBoton, textoBoton, error) {
    var max = fechaInput(Date.now());
    return '<div class="rango' + (idDesde === 'mov-desde' ? ' mov-rango' : '') + '"><div class="f"><label>Desde<input type="date" id="' + idDesde + '" value="' + esc(desde) + '" max="' + max + '"></label>' +
      '<label>Hasta<input type="date" id="' + idHasta + '" value="' + esc(hasta) + '" max="' + max + '"></label></div>' +
      '<button class="btn-azul" id="' + idBoton + '">' + textoBoton + '</button>' + (error ? '<div class="err">' + esc(error) + '</div>' : '') + '</div>';
  }

  // Mis recargas: movimientos (recargas y comisiones) del período elegido
  function movimientosHTML() {
    var rm = rangoDe(U.periodoMov, U.movDesde, U.movHasta, 'Movimientos de hoy'), esHoy = rm[3];
    var lista = movsHist().filter(function (m) { return m.t >= rm[0] && m.t <= rm[1]; }).sort(function (a, b) { return b.t - a.t; });
    var filas = lista.slice(0, 80).map(function (m) {
      return '<div class="mov ' + m.tipo + '"><span class="ic">' + (m.tipo === 'mas'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 11l1.6-4.3A2 2 0 0 1 8.5 5.4h7a2 2 0 0 1 1.9 1.3L19 11a2 2 0 0 1 1 1.7V17a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.3A2 2 0 0 1 5 11zm2.2-.3h9.6l-1.1-3.1a.5.5 0 0 0-.5-.3H8.8a.5.5 0 0 0-.5.3z"/></svg>') +
        '</span><div class="t"><b>' + esc(m.texto) + '</b><small>' + esc(m.det) + ' · ' + (esHoy ? horaDe(m.t) : fechaCorta(m.t) + ' ' + horaDe(m.t)) + '</small></div><div class="m">' + (m.tipo === 'mas' ? '+' : '−') + dineroC(m.montoC) + '</div></div>';
    }).join('');
    var cab = '<div class="movs-cab"><button class="periodo-mov' + (U.menuPeriodoMov ? ' abierto' : '') + '" id="b-periodo-mov">' + esc(rm[2]) + FLECHA + '</button>' +
      '<span class="cuenta">' + lista.length + ' movimiento' + (lista.length === 1 ? '' : 's') + '</span>' +
      (U.menuPeriodoMov ? opciones('data-periodo-mov', U.periodoMov, 'Movimientos de hoy') : '') + '</div>';
    var fechas = U.periodoMov === 'pers' ? cuadroFechas('mov-desde', 'mov-hasta', U.movDesde, U.movHasta, 'b-rango-mov', 'Ver movimientos', U.errRangoMov) : '';
    return '<div class="movs">' + cab + fechas + (filas || '<div class="vacio">' + (esHoy ? 'Todavía no tienes movimientos hoy.' : 'No hay movimientos en esas fechas.') + '</div>') + '</div>';
  }

  // Mi billetera: ganancia neta (cobrado menos la comisión de AutoAmigo) del período elegido
  function billeteraHTML() {
    var r = rangoDe(U.periodo, U.persDesde, U.persHasta, 'Ganancias de hoy'), esHoy = r[3];
    var todas = carrerasHist();
    var lista = todas.filter(function (h) { return h.t >= r[0] && h.t <= r[1]; }).sort(function (a, b) { return b.t - a.t; });
    var cobrado = 0, com = 0, metros = 0;
    lista.forEach(function (h) { cobrado += h.cobradoC; com += h.comC; metros += h.metros || 0; });
    var ganancia = cobrado - com, n = lista.length;
    var tarjeta = '<div class="saldo-card"><button class="periodo-btn' + (U.menuPeriodo ? ' abierto' : '') + '" id="b-periodo">' + esc(r[2]) + FLECHA + '</button>' +
      (U.menuPeriodo ? opciones('data-periodo', U.periodo, 'Ganancias de hoy') : '') +
      '<div class="monto" style="margin-top:8px">' + dineroC(ganancia) + '</div>' +
      '<div class="sub tres"><div><b>' + dineroC(com) + '</b><span>Comisión pagada</span></div><div><b>' + n + '</b><span>' + (esHoy ? 'Carreras hoy' : 'Carreras') + '</span></div>' +
      '<div><b>' + (metros / 1000).toFixed(1) + ' km</b><span>Recorridos</span></div></div></div>';
    var fechas = U.periodo === 'pers' ? cuadroFechas('pers-desde', 'pers-hasta', U.persDesde, U.persHasta, 'b-rango', 'Ver ganancias', U.errRango) : '';
    // Gráfico: la semana actual, de lunes a domingo
    var hoy0 = inicioDia(Date.now()), dHoy = new Date().getDay(), desdeLunes = (dHoy + 6) % 7, lunes = hoy0 - desdeLunes * 86400000, vals = [];
    for (var i = 0; i < 7; i++) {
      var a = lunes + i * 86400000, b = a + 86400000;
      vals.push(i > desdeLunes ? 0 : todas.reduce(function (t, h) { return h.t >= a && h.t < b ? t + h.cobradoC - h.comC : t; }, 0));
    }
    var max = Math.max.apply(null, vals.concat([1])), total = vals.reduce(function (x, y) { return x + y; }, 0);
    var LETRAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    var barras = vals.map(function (v, i) {
      var esH = i === desdeLunes;
      return '<div class="d' + (esH ? ' hoy' : '') + '"><span class="v">' + (v ? '$' + Math.round(v / 100) : '') + '</span><div class="b" style="height:' + Math.max(3, Math.round(v / max * 92)) + '%"></div><span class="l">' + (esH ? 'Hoy' : LETRAS[i]) + '</span></div>';
    }).join('');
    var semana = '<div class="bloque"><h3>Últimos 7 días <small>ganancia neta</small></h3><div class="semana-total">' + dineroC(total) + '</div><div class="barras">' + barras + '</div></div>';
    var filas = lista.slice(0, 60).map(function (h) {
      return '<div class="gan"><span class="h">' + (esHoy ? horaDe(h.t) : fechaCorta(h.t) + '<br><small style="font-weight:600;color:var(--gris)">' + horaDe(h.t) + '</small>') + '</span><div class="t"><b>' + esc(h.cliente) + '</b><small>' + esc(h.o || '—') + ' → ' + esc(h.d || '—') + '</small></div>' +
        '<div class="m"><b>+' + dineroC(h.cobradoC - h.comC) + '</b><small>cobró ' + dineroC(h.cobradoC) + ' · com. ' + dineroC(h.comC) + '</small></div></div>';
    }).join('');
    var carreras = '<div class="bloque"><h3>' + (esHoy ? 'Ganancias de hoy' : 'Ganancias por carrera') + ' <small>' + n + ' carrera' + (n === 1 ? '' : 's') + '</small></h3>' +
      (filas || '<div class="vacio" style="padding:14px">' + (esHoy ? 'Cuando termines una carrera, aquí verás cuánto ganaste en cada una.' : 'No hay carreras en esas fechas.') + '</div>') + '</div>';
    return tarjeta + fechas + semana + carreras;
  }
  function fechaInputHoy(desplazaDias) { var d = new Date(); d.setDate(d.getDate() + desplazaDias); return fechaInput(d.getTime()); }

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
    if (p === 'recargas') {
      var bajo = D.saldoC < D.minimoC
        ? '<div class="bajo"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z"/></svg>Sin saldo no te llegan carreras. Recarga para seguir trabajando.</div>' : '';
      var msg = U.msgRec ? '<div class="msg-rec ' + U.msgRec.c + '">' + esc(U.msgRec.t) + '</div>' : '';
      return '<h2>Mis recargas</h2>' +
        '<div class="saldo-card"><small>Disponible</small><div class="monto">' + dineroC(D.saldoC) + '</div>' +
        '<div class="sub"><div><b>' + dineroC(D.consumidoHoyC) + '</b><span>Comisión pagada</span></div><div><b>' + D.carrerasHoy + '</b><span>Carreras hoy</span></div></div></div>' + bajo +
        '<div class="recargar"><h3>Recargar</h3><p>Escribe los 10 números de recarga que te dio la central de AutoAmigo.</p>' +
        '<input class="codigo" id="codigo" maxlength="10" inputmode="numeric" pattern="[0-9]*" autocomplete="off" spellcheck="false" placeholder="Números" value="' + esc(U.codigo) + '">' +
        '<button class="btn-azul" id="b-recargar"' + (U.recargando ? ' disabled' : '') + '>' + (U.recargando ? 'Verificando…' : 'Recargar') + '</button>' + msg + '</div>' +
        movimientosHTML();
    }
    if (p === 'billetera') return '<h2>Mi billetera</h2>' + billeteraHTML();
    if (p === 'perfil' && window.AAPerfil && D.ficha !== undefined) return AAPerfil.html(D) + (D.version ? '<p style="text-align:center;color:var(--gris);font-size:12.5px;margin-top:14px">Versión ' + esc(D.version) + '</p>' : '');
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
    if (D.carrera && render.enfoque !== D.carrera.id + D.carrera.estado) {
      render.enfoque = D.carrera.id + D.carrera.estado;
      var cc = D.carrera;
      if (cc.estado === 'aceptada') {   // yendo a la recogida: carro y punto juntos, de frente
        NAV.autoFit = true; NAV.girar = true; NAV.sigueFuera = false; NAV.antF = null;
        if (tieneCoord(D.yo) && tieneCoord(cc.o) && distKm(D.yo, cc.o) > 0.003) NAV.rumbo = rumboEntre(D.yo, cc.o);
        setTimeout(function () { vistaRecogida(600); }, 80);
      } else if (cc.estado === 'ejecucion' && !NAV.activo && tieneCoord(D.yo)) {   // taxímetro: sigue al carro de frente
        if (tieneCoord(cc.d) && distKm(D.yo, cc.d) > 0.003) NAV.rumbo = rumboEntre(D.yo, cc.d);
        NAV.sigueFuera = true; NAV.girar = true;
        setTimeout(function () { M.easeTo({ center: [D.yo.lng, D.yo.lat], bearing: rumboSeguir(), pitch: 0, zoom: 14.8, duration: 1000, padding: rellenoCarro() }); }, 80);
      } else setTimeout(verRuta, 80);
    }
    if (!D.carrera) { if (render.enfoque) { NAV.sigueFuera = false; NAV.autoFit = false; SV.resto = null; } render.enfoque = ''; }
    alEstadoNav();
    pintarRed();
  }

  // ---------- Aviso "Sin internet" (arriba, en todas las pantallas) ----------
  var avisoRed = document.createElement('div');
  avisoRed.id = 'sin-internet';
  (function () { var st = document.createElement('style'); st.textContent = 'body.sin-red .btn-cancelar{display:none!important}'; document.head.appendChild(st); })();
  avisoRed.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);top:8px;z-index:95;background:#B42318;color:#fff;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;box-shadow:0 6px 16px rgba(0,0,0,.3);white-space:nowrap;display:none';
  $('#pantalla').appendChild(avisoRed);
  function pintarRed() {
    var sin = (D && D.sinInternet) || navigator.onLine === false;
    avisoRed.style.display = 'none';
    document.body.classList.toggle('sin-red', !!sin);
    if (sin) avisoRed.textContent = (D && D.carrera) ? 'Sin internet · la carrera sigue y se guarda' : 'Sin internet · no te llegarán carreras';
  }
  window.addEventListener('online', pintarRed); window.addEventListener('offline', pintarRed);

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
      (f.sinInternet ? '<div class="nota-min" style="background:#FEF3F2;color:#B42318">Sin internet: la carrera quedó guardada en tu teléfono y se enviará sola al volver la señal.</div>' : '') +
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
    // Período de Mi billetera
    if (e.target.closest('#b-periodo')) { U.menuPeriodo = !U.menuPeriodo; render(); return; }
    var per = e.target.closest('[data-periodo]');
    if (per) {
      U.periodo = per.getAttribute('data-periodo'); U.menuPeriodo = false; U.errRango = '';
      if (U.periodo === 'pers' && !U.persDesde) { U.persHasta = fechaInputHoy(0); U.persDesde = fechaInputHoy(-14); }
      render(); return;
    }
    if (e.target.closest('#b-rango')) {
      var de = $('#pers-desde').value, ha = $('#pers-hasta').value;
      if (!de || !ha) { U.errRango = 'Elige las dos fechas.'; render(); return; }
      if (de > ha) { U.errRango = 'La fecha "Desde" debe ser antes que "Hasta".'; render(); return; }
      U.persDesde = de; U.persHasta = ha; U.errRango = ''; render(); return;
    }
    // Período de los movimientos en Mis recargas
    if (e.target.closest('#b-periodo-mov')) { U.menuPeriodoMov = !U.menuPeriodoMov; render(); setTimeout(function () { var m = $('.movs-cab .periodos'); if (m) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30); return; }
    var pm = e.target.closest('[data-periodo-mov]');
    if (pm) {
      U.periodoMov = pm.getAttribute('data-periodo-mov'); U.menuPeriodoMov = false; U.errRangoMov = '';
      if (U.periodoMov === 'pers' && !U.movDesde) { U.movHasta = fechaInputHoy(0); U.movDesde = fechaInputHoy(-14); }
      render(); return;
    }
    if (e.target.closest('#b-rango-mov')) {
      var md = $('#mov-desde').value, mh = $('#mov-hasta').value;
      if (!md || !mh) { U.errRangoMov = 'Elige las dos fechas.'; render(); return; }
      if (md > mh) { U.errRangoMov = 'La fecha "Desde" debe ser antes que "Hasta".'; render(); return; }
      U.movDesde = md; U.movHasta = mh; U.errRangoMov = ''; render(); return;
    }
    if (U.menuPeriodo && !e.target.closest('.saldo-card .periodos')) { U.menuPeriodo = false; render(); }
    if (U.menuPeriodoMov && !e.target.closest('.movs-cab .periodos')) { U.menuPeriodoMov = false; render(); }
    if (e.target.closest('#b-cancelar')) {
      if ((D && D.sinInternet) || navigator.onLine === false) { aviso('Sin internet no se puede cancelar la carrera. Llama a la central.'); return; }
      confirmar('¿Estás seguro de cancelar la carrera?', 'La carrera de ' + ((D.carrera || {}).cliente || 'este cliente') + ' se le ofrecerá a otro conductor. Esta acción no se puede deshacer.',
        'Sí, cancelar carrera', 'No, seguir con la carrera', function () { accion('cancelar'); });
      return;
    }
    if (e.target.closest('#c-no') || e.target.id === 'confirmar') { $('#confirmar').hidden = true; U.confirmar = null; return; }
    if (e.target.closest('#c-si')) { $('#confirmar').hidden = true; var f = U.confirmar; U.confirmar = null; if (f) f(); return; }
  });
  $('#b-centrar').addEventListener('click', centrar);
  $('#b-ruta').addEventListener('click', function () { NAV.sigueFuera = false; NAV.autoFit = false; verRuta(); });

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
  // Flechita, brújula y tarjeta Iniciar/Salir pegadas al borde del cuadro
  function posBotones() {
    var h = $('#hoja').offsetHeight || 0, pie = $('#nav-pie');
    pie.style.bottom = (h + 10) + 'px';
    var px = D && D.carrera ? h + (pie.offsetHeight || 0) + 22 : h + 16;
    $('#b-centrar').style.bottom = $('#b-ruta').style.bottom = px + 'px';
    $('#b-brujula').style.bottom = (px + 58) + 'px';
    $('#nav-centrar').style.bottom = (h + (pie.offsetHeight || 0) + 22) + 'px';
  }
  (function () {
    var y0 = null, hoja = $('#hoja'), rafB = 0, finB = 0;
    function pegarBotones(ms) {
      finB = Date.now() + ms;
      if (rafB) return;
      (function paso() { posBotones(); if (Date.now() < finB) rafB = requestAnimationFrame(paso); else { rafB = 0; ANIM_HOJA.activa = false; render(); posBotones(); } })();
    }
    // El mapa se mueve con calma (1 s) a la vez que el cuadro
    function moverMapa() {
      var c = D && D.carrera; if (!c || !tieneCoord(D.yo)) return;
      if (NAV.activo) { if (NAV.sigue && NAV.ruta) M.easeTo(vistaNav(1000)); return; }
      if (NAV.sigueFuera) M.easeTo({ center: [D.yo.lng, D.yo.lat], bearing: rumboSeguir(), duration: 1000, padding: rellenoCarro() });
      else if (c.estado === 'aceptada') { NAV.autoFit = true; vistaRecogida(1000); }
      else verRuta(1000);
    }
    // Sube o baja deslizándose (0,45 s)
    function animar(mini) {
      var antes = hoja.offsetHeight;
      U.mini = mini; hoja.classList.toggle('mini', mini); render();
      ANIM_HOJA.activa = true;
      var despues = hoja.offsetHeight;
      hoja.style.transition = 'none'; hoja.style.height = antes + 'px'; hoja.style.overflow = 'hidden';
      void hoja.offsetHeight;
      hoja.style.transition = 'height .45s cubic-bezier(.2,.8,.2,1)'; hoja.style.height = despues + 'px';
      pegarBotones(500);
      setTimeout(function () { hoja.style.transition = ''; hoja.style.height = ''; hoja.style.overflow = ''; posBotones(); }, 500);
      moverMapa();
    }
    hoja.addEventListener('pointerdown', function (e) { if (!e.target.closest('.tirador')) return; y0 = e.clientY; });
    hoja.addEventListener('pointerup', function (e) {
      if (y0 == null) return; var dy = e.clientY - y0; y0 = null;
      if (D && D.oferta) return;
      var mini = dy > 25 ? true : (dy < -25 ? false : !U.mini);
      if (mini === !!U.mini) return;
      if (D && D.carrera) { animar(mini); return; }
      U.mini = mini; pintarHoja(false); setTimeout(render, 30);
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
      if (GPS_LOCAL.t && Date.now() - GPS_LOCAL.t < 15000) D.yo = { lat: GPS_LOCAL.lat, lng: GPS_LOCAL.lng };   // el GPS del teléfono manda sobre el de la central
      $('#cargando').hidden = true;
      if (window.AATurno) AATurno.estado(D);
      if (window.AAPerfil) AAPerfil.estado(D);
      if (D.oferta || D.carrera) { U.menu = false; if (U.pantalla !== 'inicio') U.pantalla = 'inicio'; }
      render();
    },
    historial: function (json) {
      try { HIST = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
      render();
    },
    // GPS del teléfono en tiempo real (cada segundo): la navegación no espera a la central
    gps: function (lat, lng) {
      if (!D || typeof lat !== 'number' || typeof lng !== 'number') return;
      GPS_LOCAL = { lat: lat, lng: lng, t: Date.now() };
      D.yo = { lat: lat, lng: lng };
      if (!yoMk) pintarMapa();
      if (NAV.activo && !NAV.recalc) seguirNav(); else pintarNav();
      seguirFuera();
    },
    aviso: function (t) { aviso(t); },
    recarga: function (ok, msg) { U.recargando = false; U.msgRec = { c: ok ? 'ok' : 'mal', t: msg }; if (ok) U.codigo = ''; render(); },
    fin: function (json) {
      try { U.fin = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
      U.fin.estrellas = 0; U.fin.razon = ''; U.mini = false; pintarFin();
    },
    // Botón "atrás" del teléfono: true si la página lo usó
    atras: function () {
      if (window.AATurno && AATurno.atras()) return true;
      if (window.AAPerfil && AAPerfil.atras()) return true;
      if (!$('#confirmar').hidden) { $('#confirmar').hidden = true; U.confirmar = null; return true; }
      if (U.menu) { alternarMenu(); return true; }
      if (U.fin) return true;
      if (U.pantalla !== 'inicio' && !enViaje()) { irA('inicio'); return true; }
      return false;
    },
    cargando: function (t) { $('#cargando-txt').textContent = t; },
    // Verificación del turno (turno.js)
    abrirTurno: function () { if (window.AATurno) AATurno.abrir(); },
    turnoRespuesta: function (json) { if (window.AATurno) AATurno.respuesta(json); },
    // Mi perfil (perfil.js)
    fichaFotos: function (json) { if (window.AAPerfil) AAPerfil.fotos(json); },
    fotoPerfil: function (url) { if (window.AAPerfil) AAPerfil.fotoPerfil(url); },
    perfilRespuesta: function (tipo, json) { if (window.AAPerfil) AAPerfil.respuesta(tipo, json); }
  };
  window.AARender = function () { ultimaSec = ''; render(); };
  window.AAIr = function (p) { irA(p); };

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
