/* AutoAmigo · Simulador del conductor (solo el link de prueba).
 *
 * La pantalla es EXACTAMENTE la de la app publicada (conductor.html + conductor.js + turno.js + perfil.js).
 * Este archivo reemplaza a la central (Firebase) y al GPS del teléfono: inventa las carreras, mueve el carro
 * por las calles y responde a los botones igual que la app de Android. Así lo que se prueba aquí es lo que ven
 * los conductores. Los "Controles de la prueba" (botón ⚙ Prueba) no salen en la app.
 */
(function () {
  if (window.AndroidAA) return;
  window.AATurnoPrueba = true;   // la primera foto de la cara queda como su registro (no hay central que compare)
  var D_ = window.Despacho, K = D_.cfgCompleta({});
  var OFERTA_SEG = 20, VEL = 45, SEG_EN_CERO = 3;
  function q(s) { return document.querySelector(s); }
  function js(f) { try { f(); } catch (e) { if (window.console) console.warn('[sim]', e); } }
  function aviso(t) { js(function () { AA.aviso(t); }); }
  function dineroC(c) { return '$' + ((c || 0) / 100).toFixed(2); }
  function hora(t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function inicioHoy() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function metros(a, b) { var r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2), y = Math.sin((b.lng - a.lng) * r / 2), h = x * x + Math.cos(a.lat * r) * Math.cos(b.lat * r) * y * y; return 2 * 6371000 * Math.asin(Math.sqrt(h)); }
  function kmCalle(a, b) { return metros(a, b) / 1000 * 1.3; }
  function hace(dias, h, m) { var d = new Date(); d.setDate(d.getDate() - dias); d.setHours(h, m, 0, 0); return d.getTime(); }
  function venceEn(dias) { var d = new Date(); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); }

  // ---------- Estado inventado (como lo tendría la central) ----------
  var S = {
    sesion: false, estado: 'desconectado', ocupado: false, saldoC: 1000, yo: { lat: -2.1330, lng: -79.8745 },
    turno: { estado: null, motivo: '', rehacer: [] }, simFalla: false, sinRed: false, porSubir: 0,
    perfil: { nombre: 'Carlos Mendoza', unidad: '12', placa: 'GBA-1234', colorCarro: '#F4F5F7' },
    ficha: { nombre: 'Carlos Mendoza', cedula: '0912345678', nacimiento: '1988-04-12', sector: 'Samborondón', telefono: '0991112233', correo: 'carlos@correo.com',
      placa: 'GBA-1234', marca: 'Chevrolet Aveo', color: 'Blanco', anio: '2019', desde: hace(400, 9, 0),
      docs: { licencia: { vence: venceEn(200) }, matricula: { vence: venceEn(8) }, cedula: { vence: venceEn(900) } } },
    fotoPerfil: {}, docsP: {},
    oferta: null, carrera: null, num: 1040, n: 0, proxima: 0,
    hechas: [], recargas: [{ montoC: 1000, codigo: '1111111111', t: (function () { var d = new Date(); d.setHours(7, 52, 0, 0); return d.getTime(); })() }],
    antiguas: [
      { t: hace(1, 18, 20), numero: 1031, cliente: 'Gabriela Ruiz', o: 'Plaza Lagos', d: 'Mall del Sol', cobradoC: 520, comC: 52, metros: 9800 },
      { t: hace(1, 9, 5), numero: 1027, cliente: 'Andrés León', o: 'Ciudad Celeste', d: 'Aeropuerto J.J. Olmedo', cobradoC: 780, comC: 78, metros: 15600 },
      { t: hace(3, 20, 40), numero: 1012, cliente: 'Lucía Paredes', o: 'La Puntilla', d: 'Urdesa', cobradoC: 450, comC: 50, metros: 8400 }
    ],
    bandeja: [
      { id: 'b1', cliente: 'Ana Morán', o: { dir: 'Av. Samborondón km 2.5', ref: 'Frente a Village Plaza', lat: -2.1405, lng: -79.8668 }, d: { dir: 'Mall del Sol', lat: -2.1550, lng: -79.8925 }, fijoC: 0, estC: 400 },
      { id: 'b2', cliente: 'Luis Peña', o: { dir: 'Isla Mocolí', ref: 'Garita principal', lat: -2.1015, lng: -79.8565 }, d: { dir: 'Entre Ríos', lat: -2.1530, lng: -79.8710 }, fijoC: 500, estC: 500 },
      { id: 'b3', cliente: 'Rosa Vera', o: { dir: 'Ciudad Celeste', ref: 'Etapa La Brisa', lat: -2.0790, lng: -79.8485 }, d: { dir: 'Aeropuerto J.J. Olmedo', lat: -2.1574, lng: -79.8837 }, fijoC: 0, estC: 650 },
      { id: 'b4', cliente: 'Pedro Alvarado', o: { dir: 'La Puntilla', ref: 'Junto al River Mall', lat: -2.1375, lng: -79.8815 }, d: { dir: 'Urdesa Central', lat: -2.1700, lng: -79.9100 }, fijoC: 0, estC: 380 }
    ]
  };
  var DEMO = [
    { cliente: 'María Torres', tel: '0991234567', o: { dir: 'Av. Samborondón', ref: 'Cerca de Plaza Lagos', lat: -2.1372, lng: -79.8650 }, d: { dir: 'C.C. Riocentro Entre Ríos', lat: -2.1555, lng: -79.8866 }, exacta: 'Edificio azul, 3er piso', calif: 4.9, viajes: 28, equipaje: false },
    { cliente: 'Jorge Salazar', tel: '0987654321', o: { dir: 'Urb. Ciudad Celeste', ref: 'Etapa La Marina', lat: -2.0805, lng: -79.8470 }, d: { dir: 'Aeropuerto J.J. Olmedo', lat: -2.1574, lng: -79.8837 }, exacta: 'Manzana 4 villa 12, carro gris', calif: 4.7, viajes: 12, equipaje: true }
  ];
  var CODIGOS = { '1111111111': { montoC: 1000, usado: true }, '2020202020': { montoC: 2000 }, '5050505050': { montoC: 5000 } };

  // ---------- Estado para la pantalla (mismo formato que la app de Android / web.js) ----------
  function pantallaLista() { return S.sesion && window.AA; }
  function enviar() {
    if (!pantallaLista()) return;
    var o = {}, desde = inicioHoy(), c = S.carrera;
    o.version = 'prueba';
    o.perfil = S.perfil;
    o.estado = S.estado === 'desconectado' ? 'desconectado' : (S.ocupado && !c ? 'ocupado' : 'conectado');
    o.turno = { requerido: true, camara: true, aprobadoHoy: S.turno.estado === 'aprobado', estado: S.turno.estado, motivo: S.turno.motivo, duda: '', por: S.turno.estado === 'rechazado' ? 'ia' : '',
      bloqueada: false, rehacer: S.turno.rehacer, identidad: 'aprobada', identidadMotivo: '', descriptor: S.turno.descriptor || [], descCedula: [], descLicencia: [] };
    o.ficha = S.ficha; o.fotoPerfil = S.fotoPerfil; o.docsPendientes = S.docsP;
    o.carrerasTotal = 214 + S.hechas.length; o.calif = 4.8; o.califN = 96;
    o.ubicacionApagada = false; o.sinInternet = S.sinRed; o.porSubir = S.porSubir; o.error = null;
    o.saldoC = S.saldoC; o.minimoC = K.comisionMinC; o.cfg = { minimaC: K.minimaC };
    o.yo = { lat: S.yo.lat, lng: S.yo.lng };
    var hoy = S.hechas.filter(function (x) { return x.t >= desde; });
    o.carrerasHoy = hoy.length; o.consumidoHoyC = hoy.reduce(function (s, x) { return s + x.comC; }, 0);
    o.hechas = hoy.slice().reverse().map(function (x) { return { t: x.t, metros: x.metros, numero: x.numero, cliente: x.cliente, o: x.o, d: x.d, cobradoC: x.cobradoC, comC: x.comC, hora: hora(x.t) }; });
    var movs = [];
    hoy.forEach(function (x) { if (x.comC > 0) movs.push({ t: x.t, j: { tipo: 'menos', montoC: x.comC, texto: 'Comisión carrera #' + x.numero, det: x.o, hora: hora(x.t) } }); });
    S.recargas.forEach(function (r) { if (r.t >= desde) movs.push({ t: r.t, j: { tipo: 'mas', montoC: r.montoC, texto: 'Recarga', det: 'Recarga ' + r.codigo, hora: hora(r.t) } }); });
    o.movs = movs.sort(function (a, b) { return b.t - a.t; }).map(function (m) { return m.j; });
    o.bandeja = S.bandeja.filter(function (b) { return !b.rechazada; }).map(function (b) { return { id: b.id, km: kmCalle(S.yo, b.o), o: b.o, d: b.d, fijoC: b.fijoC, estC: b.estC }; });
    if (S.oferta && !c) {
      var f = S.oferta, j = datos(f);
      j.km = kmCalle(S.yo, f.o); j.totalSeg = OFERTA_SEG; j.restaSeg = Math.max(0, Math.ceil((f.vence - Date.now()) / 1000)); j.esperandoAprobacion = false;
      o.oferta = j;
    } else o.oferta = null;
    if (c) {
      var jc = datos(c);
      if (c.estado === 'ejecucion' && !c.fijoC) jc.taxi = { mostradoC: c.mostradoC, metros: c.metros, esperaSeg: c.espera };
      jc.cobrarC = cobrarC(c);
      o.carrera = jc;
    } else o.carrera = null;
    js(function () { AA.estado(JSON.stringify(o)); });
  }
  function datos(c) {
    return { id: c.id, numero: c.numero, estado: c.estado || 'pendiente', cliente: c.cliente, tel: c.tel, o: c.o, d: c.d, exacta: c.exacta || '', notas: '', fijoC: c.fijoC || 0, estC: c.estC,
      calif: c.calif == null ? null : c.calif, viajes: c.viajes == null ? null : c.viajes, equipaje: !!c.equipaje, manual: false, ocupado: false };
  }
  var claveHist = '';
  function historial() {
    var todas = S.hechas.concat(S.antiguas), clave = todas.length + '|' + S.recargas.length;
    if (clave === claveHist) return; claveHist = clave;
    var h = { carreras: todas.slice().sort(function (a, b) { return b.t - a.t; }), recargas: S.recargas };
    js(function () { AA.historial(JSON.stringify(h)); });
  }
  function cobrarC(c) { return c.fijoC ? c.fijoC : D_.aCobrarC(D_.taximetroC(c.metros || 0, c.espera || 0, K), K); }

  // ---------- Carreras ----------
  function nuevaOferta(fijoC, auto) {
    if (S.carrera) { aviso('Ya tienes una carrera en curso.'); return; }
    if (S.estado === 'desconectado') { aviso('Primero conéctate: desliza "Conectarme".'); return; }
    var o = null;
    if (auto) { var b = S.bandeja.filter(function (x) { return !x.rechazada; }).sort(function (a, z) { return metros(S.yo, a.o) - metros(S.yo, z.o); })[0]; if (b) o = { cliente: b.cliente, tel: '0990000000', o: b.o, d: b.d, calif: 4.8, viajes: 9, fijoC: b.fijoC, estC: b.estC, deBandeja: b }; }
    if (!o) { o = JSON.parse(JSON.stringify(DEMO[S.n++ % DEMO.length])); o.fijoC = fijoC || 0; o.estC = D_.tarifaEstimadaC ? D_.tarifaEstimadaC(kmCalle(o.o, o.d), K) : 400; }
    o.id = 'sim' + Date.now(); o.numero = ++S.num; o.vence = Date.now() + OFERTA_SEG * 1000;
    S.oferta = o; sonar(); enviar();
  }
  function sonar() {
    try {
      var A = new (window.AudioContext || window.webkitAudioContext)();
      [0, .25, .5].forEach(function (t) { var os = A.createOscillator(), g = A.createGain(); os.frequency.value = 880; os.connect(g); g.connect(A.destination); g.gain.setValueAtTime(.15, A.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, A.currentTime + t + .2); os.start(A.currentTime + t); os.stop(A.currentTime + t + .22); });
    } catch (e) { }
  }
  function cerrarOferta(msg) { if (S.oferta && S.oferta.deBandeja) S.oferta.deBandeja.rechazada = true; S.oferta = null; S.proxima = Date.now() + 25000; if (msg) aviso(msg); enviar(); }
  function aceptar(o) {
    S.oferta = null;
    if (o.deBandeja) { var i = S.bandeja.indexOf(o.deBandeja); if (i >= 0) S.bandeja.splice(i, 1); delete o.deBandeja; }
    o.estado = 'aceptada'; o.llegue = false; S.carrera = o; ruta.meta = null;
    if (S.sinRed) S.porSubir++;
    enviar();
  }
  function iniciar() {
    var c = S.carrera; if (!c || c.estado !== 'aceptada') return;
    c.estado = 'ejecucion'; c.seg = 0; c.metros = 0; c.recorrido = 0; c.espera = 0; c.mostradoC = 0; c.ultMostrar = 0; c.inicio = Date.now(); ruta.meta = null;
    if (S.sinRed) { S.porSubir++; aviso('Sin internet: el taxímetro igual cuenta. Se enviará al volver la señal.'); }
    enviar();
  }
  function finalizar() {
    var c = S.carrera; if (!c || c.estado !== 'ejecucion') return;
    var total = cobrarC(c), com = D_.comisionC(total, K), cobrado = Math.min(Math.max(S.saldoC, 0), com);
    var porCien = Math.round(K.kmC / 10), recorrido = Math.floor((c.metros || 0) / 100) * porCien, espera = Math.floor((c.espera || 0) / K.esperaCadaSeg) * K.esperaC;
    var fin = { id: c.id, totalC: total, fijo: !!c.fijoC, o: c.o.dir, d: c.d.dir, metros: Math.round(c.fijoC && !c.recorrido ? kmCalle(c.o, c.d) * 1000 : c.recorrido || 0), seg: c.seg || 0,
      arranqueC: K.arranqueC, recorridoC: recorrido, esperaC: espera, esperaSeg: c.espera || 0, marcadoC: K.arranqueC + recorrido + espera, minimaC: K.minimaC, sinInternet: S.sinRed };
    S.saldoC -= cobrado;
    S.hechas.push({ t: Date.now(), numero: c.numero, cliente: c.cliente, o: c.o.dir, d: c.d.dir, cobradoC: total, comC: cobrado, metros: fin.metros });
    S.carrera = null; S.proxima = Date.now() + 20000; ruta.meta = null;
    if (S.sinRed) { S.porSubir++; aviso('Sin internet: la carrera quedó guardada y se enviará al volver la señal. No cierres la página.'); }
    js(function () { AA.fin(JSON.stringify(fin)); });
    enviar(); historial();
  }

  // ---------- GPS simulado: el carro va por las calles (la misma ruta que pide la navegación) ----------
  var SERVIDORES = ['https://router.project-osrm.org/route/v1/driving/', 'https://routing.openstreetmap.de/routed-car/route/v1/driving/'];
  var ruta = { meta: null, pts: null, pidiendo: false, n: 0 }, desvio = 0, rumboDesvio = 0, rumbo = 0;
  function pedir(a, b) {
    var qs = a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson';
    return new Promise(function (ok, mal) {
      var listo = false, fallos = 0;
      SERVIDORES.forEach(function (s) {
        fetch(s + qs).then(function (r) { return r.json(); }).then(function (j) { if (listo) return; if (!j || !j.routes || !j.routes[0]) throw 0; listo = true; ok(j.routes[0].geometry.coordinates); })
          .catch(function () { if (!listo && ++fallos === SERVIDORES.length) mal(); });
      });
      setTimeout(function () { if (!listo) { listo = true; mal(); } }, 6000);
    });
  }
  function avanzar(meta) {
    if (desvio > 0) {
      desvio--; var r = rumboDesvio * Math.PI / 180;
      S.yo = { lat: S.yo.lat + Math.cos(r) * 0.00028, lng: S.yo.lng + Math.sin(r) * 0.00028 };
      if (!desvio) ruta.meta = null;   // vuelve a buscar camino desde donde quedó
      return true;
    }
    if (!ruta.meta || ruta.meta.lat !== meta.lat || ruta.meta.lng !== meta.lng) { ruta.meta = { lat: meta.lat, lng: meta.lng }; ruta.pts = null; ruta.pidiendo = false; }
    if (!ruta.pts) {
      if (!ruta.pidiendo) { ruta.pidiendo = true; var n = ++ruta.n; pedir(S.yo, meta).then(function (p) { if (n === ruta.n) { ruta.pts = p.slice(); ruta.pidiendo = false; } }, function () { if (n === ruta.n) { ruta.pts = [[S.yo.lng, S.yo.lat], [meta.lng, meta.lat]]; ruta.pidiendo = false; } }); }
      return false;
    }
    var p = ruta.pts, m = VEL, cur = { lat: S.yo.lat, lng: S.yo.lng }, antes = cur;
    while (m > 0 && p.length > 1) { var sig = { lat: p[1][1], lng: p[1][0] }, d = metros(cur, sig); if (d <= m) { cur = sig; m -= d; p.shift(); } else { var f = m / d; cur = { lat: cur.lat + (sig.lat - cur.lat) * f, lng: cur.lng + (sig.lng - cur.lng) * f }; m = 0; } }
    if (metros(antes, cur) > 1) rumbo = Math.atan2((cur.lng - antes.lng) * Math.cos(cur.lat * Math.PI / 180), cur.lat - antes.lat) * 180 / Math.PI;
    S.yo = cur;
    return VEL - m;
  }
  function faltaCalle(meta) {
    if (ruta.pts && ruta.meta && ruta.meta.lat === meta.lat && ruta.meta.lng === meta.lng) { var s = 0, a = S.yo; ruta.pts.slice(1).forEach(function (x) { var b = { lat: x[1], lng: x[0] }; s += metros(a, b); a = b; }); return s; }
    return metros(S.yo, meta);
  }
  function gps() { js(function () { AA.gps(S.yo.lat, S.yo.lng); }); }

  // Cada segundo: la oferta corre, el carro avanza y el taxímetro cuenta (igual que la app: $0.00 los primeros 3 s; pantalla cada 10 s)
  setInterval(function () {
    if (!pantallaLista()) return;
    if (S.oferta) { if (Date.now() >= S.oferta.vence) cerrarOferta('Se acabó el tiempo. La carrera pasó a otro conductor.'); return; }
    var c = S.carrera;
    if (!c) {
      if (S.estado === 'conectado' && !S.ocupado && !S.sinRed && q('#fin') && q('#fin').hidden !== false) {
        if (!S.proxima) S.proxima = Date.now() + 1000;
        if (Date.now() >= S.proxima) { S.proxima = 0; nuevaOferta(Math.random() < 0.3 ? 400 : 0, true); }
      } else if (S.estado !== 'conectado') S.proxima = 0;
      return;
    }
    if (c.estado === 'aceptada' && !c.llegue) {
      avanzar(c.o); gps();
      if (faltaCalle(c.o) < 40) { c.llegue = true; S.yo = { lat: c.o.lat, lng: c.o.lng }; gps(); }
      enviar();
    } else if (c.estado === 'ejecucion') {
      c.seg++;
      var parado = (c.seg % 90) > 70 || metros(S.yo, c.d) < 25;
      if (!parado) { var hecho = avanzar(c.d); gps(); if (hecho) { c.recorrido += hecho; if (c.seg > K.gratisSeg) c.metros += hecho; } }
      else if (c.seg > K.gratisSeg) c.espera++;
      if (c.seg >= SEG_EN_CERO && c.mostradoC === 0) c.mostradoC = K.arranqueC;
      if (c.seg - c.ultMostrar >= 10) { c.ultMostrar = c.seg; c.mostradoC = c.seg <= K.gratisSeg ? K.arranqueC : D_.taximetroC(c.metros, c.espera, K); }
      enviar();
    }
  }, 1000);
  setInterval(function () { if (pantallaLista() && !S.carrera) enviar(); }, 5000);

  // ---------- Lo que pide la pantalla (igual que AndroidAA.accion) ----------
  function manejar(n, d) {
    var c = S.carrera;
    switch (n) {
      case 'lista': claveHist = ''; enviar(); historial(); break;
      case 'conectar':
        if (S.turno.estado !== 'aprobado' && !c) { js(function () { AA.abrirTurno(); }); return; }
        S.ocupado = false; S.estado = 'conectado'; enviar(); break;
      case 'ocupado':
        if (S.turno.estado !== 'aprobado') { js(function () { AA.abrirTurno(); }); return; }
        S.ocupado = true; S.estado = 'conectado'; enviar(); aviso('Estás ocupado: no te llegarán carreras hasta que te pongas en Conectado.'); break;
      case 'desconectar':
        if (c) { aviso('Termina tu carrera antes de desconectarte.'); return; }
        S.estado = 'desconectado'; S.ocupado = false; S.oferta = null; enviar(); break;
      case 'aceptar': case 'tomar':
        if (S.oferta && S.oferta.id === d.id) { aceptar(S.oferta); return; }
        var b = S.bandeja.filter(function (x) { return x.id === d.id; })[0];
        if (b && !c) aceptar({ id: 'sim' + Date.now(), numero: ++S.num, cliente: b.cliente, tel: '0990000000', o: b.o, d: b.d, calif: 4.8, viajes: 9, fijoC: b.fijoC, estC: b.estC, deBandeja: b });
        break;
      case 'rechazar': if (S.oferta && S.oferta.id === d.id) cerrarOferta(null); break;
      case 'iniciar': iniciar(); break;
      case 'finalizar': finalizar(); break;
      case 'cancelar':
        if (!c || c.estado !== 'aceptada') return;
        if (S.sinRed) { aviso('Sin internet no se puede cancelar la carrera. Llama a la central.'); return; }
        S.carrera = null; S.proxima = Date.now() + 25000; ruta.meta = null; aviso('Cancelaste la carrera. Se le ofrecerá a otro conductor.'); enviar(); break;
      case 'whatsapp':
        if (S.sinRed) { aviso('Sin internet: WhatsApp no funciona. Usa el botón de llamar.'); return; }
        aviso('En la app se abre WhatsApp con el cliente.'); break;
      case 'llamar': aviso('En la app se llama al cliente.'); break;
      case 'recargar':
        setTimeout(function () {
          var k = String(d.codigo || '').replace(/\D/g, ''), cod = CODIGOS[k];
          var r = S.sinRed ? [false, 'Sin internet: no se puede verificar la recarga. Intenta cuando vuelva la señal.']
            : k.length !== 10 ? [false, 'Escribe los 10 números completos.'] : !cod ? [false, 'Número de recarga no válido. Revísalo e intenta otra vez.'] : cod.usado ? [false, 'Esta recarga ya fue usada.'] : null;
          if (!r) { cod.usado = true; S.saldoC += cod.montoC; S.recargas.push({ montoC: cod.montoC, codigo: k, t: Date.now() }); r = [true, '¡Recarga exitosa! Se sumaron ' + dineroC(cod.montoC) + ' a tu saldo.']; }
          js(function () { AA.recarga(r[0], r[1]); }); enviar(); historial();
        }, 600);
        break;
      case 'calificar': if (S.sinRed) S.porSubir++; S.proxima = Date.now() + 15000; break;
      case 'salir': if (c) { aviso('Termina tu carrera antes de cerrar sesión.'); return; } S.sesion = false; S.estado = 'desconectado'; pantallaLogin(); break;
      case 'reintentar': location.reload(); break;
      case 'turnoEnviar':
        setTimeout(function () {
          var r = S.simFalla ? { ok: true, estado: 'rechazado', motivo: 'No se ve bien la camisa del uniforme.', rehacer: ['pecho'] } : { ok: true, estado: 'aprobado' };
          S.turno = { estado: r.estado, motivo: r.motivo || '', rehacer: r.rehacer || [], descriptor: S.turno.descriptor };
          js(function () { AA.turnoRespuesta(JSON.stringify(r)); }); enviar();
        }, 1500);
        break;
      case 'identidadEnviar': setTimeout(function () { js(function () { AA.turnoRespuesta(JSON.stringify({ ok: true, estado: 'aprobada' })); }); }, 1200); break;
      case 'fichaFotos': js(function () { AA.fichaFotos('{}'); }); break;
      case 'fotoPerfil': js(function () { AA.fotoPerfil(S.fotoUrl || ''); }); break;
      case 'guardarContacto':
        if (/^09\d{8}$/.test(d.telefono || '')) { S.ficha.telefono = d.telefono; aviso('Teléfono actualizado.'); }
        else if (/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(d.correo || '')) { S.ficha.correo = d.correo; aviso('Correo actualizado.'); }
        enviar(); break;
      case 'perfilEnviar':
        setTimeout(function () { S.fotoPerfil = { estado: 'aprobada' }; S.fotoUrl = d.foto; js(function () { AA.perfilRespuesta('perfil', JSON.stringify({ ok: true, estado: 'aprobada' })); }); enviar(); }, 1500); break;
      case 'documentoEnviar':
        setTimeout(function () { if (S.ficha.docs[d.doc]) S.ficha.docs[d.doc].vence = d.vence || venceEn(365); js(function () { AA.perfilRespuesta('documento', JSON.stringify({ ok: true, estado: 'aprobado' })); }); enviar(); }, 1500); break;
      case 'voz':   // como la app de Android: lo dice el teléfono (urgente corta lo que está diciendo)
        try {
          var s = window.speechSynthesis; if (!s) return;
          var u = new SpeechSynthesisUtterance(String(d.t || '')), vs = s.getVoices().filter(function (v) { return /^es/i.test(v.lang); });
          u.lang = vs[0] ? vs[0].lang : 'es-ES'; if (vs[0]) u.voice = vs[0];
          if (d.urgente) { s.cancel(); setTimeout(function () { s.speak(u); }, 150); } else s.speak(u);
        } catch (e) { }
        break;
    }
  }
  window.AndroidAA = { accion: function (n, datos) { var d = {}; try { d = JSON.parse(datos || '{}'); } catch (e) { } setTimeout(function () { manejar(n, d); }, 0); } };

  // ---------- Inicio de sesión (el mismo de la app en el navegador; en la prueba entra con cualquier usuario) ----------
  function pantallaLogin(msg) {
    var el = q('#web-login');
    if (!el) { el = document.createElement('div'); el.id = 'web-login'; el.className = 'web-login'; (q('#pantalla') || document.body).appendChild(el); }
    el.innerHTML = '<img class="logo" src="../logo.png" alt="AutoAmigo"><div class="tarj"><h2>Iniciar sesión</h2><p>Entra con el usuario y la clave que te dio AutoAmigo.</p>' +
      '<label>Usuario<input type="text" id="wl-usuario" autocomplete="off" autocapitalize="none" autocorrect="off" value="prueba"></label>' +
      '<label>Contraseña<input type="password" id="wl-clave" autocomplete="off" value="prueba"></label>' +
      '<label class="rec"><input type="checkbox" id="wl-rec" checked>Recordarme</label>' +
      '<button class="entrar" id="wl-entrar">Iniciar sesión</button>' + (msg ? '<div class="err">' + msg + '</div>' : '') +
      '<button class="olvido" id="wl-olvido">¿Olvidaste tu contraseña?</button></div>' +
      '<a class="crear" href="#" id="wl-crear">¿Quieres manejar con nosotros?<b>Crear usuario y ser parte de AutoAmigo</b></a>' +
      '<div class="instalar">Prueba: entra con cualquier usuario y contraseña.</div>';
    el.hidden = false;
    q('#wl-entrar').onclick = function () {
      if (!q('#wl-usuario').value.trim() || !q('#wl-clave').value) { pantallaLogin('Escribe tu usuario y contraseña.'); return; }
      try { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { }   // el iPhone solo habla si empezó con un toque
      el.hidden = true; S.sesion = true; claveHist = ''; enviar(); historial();
    };
    q('#wl-olvido').onclick = function () { aviso('En la app: comunícate con la central para que te den una nueva contraseña.'); };
    q('#wl-crear').onclick = function (e) { e.preventDefault(); aviso('El registro de conductores nuevos se prueba aparte.'); };
  }
  var css = '.web-login{position:absolute;inset:0;z-index:100;background:#0A0F3C;display:flex;flex-direction:column;align-items:center;overflow:auto;padding:max(28px,env(safe-area-inset-top)) 20px 28px;font-family:Inter,system-ui,sans-serif}' +
    '.web-login .logo{width:120px;height:120px;border-radius:30px;background:#fff;padding:10px;margin:26px 0 22px;flex:none}' +
    '.web-login .tarj{background:#fff;border-radius:26px;padding:24px 20px;width:100%;max-width:420px;display:flex;flex-direction:column;gap:12px;flex:none}' +
    '.web-login h2{margin:0;font-size:22px;color:#101828}.web-login p{margin:0;color:#667085;font-size:14px}' +
    '.web-login label{display:flex;flex-direction:column;gap:6px;font-size:13.5px;font-weight:700;color:#344054}' +
    '.web-login input[type=text],.web-login input[type=password]{height:54px;border:1px solid #D0D5DD;border-radius:16px;padding:0 16px;font:inherit;font-size:16px;color:#101828}' +
    '.web-login .rec{flex-direction:row;align-items:center;gap:8px;font-weight:500}.web-login .rec input{width:20px;height:20px}' +
    '.web-login .entrar{height:60px;border:0;border-radius:30px;background:#0A0F3C;color:#fff;font:inherit;font-size:18px;font-weight:800;cursor:pointer}' +
    '.web-login .err{background:#FEF3F2;color:#B42318;border-radius:12px;padding:12px;font-size:14px}' +
    '.web-login .olvido{border:0;background:none;color:#1570EF;font:inherit;font-weight:700;font-size:15px;cursor:pointer;padding:6px}' +
    '.web-login .crear{width:100%;max-width:420px;margin-top:18px;border:2px solid rgba(255,255,255,.35);background:transparent;color:#C9CDE6;border-radius:20px;padding:15px;font:inherit;font-size:14px;cursor:pointer;display:flex;flex-direction:column;gap:4px;flex:none;text-decoration:none;text-align:center}' +
    '.web-login .crear b{color:#fff;font-size:16.5px}' +
    '.web-login .instalar{width:100%;max-width:420px;margin-top:16px;background:rgba(255,255,255,.08);color:#E4E7EC;border-radius:16px;padding:12px 14px;font-size:13.5px;line-height:1.45;flex:none}';

  // ---------- Controles de la prueba ----------
  function controles() {
    var $ = function (id) { return document.getElementById(id); };
    $('sim-saltar').onclick = function () { S.turno = { estado: 'aprobado', motivo: '', rehacer: [] }; S.ocupado = false; S.estado = 'conectado'; js(function () { AATurno.atras(); }); enviar(); cerrarPanel(); aviso('Verificación aprobada: estás conectado.'); };
    $('sim-dia').onclick = function () { if (S.carrera) { aviso('Termina la carrera primero.'); return; } S.turno = { estado: null, motivo: '', rehacer: [] }; S.estado = 'desconectado'; S.oferta = null; enviar(); aviso('Nuevo día: al conectarte te pedirá la verificación.'); };
    $('sim-falla').onclick = function () { S.simFalla = !S.simFalla; this.textContent = S.simFalla ? 'Simular: la verificación SÍ pasa' : 'Simular: la verificación no pasa'; aviso(S.simFalla ? 'La próxima verificación será rechazada.' : 'La verificación va a pasar.'); };
    $('sim-red').onclick = function () { ponerRed(!S.sinRed); };
    $('sim-escenario').onclick = function () {
      if (S.carrera) { aviso('Termina la carrera actual primero.'); return; }
      if (S.sinRed) ponerRed(false);
      if (S.turno.estado !== 'aprobado') S.turno = { estado: 'aprobado', motivo: '', rehacer: [] };
      S.estado = 'conectado'; S.ocupado = false; S.cortar = true; nuevaOferta(0); cerrarPanel();
      aviso('Llegó una carrera: acéptala y a los 3 segundos te quedarás sin internet.');
    };
    $('sim-taxi').onclick = function () { nuevaOferta(0); cerrarPanel(); };
    $('sim-pactada').onclick = function () { nuevaOferta(400); cerrarPanel(); };
    $('sim-llegue').onclick = function () { var c = S.carrera; if (!c || c.estado !== 'aceptada') { aviso('Primero acepta una carrera.'); return; } c.llegue = true; S.yo = { lat: c.o.lat, lng: c.o.lng }; ruta.meta = null; gps(); enviar(); cerrarPanel(); };
    $('sim-desvio').onclick = function () { if (!S.carrera) { aviso('Primero acepta una carrera.'); return; } desvio = 4; rumboDesvio = rumbo + (Math.random() < 0.5 ? 90 : -90); cerrarPanel(); aviso('El carro dobló por otra calle…'); };
    $('sim-color').onchange = function () { S.perfil.colorCarro = this.value; enviar(); };
    $('sim-modo').onchange = function () { if (window.MapaAA && MapaAA.forzarModo) MapaAA.forzarModo(this.value || null); };
    $('btn-prueba').onclick = function () { $('controles').classList.toggle('abierto'); };
  }
  function cerrarPanel() { var c = document.getElementById('controles'); if (c) c.classList.remove('abierto'); }
  function ponerRed(sin) {
    S.sinRed = sin;
    var b = document.getElementById('sim-red'); if (b) { b.textContent = sin ? 'Volver a tener internet' : 'Quitar internet'; b.style.background = sin ? '#12B76A' : ''; b.style.color = sin ? '#fff' : ''; }
    if (sin) aviso('Te quedaste sin internet.');
    else { aviso(S.porSubir ? 'Volvió el internet: se enviaron ' + S.porSubir + ' cambio' + (S.porSubir > 1 ? 's' : '') + ' a la central.' : 'Volvió el internet.'); S.porSubir = 0; }
    enviar();
  }
  // "Acepto y me quedo sin internet": se corta 3 s después de aceptar
  var aceptarOrig = aceptar;
  aceptar = function (o) { aceptarOrig(o); if (S.cortar) { S.cortar = false; setTimeout(function () { ponerRed(true); }, 3000); } };

  document.addEventListener('DOMContentLoaded', function () {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    controles(); pantallaLogin(null);
  });
  window.__AASim = S;   // para pruebas
})();
