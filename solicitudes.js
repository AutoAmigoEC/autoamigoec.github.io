/*
 * AutoAmigo · Panel · Solicitudes.
 * - Conductores nuevos (desde "Crear usuario" de la app): datos + 5 fotos en vivo. Al aprobar se crean el usuario y
 *   la clave, su ficha, su identidad (para la verificación diaria) y se abre WhatsApp con el mensaje listo.
 * - Fotos de perfil dudosas (las claras las aprueba o rechaza sola la revisión automática).
 * - Documentos renovados por aprobar y tabla de documentos vencidos o por vencer.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var db = firebase.database();
  var AJ = window.AUTOAMIGO || {};
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fecha(iso) { if (!iso) return '—'; var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function dias(iso) { return Math.round((new Date(iso + 'T12:00:00') - new Date()) / 86400000); }
  function hora(ms) { var d = new Date(Number(ms) || 0); return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' }) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function edad(iso) { return Math.floor((new Date() - new Date(iso)) / (365.25 * 86400000)); }
  function toast(m, mal) { var t = $('#toast'); if (!t) return; t.textContent = m; t.className = 'toast' + (mal ? ' error' : ''); t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, mal ? 6000 : 3500); }
  function wa(tel, txt) { var n = String(tel || '').replace(/\D/g, ''); if (n[0] === '0') n = '593' + n.slice(1); return (/Android|iPhone|Mobile/i.test(navigator.userAgent) ? 'https://wa.me/' + n + '?text=' : 'whatsapp://send?phone=' + n + '&text=') + encodeURIComponent(txt); }
  function abrirWA(tel, txt) { var a = document.createElement('a'); a.href = wa(tel, txt); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }

  var S = { sol: {}, fotos: {}, cond: {}, fichas: {}, perfiles: {}, perfFotos: {}, docs: {}, aprobando: null, rechazando: null, motivos: {}, creado: null, ocupado: false };
  var oy = [];
  function on(ruta, fn) { var r = db.ref(ruta), cb = function (s) { fn(s.val() || {}); pintar(); }; r.on('value', cb, function () { }); oy.push([r, cb]); }
  firebase.auth().onAuthStateChanged(function (u) {
    oy.forEach(function (o) { o[0].off('value', o[1]); }); oy = [];
    if (!u) return;
    on('solicitudes', function (v) { S.sol = v; cargarFotos(); });
    on('conductores', function (v) { S.cond = v; });
    on('fichas', function (v) { S.fichas = v; });
    on('perfiles', function (v) { S.perfiles = v; });
    on('docsPendientes', function (v) { S.docs = v; });
  });
  // Las fotos solo se bajan de las solicitudes pendientes
  function cargarFotos() {
    Object.keys(S.sol).forEach(function (id) {
      if (S.sol[id].estado !== 'pendiente' || S.fotos[id]) return;
      S.fotos[id] = 'cargando';
      db.ref('solicitudFotos/' + id).once('value').then(function (s) { S.fotos[id] = s.val() || {}; pintar(); }, function () { delete S.fotos[id]; });
    });
  }

  var FOTOS = [['persona', 'Foto de la persona'], ['cedula', 'Cédula'], ['licencia', 'Licencia'], ['matricula', 'Matrícula'], ['carro', 'Carro por fuera']];
  var MOT = [['borrosa', 'Las fotos no se ven bien', 'algunas fotos no se ven bien'], ['vencido', 'Documento vencido', 'uno de tus documentos está vencido'], ['datos', 'Los datos no coinciden con los documentos', 'los datos no coinciden con tus documentos'], ['cara', 'La cara no coincide con la cédula', 'tu foto no coincide con tu cédula'], ['carro', 'El carro no cumple', 'el vehículo no cumple con los requisitos']];
  var COLORES = { blanco: '#F4F5F7', negro: '#1F2329', plata: '#A9AFB8', plateado: '#A9AFB8', gris: '#6B7280', rojo: '#B3121B', azul: '#1E4FB8', verde: '#1F7A4D', amarillo: '#E8B400', dorado: '#C9A44B', beige: '#D8C8A8', cafe: '#6B4A2E', 'café': '#6B4A2E', vino: '#6E1F2B', naranja: '#E06A1B' };
  function colorHex(c) { var k = String(c || '').toLowerCase().trim().split(/\s+/)[0]; return COLORES[k] || '#F4F5F7'; }
  function usuarioDe(nombre, unidad) { var n = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)[0] || 'conductor'; return n.replace(/[^a-z]/g, '') + String(unidad).padStart(2, '0'); }
  function claveNueva() { var a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + a[0] % 900000); }
  function chipVence(iso) { if (!iso) return ''; var n = dias(iso); return n < 0 ? '<span class="pill sinsaldo">Vencida</span>' : n <= 30 ? '<span class="pill porvencer">Vence en ' + n + ' días</span>' : ''; }
  function figura(src, txt, quien, ancha) { return '<figure' + (ancha ? ' class="ancha"' : '') + '><button class="foto-t" data-ver-foto="1" data-src="' + esc(src) + '" data-txt="' + esc(quien + ' · ' + txt) + '"><img src="' + esc(src) + '" alt=""></button><figcaption>' + txt + '</figcaption></figure>'; }

  function pendientes() { return Object.keys(S.sol).filter(function (id) { return S.sol[id].estado === 'pendiente'; }).sort(function (a, b) { return S.sol[a].t - S.sol[b].t; }); }
  function tarjeta(id) {
    var s = S.sol[id], d = s.datos || {}, f = S.fotos[id], par = s.parecido || {}, al = [];
    var parecido = typeof par.cedula === 'number' ? Math.max(par.cedula, typeof par.licencia === 'number' ? par.licencia : 0) : null;
    if (!s.desc || !s.desc.persona) al.push('El teléfono no pudo leer bien la cara de la foto de la persona.');
    if (parecido != null && parecido > 0.62) al.push('La cara de la foto no se parece mucho a la de la cédula o la licencia. Revísalas bien.');
    if (parecido == null) al.push('El teléfono no encontró la cara en la cédula o la licencia: compáralas tú.');
    [['cedulaVence', 'La cédula'], ['licenciaVence', 'La licencia'], ['matriculaVence', 'La matrícula']].forEach(function (x) { var n = dias(d[x[0]]); if (n <= 30) al.push(x[1] + (n < 0 ? ' está vencida.' : ' vence en ' + n + ' días.')); });
    var fila = function (a, b) { return '<div><span>' + a + '</span><b>' + esc(b) + '</b></div>'; };
    var acc;
    if (S.aprobando === id) acc = '<div class="aprobar-sol"><label>Número de unidad <input id="sol-unidad" inputmode="numeric" maxlength="3" placeholder="Ej.: 15"></label><div class="acciones"><button class="btn" data-sol-volver="1">Volver</button><button class="btn btn-primario" data-sol-crear="' + id + '"' + (S.ocupado ? ' disabled' : '') + '>' + (S.ocupado ? 'Creando…' : 'Crear usuario y clave') + '</button></div></div>';
    else if (S.rechazando === id) acc = '<div class="rechazo"><b>¿Por qué la rechazas?</b><div class="chips">' + MOT.map(function (m) { return '<button class="chip' + (S.motivos[m[0]] ? ' activo' : '') + '" data-sol-motivo="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div><div class="acciones"><button class="btn" data-sol-volver="1">Volver</button><button class="btn btn-peligro" data-sol-rechazar-ok="' + id + '">Rechazar y avisar por WhatsApp</button></div></div>';
    else acc = '<div class="acciones"><button class="btn btn-primario" data-sol-aprobar="' + id + '">✓ Aprobar</button><button class="btn btn-peligro" data-sol-rechazar="' + id + '">Rechazar</button></div>';
    return '<article class="turno"><div class="fila"><div><strong>' + esc(d.nombre) + '</strong><div class="meta">Solicitud enviada el ' + hora(s.t) + '</div></div>' +
      '<span class="cara-ok' + (parecido == null || parecido > 0.62 ? ' mal' : '') + '">' + (parecido != null && parecido <= 0.62 ? '✓ La cara coincide con la cédula y la licencia' : 'Revisa la cara') + '</span></div>' +
      (al.length ? '<div class="duda-ia">' + al.map(esc).join(' ') + '</div>' : '') +
      '<div class="sol-datos">' + fila('Cédula', d.cedula) + fila('Nacimiento', fecha(d.nacimiento) + ' (' + edad(d.nacimiento) + ' años)') + fila('Teléfono', d.telefono) + fila('Correo', d.correo) + fila('Sector', d.sector) +
      fila('Vehículo', d.marca + ' · ' + d.color + ' · ' + d.anio) + fila('Placa', d.placa) +
      '<div><span>Vencimientos</span><b>Cédula ' + fecha(d.cedulaVence) + ' ' + chipVence(d.cedulaVence) + '<br>Licencia ' + fecha(d.licenciaVence) + ' ' + chipVence(d.licenciaVence) + '<br>Matrícula ' + fecha(d.matriculaVence) + ' ' + chipVence(d.matriculaVence) + '</b></div></div>' +
      (window.AAVerificar && d.cedula ? '<div class="acciones verif"><span>Revisar en páginas oficiales:</span>' + AAVerificar.botones(d.cedula) + '</div>' : '') +
      (f && f !== 'cargando' ? '<div class="fotos-turno"><div class="grupo"><h4>Fotos tomadas en vivo</h4><div class="g">' + FOTOS.map(function (x) { return f[x[0]] ? figura(f[x[0]], x[1], d.nombre, x[0] !== 'persona') : ''; }).join('') + '</div></div></div>' : '<p class="muted">Cargando fotos…</p>') + acc + '</article>';
  }
  function nombreDe(uid) { var c = S.cond[uid] || {}; return (c.nombre || 'Conductor') + (c.unidad ? ' · Unidad ' + c.unidad : ''); }
  function pintar() {
    var pend = pendientes(), perf = Object.keys(S.perfiles).filter(function (u) { return S.perfiles[u].estado === 'revision'; });
    var docs = []; Object.keys(S.docs).forEach(function (u) { Object.keys(S.docs[u] || {}).forEach(function (k) { docs.push([u, k, S.docs[u][k]]); }); });
    var n = pend.length + perf.length + docs.length;
    var bad = $('#badge-sol'); if (bad) { bad.textContent = n; bad.hidden = !n; }
    if (!$('#vista-solicitudes')) return;
    var creado = S.creado ? '<div class="creado"><div><b>✓ Usuario creado para ' + esc(S.creado.nombre) + '</b><p>Usuario: <code>' + esc(S.creado.usuario) + '</code> · Clave: <code>' + esc(S.creado.clave) + '</code> · Unidad ' + esc(S.creado.unidad) + '</p><p class="muted" style="margin-top:4px">Anota la clave: después no se puede volver a ver.</p></div>' +
      '<button class="btn btn-wa btn-chico" data-sol-wa="1">Enviar usuario y clave por WhatsApp</button><button class="btn btn-chico" data-sol-cerrar-creado="1">Listo</button></div>' : '';
    var html = creado + (pend.length ? pend.map(tarjeta).join('') : '<div class="vacio">No hay solicitudes nuevas.</div>');
    var el = $('#sol-lista'); if (el.__h !== html) { el.innerHTML = html; el.__h = html; }
    perf.forEach(function (u) { if (S.perfFotos[u] === undefined) { S.perfFotos[u] = null; db.ref('perfiles/' + u + '/foto').once('value').then(function (s) { S.perfFotos[u] = s.val() || ''; pintar(); }); } });
    var hp = perf.length ? perf.map(function (u) {
      var p = S.perfiles[u], f = S.perfFotos[u];
      return '<article class="turno"><div class="fila"><div><strong>' + esc(nombreDe(u)) + '</strong><div class="meta">Foto de perfil · ' + hora(p.t) + '</div></div></div>' +
        '<div class="duda-ia"><b>La revisión automática no está segura:</b> ' + esc(p.duda || '') + '</div>' +
        (f ? '<div class="fotos-turno"><div class="grupo"><h4>Foto de perfil</h4><div class="g">' + figura(f, 'Foto de perfil', nombreDe(u)) + '</div></div></div>' : '<p class="muted">Cargando foto…</p>') +
        '<div class="acciones"><button class="btn btn-primario" data-pf-ok="' + u + '">✓ Aprobar foto</button><button class="btn btn-peligro" data-pf-no="' + u + '" data-m="Tu camisa tiene estampado o no es manga larga.">Rechazar: camisa</button><button class="btn btn-peligro" data-pf-no="' + u + '" data-m="El fondo no es blanco ni gris claro.">Rechazar: fondo</button><button class="btn btn-peligro" data-pf-no="' + u + '" data-m="Tu cara no coincide con la de tu cédula y tu licencia.">Rechazar: no es él</button></div></article>';
    }).join('') : '<div class="vacio">No hay fotos de perfil por revisar.</div>';
    var ep = $('#sol-perfiles'); if (ep.__h !== hp) { ep.innerHTML = hp; ep.__h = hp; }
    var NOM = { cedula: 'Cédula', licencia: 'Licencia', matricula: 'Matrícula' };
    var venc = [];
    Object.keys(S.fichas).forEach(function (u) { if (!S.cond[u] || S.cond[u].activo === false) return; var dd = S.fichas[u].docs || {}; Object.keys(NOM).forEach(function (k) { if (dd[k] && dd[k].vence && dias(dd[k].vence) <= 30) venc.push([u, k, dd[k].vence]); }); });
    venc.sort(function (a, b) { return a[2] < b[2] ? -1 : 1; });
    var hd = docs.map(function (x) {
      var u = x[0], k = x[1], p = x[2], antes = ((S.fichas[u] || {}).docs || {})[k] || {};
      return '<article class="turno"><div class="fila"><div><strong>' + esc(nombreDe(u)) + '</strong><div class="meta">' + NOM[k] + ' renovada · nueva fecha de vencimiento: <b>' + fecha(p.vence) + '</b> (antes ' + fecha(antes.vence) + ')</div></div></div>' +
        '<div class="fotos-turno"><div class="grupo"><h4>' + NOM[k] + ' nueva</h4><div class="g">' + figura(p.foto, NOM[k], nombreDe(u), true) + '</div></div></div>' +
        '<div class="acciones"><button class="btn btn-primario" data-doc-ok="' + u + '|' + k + '">✓ Aprobar documento</button><button class="btn btn-peligro" data-doc-no="' + u + '|' + k + '">Rechazar: no se lee</button></div></article>';
    }).join('') + (venc.length ? '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Conductor</th><th>Documento</th><th>Vence</th><th></th></tr></thead><tbody>' +
      venc.map(function (v) { return '<tr><td>' + esc(nombreDe(v[0])) + '</td><td>' + NOM[v[1]] + '</td><td>' + fecha(v[2]) + '</td><td>' + chipVence(v[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="vacio">Ningún documento vencido ni por vencer en los próximos 30 días.</div>');
    var ed = $('#sol-docs'); if (ed.__h !== hd) { ed.innerHTML = hd; ed.__h = hd; }
  }

  var app2 = null;
  function auth2() { if (!app2) app2 = firebase.initializeApp(window.FIREBASE_CONFIG, 'solicitudes'); return app2.auth(); }
  function crear(id, unidad) {
    var s = S.sol[id], d = s.datos, f = S.fotos[id] || {};
    var usuario = usuarioDe(d.nombre, unidad), clave = claveNueva(), a2 = auth2();
    var usados = {}; Object.keys(S.cond).forEach(function (u) { usados[S.cond[u].usuario] = 1; if (String(S.cond[u].unidad) === String(unidad) && S.cond[u].activo !== false) usados['#u'] = S.cond[u].nombre; });
    if (usados['#u']) return Promise.reject(new Error('La unidad ' + unidad + ' ya la tiene ' + usados['#u'] + '.'));
    if (usados[usuario]) usuario = usuario + String(Date.now()).slice(-2);
    S.ocupado = true; pintar();
    return a2.createUserWithEmailAndPassword(usuario + '@' + AJ.dominioUsuarios, clave).then(function (cred) {
      var uid = cred.user.uid;
      return a2.signOut().then(function () {
        var t = Date.now(), up = {};
        up['conductores/' + uid] = { nombre: d.nombre, telefono: d.telefono, unidad: String(unidad), placa: d.placa, vehiculo: d.marca + ' ' + d.color, colorCarro: colorHex(d.color), usuario: usuario, activo: true, creado: firebase.database.ServerValue.TIMESTAMP };
        up['saldos/' + uid + '/saldoC'] = 0;
        up['fichas/' + uid] = { nombre: d.nombre, cedula: d.cedula, nacimiento: d.nacimiento, sector: d.sector, telefono: d.telefono, correo: d.correo, placa: d.placa, marca: d.marca, color: d.color, anio: d.anio, desde: t, solicitud: id,
          docs: { cedula: { vence: d.cedulaVence }, licencia: { vence: d.licenciaVence }, matricula: { vence: d.matriculaVence } } };
        up['fichaFotos/' + uid] = { persona: f.persona || null, cedula: f.cedula || null, licencia: f.licencia || null, matricula: f.matricula || null, carro: f.carro || null };
        // Identidad para la verificación diaria: SU foto del registro y SU cédula
        if (s.desc && s.desc.persona) up['identidad/' + uid] = { estado: 'aprobada', descriptor: s.desc.persona, descCedula: (s.desc && s.desc.cedula) || null, descLicencia: (s.desc && s.desc.licencia) || null, t: t, aprobadaT: t, origen: 'solicitud' };
        up['solicitudes/' + id + '/estado'] = 'aprobada'; up['solicitudes/' + id + '/uid'] = uid; up['solicitudes/' + id + '/aprobadaT'] = t;
        up['solicitudesCedula/' + d.cedula] = { estado: 'aprobada', id: id, t: t };
        up['solicitudFotos/' + id] = null;
        return db.ref().update(up).then(function () {
          S.creado = { nombre: d.nombre, usuario: usuario, clave: clave, unidad: unidad, tel: d.telefono,
            msg: '¡Hola ' + d.nombre.split(' ')[0] + '! 🎉 Tu solicitud para ser parte de *AutoAmigo* fue aprobada.\n\nEntra a la app con:\n*Usuario:* ' + usuario + '\n*Clave:* ' + clave + '\n*Unidad:* ' + unidad + '\n\nApenas entres, tómate tu foto de perfil. ¡Bienvenido!' };
        });
      });
    }).then(function () { S.ocupado = false; S.aprobando = null; pintar(); toast('Usuario creado. Envíale los datos por WhatsApp.'); }, function (e) { S.ocupado = false; pintar(); throw e; });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-sol-aprobar],[data-sol-rechazar],[data-sol-volver],[data-sol-crear],[data-sol-motivo],[data-sol-rechazar-ok],[data-sol-cerrar-creado],[data-sol-wa],[data-pf-ok],[data-pf-no],[data-doc-ok],[data-doc-no],.menu-item[data-vista]');
    if (!b) return;
    if (b.matches('.menu-item[data-vista]')) { setTimeout(pintar, 0); return; }
    var id;
    if ((id = b.getAttribute('data-sol-aprobar'))) { S.aprobando = id; S.rechazando = null; pintar(); setTimeout(function () { var i = $('#sol-unidad'); if (i) i.focus(); }, 30); return; }
    if ((id = b.getAttribute('data-sol-rechazar'))) { S.rechazando = id; S.aprobando = null; S.motivos = {}; pintar(); return; }
    if (b.hasAttribute('data-sol-volver')) { S.aprobando = S.rechazando = null; pintar(); return; }
    if (b.hasAttribute('data-sol-motivo')) { var k = b.getAttribute('data-sol-motivo'); S.motivos[k] = !S.motivos[k]; pintar(); return; }
    if ((id = b.getAttribute('data-sol-crear'))) {
      var u = ($('#sol-unidad').value || '').trim();
      if (!/^\d{1,3}$/.test(u)) { toast('Escribe el número de unidad.', true); return; }
      crear(id, u).catch(function (er) { toast('No se pudo crear: ' + (er && er.message || er), true); });
      return;
    }
    if (b.hasAttribute('data-sol-wa')) { if (S.creado) abrirWA(S.creado.tel, S.creado.msg); return; }
    if (b.hasAttribute('data-sol-cerrar-creado')) { S.creado = null; pintar(); return; }
    if ((id = b.getAttribute('data-sol-rechazar-ok'))) {
      var sel = MOT.filter(function (m) { return S.motivos[m[0]]; });
      if (!sel.length) { toast('Elige al menos un motivo.', true); return; }
      var s = S.sol[id], d = s.datos || {};
      var up = {}; up['solicitudes/' + id + '/estado'] = 'rechazada'; up['solicitudes/' + id + '/motivo'] = sel.map(function (m) { return m[1]; }).join(', ');
      up['solicitudesCedula/' + d.cedula] = null; up['solicitudFotos/' + id] = null;
      db.ref().update(up).then(function () {
        abrirWA(d.telefono, 'Hola ' + String(d.nombre).split(' ')[0] + ', gracias por querer ser parte de *AutoAmigo*. Por ahora no pudimos aprobar tu solicitud porque ' + sel.map(function (m) { return m[2]; }).join(' y ') + '. Puedes corregirlo y enviarla otra vez desde la app.');
        S.rechazando = null; pintar(); toast('Solicitud rechazada.');
      }, function (er) { toast('No se pudo guardar: ' + er.message, true); });
      return;
    }
    if ((id = b.getAttribute('data-pf-ok'))) {
      var up2 = {}; up2['perfiles/' + id + '/estado'] = 'aprobada'; up2['perfiles/' + id + '/por'] = 'central'; up2['perfiles/' + id + '/duda'] = null; up2['conductores/' + id + '/foto'] = S.perfFotos[id] || null;
      db.ref().update(up2).then(function () { toast('Foto de perfil aprobada.'); }); return;
    }
    if ((id = b.getAttribute('data-pf-no'))) {
      var up3 = {}; up3['perfiles/' + id + '/estado'] = 'rechazada'; up3['perfiles/' + id + '/por'] = 'central'; up3['perfiles/' + id + '/motivo'] = b.getAttribute('data-m'); up3['perfiles/' + id + '/foto'] = null; up3['perfiles/' + id + '/duda'] = null;
      db.ref().update(up3).then(function () { toast('Foto rechazada. Al conductor le llegó el motivo.'); }); return;
    }
    if ((id = b.getAttribute('data-doc-ok') || b.getAttribute('data-doc-no'))) {
      var p = id.split('|'), uid = p[0], doc = p[1], ok = b.hasAttribute('data-doc-ok'), pend = (S.docs[uid] || {})[doc] || {}, up4 = {};
      if (ok) { up4['fichas/' + uid + '/docs/' + doc + '/vence'] = pend.vence; up4['fichaFotos/' + uid + '/' + doc] = pend.foto; }
      up4['docsPendientes/' + uid + '/' + doc] = null;
      db.ref().update(up4).then(function () { toast(ok ? 'Documento aprobado. Se actualizó la fecha de vencimiento.' : 'Documento rechazado. El conductor deberá enviarlo otra vez.'); }); return;
    }
  });
  setInterval(pintar, 60000);
})();
