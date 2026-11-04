/* AutoAmigo · "Crear usuario y ser parte de AutoAmigo" (se abre desde el inicio de sesión de la app).
 * Datos + 5 fotos en vivo (no se pueden subir de la galería). El teléfono saca la "huella" de la cara de la foto
 * de la persona, de la cédula y de la licencia, y mide si se parecen. Todo se envía al servidor de revisión;
 * la central aprueba la solicitud en el panel y ahí se crean el usuario y la clave (llegan por WhatsApp).
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function aviso(t) { var a = $('#aviso'); a.textContent = t; a.hidden = false; clearTimeout(aviso.t); aviso.t = setTimeout(function () { a.hidden = true; }, 3500); }
  function hoyISO(d) { var x = new Date(); x.setDate(x.getDate() + (d || 0)); return x.toISOString().slice(0, 10); }
  function diasHasta(iso) { return Math.round((new Date(iso + 'T12:00:00') - new Date()) / 86400000); }
  function cerrar() { if (window.AndroidRegistro && AndroidRegistro.cerrar) AndroidRegistro.cerrar(); else if (history.length > 1) history.back(); else location.href = 'conductor.html'; }

  var FA = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/';
  var carga = null;
  function cargarFA() {
    if (carga) return carga;
    carga = new Promise(function (ok, mal) { if (window.faceapi) return ok(); var s = document.createElement('script'); s.src = FA + 'dist/face-api.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s); })
      .then(function () { return Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(FA + 'model/'), faceapi.nets.faceLandmark68Net.loadFromUri(FA + 'model/'), faceapi.nets.faceRecognitionNet.loadFromUri(FA + 'model/')]); })
      .catch(function (e) { carga = null; throw e; });
    return carga;
  }
  function huella(src, chica) {
    return new Promise(function (ok) {
      var img = new Image();
      img.onload = function () {
        faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: chica ? 608 : 416, scoreThreshold: chica ? 0.3 : 0.5 })).withFaceLandmarks().withFaceDescriptor()
          .then(function (r) { ok(r ? Array.prototype.slice.call(r.descriptor) : null); }, function () { ok(null); });
      };
      img.onerror = function () { ok(null); };
      img.src = src;
    });
  }
  function distancia(a, b) { var s = 0; for (var i = 0; i < 128; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }

  var FOTOS = [
    ['persona', 'Tu foto', 'Una foto de tu cara, de frente, sin gafas ni gorra y con buena luz.', true],
    ['cedula', 'Tu cédula', 'El frente de tu cédula. Que se lea bien y se vea tu foto.', false],
    ['licencia', 'Tu licencia', 'El frente de tu licencia de conducir.', false],
    ['matricula', 'Matrícula del carro', 'La matrícula del vehículo, que se lean los datos.', false],
    ['carro', 'Tu carro por fuera', 'El carro completo por fuera, que se vea la placa.', false]
  ];
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
  function cedulaOk(c) {
    if (!/^\d{10}$/.test(c)) return false;
    var p = +c.slice(0, 2); if (!((p >= 1 && p <= 24) || p === 30) || +c[2] > 5) return false;
    var s = 0; for (var i = 0; i < 9; i++) { var n = +c[i] * (i % 2 ? 1 : 2); s += n > 9 ? n - 9 : n; }
    return (10 - s % 10) % 10 === +c[9];
  }
  var R = { vista: 'form', datos: {}, errores: {}, fotos: {}, foto: 0, prev: null, error: '' };
  try { var g = JSON.parse(sessionStorage.getItem('aa_registro') || 'null'); if (g) R.datos = g; } catch (e) { }
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

  // Cámara en vivo
  var CAM = { stream: null, frente: null, video: null };
  function abrirCam(frente) {
    if (!CAM.video) { CAM.video = document.createElement('video'); CAM.video.setAttribute('playsinline', ''); CAM.video.muted = true; CAM.video.autoplay = true; }
    CAM.video.classList.toggle('espejo', !!frente);
    if (CAM.stream && CAM.frente === frente) return;
    cerrarCam(); CAM.frente = frente;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { R.error = 'Tu teléfono no permite usar la cámara aquí. Actualiza la app.'; pintar(); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      .then(function (s) { CAM.stream = s; CAM.video.srcObject = s; R.error = ''; CAM.video.play().catch(function () { }); })
      .catch(function () { R.error = 'Activa el permiso de cámara de AutoAmigo para tomar las fotos.'; pintar(); });
  }
  function cerrarCam() { if (CAM.stream) CAM.stream.getTracks().forEach(function (t) { t.stop(); }); CAM.stream = null; CAM.frente = null; }
  function capturar(doc) {
    var v = CAM.video; if (!CAM.stream || !v || !v.videoWidth) return null;
    var w = Math.min(doc ? 960 : 600, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g2 = c.getContext('2d'); if (CAM.frente) { g2.translate(w, 0); g2.scale(-1, 1); }
    g2.drawImage(v, 0, 0, w, h);
    return c.toDataURL('image/jpeg', doc ? 0.72 : 0.68);
  }

  function pintar() {
    var el = $('#registro'), h = '', cam = null;
    var err = R.error ? '<div class="motivo">' + esc(R.error) + '</div>' : '';
    if (R.vista === 'form') {
      h = '<div class="vcab"><b>Crear usuario</b><button data-r="cerrar" aria-label="Cerrar">✕</button></div><div class="vprog"><i class="ya"></i><i></i></div><div class="vpaso">Paso 1 de 2 · Tus datos</div>' +
        '<div class="vcuerpo"><p>Llena tus datos como aparecen en tus documentos.</p>' +
        CAMPOS.map(function (c) {
          if (c.length === 1) return '<h3 class="grupo-r">' + c[0] + '</h3>';
          var v = R.datos[c[0]] || '', er = R.errores[c[0]];
          return '<label class="campo' + (er ? ' mal' : '') + '">' + c[1] + '<input data-campo="' + c[0] + '" type="' + c[2] + '" value="' + esc(v) + '"' +
            (c[3] ? ' placeholder="' + esc(c[3]) + '"' : '') + (c[4] ? ' inputmode="' + c[4] + '"' : '') + (c[5] ? ' maxlength="' + c[5] + '"' : '') +
            (c[2] === 'date' ? (c[0] === 'nacimiento' ? ' max="' + hoyISO(-18 * 365) + '"' : ' min="' + hoyISO(0) + '"') : '') + '>' + (er ? '<small>' + er + '</small>' : '') + '</label>';
        }).join('') +
        '<p style="font-size:12.5px">Al continuar aceptas que AutoAmigo guarde tus datos y fotos para revisar tu solicitud y, si eres aprobado, para verificar que eres tú al empezar cada turno.</p>' +
        '<button class="vbtn" data-r="continuar">Continuar</button></div>';
    } else if (R.vista === 'fotos') {
      var n = FOTOS.filter(function (f) { return R.fotos[f[0]]; }).length;
      h = '<div class="vcab"><b>Tus fotos</b><button data-r="atras" aria-label="Volver">←</button></div><div class="vprog"><i class="ok"></i><i class="ya"></i></div><div class="vpaso">Paso 2 de 2 · ' + n + ' de 5 fotos</div>' +
        '<div class="vcuerpo"><p>Toma las 5 fotos ahora con la cámara. No se pueden subir de la galería.</p>' + err + '<div class="lista-fotos">' +
        FOTOS.map(function (f, i) {
          var ok = R.fotos[f[0]];
          return '<button class="fila-foto' + (ok ? ' hecha' : '') + '" data-r="foto" data-i="' + i + '">' + (ok ? '<img src="' + ok + '">' : '<span class="ic">📷</span>') +
            '<span><b>' + (i + 1) + '. ' + f[1] + '</b><small>' + (ok ? 'Lista · aplasta para repetir' : f[2]) + '</small></span>' + (ok ? '<i>✓</i>' : '') + '</button>';
        }).join('') + '</div><button class="vbtn" data-r="enviar"' + (n < 5 ? ' disabled' : '') + '>Enviar</button></div>';
    } else if (R.vista === 'camara') {
      var f = FOTOS[R.foto]; cam = f[3];
      h = '<div class="vcab"><b>' + f[1] + '</b><button data-r="volver-fotos" aria-label="Volver">←</button></div><div class="vcuerpo"><h2>' + f[1] + '</h2><p>' + f[2] + '</p>' + err +
        (R.prev ? '<div class="cam' + (f[3] ? '' : ' ancha') + '"><img src="' + R.prev + '"></div><div class="fila2"><button class="vbtn claro" data-r="repetir">Repetir</button><button class="vbtn" data-r="usar">Usar foto</button></div>'
          : '<div class="cam' + (f[3] ? '' : ' ancha') + '" id="rcam">' + (f[3] ? '<div class="ovalo"></div>' : '<div class="marco"></div>') + '</div><button class="vbtn" data-r="tomar">Tomar foto</button>') + '</div>';
      if (R.prev) cam = null;
    } else if (R.vista === 'enviando') {
      h = '<div class="vcuerpo" style="padding-top:90px"><div class="grande espera"></div><h2 class="centro">Enviando tu información…</h2><p class="centro">No cierres la app. Puede tardar un minuto.</p></div>';
    } else if (R.vista === 'enviado') {
      h = '<div class="vcuerpo" style="padding-top:70px"><div class="grande">✓</div><h2 class="centro">¡Información enviada correctamente!</h2>' +
        '<p class="centro">Hemos recibido tus datos y se encuentran en proceso de revisión. Una vez aprobada tu solicitud, recibirás tu usuario y contraseña al número de teléfono que registraste.</p>' +
        '<p class="centro"><b>¡Gracias por querer formar parte de AutoAmigo!</b></p><button class="vbtn" data-r="cerrar">Volver al inicio</button></div>';
    }
    if (el.__h !== h) { el.innerHTML = h; el.__h = h; }
    if (cam !== null) { abrirCam(cam); var c = $('#rcam'); if (c && CAM.video && CAM.video.parentNode !== c) c.insertBefore(CAM.video, c.firstChild); } else cerrarCam();
  }
  $('#registro').addEventListener('input', function (e) {
    var c = e.target.getAttribute('data-campo'); if (!c) return;
    R.datos[c] = c === 'placa' ? e.target.value.toUpperCase() : e.target.value;
    try { sessionStorage.setItem('aa_registro', JSON.stringify(R.datos)); } catch (er) { }
  });
  $('#registro').addEventListener('click', function (e) {
    var b = e.target.closest('[data-r]'); if (!b) return;
    var a = b.getAttribute('data-r');
    if (a === 'cerrar') { cerrarCam(); cerrar(); return; }
    if (a === 'continuar') {
      if (!validar()) { pintar(); var m = $('#registro .campo.mal'); if (m) m.scrollIntoView({ block: 'center' }); aviso('Revisa los datos marcados en rojo.'); return; }
      R.vista = 'fotos'; pintar(); cargarFA().catch(function () { }); return;
    }
    if (a === 'atras') { R.vista = 'form'; pintar(); return; }
    if (a === 'foto') { R.foto = +b.getAttribute('data-i'); R.prev = null; R.error = ''; R.vista = 'camara'; pintar(); return; }
    if (a === 'volver-fotos') { R.vista = 'fotos'; pintar(); return; }
    if (a === 'tomar') { var p = capturar(R.foto > 0); if (!p) { aviso('Espera a que se encienda la cámara.'); return; } R.prev = p; pintar(); return; }
    if (a === 'repetir') { R.prev = null; pintar(); return; }
    if (a === 'usar') {
      var k = FOTOS[R.foto][0], src = R.prev;
      var seguir = function () {
        R.fotos[k] = src; R.prev = null;
        var sig = FOTOS.findIndex(function (f) { return !R.fotos[f[0]]; });
        if (sig >= 0) { R.foto = sig; R.vista = 'camara'; } else R.vista = 'fotos';
        pintar();
      };
      // La foto de la persona tiene que mostrar bien la cara (con ella se verifica cada día que es la misma persona)
      if (k === 'persona') {
        b.disabled = true; b.textContent = 'Revisando…';
        cargarFA().then(function () { return huella(src); }).then(function (d) {
          if (!d) { R.prev = null; R.error = 'No vemos bien tu cara. Ponte de frente, con buena luz y sin gafas.'; pintar(); return; }
          R.huellaPersona = d; R.error = ''; seguir();
        }, function () { R.error = 'Revisa tu internet e intenta otra vez.'; R.prev = null; pintar(); });
        return;
      }
      seguir(); return;
    }
    if (a === 'enviar') {
      R.vista = 'enviando'; R.error = ''; pintar();
      var servidor;
      fetch('servidor.json?v=' + Date.now()).then(function (r) { return r.json(); }).then(function (s) {
        servidor = (s && s.url || '').replace(/\/+$/, '');
        if (!/^https:\/\//.test(servidor)) throw new Error('El registro todavía no está disponible. Llama a la central.');
        return cargarFA().then(function () { return Promise.all([R.huellaPersona || huella(R.fotos.persona), huella(R.fotos.cedula, true), huella(R.fotos.licencia, true)]); }, function () { return [null, null, null]; });
      }).then(function (h3) {
        var desc = {}, par = {};
        if (h3[0]) desc.persona = h3[0];
        if (h3[1]) { desc.cedula = h3[1]; if (h3[0]) par.cedula = distancia(h3[0], h3[1]); }
        if (h3[2]) { desc.licencia = h3[2]; if (h3[0]) par.licencia = distancia(h3[0], h3[2]); }
        return fetch(servidor + '/solicitud', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ datos: R.datos, fotos: R.fotos, desc: desc, parecido: par }) });
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) throw new Error(j && j.error && !/^(datos|falta|foto)/.test(j.error) ? j.error : 'No se pudo enviar. Revisa tus datos e intenta otra vez.');
        try { sessionStorage.removeItem('aa_registro'); } catch (e2) { }
        R.vista = 'enviado'; pintar();
      }).catch(function (er) { R.vista = 'fotos'; R.error = er && er.message && !/fetch|network|json/i.test(er.message) ? er.message : 'No se pudo enviar. Revisa tu internet e intenta otra vez.'; pintar(); });
      return;
    }
  });
  pintar();
})();
