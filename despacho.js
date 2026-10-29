// =====================================================================
//  AutoAmigo · Lógica de reparto, comisión y taxímetro
//  La MISMA lógica está en la app Android (Despacho.kt). Si cambias algo
//  aquí, cámbialo también allá.
//
//  Reparto:
//  - Solo cuentan conductores conectados, LIBRES, con GPS reciente y con
//    saldo suficiente para la comisión de la carrera (comisionMinC).
//  - Se ordenan por distancia a la recogida (sin límite de distancia).
//  - Segundo 0: suena al 1.º; cada `cascadaSeg` se suma el siguiente.
//  - El que rechaza deja de sonarle por `rechazoSeg` y luego vuelve a entrar.
//  - Las carreras nunca expiran.
//  - Un conductor ve UNA oferta a la vez: si alguna lleva más de
//    `prioridadMin` esperando, va primero (la más antigua); si no, la más cercana.
//  Dinero: todo en CENTAVOS enteros (…C).
// =====================================================================
(function (global) {
  var GPS_MAX_EDAD_MS = 3 * 60 * 1000;

  var CONFIG_DEFECTO = {
    cascadaSeg: 10, prioridadMin: 20, rechazoSeg: 60,
    arranqueC: 50, kmC: 50, esperaC: 5, esperaCadaSeg: 30, gratisSeg: 30, minimaC: 250,
    comisionMinC: 50, comisionPct: 10, comisionDesdeC: 500, saldoAlertaC: 100
  };

  function cfgCompleta(cfg) {
    cfg = cfg || {};
    var r = {};
    Object.keys(CONFIG_DEFECTO).forEach(function (k) {
      var n = Number(cfg[k]);
      r[k] = isFinite(n) && n >= 0 && cfg[k] !== null && cfg[k] !== '' && cfg[k] !== undefined ? n : CONFIG_DEFECTO[k];
    });
    if (r.cascadaSeg <= 0) r.cascadaSeg = CONFIG_DEFECTO.cascadaSeg;
    if (r.esperaCadaSeg <= 0) r.esperaCadaSeg = CONFIG_DEFECTO.esperaCadaSeg;
    return r;
  }

  // Comisión de la empresa en centavos para una carrera de `tarifaC` centavos
  function comisionC(tarifaC, cfg) {
    cfg = cfgCompleta(cfg);
    if (tarifaC < cfg.comisionDesdeC) return cfg.comisionMinC;
    return Math.max(cfg.comisionMinC, Math.round(tarifaC * cfg.comisionPct / 100));
  }

  // Precio estimado (centavos) para una distancia en km, sin contar espera
  function tarifaEstimadaC(km, cfg) {
    cfg = cfgCompleta(cfg);
    var c = cfg.arranqueC + Math.floor(km * 10) * Math.round(cfg.kmC / 10);
    return Math.max(cfg.minimaC, c);
  }

  // Taxímetro: total en centavos a partir de metros y segundos detenido
  // (ambos contados DESPUÉS de los segundos gratis del arranque)
  function taximetroC(metros, esperaSeg, cfg) {
    cfg = cfgCompleta(cfg);
    var porCien = Math.round(cfg.kmC / 10);
    return cfg.arranqueC + Math.floor(metros / 100) * porCien + Math.floor(esperaSeg / cfg.esperaCadaSeg) * cfg.esperaC;
  }

  function aCobrarC(totalC, cfg) {
    return Math.max(cfgCompleta(cfg).minimaC, totalC);
  }

  // ¿La central debe aprobar que este conductor tome la carrera?
  function requiereAprobacion(carrera, saldoC, cfg) {
    cfg = cfgCompleta(cfg);
    var d = carrera && carrera.destino;
    var conocida = carrera && (carrera.precioFijo === true || (d && typeof d.lat === 'number'));
    return !conocida && (saldoC || 0) < cfg.saldoAlertaC;
  }

  // Distancia en km entre dos puntos (fórmula de haversine)
  function distanciaKm(lat1, lng1, lat2, lng2) {
    if ([lat1, lng1, lat2, lng2].some(function (v) { return typeof v !== 'number' || !isFinite(v); })) return Infinity;
    var R = 6371, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Estado visible de un conductor: 'libre' | 'aceptada' | 'ejecucion' | 'fuera'
  function estadoVisible(est, ahora) {
    if (!est || !est.online || typeof est.t !== 'number' || ahora - est.t > GPS_MAX_EDAD_MS) return 'fuera';
    if (est.estado === 'aceptada' || est.estado === 'ejecucion') return est.estado;
    return 'libre';
  }

  function saldoDe(saldos, uid) {
    var s = saldos && saldos[uid];
    var v = s && Number(s.saldoC);
    return isFinite(v) && v > 0 ? v : 0;
  }

  // estados: { uid: {lat,lng,t,online,estado} }, saldos: { uid: {saldoC} }
  function elegibles(estados, ahora, saldos) {
    var lista = [];
    Object.keys(estados || {}).forEach(function (uid) {
      var e = estados[uid];
      if (estadoVisible(e, ahora) === 'libre' && typeof e.lat === 'number' && typeof e.lng === 'number') {
        lista.push({ uid: uid, lat: e.lat, lng: e.lng, saldoC: saldoDe(saldos, uid) });
      }
    });
    return lista;
  }

  // Devuelve [{uid, km}] de los conductores a los que les SUENA ahora esta carrera
  function sonandoA(carrera, listaElegibles, ahora, cfg) {
    cfg = cfgCompleta(cfg);
    if (!carrera || carrera.estado !== 'pendiente') return [];
    var o = carrera.origen || {};
    var rech = carrera.rechazos || {};
    var minimo = Number(carrera.comisionMinC) > 0 ? Number(carrera.comisionMinC) : cfg.comisionMinC;
    var cand = listaElegibles
      .filter(function (c) {
        if (c.saldoC < minimo) return false;
        var t = rech[c.uid];
        return !(typeof t === 'number' && ahora - t < cfg.rechazoSeg * 1000);
      })
      .map(function (c) { return { uid: c.uid, km: distanciaKm(c.lat, c.lng, o.lat, o.lng) }; })
      .sort(function (a, b) { return a.km - b.km || (a.uid < b.uid ? -1 : 1); });
    var desde = typeof carrera.ofertaDesde === 'number' ? carrera.ofertaDesde : (carrera.creada || ahora);
    var k = Math.max(0, Math.floor((ahora - desde) / (cfg.cascadaSeg * 1000))) + 1;
    return cand.slice(0, k);
  }

  // Elige la carrera que debe ver un conductor. pendientes: { id: carrera }
  function ofertaPara(uid, pendientes, estados, ahora, cfg, saldos) {
    cfg = cfgCompleta(cfg);
    var miEstado = estados && estados[uid];
    if (estadoVisible(miEstado, ahora) !== 'libre') return null;
    var eleg = elegibles(estados, ahora, saldos);
    var opciones = [];
    Object.keys(pendientes || {}).forEach(function (id) {
      var c = pendientes[id];
      var lista = sonandoA(c, eleg, ahora, cfg);
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].uid === uid) {
          opciones.push({ id: id, km: lista[i].km, espera: ahora - (c.creada || ahora) });
          break;
        }
      }
    });
    if (!opciones.length) return null;
    var limite = cfg.prioridadMin * 60 * 1000;
    var urgentes = opciones.filter(function (o) { return o.espera >= limite; });
    if (urgentes.length) {
      urgentes.sort(function (a, b) { return b.espera - a.espera; });
      return urgentes[0];
    }
    opciones.sort(function (a, b) { return a.km - b.km || b.espera - a.espera; });
    return opciones[0];
  }

  var api = {
    CONFIG_DEFECTO: CONFIG_DEFECTO,
    GPS_MAX_EDAD_MS: GPS_MAX_EDAD_MS,
    cfgCompleta: cfgCompleta,
    comisionC: comisionC,
    tarifaEstimadaC: tarifaEstimadaC,
    taximetroC: taximetroC,
    aCobrarC: aCobrarC,
    requiereAprobacion: requiereAprobacion,
    distanciaKm: distanciaKm,
    estadoVisible: estadoVisible,
    saldoDe: saldoDe,
    elegibles: elegibles,
    sonandoA: sonandoA,
    ofertaPara: ofertaPara
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Despacho = api;
})(typeof window !== 'undefined' ? window : globalThis);
