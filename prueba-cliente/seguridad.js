/* AutoAmigo Cliente · Seguridad (cuidar a los conductores)
 *
 * 1) Crear cuenta (rápido, para no perder clientes): datos + número de cédula válido + foto de la cédula + foto de su cara.
 *    Dos toques del botón redondo: cada foto se revisa sola apenas se toma. La cara tiene que coincidir con la de la cédula.
 *    Esa cédula queda como la referencia para siempre: no se vuelve a pedir.
 * 2) Antes de pedir, si el viaje es de riesgo (de noche, zona de riesgo, cuenta nueva o celular nuevo):
 *    selfie rápida, comparada con la cara de SU cédula y la de su registro.
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

  // ---------- Cédula de Ecuador: dígito verificador ----------
  function cedulaValida(c) {
    if (!/^\d{10}$/.test(c)) return false;
    var prov = +c.slice(0, 2); if (!((prov >= 1 && prov <= 24) || prov === 30)) return false;
    if (+c[2] > 5) return false;
    var s = 0;
    for (var i = 0; i < 9; i++) { var n = +c[i] * (i % 2 ? 1 : 2); s += n > 9 ? n - 9 : n; }
    return (10 - s % 10) % 10 === +c[9];
  }

  // ---------- Servidor de revisión ----------
  var URL_SRV = null;
  function servidor() {
    if (URL_SRV) return Promise.resolve(URL_SRV);
    return fetch('../app/servidor.json?v=' + Date.now()).then(function (r) { return r.json(); }).then(function (s) { URL_SRV = String(s && s.url || '').replace(/\/+$/, ''); if (!/^https:\/\//.test(URL_SRV)) throw new Error('srv'); return URL_SRV; });
  }
  function llamar(ruta, cuerpo) {
    return servidor().then(function (u) { return fetch(u + '/' + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }); })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j) throw new Error('No se pudo.'); if (!j.ok && !j.corregir) throw new Error(j.error || 'No se pudo.'); return j; });
  }
  // Código del teléfono (para "Restringir"): en la app lo dará el teléfono; en el navegador, una marca guardada + rasgos del equipo
  function sha(s) {
    try { return crypto.subtle.digest('SHA-256', new TextEncoder().encode('AutoAmigo|' + s)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 32); }); }
    catch (e) { return Promise.resolve(''); }
  }
  function equipo() {
    var e = {};
    try { if (window.AndroidCliente && AndroidCliente.equipo) e = JSON.parse(AndroidCliente.equipo()) || {}; } catch (er) { e = {}; }
    var marca = null;
    try { marca = localStorage.getItem('aa_eq'); if (!marca) { var a = new Uint32Array(4); crypto.getRandomValues(a); marca = Array.prototype.map.call(a, function (x) { return x.toString(16); }).join(''); localStorage.setItem('aa_eq', marca); } } catch (er) { }
    var rasgos = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height + 'x' + (window.devicePixelRatio || 1), navigator.hardwareConcurrency || '', navigator.deviceMemory || '', (Intl.DateTimeFormat().resolvedOptions().timeZone || '')].join('|');
    return Promise.all([marca ? sha('l:' + marca) : Promise.resolve(''), sha('f:' + rasgos)]).then(function (x) { if (x[0]) e.l = x[0]; if (x[1]) e.f = x[1]; return e; }, function () { return e; });
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
      '<div class="vcf-top">' + (G.analizando || !o.titulo ? '<span></span>' : '<div class="vcf-tit">' + (o.paso ? '<small>' + esc(o.paso) + '</small>' : '') + '<b>' + esc(o.titulo) + '</b>' + (o.ayuda ? '<span>' + esc(o.ayuda) + '</span>' : '') + '</div>') +
      (/^(cancelarPedido|atras)$/.test(o.cerrar || 'atras') ? '<button class="vcf-x" data-s="' + (o.cerrar || 'atras') + '"' : '<button class="vcf-x" data-s="ir" data-a="' + o.cerrar + '"') + ' aria-label="Cerrar">✕</button></div>' +
      (o.indica ? '<div class="vcf-indica" id="sindica">' + esc(o.indica) + '</div>' : '') +
      (G.error ? '<div class="vcf-error">' + esc(G.error) + '</div>' : '') +
      '<div class="vcf-bot">' + abajo + '</div></div>';
  }

  // ---------- Estado ----------
  var G = { paso: null, d: {}, fotos: {}, prev: null, analizando: '', error: '', fallos: 0, al: null, viaje: null, motivos: [] };
  function ir(p) { G.paso = p; G.prev = null; G.error = ''; G.analizando = ''; pintar(); }
  function cerrar() { G.paso = null; pintar(); }

  function tarjeta(cuerpo, titulo, atras) {
    return '<div class="scab">' + (atras ? '<button class="satras" data-s="ir" data-a="' + atras + '" aria-label="Atrás">‹</button>' : '<span></span>') + '<b>' + esc(titulo || '') + '</b><span></span></div><div class="scuerpo">' + cuerpo + '</div>';
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
        '<button class="sbtn" data-s="datosOk">' + (d.corrigiendo ? 'Corregir y continuar' : 'Continuar') + '</button>', 'Crear mi cuenta', 'bienvenida');
    } else if (p === 'cedula') {
      el.className = 'seg negro';
      cam = G.prev ? null : false;
      h = camaraHTML({ paso: 'Paso 1 de 2', titulo: 'Frente de tu cédula', ayuda: 'Ponla dentro del recuadro, que se vea tu foto. Sin reflejos.', marco: !G.prev, foto: G.prev, cerrar: 'datos', disparo: 'fotoCedula' });
    } else if (p === 'cara') {
      el.className = 'seg negro';
      cam = G.prev ? null : true;
      h = camaraHTML({ paso: 'Paso 2 de 2', titulo: 'Tu foto', ayuda: 'Mira de frente, con buena luz, sin gafas, sin gorra.', foto: G.prev, cerrar: 'datos', disparo: 'fotoCara' });
    } else if (p === 'noCoincide') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande mal">✕</div><h2 class="c">Tu cara no coincide con la de tu cédula</h2>' +
        '<p class="c">Ponte de frente a una luz, sin gafas, sin gorra. Revisa también que la foto de la cédula se vea clara.</p>' +
        '<button class="sbtn" data-s="ir" data-a="cara">Tomar mi foto otra vez</button>' +
        '<button class="sbtn claro" data-s="ir" data-a="cedula">Tomar la cédula otra vez</button>', 'Crear mi cuenta', 'datos');
    } else if (p === 'terminos') {
      el.className = 'seg';
      h = tarjeta((G.d.noCoincide ? '' : '<div class="sok">✓ Tu cara coincide con la de tu cédula</div>') + '<h2>Último paso</h2>' +
        '<div class="slista"><div><b>Tu cuenta es personal</b><p>No la prestes. Si alguien más va a viajar, pídelo con la opción "Para otra persona".</p></div>' +
        '<div><b>Eres responsable de tu cuenta</b><p>Si tu cuenta se usa para hacerle daño a un conductor, tus datos se entregarán a la Policía.</p></div>' +
        '<div><b>Tu cuenta queda en este celular</b><p>Si entras desde otro teléfono, te pediremos tu cara otra vez.</p></div>' +
        '<div><b>A veces te pediremos tu cara</b><p>En viajes de noche o a zonas de riesgo, una foto rápida antes de pedir, que se compara con tu cédula.</p></div>' +
        '<div><b>Revisamos los antecedentes</b><p>Para cuidar a los conductores, AutoAmigo revisa los antecedentes de cada cuenta en los registros públicos.</p></div></div>' +
        '<label class="sacepto"><input type="checkbox" id="s-acepto"' + (G.d.acepto ? ' checked' : '') + '> Acepto las condiciones de uso, que AutoAmigo guarde mi cédula y mi cara solo para verificar que soy yo, y autorizo a AutoAmigo a verificar mis antecedentes en los registros públicos (Policía, Función Judicial y Fiscalía).</label>' + err +
        (G.creando ? '<button class="sbtn rojo" disabled>Creando tu cuenta…</button>' : '<button class="sbtn rojo" data-s="crear">Crear mi cuenta</button>'), 'Crear mi cuenta', 'cara');
    } else if (p === 'revision') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande espera"></div><h2 class="c">Estamos revisando tu cuenta</h2>' +
        '<p class="c">Te avisaremos pronto.</p>', 'Cuenta en revisión');
    } else if (p === 'suspendido') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande mal">!</div><h2 class="c">Tu cuenta está suspendida</h2>' +
        '<p class="c">Comunícate con AutoAmigo.</p>', 'Cuenta suspendida');
    } else if (p === 'entrar') {
      el.className = 'seg';
      h = tarjeta('<h2>Entrar a mi cuenta</h2><p>Escribe tu cédula y tu celular.</p>' + err +
        '<label class="slbl" for="s-ecedula">Número de cédula</label><input class="sent" id="s-ecedula" inputmode="numeric" maxlength="10">' +
        '<label class="slbl" for="s-etel">Número de celular</label><input class="sent" id="s-etel" inputmode="tel" maxlength="10">' +
        '<button class="sbtn" data-s="entrarOk">Entrar</button>', 'Ya tengo cuenta', 'bienvenida');
    } else if (p === 'selfieIntro') {
      el.className = 'seg';
      var txt = { noche: 'Es de noche', zona: 'Zona de riesgo', nueva: 'Tu cuenta es nueva', celular: 'Estás en un celular nuevo' };
      h = tarjeta('<div class="sgrande" style="background:var(--navy)">🛡️</div><h2 class="c">Una foto rápida</h2>' +
        '<p class="c">Confirmamos que eres tú para proteger a nuestros conductores. Son 5 segundos.</p>' +
        '<div class="schips">' + G.motivos.map(function (m) { return '<span>' + txt[m] + '</span>'; }).join('') + '</div>' +
        '<button class="sbtn" data-s="ir" data-a="selfie">Tomar mi foto</button><button class="sbtn claro" data-s="cancelarPedido">Ahora no</button>', '');
    } else if (p === 'selfie') {
      el.className = 'seg negro';
      cam = G.prev ? null : true;
      h = camaraHTML({ foto: G.prev, disparo: 'fotoSelfie', cerrar: 'cancelarPedido' });
    } else if (p === 'selfieOk') {
      el.className = 'seg negro';
      h = camaraHTML({ titulo: '✓ Eres ' + ((G.perfil && G.perfil.nombre || '').split(' ')[0] || 'tú'), ayuda: 'Tu cara coincide con la de tu cédula.', foto: G.vista,
        abajo: '<button class="sbtn verde" data-s="seguirPedido">Pedir AutoAmigo</button>', cerrar: 'cancelarPedido' });
    } else if (p === 'selfieMal') {
      el.className = 'seg';
      h = tarjeta('<div class="sgrande mal">✕</div><h2 class="c">Solo el dueño de la cuenta puede pedir el viaje.</h2>' +
        '<button class="sbtn" data-s="ir" data-a="selfie">Intentar otra vez</button><button class="sbtn claro" data-s="cancelarPedido">Cancelar</button>', '');
    }
    if (el.__h !== h) { var foco = document.activeElement && document.activeElement.id, val = foco && $('#' + foco) ? $('#' + foco).value : null; el.innerHTML = h; el.__h = h; if (foco && $('#' + foco) && val != null) { $('#' + foco).value = val; $('#' + foco).focus(); } }
    if (cam !== null) { abrirCam(cam).then(montarCam, function () { }); montarCam(); } else cerrarCam();
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
    if (a === 'atras') { ir('datos'); return; }
    if (a === 'repetir') { G.prev = null; G.error = ''; pintar(); return; }
    if (a === 'datosOk') {
      var n = $('#s-nombre').value.trim().replace(/\s+/g, ' '), c = $('#s-cedula').value.replace(/\D/g, ''), t = $('#s-tel').value.replace(/\D/g, '');
      G.d.nombre = n; G.d.cedula = c; G.d.tel = t;
      if (n.split(' ').length < 2) { G.error = 'Escribe tu nombre y tu apellido.'; pintar(); return; }
      if (!cedulaValida(c)) { G.error = 'Ese número de cédula no es válido. Revísalo.'; pintar(); return; }
      if (!/^09\d{8}$/.test(t)) { G.error = 'Escribe tu celular de 10 dígitos (empieza con 09).'; pintar(); return; }
      var bloq = leer('aac_bloqueados', []);
      if (bloq.indexOf(c) >= 0 || bloq.indexOf(t) >= 0) { G.error = 'No puedes crear una cuenta con estos datos. Comunícate con la central.'; pintar(); return; }
      if (G.d.corrigiendo && G.fotos.cara && G.fotos.cedula) { G.d.corrigiendo = false; ir('terminos'); return; }   // ya tiene las fotos: solo corrigió lo escrito
      ir('cedula'); return;
    }
    if (a === 'fotoCedula') {
      if (!C.video || !C.video.videoWidth || G.analizando) return;
      var fc = cuadro(1280, 0.85); G.prev = fc.url(); G.analizando = 'Revisando tu cédula…'; G.error = ''; pintar();
      cargarFA().then(function () { return leerCara(fc.c); }).then(function (r) {
        G.analizando = '';
        if (!r) { G.prev = null; G.error = 'No se ve bien la foto de tu cédula. Acércala, con buena luz y sin reflejos, y toma otra.'; pintar(); return; }
        G.fotos.descCedula = Array.prototype.slice.call(r.descriptor); G.fotos.cedula = cuadro(900, 0.8, fc.c).url();
        ir('cara');
      }).catch(function () { G.analizando = ''; G.prev = null; G.error = 'No se pudo revisar la foto. Revisa tu internet.'; pintar(); });
      return;
    }
    if (a === 'fotoCara') {
      if (!C.video || !C.video.videoWidth || G.analizando) return;
      var fr = cuadro(1600, 0.92); G.prev = fr.url(); G.analizando = 'Revisando tu foto…'; pintar();
      cargarFA().then(function () { return leerCara(fr.c); }).then(function (r) {
        G.analizando = '';
        if (!r) { G.prev = null; G.error = 'No se ve bien tu cara. Ponte de frente a una luz, sin gafas, sin gorra, y toma otra.'; pintar(); return; }
        var desc = Array.prototype.slice.call(r.descriptor);
        G.d.parecido = Math.round(distancia(desc, G.fotos.descCedula) * 1000) / 1000;
        // Encuadre y luz (como la foto del conductor). Si sale mal 2 veces, se usa igual.
        var enc = window.AAEncuadre ? AAEncuadre.arreglar(fr.url()) : Promise.resolve({ ok: true, foto: cuadro(480, 0.8, fr.c).url() });
        return enc.then(function (e) {
          if (!e.ok && G.fallosFoto < 1) { G.fallosFoto++; G.prev = null; G.error = e.motivo; pintar(); return; }
          G.fallosFoto = 0;
          // Su cara no coincide con la de la cédula: puede repetir una vez; si vuelve a fallar, sigue y la central lo revisa
          if (G.d.parecido > UMBRAL_CEDULA && G.fallos < 1) { G.fallos++; ir('noCoincide'); return; }
          G.d.noCoincide = G.d.parecido > UMBRAL_CEDULA;
          G.fotos.descriptor = desc; G.fotos.cara = e.ok ? e.foto : cuadro(800, 0.85, fr.c).url();
          ir('terminos');
        }, function () { G.fotos.descriptor = desc; G.fotos.cara = cuadro(800, 0.85, fr.c).url(); G.d.noCoincide = G.d.parecido > UMBRAL_CEDULA; ir('terminos'); });
      }).catch(function () { G.analizando = ''; G.prev = null; G.error = 'No se pudo revisar la foto. Revisa tu internet.'; pintar(); });
      return;
    }
    if (a === 'crear') {
      if (G.creando) return;
      if (!$('#s-acepto').checked) { G.error = 'Para crear tu cuenta tienes que aceptar las condiciones.'; pintar(); return; }
      G.d.acepto = true; G.creando = true; G.error = ''; pintar();
      equipo().then(function (eq) {
        return llamar('cliente/registro', { v: 1, prueba: true, equipo: eq, datos: { nombre: G.d.nombre, cedula: G.d.cedula, tel: G.d.tel },
          fotos: { cedula: G.fotos.cedula, cara: G.fotos.cara }, desc: { cara: G.fotos.descriptor, cedula: G.fotos.descCedula }, parecido: G.d.parecido });
      }).then(function (r) {
        G.creando = false;
        if (r.corregir) { G.d.corrigiendo = true; ir('datos'); G.error = r.error; pintar(); return; }   // solo lo que escribió: lo corrige él
        var perfil = { nombre: G.d.nombre, cedula: G.d.cedula, tel: G.d.tel, descriptor: G.fotos.descriptor, descCedula: G.fotos.descCedula, fotoCedula: G.fotos.cedula, parecido: G.d.parecido, foto: G.fotos.cara,
          celular: idCelular(), creado: Date.now(), acepto: Date.now(), srv: { id: r.id, token: r.token }, estado: r.estado };
        guardar('aac_cuenta', perfil);
        if (r.estado !== 'aprobado') { G.perfil = perfil; esperar(perfil, G.al); return; }   // no sabe por qué: solo "Estamos revisando tu cuenta"
        var al = G.al; cerrar(); if (al) al(perfil);
      }, function (er) { G.creando = false; G.error = /fetch|network|srv/i.test(er.message) ? 'No se pudo crear tu cuenta. Revisa tu internet e intenta otra vez.' : er.message; pintar(); });
      return;
    }
    if (a === 'entrar') { ir('entrar'); return; }
    if (a === 'entrarOk') {
      var cu = leer('aac_cuenta', null), ce = $('#s-ecedula').value.replace(/\D/g, ''), te = $('#s-etel').value.replace(/\D/g, '');
      if (!cu || cu.cedula !== ce || cu.tel !== te) { G.error = 'No encontramos una cuenta con esos datos. Revisa o crea una cuenta nueva.'; pintar(); return; }
      var al2 = G.al; cerrar(); AASeg.verificar(cu, al2); return;   // si es otro celular, se pedirá la cara al pedir
    }
    if (a === 'fotoSelfie') {
      if (!C.video || !C.video.videoWidth || G.analizando) return;
      var f = cuadro(960, 0.85); G.prev = f.url(); G.analizando = 'Revisando…'; pintar();
      cargarFA().then(function () { return leerCara(f.c); }).then(function (r) {
        G.analizando = '';
        if (!r) { G.prev = null; G.error = 'No se ve bien tu cara. Ponte de frente a una luz y toma otra.'; pintar(); return; }
        var desc = Array.prototype.slice.call(r.descriptor), pf = G.perfil;
        if (!pf.descriptor) { pf.descriptor = desc; guardar('aac_cuenta', pf); }   // cuenta de prueba aprobada sin cara: esta foto queda como su cara
        var ok = distancia(desc, pf.descriptor) <= UMBRAL && (!pf.descCedula || distancia(desc, pf.descCedula) <= UMBRAL_CEDULA);
        if (!ok) {
          if (pf.srv) llamar('cliente/intento', { id: pf.srv.id, token: pf.srv.token, foto: cuadro(640, 0.8, f.c).url() }).catch(function () { });
          ir('selfieMal'); return;
        }
        if (pf.celular !== idCelular()) { pf.celular = idCelular(); guardar('aac_cuenta', pf); }   // celular nuevo: ya quedó verificado
        G.vista = cuadro(720, 0.8, f.c).url();
        ir('selfieOk');
      }).catch(function () { G.analizando = ''; G.prev = null; G.error = 'No se pudo revisar la foto. Revisa tu internet.'; pintar(); });
      return;
    }
    if (a === 'seguirPedido') { var ok2 = G.al; cerrar(); if (ok2) ok2(G.perfil); return; }
    if (a === 'cancelarPedido') { cerrar(); return; }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 's-cedula' || e.target.id === 's-tel' || e.target.id === 's-ecedula' || e.target.id === 's-etel') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  });

  // ---------- Estado de la cuenta en el servidor ----------
  var espera = null;
  function estadoSrv(perfil) {
    if (!perfil || !perfil.srv || perfil.forzado) return Promise.resolve(perfil && perfil.estado || 'aprobado');
    return llamar('cliente/estado', { id: perfil.srv.id, token: perfil.srv.token }).then(function (r) {
      if (r.estado !== perfil.estado) { perfil.estado = r.estado; var g = leer('aac_cuenta', null); if (g && g.srv && g.srv.id === perfil.srv.id) { g.estado = r.estado; guardar('aac_cuenta', g); } }
      return r.estado;
    }, function () { return perfil.estado || 'aprobado'; });   // sin internet: lo último que se sabe
  }
  // Muestra "Estamos revisando tu cuenta" (o suspendida) y vuelve a mirar cada minuto; cuando la aprueban, sigue sola
  function esperar(perfil, al) {
    G.perfil = perfil; G.al = al; ir(perfil.estado === 'suspendido' ? 'suspendido' : 'revision');
    clearInterval(espera);
    espera = setInterval(function () {
      if (G.paso !== 'revision' && G.paso !== 'suspendido') { clearInterval(espera); return; }
      estadoSrv(perfil).then(function (e) {
        if (e === 'aprobado') { clearInterval(espera); var f = G.al; cerrar(); if (f) f(perfil); return; }
        var p = e === 'suspendido' ? 'suspendido' : 'revision'; if (G.paso !== p) ir(p);
      });
    }, 60000);
  }

  // ---------- Lo que usa la app ----------
  window.AASeg = {
    registro: function (al) { G.al = al; G.d = {}; G.fotos = {}; G.fallos = 0; G.fallosFoto = 0; G.creando = false; if (window.AAEncuadre) AAEncuadre.cargar().catch(function () { }); ir('bienvenida'); cargarFA().catch(function () { }); },   // se carga mientras llena sus datos
    // Antes de pedir: si el viaje es de riesgo, selfie. Si viaja otra persona, no se permite de noche ni en zona de riesgo.
    // Al abrir la app: si la cuenta está en revisión o suspendida, no puede pedir viajes
    verificar: function (perfil, ok) {
      if (!perfil) return;
      estadoSrv(perfil).then(function (e) { if (e === 'aprobado') { if (ok) ok(perfil); } else esperar(perfil, ok); });
    },
    antesDePedir: function (v, perfil, nViajes, ok) {
      if (perfil && perfil.srv && !perfil.forzado) {
        estadoSrv(perfil).then(function (e) { if (e !== 'aprobado') { esperar(perfil, null); return; } seguir(); });
        return;
      }
      seguir();
      function seguir() {
      var m = motivos(v, perfil, nViajes);
      G.perfil = perfil; G.motivos = m; G.al = ok; G.vista = null;
      if (!m.length) { ok(perfil); return; }
      cargarFA().catch(function () { });
      ir('selfieIntro');
      }
    },
    paraOtraPermitido: function (v) { if (esNoche()) return 'De noche solo puede pedir el dueño de la cuenta.'; if (enZonaRiesgo(v)) return 'En zonas de riesgo solo puede pedir el dueño de la cuenta.'; return ''; },
    motivos: motivos, esNoche: esNoche, cedulaValida: cedulaValida, prueba: PRUEBA,
    cuenta: function () { return leer('aac_cuenta', null); },
    atras: function () { if (!G.paso) return false; cerrar(); return true; },
    // Solo en el link de prueba: muestra una pantalla para verla (revisión, suspendida, selfie de otra persona)
    simular: function (paso, al) { G.perfil = leer('aac_cuenta', null); G.al = al || null; clearInterval(espera); ir(paso); },
    // Solo en el link de prueba: aprueba la verificación que esté en pantalla y sigue (sin crear la cuenta otra vez)
    aprobarPrueba: function () {
      if (!G.paso) return false;
      var al = G.al;
      if (['selfieIntro', 'selfie', 'selfieOk', 'selfieMal'].indexOf(G.paso) >= 0) { cerrar(); if (al) al(G.perfil); return true; }
      if (G.paso === 'revision' || G.paso === 'suspendido') {   // solo la prueba: la deja aprobada en este teléfono
        var pr = leer('aac_cuenta', null) || G.perfil; if (pr) { pr.estado = 'aprobado'; pr.forzado = true; guardar('aac_cuenta', pr); }
        clearInterval(espera); cerrar(); if (al) al(pr); return true;
      }
      var perfil = { nombre: G.d.nombre && G.d.nombre.split(' ').length > 1 ? G.d.nombre : 'Cliente de Prueba', cedula: cedulaValida(G.d.cedula || '') ? G.d.cedula : '0926687856',
        tel: /^09\d{8}$/.test(G.d.tel || '') ? G.d.tel : '0991234567', descriptor: G.fotos.descriptor || null, descCedula: G.fotos.descCedula || null,
        fotoCedula: G.fotos.cedula || null, foto: G.fotos.cara || null, celular: idCelular(), creado: Date.now(), acepto: Date.now(), prueba: true };
      guardar('aac_cuenta', perfil); cerrar(); if (al) al(perfil); return true;
    }
  };
})();
