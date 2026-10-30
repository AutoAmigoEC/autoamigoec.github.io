// =====================================================================
//  AutoAmigo · Configuración del panel
//  Pega aquí los datos de tu proyecto de Firebase
//  (Consola de Firebase → ⚙ Configuración del proyecto → Tus apps → App web)
// =====================================================================
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDh5N8WADs3_ZOKv1-Xyrcr00fPDX5eXt4",
  authDomain: "autoamigo-be443.firebaseapp.com",
  databaseURL: "https://autoamigo-be443-default-rtdb.firebaseio.com",
  projectId: "autoamigo-be443",
  storageBucket: "autoamigo-be443.firebasestorage.app",
  messagingSenderId: "432821351190",
  appId: "1:432821351190:web:1fba3afed82773fbc49637"
};

// Ajustes generales
window.AUTOAMIGO = {
  empresa: "AutoAmigo",
  // Dominio interno para los usuarios de conductores (no es un correo real).
  // Debe ser IGUAL al de la app Android (Config.kt → DOMINIO_USUARIOS).
  dominioUsuarios: "conductores.autoamigo.app",
  // País para la búsqueda de direcciones (código de 2 letras)
  pais: "ec",
  // Centro inicial del mapa [latitud, longitud] y zoom.
  // Cámbialo por el centro de tu ciudad.
  centroMapa: [-2.1700, -79.9224],
  zoomMapa: 12
};
