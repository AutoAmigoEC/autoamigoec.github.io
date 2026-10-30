/* AutoAmigo · Mapas estilo Google (MapLibre + OpenFreeMap, gratis y sin clave)
 * De día de 6:00 a 17:59 y de noche de 18:00 a 5:59, según la hora de la
 * computadora que abre el panel. Cambia solo, sin recargar.
 */
(function () {
  var ESTILO = 'https://tiles.openfreemap.org/styles/liberty';
  var DIA = { fondo: '#F3F1ED', agua: '#9CD0F5', parque: '#C3E6C0', edificio: '#E8E4DE', calle: '#FFFFFF', avenida: '#CED2D8', autopista: '#CED2D8', borde: '#DADADA', texto: '#3C4043', halo: '#FFFFFF', textoAgua: '#4A7FB0', lugar: '#5F6673' };
  var NOCHE = { fondo: '#242F3E', agua: '#17263C', parque: '#263C3F', edificio: '#2B3544', calle: '#38414E', avenida: '#6B7380', autopista: '#6B7380', borde: '#212A37', texto: '#C9CDD3', halo: '#1F2835', textoAgua: '#5B7FA6', lugar: '#AEB4BE' };
  var COLORES = { libre: '#0E9F6E', aceptada: '#1E6FE8', ejecucion: '#6927DA', sinsaldo: '#7A1F2B', fuera: '#8A94A6' };

  var modoForzado = null; // solo para pruebas: 'dia' | 'noche'
  function esNoche() { if (modoForzado) return modoForzado === 'noche'; var h = new Date().getHours(); return h >= 18 || h < 6; }

  // ---------- Etapas, urbanizaciones y barrios (OpenStreetMap) ----------
  // Se descargan una vez por semana y se guardan en el navegador; salen al acercar el mapa.
  var LUGARES_CLAVE = 'aa_lugares_v1', LUGARES_DIAS = 7;
  var lugaresDatos = null, lugaresPedidos = false, lugaresEspera = [];
  function lugaresGeo(lista) {
    return { type: 'FeatureCollection', features: lista.map(function (l) {
      return { type: 'Feature', properties: { n: l[0], g: l[3] ? 1 : 0 }, geometry: { type: 'Point', coordinates: [l[2], l[1]] } };
    }) };
  }
  function pedirLugares(listo) {
    if (lugaresDatos) { listo(lugaresDatos); return; }
    lugaresEspera.push(listo);
    if (lugaresPedidos) return;
    lugaresPedidos = true;
    try {
      var g = JSON.parse(localStorage.getItem(LUGARES_CLAVE) || 'null');
      if (g && g.t > Date.now() - LUGARES_DIAS * 86400000 && g.d && g.d.length) { entregar(g.d); return; }
    } catch (e) { /* sin almacenamiento */ }
    var q = '[out:json][timeout:60][bbox:-2.42,-80.12,-1.88,-79.72];(' +
      'way["landuse"="residential"]["name"];relation["landuse"="residential"]["name"];' +
      'node["place"~"^(neighbourhood|suburb|quarter)$"]["name"];way["place"~"^(neighbourhood|suburb|quarter)$"]["name"];' +
      ');out center tags;';
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        var vistos = {}, d = [];
        (j.elements || []).forEach(function (e) {
          var c = e.center || { lat: e.lat, lon: e.lon };
          if (!c || typeof c.lat !== 'number' || !e.tags || !e.tags.name) return;
          var k = e.tags.name + '|' + c.lat.toFixed(3) + '|' + c.lon.toFixed(3);
          if (vistos[k]) return; vistos[k] = 1;
          var grande = e.tags.place === 'suburb' ? 1 : 0;
          d.push([e.tags.name, +c.lat.toFixed(5), +c.lon.toFixed(5), grande]);
        });
        try { localStorage.setItem(LUGARES_CLAVE, JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* lleno o bloqueado */ }
        entregar(d);
      })
      .catch(function (e) { if (window.console) console.warn('AutoAmigo lugares:', e); lugaresPedidos = false; lugaresEspera = []; });
    function entregar(d) {
      lugaresDatos = lugaresGeo(d);
      var f = lugaresEspera; lugaresEspera = [];
      f.forEach(function (x) { x(lugaresDatos); });
    }
  }
  function ponerLugares(m) {
    pedirLugares(function (geo) {
      if (m.getSource('aa-lugares')) { m.getSource('aa-lugares').setData(geo); return; }
      var P = m.__modo === 'noche' ? NOCHE : DIA;
      m.addSource('aa-lugares', { type: 'geojson', data: geo });
      m.addLayer({
        id: 'aa-lugares', type: 'symbol', source: 'aa-lugares', minzoom: 13.5,
        layout: {
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, ['case', ['==', ['get', 'g'], 1], 13, 11], 17, ['case', ['==', ['get', 'g'], 1], 16, 14]],
          'text-max-width': 9,
          'text-padding': 4,
          'symbol-sort-key': ['-', 1, ['get', 'g']]
        },
        paint: { 'text-color': P.lugar, 'text-halo-color': P.halo, 'text-halo-width': 1.6 }
      });
    });
  }

  function pintar(m, P) {
    (m.getStyle().layers || []).forEach(function (l) {
      var id = l.id;
      try {
        if (l.paint && l.paint['fill-pattern']) { m.setLayoutProperty(id, 'visibility', 'none'); return; }
        if (l.type === 'background') m.setPaintProperty(id, 'background-color', P.fondo);
        else if (l.type === 'fill') {
          if (/water|ocean|river|lake/.test(id)) m.setPaintProperty(id, 'fill-color', P.agua);
          else if (/park|wood|forest|grass|green|landcover|cemetery|pitch/.test(id)) m.setPaintProperty(id, 'fill-color', P.parque);
          else if (/building/.test(id)) m.setPaintProperty(id, 'fill-color', P.edificio);
          else m.setPaintProperty(id, 'fill-color', P.fondo);
        } else if (l.type === 'fill-extrusion') m.setPaintProperty(id, 'fill-extrusion-color', P.edificio);
        else if (l.type === 'line') {
          if (/^aa-/.test(id)) return; // capas propias (ruta)
          if (/water|river|waterway/.test(id)) m.setPaintProperty(id, 'line-color', P.agua);
          else if (/casing/.test(id)) m.setPaintProperty(id, 'line-color', P.borde);
          else if (/motorway|trunk/.test(id)) m.setPaintProperty(id, 'line-color', P.autopista);
          else if (/primary|secondary/.test(id)) m.setPaintProperty(id, 'line-color', P.avenida);
          else if (/road|street|minor|service|tertiary|path|bridge|tunnel/.test(id)) m.setPaintProperty(id, 'line-color', P.calle);
        } else if (l.type === 'symbol') {
          m.setPaintProperty(id, 'text-color', /water/.test(id) ? P.textoAgua : P.texto);
          m.setPaintProperty(id, 'text-halo-color', P.halo);
          if (/poi/.test(id)) m.setLayoutProperty(id, 'visibility', 'none');
          // Placas de vías (E40, E48…): se ocultan para no confundir con los carros
          var campo = JSON.stringify((l.layout || {})['text-field'] || '');
          if (/shield/.test(id) || /"ref"|\{ref\}/.test(campo)) m.setLayoutProperty(id, 'visibility', 'none');
        }
      } catch (e) { /* capa sin esa propiedad */ }
    });
  }

  var mapas = [];
  function aplicarModo(m) {
    if (!m.__listo) return;
    var modo = m.__forzado || (esNoche() ? 'noche' : 'dia');
    if (m.__modo === modo) return;
    m.__modo = modo;
    pintar(m, modo === 'noche' ? NOCHE : DIA);
    if (m.getLayer('aa-lugares')) {
      m.setPaintProperty('aa-lugares', 'text-color', (modo === 'noche' ? NOCHE : DIA).lugar);
      m.setPaintProperty('aa-lugares', 'text-halo-color', (modo === 'noche' ? NOCHE : DIA).halo);
    }
    var lin = m.getLayer('aa-ruta');
    if (lin) m.setPaintProperty('aa-ruta', 'line-color', modo === 'noche' ? '#8FB4FF' : '#090145');
  }
  setInterval(function () { mapas.forEach(aplicarModo); }, 30000);
  // Cambio exacto a las 6:00 p. m. (noche) y 6:00 a. m. (día), según la hora del aparato
  (function programarCambio() {
    var d = new Date(), sig = new Date(d.getTime());
    sig.setSeconds(0, 0);
    if (d.getHours() < 6) sig.setHours(6, 0);
    else if (d.getHours() < 18) sig.setHours(18, 0);
    else { sig.setDate(sig.getDate() + 1); sig.setHours(6, 0); }
    setTimeout(function () { mapas.forEach(aplicarModo); programarCambio(); }, Math.max(1000, sig.getTime() - d.getTime() + 200));
  })();

  // centro: [lat, lng] como antes
  // modo (opcional, para pruebas): 'dia' | 'noche'
  function crear(contenedor, centro, zoom, modo) {
    var m = new maplibregl.Map({
      container: contenedor,
      style: ESTILO,
      center: [centro[1], centro[0]],
      zoom: zoom,
      pixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    m.__listos = [];
    m.__forzado = modo || null;
    function listo() {
      if (m.__listo) return;
      m.__listo = true;
      aplicarModo(m);
      ponerLugares(m);
      m.__listos.forEach(function (f) { f(); });
      m.__listos = [];
    }
    m.on('style.load', listo);
    m.on('load', listo);
    mapas.push(m);
    return m;
  }
  function cuandoListo(m, f) { if (m.__listo) f(); else m.__listos.push(f); }

  function pinSVG(color, texto) {
    texto = String(texto == null ? '' : texto).slice(0, 4);
    var t = texto.length > 3 ? 10 : (texto.length > 2 ? 12 : 13);
    var safe = texto.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    return '<svg class="pin-gps" width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">' +
      '<path d="M20 50 C20 50 4 31 4 19 A16 16 0 1 1 36 19 C36 31 20 50 20 50 Z" fill="' + color + '" stroke="#fff" stroke-width="2.5"/>' +
      '<text x="20" y="24" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="' + t + '" fill="#fff">' + safe + '</text></svg>';
  }

  // Línea punteada entre recogida y destino (null para borrarla)
  function ruta(m, a, b) {
    cuandoListo(m, function () {
      var datos = { type: 'FeatureCollection', features: (a && b) ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } }] : [] };
      var src = m.getSource('aa-ruta');
      if (src) { src.setData(datos); return; }
      m.addSource('aa-ruta', { type: 'geojson', data: datos });
      m.addLayer({ id: 'aa-ruta', type: 'line', source: 'aa-ruta',
        paint: { 'line-color': m.__modo === 'noche' ? '#8FB4FF' : '#090145', 'line-width': 4, 'line-dasharray': [2, 2] } });
    });
  }

  function encuadrar(m, puntos, maxZoom) {
    if (!puntos.length) return;
    if (puntos.length === 1) { m.jumpTo({ center: [puntos[0][1], puntos[0][0]], zoom: Math.min(maxZoom || 15, 15) }); return; }
    var b = new maplibregl.LngLatBounds();
    puntos.forEach(function (p) { b.extend([p[1], p[0]]); });
    m.fitBounds(b, { padding: 50, maxZoom: maxZoom || 15, duration: 0 });
  }

  function forzarModo(modo) { modoForzado = modo; mapas.forEach(function (m) { m.__modo = null; aplicarModo(m); }); }
  window.MapaAA = { forzarModo: forzarModo, crear: crear, pinSVG: pinSVG, colores: COLORES, ruta: ruta, encuadrar: encuadrar, esNoche: esNoche };
})();
