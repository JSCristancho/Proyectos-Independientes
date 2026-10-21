// =====================================================
// BJL - Datos compartidos (Firebase: Authentication + Firestore)
// - Funciona sin internet: Firestore guarda una copia en el equipo y
//   sincroniza solo cuando vuelve la conexion.
// - Acceso solo para la dueña y las personas que ella autorice.
// =====================================================

const Store = (() => {
  const CFG = window.BJL_CONFIG || {};
  const DIAS_INICIAL = 60;
  const RECIBO_DEFECTO = { direccion: "CRA 34B # 50-163", telefono: "300 2503560", nit: "63524107", mensaje: "¡Gracias por confiar en nosotros!" };
  const SEED = [["Bordado Pecho", 18000], ["Bordado Espalda", 30000], ["Bordado Manga", 12000], ["Gorra", 15000],
                ["Camisa Polo", 35000], ["Chaqueta", 45000], ["Sudadera", 55000]];

  let app, auth, db, user = null, perfil = null;
  let unsubPerfil = null, unsubOrd = null, unsubs = [], datosIniciados = false;
  let estadoCb = () => { }, errorCb = () => { };
  const subs = new Set();
  const state = { orders: [], products: [], cfg: { ...RECIBO_DEFECTO }, counter: 1, usuarios: [], pendientes: false, desdeCache: false, dias: DIAS_INICIAL };

  const emit = () => subs.forEach(f => f());
  const on = f => subs.add(f);
  const limpio = o => JSON.parse(JSON.stringify(o));          // Firestore no acepta "undefined"
  const correo = () => user.email.toLowerCase();
  const esDuena = () => !!user && correo() === String(CFG.ownerEmail || "").toLowerCase();
  const codigo = num => String(num).padStart(4, "0");          // numeracion normal: 0001, 0002...

  function configurado() {
    const f = CFG.firebase || {};
    return !!f.apiKey && !/^PEGAR/.test(f.apiKey) && /@/.test(CFG.ownerEmail || "") && !/PON-AQUI/.test(CFG.ownerEmail);
  }

  function traducir(e) {
    const m = {
      "auth/invalid-email": "El correo no es válido.",
      "auth/missing-password": "Escribe la contraseña.",
      "auth/weak-password": "La contraseña es muy corta (mínimo 6 caracteres).",
      "auth/email-already-in-use": "Ese correo ya tiene cuenta. Usa «Entrar».",
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/wrong-password": "Correo o contraseña incorrectos.",
      "auth/user-not-found": "Correo o contraseña incorrectos.",
      "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
      "auth/network-request-failed": "No hay internet. Necesitas conexión para entrar la primera vez.",
      "auth/popup-closed-by-user": "", "auth/cancelled-popup-request": "",
      "auth/unauthorized-domain": "Esta dirección no está autorizada en Firebase (Authentication → Configuración → Dominios autorizados).",
      "auth/operation-not-allowed": "Ese tipo de acceso no está activado en Firebase.",
    };
    return (e && e.code in m) ? m[e.code] : ("Ocurrió un error: " + (e && (e.code || e.message) || e));
  }

  // ---------- Arranque ----------
  async function limpiarCopiaLocalSiHaceFalta() {
    try {
      if (localStorage.getItem("bjl_limpiar") !== "1") return;
      if (indexedDB.databases) for (const d of await indexedDB.databases()) if (/^firestore\//.test(d.name)) indexedDB.deleteDatabase(d.name);
      localStorage.removeItem("bjl_limpiar");
    } catch { }
  }

  async function init(onEstado, onError) {
    estadoCb = onEstado; errorCb = onError || (() => { });
    if (!configurado()) return estadoCb({ estado: "sin-config" });
    await limpiarCopiaLocalSiHaceFalta();
    app = FB.initializeApp(CFG.firebase);
    auth = FB.getAuth(app);
    try { db = FB.initializeFirestore(app, { localCache: FB.persistentLocalCache({ tabManager: FB.persistentMultipleTabManager() }) }); }
    catch { db = FB.initializeFirestore(app, {}); }          // navegador sin almacenamiento persistente
    FB.onAuthStateChanged(auth, alCambiarSesion);
    FB.getRedirectResult(auth).catch(() => { });            // por si el acceso con Google volvio de una redireccion
  }

  function detenerDatos() {
    unsubs.forEach(u => u()); unsubs = []; if (unsubOrd) unsubOrd(); unsubOrd = null;
    datosIniciados = false;
    Object.assign(state, { orders: [], products: [], usuarios: [], counter: 1, pendientes: false });
  }

  async function alCambiarSesion(u) {
    if (unsubPerfil) { unsubPerfil(); unsubPerfil = null; }
    detenerDatos(); user = u; perfil = null;
    if (!u) return estadoCb({ estado: "sin-sesion" });
    if (!u.emailVerified) return estadoCb({ estado: "verificar", email: u.email });
    try { const r = await u.getIdTokenResult(); if (!r.claims.email_verified) await u.getIdToken(true); } catch { }
    escucharPerfil();
  }

  function escucharPerfil() {
    const ref = FB.doc(db, "usuarios", correo());
    unsubPerfil = FB.onSnapshot(ref, async snap => {
      if (!snap.exists()) {
        if (snap.metadata.fromCache) return estadoCb({ estado: "sin-conexion" });       // aun no se pudo confirmar con el servidor
        if (esDuena()) return crearPerfilDuena(ref);
        return estadoCb({ estado: "no-autorizada", email: user.email });
      }
      perfil = { nombre: user.email, ...snap.data(), email: correo() };
      if (perfil.activo === false) { detenerDatos(); return estadoCb({ estado: "desactivada" }); }
      if (!datosIniciados) iniciarDatos();
      estadoCb({ estado: "listo" });
    }, err => {
      if (err.code === "permission-denied") estadoCb({ estado: "no-autorizada", email: user.email });
      else estadoCb({ estado: "error", mensaje: err.message });
    });
  }

  // Primera vez de la dueña: crea su perfil, los datos del recibo y los productos de ejemplo
  async function crearPerfilDuena(ref) {
    try {
      await FB.setDoc(ref, { nombre: "Dueña", activo: true, rol: "admin" });
      if (!(await FB.getDoc(FB.doc(db, "config", "recibo"))).exists()) await FB.setDoc(FB.doc(db, "config", "recibo"), RECIBO_DEFECTO);
      if ((await FB.getDocs(FB.collection(db, "productos"))).empty)
        for (const [nombre, precio] of SEED) await FB.addDoc(FB.collection(db, "productos"), { nombre, precio, fijo: true });
    } catch (e) { estadoCb({ estado: "error", mensaje: traducir(e) }); }
  }

  // ---------- Datos en tiempo real ----------
  const errData = e => { if (e.code === "permission-denied") estadoCb({ estado: "no-autorizada", email: user && user.email }); };

  function iniciarDatos() {
    datosIniciados = true;
    suscribirOrdenes();
    unsubs.push(FB.onSnapshot(FB.collection(db, "productos"), snap => {
      state.products = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")); emit();
    }, errData));
    unsubs.push(FB.onSnapshot(FB.doc(db, "config", "recibo"), snap => { state.cfg = { ...RECIBO_DEFECTO, ...(snap.data() || {}) }; emit(); }, errData));
    unsubs.push(FB.onSnapshot(FB.doc(db, "contadores", "general"), snap => { state.counter = snap.exists() ? snap.data().siguiente : 1; emit(); }, errData));
    if (esDuena()) unsubs.push(FB.onSnapshot(FB.collection(db, "usuarios"), snap => { state.usuarios = snap.docs.map(d => ({ email: d.id, ...d.data() })); emit(); }, errData));
  }

  function suscribirOrdenes() {
    if (unsubOrd) unsubOrd();
    const desde = new Date(Date.now() - state.dias * 864e5); desde.setHours(0, 0, 0, 0);
    const q = FB.query(FB.collection(db, "ordenes"), FB.where("fecha", ">=", desde.toISOString()), FB.orderBy("fecha", "desc"));
    unsubOrd = FB.onSnapshot(q, { includeMetadataChanges: true }, snap => {
      state.orders = snap.docs.map(d => ({ id: d.id, pendiente: d.metadata.hasPendingWrites, ...d.data() }));
      state.pendientes = snap.metadata.hasPendingWrites; state.desdeCache = snap.metadata.fromCache; emit();
    }, errData);
  }

  // Carga ordenes mas antiguas (para historial o cierre de dias pasados)
  function ampliarHasta(diaClave) {
    const [y, m, d] = diaClave.split("-").map(Number);
    const necesarios = Math.ceil((Date.now() - new Date(y, m - 1, d).getTime()) / 864e5) + 1;
    if (necesarios > state.dias) { state.dias = Math.ceil(necesarios / 30) * 30; if (datosIniciados) suscribirOrdenes(); return true; }
    return false;
  }
  function ampliarDias(mas) { state.dias += mas; if (datosIniciados) suscribirOrdenes(); }

  // ---------- Ordenes ----------
  function numeroSiguiente() {
    const mx = state.orders.reduce((m, o) => Math.max(m, Number.isFinite(o.num) ? o.num : 0), 0);
    return Math.max(state.counter, mx + 1);
  }
  const codigoSiguiente = () => codigo(numeroSiguiente());

  // OJO: no se espera (await) a que el servidor confirme: sin internet la escritura queda en cola y se envia sola.
  const alErrorEscritura = e => errorCb(e.code === "permission-denied" ? "No tienes permiso para guardar. Avísale a la dueña." : traducir(e));

  function guardarOrdenNueva(o) {
    const ref = FB.doc(FB.collection(db, "ordenes")), b = FB.writeBatch(db);
    b.set(ref, limpio({ ...o, id: undefined }));
    b.set(FB.doc(db, "contadores", "general"), { siguiente: o.num + 1 });
    b.commit().catch(alErrorEscritura);
    return ref.id;
  }
  function guardarOrdenEditada(o) { FB.setDoc(FB.doc(db, "ordenes", o.id), limpio({ ...o, id: undefined, pendiente: undefined })).catch(alErrorEscritura); }
  function borrarOrden(id) { FB.deleteDoc(FB.doc(db, "ordenes", id)).catch(alErrorEscritura); }

  // ---------- Productos y datos del recibo ----------
  function agregarProducto(p) { FB.addDoc(FB.collection(db, "productos"), limpio(p)).catch(alErrorEscritura); }
  function quitarProducto(id) { FB.deleteDoc(FB.doc(db, "productos", id)).catch(alErrorEscritura); }
  function guardarConfig(c) { FB.setDoc(FB.doc(db, "config", "recibo"), limpio(c)).catch(alErrorEscritura); }

  // ---------- Usuarios (solo dueña) ----------
  function guardarUsuario(email, datos) { return FB.setDoc(FB.doc(db, "usuarios", email.toLowerCase()), limpio(datos), { merge: true }).catch(alErrorEscritura); }
  function quitarUsuario(email) { return FB.deleteDoc(FB.doc(db, "usuarios", email.toLowerCase())).catch(alErrorEscritura); }

  // ---------- Respaldo ----------
  async function todasLasOrdenes() {
    const s = await FB.getDocs(FB.query(FB.collection(db, "ordenes"), FB.orderBy("fecha", "asc")));
    return s.docs.map(d => ({ ...d.data(), id: undefined }));
  }
  async function importar({ orders, products }) {
    const espera = p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Sin conexión: conéctate a internet para importar.")), 25000))]);
    for (let i = 0; i < orders.length; i += 400) {
      const b = FB.writeBatch(db);
      orders.slice(i, i + 400).forEach(o => b.set(FB.doc(FB.collection(db, "ordenes")), limpio(o)));
      await espera(b.commit());
    }
    for (const p of products) await espera(FB.addDoc(FB.collection(db, "productos"), limpio(p)));
    // la numeracion continua despues del numero mas alto importado
    const mayor = orders.reduce((m, o) => Math.max(m, Number.isFinite(o.num) ? o.num : 0), 0);
    if (mayor + 1 > numeroSiguiente()) await espera(FB.setDoc(FB.doc(db, "contadores", "general"), { siguiente: mayor + 1 }));
  }

  // ---------- Cuenta ----------
  async function entrarGoogle() {
    const prov = new FB.GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" });
    try { await FB.signInWithPopup(auth, prov); }
    catch (e) {
      if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") { await FB.signInWithRedirect(auth, prov); return; }
      throw e;
    }
  }
  async function entrar(e, p) { await FB.signInWithEmailAndPassword(auth, e.trim(), p); }
  async function registrar(e, p) { const c = await FB.createUserWithEmailAndPassword(auth, e.trim(), p); try { await FB.sendEmailVerification(c.user); } catch { } }
  const reenviarVerificacion = () => FB.sendEmailVerification(auth.currentUser);
  const recuperar = e => FB.sendPasswordResetEmail(auth, e.trim());
  async function yaConfirme() {
    await FB.reload(auth.currentUser);
    if (auth.currentUser.emailVerified) await alCambiarSesion(auth.currentUser); else throw { code: "no-verificado" };
  }
  async function salir() { localStorage.setItem("bjl_limpiar", "1"); await FB.signOut(auth); location.reload(); }

  return {
    state, on, init, traducir, configurado, esDuena, codigo, codigoSiguiente, numeroSiguiente,
    get perfil() { return perfil; }, get user() { return user; },
    guardarOrdenNueva, guardarOrdenEditada, borrarOrden, agregarProducto, quitarProducto, guardarConfig,
    guardarUsuario, quitarUsuario, todasLasOrdenes, importar, ampliarHasta, ampliarDias,
    entrarGoogle, entrar, registrar, reenviarVerificacion, recuperar, yaConfirme, salir,
  };
})();
