/*
 * PRUEBA · Solicitudes de conductores nuevos, fotos de perfil y documentos.
 * - Solicitud nueva: datos + 5 fotos en vivo. El teléfono compara la cara de la foto con la cédula y la licencia.
 *   Aprobar crea el usuario y la clave y abre WhatsApp con el mensaje listo para el número que registró.
 * - Fotos de perfil: la revisión automática aprueba o rechaza sola; aquí solo llegan las dudosas.
 * - Documentos: los que vencieron o están por vencer, y los renovados que mandó el conductor para aprobar.
 * Las solicitudes que se envían desde la app de prueba (en este mismo navegador) también aparecen aquí.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fecha(iso) { if (!iso) return '—'; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function hoyISO(d) { var x = new Date(); x.setDate(x.getDate() + (d || 0)); return x.toISOString().slice(0, 10); }
  function dias(iso) { return Math.round((new Date(iso + 'T12:00:00') - new Date()) / 86400000); }
  function hora(ms) { var d = new Date(ms); return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' }) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function edad(iso) { return Math.floor((new Date() - new Date(iso)) / (365.25 * 86400000)); }
  function toast(m) { var t = $('#toast'); if (!t) return; t.textContent = m; t.className = 'toast'; t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, 3500); }
  function uri(s, w, h) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + (w || 400) + '" height="' + (h || 300) + '">' + s + '</svg>'); }
  var EJ = {
    persona: uri('<rect width="300" height="400" fill="#E9ECF2"/><circle cx="150" cy="165" r="68" fill="#B07C55"/><path d="M82 155c0-55 136-55 136 0-12-30-124-30-136 0z" fill="#2A211B"/><path d="M40 400c10-90 210-90 220 0z" fill="#DCE6F5"/>', 300, 400),
    cedula: uri('<rect width="400" height="300" fill="#8F99A8"/><rect x="40" y="50" width="320" height="200" rx="16" fill="#DCE6F5"/><rect x="60" y="80" width="100" height="130" rx="8" fill="#fff"/><circle cx="110" cy="130" r="30" fill="#B07C55"/><rect x="180" y="90" width="150" height="12" rx="6" fill="#7F8EA8"/><rect x="180" y="115" width="120" height="10" rx="5" fill="#9AA8C2"/>'),
    licencia: uri('<rect width="400" height="300" fill="#8F99A8"/><rect x="40" y="50" width="320" height="200" rx="16" fill="#FCE7C8"/><rect x="40" y="50" width="320" height="34" rx="16" fill="#E8A33D"/><rect x="60" y="100" width="90" height="120" rx="8" fill="#fff"/><circle cx="105" cy="145" r="26" fill="#B07C55"/>'),
    matricula: uri('<rect width="400" height="300" fill="#8F99A8"/><rect x="40" y="40" width="320" height="220" rx="10" fill="#F4F5F7"/><rect x="60" y="60" width="280" height="26" rx="4" fill="#3B6FB6"/><rect x="60" y="105" width="200" height="10" rx="5" fill="#9AA8C2"/><rect x="60" y="130" width="240" height="10" rx="5" fill="#9AA8C2"/>'),
    carro: uri('<rect width="400" height="300" fill="#BFD7EA"/><rect y="210" width="400" height="90" fill="#8F99A8"/><rect x="50" y="160" width="300" height="80" rx="20" fill="#A9AFB8"/><path d="M110 165l30-45h120l30 45z" fill="#2B3E55"/><circle cx="110" cy="248" r="24" fill="#222"/><circle cx="290" cy="248" r="24" fill="#222"/><rect x="170" y="215" width="60" height="18" rx="3" fill="#FFD54A"/>')
  };
  var FOTOS = [['persona', 'Foto de la persona'], ['cedula', 'Cédula'], ['licencia', 'Licencia'], ['matricula', 'Matrícula'], ['carro', 'Carro por fuera']];
  var ahora = Date.now();
  var EJEMPLOS = [
    { id: 'e1', t: ahora - 40 * 60000, parecido: 0.38, datos: { nombre: 'Jorge Luis Ramírez Cedeño', cedula: '0918273645', cedulaVence: hoyISO(1400), nacimiento: '1985-09-03', telefono: '0984561230', correo: 'jorge.ramirez85@gmail.com', sector: 'Bastión Popular, bloque 5', licenciaVence: hoyISO(700), placa: 'GSB-4410', marca: 'Hyundai Accent', color: 'Rojo', anio: '2017', matriculaVence: hoyISO(160) }, fotos: EJ },
    { id: 'e2', t: ahora - 12 * 60000, parecido: 0.61, datos: { nombre: 'Kevin Andrés Mora Plaza', cedula: '0954321876', cedulaVence: hoyISO(2100), nacimiento: '1999-02-17', telefono: '0967788990', correo: 'kevinmora99@hotmail.com', sector: 'Flor de Bastión', licenciaVence: hoyISO(12), placa: 'GTC-0912', marca: 'Kia Picanto', color: 'Gris', anio: '2021', matriculaVence: hoyISO(300) }, fotos: EJ }
  ];
  var S = { hechas: {}, aprobando: null, rechazando: null, motivos: {}, creado: null,
    perfiles: [{ id: 'p1', nombre: 'Rosa Vélez', unidad: '26', duda: 'La camisa parece tener un logo pequeño en el pecho.', foto: EJ.persona, cedula: EJ.cedula, t: ahora - 25 * 60000 }],
    docsNuevos: [{ id: 'd1', nombre: 'Pedro Alvarado', unidad: '03', doc: 'Licencia', vence: hoyISO(1825), foto: EJ.licencia, antes: hoyISO(-2), t: ahora - 8 * 60000 }],
    porVencer: [{ nombre: 'Pedro Alvarado', unidad: '03', doc: 'Licencia', vence: hoyISO(-2) }, { nombre: 'Milca Fierro', unidad: '08', doc: 'Matrícula', vence: hoyISO(9) }, { nombre: 'Luis Peña', unidad: '12', doc: 'Cédula', vence: hoyISO(25) }]
  };
  function solicitudes() {
    var mias = []; try { mias = JSON.parse(localStorage.getItem('aa_sim_solicitudes') || '[]'); } catch (e) { }
    return EJEMPLOS.concat(mias.map(function (m) { m.parecido = m.parecido == null ? 0.42 : m.parecido; m.app = true; return m; })).filter(function (s) { return !S.hechas[s.id]; });
  }
  var MOT = [['borrosa', 'Las fotos no se ven bien', 'algunas fotos no se ven bien'], ['vencido', 'Documento vencido', 'uno de tus documentos está vencido'], ['datos', 'Los datos no coinciden con los documentos', 'los datos no coinciden con tus documentos'], ['cara', 'La cara no coincide con la cédula', 'tu foto no coincide con tu cédula'], ['carro', 'El carro no cumple', 'el vehículo no cumple con los requisitos']];
  function usuarioDe(nombre, unidad) { var n = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)[0] || 'conductor'; return n.replace(/[^a-z]/g, '') + String(unidad).padStart(2, '0'); }
  function claveNueva() { var c = ''; for (var i = 0; i < 6; i++) c += Math.floor(Math.random() * 10); return c; }
  function wa(tel, txt) { var n = String(tel).replace(/\D/g, ''); if (n[0] === '0') n = '593' + n.slice(1); return (/Android|iPhone|Mobile/i.test(navigator.userAgent) ? 'https://wa.me/' + n + '?text=' : 'whatsapp://send?phone=' + n + '&text=') + encodeURIComponent(txt); }

  function chipVence(iso) { var n = dias(iso); return n < 0 ? '<span class="pill sinsaldo">Vencida</span>' : n <= 30 ? '<span class="pill porvencer">Vence en ' + n + ' días</span>' : ''; }
  function tarjeta(s) {
    var d = s.datos, alertas = [];
    if (s.parecido > 0.5) alertas.push('La cara de la foto no se parece mucho a la de la cédula y la licencia. Revísalas bien.');
    [['cedulaVence', 'La cédula'], ['licenciaVence', 'La licencia'], ['matriculaVence', 'La matrícula']].forEach(function (x) { var n = dias(d[x[0]]); if (n <= 30) alertas.push(x[1] + ' vence en ' + n + ' días.'); });
    var foto = function (k, t) { return '<figure' + (k === 'persona' ? '' : ' class="ancha"') + '><button class="foto-t" data-ver-foto="1" data-src="' + esc(s.fotos[k]) + '" data-txt="' + esc(d.nombre + ' · ' + t) + '"><img src="' + s.fotos[k] + '" alt=""></button><figcaption>' + t + '</figcaption></figure>'; };
    var fila = function (a, b) { return '<div><span>' + a + '</span><b>' + esc(b) + '</b></div>'; };
    var accion;
    if (S.aprobando === s.id) {
      accion = '<div class="aprobar-sol"><label>Número de unidad <input id="sol-unidad" inputmode="numeric" maxlength="3" placeholder="Ej.: 15"></label>' +
        '<div class="acciones"><button class="btn" data-sol-volver="1">Volver</button><button class="btn btn-primario" data-sol-crear="' + s.id + '">Crear usuario y clave</button></div></div>';
    } else if (S.rechazando === s.id) {
      accion = '<div class="rechazo"><b>¿Por qué la rechazas?</b><div class="chips">' + MOT.map(function (m) { return '<button class="chip' + (S.motivos[m[0]] ? ' activo' : '') + '" data-sol-motivo="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>' +
        '<div class="acciones"><button class="btn" data-sol-volver="1">Volver</button><button class="btn btn-peligro" data-sol-rechazar-ok="' + s.id + '">Rechazar y avisar por WhatsApp</button></div></div>';
    } else accion = '<div class="acciones"><button class="btn btn-primario" data-sol-aprobar="' + s.id + '">✓ Aprobar</button><button class="btn btn-peligro" data-sol-rechazar="' + s.id + '">Rechazar</button></div>';
    return '<article class="turno">' +
      '<div class="fila"><div><strong>' + esc(d.nombre) + '</strong>' + (s.app ? ' <span class="pill libre">Enviada desde la app de prueba</span>' : '') + '<div class="meta">Solicitud enviada el ' + hora(s.t) + '</div></div>' +
      '<span class="cara-ok' + (s.parecido > 0.5 ? ' mal' : '') + '">' + (s.parecido <= 0.5 ? '✓ La cara coincide con la cédula y la licencia' : 'La cara no coincide bien') + '</span></div>' +
      (alertas.length ? '<div class="duda-ia">' + alertas.map(esc).join(' ') + '</div>' : '') +
      '<div class="sol-datos">' + fila('Cédula', d.cedula) + fila('Nacimiento', fecha(d.nacimiento) + ' (' + edad(d.nacimiento) + ' años)') + fila('Teléfono', d.telefono) + fila('Correo', d.correo) + fila('Sector', d.sector) +
      fila('Vehículo', d.marca + ' · ' + d.color + ' · ' + d.anio) + fila('Placa', d.placa) +
      '<div><span>Vencimientos</span><b>Cédula ' + fecha(d.cedulaVence) + ' ' + chipVence(d.cedulaVence) + '<br>Licencia ' + fecha(d.licenciaVence) + ' ' + chipVence(d.licenciaVence) + '<br>Matrícula ' + fecha(d.matriculaVence) + ' ' + chipVence(d.matriculaVence) + '</b></div></div>' +
      '<div class="fotos-turno"><div class="grupo"><h4>Fotos tomadas en vivo</h4><div class="g">' + FOTOS.map(function (f) { return foto(f[0], f[1]); }).join('') + '</div></div></div>' + accion + '</article>';
  }
  function pintar() {
    var lista = solicitudes(), n = lista.length + S.perfiles.length + S.docsNuevos.length;
    var bad = $('#badge-sol'); if (bad) { bad.textContent = n; bad.hidden = !n; }
    var el = $('#vista-solicitudes'); if (!el) return;
    var creado = S.creado ? '<div class="creado"><div><b>✓ Usuario creado para ' + esc(S.creado.nombre) + '</b><p>Usuario: <code>' + esc(S.creado.usuario) + '</code> · Clave: <code>' + esc(S.creado.clave) + '</code> · Unidad ' + esc(S.creado.unidad) + '</p></div>' +
      '<a class="btn btn-wa btn-chico" href="' + wa(S.creado.tel, S.creado.msg) + '">Enviar usuario y clave por WhatsApp</a><button class="btn btn-chico" data-sol-cerrar-creado="1">Listo</button></div>' : '';
    $('#sol-lista').innerHTML = creado + (lista.length ? lista.map(tarjeta).join('') : '<div class="vacio">No hay solicitudes nuevas.</div>');
    $('#sol-perfiles').innerHTML = S.perfiles.length ? S.perfiles.map(function (p) {
      return '<article class="turno"><div class="fila"><div><strong>' + esc(p.nombre) + ' · Unidad ' + p.unidad + '</strong><div class="meta">Foto de perfil · ' + hora(p.t) + '</div></div><span class="cara-ok">✓ Coincide con la cédula y la licencia</span></div>' +
        '<div class="duda-ia"><b>La revisión automática no está segura:</b> ' + esc(p.duda) + '</div>' +
        '<div class="fotos-turno"><div class="grupo"><h4>Foto de perfil</h4><div class="g"><figure><button class="foto-t" data-ver-foto="1" data-src="' + esc(p.foto) + '" data-txt="Foto de perfil"><img src="' + p.foto + '"></button></figure></div></div>' +
        '<div class="grupo"><h4>Cédula</h4><div class="g"><figure class="ancha"><button class="foto-t" data-ver-foto="1" data-src="' + esc(p.cedula) + '" data-txt="Cédula"><img src="' + p.cedula + '"></button></figure></div></div></div>' +
        '<div class="acciones"><button class="btn btn-primario" data-pf-ok="' + p.id + '">✓ Aprobar foto</button><button class="btn btn-peligro" data-pf-no="' + p.id + '">Rechazar: camisa con estampado</button></div></article>';
    }).join('') : '<div class="vacio">No hay fotos de perfil por revisar.</div>';
    $('#sol-docs').innerHTML = (S.docsNuevos.length ? S.docsNuevos.map(function (d) {
      return '<article class="turno"><div class="fila"><div><strong>' + esc(d.nombre) + ' · Unidad ' + d.unidad + '</strong><div class="meta">' + d.doc + ' renovada · nueva fecha de vencimiento: <b>' + fecha(d.vence) + '</b> (antes ' + fecha(d.antes) + ')</div></div></div>' +
        '<div class="fotos-turno"><div class="grupo"><h4>' + d.doc + ' nueva</h4><div class="g"><figure class="ancha"><button class="foto-t" data-ver-foto="1" data-src="' + esc(d.foto) + '" data-txt="' + d.doc + '"><img src="' + d.foto + '"></button></figure></div></div></div>' +
        '<div class="acciones"><button class="btn btn-primario" data-doc-ok="' + d.id + '">✓ Aprobar documento</button><button class="btn btn-peligro" data-doc-no="' + d.id + '">Rechazar: no se lee</button></div></article>';
    }).join('') : '') +
      '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Conductor</th><th>Documento</th><th>Vence</th><th></th></tr></thead><tbody>' +
      S.porVencer.map(function (v) { return '<tr><td>' + esc(v.nombre) + ' · U' + v.unidad + '</td><td>' + v.doc + '</td><td>' + fecha(v.vence) + '</td><td>' + (chipVence(v.vence) || '<span class="pill libre">Vigente</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-sol-aprobar],[data-sol-rechazar],[data-sol-volver],[data-sol-crear],[data-sol-motivo],[data-sol-rechazar-ok],[data-sol-cerrar-creado],[data-pf-ok],[data-pf-no],[data-doc-ok],[data-doc-no],.menu-item[data-vista]');
    if (!b) return;
    if (b.matches('.menu-item[data-vista]')) { setTimeout(pintar, 0); return; }
    var id;
    if ((id = b.getAttribute('data-sol-aprobar'))) { S.aprobando = id; S.rechazando = null; pintar(); setTimeout(function () { var i = $('#sol-unidad'); if (i) i.focus(); }, 30); return; }
    if ((id = b.getAttribute('data-sol-rechazar'))) { S.rechazando = id; S.aprobando = null; S.motivos = {}; pintar(); return; }
    if (b.hasAttribute('data-sol-volver')) { S.aprobando = S.rechazando = null; pintar(); return; }
    if (b.hasAttribute('data-sol-motivo')) { var k = b.getAttribute('data-sol-motivo'); S.motivos[k] = !S.motivos[k]; pintar(); return; }
    if ((id = b.getAttribute('data-sol-crear'))) {
      var u = ($('#sol-unidad').value || '').trim();
      if (!/^\d{1,3}$/.test(u)) { toast('Escribe el número de unidad.'); return; }
      var s = solicitudes().filter(function (x) { return x.id === id; })[0];
      var us = usuarioDe(s.datos.nombre, u), cl = claveNueva(), nom = s.datos.nombre.split(' ')[0];
      S.creado = { nombre: s.datos.nombre, usuario: us, clave: cl, unidad: u, tel: s.datos.telefono,
        msg: '¡Hola ' + nom + '! 🎉 Tu solicitud para ser parte de *AutoAmigo* fue aprobada.\n\nDescarga la app y entra con:\n*Usuario:* ' + us + '\n*Clave:* ' + cl + '\n*Unidad:* ' + u + '\n\nApenas entres, tómate tu foto de perfil. ¡Bienvenido!' };
      S.hechas[id] = true; S.aprobando = null; pintar(); toast('Usuario creado. Envíale los datos por WhatsApp.'); return;
    }
    if ((id = b.getAttribute('data-sol-rechazar-ok'))) {
      var sel = MOT.filter(function (m) { return S.motivos[m[0]]; });
      if (!sel.length) { toast('Elige al menos un motivo.'); return; }
      var s2 = solicitudes().filter(function (x) { return x.id === id; })[0];
      var txt = 'Hola ' + s2.datos.nombre.split(' ')[0] + ', gracias por querer ser parte de *AutoAmigo*. Por ahora no pudimos aprobar tu solicitud porque ' + sel.map(function (m) { return m[2]; }).join(' y ') + '. Puedes corregirlo y enviarla otra vez desde la app.';
      window.location.href = wa(s2.datos.telefono, txt);
      S.hechas[id] = true; S.rechazando = null; pintar(); toast('Solicitud rechazada. Se abrió WhatsApp con el motivo.'); return;
    }
    if (b.hasAttribute('data-sol-cerrar-creado')) { S.creado = null; pintar(); return; }
    if ((id = b.getAttribute('data-pf-ok') || b.getAttribute('data-pf-no'))) { var ok = b.hasAttribute('data-pf-ok'); S.perfiles = S.perfiles.filter(function (p) { return p.id !== id; }); pintar(); toast(ok ? 'Foto de perfil aprobada.' : 'Foto rechazada. Al conductor le llegó el motivo.'); return; }
    if ((id = b.getAttribute('data-doc-ok') || b.getAttribute('data-doc-no'))) {
      var ok2 = b.hasAttribute('data-doc-ok'), d = S.docsNuevos.filter(function (x) { return x.id === id; })[0];
      S.docsNuevos = S.docsNuevos.filter(function (x) { return x.id !== id; });
      if (ok2) S.porVencer = S.porVencer.filter(function (v) { return !(v.nombre === d.nombre && v.doc === d.doc); });
      pintar(); toast(ok2 ? 'Documento aprobado. Se actualizó la fecha de vencimiento.' : 'Documento rechazado. Al conductor le llegó el motivo.'); return;
    }
  });
  pintar();
})();
