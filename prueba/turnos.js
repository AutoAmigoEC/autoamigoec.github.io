/*
 * PRUEBA · Turnos por aprobar.
 * Al empezar el turno (una vez al día) el conductor manda: selfie (ya comparado con su cédula en el teléfono),
 * foto de la camisa, foto de los pies y 3 fotos del carro. La central aprueba o rechaza con un motivo.
 * Aquí todo es de ejemplo (dibujos); en el sistema real las fotos llegan desde la app del conductor.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hora(ms) { var d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function uri(s) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">' + s + '</svg>'); }

  // ---- Dibujos de ejemplo ----
  function persona(piel, pelo, camisa, gorra) {
    return uri('<rect width="300" height="400" fill="#B8C4D6"/><circle cx="150" cy="170" r="70" fill="' + piel + '"/>' +
      (gorra ? '<path d="M78 160c0-70 144-70 144 0z" fill="' + gorra + '"/><rect x="60" y="150" width="120" height="16" rx="8" fill="' + gorra + '"/>'
             : '<path d="M80 160c0-55 140-55 140 0-12-30-128-30-140 0z" fill="' + pelo + '"/>') +
      '<path d="M40 400c10-90 210-90 220 0z" fill="' + camisa + '"/><path d="M125 318l25 30 25-30" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="6"/>');
  }
  function cedula(piel, pelo) {
    return uri('<rect width="300" height="400" fill="#DCE6F5"/><rect x="40" y="60" width="220" height="260" rx="14" fill="#fff"/><circle cx="150" cy="160" r="52" fill="' + piel + '"/>' +
      '<path d="M98 150c0-40 104-40 104 0-8-22-96-22-104 0z" fill="' + pelo + '"/><path d="M70 320c8-60 152-60 160 0z" fill="#3B4A6B"/>' +
      '<rect x="60" y="340" width="180" height="12" rx="6" fill="#9AA8C2"/><rect x="60" y="362" width="120" height="10" rx="5" fill="#B9C3D6"/>');
  }
  function pies(tipo) {
    var piso = '<rect width="300" height="400" fill="#8F99A8"/><path d="M0 120h300M0 250h300M100 0v400M200 0v400" stroke="#7E8897" stroke-width="3"/>';
    if (tipo === 'short') return uri(piso + '<rect x="56" y="0" width="82" height="90" fill="#3E5C8A"/><rect x="162" y="0" width="82" height="90" fill="#3E5C8A"/>' +
      '<rect x="72" y="90" width="50" height="195" fill="#C89A72"/><rect x="178" y="90" width="50" height="195" fill="#C89A72"/>' +
      '<path d="M52 282h86v38c0 14-10 22-24 22H40c-14 0-18-14-6-22z" fill="#111"/><path d="M162 282h86v38c0 14-10 22-24 22h-74c-14 0-18-14-6-22z" fill="#111"/>');
    var zap = tipo === 'zapatillas'
      ? '<path d="M48 280h92v44c0 12-8 20-22 20H36c-14 0-18-16-4-24z" fill="#F4F5F7"/><path d="M60 300l60-10M62 314l64-10" stroke="#E5252A" stroke-width="6"/><rect x="34" y="334" width="106" height="12" rx="6" fill="#D0D5DD"/>' +
        '<path d="M160 280h92v44c0 12-8 20-22 20h-82c-14 0-18-16-4-24z" fill="#F4F5F7"/><path d="M172 300l60-10M174 314l64-10" stroke="#E5252A" stroke-width="6"/><rect x="146" y="334" width="106" height="12" rx="6" fill="#D0D5DD"/>'
      : '<path d="M52 282h86v38c0 14-10 22-24 22H40c-14 0-18-14-6-22z" fill="#111"/><path d="M162 282h86v38c0 14-10 22-24 22h-74c-14 0-18-14-6-22z" fill="#111"/>';
    return uri(piso + '<rect x="62" y="0" width="70" height="285" fill="#1F2A44"/><rect x="168" y="0" width="70" height="285" fill="#1F2A44"/>' + zap);
  }
  function carro(i, sucio) {
    var b = ['<rect width="300" height="400" fill="#3B3F46"/><rect x="20" y="60" width="115" height="290" rx="30" fill="#5A606B"/><rect x="165" y="60" width="115" height="290" rx="30" fill="#5A606B"/><rect x="128" y="250" width="44" height="110" rx="10" fill="#2B2E33"/>',
      '<rect width="300" height="400" fill="#3B3F46"/><rect x="15" y="80" width="270" height="200" rx="34" fill="#5A606B"/><rect x="15" y="270" width="270" height="70" rx="20" fill="#4C525C"/>',
      '<rect width="300" height="400" fill="#2B2E33"/><rect x="30" y="90" width="240" height="250" rx="16" fill="#3A3E45"/><path d="M50 120h200M50 160h200M50 200h200M50 240h200M50 280h200" stroke="#30343A" stroke-width="10"/>'][i];
    if (sucio) b += '<rect x="60" y="150" width="70" height="40" rx="6" fill="#E9E3D2" transform="rotate(-14 95 170)"/><circle cx="200" cy="250" r="22" fill="#C2410C"/><rect x="150" y="300" width="60" height="22" rx="4" fill="#F5F5F5" transform="rotate(20 180 311)"/><circle cx="90" cy="300" r="9" fill="#A16207"/><circle cx="110" cy="320" r="6" fill="#A16207"/>';
    return uri(b);
  }

  var ahora = Date.now(), MIN = 60000;
  function turno(id, nombre, unidad, hace, piel, pelo, camisa, gorra, tipoPies, sucio, parecido) {
    return { id: id, nombre: nombre, unidad: unidad, t: ahora - hace * MIN, parecido: parecido,
      fotos: { cedula: cedula(piel, pelo), selfie: persona(piel, pelo, camisa, null), pecho: persona(piel, pelo, camisa, gorra), pies: pies(tipoPies),
        carro: [carro(0, sucio), carro(1, sucio), carro(2, false)] } };
  }
  var T = {
    pendientes: [
      turno('t1', 'Rosa Vélez', '26', 4, '#E0B48A', '#3B2A20', '#F4F5F7', null, 'zapatos', false, 97),
      turno('t2', 'Milca Fierro', '08', 2, '#C89A72', '#1E1A17', '#DCE6F5', '#E5252A', 'zapatos', false, 95),
      turno('t3', 'Luis Peña', '12', 1, '#B07C55', '#2A211B', '#F4F5F7', null, 'zapatillas', true, 96)
    ],
    hechos: [
      { nombre: 'Carlos Mendoza', unidad: '07', aprobado: true, a: ahora - 95 * MIN },
      { nombre: 'Pedro Alvarado', unidad: '03', aprobado: true, a: ahora - 70 * MIN }
    ],
    rechazando: null, motivos: {}, otro: ''
  };
  // Llega uno nuevo al minuto, para ver cómo avisa
  setTimeout(function () { T.pendientes.push(turno('t4', 'Andrés Cedeño', '15', 0, '#D7A47C', '#2A211B', '#F4F5F7', null, 'short', false, 94)); pintar(); avisoNuevo('Andrés Cedeño · U15 envió su turno para aprobar.'); }, 60000);

  var MOTIVOS = [['gorra', 'Está con gorra'], ['camisa', 'No tiene camisa'], ['zapatillas', 'Está con zapatillas'], ['short', 'Está en short'],
    ['carro', 'Carro sucio'], ['foto', 'Las fotos no se ven bien'], ['otro', 'No es el conductor']];

  function tarjeta(p) {
    var foto = function (src, txt) { return '<figure><button class="foto-t" data-ver-foto="' + p.id + '" data-src="' + esc(src) + '" data-txt="' + esc(p.nombre + ' · ' + txt) + '"><img src="' + src + '" alt=""></button><figcaption>' + txt + '</figcaption></figure>'; };
    var rech = T.rechazando === p.id;
    return '<article class="turno" id="turno-' + p.id + '">' +
      '<div class="fila"><div><strong>' + esc(p.nombre) + '</strong> · Unidad ' + esc(p.unidad) + '<div class="meta">Envió a las ' + hora(p.t) + '</div></div>' +
      '<span class="cara-ok">✓ La cara coincide con la cédula (' + p.parecido + '%)</span></div>' +
      '<div class="fotos-turno">' +
        '<div class="grupo"><h4>Identidad</h4><div class="g">' + foto(p.fotos.cedula, 'Cédula') + foto(p.fotos.selfie, 'Selfie de hoy') + '</div></div>' +
        '<div class="grupo"><h4>Vestimenta</h4><div class="g">' + foto(p.fotos.pecho, 'Camisa · sin gorra') + foto(p.fotos.pies, 'Zapatos · pantalón') + '</div></div>' +
        '<div class="grupo"><h4>Carro</h4><div class="g">' + foto(p.fotos.carro[0], 'Adelante') + foto(p.fotos.carro[1], 'Atrás') + foto(p.fotos.carro[2], 'Piso') + '</div></div>' +
      '</div>' +
      (rech
        ? '<div class="rechazo"><b>¿Por qué lo rechazas?</b><div class="chips">' + MOTIVOS.map(function (m) { return '<button class="chip' + (T.motivos[m[0]] ? ' activo' : '') + '" data-motivo="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>' +
          '<input id="motivo-otro" placeholder="Otro motivo (opcional)" value="' + esc(T.otro) + '">' +
          '<div class="acciones"><button class="btn" data-cancelar-rechazo="1">Volver</button><button class="btn btn-peligro" data-confirmar-rechazo="' + p.id + '">Rechazar y avisar al conductor</button></div></div>'
        : '<div class="acciones"><button class="btn btn-primario" data-aprobar-turno="' + p.id + '">✓ Aprobar turno</button><button class="btn btn-peligro" data-rechazar-turno="' + p.id + '">Rechazar</button></div>') +
      '</article>';
  }
  function pintar() {
    var n = T.pendientes.length;
    var bad = $('#badge-turnos'); if (bad) { bad.textContent = n; bad.hidden = !n; }
    var sub = $('#turnos-sub'); if (sub) sub.textContent = n ? n + ' conductor' + (n > 1 ? 'es esperan' : ' espera') + ' para poder conectarse.' : 'No hay turnos por aprobar.';
    var lista = $('#lista-turnos');
    if (lista) lista.innerHTML = n ? T.pendientes.map(tarjeta).join('') : '<div class="vacio">No hay turnos por aprobar. Cuando un conductor empiece su turno, aparecerá aquí.</div>';
    var hechos = $('#turnos-hechos');
    if (hechos) hechos.innerHTML = T.hechos.length ? '<table class="tabla"><thead><tr><th>Conductor</th><th>Resultado</th><th>Hora</th></tr></thead><tbody>' +
      T.hechos.slice().reverse().map(function (h) {
        return '<tr><td>' + esc(h.nombre) + ' · U' + esc(h.unidad) + '</td><td>' + (h.aprobado ? '<span class="pill libre">Aprobado</span>' : '<span class="pill sinsaldo">Rechazado</span> <small>' + esc(h.motivo) + '</small>') + '</td><td>' + hora(h.a) + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
    // Aviso arriba en cualquier vista
    var av = $('#aviso-turnos');
    if (av) {
      av.hidden = !n || !$('#vista-turnos').hidden;
      av.innerHTML = '<span class="texto"><strong>' + n + ' turno' + (n > 1 ? 's' : '') + ' por aprobar.</strong> ' + (n > 1 ? 'Estos conductores no pueden' : 'Este conductor no puede') + ' conectarse hasta que ' + (n > 1 ? 'los' : 'lo') + ' apruebes.</span><button class="btn btn-primario btn-chico" data-ir-turnos="1">Revisar</button>';
    }
  }
  function toastT(m) { var t = $('#toast'); if (!t) return; t.textContent = m; t.className = 'toast'; t.hidden = false; clearTimeout(toastT.x); toastT.x = setTimeout(function () { t.hidden = true; }, 3500); }
  function avisoNuevo(m) {
    toastT(m);
    try { var A = new (window.AudioContext || window.webkitAudioContext)(), o = A.createOscillator(), g = A.createGain(); o.frequency.value = 660; o.connect(g); g.connect(A.destination); g.gain.setValueAtTime(.12, A.currentTime); g.gain.exponentialRampToValueAtTime(.001, A.currentTime + .35); o.start(); o.stop(A.currentTime + .36); } catch (e) { }
  }
  function cerrar(id, aprobado, motivo) {
    var i = T.pendientes.findIndex(function (p) { return p.id === id; }); if (i < 0) return;
    var p = T.pendientes.splice(i, 1)[0];
    T.hechos.push({ nombre: p.nombre, unidad: p.unidad, aprobado: aprobado, motivo: motivo, a: Date.now() });
    T.rechazando = null; T.motivos = {}; T.otro = '';
    pintar();
    toastT(aprobado ? 'Turno de ' + p.nombre + ' aprobado. Ya puede conectarse.' : 'Turno de ' + p.nombre + ' rechazado. Le llegó el motivo para que corrija.');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ir-turnos],[data-aprobar-turno],[data-rechazar-turno],[data-motivo],[data-cancelar-rechazo],[data-confirmar-rechazo],[data-ver-foto],#foto-grande,.menu-item[data-vista]');
    if (!b) return;
    if (b.matches('.menu-item[data-vista]')) { setTimeout(pintar, 0); return; }
    if (b.hasAttribute('data-ir-turnos')) { var m = document.querySelector('.menu-item[data-vista=turnos]'); if (m) m.click(); return; }
    if (b.hasAttribute('data-aprobar-turno')) { cerrar(b.getAttribute('data-aprobar-turno'), true); return; }
    if (b.hasAttribute('data-rechazar-turno')) { T.rechazando = b.getAttribute('data-rechazar-turno'); T.motivos = {}; T.otro = ''; pintar(); return; }
    if (b.hasAttribute('data-motivo')) { var k = b.getAttribute('data-motivo'); T.motivos[k] = !T.motivos[k]; var o = $('#motivo-otro'); if (o) T.otro = o.value; pintar(); return; }
    if (b.hasAttribute('data-cancelar-rechazo')) { T.rechazando = null; pintar(); return; }
    if (b.hasAttribute('data-confirmar-rechazo')) {
      var otro = ($('#motivo-otro') || {}).value || '';
      var txt = MOTIVOS.filter(function (m) { return T.motivos[m[0]]; }).map(function (m) { return m[1]; });
      if (otro.trim()) txt.push(otro.trim());
      if (!txt.length) { toastT('Elige al menos un motivo para que el conductor sepa qué corregir.'); return; }
      cerrar(b.getAttribute('data-confirmar-rechazo'), false, txt.join(', '));
      return;
    }
    if (b.hasAttribute('data-ver-foto')) {
      var g = $('#foto-grande'); g.innerHTML = '<img src="' + b.getAttribute('data-src') + '" alt=""><p>' + b.getAttribute('data-txt') + '</p>'; g.hidden = false; return;
    }
    if (b.id === 'foto-grande') { b.hidden = true; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var g = $('#foto-grande'); if (g && !g.hidden) g.hidden = true; } });
  pintar();
})();
