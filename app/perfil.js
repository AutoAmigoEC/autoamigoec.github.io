/* AutoAmigo · Mi perfil (app del conductor).
 * Datos del registro (bloqueados), foto de perfil con requisitos y revisión automática, documentos con su
 * vencimiento (aviso y actualización), y carreras desde que se unió. Solo el teléfono y el correo se pueden cambiar.
 * Los datos llegan de la app en D.ficha / D.fotoPerfil / D.docsPendientes; las fotos grandes se piden aparte.
 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function accion(n, d) { try { if (window.AndroidAA) AndroidAA.accion(n, JSON.stringify(d || {})); } catch (e) { } }
  function aviso(t) { if (window.AA && AA.aviso) AA.aviso(t); }
  function render() { if (window.AARender) AARender(); }
  function fecha(iso) { if (!iso) return '—'; var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function hoyISO(d) { var x = new Date(); x.setDate(x.getDate() + (d || 0)); return x.toISOString().slice(0, 10); }
  function diasHasta(iso) { return Math.round((new Date(iso + 'T12:00:00') - new Date()) / 86400000); }
  var FA = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/';
  var D = null, FOTOS = null, P = { editar: null, paso: null, prev: null, doc: null, fecha: '', res: null, pidiendo: false };
  var DOCS = [['cedula', 'Cédula'], ['licencia', 'Licencia de conducir'], ['matricula', 'Matrícula del vehículo']];

  function estadoDoc(k) {
    var f = D && D.ficha, d = f && f.docs && f.docs[k], pend = D && D.docsPendientes && D.docsPendientes[k];
    if (pend) return ['pend', 'En revisión'];
    if (!d || !d.vence) return ['pend', 'Sin fecha'];
    var n = diasHasta(d.vence);
    if (n < 0) return ['mal', 'Vencida'];
    if (n <= 30) return ['pronto', 'Vence en ' + n + ' día' + (n === 1 ? '' : 's')];
    return ['ok', 'Vigente'];
  }
  function alertas() { if (!D || !D.ficha) return []; return DOCS.filter(function (x) { var e = estadoDoc(x[0])[0]; return e === 'mal' || e === 'pronto'; }); }
  function fila(et, v, k) {
    if (k && P.editar === k) return '<div class="pf-fila edit"><span>' + et + '</span><input id="pf-edit" value="' + esc(v) + '" type="' + (k === 'correo' ? 'email' : 'tel') + '"' + (k === 'telefono' ? ' inputmode="numeric" maxlength="10"' : '') + '><button data-p="guardar" data-k="' + k + '">Guardar</button></div>';
    return '<div class="pf-fila"><span>' + et + '</span><b>' + esc(v || '—') + '</b>' + (k ? '<button data-p="editar" data-k="' + k + '">Editar</button>' : '<i title="No se puede cambiar">🔒</i>') + '</div>';
  }
  function html(d) {
    D = d;
    var f = D.ficha, pf = D.fotoPerfil || {}, nombre = (f && f.nombre) || (D.perfil && D.perfil.nombre) || '';
    var foto = pf.estado === 'aprobada' ? P.fotoUrl : null;
    var estPf = { revision: ['pend', 'En revisión por la central'], aprobada: ['ok', 'Aprobada'], rechazada: ['mal', 'Rechazada' + (pf.motivo ? ': ' + pf.motivo : '')] }[pf.estado];
    var al = alertas();
    var n = D.carrerasTotal || 0;
    if (f && !FOTOS && !P.pidiendo) { P.pidiendo = true; accion('fichaFotos'); }
    if (pf.estado === 'aprobada' && !P.fotoUrl && !P.pidioPerfil) { P.pidioPerfil = true; accion('fotoPerfil'); }
    var h = '<h2>Mi perfil</h2>' +
      (al.length ? '<div class="pf-alerta">' + al.map(function (x) { return '<div><b>' + x[1] + ': ' + estadoDoc(x[0])[1].toLowerCase() + '</b> (' + fecha(f.docs[x[0]].vence) + '). <button data-p="doc" data-k="' + x[0] + '">Actualizar</button></div>'; }).join('') + '</div>' : '') +
      '<div class="pf-cab"><div class="pf-foto">' + (foto ? '<img src="' + foto + '">' : '<span>' + esc(nombre.split(' ').filter(Boolean).map(function (s) { return s[0]; }).slice(0, 2).join('').toUpperCase()) + '</span>') + '</div>' +
      '<div><b class="pf-nombre">' + esc(nombre) + '</b><small>Unidad ' + esc((D.perfil && D.perfil.unidad) || '') + (f && f.desde ? ' · Conductor desde ' + new Date(f.desde).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }) : '') + '</small>' +
      (estPf ? '<span class="pf-chip ' + estPf[0] + '">' + esc(estPf[1]) + '</span>' : '<span class="pf-chip pronto">Falta tu foto de perfil</span>') + '</div></div>' +
      (pf.estado !== 'aprobada' && pf.estado !== 'revision' && D.turno && D.turno.descriptor && D.turno.descriptor.length ? '<button class="pf-btn" data-p="foto">📷 ' + (pf.estado === 'rechazada' ? 'Tomar otra foto de perfil' : 'Tomar mi foto de perfil') + '</button>' : '') +
      '<div class="pf-stats"><div><b>' + (n >= 500 ? '500+' : n.toLocaleString('es-EC')) + '</b><small>Carreras desde que te uniste</small></div><div><b>' + (D.calif ? D.calif.toFixed(1) + ' ★' : '—') + '</b><small>' + (D.calif ? 'Calificación (' + D.califN + ')' : 'Todavía sin calificaciones') + '</small></div></div>';
    if (!f) return h + '<div class="vacio" style="margin-top:14px">Tus datos aparecerán aquí cuando la central complete tu registro.</div>';
    var ff = FOTOS || {};
    h += '<h3 class="pf-h">Datos personales</h3><div class="pf-caja">' + fila('Nombre', f.nombre) + fila('Cédula', f.cedula) + fila('Nacimiento', fecha(f.nacimiento)) + fila('Sector', f.sector) +
      fila('Teléfono', f.telefono, 'telefono') + fila('Correo', f.correo, 'correo') + '</div>' +
      '<h3 class="pf-h">Tu vehículo</h3><div class="pf-caja">' + fila('Placa', f.placa) + fila('Marca', f.marca) + fila('Color', f.color) + fila('Año', f.anio) +
      (ff.carro ? '<div class="pf-docfoto"><img src="' + ff.carro + '"><small>Foto del carro 🔒</small></div>' : '') + '</div>' +
      '<h3 class="pf-h">Documentos</h3><div class="pf-caja">' + DOCS.map(function (x) {
        var dd = (f.docs || {})[x[0]] || {}, e = estadoDoc(x[0]);
        return '<div class="pf-doc">' + (ff[x[0]] ? '<img src="' + ff[x[0]] + '">' : '<span class="pf-doc-ic">📄</span>') + '<div><b>' + x[1] + '</b><small>Vence: ' + fecha(dd.vence) + '</small><span class="pf-chip ' + e[0] + '">' + e[1] + '</span></div>' +
          (e[0] === 'mal' || e[0] === 'pronto' ? '<button data-p="doc" data-k="' + x[0] + '">Actualizar</button>' : '<i>🔒</i>') + '</div>';
      }).join('') + '</div>' +
      '<p class="pf-nota">Tus datos y fotos no se pueden cambiar. Solo puedes cambiar tu teléfono y tu correo. Si un documento vence, actualízalo aquí.</p>';
    return h;
  }

  // ---------- Cámara ----------
  var CAM = { stream: null, frente: null, video: null };
  function abrirCam(frente) {
    if (!CAM.video) { CAM.video = document.createElement('video'); CAM.video.setAttribute('playsinline', ''); CAM.video.muted = true; CAM.video.autoplay = true; }
    CAM.video.classList.toggle('espejo', !!frente);
    if (CAM.stream && CAM.frente === frente) return;
    cerrarCam(); CAM.frente = frente;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { P.error = 'Actualiza la app para usar la cámara.'; pintar(); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      .then(function (s) { CAM.stream = s; CAM.video.srcObject = s; CAM.video.play().catch(function () { }); })
      .catch(function () { P.error = 'Activa el permiso de cámara de AutoAmigo.'; pintar(); });
  }
  function cerrarCam() { if (CAM.stream) CAM.stream.getTracks().forEach(function (t) { t.stop(); }); CAM.stream = null; CAM.frente = null; }
  function capturar(ancho, cal) {
    var v = CAM.video; if (!CAM.stream || !v || !v.videoWidth) return null;
    var w = Math.min(ancho, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'); if (CAM.frente) { g.translate(w, 0); g.scale(-1, 1); } g.drawImage(v, 0, 0, w, h); return c.toDataURL('image/jpeg', cal);
  }
  var carga = null;
  function cargarFA() {
    if (carga) return carga;
    carga = new Promise(function (ok, mal) { if (window.faceapi) return ok(); var s = document.createElement('script'); s.src = FA + 'dist/face-api.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s); })
      .then(function () { return Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(FA + 'model/'), faceapi.nets.faceLandmark68Net.loadFromUri(FA + 'model/'), faceapi.nets.faceRecognitionNet.loadFromUri(FA + 'model/')]); })
      .catch(function (e) { carga = null; throw e; });
    return carga;
  }
  function distancia(a, b) { var s = 0; for (var i = 0; i < 128; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }

  // ---------- Foto de perfil y documento renovado (pantalla completa) ----------
  function pintar() {
    var el = $('#pfoto'); if (!el) return;
    var h = '', cam = null;
    if (!P.paso) { el.hidden = true; cerrarCam(); return; }
    el.hidden = false;
    var err = P.error ? '<div class="motivo">' + esc(P.error) + '</div>' : '';
    if (P.paso === 'requisitos') {
      h = '<div class="vcab"><b>Foto de perfil</b><button data-f="cerrar">✕</button></div><div class="vcuerpo"><h2>Antes de tomar tu foto</h2><p>Es la foto que verán tus clientes.</p>' +
        '<div class="vlista"><div><b>✓ Fondo blanco o gris claro</b><p>Párate frente a una pared clara, sin cosas detrás.</p></div><div><b>✓ Camisa manga larga sin estampado</b><p>Un solo color, sin dibujos, letras ni logos.</p></div><div><b>✓ De frente y sin gorra ni gafas</b><p>Revisaremos que seas la misma persona de tu cédula y tu licencia.</p></div></div>' +
        '<div class="reglas"><span class="no">✕ Fondo de colores</span><span class="no">✕ Camiseta</span><span class="no">✕ Estampados</span></div><button class="vbtn" data-f="camara">Tomar foto</button></div>';
    } else if (P.paso === 'camara') {
      cam = true;
      h = '<div class="vcab"><b>Foto de perfil</b><button data-f="cerrar">✕</button></div><div class="vcuerpo"><h2>Mira a la cámara</h2><p>Fondo claro y camisa manga larga sin estampado.</p>' + err +
        (P.prev ? '<div class="cam"><img src="' + P.prev + '"></div><div class="fila2"><button class="vbtn claro" data-f="repetir">Repetir</button><button class="vbtn" data-f="enviar">Enviar</button></div>'
          : '<div class="cam" id="pcam"><div class="ovalo"></div></div><button class="vbtn" data-f="tomar">Tomar foto</button>') + '</div>';
      if (P.prev) cam = null;
    } else if (P.paso === 'enviando') {
      h = '<div class="vcuerpo" style="padding-top:90px"><div class="grande espera"></div><h2 class="centro">Revisando tu foto…</h2><p class="centro">Comparamos tu cara con la de tu cédula y tu licencia.</p></div>';
    } else if (P.paso === 'resultado') {
      var r = P.res, ok = r.estado === 'aprobada', duda = r.estado === 'revision' || r.estado === 'pendiente';
      h = '<div class="vcuerpo" style="padding-top:60px"><div class="grande' + (ok ? '' : duda ? '' : ' mal') + '"' + (duda ? ' style="background:var(--navy)"' : '') + '>' + (ok ? '✓' : duda ? '…' : '✕') + '</div><h2 class="centro">' + esc(r.titulo) + '</h2>' +
        (r.motivo ? '<div class="motivo">' + esc(r.motivo) + '</div>' : '') + '<p class="centro">' + esc(r.texto) + '</p><button class="vbtn" data-f="' + (ok || duda ? 'cerrar' : r.reintentar) + '">' + (ok || duda ? 'Listo' : 'Tomar otra foto') + '</button></div>';
    } else if (P.paso === 'doc') {
      var nom = DOCS.filter(function (x) { return x[0] === P.doc; })[0][1].toLowerCase();
      cam = false;
      h = '<div class="vcab"><b>Actualizar ' + nom + '</b><button data-f="cerrar">✕</button></div><div class="vcuerpo"><h2>Tu ' + nom + ' renovada</h2><p>Toma la foto del documento nuevo y pon su nueva fecha de vencimiento. La central lo revisará.</p>' + err +
        (P.prev ? '<div class="cam ancha"><img src="' + P.prev + '"></div><button class="vbtn claro" data-f="repetir">Repetir foto</button>' : '<div class="cam ancha" id="pcam"><div class="marco"></div></div><button class="vbtn" data-f="tomar">Tomar foto</button>') +
        '<label class="campo">Nueva fecha de vencimiento<input id="pf-fecha" type="date" min="' + hoyISO(1) + '" value="' + esc(P.fecha) + '"></label>' +
        '<button class="vbtn" data-f="enviar-doc"' + (P.prev ? '' : ' disabled') + '>Enviar a revisión</button></div>';
      if (P.prev) cam = null;
    }
    if (el.__h !== h) { el.innerHTML = h; el.__h = h; }
    if (cam !== null) { abrirCam(cam); var c = $('#pcam'); if (c && CAM.video && CAM.video.parentNode !== c) c.insertBefore(CAM.video, c.firstChild); } else cerrarCam();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#seccion-cuerpo [data-p]');
    if (b) {
      var a = b.getAttribute('data-p'), k = b.getAttribute('data-k');
      if (a === 'editar') { P.editar = k; render(); setTimeout(function () { var i = $('#pf-edit'); if (i) i.focus(); }, 50); return; }
      if (a === 'guardar') {
        var v = ($('#pf-edit').value || '').trim();
        if (k === 'telefono' && !/^09\d{8}$/.test(v)) { aviso('El teléfono debe tener 10 números y empezar con 09.'); return; }
        if (k === 'correo' && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) { aviso('Ese correo no es válido.'); return; }
        var o = {}; o[k] = v; accion('guardarContacto', o); P.editar = null; render(); return;
      }
      if (a === 'foto') { P.paso = 'requisitos'; P.prev = null; P.error = ''; pintar(); return; }
      if (a === 'doc') { P.paso = 'doc'; P.doc = k; P.prev = null; P.fecha = ''; P.error = ''; pintar(); return; }
    }
    var f = e.target.closest('#pfoto [data-f]'); if (!f) return;
    var x = f.getAttribute('data-f');
    if (x === 'cerrar') { P.paso = null; pintar(); render(); return; }
    if (x === 'camara') { P.paso = 'camara'; P.prev = null; P.error = ''; pintar(); cargarFA().catch(function () { }); return; }
    if (x === 'tomar') { P.fecha = ($('#pf-fecha') || {}).value || P.fecha; var cap = capturar(P.paso === 'doc' ? 960 : 600, P.paso === 'doc' ? 0.72 : 0.7); if (!cap) { aviso('Espera a que se encienda la cámara.'); return; } P.prev = cap; pintar(); return; }
    if (x === 'repetir') { P.fecha = ($('#pf-fecha') || {}).value || P.fecha; P.prev = null; pintar(); return; }
    if (x === 'enviar') {
      var foto = P.prev; P.paso = 'enviando'; P.error = ''; pintar();
      cargarFA().then(function () {
        return new Promise(function (ok) { var img = new Image(); img.onload = function () { faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor().then(ok, function () { ok(null); }); }; img.src = foto; });
      }).then(function (r) {
        if (!r) { P.paso = 'camara'; P.prev = null; P.error = 'No vemos bien tu cara. Ponte de frente, con buena luz y sin gafas.'; pintar(); return; }
        var d = Array.prototype.slice.call(r.descriptor), ref = (D.turno && D.turno.descriptor) || [], refC = (D.turno && D.turno.descCedula) || [];
        var cara = {};
        if (ref.length === 128) cara.persona = Math.round(distancia(d, ref) * 1000) / 1000;
        if (refC.length === 128) cara.cedula = Math.round(distancia(d, refC) * 1000) / 1000;
        P.fotoEnviada = foto;
        accion('perfilEnviar', { foto: foto, cara: cara });
      }).catch(function () { P.paso = 'camara'; P.error = 'Revisa tu internet e intenta otra vez.'; pintar(); });
      return;
    }
    if (x === 'enviar-doc') {
      var fe = ($('#pf-fecha') || {}).value;
      if (!fe || diasHasta(fe) < 1) { aviso('Pon la nueva fecha de vencimiento.'); return; }
      P.paso = 'enviando'; pintar();
      accion('documentoEnviar', { doc: P.doc, foto: P.prev, vence: fe });
      return;
    }
  });

  window.AAPerfil = {
    html: html,
    estado: function (d) { D = d; },
    alertas: function (d) { D = d; return alertas(); },
    fotos: function (json) { try { FOTOS = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { FOTOS = {}; } P.pidiendo = false; render(); },
    fotoPerfil: function (url) { P.fotoUrl = url || null; render(); pintarAvatar(); },
    // Respuesta del servidor (foto de perfil o documento)
    respuesta: function (tipo, json) {
      var r; try { r = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { r = { ok: false }; }
      if (!r || !r.ok) { P.paso = tipo === 'documento' ? 'doc' : 'camara'; P.error = (r && r.error) || 'No se pudo enviar. Revisa tu internet.'; pintar(); return; }
      if (tipo === 'documento') { P.paso = null; pintar(); render(); aviso('Enviado. La central revisará tu documento nuevo.'); return; }
      if (r.estado === 'aprobada') { P.fotoUrl = P.fotoEnviada; pintarAvatar(); P.res = { estado: 'aprobada', titulo: '¡Foto de perfil aprobada!', texto: 'Coincide con tu cédula y tu licencia y cumple los requisitos. Ya la verán tus clientes.' }; }
      else if (r.estado === 'revision') P.res = { estado: 'revision', titulo: 'Tu foto la está revisando la central', texto: 'La revisión automática no pudo decidir. Te avisaremos apenas la aprueben.' };
      else P.res = { estado: 'rechazada', titulo: 'Tu foto no fue aprobada', motivo: r.motivo, texto: 'Corrige lo indicado y toma otra foto.', reintentar: 'camara' };
      P.paso = 'resultado'; pintar(); render();
    },
    atras: function () { if (!P.paso) return false; P.paso = null; pintar(); return true; }
  };
  function pintarAvatar() {
    var fp = P.fotoUrl;
    document.querySelectorAll('#avatar, .lateral .quien .avatar').forEach(function (av) {
      if (fp && av.__fp !== fp) { av.__fp = fp; av.style.background = 'center/cover url(' + JSON.stringify(fp) + ')'; av.style.color = 'transparent'; }
    });
  }
  // Aviso en el inicio cuando un documento vence o está por vencer
  setInterval(function () {
    var al = $('#doc-alerta'); if (!al || !D) return;
    var a = alertas(), venc = a.filter(function (x) { return estadoDoc(x[0])[0] === 'mal'; });
    al.hidden = !a.length;
    if (a.length) { al.className = 'doc-alerta' + (venc.length ? ' mal' : ''); al.textContent = venc.length ? '⚠ Tu ' + venc[0][1].toLowerCase() + ' está vencida · Actualizar' : '⚠ Tu ' + a[0][1].toLowerCase() + ' vence pronto · Ver'; }
  }, 1500);
  document.addEventListener('click', function (e) { if (e.target.closest('#doc-alerta') && window.AAIr) AAIr('perfil'); });
})();
