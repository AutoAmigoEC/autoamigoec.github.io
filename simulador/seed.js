// SIMULADOR: datos iniciales (60 conductores y las carreras que ya se hicieron hoy). Nada se guarda en el panel real.
(function () {
  var now = Date.now(), MIN = 60000;
  // Lugares de Guayaquil y Samborondón [nombre, lat, lng]
  var LUGARES = window.__LUGARES_SIM = [
    ['Mall del Sol', -2.1550, -79.8925], ['Aeropuerto J.J. Olmedo', -2.1574, -79.8837], ['Terminal Terrestre', -2.1406, -79.8880],
    ['Malecón 2000', -2.1930, -79.8800], ['Parque Seminario', -2.1960, -79.8830], ['Urdesa Central', -2.1700, -79.9100],
    ['Policentro', -2.1720, -79.8990], ['San Marino', -2.1695, -79.8985], ['Mall del Sur', -2.2300, -79.8980],
    ['Alborada 6ta etapa', -2.1340, -79.9000], ['Sauces 8', -2.1250, -79.8960], ['Kennedy Norte', -2.1650, -79.8960],
    ['Riocentro Ceibos', -2.1720, -79.9420], ['Los Ceibos', -2.1760, -79.9360], ['Puerto Santa Ana', -2.1840, -79.8770],
    ['Las Peñas', -2.1870, -79.8770], ['Universidad Católica', -2.1810, -79.9040], ['La Garzota', -2.1470, -79.8980],
    ['Samanes', -2.1060, -79.9020], ['Mucho Lote', -2.0880, -79.9080], ['La Puntilla', -2.1375, -79.8815],
    ['Plaza Lagos', -2.1372, -79.8650], ['Village Plaza', -2.1405, -79.8668], ['Entre Ríos', -2.1530, -79.8710],
    ['Isla Mocolí', -2.1015, -79.8565], ['Ciudad Celeste', -2.0790, -79.8485], ['Barrio Centenario', -2.2160, -79.8900],
    ['City Mall', -2.1440, -79.9140], ['Mapasingue', -2.1500, -79.9320], ['Guasmo Central', -2.2550, -79.8900],
    ['Hospital Luis Vernaza', -2.1880, -79.8840], ['Estadio Monumental', -2.1470, -79.9220], ['Vía a la Costa km 10', -2.1830, -79.9800],
    ['Pascuales', -2.0800, -79.9500], ['Bellavista', -2.1820, -79.9180], ['Atarazana', -2.1680, -79.8880]
  ];
  var NOMBRES = ['Carlos Mendoza', 'Luis Peña', 'Pedro Alvarado', 'Rosa Vélez', 'Milca Fierro', 'Jorge Cedeño', 'Andrés Vera', 'María Bajaña', 'José Macías', 'Fernando Ruiz',
    'Diego Zambrano', 'Patricia León', 'Ricardo Salazar', 'Gabriel Torres', 'Miguel Chávez', 'Javier Mora', 'Kevin Castro', 'Daniel Cruz', 'Byron Pincay', 'Washington Tomalá',
    'Édison Villacís', 'Freddy Quiñónez', 'Jimmy Bravo', 'Galo Arteaga', 'Óscar Reyes', 'Manuel Franco', 'Wilson Plúas', 'Héctor Sornoza', 'Iván Montalvo', 'Juan Guerrero',
    'Cristian Lozano', 'Marlon Valencia', 'Bolívar Suárez', 'Ángel Navarrete', 'Edwin Alcívar', 'Darwin Pazmiño', 'Fabián Rendón', 'Segundo Cabrera', 'Víctor Holguín', 'Ronald Solórzano',
    'Paúl Ortega', 'Hugo Benítez', 'Lenin Carrasco', 'Johnny Murillo', 'Pablo Intriago', 'Alexis Burgos', 'Mauricio Paredes', 'Stalin Coello', 'Ramón Zurita', 'Xavier Almeida',
    'Gustavo Lindao', 'Jefferson Rosado', 'Raúl Barcia', 'Telmo Espinoza', 'Nelson Cobeña', 'Leonardo Sánchez', 'Eduardo Avilés', 'Henry Vásquez', 'Klever Montes', 'Franklin Gómez'];
  var CLIENTES = ['Ana Ruiz', 'Luis Vera', 'Rosa León', 'Jorge Mora', 'Elena Paz', 'Pedro Gil', 'Marta Sosa', 'Carmen Ortiz', 'Raúl Díaz', 'Lucía Paredes',
    'Sofía Andrade', 'Tomás Rivas', 'Valeria Cano', 'Mateo Flores', 'Camila Ponce', 'Martín Haro', 'Daniela Ochoa', 'Sebastián Lara', 'Gabriela Moreno', 'Esteban Ríos'];
  window.__CLIENTES_SIM = CLIENTES;
  // Carreras por hora del día (relativo): más en la mañana y al salir del trabajo
  var PESO = [0.6, 0.4, 0.3, 0.3, 0.5, 1.2, 3, 5.5, 6, 4.5, 3.8, 4, 4.6, 4.4, 3.8, 4, 4.6, 6, 6.2, 5.5, 4.4, 3.5, 2.4, 1.4];
  var suma = PESO.reduce(function (a, b) { return a + b; }, 0);
  window.__PESO_HORA_SIM = PESO.map(function (p) { return p / suma; });

  var semilla = 11; function azar() { semilla = (semilla * 9301 + 49297) % 233280; return semilla / 233280; }
  function cerca(l, m) { return { dir: l[0], lat: l[1] + (azar() - 0.5) * m, lng: l[2] + (azar() - 0.5) * m }; }

  var conductores = {}, estado = {}, saldos = {};
  NOMBRES.forEach(function (n, i) {
    var id = 'c' + String(i + 1).padStart(2, '0'), u = String(i + 1).padStart(2, '0');
    conductores[id] = { nombre: n, unidad: u, placa: 'G' + 'ABCDEFGHJKLMNPRSTUV'[i % 19] + 'S-' + (1000 + Math.floor(azar() * 8999)), usuario: n.split(' ')[0].toLowerCase() + u, telefono: '09' + (80000000 + Math.floor(azar() * 19999999)), activo: true };
    var l = LUGARES[Math.floor(azar() * LUGARES.length)], p = cerca(l, 0.02);
    var online = i < 46;
    estado[id] = { lat: p.lat, lng: p.lng, t: now, online: online, estado: 'libre' };
    saldos[id] = { saldoC: i % 13 === 5 ? 30 : 300 + Math.floor(azar() * 27) * 100 };
  });

  // Carreras ya hechas hoy (desde las 6:00 hasta ahora), según la hora
  var carreras = {}, numero = 20000, h0 = new Date(); h0.setHours(0, 0, 0, 0);
  var desde = h0.getTime() + 6 * 3600000, hechas = 0;
  for (var t = desde; t < now - 30 * MIN && hechas < 650; t += 60000) {
    var hora = new Date(t).getHours();
    if (azar() < 1000 * window.__PESO_HORA_SIM[hora] / 60) {
      var o = cerca(LUGARES[Math.floor(azar() * LUGARES.length)], 0.01), d = cerca(LUGARES[Math.floor(azar() * LUGARES.length)], 0.01);
      var km = Math.max(1, Despacho_dist(o, d) * 1.3), fijo = azar() < 0.25;
      var tarifaC = fijo ? Math.max(250, Math.round((150 + km * 60) / 25) * 25) : Math.max(250, 50 + Math.floor(km * 10) * 5 + Math.floor(azar() * 6) * 5);
      var com = tarifaC < 500 ? 50 : Math.round(tarifaC * 0.1);
      var cid = 'c' + String(1 + Math.floor(azar() * 46)).padStart(2, '0');
      var acept = t + (20 + Math.floor(azar() * 60)) * 1000, ini = acept + (3 + Math.floor(azar() * 6)) * MIN, fin = ini + Math.round(km * 2.4 + 2) * MIN;
      numero++; hechas++;
      carreras['h' + numero] = { numero: numero, cliente: CLIENTES[Math.floor(azar() * CLIENTES.length)], telefono: '09' + (80000000 + Math.floor(azar() * 19999999)),
        origen: o, destino: d, estado: 'finalizada', creada: t, ofertaDesde: t, aceptada: acept, iniciada: ini, finalizada: Math.min(fin, now - MIN),
        conductor: cid, conductorNombre: conductores[cid].nombre, unidad: conductores[cid].unidad, precioFijo: fijo, tarifa: tarifaC / 100, tarifaC: tarifaC,
        comisionC: com, comisionCobradaC: com, perdidaC: 0, comisionMinC: 50, metrosTotal: Math.round(km * 1000 + 1500),
        taximetro: fijo ? null : { inicio: ini, metros: Math.round(km * 1000), esperaSeg: Math.floor(azar() * 240), totalC: tarifaC } };
    }
  }
  function Despacho_dist(a, b) {
    var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  window.__SEED = {
    admins: { admin1: true },
    config: { cascadaSeg: 10, prioridadMin: 20, rechazoSeg: 60, arranqueC: 50, kmC: 50, esperaC: 5, esperaCadaSeg: 30, gratisSeg: 30, minimaC: 250, comisionMinC: 50, comisionPct: 10, comisionDesdeC: 500, saldoAlertaC: 100 },
    conductores: conductores, estado: estado, saldos: saldos,
    contador: { carreras: numero }, carreras: carreras,
    recargas: { clientes: {} }
  };
})();
