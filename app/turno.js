/* AutoAmigo · Verificación del turno (una vez al día, antes de conectarse).
 *
 * Primera vez: registro de identidad -> foto de la cédula + selfie en vivo. La central lo aprueba en el panel.
 * Cada día:   1) cara en vivo (parpadeo y giro) comparada con la cara aprobada, DENTRO del teléfono
 *             2) foto de la camisa: la cara se pone borrosa en el teléfono antes de enviarla
 *             3) 3 fotos del interior del carro
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
  function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function centro(p) { var x = 0, y = 0; p.forEach(function (q) { x += q.x; y += q.y; }); return { x: x / p.length, y: y / p.length }; }
  function ear(o) { return (dist2(o[1], o[5]) + dist2(o[2], o[4])) / (2 * dist2(o[0], o[3])); }
  function medidas(r) {
    var l = r.landmarks, ojoI = l.getLeftEye(), ojoD = l.getRightEye(), nariz = l.getNose()[3];
    var cI = centro(ojoI), cD = centro(ojoD), entre = dist2(cI, cD) || 1;
    return { ear: (ear(ojoI) + ear(ojoD)) / 2, giro: (nariz.x - (cI.x + cD.x) / 2) / entre, ancho: r.detection.box.width };
  }
  function promedio(lista) { var m = new Array(128).fill(0); lista.forEach(function (d) { for (var i = 0; i < 128; i++) m[i] += d[i] / lista.length; }); return m; }
  function distancia(a, b) { var s = 0; for (var i = 0; i < 128; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }

  // ---------- Cámara ----------
  function abrirCam(frente) {
    if (!V.video) { V.video = document.createElement('video'); V.video.setAttribute('playsinline', ''); V.video.muted = true; V.video.autoplay = true; }
    V.video.classList.toggle('espejo', !!frente);
    if (V.stream && V.frente === frente) return Promise.resolve();
    cerrarCam(); V.frente = frente;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { V.error = 'Tu teléfono no permite usar la cámara aquí. Actualiza la app.'; pintar(); return Promise.reject(); }
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : { ideal: 'environment' }, width: { ideal: 960 } }, audio: false })
      .then(function (s) { if (!V.paso) { s.getTracks().forEach(function (t) { t.stop(); }); return; } V.stream = s; V.video.srcObject = s; V.error = ''; return V.video.play().catch(function () { }); })
      .catch(function (e) { V.error = 'Activa el permiso de cámara de AutoAmigo para verificar tu turno.'; pintar(); throw e; });
  }
  function cerrarCam() { if (V.stream) V.stream.getTracks().forEach(function (t) { t.stop(); }); V.stream = null; V.frente = null; }
  function cuadro(ancho, calidad, fuente) {
    var v = fuente || V.video, w0 = v.videoWidth || v.width, h0 = v.videoHeight || v.height;
    var w = Math.min(ancho, w0), h = Math.round(w * h0 / w0), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d');
    if (!fuente && V.frente) { g.translate(w, 0); g.scale(-1, 1); }
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
  function camHTML(ancha, extra) { return '<div class="cam' + (ancha ? ' ancha' : '') + '" id="vcam">' + (extra || '') + '</div>'; }
  function montarCam() { var cam = $('#vcam'); if (cam && V.video && V.video.parentNode !== cam) cam.insertBefore(V.video, cam.firstChild); }

  // ---------- Verificación en vivo (parpadeo y giro) ----------
  function enVivo(al) {
    var ind = function (t) { var e = $('#vindica'); if (e) e.textContent = t; };
    var desc = [], fase = 0, maxEar = 0, cerro = false, lado = 0, inicio = Date.now(), selfie = null, pasoAntes = V.paso, vioCara = false;
    var avanza = function (f, t) { fase = f; inicio = Date.now(); ind(t); };
    ind('Mira de frente');
    (function ciclo() {
      if (V.paso !== pasoAntes) return;
      if (Date.now() - inicio > 45000) {
        var msgs = ['No vemos bien tu cara. Ponte frente a una luz (no de espaldas a la ventana), sin gafas ni gorra, con el teléfono a la altura de tu cara.',
          'No vimos el parpadeo. Mira de frente y cierra los ojos un momento, despacio.',
          'No vimos el giro. Gira la cabeza despacio hacia un lado y luego hacia el otro.',
          'No vimos el giro. Gira la cabeza despacio hacia el otro lado.'];
        al(null, vioCara ? msgs[fase] : msgs[0]); return;
      }
      if (!V.video || !V.video.videoWidth) { setTimeout(ciclo, 200); return; }
      faceapi.detectSingleFace(V.video, opciones()).withFaceLandmarks().withFaceDescriptor().then(function (r) {
        if (V.paso !== pasoAntes) return;
        if (!r) { ind(fase ? 'No te vemos: vuelve al óvalo' : 'Pon tu cara dentro del óvalo'); setTimeout(ciclo, 150); return; }
        vioCara = true;
        var m = medidas(r);
        if (m.ancho < V.video.videoWidth * 0.15) { ind('Acércate un poco más'); setTimeout(ciclo, 150); return; }
        if (fase === 0) {
          if (Math.abs(m.giro) < 0.18) { desc.push(Array.prototype.slice.call(r.descriptor)); maxEar = Math.max(maxEar, m.ear); if (desc.length === 1) { var f = cuadro(480, 0.72); selfie = f.url(); } }
          if (desc.length >= 4) avanza(1, 'Parpadea');
        } else if (fase === 1) {
          maxEar = Math.max(maxEar, m.ear);
          if (!cerro && m.ear < maxEar * 0.8) cerro = true;
          else if (cerro && m.ear > maxEar * 0.9) avanza(2, 'Gira la cabeza hacia un lado');
        } else if (fase === 2) {
          if (Math.abs(m.giro) > 0.25) { lado = m.giro > 0 ? 1 : -1; avanza(3, 'Ahora hacia el otro lado'); }
        } else if (fase === 3) {
          if (m.giro * lado < -0.25) { var ov = $('#vovalo'); if (ov) ov.classList.add('ok'); ind('¡Listo!'); al({ descriptor: promedio(desc), selfie: selfie }); return; }
        }
        setTimeout(ciclo, 90);
      }).catch(function () { setTimeout(ciclo, 300); });
    })();
  }

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
        '<div class="vlista"><div><b>1. Tu cédula</b><p>Foto clara del frente de tu cédula.</p></div><div><b>2. Tu cara</b><p>Un selfie en vivo: te pediremos parpadear y girar la cabeza.</p></div></div>' +
        '<p style="font-size:12.5px">Al continuar aceptas que AutoAmigo guarde la foto de tu cédula y de tu cara solo para verificar que eres tú al empezar cada turno.</p>' +
        '<button class="vbtn" data-v="ir" data-a="idCedula">Acepto, empezar</button></div>';
    } else if (p === 'idCedula') {
      cam = false;
      h = cabecera('Tu cédula', 0, 2) + '<div class="vcuerpo"><h2>Foto del frente de tu cédula</h2><p>Que se lea bien y se vea tu foto. Sin reflejos.</p>' + err +
        (V.prev ? '<div class="cam ancha"><img src="' + V.prev + '"></div><div class="fila2"><button class="vbtn claro" data-v="repetir">Repetir</button><button class="vbtn" data-v="usarCedula">Usar foto</button></div>'
          : camHTML(true, '<div class="marco"></div>') + '<button class="vbtn" data-v="fotoCedula">Tomar foto</button>') + '</div>';
      if (V.prev) cam = null;
    } else if (p === 'idCara' || p === 'cara') {
      cam = true;
      var reg = p === 'idCara';
      h = cabecera('Tu cara', 0 + (reg ? 1 : 0), reg ? 2 : 3) + '<div class="vcuerpo"><h2>Pon tu cara dentro del óvalo</h2><p>Con buena luz, sin gafas oscuras y sin gorra.</p>' + err +
        camHTML(false, '<div class="ovalo" id="vovalo"></div><div class="indica" id="vindica">' + (V.guiando ? 'Preparando…' : 'Cuando estés listo, aplasta Empezar') + '</div>') +
        '<button class="vbtn" data-v="cara-ir"' + (V.guiando ? ' disabled' : '') + '>' + (V.guiando ? 'Verificando…' : 'Empezar') + '</button></div>';
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
        '<h2 class="centro">Antes de conectarte, verificamos tu turno</h2><p class="centro">Se hace una sola vez al día. Toma menos de 2 minutos.</p>' +
        '<div class="vlista"><div><b>1. Tu cara</b><p>Confirmamos que eres el mismo de tu cédula.</p></div><div><b>2. Tu camisa</b><p>Con camisa y sin gorra.</p></div><div><b>3. Tu carro</b><p>3 fotos del interior limpio.</p></div></div>' +
        '<button class="vbtn" data-v="ir" data-a="cara">Empezar</button></div>';
    } else if (p === 'caraOk') {
      h = cabecera('Tu cara', 0, 3) + '<div class="vcuerpo"><div class="grande">✓</div><h2 class="centro">Eres ' + esc((D && D.perfil && D.perfil.nombre) || 'tú') + '</h2><p class="centro">Tu cara coincide con la de tu cédula y tu registro.</p>' +
        '<button class="vbtn" data-v="sig" data-de="cara">Siguiente</button></div>';
    } else if (p === 'noCoincide') {
      h = cabecera('Tu cara', 0, 3) + '<div class="vcuerpo"><div class="grande mal">✕</div><h2 class="centro">Tu cara no coincide con la de tu registro</h2>' +
        '<p class="centro">Ponte en un lugar con buena luz, quítate gafas o gorra y vuelve a intentarlo. Si sigue fallando, llama a la central.</p>' +
        '<button class="vbtn" data-v="ir" data-a="cara">Intentar otra vez</button></div>';
    } else if (p === 'pecho') {
      cam = true;
      h = cabecera('Tu camisa', 1, 3) + '<div class="vcuerpo"><h2>Foto de tu cara y tu camisa</h2><p>Que se vea bien tu camisa y tu cabeza. Tu cara se pondrá borrosa antes de enviarla.</p>' +
        '<div class="reglas"><span class="si">✓ Camisa</span><span class="no">✕ Gorra</span></div>' + err +
        (V.prev ? '<div class="cam"><img src="' + V.prev + '"></div><div class="fila2"><button class="vbtn claro" data-v="repetir">Repetir</button><button class="vbtn" data-v="usarPecho">Usar foto</button></div>'
          : camHTML(false, '<div class="marco"></div>') + '<button class="vbtn" data-v="fotoPecho">Tomar foto</button>') + '</div>';
      if (V.prev) cam = null;
    } else if (p === 'carro') {
      cam = false;
      var listas = V.fotos.carro.filter(Boolean).length === 3;
      h = cabecera('Tu carro', 2, 3) + '<div class="vcuerpo"><h2>' + (listas ? 'Listo, ya tienes las 3 fotos' : 'Foto: ' + SLOTS[V.slot]) + '</h2><p>El interior tiene que estar limpio y ordenado.</p>' + err +
        (listas ? '' : camHTML(true, '<div class="marco"></div>')) +
        '<div class="fotos3">' + SLOTS.map(function (s, i) {
          var f = V.fotos.carro[i];
          return '<button data-v="slot" data-i="' + i + '" class="' + (i === V.slot && !listas ? 'sel ' : '') + (f ? 'hecha' : '') + '">' + (f ? '<img src="' + f + '">' : '📷<span>' + s + '</span>') + '</button>';
        }).join('') + '</div>' +
        (listas ? '<button class="vbtn" data-v="sig" data-de="carro">Siguiente</button>' : '<button class="vbtn" data-v="fotoCarro">Tomar foto</button>') + '</div>';
      if (listas) cam = null;
    } else if (p === 'enviar') {
      var fig = function (src, txt) { return '<figure><img src="' + src + '"><figcaption>' + txt + '</figcaption></figure>'; };
      h = cabecera('Revisa y envía', -1) + '<div class="vcuerpo"><h2>Todo listo</h2><p>Revisaremos tus fotos para aprobar tu turno. Tu cara no se envía: sale borrosa.</p>' + err +
        '<div class="resumen">' + fig(V.fotos.pecho, 'Camisa') + V.fotos.carro.map(function (f, i) { return fig(f, SLOTS[i]); }).join('') + '</div>' +
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
  function ir(p) { V.paso = p; V.prev = null; V.error = ''; V.guiando = false; if (p === 'carro') V.slot = Math.max(0, [0, 1, 2].filter(function (k) { return !V.fotos.carro[k]; })[0] || 0); pintar(); }
  function siguiente(de) {
    var orden = V.rehacer && V.rehacer.length ? V.rehacer.slice() : ['cara', 'pecho', 'carro'];
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
    if (a === 'cara-ir') {
      V.guiando = true; V.error = ''; pintar();
      cargarFA().then(function () {
        var paso = V.paso;
        enVivo(function (r, msg) {
          V.guiando = false;
          if (!r) { V.error = msg; pintar(); return; }
          if (paso === 'idCara') {
            // Registro: también se mide el parecido con la foto de la cédula (ayuda a la central)
            var img = new Image();
            img.onload = function () {
              faceapi.detectSingleFace(img, opciones()).withFaceLandmarks().withFaceDescriptor().then(function (c) {
                V.envio = 'identidad'; V.paso = 'enviando'; pintar();
                accion('identidadEnviar', { cedula: V.fotos.cedula, selfie: r.selfie, descriptor: r.descriptor, parecido: c ? Math.round(distancia(r.descriptor, Array.prototype.slice.call(c.descriptor)) * 1000) / 1000 : null });
              });
            };
            img.src = V.fotos.cedula;
            return;
          }
          // Se compara SOLO con la cara registrada de este conductor: la foto en vivo de su registro (estricto)
          // y la cara de SU cédula (más tolerante, porque la foto de la cédula suele ser vieja)
          var ref = (D && D.turno && D.turno.descriptor) || [], refC = (D && D.turno && D.turno.descCedula) || [];
          var d = ref.length === 128 ? distancia(r.descriptor, ref) : 9;
          var dc = refC.length === 128 ? distancia(r.descriptor, refC) : 0;
          V.cara = Math.round(d * 1000) / 1000;
          if (d <= UMBRAL && dc <= UMBRAL_CEDULA) { V.fallos = 0; ir('caraOk'); }
          else { V.fallos++; ir('noCoincide'); }
        });
      }).catch(function () { V.guiando = false; V.error = 'No se pudo cargar el verificador de cara. Revisa tu internet e intenta otra vez.'; pintar(); });
      return;
    }
    if (a === 'sig') { siguiente(b.getAttribute('data-de')); return; }
    if (a === 'fotoPecho') {
      if (!V.video || !V.video.videoWidth) return;
      var f = cuadro(420, 0.62);
      cargarFA().then(function () { return borrarCara(f); }).then(function () { marcaHora(f); V.prev = f.url(); pintar(); })
        .catch(function () { V.error = 'No se pudo preparar la foto. Revisa tu internet.'; pintar(); });
      return;
    }
    if (a === 'usarPecho') { V.fotos.pecho = V.prev; siguiente('pecho'); return; }
    if (a === 'slot') { V.slot = +b.getAttribute('data-i'); V.fotos.carro[V.slot] = null; pintar(); return; }
    if (a === 'fotoCarro') {
      if (!V.video || !V.video.videoWidth) return;
      var fk = cuadro(420, 0.62); marcaHora(fk); V.fotos.carro[V.slot] = fk.url();
      var falta = [0, 1, 2].filter(function (k) { return !V.fotos.carro[k]; });
      V.slot = falta.length ? falta[0] : V.slot; pintar(); return;
    }
    if (a === 'enviar' || a === 'reenviar') {
      if (a === 'reenviar' && V.envio === 'identidad') { V.paso = 'idIntro'; pintar(); return; }
      if (!V.fotos.pecho || V.fotos.carro.filter(Boolean).length !== 3) { ir(V.fotos.pecho ? 'carro' : 'pecho'); return; }
      V.envio = 'turno'; V.paso = 'enviando'; V.error = ''; pintar();
      accion('turnoEnviar', { pecho: V.fotos.pecho, carro: V.fotos.carro, cara: V.cara == null ? null : V.cara });
      return;
    }
    if (a === 'corregir') {
      (V.rehacer || ['pecho', 'carro']).forEach(function (k) { if (k === 'carro') V.fotos.carro = []; else V.fotos[k] = null; });
      // La cara se verifica solo una vez por día; si cerró la app, se vuelve a pedir
      if (V.cara == null) { V.rehacer = ['cara'].concat(V.rehacer || []); }
      ir(V.rehacer[0]); return;
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
    },
    respuesta: respuesta,
    atras: function () { if (!V.paso) return false; V.paso = null; pintar(); return true; }
  };
  document.addEventListener('click', function (e) { if (e.target.closest('#turno-ok.falta')) window.AATurno.abrir(); });
})();
