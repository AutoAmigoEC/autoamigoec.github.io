// PRUEBA: datos de ejemplo. Nada de esto se guarda en el panel real.
(function () {
  var now = Date.now(), MIN = 60000;
  function hoyA(h, m) { var d = new Date(); d.setHours(h, m, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
  var en21 = now + 21 * MIN;          // entra a activas en 1 minuto
  var manana = hoyA(8, 30) + (hoyA(8, 30) - now < 3 * 3600000 ? 86400000 : 0);
  window.__SEED = {
    admins: { admin1: true },
    config: { cascadaSeg: 10, prioridadMin: 20, rechazoSeg: 60, arranqueC: 50, kmC: 50, esperaC: 5, esperaCadaSeg: 30, gratisSeg: 30, minimaC: 250, comisionMinC: 50, comisionPct: 10, comisionDesdeC: 500, saldoAlertaC: 100 },
    conductores: {
      c1: { nombre: 'Carlos Mendoza', unidad: '07', placa: 'GBA-1234', usuario: 'carlos07', telefono: '0991234567', activo: true },
      c2: { nombre: 'Luis Peña', unidad: '12', placa: 'GSA-5521', usuario: 'luis12', activo: true },
      c3: { nombre: 'Pedro Alvarado', unidad: '03', placa: 'GBC-9910', usuario: 'pedro03', activo: true },
      c4: { nombre: 'Rosa Vélez', unidad: '26', placa: 'GBO-6620', usuario: 'rosa26', activo: true },
      c5: { nombre: 'Milca Fierro', unidad: '08', placa: 'GSK-6623', usuario: 'milca08', activo: true }
    },
    estado: {
      c1: { lat: -2.1850, lng: -79.8870, t: now, online: true, estado: 'libre' },
      c2: { lat: -2.1930, lng: -79.8820, t: now, online: true, estado: 'aceptada', carrera: 'r2' },
      c3: { lat: -2.1880, lng: -79.8950, t: now, online: true, estado: 'ejecucion', carrera: 'r3' },
      c4: { lat: -2.1965, lng: -79.8905, t: now, online: true, estado: 'libre' },
      c5: { lat: -2.1800, lng: -79.8930, t: now, online: true, estado: 'libre' }
    },
    saldos: { c1: { saldoC: 2000 }, c2: { saldoC: 1500 }, c3: { saldoC: 800 }, c4: { saldoC: 30 }, c5: { saldoC: 1000 } },
    contador: { carreras: 1006 },
    carreras: {
      r1: { numero: 1004, cliente: 'María Torres', telefono: '0987654321', origen: { dir: 'Av. 9 de Octubre y Boyacá', lat: -2.1905, lng: -79.8880 }, exacta: 'Edificio azul, 3er piso', estado: 'pendiente', creada: now - 4 * MIN, ofertaDesde: now - 4 * MIN, comisionMinC: 50, precioFijo: false },
      r2: { numero: 1002, cliente: 'Jorge Vera', telefono: '0961112233', origen: { dir: 'Calle 10 y Av. Quito', lat: -2.16, lng: -79.92 }, destino: { dir: 'Terminal Terrestre', lat: -2.14, lng: -79.88 }, estado: 'aceptada', creada: now - 12 * MIN, conductor: 'c2', conductorNombre: 'Luis Peña', unidad: '12', precioFijo: true, tarifa: 4.5, comisionMinC: 50 },
      r3: { numero: 1001, cliente: 'Ana Ruiz', telefono: '0979998877', origen: { dir: 'Hospital Kennedy', lat: -2.2, lng: -79.9 }, estado: 'ejecucion', creada: now - 25 * MIN, conductor: 'c3', conductorNombre: 'Pedro Alvarado', unidad: '03', precioFijo: false, comisionMinC: 50, taximetro: { inicio: now - 9 * MIN, metros: 3200, esperaSeg: 95, totalC: 200 } },
      r4: { numero: 1005, cliente: 'Isaac Fierro', telefono: '0969036818', origen: { dir: 'Cdla. Puerto Seymour, Mz 817 V 17', lat: -2.1042, lng: -79.8561 }, destino: { dir: 'Aeropuerto', lat: -2.157, lng: -79.884 }, estado: 'pendiente', creada: now - 30 * MIN, programada: true, recogerEn: en21, activarEn: en21 - 20 * MIN, ofertaDesde: en21 - 20 * MIN, comisionMinC: 80, precioFijo: false, tarifaEstimadaC: 800 },
      r5: { numero: 1006, cliente: 'Pedro Gómez', telefono: '0985551212', origen: { dir: 'Urdesa Central', lat: -2.17, lng: -79.91 }, destino: { dir: 'Mall del Sol', lat: -2.155, lng: -79.89 }, estado: 'pendiente', creada: now - 5 * MIN, programada: true, recogerEn: manana, activarEn: manana - 20 * MIN, ofertaDesde: manana - 20 * MIN, comisionMinC: 50, precioFijo: true, tarifa: 5 }
,
      r6: { numero: 1003, cliente: 'Lucía Paredes', telefono: '0994447788', origen: { dir: 'Av. de las Américas y Hermano Miguel', lat: -2.1700, lng: -79.8850 }, destino: { dir: 'Policentro', lat: -2.1720, lng: -79.8990 }, exacta: 'Frente a la farmacia', estado: 'pendiente', creada: now - 9 * MIN, ofertaDesde: now - 2 * MIN, comisionMinC: 50, precioFijo: false, cancelaciones: { c5: { nombre: 'Milca Fierro', unidad: '08', en: now - 2 * MIN } } }
    },
    recargas: { clientes: {} }
  };
})();
