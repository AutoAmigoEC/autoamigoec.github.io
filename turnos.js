/*
 * AutoAmigo · Panel · Turnos (verificación al empezar el turno).
 *
 * - Registro de identidad: la primera vez el conductor manda su cédula y un selfie. La central lo aprueba aquí.
 * - Turno diario: Gemini aprueba solo lo que está bien, rechaza solo lo que está claramente mal y BLOQUEA
 *   (borra sin guardar) las fotos sin camisa o que no sirven. Aquí solo llegan los casos dudosos.
 * - Detector propio: cada decisión deja fotos aptas para entrenarlo. Cuando iguale a Gemini se deja Gemini.
 * - El interruptor (Configuración) prende o apaga todo. Apagado, la app funciona como siempre.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var db = firebase.database();
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hora(ms) { var d = new Date(Number(ms) || 0); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function diaHoy() { return new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); }   // Ecuador UTC-5, igual que la app y el servidor
  function clave() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function toast(m, mal) { var t = $('#toast'); if (!t) return; t.textContent = m; t.className = 'toast' + (mal ? ' error' : ''); t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, mal ? 6000 : 3500); }

  var T = { cfg: {}, turnos: {}, fotos: {}, ident: {}, identFotos: {}, hist: {}, conteo: {}, cond: {}, sinPermiso: false, rechazando: null, motivos: {}, otro: '', rechazandoId: null };
  var oyentes = [];
  function on(ruta, fn) {
    var ref = db.ref(ruta);
    var cb = function (s) { fn(s.val() || {}); pintar(); };
    ref.on('value', cb, function () { T.sinPermiso = true; pintar(); });
    oyentes.push([ref, cb]);
  }
  firebase.auth().onAuthStateChanged(function (u) {
    oyentes.forEach(function (o) { o[0].off('value', o[1]); }); oyentes = [];
    if (!u) return;
    on('config', function (v) { T.cfg = v; llenarCfg(); });
    on('conductores', function (v) { T.cond = v; });
    on('turnos', function (v) { T.turnos = v; });
    on('turnoFotos', function (v) { T.fotos = v; });
    on('identidad', function (v) { T.ident = v; cargarFotosIdentidad(); });
    on('turnosHist/' + diaHoy(), function (v) { T.hist = v; });
    on('entrenarConteo', function (v) { T.conteo = v; });
  });
  // Las fotos de la cédula solo se bajan de los registros pendientes (no las de todos)
  function cargarFotosIdentidad() {
    Object.keys(T.ident).forEach(function (uid) {
      if (T.ident[uid].estado !== 'pendiente' || T.identFotos[uid]) return;
      T.identFotos[uid] = 'cargando';
      db.ref('identidadFotos/' + uid).once('value').then(function (s) { T.identFotos[uid] = s.val() || {}; pintar(); }, function () { delete T.identFotos[uid]; });
    });
  }

  // Lo usa el panel para el reparto: si la verificación está prendida, solo cuentan los conductores con turno aprobado hoy
  function activa() { return T.cfg.verificarTurno === true && /^https:\/\//.test(T.cfg.turnoUrl || ''); }
  window.TurnosAA = { ok: function (uid) { if (!activa()) return true; var t = T.turnos[uid]; return !!(t && t.estado === 'aprobado' && t.dia === diaHoy()); } };

  // ---------------- Pantalla ----------------
  var MOTIVOS = [
    ['camiseta', 'Es camiseta, no camisa', 'Llevas camiseta, no camisa. Ponte camisa y vuelve a tomar la foto.', ['pecho']],
    ['gorra', 'Está con gorra', 'Estás con gorra. Quítatela y vuelve a tomar la foto de tu camisa.', ['pecho']],
    ['camisa', 'No tiene camisa', 'No tienes camisa. Ponte camisa y vuelve a tomar la foto.', ['pecho']],
    ['carro', 'Carro sucio', 'El carro no está limpio. Límpialo y vuelve a tomar las fotos del carro.', ['carro']],
    ['foto', 'Las fotos no se ven bien', 'Las fotos no se ven bien. Tómalas otra vez con buena luz.', ['pecho', 'carro']],
    ['persona', 'No es el conductor', 'La central no pudo confirmar que seas tú. Llama a la central.', ['cara', 'pecho', 'carro']]
  ];
  var MOTIVOS_ID = [['borrosa', 'La cédula no se lee'], ['otra', 'No es la misma persona'], ['selfie', 'El selfie no se ve bien']];
  function nombre(uid, extra) { var c = T.cond[uid] || {}; return (c.nombre || (extra && extra.nombre) || 'Conductor') + (c.unidad || (extra && extra.unidad) ? ' · Unidad ' + (c.unidad || extra.unidad) : ''); }
  function foto(src, txt, quien) { return '<figure><button class="foto-t" data-ver-foto="1" data-src="' + esc(src) + '" data-txt="' + esc(quien + ' · ' + txt) + '"><img src="' + esc(src) + '" alt=""></button><figcaption>' + txt + '</figcaption></figure>'; }
  function chips(lista, sel) { return '<div class="chips">' + lista.map(function (m) { return '<button class="chip' + (sel[m[0]] ? ' activo' : '') + '" data-motivo-t="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>'; }

  function pendientesTurno() {
    var hoy = diaHoy();
    return Object.keys(T.fotos).filter(function (uid) { var t = T.turnos[uid]; return t && t.estado === 'revision' && t.dia === hoy; })
      .sort(function (a, b) { return (T.fotos[a].t || 0) - (T.fotos[b].t || 0); });
  }
  function pendientesId() { return Object.keys(T.ident).filter(function (uid) { return T.ident[uid].estado === 'pendiente'; }).sort(function (a, b) { return (T.ident[a].t || 0) - (T.ident[b].t || 0); }); }

  function tarjetaTurno(uid) {
    var f = T.fotos[uid], t = T.turnos[uid] || {}, quien = nombre(uid, f), rech = T.rechazandoId === 't:' + uid;
    var cara = typeof t.cara === 'number' ? (t.cara <= 0.5 ? '✓ La cara coincide con su registro' : 'La cara no coincide bien') : '✓ Cara verificada en el teléfono';
    return '<article class="turno"><div class="fila"><div><strong>' + esc(quien) + '</strong><div class="meta">Envió a las ' + hora(f.t) + '</div></div><span class="cara-ok">' + cara + '</span></div>' +
      '<div class="duda-ia"><b>La revisión automática no está segura:</b> ' + esc(t.duda || f.duda || '') + '</div>' +
      '<div class="fotos-turno"><div class="grupo"><h4>Vestimenta</h4><div class="g">' + foto(f.pecho, 'Camisa · sin gorra', quien) + '</div></div>' +
      '<div class="grupo"><h4>Carro</h4><div class="g">' + (f.carro || []).map(function (c, i) { return foto(c, ['Adelante', 'Atrás', 'Piso'][i], quien); }).join('') + '</div></div></div>' +
      (rech ? '<div class="rechazo"><b>¿Por qué lo rechazas?</b>' + chips(MOTIVOS, T.motivos) + '<input id="motivo-otro" placeholder="Otro motivo (opcional)" value="' + esc(T.otro) + '">' +
        '<div class="acciones"><button class="btn" data-volver-t="1">Volver</button><button class="btn btn-peligro" data-rechazar-ok="' + uid + '">Rechazar y avisar al conductor</button></div></div>'
        : '<div class="acciones"><button class="btn btn-primario" data-aprobar-t="' + uid + '">✓ Aprobar turno</button><button class="btn btn-peligro" data-rechazar-t="' + uid + '">Rechazar</button></div>') +
      '</article>';
  }
  function tarjetaId(uid) {
    var i = T.ident[uid], f = T.identFotos[uid], quien = nombre(uid), rech = T.rechazandoId === 'i:' + uid;
    var par = f && typeof f.parecido === 'number' ? (f.parecido <= 0.5 ? '✓ El teléfono ve parecido con la cédula' : 'El teléfono ve poco parecido con la cédula') : 'Compáralas tú';
    return '<article class="turno"><div class="fila"><div><strong>' + esc(quien) + '</strong><div class="meta">Registro de identidad · envió a las ' + hora(i.t) + '</div></div><span class="cara-ok' + (f && f.parecido > 0.5 ? ' mal' : '') + '">' + par + '</span></div>' +
      (f && f !== 'cargando' ? '<div class="fotos-turno"><div class="grupo"><h4>Cédula</h4><div class="g">' + foto(f.cedula, 'Cédula', quien).replace('<figure>', '<figure class="ancha">') + '</div></div>' +
        '<div class="grupo"><h4>Selfie en vivo</h4><div class="g">' + foto(f.selfie, 'Selfie', quien) + '</div></div></div>' : '<p class="muted">Cargando fotos…</p>') +
      (rech ? '<div class="rechazo"><b>¿Por qué lo rechazas?</b>' + chips(MOTIVOS_ID, T.motivos) +
        '<div class="acciones"><button class="btn" data-volver-t="1">Volver</button><button class="btn btn-peligro" data-rechazar-id-ok="' + uid + '">Rechazar registro</button></div></div>'
        : '<div class="acciones"><button class="btn btn-primario" data-aprobar-id="' + uid + '">✓ Es la misma persona</button><button class="btn btn-peligro" data-rechazar-id="' + uid + '">Rechazar</button></div>') +
      '</article>';
  }
  var CLASES = [['camisa', 'Camisa'], ['camiseta', 'Camiseta'], ['gorra', 'Con gorra'], ['carro_limpio', 'Carro limpio'], ['carro_sucio', 'Carro sucio']];
  var META = 300;
  function detectorHTML() {
    var total = CLASES.reduce(function (s, c) { return s + (T.conteo[c[0]] || 0); }, 0);
    var listo = CLASES.every(function (c) { return (T.conteo[c[0]] || 0) >= META; });
    return '<section class="detector"><div class="det-cab"><h2>Detector propio</h2></div>' +
      '<ol class="det-fases"><li class="actual"><b>1</b>Gemini decide y el detector aprende</li><li><b>2</b>El detector practica sin decidir</li><li><b>3</b>Se deja Gemini</li></ol>' +
      '<p>Lleva <b>' + total.toLocaleString('es-EC') + ' fotos</b> para aprender. Necesita al menos ' + META + ' de cada tipo.' + (listo ? ' <b>Ya tiene suficientes: avísale a Claude para entrenarlo.</b>' : '') + '</p>' +
      '<div class="det-barras">' + CLASES.map(function (c) { var n = T.conteo[c[0]] || 0, pct = Math.min(100, Math.round(n / META * 100)); return '<div><span>' + c[1] + '</span><i><em style="width:' + pct + '%" class="' + (pct >= 100 ? 'ok' : '') + '"></em></i><small>' + n + (n >= META ? ' ✓' : ' / ' + META) + '</small></div>'; }).join('') + '</div>' +
      '<p class="muted">Las fotos sin camisa o que no sirven no se guardan nunca. Esos casos el detector los aprende con fotos públicas de ejemplo.</p></section>';
  }

  function pintar() {
    var pt = pendientesTurno(), pi = pendientesId(), n = pt.length + pi.length, on = activa();
    var bad = $('#badge-turnos'); if (bad) { bad.textContent = n; bad.hidden = !n; }
    var vista = $('#vista-turnos'); if (!vista) return;
    var av = $('#aviso-turnos');
    if (av) {
      av.hidden = !n || !vista.hidden;
      av.innerHTML = '<span class="texto"><strong>' + n + ' por revisar.</strong> ' + (n > 1 ? 'Estos conductores no pueden' : 'Este conductor no puede') + ' conectarse hasta que ' + (n > 1 ? 'los' : 'lo') + ' revises.</span><button class="btn btn-primario btn-chico" data-ir-turnos="1">Revisar</button>';
    }
    $('#turnos-estado').innerHTML = T.sinPermiso
      ? '<div class="alerta"><span class="texto"><strong>Faltan las reglas nuevas de Firebase.</strong> Pega las reglas de firebase/reglas-database.json en Firebase → Realtime Database → Reglas.</span></div>'
      : (on ? '' : '<div class="bloqueadas-turnos"><b>La verificación está apagada.</b> Los conductores se conectan como siempre. Se prende en Configuración → Verificación del turno.</div>');
    $('#turnos-sub').textContent = n ? n + ' por revisar.' : 'No hay nada por revisar.';
    var hist = Object.keys(T.hist).map(function (k) { return T.hist[k]; }).sort(function (a, b) { return b.t - a.t; });
    var nb = hist.filter(function (h) { return h.bloqueada; }).length;
    var blq = $('#bloqueadas-turnos'); blq.hidden = !nb; blq.innerHTML = '<b>Gemini bloqueó ' + nb + ' foto' + (nb > 1 ? 's' : '') + ' hoy</b>. Se eliminaron al instante y no se muestran aquí; al conductor le llegó el motivo para corregir.';
    var lista = pi.map(tarjetaId).join('') + pt.map(tarjetaTurno).join('');
    var el = $('#lista-turnos'), html = lista || '<div class="vacio">No hay nada por revisar. Solo llegan aquí los registros nuevos y los casos que la revisión automática no pudo decidir.</div>';
    if (el.__h !== html) { el.innerHTML = html; el.__h = html; }
    $('#detector-turnos').innerHTML = detectorHTML();
    $('#turnos-hechos').innerHTML = hist.length ? '<table class="tabla"><thead><tr><th>Conductor</th><th>Resultado</th><th>Revisó</th><th>Hora</th></tr></thead><tbody>' + hist.map(function (h) {
      var res = h.estado === 'aprobado' ? '<span class="pill libre">Aprobado</span>' : h.bloqueada ? '<span class="pill sinsaldo">Bloqueada</span> <small>' + esc(h.motivo) + ' · foto eliminada, no se muestra</small>' : '<span class="pill sinsaldo">Rechazado</span> <small>' + esc(h.motivo) + '</small>';
      return '<tr><td>' + esc(nombre(h.uid, h)) + '</td><td>' + res + '</td><td>' + (h.por === 'ia' ? 'Gemini' : 'Central') + '</td><td>' + hora(h.t) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="muted" style="padding:12px 14px;margin:0">Todavía no hay turnos revisados hoy.</p>';
  }

  // ---------------- Decisiones de la central ----------------
  function guardar(up, ok) { db.ref().update(up).then(function () { toast(ok); }, function (e) { toast('No se pudo guardar: ' + (e && e.message || e), true); }); }
  function muestras(up, uid, clases) {
    var f = T.fotos[uid]; if (!f) return;
    clases.forEach(function (cl) {
      var imgs = cl.indexOf('carro') === 0 ? (f.carro || []) : [f.pecho];
      imgs.forEach(function (img, i) { if (img) up['entrenar/' + cl + '/' + clave() + i] = { img: img, t: Date.now(), por: 'central' }; });
      up['entrenarConteo/' + cl] = (T.conteo[cl] || 0) + imgs.length;
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-aprobar-t],[data-rechazar-t],[data-rechazar-ok],[data-volver-t],[data-motivo-t],[data-aprobar-id],[data-rechazar-id],[data-rechazar-id-ok],[data-ir-turnos],[data-ver-foto],#foto-grande,.menu-item[data-vista]');
    if (!b) return;
    if (b.matches('.menu-item[data-vista]')) { setTimeout(pintar, 0); return; }
    if (b.hasAttribute('data-ir-turnos')) { var m = document.querySelector('.menu-item[data-vista=turnos]'); if (m) m.click(); return; }
    if (b.hasAttribute('data-ver-foto')) { var g = $('#foto-grande'); g.innerHTML = '<img src="' + esc(b.getAttribute('data-src')) + '" alt=""><p>' + esc(b.getAttribute('data-txt')) + '</p>'; g.hidden = false; return; }
    if (b.id === 'foto-grande') { b.hidden = true; return; }
    var uid;
    if ((uid = b.getAttribute('data-aprobar-t'))) {
      var up = {}, t = Date.now(), f = T.fotos[uid] || {};
      up['turnos/' + uid + '/estado'] = 'aprobado'; up['turnos/' + uid + '/por'] = 'central'; up['turnos/' + uid + '/duda'] = null; up['turnos/' + uid + '/motivo'] = null;
      up['turnosHist/' + diaHoy() + '/' + clave()] = { uid: uid, nombre: f.nombre || '', unidad: f.unidad || '', estado: 'aprobado', por: 'central', t: t };
      muestras(up, uid, ['camisa', 'carro_limpio']);
      up['turnoFotos/' + uid] = null;
      guardar(up, 'Turno aprobado. Ya puede conectarse.'); return;
    }
    if ((uid = b.getAttribute('data-rechazar-t')) || (uid = b.getAttribute('data-rechazar-id'))) { T.rechazandoId = (b.hasAttribute('data-rechazar-id') ? 'i:' : 't:') + uid; T.motivos = {}; T.otro = ''; pintar(); return; }
    if (b.hasAttribute('data-volver-t')) { T.rechazandoId = null; pintar(); return; }
    if (b.hasAttribute('data-motivo-t')) { var k = b.getAttribute('data-motivo-t'); T.motivos[k] = !T.motivos[k]; var o = $('#motivo-otro'); if (o) T.otro = o.value; pintar(); return; }
    if ((uid = b.getAttribute('data-rechazar-ok'))) {
      var sel = MOTIVOS.filter(function (m) { return T.motivos[m[0]]; }), otro = (($('#motivo-otro') || {}).value || '').trim();
      if (!sel.length && !otro) { toast('Elige al menos un motivo para que el conductor sepa qué corregir.', true); return; }
      var texto = sel.map(function (m) { return m[2]; }).concat(otro ? [otro] : []).join(' ');
      var rehacer = []; sel.forEach(function (m) { m[3].forEach(function (r) { if (rehacer.indexOf(r) < 0) rehacer.push(r); }); });
      if (!rehacer.length) rehacer = ['pecho', 'carro'];
      rehacer.sort(function (a, c) { return ['cara', 'pecho', 'carro'].indexOf(a) - ['cara', 'pecho', 'carro'].indexOf(c); });
      var up2 = {}, f2 = T.fotos[uid] || {}, bloq = !!T.motivos.camisa;
      up2['turnos/' + uid + '/estado'] = 'rechazado'; up2['turnos/' + uid + '/por'] = 'central'; up2['turnos/' + uid + '/motivo'] = texto; up2['turnos/' + uid + '/rehacer'] = rehacer; up2['turnos/' + uid + '/duda'] = null; up2['turnos/' + uid + '/bloqueada'] = bloq || null;
      up2['turnosHist/' + diaHoy() + '/' + clave()] = { uid: uid, nombre: f2.nombre || '', unidad: f2.unidad || '', estado: 'rechazado', motivo: sel.map(function (m) { return m[1]; }).concat(otro ? [otro] : []).join(', '), bloqueada: bloq || null, por: 'central', t: Date.now() };
      // Solo fotos aptas para enseñarle al detector (nunca las sin camisa)
      if (!bloq) muestras(up2, uid, ['camiseta', 'gorra', 'carro'].filter(function (k) { return T.motivos[k]; }).map(function (k) { return k === 'carro' ? 'carro_sucio' : k; }));
      up2['turnoFotos/' + uid] = null;
      T.rechazandoId = null;
      guardar(up2, 'Turno rechazado. Le llegó el motivo para que corrija.'); return;
    }
    if ((uid = b.getAttribute('data-aprobar-id'))) {
      var up3 = {}; up3['identidad/' + uid + '/estado'] = 'aprobada'; up3['identidad/' + uid + '/aprobadaT'] = Date.now(); up3['identidad/' + uid + '/motivo'] = null;
      guardar(up3, 'Identidad aprobada. Ya puede verificar su turno.'); return;
    }
    if ((uid = b.getAttribute('data-rechazar-id-ok'))) {
      var sel2 = MOTIVOS_ID.filter(function (m) { return T.motivos[m[0]]; });
      if (!sel2.length) { toast('Elige el motivo.', true); return; }
      var up4 = {}; up4['identidad/' + uid + '/estado'] = 'rechazada'; up4['identidad/' + uid + '/motivo'] = sel2.map(function (m) { return m[1].toLowerCase(); }).join(', ');
      up4['identidadFotos/' + uid] = null; delete T.identFotos[uid];
      T.rechazandoId = null;
      guardar(up4, 'Registro rechazado. El conductor lo hará otra vez.'); return;
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var g = $('#foto-grande'); if (g && !g.hidden) g.hidden = true; } });

  // ---------------- Interruptor (Configuración) ----------------
  function llenarCfg() {
    var c = $('#cfg-turno-on'), u = $('#cfg-turno-url');
    if (!c || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#form-turno'))) return;
    c.checked = T.cfg.verificarTurno === true; u.value = T.cfg.turnoUrl || '';
  }
  var form = $('#form-turno');
  if (form) form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var on = $('#cfg-turno-on').checked, url = $('#cfg-turno-url').value.trim().replace(/\/+$/, '');
    if (on && !/^https:\/\/[^ ]+$/.test(url)) { toast('Pega primero la dirección del servidor de revisión (empieza con https://).', true); return; }
    db.ref('config').update({ verificarTurno: on, turnoUrl: url }).then(function () { toast(on ? 'Verificación del turno prendida.' : 'Verificación del turno apagada.'); }, function (e) { toast('No se pudo guardar: ' + (e && e.message || e), true); });
  });
  setInterval(pintar, 60000);   // cambia el día a medianoche
})();
