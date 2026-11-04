/* AutoAmigo · Verificación del turno (una vez al día, antes de conectarse).
 *
 * Primera vez: registro de identidad -> foto de la cédula + selfie en vivo. La central lo aprueba en el panel.
 * Cada día:   1) una foto (cámara frontal, pantalla completa): la cara se compara DENTRO del teléfono con la de su
 *                registro, su cédula y su licencia; la misma foto sirve para la camisa (la cara sale borrosa)
 *             2) 3 fotos del interior del carro
 *             Se envía al servidor de revisión (Gemini). Aprueba solo, rechaza solo o pasa a la central.
 *
 * La app (Kotlin) manda los datos en D.turno y bloquea "Conectarme" hasta que el turno de hoy esté aprobado.
 * Si la central no prendió la verificación, nada de esto aparece.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function accion(n, d) { try { if (window.AndroidAA) window.AndroidAA.accion(n, JSON.stringify(d || {})); } catch (e) { } }
  function avisar(t) { if (window.AA && AA.aviso) AA.aviso(t); }
  function hora(ms) { var d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  var FA = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/';
  var UMBRAL = 0.5;          // distancia máxima entre caras para decir "es la misma persona"
  var UMBRAL_CEDULA = 0.62;  // con la foto de la cédula se acepta un poco más de diferencia
  var D = null;
  var V = { paso: null, fotos: { carro: [] }, slot: 0, rehacer: null, prev: null, stream: null, frente: null, video: null, fallos: 0, aprobadoLocal: 0, envio: null, error: '' };
  var SLOTS = ['Asientos de adelante', 'Asientos de atrás', 'Piso'];

  // ---------- Reconocimiento de cara (gratis, dentro del teléfono) ----------
  var cargaFA = null;
  function cargarFA() {
    if (cargaFA) return cargaFA;
    cargaFA = new Promise(function (ok, mal) {
      if (window.faceapi) return ok();
      var s = document.createElement('script'); s.src = FA + 'dist/face-api.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s);
    }).then(function () {
      return Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(FA + 'model/'), faceapi.nets.faceLandmark68Net.loadFromUri(FA + 'model/'), faceapi.nets.faceRecognitionNet.loadFromUri(FA + 'model/')]);
    }).catch(function (e) { cargaFA = null; throw e; });
    return cargaFA;
  }
  function opciones() { return new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }); }
  function distancia(a, b) { var s = 0; for (var i = 0; i < 128; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }

  // ---------- Cámara ----------
  function abrirCam(frente) {
    if (!V.video) { V.video = document.createElement('video'); V.video.setAttribute('playsinline', ''); V.video.muted = true; V.video.autoplay = true; }
    V.video.classList.toggle('espejo', !!frente);
    if (V.stream && V.frente === frente) return Promise.resolve();
    cerrarCam(); V.frente = frente;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { V.error = 'Tu teléfono no permite usar la cámara aquí. Actualiza la app.'; pintar(); return Promise.reject(); }
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(function (s) { if (!V.paso) { s.getTracks().forEach(function (t) { t.stop(); }); return; } V.stream = s; V.video.srcObject = s; V.error = ''; return V.video.play().catch(function () { }); })
      .catch(function (e) { V.error = 'Activa el permiso de cámara de AutoAmigo para verificar tu turno.'; pintar(); throw e; });
  }
  function cerrarCam() { if (V.stream) V.stream.getTracks().forEach(function (t) { t.stop(); }); V.stream = null; V.frente = null; }
  function cuadro(ancho, calidad, fuente) {
    var v = fuente || V.video, w0 = v.videoWidth || v.width, h0 = v.videoHeight || v.height;
    var w = Math.min(ancho, w0), h = Math.round(w * h0 / w0), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d');
    // Como la cámara del teléfono: la vista previa de la cámara de adelante se ve como espejo, pero la foto sale derecha
    g.drawImage(v, 0, 0, w, h); g.setTransform(1, 0, 0, 1, 0, 0);
    return { c: c, g: g, url: function () { return c.toDataURL('image/jpeg', calidad); } };
  }
  function marcaHora(f) {
    var g = f.g, w = f.c.width, h = f.c.height;
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, h - 20, w, 20); g.fillStyle = '#fff'; g.font = '11px sans-serif';
    g.fillText(new Date().toLocaleString('es-EC') + ((D && D.perfil && D.perfil.unidad) ? ' · Unidad ' + D.perfil.unidad : ''), 6, h - 6);
  }
  // Pone borrosa la cara (o la parte de arriba si no encuentra cara) para que nunca salga del teléfono reconocible
  function borrarCara(f) {
    var w = f.c.width, h = f.c.height;
    return faceapi.detectSingleFace(f.c, opciones()).then(function (r) {
      var x, y, bw, bh;
      if (r) { var b = r.box; bw = b.width * 1.5; bh = b.height * 1.6; x = b.x + b.width / 2 - bw / 2; y = b.y + b.height * 0.55 - bh / 2; }
      else { x = 0; y = 0; bw = w; bh = h * 0.45; }
      x = Math.max(0, x); y = Math.max(0, y); bw = Math.min(w - x, bw); bh = Math.min(h - y, bh);
      var t = document.createElement('canvas'), k = 10; t.width = Math.max(1, Math.round(bw / k)); t.height = Math.max(1, Math.round(bh / k));
      t.getContext('2d').drawImage(f.c, x, y, bw, bh, 0, 0, t.width, t.height);
      f.g.imageSmoothingEnabled = false; f.g.drawImage(t, 0, 0, t.width, t.height, x, y, bw, bh); f.g.imageSmoothingEnabled = true;
    });
  }
  function montarCam() { var cam = $('#vcam'); if (cam && V.video && V.video.parentNode !== cam) cam.insertBefore(V.video, cam.firstChild); }
  // Pantalla completa, como la cámara del teléfono: se ve TODO lo que capta la cámara (sin recortar)
  function camaraHTML(o) {
    var mini = o.mini || '', foto = o.foto ? '<img class="vfoto" src="' + o.foto + '">' : '';
    var abajo = o.abajo || (V.analizando ? '<div class="vcf-listo">✓ Foto tomada, ya te puedes mover</div><div class="vcf-espera"></div><b class="vcf-txt">Revisando tu cara…</b>'
      : '<button class="disparo" data-v="' + o.disparo + '" aria-label="Tomar foto"></button>');
    return '<div class="vcf" id="vcam">' + foto + (o.marco ? '<div class="vcf-marco"></div>' : '') +
      '<div class="vcf-top"><div class="vcf-tit"><small>' + esc(o.paso || '') + '</small><b>' + esc(o.titulo) + '</b>' + (o.ayuda ? '<span>' + esc(o.ayuda) + '</span>' : '') + '</div>' +
      '<button class="vcf-x" data-v="cerrar" aria-label="Cerrar">✕</button></div>' +
      (V.error ? '<div class="vcf-error">' + esc(V.error) + '</div>' : '') +
      '<div class="vcf-bot">' + mini + abajo + '</div></div>';
  }
  function botonesFoto(usar) { return '<div class="fila2"><button class="vbtn claro" data-v="repetir">Repetir</button><button class="vbtn" data-v="' + usar + '">Usar foto</button></div>'; }
  // Cara y descriptor de una foto ya tomada
  function leerCara(c) { return faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.35 })).withFaceLandmarks().withFaceDescriptor(); }
  function tomarFrente() { var f = cuadro(960, 0.85); return f; }

  // ---------- Pantallas ----------
  function cabecera(titulo, n, total) {
    var prog = '';
    if (n >= 0) { for (var i = 0; i < total; i++) prog += '<i class="' + (i < n ? 'ok' : i === n ? 'ya' : '') + '"></i>'; }
    return '<div class="vcab"><b>' + titulo + '</b><button data-v="cerrar" aria-label="Cerrar">✕</button></div>' +
      (n >= 0 ? '<div class="vprog">' + prog + '</div><div class="vpaso">Paso ' + (n + 1) + ' de ' + total + '</div>' : '');
  }
  function cargandoHTML(t) { return '<div class="grande espera"></div><h2 class="centro">' + t + '</h2>'; }
  function pintar() {
    var el = $('#verif'); if (!el) return;
    var ok = $('#turno-ok');
    if (ok) {
      var t = D && D.turno, mostrar = !!(t && t.requerido);
      ok.hidden = !mostrar;
      if (mostrar) { ok.className = 'turno-ok' + (t.aprobadoHoy ? '' : ' falta'); ok.textContent = t.aprobadoHoy ? '✓ Turno aprobado' : 'Verifica tu turno para trabajar'; }
    }
    if (!V.paso) { el.hidden = true; cerrarCam(); return; }
    el.hidden = false;
    var p = V.paso, h = '', cam = null;
    var err = V.error ? '<div class="motivo">' + esc(V.error) + '</div>' : '';
    if (p === 'idIntro') {
      var rech = D && D.turno && D.turno.identidad === 'rechazada';
      h = cabecera('Registro de identidad', -1) + '<div class="vcuerpo"><div class="grande" style="background:var(--navy)">🪪</div>' +
        '<h2 class="centro">Primero registramos tu identidad</h2><p class="centro">Se hace una sola vez. La central revisa que seas el mismo de tu cédula.</p>' +
        (rech ? '<div class="motivo">La central rechazó tu registro' + (D.turno.identidadMotivo ? ': ' + esc(D.turno.identidadMotivo) : '') + '. Hazlo otra vez.</div>' : '') +
        '<div class="vlista"><div><b>1. Tu cédula</b><p>Foto clara del frente de tu cédula.</p></div><div><b>2. Tu cara</b><p>Una foto de frente, con buena luz.</p></div></div>' +
        '<p style="font-size:12.5px">Al continuar aceptas que AutoAmigo guarde la foto de tu cédula y de tu cara solo para verificar que eres tú al empezar cada turno.</p>' +
        '<button class="vbtn" data-v="ir" data-a="idCedula">Acepto, empezar</button></div>';
    } else if (p === 'idCedula') {
      cam = V.prev ? null : false;
      h = camaraHTML({ paso: 'Paso 1 de 2', titulo: 'Frente de tu cédula', ayuda: 'Que se lea bien y se vea tu foto. Sin reflejos.', marco: !V.prev, foto: V.prev,
        abajo: V.prev ? botonesFoto('usarCedula') : null, disparo: 'fotoCedula' });
    } else if (p === 'idCara' || p === 'cara') {
      var reg = p === 'idCara';
      cam = V.prev ? null : true;
      h = camaraHTML({ paso: reg ? 'Paso 2 de 2' : 'Paso 1 de 2', titulo: 'Tu cara y tu camisa', ayuda: 'Teléfono a la altura de tu cara, que se vea tu camisa. Con buena luz, sin gafas ni gorra.',
        foto: V.prev, disparo: 'fotoCara' });
    } else if (p === 'caraOk') {
      h = camaraHTML({ paso: 'Paso 1 de 2', titulo: '✓ Eres ' + ((D && D.perfil && D.perfil.nombre) || 'tú'), ayuda: 'Tu cara coincide con la de tu registro y tus documentos.', foto: V.fotoVista,
        abajo: '<button class="vbtn verde" data-v="sig" data-de="cara">Siguiente</button>' });
    } else if (p === 'noCoincide') {
      h = cabecera('Tu cara', -1) + '<div class="vcuerpo"><div class="grande mal">✕</div><h2 class="centro">Tu cara no coincide con la de tu registro</h2>' +
        '<p class="centro">Ponte de frente a una luz, quítate gafas o gorra y vuelve a intentarlo. Si sigue fallando, llama a la central.</p>' +
        '<button class="vbtn" data-v="ir" data-a="cara">Intentar otra vez</button></div>';
    } else if (p === 'carro') {
      cam = false;
      var falta = [0, 1, 2].filter(function (k) { return !V.fotos.carro[k]; });
      var mini = '<div class="vcf-mini">' + SLOTS.map(function (sl, k) {
        var f = V.fotos.carro[k];
        return '<button data-v="slot" data-i="' + k + '" class="' + (k === V.slot ? 'sel ' : '') + (f ? 'hecha' : '') + '">' + (f ? '<img src="' + f + '">' : '<span>' + (k + 1) + '</span>') + '</button>';
      }).join('') + '</div>';
      h = camaraHTML({ paso: 'Paso 2 de 2 · Foto ' + (V.slot + 1) + ' de 3', titulo: SLOTS[V.slot], ayuda: 'El interior tiene que estar limpio y ordenado.', marco: false, mini: mini, disparo: 'fotoCarro' });
      if (!falta.length) cam = null;
    } else if (p === 'enviando') {
      h = cabecera('Enviando', -1) + '<div class="vcuerpo">' + cargandoHTML(V.envio === 'identidad' ? 'Enviando tu registro…' : 'Revisando tus fotos…') + '<p class="centro">Toma unos segundos. Tu cara no se envía.</p></div>';
      if (V.envio === 'identidad') h = h.replace('<p class="centro">Toma unos segundos. Tu cara no se envía.</p>', '<p class="centro">Toma unos segundos.</p>');
    } else if (p === 'idEspera') {
      h = cabecera('Registro enviado', -1) + '<div class="vcuerpo">' + cargandoHTML('La central está revisando tu registro') +
        '<p class="centro">Te avisaremos aquí apenas lo aprueben. Después de eso, cada día solo tomará un minuto.</p></div>';
    } else if (p === 'idOk') {
      h = cabecera('Identidad aprobada', -1) + '<div class="vcuerpo"><div class="grande">✓</div><h2 class="centro">¡Tu identidad fue aprobada!</h2><p class="centro">Ahora verifica tu turno de hoy.</p>' +
        '<button class="vbtn" data-v="ir" data-a="intro">Continuar</button></div>';
    } else if (p === 'intro') {
      h = cabecera('Empezar mi turno', -1) + '<div class="vcuerpo"><div class="grande" style="background:var(--navy)">🪪</div>' +
        '<h2 class="centro">Antes de conectarte, verificamos tu turno</h2><p class="centro">Se hace una sola vez al día. Toma menos de 1 minuto.</p>' +
        '<div class="vlista"><div><b>1. Tu cara y tu camisa</b><p>Una foto: confirmamos que eres tú (cédula y licencia) y que tienes camisa, sin gorra.</p></div><div><b>2. Tu carro</b><p>3 fotos del interior limpio.</p></div></div>' +
        '<button class="vbtn" data-v="ir" data-a="cara">Empezar</button></div>';
    } else if (p === 'enviar') {
      var fig = function (src, txt) { return '<figure><img src="' + src + '"><figcaption>' + txt + '</figcaption></figure>'; };
      h = cabecera('Revisa y envía', -1) + '<div class="vcuerpo"><h2>Todo listo</h2><p>Revisaremos tus fotos para aprobar tu turno. Tu cara se queda en tu teléfono: a la revisión le llega borrosa.</p>' + err +
        '<div class="resumen">' + fig(V.fotos.pechoVista || V.fotos.pecho, 'Tú y tu camisa') + V.fotos.carro.map(function (f, i) { return fig(f, SLOTS[i]); }).join('') + '</div>' +
        '<button class="vbtn" data-v="enviar">Enviar</button></div>';
    } else if (p === 'espera') {
      h = cabecera('Esperando aprobación', -1) + '<div class="vcuerpo">' + cargandoHTML('Tu turno lo está revisando la central') +
        '<p class="centro">La revisión automática no pudo decidir, así que tus fotos pasaron a la central. Te avisaremos aquí apenas lo aprueben.</p></div>';
    } else if (p === 'aprobado') {
      var porIA = !(D && D.turno && D.turno.por === 'central');
      h = cabecera('Turno aprobado', -1) + '<div class="vcuerpo"><div class="grande">✓</div><h2 class="centro">¡Turno aprobado!</h2>' +
        '<p class="centro">' + (porIA ? 'Tus fotos están bien. ' : 'La central aprobó tu turno. ') + 'Ya puedes conectarte. Hoy no te lo volveremos a pedir.</p>' +
        '<button class="vbtn" data-v="conectar" style="background:var(--verde)">Conectarme</button></div>';
    } else if (p === 'rechazado') {
      var t2 = (D && D.turno) || {}, r = V.resultado || t2;
      h = cabecera('Turno no aprobado', -1) + '<div class="vcuerpo"><div class="grande mal">✕</div><h2 class="centro">' + (r.por === 'central' ? 'La central rechazó tu turno' : 'Tu turno no fue aprobado') + '</h2>' +
        '<div class="motivo">' + esc(r.motivo || 'Vuelve a tomar las fotos.') + '</div>' +
        (r.bloqueada ? '<p class="centro" style="font-size:13px">Esa foto se borró y no se guardó.</p>' : '') +
        '<button class="vbtn" data-v="corregir">Volver a tomar la foto</button></div>';
    } else if (p === 'error') {
      h = cabecera('No se pudo enviar', -1) + '<div class="vcuerpo"><div class="grande mal">!</div><h2 class="centro">No se pudo enviar</h2><div class="motivo">' + esc(V.error || 'Revisa tu internet e intenta otra vez.') + '</div>' +
        '<button class="vbtn" data-v="reenviar">Intentar otra vez</button></div>';
    }
    el.classList.toggle('camara', h.indexOf('class="vcf"') >= 0);
    if (el.__h !== h) { el.innerHTML = h; el.__h = h; }
    if (cam !== null) { abrirCam(cam).then(montarCam, function () { }); montarCam(); } else cerrarCam();
  }

  // Qué pantalla toca según lo que dice la app
  function pasoInicial() {
    var t = D && D.turno; if (!t) return null;
    if (t.identidad !== 'aprobada') return t.identidad === 'pendiente' ? 'idEspera' : 'idIntro';
    if (t.estado === 'aprobado') return 'aprobado';
    if (t.estado === 'revision') return 'espera';
    if (t.estado === 'rechazado') { V.rehacer = (t.rehacer && t.rehacer.length) ? t.rehacer : ['pecho', 'carro']; V.resultado = null; return 'rechazado'; }
    return 'intro';
  }
  function ir(p) { V.paso = p; V.prev = null; V.error = ''; V.analizando = false; if (p === 'carro') V.slot = Math.max(0, [0, 1, 2].filter(function (k) { return !V.fotos.carro[k]; })[0] || 0); pintar(); }
  function siguiente(de) {
    var orden = V.rehacer && V.rehacer.length ? V.rehacer.map(function (k) { return k === 'pecho' ? 'cara' : k; }) : ['cara', 'carro'];
    if (de === 'pecho') de = 'cara';
    var i = orden.indexOf(de);
    ir(orden[i + 1] || 'enviar');
  }

  function respuesta(json) {
    var r; try { r = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { r = { ok: false }; }
    if (!r || !r.ok) { V.error = (r && r.error) || 'Revisa tu internet e intenta otra vez.'; V.paso = 'error'; pintar(); return; }
    if (V.envio === 'identidad') { V.paso = r.estado === 'aprobada' ? 'idOk' : 'idEspera'; pintar(); return; }
    if (r.estado === 'aprobado') { V.aprobadoLocal = Date.now(); V.rehacer = null; V.paso = 'aprobado'; }
    else if (r.estado === 'revision') { V.rehacer = null; V.paso = 'espera'; }
    else { V.resultado = { motivo: r.motivo, bloqueada: r.bloqueada, por: 'ia' }; V.rehacer = r.rehacer && r.rehacer.length ? r.rehacer : ['pecho', 'carro']; V.paso = 'rechazado'; }
    pintar();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('#verif [data-v]'); if (!b) return;
    var a = b.getAttribute('data-v');
    if (a === 'cerrar') {
      var espera = ['espera', 'idEspera', 'enviando'].indexOf(V.paso) >= 0;
      V.paso = null; pintar();
      avisar(espera ? 'Te avisaremos cuando la central revise tu turno.' : 'Sin verificar tu turno no puedes conectarte.');
      return;
    }
    if (a === 'ir') { ir(b.getAttribute('data-a')); return; }
    if (a === 'repetir') { V.prev = null; pintar(); return; }
    if (a === 'fotoCedula') { if (!V.video || !V.video.videoWidth) return; var fc = cuadro(900, 0.75); V.prev = fc.url(); pintar(); return; }
    if (a === 'usarCedula') { V.fotos.cedula = V.prev; ir('idCara'); return; }
    if (a === 'fotoCara') {
      if (!V.video || !V.video.videoWidth || V.analizando) return;
      var paso = V.paso, f = tomarFrente();
      // La foto se congela en la pantalla apenas se toma: el conductor ya se puede mover
      V.prev = f.c.toDataURL('image/jpeg', 0.8);
      V.analizando = true; V.error = ''; pintar();
      cargarFA().then(function () { return leerCara(f.c); }).then(function (r) {
        if (V.paso !== paso) return;
        V.analizando = false;
        if (!r) { V.prev = null; V.error = 'No se ve bien tu cara. Ponte de frente a una luz (no de espaldas a la ventana), sin gafas ni gorra, y toma otra.'; pintar(); return; }
        var desc = Array.prototype.slice.call(r.descriptor);
        if (paso === 'idCara') {
          // Registro: también se mide el parecido con la foto de la cédula (ayuda a la central)
          var img = new Image();
          img.onload = function () {
            leerCara(img).then(function (c) {
              V.envio = 'identidad'; V.paso = 'enviando'; pintar();
              accion('identidadEnviar', { cedula: V.fotos.cedula, selfie: cuadro(480, 0.72, f.c).url(), descriptor: desc, parecido: c ? Math.round(distancia(desc, Array.prototype.slice.call(c.descriptor)) * 1000) / 1000 : null });
            });
          };
          img.src = V.fotos.cedula;
          return;
        }
        // Se compara SOLO con las caras de este conductor: la de su registro (estricta) y las de SU cédula y SU licencia
        var t = (D && D.turno) || {}, ref = t.descriptor || [];
        if (window.AATurnoPrueba && ref.length !== 128) { ref = t.descriptor = desc; }   // solo en el link de prueba: la primera foto queda como "registro"
        var d = ref.length === 128 ? distancia(desc, ref) : 9;
        var docs = [t.descCedula, t.descLicencia].filter(function (x) { return x && x.length === 128; }).map(function (x) { return distancia(desc, x); });
        var dd = docs.length ? Math.min.apply(null, docs) : 0;
        V.cara = Math.round(d * 1000) / 1000;
        if (d > UMBRAL || dd > UMBRAL_CEDULA) { V.fallos++; ir('noCoincide'); return; }
        V.fallos = 0;
        V.fotoVista = cuadro(720, 0.8, f.c).url();
        // La misma foto sirve para la camisa: la cara sale borrosa antes de enviarla
        var pe = cuadro(480, 0.62, f.c), vista = cuadro(480, 0.7, f.c);
        marcaHora(vista); V.fotos.pechoVista = vista.url();   // la que ve el conductor (con su cara)
        borrarCara(pe).then(function () { marcaHora(pe); V.fotos.pecho = pe.url(); ir('caraOk'); });   // la que se envía (cara borrosa)
      }).catch(function () { V.analizando = false; V.prev = null; V.error = 'No se pudo revisar la foto. Revisa tu internet e intenta otra vez.'; pintar(); });
      return;
    }
    if (a === 'sig') { siguiente(b.getAttribute('data-de')); return; }
    if (a === 'slot') { V.slot = +b.getAttribute('data-i'); V.fotos.carro[V.slot] = null; V.error = ''; pintar(); return; }
    if (a === 'fotoCarro') {
      if (!V.video || !V.video.videoWidth) return;
      var fk = cuadro(420, 0.62); marcaHora(fk); V.fotos.carro[V.slot] = fk.url();
      var falta = [0, 1, 2].filter(function (k) { return !V.fotos.carro[k]; });
      if (falta.length) { V.slot = falta[0]; pintar(); } else siguiente('carro');
      return;
    }
    if (a === 'enviar' || a === 'reenviar') {
      if (a === 'reenviar' && V.envio === 'identidad') { V.paso = 'idIntro'; pintar(); return; }
      if (!V.fotos.pecho || V.fotos.carro.filter(Boolean).length !== 3) { ir(V.fotos.pecho ? 'carro' : 'cara'); return; }
      V.envio = 'turno'; V.paso = 'enviando'; V.error = ''; pintar();
      accion('turnoEnviar', { pecho: V.fotos.pecho, carro: V.fotos.carro, cara: V.cara == null ? null : V.cara });
      return;
    }
    if (a === 'corregir') {
      var re = (V.rehacer || ['pecho', 'carro']).map(function (k) { return k === 'pecho' ? 'cara' : k; });
      re.forEach(function (k) { if (k === 'carro') V.fotos.carro = []; else { V.fotos.pecho = null; V.fotos.pechoVista = null; } });
      // La foto de la cara es la misma de la camisa: si cerró la app hay que volver a tomarla
      if (V.cara == null || !V.fotos.pecho) { if (re.indexOf('cara') < 0) re.unshift('cara'); }
      V.rehacer = re; ir(re[0]); return;
    }
    if (a === 'conectar') { V.paso = null; pintar(); accion('conectar'); return; }
  });

  // ---------- Lo que llama la app ----------
  window.AATurno = {
    estado: function (d) {
      var antes = D && D.turno; D = d;
      var t = D && D.turno;
      if (V.paso && t) {
        // Actualizaciones en vivo mientras espera
        if (V.paso === 'idEspera' && t.identidad === 'aprobada') V.paso = 'idOk';
        else if (V.paso === 'idEspera' && t.identidad === 'rechazada') V.paso = 'idIntro';
        else if (V.paso === 'espera' && t.estado === 'aprobado') V.paso = 'aprobado';
        else if (V.paso === 'espera' && t.estado === 'rechazado') { V.resultado = null; V.rehacer = t.rehacer && t.rehacer.length ? t.rehacer : ['pecho', 'carro']; V.paso = 'rechazado'; }
      }
      if (!t || !t.requerido) { if (V.paso && ['enviando'].indexOf(V.paso) < 0) V.paso = null; }
      pintar();
    },
    abrir: function () {
      if (!D || !D.turno) return;
      // Recién aprobado: la app tarda un segundo en enterarse; se reintenta conectar
      if (Date.now() - V.aprobadoLocal < 20000 && !D.turno.aprobadoHoy) { setTimeout(function () { accion('conectar'); }, 1500); return; }
      if (V.paso && V.paso !== 'aprobado') { pintar(); return; }
      V.paso = pasoInicial(); V.error = ''; pintar();
      cargarFA().catch(function () { });   // se carga mientras lee la pantalla de inicio: la revisión de la foto sale más rápido
    },
    respuesta: respuesta,
    atras: function () { if (!V.paso) return false; V.paso = null; pintar(); return true; }
  };
  document.addEventListener('click', function (e) { if (e.target.closest('#turno-ok.falta')) window.AATurno.abrir(); });
})();
