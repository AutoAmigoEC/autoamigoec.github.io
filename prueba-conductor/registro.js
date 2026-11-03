/* PRUEBA · Inicio de sesión, "Crear usuario y ser parte de AutoAmigo" y Mi perfil.
 * Todo es simulación: nada se envía. La solicitud se guarda en este navegador para verla en el panel de prueba.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var SIM = window.__SIM;
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function aviso(t) { SIM.aviso(t); }
  function svg(s) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' + s + '</svg>'); }
  function fecha(iso) { if (!iso) return '—'; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function hoyISO(dias) { var d = new Date(); d.setDate(d.getDate() + (dias || 0)); return d.toISOString().slice(0, 10); }
  function diasHasta(iso) { return Math.round((new Date(iso + 'T12:00:00') - new Date()) / 86400000); }
  function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function leerLS(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

  // ---------- Dibujos de ejemplo (cuando no hay cámara) ----------
  var EJ = {
    persona: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#E9ECF2"/><circle cx="150" cy="165" r="68" fill="#C89A72"/><path d="M82 155c0-55 136-55 136 0-12-30-124-30-136 0z" fill="#2A211B"/><path d="M40 400c10-90 210-90 220 0z" fill="#F4F5F7"/><path d="M125 318l25 30 25-30" fill="none" stroke="#C9CED8" stroke-width="6"/></svg>'),
    cedula: svg('<rect width="400" height="300" fill="#8F99A8"/><rect x="40" y="50" width="320" height="200" rx="16" fill="#DCE6F5"/><rect x="60" y="80" width="100" height="130" rx="8" fill="#fff"/><circle cx="110" cy="130" r="30" fill="#C89A72"/><path d="M75 210c6-40 64-40 70 0z" fill="#3B4A6B"/><rect x="180" y="90" width="150" height="12" rx="6" fill="#7F8EA8"/><rect x="180" y="115" width="120" height="10" rx="5" fill="#9AA8C2"/><rect x="180" y="135" width="140" height="10" rx="5" fill="#9AA8C2"/><rect x="180" y="185" width="90" height="10" rx="5" fill="#9AA8C2"/>'),
    licencia: svg('<rect width="400" height="300" fill="#8F99A8"/><rect x="40" y="50" width="320" height="200" rx="16" fill="#FCE7C8"/><rect x="40" y="50" width="320" height="34" rx="16" fill="#E8A33D"/><rect x="60" y="100" width="90" height="120" rx="8" fill="#fff"/><circle cx="105" cy="145" r="26" fill="#C89A72"/><path d="M73 218c6-36 58-36 64 0z" fill="#3B4A6B"/><rect x="170" y="110" width="160" height="12" rx="6" fill="#B07A2A"/><rect x="170" y="135" width="120" height="10" rx="5" fill="#C9944A"/>'),
    matricula: svg('<rect width="400" height="300" fill="#8F99A8"/><rect x="40" y="40" width="320" height="220" rx="10" fill="#F4F5F7"/><rect x="60" y="60" width="280" height="26" rx="4" fill="#3B6FB6"/><rect x="60" y="105" width="200" height="10" rx="5" fill="#9AA8C2"/><rect x="60" y="130" width="240" height="10" rx="5" fill="#9AA8C2"/><rect x="60" y="155" width="180" height="10" rx="5" fill="#9AA8C2"/><rect x="60" y="200" width="120" height="30" rx="4" fill="#E4E7EC"/>'),
    carro: svg('<rect width="400" height="300" fill="#BFD7EA"/><rect y="210" width="400" height="90" fill="#8F99A8"/><path d="M70 200l30-60c6-12 16-18 30-18h140c14 0 24 6 30 18l30 60z" fill="#F4F5F7"/><rect x="50" y="195" width="300" height="50" rx="16" fill="#F4F5F7"/><path d="M120 140h70v50h-90zM210 140h70l20 50h-90z" fill="#2B3E55"/><circle cx="110" cy="248" r="24" fill="#222"/><circle cx="290" cy="248" r="24" fill="#222"/><rect x="170" y="222" width="60" height="18" rx="3" fill="#FFD54A"/>')
  };
  var FOTOS = [
    ['persona', 'Tu foto', 'Una foto de tu cara, de frente y con buena luz.', true],
    ['cedula', 'Tu cédula', 'El frente de tu cédula. Que se lea bien y se vea tu foto.', false],
    ['licencia', 'Tu licencia', 'El frente de tu licencia de conducir.', false],
    ['matricula', 'Matrícula del carro', 'La matrícula del vehículo, que se lean los datos.', false],
    ['carro', 'Tu carro por fuera', 'El carro completo por fuera, que se vea la placa.', false]
  ];

  // ---------- Cámara (solo en vivo: no se puede subir de la galería) ----------
  var CAM = { stream: null, frente: null, video: null, sin: false };
  function abrirCam(frente) {
    if (!CAM.video) { CAM.video = document.createElement('video'); CAM.video.playsInline = true; CAM.video.muted = true; CAM.video.autoplay = true; }
    CAM.video.classList.toggle('espejo', !!frente);
    if (CAM.sin || (CAM.stream && CAM.frente === frente)) return;
    cerrarCam(); CAM.frente = frente;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { CAM.sin = true; pintar(); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : 'environment' }, audio: false })
      .then(function (s) { CAM.stream = s; CAM.video.srcObject = s; CAM.video.play().catch(function () {}); })
      .catch(function () { CAM.sin = true; pintar(); });
  }
  function cerrarCam() { if (CAM.stream) CAM.stream.getTracks().forEach(function (t) { t.stop(); }); CAM.stream = null; CAM.frente = null; }
  function capturar(ejemplo) {
    var v = CAM.video;
    if (!CAM.stream || !v || !v.videoWidth) return ejemplo;
    var w = 420, h = Math.round(w * v.videoHeight / v.videoWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'); if (CAM.frente) { g.translate(w, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.6);
  }
  function camHTML(ancha, ovalo) { return '<div class="cam' + (ancha ? ' ancha' : '') + '" id="rcam">' + (ovalo ? '<div class="ovalo"></div>' : '<div class="marco"></div>') + '</div>'; }
  function montarCam(ejemplo) {
    var c = $('#rcam'); if (!c) return;
    if (CAM.sin) { var im = document.createElement('img'); im.src = ejemplo; c.insertBefore(im, c.firstChild); }
    else if (CAM.video) c.insertBefore(CAM.video, c.firstChild);
  }

  // ---------- Estado ----------
  var R = { vista: 'acceso', datos: {}, errores: {}, fotos: {}, foto: null, prev: null };
  var CAMPOS = [
    ['Datos personales'],
    ['nombre', 'Nombre completo', 'text', 'Como dice tu cédula'],
    ['cedula', 'Número de cédula', 'text', '10 números', 'numeric', 10],
    ['cedulaVence', 'Fecha de vencimiento de la cédula', 'date'],
    ['nacimiento', 'Fecha de nacimiento', 'date'],
    ['telefono', 'Número de teléfono', 'tel', '09…', 'numeric', 10],
    ['correo', 'Correo electrónico', 'email', 'tucorreo@gmail.com'],
    ['sector', '¿En qué sector vives?', 'text', 'Ej.: Sauces 8, Mz 450'],
    ['Licencia'],
    ['licenciaVence', 'Fecha de vencimiento de la licencia', 'date'],
    ['Tu vehículo'],
    ['placa', 'Placa del vehículo', 'text', 'GBA-1234', null, 8],
    ['marca', 'Marca del vehículo', 'text', 'Ej.: Chevrolet Aveo'],
    ['color', 'Color del vehículo', 'text', 'Ej.: Blanco'],
    ['anio', 'Año del vehículo', 'text', 'Ej.: 2018', 'numeric', 4],
    ['matriculaVence', 'Fecha de vencimiento de la matrícula', 'date']
  ];
  // Cédula ecuatoriana: 10 dígitos, provincia 01-24 (o 30) y dígito verificador
  function cedulaOk(c) {
    if (!/^\d{10}$/.test(c)) return false;
    var p = +c.slice(0, 2); if (!((p >= 1 && p <= 24) || p === 30) || +c[2] > 5) return false;
    var s = 0; for (var i = 0; i < 9; i++) { var n = +c[i] * (i % 2 ? 1 : 2); s += n > 9 ? n - 9 : n; }
    return (10 - s % 10) % 10 === +c[9];
  }
  function validar() {
    var d = R.datos, e = {};
    CAMPOS.forEach(function (c) { if (c.length > 1 && !String(d[c[0]] || '').trim()) e[c[0]] = 'Falta este dato.'; });
    if (d.nombre && d.nombre.trim().split(/\s+/).length < 2) e.nombre = 'Escribe tus nombres y apellidos.';
    if (d.cedula && !cedulaOk(d.cedula)) e.cedula = 'Ese número de cédula no es válido.';
    if (d.telefono && !/^09\d{8}$/.test(d.telefono)) e.telefono = 'Debe tener 10 números y empezar con 09.';
    if (d.correo && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d.correo)) e.correo = 'Ese correo no es válido.';
    if (d.nacimiento) { var edad = (new Date() - new Date(d.nacimiento)) / (365.25 * 86400000); if (edad < 18) e.nacimiento = 'Debes ser mayor de 18 años.'; if (edad > 90) e.nacimiento = 'Revisa la fecha.'; }
    if (d.anio && (!/^\d{4}$/.test(d.anio) || +d.anio < 1990 || +d.anio > new Date().getFullYear() + 1)) e.anio = 'Escribe el año con 4 números.';
    if (d.placa && !/^[A-Z]{3}-?\d{3,4}$/i.test(d.placa.trim())) e.placa = 'Escribe la placa así: GBA-1234.';
    [['cedulaVence', 'cédula'], ['licenciaVence', 'licencia'], ['matriculaVence', 'matrícula']].forEach(function (x) {
      if (d[x[0]] && diasHasta(d[x[0]]) < 0) e[x[0]] = 'Tu ' + x[1] + ' está vencida. Renuévala antes de registrarte.';
    });
    R.errores = e; return !Object.keys(e).length;
  }

  // ---------- Pantallas de acceso y registro ----------
  function pintar() {
    var el = $('#registro'); var h = '', cam = null, ejemplo = null;
    if (!R.vista) { el.hidden = true; cerrarCam(); return; }
    el.hidden = false;
    if (R.vista === 'acceso') {
      h = '<div class="acceso"><img src="../logo.png" alt="AutoAmigo" class="logo">' +
        '<div class="tarj"><h2>Iniciar sesión</h2><p>Entra con el usuario y la clave que te dio AutoAmigo.</p>' +
        '<label>Usuario<input id="ac-usuario" autocomplete="username" placeholder="Ej.: carlos07"></label>' +
        '<label>Clave<input id="ac-clave" type="password" autocomplete="current-password" placeholder="Tu clave"></label>' +
        '<button class="vbtn" data-r="entrar">Iniciar sesión</button></div>' +
        '<button class="crear" data-r="crear">¿Quieres manejar con nosotros?<b>Crear usuario y ser parte de AutoAmigo</b></button></div>';
    } else if (R.vista === 'form') {
      h = '<div class="vcab"><b>Crear usuario</b><button data-r="volver" aria-label="Volver">✕</button></div><div class="vprog"><i class="ya"></i><i></i></div><div class="vpaso">Paso 1 de 2 · Tus datos</div>' +
        '<div class="vcuerpo"><p>Llena tus datos como aparecen en tus documentos.</p>' +
        CAMPOS.map(function (c) {
          if (c.length === 1) return '<h3 class="grupo-r">' + c[0] + '</h3>';
          var v = R.datos[c[0]] || '', er = R.errores[c[0]];
          return '<label class="campo' + (er ? ' mal' : '') + '">' + c[1] + '<input data-campo="' + c[0] + '" type="' + c[2] + '" value="' + esc(v) + '"' +
            (c[3] ? ' placeholder="' + esc(c[3]) + '"' : '') + (c[4] ? ' inputmode="' + c[4] + '"' : '') + (c[5] ? ' maxlength="' + c[5] + '"' : '') +
            (c[2] === 'date' ? (c[0] === 'nacimiento' ? ' max="' + hoyISO(-18 * 365) + '"' : ' min="' + hoyISO(0) + '"') : '') + '>' + (er ? '<small>' + er + '</small>' : '') + '</label>';
        }).join('') + '<button class="vbtn" data-r="continuar">Continuar</button></div>';
    } else if (R.vista === 'fotos') {
      var hechas = FOTOS.filter(function (f) { return R.fotos[f[0]]; }).length;
      h = '<div class="vcab"><b>Tus fotos</b><button data-r="atras-form" aria-label="Volver">←</button></div><div class="vprog"><i class="ok"></i><i class="ya"></i></div><div class="vpaso">Paso 2 de 2 · ' + hechas + ' de 5 fotos</div>' +
        '<div class="vcuerpo"><p>Toma las 5 fotos ahora con la cámara. No se pueden subir de la galería.</p><div class="lista-fotos">' +
        FOTOS.map(function (f, i) {
          var ok = R.fotos[f[0]];
          return '<button class="fila-foto' + (ok ? ' hecha' : '') + '" data-r="foto" data-i="' + i + '">' + (ok ? '<img src="' + ok + '">' : '<span class="ic">📷</span>') +
            '<span><b>' + (i + 1) + '. ' + f[1] + '</b><small>' + (ok ? 'Lista · aplasta para repetir' : f[2]) + '</small></span>' + (ok ? '<i>✓</i>' : '') + '</button>';
        }).join('') + '</div><button class="vbtn" data-r="enviar"' + (hechas < 5 ? ' disabled' : '') + '>Enviar</button></div>';
    } else if (R.vista === 'camara') {
      var f = FOTOS[R.foto]; cam = f[3]; ejemplo = EJ[f[0]];
      h = '<div class="vcab"><b>' + f[1] + '</b><button data-r="cancelar-foto" aria-label="Volver">←</button></div><div class="vcuerpo"><h2>' + f[1] + '</h2><p>' + f[2] + '</p>' +
        (R.prev ? '<div class="cam' + (f[3] ? '' : ' ancha') + '"><img src="' + R.prev + '"></div><div class="fila2"><button class="vbtn claro" data-r="repetir">Repetir</button><button class="vbtn" data-r="usar">Usar foto</button></div>'
          : camHTML(!f[3], f[3]) + '<button class="vbtn" data-r="tomar">Tomar foto</button>') + '</div>';
      if (R.prev) cam = null;
    } else if (R.vista === 'enviando') {
      h = '<div class="vcuerpo" style="padding-top:90px"><div class="grande espera"></div><h2 class="centro">Enviando tu información…</h2></div>';
    } else if (R.vista === 'enviado') {
      h = '<div class="vcuerpo" style="padding-top:70px"><div class="grande">✓</div><h2 class="centro">¡Información enviada correctamente!</h2>' +
        '<p class="centro">Hemos recibido tus datos y se encuentran en proceso de revisión. Una vez aprobada tu solicitud, recibirás tu usuario y contraseña al número de teléfono que registraste.</p>' +
        '<p class="centro"><b>¡Gracias por querer formar parte de AutoAmigo!</b></p><button class="vbtn" data-r="listo">Volver al inicio</button></div>';
    }
    if (el.__h !== h) { el.innerHTML = h; el.__h = h; if (cam !== null) montarCam(ejemplo); }
    if (cam !== null) abrirCam(cam); else cerrarCam();
  }
  $('#registro').addEventListener('input', function (e) { var c = e.target.getAttribute('data-campo'); if (c) { R.datos[c] = c === 'placa' ? e.target.value.toUpperCase() : e.target.value; } });
  $('#registro').addEventListener('click', function (e) {
    var b = e.target.closest('[data-r]'); if (!b) return;
    var a = b.getAttribute('data-r');
    if (a === 'entrar') {
      if (!$('#ac-usuario').value.trim() || !$('#ac-clave').value) { aviso('Escribe tu usuario y tu clave.'); return; }
      R.vista = null; pintar(); aviso('En la prueba entras con cualquier usuario y clave.'); return;
    }
    if (a === 'crear') { R.vista = 'form'; R.errores = {}; pintar(); return; }
    if (a === 'volver') { R.vista = 'acceso'; pintar(); return; }
    if (a === 'continuar') {
      if (!validar()) { pintar(); var m = $('#registro .campo.mal'); if (m) m.scrollIntoView({ block: 'center' }); aviso('Revisa los datos marcados en rojo.'); return; }
      R.vista = 'fotos'; pintar(); return;
    }
    if (a === 'atras-form') { R.vista = 'form'; pintar(); return; }
    if (a === 'foto') { R.foto = +b.getAttribute('data-i'); R.prev = null; R.vista = 'camara'; pintar(); return; }
    if (a === 'cancelar-foto') { R.vista = 'fotos'; pintar(); return; }
    if (a === 'tomar') { R.prev = capturar(EJ[FOTOS[R.foto][0]]); pintar(); return; }
    if (a === 'repetir') { R.prev = null; pintar(); return; }
    if (a === 'usar') {
      R.fotos[FOTOS[R.foto][0]] = R.prev; R.prev = null;
      var sig = FOTOS.findIndex(function (f) { return !R.fotos[f[0]]; });
      if (sig >= 0) { R.foto = sig; R.vista = 'camara'; } else R.vista = 'fotos';
      pintar(); return;
    }
    if (a === 'enviar') {
      R.vista = 'enviando'; pintar();
      // En la prueba se guarda en este navegador para que aparezca en el panel de prueba (Solicitudes)
      var lista = leerLS('aa_sim_solicitudes') || [];
      lista.push({ id: 's' + Date.now(), t: Date.now(), datos: R.datos, fotos: R.fotos });
      guardarLS('aa_sim_solicitudes', lista.slice(-5));
      setTimeout(function () { R.vista = 'enviado'; pintar(); }, 1500);
      return;
    }
    if (a === 'listo') { PERFIL = desdeSolicitud(R.datos, R.fotos); R.datos = {}; R.fotos = {}; R.vista = 'acceso'; pintar(); return; }
  });

  // ---------- Mi perfil ----------
  function desdeSolicitud(d, f) {
    return { nombre: d.nombre, cedula: d.cedula, nacimiento: d.nacimiento, telefono: d.telefono, correo: d.correo, sector: d.sector, unidad: '07',
      placa: d.placa, marca: d.marca, color: d.color, anio: d.anio, desde: Date.now(),
      docs: { cedula: { vence: d.cedulaVence, foto: f.cedula }, licencia: { vence: d.licenciaVence, foto: f.licencia }, matricula: { vence: d.matriculaVence, foto: f.matricula } },
      fotoPersona: f.persona, fotoCarro: f.carro, perfil: { estado: null, foto: null } };
  }
  var PERFIL = {
    nombre: 'Carlos Andrés Ruiz Mora', cedula: '0926483157', nacimiento: '1988-04-12', telefono: '0991234567', correo: 'carlos.ruiz@gmail.com', sector: 'Sauces 8, Mz 450', unidad: '07',
    placa: 'GBA-1234', marca: 'Chevrolet Aveo', color: 'Blanco', anio: '2018', desde: new Date(new Date().getFullYear() - 1, 2, 15).getTime(),
    docs: { cedula: { vence: hoyISO(900), foto: EJ.cedula }, licencia: { vence: hoyISO(18), foto: EJ.licencia }, matricula: { vence: hoyISO(210), foto: EJ.matricula } },
    fotoPersona: EJ.persona, fotoCarro: EJ.carro, perfil: { estado: null, foto: null }
  };
  var DOCS = [['cedula', 'Cédula'], ['licencia', 'Licencia de conducir'], ['matricula', 'Matrícula del vehículo']];
  var P = { editar: null, simIA: 'bien' };
  function estadoDoc(d) {
    if (d.pendiente) return ['pend', 'En revisión'];
    var n = diasHasta(d.vence);
    if (n < 0) return ['mal', 'Vencida'];
    if (n <= 30) return ['aviso', 'Vence en ' + n + ' día' + (n === 1 ? '' : 's')];
    return ['ok', 'Vigente'];
  }
  function alertasDocs() {
    return DOCS.filter(function (x) { var e = estadoDoc(PERFIL.docs[x[0]])[0]; return e === 'mal' || e === 'aviso'; });
  }
  function fila(et, v, editable, k) {
    if (P.editar === k) return '<div class="pf-fila edit"><span>' + et + '</span><input id="pf-edit" value="' + esc(v) + '" type="' + (k === 'correo' ? 'email' : 'tel') + '"><button data-p="guardar" data-k="' + k + '">Guardar</button></div>';
    return '<div class="pf-fila"><span>' + et + '</span><b>' + esc(v) + '</b>' + (editable ? '<button data-p="editar" data-k="' + k + '">Editar</button>' : '<i title="No se puede cambiar">🔒</i>') + '</div>';
  }
  function html() {
    var p = PERFIL, todas = SIM.todas(), n = todas.length;
    var pf = p.perfil, foto = pf.foto && pf.estado !== 'rechazada' ? pf.foto : null;
    var estPf = { pendiente: ['pend', 'En revisión por la central'], aprobada: ['ok', 'Aprobada'], rechazada: ['mal', 'Rechazada: ' + (pf.motivo || '')] }[pf.estado];
    var al = alertasDocs();
    return '<h2>Mi perfil</h2>' +
      (al.length ? '<div class="pf-alerta">' + al.map(function (x) { var e = estadoDoc(p.docs[x[0]]); return '<div><b>' + x[1] + ': ' + e[1].toLowerCase() + '</b> (' + fecha(p.docs[x[0]].vence) + '). <button data-p="doc" data-k="' + x[0] + '">Actualizar</button></div>'; }).join('') + '</div>' : '') +
      '<div class="pf-cab"><div class="pf-foto">' + (foto ? '<img src="' + foto + '">' : '<span>' + p.nombre.split(' ').map(function (s) { return s[0]; }).slice(0, 2).join('') + '</span>') + '</div>' +
      '<div><b class="pf-nombre">' + esc(p.nombre) + '</b><small>Unidad ' + esc(p.unidad) + ' · Conductor desde ' + new Date(p.desde).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }) + '</small>' +
      (estPf ? '<span class="pf-chip ' + estPf[0] + '">' + esc(estPf[1]) + '</span>' : '<span class="pf-chip aviso">Falta tu foto de perfil</span>') + '</div></div>' +
      (pf.estado !== 'aprobada' && pf.estado !== 'pendiente' ? '<button class="pf-btn" data-p="foto">📷 ' + (pf.estado === 'rechazada' ? 'Tomar otra foto de perfil' : 'Tomar mi foto de perfil') + '</button>' : '') +
      '<div class="pf-stats"><div><b>' + n.toLocaleString('es-EC') + '</b><small>Carreras desde que te uniste</small></div><div><b>4.8 ★</b><small>Calificación (' + Math.round(n * 0.7) + ' calificaciones)</small></div></div>' +
      '<h3 class="pf-h">Datos personales</h3><div class="pf-caja">' + fila('Nombre', p.nombre) + fila('Cédula', p.cedula) + fila('Nacimiento', fecha(p.nacimiento)) + fila('Sector', p.sector) +
      fila('Teléfono', p.telefono, true, 'telefono') + fila('Correo', p.correo, true, 'correo') + '</div>' +
      '<h3 class="pf-h">Tu vehículo</h3><div class="pf-caja">' + fila('Placa', p.placa) + fila('Marca', p.marca) + fila('Color', p.color) + fila('Año', p.anio) +
      '<div class="pf-docfoto"><img src="' + p.fotoCarro + '"><small>Foto del carro 🔒</small></div></div>' +
      '<h3 class="pf-h">Documentos</h3><div class="pf-caja">' + DOCS.map(function (x) {
        var d = p.docs[x[0]], e = estadoDoc(d);
        return '<div class="pf-doc"><img src="' + d.foto + '"><div><b>' + x[1] + '</b><small>Vence: ' + fecha(d.vence) + '</small><span class="pf-chip ' + e[0] + '">' + e[1] + '</span></div>' +
          ((e[0] === 'mal' || e[0] === 'aviso') && !d.pendiente ? '<button data-p="doc" data-k="' + x[0] + '">Actualizar</button>' : '<i>🔒</i>') + '</div>';
      }).join('') + '</div>' +
      '<p class="pf-nota">Tus datos y fotos no se pueden cambiar. Solo puedes cambiar tu teléfono y tu correo. Si un documento vence, actualízalo aquí.</p>';
  }

  // Foto de perfil y actualización de documentos (pantalla completa)
  var PF = { paso: null, prev: null, doc: null, fecha: '' };
  function pintarPF() {
    var el = $('#pfoto'); var h = '', cam = null, ej = null;
    if (!PF.paso) { el.hidden = true; cerrarCam(); return; }
    el.hidden = false;
    if (PF.paso === 'requisitos') {
      h = '<div class="vcab"><b>Foto de perfil</b><button data-f="cerrar">✕</button></div><div class="vcuerpo"><h2>Antes de tomar tu foto</h2><p>Es la foto que verán tus clientes. La central la aprueba.</p>' +
        '<div class="vlista"><div><b>✓ Fondo blanco o gris claro</b><p>Párate frente a una pared clara, sin cosas detrás.</p></div><div><b>✓ Camisa manga larga sin estampado</b><p>Un solo color, sin dibujos, letras ni logos.</p></div><div><b>✓ De frente y sin gorra ni gafas</b><p>Revisaremos que seas la misma persona de tu cédula y tu licencia.</p></div></div>' +
        '<div class="reglas"><span class="no">✕ Fondo de colores</span><span class="no">✕ Camiseta</span><span class="no">✕ Estampados</span></div>' +
        '<button class="vbtn" data-f="camara">Tomar foto</button></div>';
    } else if (PF.paso === 'camara') {
      cam = true; ej = EJ.persona;
      h = '<div class="vcab"><b>Foto de perfil</b><button data-f="cerrar">✕</button></div><div class="vcuerpo"><h2>Mira a la cámara</h2><p>Fondo claro y camisa manga larga sin estampado.</p>' +
        (PF.prev ? '<div class="cam"><img src="' + PF.prev + '"></div><div class="fila2"><button class="vbtn claro" data-f="repetir">Repetir</button><button class="vbtn" data-f="enviar">Enviar</button></div>' +
          '<div class="soloprueba"><small>SOLO EN LA PRUEBA · elige qué ve la revisión</small><div class="reglas">' +
          [['bien', 'Todo bien'], ['fondo', 'Fondo de colores'], ['estampado', 'Camisa con estampado'], ['nocoincide', 'No coincide'], ['duda', 'Dudoso']].map(function (o) { return '<button data-f="sim" data-o="' + o[0] + '" style="height:34px;padding:0 11px;border-radius:999px;' + (P.simIA === o[0] ? 'background:var(--navy);color:#fff' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>'
          : camHTML(false, true) + '<button class="vbtn" data-f="tomar">Tomar foto</button>') + '</div>';
      if (PF.prev) cam = null;
    } else if (PF.paso === 'revisando') {
      h = '<div class="vcuerpo" style="padding-top:90px"><div class="grande espera"></div><h2 class="centro">Revisando tu foto…</h2><p class="centro">Comparamos tu cara con la de tu cédula y tu licencia.</p></div>';
    } else if (PF.paso === 'resultado') {
      var r = PF.res;
      h = '<div class="vcuerpo" style="padding-top:60px"><div class="grande' + (r.ok ? '' : r.duda ? ' espera' : ' mal') + '"' + (r.duda ? ' style="animation:none"' : '') + '>' + (r.ok ? '✓' : r.duda ? '' : '✕') + '</div><h2 class="centro">' + r.titulo + '</h2>' +
        (r.motivo ? '<div class="motivo">' + r.motivo + '</div>' : '') + '<p class="centro">' + r.texto + '</p><button class="vbtn" data-f="' + (r.ok || r.duda ? 'cerrar' : 'camara') + '">' + (r.ok || r.duda ? 'Listo' : 'Tomar otra foto') + '</button></div>';
    } else if (PF.paso === 'doc') {
      var nom = DOCS.filter(function (x) { return x[0] === PF.doc; })[0][1];
      cam = false; ej = EJ[PF.doc];
      h = '<div class="vcab"><b>Actualizar ' + nom.toLowerCase() + '</b><button data-f="cerrar">✕</button></div><div class="vcuerpo"><h2>Tu ' + nom.toLowerCase() + ' nueva</h2><p>Toma la foto del documento renovado y pon su nueva fecha de vencimiento.</p>' +
        (PF.prev ? '<div class="cam ancha"><img src="' + PF.prev + '"></div><button class="vbtn claro" data-f="repetir">Repetir foto</button>' : camHTML(true, false) + '<button class="vbtn" data-f="tomar">Tomar foto</button>') +
        '<label class="campo">Nueva fecha de vencimiento<input id="pf-fecha" type="date" min="' + hoyISO(1) + '" value="' + esc(PF.fecha) + '"></label>' +
        '<button class="vbtn" data-f="enviar-doc"' + (PF.prev ? '' : ' disabled') + '>Enviar a revisión</button></div>';
      if (PF.prev) cam = null;
    }
    if (el.__h !== h) { el.innerHTML = h; el.__h = h; if (cam !== null) montarCam(ej); }
    if (cam !== null) abrirCam(cam); else cerrarCam();
  }
  var RESULTADOS = {
    bien: { ok: true, titulo: '¡Foto de perfil aprobada!', texto: 'Coincide con tu cédula y tu licencia, y cumple los requisitos. Ya la verán tus clientes.', estado: 'aprobada' },
    fondo: { titulo: 'Tu foto no fue aprobada', motivo: 'El fondo no es blanco ni gris claro.', texto: 'Párate frente a una pared clara y toma otra foto.', estado: 'rechazada', m: 'el fondo no es claro' },
    estampado: { titulo: 'Tu foto no fue aprobada', motivo: 'Tu camisa tiene estampado o no es manga larga.', texto: 'Ponte una camisa manga larga de un solo color.', estado: 'rechazada', m: 'camisa con estampado' },
    nocoincide: { titulo: 'Tu foto no fue aprobada', motivo: 'Tu cara no coincide con la de tu cédula y tu licencia.', texto: 'Toma la foto de frente, sin gafas ni gorra y con buena luz.', estado: 'rechazada', m: 'no coincide con la cédula' },
    duda: { duda: true, titulo: 'Tu foto la está revisando la central', texto: 'La revisión automática no pudo decidir. Te avisaremos apenas la aprueben.', estado: 'pendiente' }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#seccion-cuerpo [data-p]');
    if (b) {
      var a = b.getAttribute('data-p'), k = b.getAttribute('data-k');
      if (a === 'editar') { P.editar = k; SIM.render(); setTimeout(function () { var i = $('#pf-edit'); if (i) i.focus(); }, 50); return; }
      if (a === 'guardar') {
        var v = ($('#pf-edit').value || '').trim();
        if (k === 'telefono' && !/^09\d{8}$/.test(v)) { aviso('El teléfono debe tener 10 números y empezar con 09.'); return; }
        if (k === 'correo' && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) { aviso('Ese correo no es válido.'); return; }
        PERFIL[k] = v; P.editar = null; SIM.render(); aviso(k === 'telefono' ? 'Teléfono actualizado.' : 'Correo actualizado.'); return;
      }
      if (a === 'foto') { PF.paso = 'requisitos'; PF.prev = null; pintarPF(); return; }
      if (a === 'doc') { PF.paso = 'doc'; PF.doc = k; PF.prev = null; PF.fecha = ''; pintarPF(); return; }
    }
    var f = e.target.closest('#pfoto [data-f]'); if (!f) return;
    var x = f.getAttribute('data-f');
    if (x === 'cerrar') { PF.paso = null; pintarPF(); SIM.render(); return; }
    if (x === 'camara') { PF.paso = 'camara'; PF.prev = null; pintarPF(); return; }
    if (x === 'tomar') { PF.fecha = ($('#pf-fecha') || {}).value || PF.fecha; PF.prev = capturar(PF.paso === 'doc' ? EJ[PF.doc] : EJ.persona); pintarPF(); return; }
    if (x === 'repetir') { PF.fecha = ($('#pf-fecha') || {}).value || PF.fecha; PF.prev = null; pintarPF(); return; }
    if (x === 'sim') { P.simIA = f.getAttribute('data-o'); pintarPF(); return; }
    if (x === 'enviar') {
      var foto = PF.prev; PF.paso = 'revisando'; pintarPF();
      setTimeout(function () {
        var r = RESULTADOS[P.simIA]; PF.res = r; PF.paso = 'resultado';
        PERFIL.perfil = { estado: r.estado, foto: foto, motivo: r.m };
        P.simIA = 'bien'; pintarPF(); SIM.render();
      }, 2200);
      return;
    }
    if (x === 'enviar-doc') {
      var fe = ($('#pf-fecha') || {}).value;
      if (!fe || diasHasta(fe) < 1) { aviso('Pon la nueva fecha de vencimiento.'); return; }
      PERFIL.docs[PF.doc] = { vence: PERFIL.docs[PF.doc].vence, foto: PERFIL.docs[PF.doc].foto, pendiente: { foto: PF.prev, vence: fe } };
      PF.paso = null; pintarPF(); SIM.render(); aviso('Enviado. La central revisará tu documento nuevo.'); return;
    }
  });

  window.PerfilSim = {
    html: html,
    cedula: function () { return PERFIL.docs.cedula.foto; },   // la verificación diaria usa la foto de la cédula del registro
    alertas: alertasDocs
  };
  // Controles de la prueba
  var c = $('#controles');
  if (c) {
    var bx = document.createElement('div'); bx.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    bx.innerHTML = '<p><b>Registro y perfil:</b></p><button id="sim-acceso">Ver inicio de sesión / Crear usuario</button><button id="sim-vencida">Simular: licencia vencida</button><button id="sim-aprobar-doc">Simular: la central aprueba documentos y foto</button>';
    c.insertBefore(bx, c.children[2] || null);
    $('#sim-acceso').addEventListener('click', function () { R.vista = 'acceso'; pintar(); });
    $('#sim-vencida').addEventListener('click', function () { PERFIL.docs.licencia = { vence: hoyISO(-3), foto: PERFIL.docs.licencia.foto }; SIM.irA('perfil'); aviso('La licencia quedó vencida hace 3 días.'); });
    $('#sim-aprobar-doc').addEventListener('click', function () {
      DOCS.forEach(function (x) { var d = PERFIL.docs[x[0]]; if (d.pendiente) PERFIL.docs[x[0]] = { vence: d.pendiente.vence, foto: d.pendiente.foto }; });
      if (PERFIL.perfil.estado === 'pendiente') PERFIL.perfil.estado = 'aprobada';
      SIM.render(); aviso('La central aprobó lo que estaba en revisión.');
    });
  }
  // Alerta en el inicio cuando un documento vence (o está por vencer)
  var txt = $('.saludo .txt');
  if (txt) {
    var al = document.createElement('button'); al.className = 'doc-alerta'; al.hidden = true; txt.appendChild(al);
    al.addEventListener('click', function () { SIM.irA('perfil'); });
    setInterval(function () {
      var a = alertasDocs(), venc = a.filter(function (x) { return estadoDoc(PERFIL.docs[x[0]])[0] === 'mal'; });
      al.hidden = !a.length;
      // Foto de perfil aprobada: se ve en el círculo de arriba y en el menú
      var fp = PERFIL.perfil.estado === 'aprobada' ? PERFIL.perfil.foto : null;
      document.querySelectorAll('#avatar, .lateral .quien .avatar').forEach(function (av) {
        if (fp && av.__fp !== fp) { av.__fp = fp; av.style.background = 'center/cover url(' + JSON.stringify(fp) + ')'; av.style.color = 'transparent'; }
      });
      if (a.length) { al.className = 'doc-alerta' + (venc.length ? ' mal' : ''); al.textContent = (venc.length ? '⚠ Tu ' + venc[0][1].toLowerCase() + ' está vencida · Actualizar' : '⚠ Tu ' + a[0][1].toLowerCase() + ' vence pronto · Ver'); }
    }, 1000);
  }
  pintar();
})();
