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
  window.AAEncuadre = { arreglar: arreglar, cargar: cargar };
})();
