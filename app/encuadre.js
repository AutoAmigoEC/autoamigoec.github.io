/* AutoAmigo · Encuadre automático de la foto de perfil (en el teléfono, sin internet extra).
 * Con los puntos de la cara (ojos y nariz) deja todas las fotos iguales, como foto carnet:
 *   - centra la cara, la pone siempre del mismo tamaño (acerca o aleja) y la endereza si salió inclinada;
 *   - si la cara está de lado, muy lejos, muy cerca o cortada, NO la arregla: devuelve el motivo para repetirla.
 * Uso: AAEncuadre.arreglar(fotoDataURL).then(function (r) { r.ok ? r.foto : r.motivo });
 */
(function () {
  var FA = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/';
  var TAM = 600;            // foto final cuadrada (px)
  var OJOS = 0.14;          // distancia entre ojos = 14% del ancho → cara, hombros y camisa
  var ALTO_OJOS = 0.40;     // los ojos quedan a esta altura (desde arriba)
  var FONDO = '#EEF0F3';    // si al alejar falta un poco de imagen, se rellena con gris claro
  var carga = null;
  function cargar() {
    if (carga) return carga;
    carga = new Promise(function (ok, mal) { if (window.faceapi) return ok(); var s = document.createElement('script'); s.src = FA + 'dist/face-api.js'; s.onload = ok; s.onerror = mal; document.head.appendChild(s); })
      .then(function () { return Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(FA + 'model/'), faceapi.nets.faceLandmark68Net.loadFromUri(FA + 'model/')]); })
      .catch(function (e) { carga = null; throw e; });
    return carga;
  }
  function imagen(src) { return new Promise(function (ok, mal) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = mal; i.src = src; }); }
  function centro(p, a, b) { var x = 0, y = 0; for (var i = a; i <= b; i++) { x += p[i].x; y += p[i].y; } return { x: x / (b - a + 1), y: y / (b - a + 1) }; }
  function mal(m) { return { ok: false, motivo: m }; }

  function arreglar(src) {
    return cargar().then(function () { return imagen(src); }).then(function (im) {
      return faceapi.detectSingleFace(im, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })).withFaceLandmarks().then(function (r) {
        if (!r) return mal('No vemos bien tu cara. Ponte de frente, con buena luz y sin gafas.');
        var p = r.landmarks.positions, W = im.naturalWidth || im.width, H = im.naturalHeight || im.height;
        var L = centro(p, 36, 41), R = centro(p, 42, 47);
        var dx = R.x - L.x, dy = R.y - L.y, ojo = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
        var mid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 }, nariz = p[30];
        // Cara de lado: la nariz se corre hacia un ojo
        var lado = ((nariz.x - mid.x) * dx + (nariz.y - mid.y) * dy) / (ojo * ojo);
        if (Math.abs(lado) > 0.22) return mal('Tienes la cara de lado. Mira de frente a la cámara.');
        if (ojo < W * 0.07) return mal('Estás muy lejos. Acércate un poco a la cámara.');
        if (ojo > W * 0.42) return mal('Estás muy cerca. Aléjate un poco de la cámara.');
        var s = (OJOS * TAM) / ojo, cy = ALTO_OJOS * TAM;
        // ¿Cuánto de la foto final quedaría fuera de la foto tomada?
        var fuera = 0, n = 0, cos = Math.cos(ang), sin = Math.sin(ang);
        for (var u = 0; u < TAM; u += TAM / 12) for (var v = 0; v < TAM; v += TAM / 12) {
          var a = (u - TAM / 2) / s, b = (v - cy) / s, x = cos * a - sin * b + mid.x, y = sin * a + cos * b + mid.y;
          n++; if (x < 0 || y < 0 || x > W || y > H) fuera++;
        }
        if (fuera / n > 0.3) return mal('Tu foto sale cortada. Aléjate un poco para que se vean tu cabeza y tus hombros.');
        var c = document.createElement('canvas'); c.width = c.height = TAM;
        var g = c.getContext('2d');
        g.fillStyle = FONDO; g.fillRect(0, 0, TAM, TAM);
        g.translate(TAM / 2, cy); g.rotate(-ang); g.scale(s, s); g.translate(-mid.x, -mid.y);
        g.imageSmoothingQuality = 'high';
        g.drawImage(im, 0, 0, W, H);
        return { ok: true, foto: c.toDataURL('image/jpeg', 0.82) };
      });
    });
  }
  // ---------- "Estudio": fondo igual para todos + luz y color ----------
  // Separa a la persona del fondo (MediaPipe de Google, en el teléfono), arregla la luz y el color solo de la persona
  // (sin filtros de belleza: tiene que seguir pareciéndose a su cédula) y la pone sobre el fondo de AutoAmigo.
  var MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var MODELO = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
  var seg = null;
  function segmentador() {
    if (seg) return seg;
    seg = import(MP + '/vision_bundle.mjs').then(function (m) {
      return m.FilesetResolver.forVisionTasks(MP + '/wasm').then(function (f) {
        return m.ImageSegmenter.createFromOptions(f, { baseOptions: { modelAssetPath: MODELO, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false });
      });
    }).catch(function (e) { seg = null; throw e; });
    return seg;
  }
  function pintarFondo(g, n, tipo) {
    var gr;
    if (tipo === 'gris' || tipo === 'blanco') { g.fillStyle = tipo === 'gris' ? '#D3D6DB' : '#F6F7F9'; g.fillRect(0, 0, n, n); return; }   // liso, sin luces
    if (tipo === 'azul') { gr = g.createRadialGradient(n / 2, n * 0.35, n * 0.05, n / 2, n * 0.45, n * 0.75); gr.addColorStop(0, '#2B3A8C'); gr.addColorStop(1, '#0A0F3C'); }
    else { gr = g.createRadialGradient(n / 2, n * 0.35, n * 0.05, n / 2, n * 0.45, n * 0.75); gr.addColorStop(0, '#F4F5F7'); gr.addColorStop(1, '#D9DDE3'); }
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  }
  // Texturas de pared reales (fotos de Unsplash, licencia libre): oscura para camisas claras, clara para camisas oscuras
  var PAREDES = {
    oscura: 'https://images.unsplash.com/photo-1568090819305-e7edcc3b264b?w=900&q=80&fm=jpg',
    clara: 'https://images.unsplash.com/photo-1533628635777-112b2239b1c7?w=900&q=80&fm=jpg'
  };
  var texturas = {};
  function textura(k) {
    if (!texturas[k]) texturas[k] = new Promise(function (ok, mal) { var i = new Image(); i.crossOrigin = 'anonymous'; i.onload = function () { ok(i); }; i.onerror = mal; i.src = PAREDES[k]; }).catch(function (e) { texturas[k] = null; throw e; });
    return texturas[k];
  }
  function estudio(src, tipo) {
    return Promise.all([segmentador(), imagen(src), tipo === 'pared' ? Promise.all([textura('oscura'), textura('clara')]) : null]).then(function (x) {
      var s = x[0], im = x[1], n = im.naturalWidth || im.width, tex = x[2];
      var c = document.createElement('canvas'); c.width = c.height = n; var g = c.getContext('2d'); g.drawImage(im, 0, 0, n, n);
      var res = s.segment(c), m = res.confidenceMasks[0], mw = m.width, mh = m.height, conf = m.getAsFloat32Array();
      var px = g.getImageData(0, 0, n, n), d = px.data, alfa = new Float32Array(n * n);
      // Máscara de la persona (con borde suave)
      for (var yy = 0; yy < n; yy++) for (var xx = 0; xx < n; xx++) {
        var v = conf[Math.min(mh - 1, Math.floor(yy * mh / n)) * mw + Math.min(mw - 1, Math.floor(xx * mw / n))];
        alfa[yy * n + xx] = Math.max(0, Math.min(1, (v - 0.5) / 0.25));   // borde más justo: menos halo de la pared vieja
      }
      if (m.close) m.close();
      // Luz: estira el brillo de la persona entre sus tonos oscuros y claros, y lleva el promedio a un punto agradable
      var hist = new Uint32Array(256), tot = 0, sr = 0, sg = 0, sb = 0;
      // Se mide solo la zona de la cara (la camisa blanca u oscura no debe engañar al brillo)
      for (var i = 0; i < n * n; i++) { var fy = Math.floor(i / n) / n, fx = (i % n) / n; if (alfa[i] < 0.8 || fy < 0.22 || fy > 0.58 || fx < 0.3 || fx > 0.7) continue; var k = i * 4, l = Math.round(0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]); hist[l]++; tot++; sr += d[k]; sg += d[k + 1]; sb += d[k + 2]; }
      var bajo = 0, alto = 255, acc = 0, medio = 128;
      if (tot > 300) {
        for (var a = 0; a < 256; a++) { acc += hist[a]; if (acc >= tot * 0.01) { bajo = a; break; } }
        acc = 0; for (var b = 255; b >= 0; b--) { acc += hist[b]; if (acc >= tot * 0.01) { alto = b; break; } }
        acc = 0; for (var c2 = 0; c2 < 256; c2++) { acc += hist[c2]; if (acc >= tot * 0.5) { medio = c2; break; } }
      }
      bajo = Math.min(bajo, 25); alto = Math.max(alto, 235);
      var mN = Math.max(0.05, Math.min(0.95, (medio - bajo) / (alto - bajo)));
      var gamma = Math.max(0.7, Math.min(1.0, Math.log(0.55) / Math.log(mN)));   // aclara si está oscura; nunca oscurece
      // Color: quita la mitad del tinte (amarillo de focos, azul de sombra) sin tocar el tono de piel por completo
      var pr = 1, pg = 1, pb = 1;
      if (tot > 300) { var mr = sr / tot, mg = sg / tot, mb = sb / tot, gris = (mr + mg + mb) / 3; pr = 1 + 0.15 * (gris / mr - 1); pg = 1 + 0.15 * (gris / mg - 1); pb = 1 + 0.15 * (gris / mb - 1); }
      var tabla = new Uint8ClampedArray(256);
      for (var t = 0; t < 256; t++) tabla[t] = 255 * Math.pow(Math.max(0, Math.min(1, (t - bajo) / (alto - bajo))), gamma);
      for (var j = 0; j < n * n; j++) { var q = j * 4; d[q] = tabla[Math.min(255, d[q] * pr) | 0]; d[q + 1] = tabla[Math.min(255, d[q + 1] * pg) | 0]; d[q + 2] = tabla[Math.min(255, d[q + 2] * pb) | 0]; }
      // Nitidez suave (solo sobre la persona)
      var o = new Uint8ClampedArray(d);
      for (var y2 = 1; y2 < n - 1; y2++) for (var x2 = 1; x2 < n - 1; x2++) {
        var ii = y2 * n + x2; if (alfa[ii] < 0.5) continue;
        for (var ch = 0; ch < 3; ch++) { var p0 = ii * 4 + ch; var bl = (o[p0 - 4] + o[p0 + 4] + o[p0 - n * 4] + o[p0 + n * 4]) / 4; d[p0] = o[p0] + 0.35 * (o[p0] - bl); }
      }
      // Borde limpio: en el filo de la persona se quita el color de la pared vieja (si no, queda una silueta clara)
      var pc = document.createElement('canvas'); pc.width = pc.height = n; var gp = pc.getContext('2d'), pdat = gp.createImageData(n, n);
      for (var q1 = 0; q1 < n * n; q1++) { var r6 = q1 * 4; pdat.data[r6] = d[r6]; pdat.data[r6 + 1] = d[r6 + 1]; pdat.data[r6 + 2] = d[r6 + 2]; pdat.data[r6 + 3] = alfa[q1] > 0.97 ? 255 : 0; }
      gp.putImageData(pdat, 0, 0);
      var pb2 = document.createElement('canvas'); pb2.width = pb2.height = n; var gpb = pb2.getContext('2d');
      gpb.filter = 'blur(' + Math.max(2, Math.round(n / 120)) + 'px)'; gpb.drawImage(pc, 0, 0); gpb.drawImage(pc, 0, 0); gpb.filter = 'none';
      var lim = gpb.getImageData(0, 0, n, n).data;
      for (var q2 = 0; q2 < n * n; q2++) {
        var a2 = alfa[q2]; if (a2 <= 0 || a2 > 0.97) continue;
        var r7 = q2 * 4; if (lim[r7 + 3] < 10) { alfa[q2] = a2 * 0.5; continue; }
        d[r7] = lim[r7]; d[r7 + 1] = lim[r7 + 1]; d[r7 + 2] = lim[r7 + 2];
        alfa[q2] = Math.pow(a2, 1.6);   // y el borde un poco más fino
      }
      // Persona sobre el fondo
      var f = document.createElement('canvas'); f.width = f.height = n; var gf = f.getContext('2d');
      if (tipo === 'retrato') {
        // Modo retrato: el fondo real, desenfocado y un poco más claro (como una cámara buena), sin inventar nada
        // Se borra a la persona del fondo antes de desenfocar (si no, el pelo oscuro deja una sombra alrededor)
        var sb = document.createElement('canvas'); sb.width = sb.height = n; var gs = sb.getContext('2d');
        var bgd = gs.createImageData(n, n), od = g.getImageData(0, 0, n, n).data;
        for (var e = 0; e < n * n; e++) { var r4 = e * 4, ab = alfa[e] > 0.05 ? 0 : 255; bgd.data[r4] = od[r4]; bgd.data[r4 + 1] = od[r4 + 1]; bgd.data[r4 + 2] = od[r4 + 2]; bgd.data[r4 + 3] = ab; }
        gs.putImageData(bgd, 0, 0);
        var sm = document.createElement('canvas'); sm.width = sm.height = n; var gm = sm.getContext('2d');
        gm.filter = 'blur(' + Math.round(n / 14) + 'px)'; gm.drawImage(sb, 0, 0); gm.drawImage(sb, 0, 0); gm.filter = 'none';
        var md = gm.getImageData(0, 0, n, n), mdd = md.data, tr = 0, tg = 0, tb = 0, tn = 0;
        for (var e2 = 0; e2 < n * n; e2++) if (bgd.data[e2 * 4 + 3]) { tr += od[e2 * 4]; tg += od[e2 * 4 + 1]; tb += od[e2 * 4 + 2]; tn++; }
        tr = tn ? tr / tn : 200; tg = tn ? tg / tn : 200; tb = tn ? tb / tn : 200;
        for (var e3 = 0; e3 < n * n; e3++) { var r5 = e3 * 4; if (mdd[r5 + 3] < 8) { mdd[r5] = tr; mdd[r5 + 1] = tg; mdd[r5 + 2] = tb; } mdd[r5 + 3] = 255; }
        gm.putImageData(md, 0, 0);
        gf.drawImage(sm, 0, 0); gf.filter = 'blur(' + Math.round(n / 60) + 'px)'; gf.drawImage(sm, -n * 0.04, -n * 0.04, n * 1.08, n * 1.08); gf.filter = 'none';   // sin bordes oscuros
        gf.fillStyle = 'rgba(255,255,255,0.06)'; gf.fillRect(0, 0, n, n);
      } else if (tipo === 'pared') {
        // ¿La camisa es clara u oscura? (zona de abajo, solo la persona)
        var cs = 0, cn = 0;
        for (var q3 = Math.floor(n * 0.78) * n; q3 < n * n; q3++) if (alfa[q3] > 0.9) { var r8 = q3 * 4; cs += 0.299 * d[r8] + 0.587 * d[r8 + 1] + 0.114 * d[r8 + 2]; cn++; }
        var camisaClara = cn ? cs / cn > 120 : true;
        var tx = camisaClara ? tex[0] : tex[1], objetivo = camisaClara ? [62, 64, 68] : [196, 192, 186];
        var tw = tx.naturalWidth, th = tx.naturalHeight, lado = Math.min(tw, th);
        var pa = document.createElement('canvas'); pa.width = pa.height = n; var gpa = pa.getContext('2d');
        gpa.filter = 'blur(' + Math.max(1, Math.round(n / 300)) + 'px)';   // la pared un poquito fuera de foco, como en una foto real
        gpa.drawImage(tx, (tw - lado) / 2, (th - lado) / 2, lado, lado, 0, 0, n, n); gpa.filter = 'none';
        var pd = gpa.getImageData(0, 0, n, n), pdd = pd.data, lm = 0;
        for (var q4 = 0; q4 < n * n; q4++) lm += 0.299 * pdd[q4 * 4] + 0.587 * pdd[q4 * 4 + 1] + 0.114 * pdd[q4 * 4 + 2];
        lm /= n * n;
        for (var q5 = 0; q5 < n * n; q5++) {
          var r9 = q5 * 4, lu = 0.299 * pdd[r9] + 0.587 * pdd[r9 + 1] + 0.114 * pdd[r9 + 2], vx = (q5 % n) / n;
          var luz = 1.08 - 0.16 * vx;   // entra luz por un lado, como de una ventana
          for (var cc = 0; cc < 3; cc++) pdd[r9 + cc] = (objetivo[cc] + (lu - lm) * 0.7) * luz;
        }
        gpa.putImageData(pd, 0, 0); gf.drawImage(pa, 0, 0);
      } else if (tipo === 'estudio') {
        // Fondo de estudio fotográfico: tela gris con manchas suaves (como las de los fotógrafos), más clara al centro
        var gr2 = gf.createRadialGradient(n / 2, n * 0.38, n * 0.05, n / 2, n * 0.5, n * 0.8);
        gr2.addColorStop(0, '#AEB3BA'); gr2.addColorStop(1, '#5F656E'); gf.fillStyle = gr2; gf.fillRect(0, 0, n, n);
        var semilla = 7; function azar() { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; }
        var tela = document.createElement('canvas'); tela.width = tela.height = n; var gt = tela.getContext('2d');
        for (var mk = 0; mk < 46; mk++) {
          var bx = azar() * n, by = azar() * n, br = n * (0.08 + azar() * 0.22), claro = azar() > 0.5;
          var rg = gt.createRadialGradient(bx, by, 0, bx, by, br);
          rg.addColorStop(0, claro ? 'rgba(255,255,255,0.10)' : 'rgba(20,24,32,0.12)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
          gt.fillStyle = rg; gt.fillRect(0, 0, n, n);
        }
        gf.filter = 'blur(' + Math.round(n / 50) + 'px)'; gf.drawImage(tela, 0, 0); gf.filter = 'none';
        // Sombra suave de la persona sobre la tela (así no parece pegada)
        var so = document.createElement('canvas'); so.width = so.height = n; var gso = so.getContext('2d'), sod = gso.createImageData(n, n);
        for (var e4 = 0; e4 < n * n; e4++) { sod.data[e4 * 4 + 3] = alfa[e4] * 255; }
        gso.putImageData(sod, 0, 0);
        gf.save(); gf.globalAlpha = 0.28; gf.filter = 'blur(' + Math.round(n / 35) + 'px)'; gf.drawImage(so, n * 0.025, n * 0.02); gf.restore();
      } else pintarFondo(gf, n, tipo);
      var fp = gf.getImageData(0, 0, n, n), fd = fp.data;
      var grano = tipo === 'estudio' || tipo === 'pared' ? 5 : 0;   // un grano fino igual en todo une a la persona con el fondo
      for (var z = 0; z < n * n; z++) { var al = alfa[z], w = z * 4, gn = grano ? (Math.random() - 0.5) * grano : 0; fd[w] = fd[w] * (1 - al) + d[w] * al + gn; fd[w + 1] = fd[w + 1] * (1 - al) + d[w + 1] * al + gn; fd[w + 2] = fd[w + 2] * (1 - al) + d[w + 2] * al + gn; }
      gf.putImageData(fp, 0, 0);
      return f.toDataURL('image/jpeg', 0.85);
    });
  }
  window.AAEncuadre = { arreglar: arreglar, cargar: cargar, estudio: estudio, cargarEstudio: segmentador };
})();
