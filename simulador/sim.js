/* AutoAmigo · Simulador del panel
 * 60 conductores que se conectan, reciben carreras en cascada, aceptan o rechazan,
 * van a recoger (siguiendo las calles), encienden el taxímetro, llevan al pasajero y finalizan.
 * Aparecen unas 1.000 carreras al día según la hora. Tus carreras creadas en el panel también las toman.
 * Todo vive en el navegador: nada se guarda en el panel real.
 */
(function () {
  var fb = firebase.database();
  var SIM = { vel: 1, pausa: false, metaDia: 1000, abierto: true };
  var MEM = {};        // por conductor: ruta, avance, esperas, etc.
  var DECIDE = {};     // 'carrera|conductor' -> hora en que decide
  var CANCELA = {};    // carreras que el conductor cancelará en el camino
  var PEDIDOS = [];    // cola de rutas a pedir (OSRM)
  var pidiendo = false;
  var LUG = window.__LUGARES_SIM, CLI = window.__CLIENTES_SIM, PESO = window.__PESO_HORA_SIM;

  function db() { return window.__DB || {}; }
  function azar(a, b) { return a + Math.random() * (b - a); }
  function elegir(l) { return l[Math.floor(Math.random() * l.length)]; }
  function dist(a, b) { return Despacho.distanciaKm(a.lat, a.lng, b.lat, b.lng) * 1000; } // metros
  function cerca(l, m) { return { dir: l[0], lat: l[1] + (Math.random() - 0.5) * m, lng: l[2] + (Math.random() - 0.5) * m }; }
  function cfg() { return Despacho.cfgCompleta(db().config); }

  // ---------- Rutas por las calles (OSRM gratis); si falla, línea recta ----------
  function pedirRuta(uid, clave, a, b) {
    var m = MEM[uid];
    m.ruta = [[a.lng, a.lat], [b.lng, b.lat]]; m.idx = 0; m.clave = clave;
    PEDIDOS.push({ uid: uid, clave: clave, a: a, b: b });
    if (PEDIDOS.length > 6) PEDIDOS.shift();
    siguientePedido();
  }
  function siguientePedido() {
    if (pidiendo || !PEDIDOS.length) return;
    var p = PEDIDOS.shift(); pidiendo = true;
    fetch('https://router.project-osrm.org/route/v1/driving/' + p.a.lng + ',' + p.a.lat + ';' + p.b.lng + ',' + p.b.lat + '?overview=full&geometries=geojson')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var m = MEM[p.uid];
        if (m && m.clave === p.clave && j.routes && j.routes[0] && m.idx === 0) {
          var c = j.routes[0].geometry.coordinates;
          if (c.length > 1) { m.ruta = c; m.idx = 0; m.pos = { lat: c[0][1], lng: c[0][0] }; }
        }
      }).catch(function () {})
      .then(function () { setTimeout(function () { pidiendo = false; siguientePedido(); }, 1100); });
  }
  // Avanza por la ruta `metros`; devuelve cuántos avanzó y si llegó
  function avanzar(m, metros) {
    var hecho = 0;
    while (metros > 0 && m.idx < m.ruta.length - 1) {
      var sig = { lat: m.ruta[m.idx + 1][1], lng: m.ruta[m.idx + 1][0] };
      var d = dist(m.pos, sig);
      if (d <= metros) { m.pos = sig; m.idx++; metros -= d; hecho += d; }
      else { var f = metros / d; m.pos = { lat: m.pos.lat + (sig.lat - m.pos.lat) * f, lng: m.pos.lng + (sig.lng - m.pos.lng) * f }; hecho += metros; metros = 0; }
    }
    return { m: hecho, llego: m.idx >= m.ruta.length - 1 };
  }

  // ---------- Carreras nuevas ----------
  var numeroLocal = 0;
  function nuevaCarrera(up, ahora) {
    var o = cerca(elegir(LUG), 0.012), sinDestino = Math.random() < 0.12;
    var d = sinDestino ? null : cerca(elegir(LUG), 0.012);
    var fijo = !sinDestino && Math.random() < 0.25;
    var km = d ? Math.max(1, dist(o, d) / 1000 * 1.3) : null;
    var c = cfg();
    var estC = km ? Math.max(c.minimaC, c.arranqueC + Math.floor(km * 10) * Math.round(c.kmC / 10)) : null;
    var n = Math.max(numeroLocal, (db().contador || {}).carreras || 20000) + 1; numeroLocal = n;
    var id = 's' + ahora.toString(36) + Math.floor(Math.random() * 1e4);
    up['contador/carreras'] = n;
    up['carreras/' + id] = {
      numero: n, cliente: elegir(CLI), telefono: '09' + Math.floor(80000000 + Math.random() * 19999999),
      origen: o, destino: d, estado: 'pendiente', creada: ahora, ofertaDesde: ahora,
      precioFijo: fijo, tarifa: fijo ? Math.round(estC * 1.1 / 25) * 25 / 100 : 0, tarifaEstimadaC: estC,
      kmEstimado: km ? Math.round(km * 10) / 10 : null, comisionMinC: c.comisionMinC, notas: '', exacta: Math.random() < 0.3 ? elegir(['Casa esquinera, puerta negra', 'Edificio azul, 3er piso', 'Frente a la farmacia', 'Garita principal']) : ''
    };
  }

  // ---------- El reloj del simulador (cada segundo) ----------
  var ultimo = Date.now();
  function tic() {
    var ahora = Date.now(), real = Math.min(3, (ahora - ultimo) / 1000); ultimo = ahora;
    if (SIM.pausa) { pintarControl(); return; }
    var dt = real * SIM.vel;                           // segundos simulados
    var D = db(), C = cfg(), up = {};
    var estados = D.estado || {}, carreras = D.carreras || {}, saldos = D.saldos || {};

    // 1) Aparecen carreras según la hora (≈ 1.000 al día)
    var hora = new Date().getHours();
    var esperadas = SIM.metaDia * PESO[hora] / 3600 * dt;
    while (esperadas > 0) { if (Math.random() < Math.min(1, esperadas)) nuevaCarrera(up, ahora); esperadas -= 1; }

    // 2) Ofertas en cascada: el conductor al que le suena decide en unos segundos
    var eleg = Despacho.elegibles(estados, ahora, saldos), tomadas = {};
    Object.keys(carreras).forEach(function (id) {
      var c = carreras[id];
      if (c.estado !== 'pendiente' || Despacho.esProgramada(c, ahora) || !c.origen || typeof c.origen.lat !== 'number') return;
      var sonando = Despacho.sonandoA(c, eleg, ahora, C);
      sonando.forEach(function (s) {
        var k = id + '|' + s.uid;
        if (!DECIDE[k]) DECIDE[k] = ahora + azar(4, 14) * 1000 / SIM.vel;
        if (ahora < DECIDE[k] || tomadas[id] || tomadas[s.uid]) return;
        delete DECIDE[k];
        if (Math.random() < 0.82) {
          tomadas[id] = tomadas[s.uid] = true;
          var cd = (D.conductores || {})[s.uid] || {};
          up['carreras/' + id + '/estado'] = 'aceptada';
          up['carreras/' + id + '/conductor'] = s.uid;
          up['carreras/' + id + '/conductorNombre'] = cd.nombre || '';
          up['carreras/' + id + '/unidad'] = cd.unidad || '';
          up['carreras/' + id + '/aceptada'] = ahora;
          up['estado/' + s.uid + '/estado'] = 'aceptada';
          up['estado/' + s.uid + '/carrera'] = id;
          if (Math.random() < 0.03) CANCELA[id] = azar(0.2, 0.7); // a veces el conductor la cancela en el camino
        } else {
          up['carreras/' + id + '/rechazos/' + s.uid] = ahora;
        }
      });
    });

    // 3) Cada conductor según su estado
    Object.keys(estados).forEach(function (uid) {
      var e = estados[uid];
      if (!e || !e.online) return;
      var m = MEM[uid] = MEM[uid] || { pos: { lat: e.lat, lng: e.lng }, ruta: null, idx: 0, clave: '', espera: 0, parado: 0, recorrido: 0, tax: 0 };
      if (!m.pos || typeof m.pos.lat !== 'number') m.pos = { lat: e.lat, lng: e.lng };
      var c = e.carrera ? carreras[e.carrera] : null;
      // La central canceló, devolvió o eliminó la carrera: queda libre
      if ((e.estado === 'aceptada' || e.estado === 'ejecucion') && (!c || c.conductor !== uid || (c.estado !== 'aceptada' && c.estado !== 'ejecucion'))) {
        up['estado/' + uid + '/estado'] = 'libre'; up['estado/' + uid + '/carrera'] = null; m.clave = ''; m.ruta = null; return;
      }
      // La central asignó una carrera a mano: el estado del conductor todavía dice libre
      if (e.estado === 'libre') {
        var asignada = null;
        Object.keys(carreras).some(function (id) { var x = carreras[id]; if (x.conductor === uid && x.estado === 'aceptada') { asignada = id; return true; } return false; });
        if (asignada) { up['estado/' + uid + '/estado'] = 'aceptada'; up['estado/' + uid + '/carrera'] = asignada; return; }
      }
      var vel = azar(7, 10.5) * dt; // ≈ 25-38 km/h en ciudad
      if (e.estado === 'aceptada' && c) {
        if (m.clave !== 'a' + e.carrera) { pedirRuta(uid, 'a' + e.carrera, m.pos, c.origen); m.espera = 0; m.recorrido = 0; }
        if (m.espera > 0) {
          m.espera -= dt;
          if (m.espera <= 0) { // el pasajero subió: enciende el taxímetro
            up['carreras/' + e.carrera + '/estado'] = 'ejecucion';
            up['carreras/' + e.carrera + '/iniciada'] = ahora;
            up['carreras/' + e.carrera + '/metrosRecogida'] = Math.round(m.recorrido);
            if (!c.precioFijo) up['carreras/' + e.carrera + '/taximetro'] = { inicio: ahora, metros: 0, esperaSeg: 0, totalC: C.arranqueC };
            up['estado/' + uid + '/estado'] = 'ejecucion';
            m.tax = 0; m.esperaSeg = 0; m.ultTax = ahora;
          }
        } else {
          var r = avanzar(m, vel); m.recorrido += r.m;
          var total = dist({ lat: m.ruta[0][1], lng: m.ruta[0][0] }, c.origen) || 1;
          if (CANCELA[e.carrera] && m.recorrido / total > CANCELA[e.carrera]) { // el conductor cancela
            delete CANCELA[e.carrera];
            var cd2 = (D.conductores || {})[uid] || {};
            ['conductor', 'conductorNombre', 'unidad', 'manual', 'aceptada'].forEach(function (k) { up['carreras/' + e.carrera + '/' + k] = null; });
            up['carreras/' + e.carrera + '/estado'] = 'pendiente';
            up['carreras/' + e.carrera + '/ofertaDesde'] = ahora;
            up['carreras/' + e.carrera + '/rechazos/' + uid] = ahora;
            up['carreras/' + e.carrera + '/cancelaciones/' + uid] = { nombre: cd2.nombre || '', unidad: cd2.unidad || '', en: ahora };
            up['estado/' + uid + '/estado'] = 'libre'; up['estado/' + uid + '/carrera'] = null; m.clave = '';
          } else if (r.llego) m.espera = azar(40, 120); // espera al pasajero
        }
      } else if (e.estado === 'ejecucion' && c) {
        if (m.clave !== 'e' + e.carrera) {
          if (!c.destino || typeof c.destino.lat !== 'number') { // sin destino: el pasajero lo dice al subir
            var dd = cerca(elegir(LUG), 0.01); c.destino = dd;
          }
          pedirRuta(uid, 'e' + e.carrera, m.pos, c.destino);
          m.parado = 0; m.esperaSeg = m.esperaSeg || 0; m.tax = m.tax || 0; m.ultTax = m.ultTax || ahora;
        }
        // A ratos se detiene (semáforos, tráfico): cuenta tiempo detenido
        if (m.parado > 0) { m.parado -= dt; m.esperaSeg += dt; }
        else if (Math.random() < 0.012 * dt) m.parado = azar(15, 60);
        else { var r2 = avanzar(m, vel); m.tax += r2.m; m.recorrido += r2.m; if (r2.llego) finalizar(up, uid, e.carrera, c, m, ahora, C, saldos); }
        if (!c.precioFijo && ahora - m.ultTax > 8000) {
          m.ultTax = ahora;
          var tx = Despacho.taximetroC(m.tax, Math.floor(m.esperaSeg), C);
          up['carreras/' + e.carrera + '/taximetro/metros'] = Math.round(m.tax);
          up['carreras/' + e.carrera + '/taximetro/esperaSeg'] = Math.floor(m.esperaSeg);
          up['carreras/' + e.carrera + '/taximetro/totalC'] = tx;
        }
      } else {
        // Libre: da vueltas despacio por la zona
        if (!m.ruta || m.idx >= m.ruta.length - 1 || m.clave.charAt(0) !== 'l') {
          if (Math.random() < 0.02 * dt) pedirRuta(uid, 'l' + ahora, m.pos, cerca(elegir(LUG), 0.015));
        } else avanzar(m, vel * 0.5);
        // Sin saldo: de vez en cuando recarga
        var sd = (saldos[uid] || {}).saldoC || 0;
        if (sd < 100 && Math.random() < 0.002 * dt) up['saldos/' + uid + '/saldoC'] = sd + elegir([1000, 2000]);
      }
      up['estado/' + uid + '/lat'] = m.pos.lat; up['estado/' + uid + '/lng'] = m.pos.lng; up['estado/' + uid + '/t'] = ahora;
    });

    // 4) Algunos se conectan o desconectan (solo los libres)
    if (Math.random() < 0.004 * dt) {
      var ids = Object.keys(estados).filter(function (u) { var e = estados[u]; return !e.online || e.estado === 'libre'; });
      var u = elegir(ids);
      if (u) { var on = !estados[u].online; up['estado/' + u + '/online'] = on; up['estado/' + u + '/t'] = ahora; if (on) up['estado/' + u + '/estado'] = 'libre'; }
    }

    if (Object.keys(up).length) fb.ref().update(up);
    pintarControl();
  }

  function finalizar(up, uid, id, c, m, ahora, C, saldos) {
    var tarifaC = c.precioFijo ? Math.round((c.tarifa || 0) * 100) : Despacho.aCobrarC(Despacho.taximetroC(m.tax, Math.floor(m.esperaSeg), C), C);
    var com = Despacho.comisionC(tarifaC, C), sd = Math.max(0, (saldos[uid] || {}).saldoC || 0);
    var cobrado = Math.min(sd, com), perdida = com - cobrado, b = 'carreras/' + id + '/';
    up[b + 'estado'] = 'finalizada'; up[b + 'finalizada'] = ahora;
    up[b + 'tarifa'] = c.precioFijo ? c.tarifa : tarifaC / 100; up[b + 'tarifaC'] = tarifaC;
    up[b + 'comisionC'] = com; up[b + 'comisionCobradaC'] = cobrado; up[b + 'perdidaC'] = perdida;
    up[b + 'metrosTotal'] = Math.round(m.recorrido);
    if (c.destino && (!(window.__DB.carreras[id] || {}).destino)) up[b + 'destino'] = c.destino;
    if (!c.precioFijo) { up[b + 'taximetro/metros'] = Math.round(m.tax); up[b + 'taximetro/esperaSeg'] = Math.floor(m.esperaSeg); up[b + 'taximetro/totalC'] = tarifaC; }
    if (cobrado > 0) up['saldos/' + uid + '/saldoC'] = sd - cobrado;
    if (perdida > 0) up['perdidas/p' + ahora.toString(36) + uid] = { conductor: uid, carrera: id, numero: c.numero, tarifaC: tarifaC, comisionC: com, cobradoC: cobrado, perdidaC: perdida, fecha: ahora };
    up['estado/' + uid + '/estado'] = 'libre'; up['estado/' + uid + '/carrera'] = null;
    m.clave = ''; m.ruta = null; m.tax = 0; m.esperaSeg = 0; m.recorrido = 0;
  }

  // ---------- Cuadro de control ----------
  var caja = document.createElement('div');
  caja.id = 'sim-control';
  caja.innerHTML = '<style>' +
    '#sim-control{position:fixed;left:16px;bottom:16px;z-index:9999;width:270px;background:#090145;color:#fff;border-radius:18px;box-shadow:0 14px 34px rgba(9,1,69,.35);font-family:Inter,system-ui,sans-serif;overflow:hidden}' +
    '#sim-control .cab{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;font-weight:800;font-size:15px}' +
    '#sim-control .cab i{width:9px;height:9px;border-radius:50%;background:#12B76A;display:inline-block;margin-right:8px;box-shadow:0 0 0 4px rgba(18,183,106,.25)}' +
    '#sim-control .cuerpo{padding:0 14px 14px;display:grid;gap:10px}' +
    '#sim-control .datos{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '#sim-control .datos div{background:rgba(255,255,255,.08);border-radius:12px;padding:8px 10px}' +
    '#sim-control .datos b{display:block;font-size:18px}#sim-control .datos span{font-size:11.5px;color:#C9CDE6}' +
    '#sim-control .vel{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}' +
    '#sim-control button{border:0;border-radius:10px;height:34px;font:inherit;font-weight:700;font-size:13px;cursor:pointer;background:rgba(255,255,255,.12);color:#fff}' +
    '#sim-control button.sel{background:#fff;color:#090145}#sim-control .rojo{background:#DE0B13}' +
    '#sim-control small{color:#C9CDE6;font-size:11.5px;line-height:1.35}' +
    '</style>' +
    '<div class="cab" id="sim-cab"><span><i id="sim-luz"></i>Simulador</span><span id="sim-flecha">▾</span></div>' +
    '<div class="cuerpo" id="sim-cuerpo">' +
    '<div class="datos"><div><b id="sim-hoy">0</b><span>Carreras hoy</span></div><div><b id="sim-esp">0</b><span>Esperando</span></div>' +
    '<div><b id="sim-con">0</b><span>Conectados</span></div><div><b id="sim-ocu">0</b><span>En carrera</span></div></div>' +
    '<div><small>Velocidad</small><div class="vel"><button data-v="1">x1</button><button data-v="5">x5</button><button data-v="20">x20</button><button data-v="60">x60</button></div></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><button id="sim-pausa">Pausar</button><button id="sim-diez">+10 carreras</button></div>' +
    '<small>x1 es tiempo real: un carro tarda minutos en llegar. Con x5 o más todo pasa más rápido. Crea una carrera con "+ Nueva carrera" y mira cómo la toman.</small>' +
    '</div>';
  document.body.appendChild(caja);
  caja.addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]');
    if (b) { SIM.vel = Number(b.getAttribute('data-v')); pintarControl(); return; }
    if (e.target.closest('#sim-pausa')) { SIM.pausa = !SIM.pausa; pintarControl(); return; }
    if (e.target.closest('#sim-diez')) { var up = {}, t = Date.now(); for (var i = 0; i < 10; i++) nuevaCarrera(up, t + i); fb.ref().update(up); return; }
    if (e.target.closest('#sim-cab')) { SIM.abierto = !SIM.abierto; pintarControl(); }
  });
  function pintarControl() {
    var D = db(), cs = D.carreras || {}, es = D.estado || {}, h0 = new Date(); h0.setHours(0, 0, 0, 0);
    var hoy = 0, esp = 0, con = 0, ocu = 0;
    Object.keys(cs).forEach(function (k) { var c = cs[k]; if (c.creada >= h0.getTime() && c.estado === 'finalizada') hoy++; if (c.estado === 'pendiente' && !Despacho.esProgramada(c, Date.now())) esp++; });
    Object.keys(es).forEach(function (k) { var e = es[k]; if (e.online) { con++; if (e.estado === 'aceptada' || e.estado === 'ejecucion') ocu++; } });
    document.getElementById('sim-hoy').textContent = hoy;
    document.getElementById('sim-esp').textContent = esp;
    document.getElementById('sim-con').textContent = con;
    document.getElementById('sim-ocu').textContent = ocu;
    Array.prototype.forEach.call(caja.querySelectorAll('[data-v]'), function (b) { b.classList.toggle('sel', Number(b.getAttribute('data-v')) === SIM.vel); });
    var p = document.getElementById('sim-pausa'); p.textContent = SIM.pausa ? 'Seguir' : 'Pausar'; p.classList.toggle('rojo', SIM.pausa);
    document.getElementById('sim-luz').style.background = SIM.pausa ? '#DE0B13' : '#12B76A';
    document.getElementById('sim-cuerpo').style.display = SIM.abierto ? '' : 'none';
    document.getElementById('sim-flecha').textContent = SIM.abierto ? '▾' : '▴';
  }

  setTimeout(function () { pintarControl(); setInterval(tic, 1000); }, 1500);
})();
