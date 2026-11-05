/* AutoAmigo Cliente · Seguridad (cuidar a los conductores)
 *
 * 1) Crear cuenta: datos + número de cédula válido + foto de la cédula + cara EN VIVO (parpadeo).
 *    La cara se compara con la foto de la cédula DENTRO del teléfono. Si no coincide, no se crea la cuenta.
 * 2) Antes de pedir, si el viaje es de riesgo (de noche, zona de riesgo, cuenta nueva o celular nuevo):
 *    selfie rápida con la cámara completa, comparada con la cara de su registro.
 * 3) La cuenta queda atada a este celular: en otro teléfono se vuelve a pedir la cara.
 * 4) Términos: el dueño de la cuenta es responsable de lo que pase con ella.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function leer(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  var CFG = { nocheDesde: 19, nocheHasta: 6, viajesParaConfiar: 3 };
  var UMBRAL = 0.5, UMBRAL_CEDULA = 0.62;
  // Solo en el link de prueba: lo que el panel de controles fuerza
  var PRUEBA = { hora: null, celularNuevo: false, zona: false };

  // ---------- Reconocimiento de cara (gratis, dentro del teléfono) ----------
  var FA = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/';
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
  function leerCara(c) { return faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.35 })).withFaceLandmarks().withFaceDescriptor(); }
  function distancia(a, b) { var s = 0; for (var i = 0; i < 128; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }
  function d2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function ear(o) { return (d2(o[1], o[5]) + d2(o[2], o[4])) / (2 * d2(o[0], o[3])); }

  // ---------- Cédula de Ecuador: dígito verificador ----------
  function cedulaValida(c) {
    if (!/^\d{10}$/.test(c)) return false;
    var prov = +c.slice(0, 2); if (!((prov >= 1 && prov <= 24) || prov === 30)) return false;
    if (+c[2] > 5) return false;
    var s = 0;
    for (var i = 0; i < 9; i++) { var n = +c[i] * (i % 2 ? 1 : 2); s += n > 9 ? n - 9 : n; }
    return (10 - s % 10) % 10 === +c[9];
  }

  // ---------- Celular de esta cuenta ----------
  function idCelular() {
    var id = leer('aac_celular', null);
    if (!id) { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); guardar('aac_celular', id); }
    return PRUEBA.celularNuevo ? id + '-nuevo' : id;
  }

  // ---------- Cámara a pantalla completa ----------
  var C = { video: null, stream: null, frente: null };
  function abrirCam(frente) {
    if (!C.video) { C.video = document.createElement('video'); C.video.setAttribute('playsinline', ''); C.video.muted = true; C.video.autoplay = true; }
    C.video.classList.toggle('espejo', !!frente);
    if (C.stream && C.frente === frente) return Promise.resolve();
    cerrarCam(); C.frente = frente;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { G.error = 'Tu teléfono no permite usar la cámara aquí.'; pintar(); return Promise.reject(); }
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(function (s) { if (!G.paso) { s.getTracks().forEach(function (t) { t.stop(); }); return; } C.stream = s; C.video.srcObject = s; G.error = ''; return C.video.play().catch(function () { }); })
      .catch(function (e) { G.error = 'Activa el permiso de la cámara para continuar.'; pintar(); throw e; });
  }
  function cerrarCam() { if (C.stream) C.stream.getTracks().forEach(function (t) { t.stop(); }); C.stream = null; C.frente = null; }
  // La foto sale derecha (como la cámara del teléfono), aunque la vista de la cámara de adelante se vea como espejo
  function cuadro(ancho, calidad, fuente) {
    var v = fuente || C.video, w0 = v.videoWidth || v.width, h0 = v.videoHeight || v.height;
    var w = Math.min(ancho, w0), h = Math.round(w * h0 / w0), c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return { c: c, url: function () { return c.toDataURL('image/jpeg', calidad); } };
  }
  function montarCam() { var cam = $('#scam'); if (cam && C.video && C.video.parentNode !== cam) cam.insertBefore(C.video, cam.firstChild); }
  function camaraHTML(o) {
    var foto = o.foto ? '<img class="vfoto" src="' + o.foto + '">' : '';
    var abajo = o.abajo || (G.analizando ? '<div class="vcf-espera"></div><b class="vcf-txt">' + esc(G.analizando) + '</b>'
      : '<button class="disparo" data-s="' + o.disparo + '" aria-label="Tomar foto"></button>');
    return '<div class="vcf" id="scam">' + foto + (o.marco ? '<div class="vcf-marco"></div>' : '') +
      '<div class="vcf-top">' + (G.analizando ? '' : '<div class="vcf-tit"><small>' + esc(o.paso || '') + '</small><b>' + esc(o.titulo) + '</b>' + (o.ayuda ? '<span>' + esc(o.ayuda) + '</span>' : '') + '</div>') +
      '<button class="vcf-x" data-s="' + (o.cerrar || 'atras') + '" aria-label="Cerrar">✕</button></div>' +
      (o.indica ? '<div class="vcf-indica" id="sindica">' + esc(o.indica) + '</div>' : '') +
      (G.error ? '<div class="vcf-error">' + esc(G.error) + '</div>' : '') +
      '<div class="vcf-bot">' + abajo + '</div></div>';
  }

  // ---------- Estado ----------
  var G = { paso: null, d: {}, fotos: {}, prev: null, analizando: '', error: '', fallos: 0, al: null, viaje: null, motivos: [] };
  function ir(p) { G.paso = p; G.prev = null; G.error = ''; G.analizando = ''; pintar(); }
  function cerrar() { G.paso = null; pintar(); }

  function tarjeta(cuerpo, titulo, atras) {
    return '<div class="scab">' + (atras ? '<button class="satras" data-s="' + atras + '" aria-label="Atrás">‹</button>' : '<span></span>') + '<b>' + esc(titulo || '') + '</b><span></span></div><div class="scuerpo">' + cuerpo + '</div>';
  }
  function pintar() {
    var el = $('#seg'); if (!el) return;
    if (!G.paso) { el.hidden = true; el.innerHTML = ''; el.__h = ''; cerrarCam(); return; }
    el.hidden = false;
    var p = G.paso, h = '', cam = null, d = G.d;
    var err = G.error ? '<div class="smotivo">' + esc(G.error) + '</div>' : '';
    if (p === 'bienvenida') {
      el.className = 'seg azul';
      h = '<div class="sbien"><div class="logo">Auto<span>Amigo</span></div><p class="lema">Pide tu unidad en segundos, con conductores verificados.</p>' +
        '<button class="sbtn rojo" data-s="ir" data-a="datos">Crear mi cuenta</button>' +
        '<button class="sbtn claro" data-s="entrar">Ya tengo cuenta</button></div>';
    } else if (p === 'datos') {
      el.className = 'seg';
      h = tarjeta('<h2>Tus datos</h2><p>Escríbelos tal como salen en tu cédula.</p>' + err +
        '<label class="slbl" for="s-nombre">Nombre y apellido</label><input class="sent" id="s-nombre" autocomplete="name" value="' + esc(d.nombre || '') + '" placeholder="Ej. Ana María Ruiz">' +
        '<label class="slbl" for="s-cedula">Número de cédula</label><input class="sent" id="s-cedula" inputmode="numeric" maxlength="10" value="' + esc(d.cedula || '') + '" placeholder="10 dígitos">' +
        '<label class="slbl" for="s-tel">Número de celular</label><input class="sent" id="s-tel" inputmode="tel" maxlength="10" autocomplete="tel" value="' + esc(d.tel || '') + '" placeholder="Ej. 0991234567">' +
        '<button class="sbtn" data-s="datosOk">Continuar</button>', 'Crear mi cuenta', 'bienvenida');
    } else if (p === 'porque') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande">🪪</div><h2 class="c">Verificamos que seas tú</h2>' +
        '<p class="c">Así cuidamos a nuestros conductores y a ti. Se hace una sola vez y toma un minuto.</p>' +
        '<div class="slista"><div><b>1. Foto de tu cédula</b><p>El frente, que se lea bien y se vea tu foto.</p></div>' +
        '<div><b>2. Tu cara en vivo</b><p>Te pediremos parpadear. Tu cara se compara con la de tu cédula dentro de tu teléfono.</p></div></div>' +
        '<button class="sbtn" data-s="ir" data-a="cedula">Empezar</button>', 'Crear mi cuenta', 'datos');
    } else if (p === 'cedula') {
      el.className = 'seg negro';
      cam = G.prev ? null : false;
      h = camaraHTML({ paso: 'Paso 1 de 2', titulo: 'Frente de tu cédula', ayuda: 'Pon tu cédula dentro del recuadro. Sin reflejos.', marco: !G.prev, foto: G.prev, cerrar: 'porque',
        abajo: G.prev && !G.analizando ? '<div class="sfila"><button class="sbtn claro" data-s="repetir">Repetir</button><button class="sbtn" data-s="usarCedula">Usar foto</button></div>' : null, disparo: 'fotoCedula' });
    } else if (p === 'cara') {
      el.className = 'seg negro';
      cam = G.prev ? null : true;
      h = camaraHTML({ paso: 'Paso 2 de 2', titulo: 'Tu cara en vivo', ayuda: 'Mira de frente, con buena luz, sin gafas ni gorra.', foto: G.prev, cerrar: 'cedula',
        indica: G.vivo ? (G.vivo === 1 ? 'Mira de frente' : 'Ahora parpadea') : null,
        abajo: G.prev ? null : (G.vivo ? '<b class="vcf-txt">Mantente frente a la cámara</b>' : '<button class="sbtn" data-s="vivo">Empezar</button>') });
    } else if (p === 'noCoincide') {
      el.className = 'seg';
      var muchas = G.fallos >= 3;
      h = tarjeta('<div class="sgrande mal">✕</div><h2 class="c">Tu cara no coincide con la de tu cédula</h2>' +
        '<p class="c">' + (muchas ? 'Lo intentaste varias veces. Si de verdad es tu cédula, la central puede revisarlo.' : 'Ponte de frente a una luz, quítate gafas o gorra. Revisa también que la foto de la cédula se vea clara.') + '</p>' +
        '<button class="sbtn" data-s="ir" data-a="cara">Tomar mi cara otra vez</button>' +
        '<button class="sbtn claro" data-s="ir" data-a="cedula">Tomar la cédula otra vez</button>' +
        (muchas ? '<button class="sbtn claro" data-s="aCentral">Que la central lo revise</button>' : ''), 'Crear mi cuenta', 'datos');
    } else if (p === 'terminos') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande">✓</div><h2 class="c">¡Eres tú!</h2><p class="c">Tu cara coincide con la de tu cédula. Último paso:</p>' +
        '<div class="slista"><div><b>Tu cuenta es personal</b><p>No la prestes. Si alguien más va a viajar, pídelo con la opción "Para otra persona".</p></div>' +
        '<div><b>Eres responsable de tu cuenta</b><p>Si tu cuenta se usa para hacerle daño a un conductor, tus datos se entregarán a la Policía.</p></div>' +
        '<div><b>Tu cuenta queda en este celular</b><p>Si entras desde otro teléfono, te pediremos tu cara otra vez.</p></div>' +
        '<div><b>A veces te pediremos tu cara</b><p>En viajes de noche o a zonas de riesgo, una foto rápida antes de pedir.</p></div></div>' +
        '<label class="sacepto"><input type="checkbox" id="s-acepto"> Acepto las condiciones de uso y que AutoAmigo guarde mi cédula y mi cara solo para verificar que soy yo.</label>' + err +
        '<button class="sbtn rojo" data-s="crear">Crear mi cuenta</button>', 'Crear mi cuenta');
    } else if (p === 'revision') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande espera"></div><h2 class="c">La central está revisando tu cuenta</h2>' +
        '<p class="c">Te avisaremos por WhatsApp al ' + esc(d.tel || '') + ' cuando esté lista.</p>', 'Cuenta en revisión');
    } else if (p === 'entrar') {
      el.className = 'seg';
      h = tarjeta('<h2>Entrar a mi cuenta</h2><p>Escribe tu cédula y tu celular.</p>' + err +
        '<label class="slbl" for="s-ecedula">Número de cédula</label><input class="sent" id="s-ecedula" inputmode="numeric" maxlength="10">' +
        '<label class="slbl" for="s-etel">Número de celular</label><input class="sent" id="s-etel" inputmode="tel" maxlength="10">' +
        '<button class="sbtn" data-s="entrarOk">Entrar</button>', 'Ya tengo cuenta', 'bienvenida');
    } else if (p === 'selfieIntro') {
      el.className = 'seg';
      var txt = { noche: 'Es de noche', zona: 'Zona de riesgo', nueva: 'Tu cuenta es nueva', celular: 'Estás en un celular nuevo' };
      h = tarjeta('<div class="sgrande" style="background:var(--navy)">🛡️</div><h2 class="c">Una foto rápida antes de pedir</h2>' +
        '<p class="c">Confirmamos que eres tú para cuidar al conductor. Son 5 segundos.</p>' +
        '<div class="schips">' + G.motivos.map(function (m) { return '<span>' + txt[m] + '</span>'; }).join('') + '</div>' +
        '<button class="sbtn" data-s="ir" data-a="selfie">Tomar mi foto</button><button class="sbtn claro" data-s="cancelarPedido">Ahora no</button>', 'Antes de pedir');
    } else if (p === 'selfie') {
      el.className = 'seg negro';
      cam = G.prev ? null : true;
      h = camaraHTML({ paso: 'Antes de pedir', titulo: 'Tu cara', ayuda: 'Mira de frente, con buena luz, sin gafas ni gorra.', foto: G.prev, disparo: 'fotoSelfie', cerrar: 'cancelarPedido' });
    } else if (p === 'selfieOk') {
      el.className = 'seg negro';
      h = camaraHTML({ paso: 'Antes de pedir', titulo: '✓ Eres ' + ((G.perfil && G.perfil.nombre || '').split(' ')[0] || 'tú'), ayuda: 'Tu cara coincide con la de tu cuenta.', foto: G.vista,
        abajo: '<button class="sbtn verde" data-s="seguirPedido">Pedir AutoAmigo</button>', cerrar: 'cancelarPedido' });
    } else if (p === 'selfieMal') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande mal">✕</div><h2 class="c">Tu cara no coincide con la de tu cuenta</h2>' +
        '<p class="c">Solo el dueño de la cuenta puede pedir en este viaje. Si viaja otra persona, pídelo con la opción "Para otra persona" (solo de día y fuera de zonas de riesgo).</p>' +
        '<button class="sbtn" data-s="ir" data-a="selfie">Intentar otra vez</button><button class="sbtn claro" data-s="cancelarPedido">Cancelar</button>', 'Antes de pedir');
    }
    if (el.__h !== h) { var foco = document.activeElement && document.activeElement.id, val = foco && $('#' + foco) ? $('#' + foco).value : null; el.innerHTML = h; el.__h = h; if (foco && $('#' + foco) && val != null) { $('#' + foco).value = val; $('#' + foco).focus(); } }
    if (cam !== null) { abrirCam(cam).then(montarCam, function () { }); montarCam(); } else cerrarCam();
  }

  // ---------- Cara en vivo (registro): mirar de frente y parpadear ----------
  function enVivo() {
    var paso = G.paso, inicio = Date.now(), maxEar = 0, cerro = false, frente = 0;
    G.vivo = 1; G.error = ''; pintar();
    var ind = function (t) { var e = $('#sindica'); if (e) e.textContent = t; };
    (function ciclo() {
      if (G.paso !== paso || !G.vivo) return;
      if (Date.now() - inicio > 40000) { G.vivo = 0; G.error = 'No vimos bien tu cara o el parpadeo. Ponte de frente a una luz, sin gafas, y vuelve a intentarlo.'; pintar(); return; }
      if (!C.video || !C.video.videoWidth) { setTimeout(ciclo, 200); return; }
      faceapi.detectSingleFace(C.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 })).withFaceLandmarks().then(function (r) {
        if (G.paso !== paso || !G.vivo) return;
        if (!r) { ind('Pon tu cara frente a la cámara'); setTimeout(ciclo, 150); return; }
        var l = r.landmarks, e = (ear(l.getLeftEye()) + ear(l.getRightEye())) / 2;
        if (G.vivo === 1) { maxEar = Math.max(maxEar, e); if (++frente >= 3) { G.vivo = 2; ind('Ahora parpadea'); } }
        else {
          maxEar = Math.max(maxEar, e);
          if (!cerro && e < maxEar * 0.8) cerro = true;
          else if (cerro && e > maxEar * 0.9) { capturarVivo(); return; }
        }
        setTimeout(ciclo, 90);
      }).catch(function () { setTimeout(ciclo, 300); });
    })();
  }
  function capturarVivo() {
    var f = cuadro(960, 0.85);
    G.vivo = 0; G.prev = f.url(); G.analizando = 'Comparando con tu cédula…'; pintar();
    leerCara(f.c).then(function (r) {
      G.analizando = '';
      if (!r) { G.prev = null; G.error = 'No se ve bien tu cara. Ponte de frente a una luz y vuelve a intentarlo.'; pintar(); return; }
      var desc = Array.prototype.slice.call(r.descriptor), dc = distancia(desc, G.fotos.descCedula);
      G.d.parecido = Math.round(dc * 1000) / 1000;
      if (dc > UMBRAL_CEDULA) { G.fallos++; ir('noCoincide'); return; }
      G.fotos.descriptor = desc; G.fotos.cara = cuadro(480, 0.72, f.c).url(); G.fallos = 0;
      ir('terminos');
    }).catch(function () { G.analizando = ''; G.prev = null; G.error = 'No se pudo revisar la foto. Revisa tu internet.'; pintar(); });
  }

  // ---------- Riesgo del viaje ----------
  function horaAhora() { return PRUEBA.hora != null ? PRUEBA.hora : new Date().getHours(); }
  function esNoche() { var h = horaAhora(); return h >= CFG.nocheDesde || h < CFG.nocheHasta; }
  function enZonaRiesgo(v) { return !!PRUEBA.zona; }   // la central marca las zonas en el panel
  function motivos(v, perfil, nViajes) {
    var m = [];
    if (esNoche()) m.push('noche');
    if (enZonaRiesgo(v)) m.push('zona');
    if (nViajes < CFG.viajesParaConfiar) m.push('nueva');
    if (perfil && perfil.celular !== idCelular()) m.push('celular');
    return m;
  }

  // ---------- Clics ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#seg [data-s]'); if (!b) return;
    var a = b.getAttribute('data-s');
    if (a === 'ir') { ir(b.getAttribute('data-a')); return; }
    if (a === 'atras') { ir('porque'); return; }
    if (a === 'repetir') { G.prev = null; G.error = ''; pintar(); return; }
    if (a === 'datosOk') {
      var n = $('#s-nombre').value.trim().replace(/\s+/g, ' '), c = $('#s-cedula').value.replace(/\D/g, ''), t = $('#s-tel').value.replace(/\D/g, '');
      G.d.nombre = n; G.d.cedula = c; G.d.tel = t;
      if (n.split(' ').length < 2) { G.error = 'Escribe tu nombre y tu apellido.'; pintar(); return; }
      if (!cedulaValida(c)) { G.error = 'Ese número de cédula no es válido. Revísalo.'; pintar(); return; }
      if (!/^09\d{8}$/.test(t)) { G.error = 'Escribe tu celular de 10 dígitos (empieza con 09).'; pintar(); return; }
      var bloq = leer('aac_bloqueados', []);
      if (bloq.indexOf(c) >= 0 || bloq.indexOf(t) >= 0) { G.error = 'No puedes crear una cuenta con estos datos. Comunícate con la central.'; pintar(); return; }
      ir('porque'); cargarFA().catch(function () { }); return;
    }
    if (a === 'fotoCedula') { if (!C.video || !C.video.videoWidth) return; G.prev = cuadro(1280, 0.85).url(); G.error = ''; pintar(); return; }
    if (a === 'usarCedula') {
      var img = new Image(); G.analizando = 'Revisando tu cédula…'; pintar();
      img.onload = function () {
        cargarFA().then(function () { return leerCara(img); }).then(function (r) {
          G.analizando = '';
          if (!r) { G.prev = null; G.error = 'No se ve bien la foto de tu cédula. Acércala, con buena luz y sin reflejos.'; pintar(); return; }
          G.fotos.cedula = cuadro(900, 0.8, img).url(); G.fotos.descCedula = Array.prototype.slice.call(r.descriptor);
          ir('cara');
        }).catch(function () { G.analizando = ''; G.error = 'No se pudo revisar la foto. Revisa tu internet.'; pintar(); });
      };
      img.src = G.prev; return;
    }
    if (a === 'vivo') { cargarFA().then(enVivo).catch(function () { G.error = 'No se pudo cargar el verificador. Revisa tu internet.'; pintar(); }); return; }
    if (a === 'aCentral') { ir('revision'); return; }
    if (a === 'crear') {
      if (!$('#s-acepto').checked) { G.error = 'Para crear tu cuenta tienes que aceptar las condiciones.'; pintar(); return; }
      var perfil = { nombre: G.d.nombre, cedula: G.d.cedula, tel: G.d.tel, descriptor: G.fotos.descriptor, descCedula: G.fotos.descCedula, foto: G.fotos.cara,
        celular: idCelular(), creado: Date.now(), acepto: Date.now() };
      guardar('aac_cuenta', perfil);
      var al = G.al; cerrar(); if (al) al(perfil); return;
    }
    if (a === 'entrar') { ir('entrar'); return; }
    if (a === 'entrarOk') {
      var cu = leer('aac_cuenta', null), ce = $('#s-ecedula').value.replace(/\D/g, ''), te = $('#s-etel').value.replace(/\D/g, '');
      if (!cu || cu.cedula !== ce || cu.tel !== te) { G.error = 'No encontramos una cuenta con esos datos. Revisa o crea una cuenta nueva.'; pintar(); return; }
      var al2 = G.al; cerrar(); if (al2) al2(cu); return;   // si es otro celular, se pedirá la cara al pedir
    }
    if (a === 'fotoSelfie') {
      if (!C.video || !C.video.videoWidth || G.analizando) return;
      var f = cuadro(960, 0.85); G.prev = f.url(); G.analizando = 'Revisando tu cara…'; pintar();
      cargarFA().then(function () { return leerCara(f.c); }).then(function (r) {
        G.analizando = '';
        if (!r) { G.prev = null; G.error = 'No se ve bien tu cara. Ponte de frente a una luz y toma otra.'; pintar(); return; }
        var desc = Array.prototype.slice.call(r.descriptor), pf = G.perfil;
        var ok = distancia(desc, pf.descriptor) <= UMBRAL && (!pf.descCedula || distancia(desc, pf.descCedula) <= UMBRAL_CEDULA);
        if (!ok) { ir('selfieMal'); return; }
        if (pf.celular !== idCelular()) { pf.celular = idCelular(); guardar('aac_cuenta', pf); }   // celular nuevo: ya quedó verificado
        G.vista = cuadro(720, 0.8, f.c).url(); ir('selfieOk');
      }).catch(function () { G.analizando = ''; G.prev = null; G.error = 'No se pudo revisar la foto. Revisa tu internet.'; pintar(); });
      return;
    }
    if (a === 'seguirPedido') { var ok2 = G.al; cerrar(); if (ok2) ok2(G.perfil); return; }
    if (a === 'cancelarPedido') { cerrar(); return; }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 's-cedula' || e.target.id === 's-tel' || e.target.id === 's-ecedula' || e.target.id === 's-etel') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  });

  // ---------- Lo que usa la app ----------
  window.AASeg = {
    registro: function (al) { G.al = al; G.d = {}; G.fotos = {}; G.fallos = 0; ir('bienvenida'); },
    // Antes de pedir: si el viaje es de riesgo, selfie. Si viaja otra persona, no se permite de noche ni en zona de riesgo.
    antesDePedir: function (v, perfil, nViajes, ok) {
      var m = motivos(v, perfil, nViajes);
      G.perfil = perfil; G.motivos = m; G.al = ok;
      if (!m.length) { ok(perfil); return; }
      cargarFA().catch(function () { });
      ir('selfieIntro');
    },
    paraOtraPermitido: function (v) { if (esNoche()) return 'De noche solo puede pedir el dueño de la cuenta.'; if (enZonaRiesgo(v)) return 'En zonas de riesgo solo puede pedir el dueño de la cuenta.'; return ''; },
    motivos: motivos, esNoche: esNoche, cedulaValida: cedulaValida, prueba: PRUEBA,
    cuenta: function () { return leer('aac_cuenta', null); },
    atras: function () { if (!G.paso) return false; cerrar(); return true; }
  };
})();
