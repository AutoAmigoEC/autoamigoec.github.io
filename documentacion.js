/* AutoAmigo · Panel
 * "Documentación" de un conductor ya aprobado: sus fotos (cara, cédula, licencia, matrícula, carro)
 * y cuánto se parecieron las caras según la revisión automática.
 *   - Registro: el teléfono comparó la foto en vivo con la cara de la cédula y de la licencia.
 *   - Último turno: la foto del turno comparada con la del registro, la cédula y la licencia.
 * Parecido en %: 100% = idénticas. La app aprueba desde 38% (cédula/licencia) y 45% (turno).
 */
(function () {
  var UMBRAL_DOC = 0.62, UMBRAL_TURNO = 0.55;
  var FOTOS = [['persona', 'Foto en vivo'], ['cedula', 'Cédula'], ['licencia', 'Licencia'], ['matricula', 'Matrícula'], ['carro', 'Carro']];
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(d) { return Math.max(0, Math.min(100, Math.round((1 - d) * 100))); }
  function fecha(iso) { if (!iso) return '—'; var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : esc(iso); }
  function fechaMs(ms) { if (!ms) return ''; var d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
  function resultado(titulo, d, umbral, detalle) {
    if (typeof d !== 'number') return '<div class="doc-res gris"><b>' + titulo + '</b><span>Sin dato</span><small>' + detalle + '</small></div>';
    var ok = d <= umbral;
    return '<div class="doc-res ' + (ok ? 'ok' : 'mal') + '"><b>' + titulo + '</b><span>' + pct(d) + '% ' + (ok ? '✓ Coincide' : '⚠ Revisar') + '</span><small>' + detalle + '</small></div>';
  }

  var caja = document.createElement('div'); caja.className = 'doc-velo'; caja.hidden = true;
  document.body.appendChild(caja);

  function abrir(uid) {
    caja.hidden = false;
    caja.innerHTML = '<div class="doc-caja"><div class="doc-cab"><h2>Documentación</h2><button class="btn btn-chico" data-doc-cerrar="1">Cerrar</button></div><p class="doc-cargando">Cargando…</p></div>';
    var db = firebase.database();
    Promise.all([
      db.ref('fichas/' + uid).once('value'), db.ref('fichaFotos/' + uid).once('value'),
      db.ref('turnos/' + uid).once('value'), db.ref('conductores/' + uid).once('value')
    ]).then(function (r) {
      var ficha = r[0].val() || {}, fotos = r[1].val() || {}, turno = r[2].val() || {}, cond = r[3].val() || {};
      var sol = ficha.solicitud ? db.ref('solicitudes/' + ficha.solicitud + '/parecido').once('value') : Promise.resolve(null);
      return sol.then(function (s) { pintar(uid, ficha, fotos, turno, cond, (s && s.val()) || {}); });
    }).catch(function () {
      caja.querySelector('.doc-cargando').textContent = 'No se pudo cargar la documentación. Revisa tu conexión.';
    });
  }

  function pintar(uid, ficha, fotos, turno, cond, par) {
    var nombre = ficha.nombre || cond.nombre || 'Conductor', docs = ficha.docs || {};
    var figuras = FOTOS.map(function (x) {
      var src = fotos[x[0]];
      return '<figure><button class="doc-foto" ' + (src ? 'data-doc-grande="' + esc(src) + '" data-doc-txt="' + esc(nombre + ' · ' + x[1]) + '"' : 'disabled') + '>' +
        (src ? '<img src="' + esc(src) + '" alt="">' : '<span>Sin foto</span>') + '</button><figcaption>' + x[1] + '</figcaption></figure>';
    }).join('');
    var resumen =
      resultado('Cara vs. cédula', par.cedula, UMBRAL_DOC, 'Al registrarse') +
      resultado('Cara vs. licencia', par.licencia, UMBRAL_DOC, 'Al registrarse') +
      resultado('Último turno vs. registro', turno.cara, UMBRAL_TURNO, turno.t ? 'Turno del ' + fechaMs(turno.t) + (turno.estado ? ' · ' + esc(turno.estado) : '') : 'Todavía no hay turnos');
    caja.innerHTML = '<div class="doc-caja"><div class="doc-cab"><div><h2>Documentación</h2><p>' + esc(nombre) + (cond.unidad ? ' · Unidad ' + esc(cond.unidad) : '') + '</p></div><button class="btn btn-chico" data-doc-cerrar="1">Cerrar</button></div>' +
      '<h3>Coincidencia de la cara</h3><div class="doc-resumen">' + resumen + '</div>' +
      '<p class="doc-nota">El porcentaje lo calcula la revisión automática comparando las caras (100% = idénticas). Se aprueba desde 38% en cédula y licencia, y desde 45% en el turno. La matrícula y el carro no tienen cara: revísalos tú (placa, nombre y color).</p>' +
      '<h3>Fotos</h3><div class="doc-fotos">' + figuras + '</div>' +
      '<h3>Datos</h3><div class="doc-datos">' +
        '<div><span>Cédula</span><b>' + esc(ficha.cedula || '—') + '</b></div>' +
        '<div><span>Placa</span><b>' + esc(ficha.placa || cond.placa || '—') + '</b></div>' +
        '<div><span>Vehículo</span><b>' + esc([ficha.marca, ficha.color, ficha.anio].filter(Boolean).join(' · ') || cond.vehiculo || '—') + '</b></div>' +
        '<div><span>Vence cédula</span><b>' + fecha(docs.cedula && docs.cedula.vence) + '</b></div>' +
        '<div><span>Vence licencia</span><b>' + fecha(docs.licencia && docs.licencia.vence) + '</b></div>' +
        '<div><span>Vence matrícula</span><b>' + fecha(docs.matricula && docs.matricula.vence) + '</b></div>' +
      '</div>' +
      (window.AAVerificar && ficha.cedula ? '<h3>Revisar en páginas oficiales</h3><div class="acciones verif">' + AAVerificar.botones(ficha.cedula) + '</div>' : '') +
      '</div>';
  }

  window.AADocumentacion = {
    boton: function (uid) { return '<button class="btn btn-chico" data-documentacion="' + uid + '">Documentación</button>'; }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-documentacion],[data-doc-cerrar],[data-doc-grande],.doc-grande');
    if (!b) { if (e.target === caja) caja.hidden = true; return; }
    if (b.hasAttribute('data-documentacion')) { abrir(b.getAttribute('data-documentacion')); return; }
    if (b.hasAttribute('data-doc-cerrar')) { caja.hidden = true; return; }
    if (b.hasAttribute('data-doc-grande')) {
      var g = document.createElement('div'); g.className = 'doc-grande';
      g.innerHTML = '<img src="' + esc(b.getAttribute('data-doc-grande')) + '" alt=""><p>' + esc(b.getAttribute('data-doc-txt')) + ' · toca para cerrar</p>';
      document.body.appendChild(g); return;
    }
    if (b.classList.contains('doc-grande')) { b.remove(); }
  });
})();
