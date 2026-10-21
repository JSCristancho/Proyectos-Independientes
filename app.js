// =====================================================
// BJL Bordados - Sistema de gestion compartido
// (funciona sin internet; se sincroniza solo al reconectar)
// =====================================================

let cfg = { direccion: "", telefono: "", nit: "", mensaje: "" };
let products = [];
let orders = [];
let lineas = [];          // lineas de la orden en curso
let editing = null;       // orden que se esta editando (o null)
let vistaActual = "orden";
let hLimite = 100;        // tarjetas visibles en el historial

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const { money, fmtFecha, fmtHora } = Receipts;
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dayKey = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const esMovil = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const cod = o => o.codigo || Receipts.numStr(o.id);

const ic = e => `<span aria-hidden="true">${e}</span>`;
const sinMovimiento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const FOCO = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const visibles = cont => [...cont.querySelectorAll(FOCO)].filter(el => el.offsetParent !== null || el === document.activeElement);

// Avisos: los errores se quedan hasta cerrarlos; los demas duran segun el largo del texto
let toastT;
function toast(msg, esError) {
  const t = $("toast"); $("toastTxt").textContent = msg; t.classList.toggle("error", !!esError); t.hidden = false;
  clearTimeout(toastT);
  if (!esError) toastT = setTimeout(() => t.hidden = true, Math.max(6000, msg.length * 90));
}
$("toastCerrar").addEventListener("click", () => { $("toast").hidden = true; clearTimeout(toastT); });
function anunciar(msg) { const a = $("anuncio"); a.textContent = ""; setTimeout(() => a.textContent = msg, 60); }

// Errores junto al campo (aria-invalid + aria-describedby + foco)
function marcarError(id, msg) {
  const inp = $(id), er = $(id + "Err"); if (!inp || !er) return false;
  if (msg) {
    if (inp.dataset.desc === undefined) inp.dataset.desc = inp.getAttribute("aria-describedby") || "";
    er.textContent = msg; er.hidden = false; inp.setAttribute("aria-invalid", "true");
    inp.setAttribute("aria-describedby", (inp.dataset.desc + " " + er.id).trim()); inp.focus();
  } else if (!er.hidden) {
    er.hidden = true; er.textContent = ""; inp.removeAttribute("aria-invalid");
    if (inp.dataset.desc) inp.setAttribute("aria-describedby", inp.dataset.desc); else inp.removeAttribute("aria-describedby");
  }
  return !!msg;
}
["selProducto", "pNombre", "pPrecio", "uEmail", "uNombre"].forEach(id => {
  const el = $(id); el.addEventListener("input", () => marcarError(id, "")); el.addEventListener("change", () => marcarError(id, ""));
});

// Ventanas: el resto de la app queda inerte, el foco queda atrapado y vuelve al cerrar
let focoPrevio = null;
function actualizarInert() { $("app").inert = !$("modal").hidden || !$("pantallaAuth").hidden; }
function abrirModal(html) {
  focoPrevio = document.activeElement;
  $("modalCaja").innerHTML = html; $("modal").hidden = false; actualizarInert();
  const caja = $("modalCaja"); caja.focus();
}
function cerrarModal() {
  $("modal").hidden = true; $("modalCaja").innerHTML = ""; $("modalCaja").onclick = null; cierreAbierto = false; actualizarInert();
  if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus(); else $("principal").focus();
  focoPrevio = null;
}
$("modal").addEventListener("click", e => { if (e.target === $("modal")) cerrarModal(); });
document.addEventListener("keydown", e => {
  const modal = !$("modal").hidden, auth = !$("pantallaAuth").hidden;
  if (e.key === "Escape" && modal) { e.preventDefault(); cerrarModal(); return; }
  if (e.key === "Tab" && (modal || auth)) {
    const cont = modal ? $("modalCaja") : $("pantallaAuth"), f = visibles(cont);
    if (!f.length) { e.preventDefault(); return; }
    const a = f[0], z = f[f.length - 1];
    if (!cont.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
    else if (e.shiftKey && (document.activeElement === a || document.activeElement === cont)) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
});

// ---------------- Reloj ----------------
function tickReloj() {
  const now = new Date().toISOString();
  $("hdrFecha").textContent = fmtFecha(now); $("hdrHora").textContent = fmtHora(now);
  if (!editing) { $("oFecha").textContent = fmtFecha(now); $("oHora").textContent = fmtHora(now); }
}

// ---------------- Navegacion ----------------
const TITULOS = { orden: "Nueva orden", historial: "Historial", productos: "Productos", ajustes: "Ajustes" };
function irA(v) {
  vistaActual = v;
  document.querySelectorAll(".vista").forEach(s => s.classList.toggle("activa", s.id === "v-" + v));
  document.querySelectorAll(".tabs button").forEach(b => {
    const on = b.dataset.vista === v; b.classList.toggle("activa", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.title = TITULOS[v] + " · BJL Bordados"; anunciar(TITULOS[v]);
  $("barraTotal").classList.toggle("visible", v === "orden");
  document.body.classList.toggle("conTotal", v === "orden");
  if (v === "historial") { hLimite = 100; renderHistorial(); }
  if (v === "productos") renderProductos();
  if (v === "ajustes") renderAjustes();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => irA(b.dataset.vista)));

// ---------------- Indicador de sincronizacion ----------------
let syncPrevio = null;
function pintarSync() {
  const s = Store.state, b = $("hdrSync");
  let icono, txt, msg;
  if (!navigator.onLine) { icono = "📴"; txt = s.pendientes ? "Sin internet · pendientes" : "Sin internet"; msg = s.pendientes ? "Sin internet. Hay órdenes guardadas en este equipo que se enviarán al reconectar." : "Sin internet. Puedes seguir trabajando; todo se sincroniza al reconectar."; }
  else if (s.pendientes) { icono = "⏳"; txt = "Enviando…"; msg = "Enviando datos al servidor…"; }
  else { icono = "🟢"; txt = "Sincronizado"; msg = "Todo sincronizado."; }
  b.querySelector(".syncIc").textContent = icono; b.querySelector(".syncTxt").textContent = txt; b.dataset.msg = msg;
  b.title = "Estado de sincronización: toca para más detalle";
  if (syncPrevio !== null && syncPrevio !== msg) anunciar(msg);
  syncPrevio = msg;
}
$("hdrSync").addEventListener("click", e => toast(e.currentTarget.dataset.msg || ""));
addEventListener("online", pintarSync); addEventListener("offline", pintarSync);

// =====================================================
// ORDEN
// =====================================================
function totalOrden() { return lineas.reduce((t, l) => t + l.cantidad * (Number(l.precio) || 0), 0); }
let totalT;
function pintarTotal() {
  const t = money(totalOrden()); $("total").textContent = t;
  clearTimeout(totalT); totalT = setTimeout(() => { $("totalLive").textContent = "Total de la orden: " + t; }, 900);
}
function pintarNumero() { if (Store.perfil) $("oNumero").textContent = editing ? cod(editing) : Store.codigoSiguiente(); }

function renderSelector() {
  const sel = $("selProducto"), previo = sel.value;
  sel.innerHTML = products.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}${p.fijo ? " — " + money(p.precio) : ""}</option>`).join("");
  if (products.some(p => p.id === previo)) sel.value = previo;
  $("ayudaVacio").hidden = products.length > 0;
  $("btnAgregar").disabled = products.length === 0;
  sel.disabled = products.length === 0;
}

function renderLineas() {
  $("sinLineas").hidden = lineas.length > 0;
  $("lineas").innerHTML = lineas.map((l, i) => {
    const n = esc(l.nombre), sr = `<span class="sr"> de ${n}</span>`;
    return `
    <div class="linea" data-i="${i}" role="group" aria-labelledby="l${i}-nom">
      <div class="cab"><b id="l${i}-nom">${n}</b><button type="button" class="quitar" data-act="quitar" aria-label="Quitar ${n} de la orden"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></div>
      <div class="campos">
        <div><label for="l${i}-cant">Cantidad${sr}</label>
          <div class="cant">
            <button type="button" data-act="menos" aria-label="Disminuir cantidad de ${n}">−</button>
            <input id="l${i}-cant" type="number" inputmode="numeric" min="1" step="1" data-f="cantidad" value="${l.cantidad}">
            <button type="button" data-act="mas" aria-label="Aumentar cantidad de ${n}">+</button>
          </div></div>
        <div><label for="l${i}-precio">Valor unitario ($)${sr}</label>
          <input id="l${i}-precio" type="number" inputmode="numeric" min="0" data-f="precio" placeholder="0" value="${l.precio === "" ? "" : l.precio}"></div>
      </div>
      <div class="obs"><label for="l${i}-obs">Observaciones <span class="opc">(opcional)</span>${sr}</label>
      <textarea id="l${i}-obs" rows="2" data-f="obs" placeholder="Ej: color, tamaño, ubicación">${esc(l.obs)}</textarea></div>
      <div class="sub">Subtotal: <b data-sub>${money(l.cantidad * (Number(l.precio) || 0))}</b></div>
    </div>`;
  }).join("");
  pintarTotal();
}

function actualizarSub(i) {
  const el = $("lineas").querySelector(`.linea[data-i="${i}"] [data-sub]`);
  if (el) el.textContent = money(lineas[i].cantidad * (Number(lineas[i].precio) || 0));
  pintarTotal();
}

$("lineas").addEventListener("input", e => {
  const f = e.target.dataset.f; if (!f) return;
  const i = +e.target.closest(".linea").dataset.i;
  if (f === "obs") lineas[i].obs = e.target.value;
  else if (f === "precio") { lineas[i].precio = e.target.value === "" ? "" : Math.max(0, Number(e.target.value)); actualizarSub(i); }
  else if (f === "cantidad") { const n = Math.floor(Number(e.target.value)); if (n >= 1) { lineas[i].cantidad = n; actualizarSub(i); } }
});
$("lineas").addEventListener("change", e => {
  if (e.target.dataset.f === "cantidad") { const i = +e.target.closest(".linea").dataset.i; if (!(lineas[i].cantidad >= 1)) lineas[i].cantidad = 1; e.target.value = lineas[i].cantidad; actualizarSub(i); }
});
$("lineas").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const i = +b.closest(".linea").dataset.i, a = b.dataset.act;
  if (a === "quitar") { const nom = lineas[i].nombre; lineas.splice(i, 1); renderLineas(); anunciar(nom + " quitado de la orden"); $("selProducto").focus(); }
  else {
    lineas[i].cantidad = Math.max(1, lineas[i].cantidad + (a === "mas" ? 1 : -1));
    b.closest(".cant").querySelector("input").value = lineas[i].cantidad; actualizarSub(i);
  }
});

$("btnAgregar").addEventListener("click", () => {
  const p = products.find(x => x.id === $("selProducto").value); if (!p) return;
  lineas.push({ nombre: p.nombre, cantidad: 1, precio: p.fijo ? p.precio : "", obs: "" });
  renderLineas();
  const card = $("lineas").lastElementChild;
  marcarError("selProducto", "");
  card.scrollIntoView({ behavior: sinMovimiento() ? "auto" : "smooth", block: "center" });
  if (!p.fijo) card.querySelector('[data-f="precio"]').focus({ preventScroll: true });
  else anunciar(p.nombre + " agregado a la orden");
});

function resetOrden() {
  lineas = []; editing = null; $("cliente").value = "";
  $("bannerEdicion").hidden = true; $("btnGenerar").innerHTML = ic("🧾") + " Generar recibo";
  pintarNumero(); tickReloj(); renderLineas();
}

function cargarEdicion(o) {
  editing = o; $("cliente").value = o.cliente || "";
  lineas = o.items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio, obs: i.obs || "" }));
  $("edNum").textContent = cod(o); $("bannerEdicion").hidden = false;
  $("btnGenerar").innerHTML = ic("💾") + " Guardar cambios";
  $("oFecha").textContent = fmtFecha(o.fecha); $("oHora").textContent = fmtHora(o.fecha);
  pintarNumero(); renderLineas(); irA("orden");
  anunciar("Editando la orden " + cod(o)); $("cliente").focus({ preventScroll: true });
}
$("btnCancelarEdicion").addEventListener("click", () => { if (confirm("¿Cancelar la edición? Se descartan los cambios.")) { resetOrden(); $("cliente").focus(); } });

// ---------------- Generar recibo ----------------
$("btnGenerar").addEventListener("click", () => {
  if (!lineas.length) return marcarError("selProducto", "Agrega al menos un producto a la orden.");
  if (lineas.some(l => !(Number(l.precio) > 0)) && !confirm("Hay productos con valor $0. ¿Generar el recibo así?")) return;
  const items = lineas.map(l => ({ nombre: l.nombre, cantidad: l.cantidad, precio: Number(l.precio) || 0, obs: l.obs.trim() }));
  const total = items.reduce((t, i) => t + i.cantidad * i.precio, 0), cliente = $("cliente").value.trim();
  let order;
  try {
    if (editing) {
      order = { ...editing, cliente, items, total, editada: new Date().toISOString(), editadaPor: Store.perfil.nombre };
      Store.guardarOrdenEditada(order);
    } else {
      const num = Store.numeroSiguiente();
      order = { num, codigo: Store.codigo(num), fecha: new Date().toISOString(), cliente, items, total,
        por: Store.perfil.nombre, emisor: { direccion: cfg.direccion, telefono: cfg.telefono, nit: cfg.nit, mensaje: cfg.mensaje } };
      order.id = Store.guardarOrdenNueva(order);
    }
    Receipts.build(order, cfg);        // comprueba que el PDF se arma bien
  } catch (err) { console.error(err); return toast("No se pudo guardar: " + err.message, true); }
  const era = !!editing; resetOrden();
  modalRecibo(order, era);
});

function modalRecibo(o, edit) {
  const sinNet = !navigator.onLine;
  abrirModal(`
    <h2 id="modalTitulo">${ic("✅")} ${edit ? "Orden actualizada" : "Recibo generado"}</h2>
    <div>Orden <b>N° ${esc(cod(o))}</b>${o.cliente ? " · " + esc(o.cliente) : ""}</div>
    <div class="big">${money(o.total)}</div>
    <div class="ayuda">${sinNet ? "Sin internet: queda guardada en este equipo y se enviará sola al reconectar." : "Guardada y compartida con tu equipo."}</div>
    <div class="grid">
      <button type="button" class="secundario" data-a="ver" aria-label="Ver PDF (se abre en una pestaña nueva)">${ic("👁")} Ver PDF ${ic("↗")}</button>
      <button type="button" class="secundario" data-a="imprimir">${ic("🖨")} Imprimir</button>
      <button type="button" class="secundario" data-a="compartir">${ic("📤")} Compartir</button>
      <button type="button" class="secundario" data-a="descargar">${ic("⬇")} Descargar</button>
      <button type="button" class="primario full" data-a="cerrar">Nueva orden</button>
    </div>`);
  $("modalCaja").onclick = e => {
    const a = e.target.closest("button")?.dataset.a; if (!a) return;
    if (a === "cerrar") cerrarModal(); else accionPdf(a, o);
  };
}

// =====================================================
// PDF: ver / imprimir / compartir / descargar
// (el PDF se arma al momento con los datos de la orden)
// =====================================================
const nombreArchivo = o => `Recibo-${cod(o)}${o.cliente ? "-" + norm(o.cliente).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) : ""}.pdf`;

async function accionPdf(a, o) {
  const blob = new Blob([Receipts.build(o, cfg).output("arraybuffer")], { type: "application/pdf" }), name = nombreArchivo(o);
  const url = URL.createObjectURL(blob);
  const descargar = () => { const l = document.createElement("a"); l.href = url; l.download = name; document.body.appendChild(l); l.click(); l.remove(); };
  const compartir = async () => {
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== "AbortError") descargar(); }
    } else { descargar(); toast("Este equipo no permite compartir directo: se descargó el PDF"); }
  };
  if (a === "descargar") descargar();
  else if (a === "compartir") await compartir();
  else if (a === "ver") { if (!window.open(url, "_blank")) descargar(); }
  else if (a === "imprimir") {
    if (esMovil()) { toast("Elige tu app de impresión en el menú"); await compartir(); }
    else {
      const f = document.createElement("iframe");
      f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, "_blank"); } };
      f.src = url; document.body.appendChild(f); setTimeout(() => f.remove(), 120000);
    }
  }
  setTimeout(() => URL.revokeObjectURL(url), 180000);
}

// =====================================================
// HISTORIAL
// =====================================================
function renderHistorial() {
  const q = norm($("hBuscar").value.trim()), fd = $("hFecha").value;
  if (fd) Store.ampliarHasta(fd);                       // si pide una fecha antigua, se cargan esos dias
  const lista = orders.filter(o => {
    if (fd && dayKey(o.fecha) !== fd) return false;
    if (!q) return true;
    return norm([cod(o), o.cliente || "", fmtFecha(o.fecha), o.por || ""].join(" ")).includes(q);
  }).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  const suma = lista.reduce((t, o) => t + o.total, 0);
  $("hResumen").textContent = lista.length ? `${lista.length} orden(es) · Suma: ${money(suma)}` : (orders.length ? "Ninguna orden coincide." : "");
  $("hLista").innerHTML = lista.length ? lista.slice(0, hLimite).map(o => `
    <div class="card" data-id="${esc(o.id)}">
      <div class="t"><b>N° ${esc(cod(o))} · ${o.cliente ? esc(o.cliente) : "<i>Sin cliente</i>"}</b><span class="m">${money(o.total)}</span></div>
      <div class="s">${fmtFecha(o.fecha)} · ${fmtHora(o.fecha)} · ${o.items.length} producto(s)${o.por ? " · " + esc(o.por) : ""}${o.editada ? " · editada" : ""}${o.pendiente ? `<span class="pend">${ic("⏳")} Pendiente de enviar</span>` : ""}</div>
      <div class="acc">
        <button type="button" data-a="ver" aria-label="Ver recibo ${esc(cod(o))} (se abre en una pestaña nueva)">${ic("👁")} Ver</button>
        <button type="button" data-a="imprimir" aria-label="Imprimir recibo ${esc(cod(o))}">${ic("🖨")} Imprimir</button>
        <button type="button" data-a="compartir" aria-label="Compartir recibo ${esc(cod(o))}">${ic("📤")} Compartir</button>
        <button type="button" data-a="editar" aria-label="Editar orden ${esc(cod(o))}">${ic("✏️")} Editar</button>
        <button type="button" class="peligro" data-a="eliminar" aria-label="Eliminar orden ${esc(cod(o))}">${ic("🗑")} Eliminar</button>
      </div>
    </div>`).join("") + (lista.length > hLimite ? `<button type="button" class="secundario ancho" id="btnVerMas">Mostrar más (${lista.length - hLimite})</button>` : "")
    : `<p class="vacio">${orders.length ? "No hay órdenes con ese filtro." : "Aún no hay órdenes en los últimos " + Store.state.dias + " días."}</p>`;
  $("hMas").hidden = false;
}
$("btnMasAntiguas").addEventListener("click", () => { Store.ampliarDias(90); toast("Cargando órdenes más antiguas…"); });
$("hBuscar").addEventListener("input", () => { hLimite = 100; renderHistorial(); });
$("hFecha").addEventListener("input", () => { hLimite = 100; renderHistorial(); });
$("hLimpiar").addEventListener("click", () => { $("hBuscar").value = ""; $("hFecha").value = ""; hLimite = 100; renderHistorial(); $("hBuscar").focus(); });
$("hLista").addEventListener("click", e => {
  if (e.target.id === "btnVerMas") { hLimite += 100; return renderHistorial(); }
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const o = orders.find(x => x.id === b.closest(".card").dataset.id); if (!o) return;
  if (b.dataset.a === "editar") cargarEdicion(o);
  else if (b.dataset.a === "eliminar") {
    if (!confirm(`¿Eliminar la orden N° ${cod(o)}? Se elimina para todo el equipo y no se puede deshacer.`)) return;
    Store.borrarOrden(o.id); toast("Orden eliminada"); $("hBuscar").focus();
  } else accionPdf(b.dataset.a, o);
});

// ---------------- Cierre del dia ----------------
let cierreAbierto = false;
function pintarCierre() {
  const d = $("cDia").value; if (!d) return;
  const cargando = Store.ampliarHasta(d);
  const os = orders.filter(o => dayKey(o.fecha) === d).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const t = os.reduce((s, o) => s + o.total, 0);
  $("cRes").innerHTML = `<div class="big">${money(t)}</div>
    <div class="ayuda">${os.length} pedido(s) · Promedio: ${money(os.length ? t / os.length : 0)}${cargando ? " · cargando…" : ""}</div>
    ${os.length ? `<table><caption class="sr">Órdenes del día</caption><thead><tr><th scope="col">Orden</th><th scope="col">Total</th></tr></thead><tbody>` + os.map(o => `<tr><td>N° ${esc(cod(o))} ${esc(o.cliente || "")}</td><td>${money(o.total)}</td></tr>`).join("") + "</tbody></table>" : ""}`;
}
$("btnCierre").addEventListener("click", () => {
  abrirModal(`<h2 id="modalTitulo">${ic("💰")} Cierre del día</h2>
    <label for="cDia">Fecha</label>
    <input type="date" id="cDia" value="${dayKey(new Date().toISOString())}">
    <div id="cRes" role="status" aria-live="polite"></div>
    <div class="grid"><button type="button" class="primario full" data-a="x">Cerrar</button></div>`);
  cierreAbierto = true; $("cDia").addEventListener("input", pintarCierre); pintarCierre();
  $("modalCaja").onclick = e => { if (e.target.closest("button")?.dataset.a === "x") cerrarModal(); };
});

// =====================================================
// PRODUCTOS
// =====================================================
function renderProductos() {
  $("pLista").innerHTML = products.length ? products.map(p => `
    <div class="card prod" data-id="${esc(p.id)}">
      <div><div class="n">${esc(p.nombre)}</div><div class="pr">${p.fijo ? "Precio fijo: " + money(p.precio) : "Sin precio fijo (lo escribes en cada orden)"}</div></div>
      <button type="button" class="peligro" data-a="del" aria-label="Quitar ${esc(p.nombre)} de la lista">${ic("🗑")} Quitar</button>
    </div>`).join("") : `<p class="vacio">La lista está vacía.</p>`;
}
function alternarPrecioFijo() {
  const f = $("pFijo").checked; $("pPrecioWrap").hidden = !f; $("pAyudaPrecio").hidden = f;
  if (f) $("pPrecio").focus();
}
$("pFijo").addEventListener("change", alternarPrecioFijo);
$("btnNuevoProducto").addEventListener("click", () => {
  const nombre = $("pNombre").value.trim(), fijo = $("pFijo").checked, precio = Math.max(0, Number($("pPrecio").value) || 0);
  if (!nombre) return marcarError("pNombre", "Escribe el nombre del producto.");
  if (fijo && !precio) return marcarError("pPrecio", "Escribe el precio fijo o desmarca la casilla.");
  if (products.some(p => norm(p.nombre) === norm(nombre))) return marcarError("pNombre", "Ese producto ya está en la lista.");
  Store.agregarProducto({ nombre, precio: fijo ? precio : 0, fijo });
  $("pNombre").value = ""; $("pPrecio").value = ""; $("pFijo").checked = false; alternarPrecioFijo(); toast("Producto añadido");
});
$("pLista").addEventListener("click", e => {
  const b = e.target.closest("button[data-a]"); if (!b || b.dataset.a !== "del") return;
  const p = products.find(x => x.id === b.closest(".card").dataset.id); if (!p) return;
  if (!confirm(`¿Quitar "${p.nombre}" de la lista? Las órdenes ya hechas no cambian.`)) return;
  Store.quitarProducto(p.id); anunciar(p.nombre + " quitado de la lista"); $("pNombre").focus();
});

// =====================================================
// AJUSTES: cuenta, recibo, usuarios, respaldo
// =====================================================
function renderAjustes() {
  const p = Store.perfil; if (!p) return;
  $("miCuenta").innerHTML = `<div class="n">${esc(p.nombre)}${Store.esDuena() ? '<span class="chip">Dueña</span>' : ""}</div>
    <div class="s">${esc(p.email)}</div>`;
  if (document.activeElement.closest && !document.activeElement.closest("#v-ajustes")) {
    $("aDir").value = cfg.direccion; $("aTel").value = cfg.telefono; $("aNit").value = cfg.nit; $("aMsg").value = cfg.mensaje;
  }
  $("seccionUsuarios").hidden = $("seccionRespaldo").hidden = !Store.esDuena();
  if (Store.esDuena()) renderUsuarios();
  $("infoAlmacen").textContent = `Se muestran las órdenes de los últimos ${Store.state.dias} días (${orders.length} cargadas).`;
}
function llenarCamposRecibo() { $("aDir").value = cfg.direccion; $("aTel").value = cfg.telefono; $("aNit").value = cfg.nit; $("aMsg").value = cfg.mensaje; }

$("btnGuardarAjustes").addEventListener("click", () => {
  Store.guardarConfig({ direccion: $("aDir").value.trim(), telefono: $("aTel").value.trim(), nit: $("aNit").value.trim(), mensaje: $("aMsg").value.trim() });
  toast("Datos guardados. Valen para los recibos nuevos.");
});
$("btnSalir").addEventListener("click", () => {
  if (Store.state.pendientes && !confirm("Hay órdenes que aún no se han enviado (sin internet). Si cierras sesión ahora se perderán.\n\n¿Cerrar sesión de todos modos?")) return;
  if (!Store.state.pendientes && !confirm("¿Cerrar sesión en este equipo?")) return;
  Store.salir();
});

// ---------------- Usuarios (dueña) ----------------
function renderUsuarios() {
  const us = [...Store.state.usuarios].sort((a, b) => (a.rol === "admin" ? -1 : b.rol === "admin" ? 1 : (a.nombre || "").localeCompare(b.nombre || "", "es")));
  $("uLista").innerHTML = us.map(u => {
    const yo = u.email === Store.perfil.email;
    return `<div class="card" data-email="${esc(u.email)}">
      <div class="t"><b>${esc(u.nombre || u.email)}${yo ? '<span class="chip">Tú</span>' : ""}${u.activo === false ? '<span class="chip off">Desactivado</span>' : ""}</b></div>
      <div class="s">${esc(u.email)}</div>
      ${yo ? "" : `<div class="acc"><button type="button" data-a="toggle" aria-label="${u.activo === false ? "Activar" : "Desactivar"} a ${esc(u.nombre || u.email)}">${u.activo === false ? ic("✅") + " Activar" : ic("⏸") + " Desactivar"}</button><button type="button" class="peligro" data-a="quitar" aria-label="Quitar el acceso de ${esc(u.nombre || u.email)}">${ic("🗑")} Quitar</button></div>`}
    </div>`;
  }).join("") || `<p class="vacio">Aún no hay personas autorizadas.</p>`;
}
$("uLista").addEventListener("click", async e => {
  const bt = e.target.closest("button[data-a]"); if (!bt) return; const a = bt.dataset.a;
  const email = bt.closest(".card").dataset.email, u = Store.state.usuarios.find(x => x.email === email);
  if (a === "toggle") { await Store.guardarUsuario(email, { activo: u.activo === false }); }
  else if (a === "quitar" && confirm(`¿Quitar el acceso de ${u.nombre || email}? Sus órdenes anteriores se conservan.`)) await Store.quitarUsuario(email);
});
$("btnAgregarUsuario").addEventListener("click", async () => {
  const email = $("uEmail").value.trim().toLowerCase(), nombre = $("uNombre").value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return marcarError("uEmail", "Escribe un correo válido, por ejemplo nombre@gmail.com.");
  if (!nombre) return marcarError("uNombre", "Escribe el nombre de la persona.");
  if (Store.state.usuarios.some(u => u.email === email)) return marcarError("uEmail", "Ese correo ya está en la lista.");
  await Store.guardarUsuario(email, { nombre, activo: true, rol: "empleado" });
  $("uEmail").value = ""; $("uNombre").value = "";
  toast("Listo. Ya puede entrar con ese correo de Gmail.");
});

// ---------------- Respaldo / importar ----------------
$("btnRespaldo").addEventListener("click", async () => {
  toast("Preparando respaldo…");
  try {
    const data = { app: "BJL", version: 3, exportado: new Date().toISOString(), config: cfg,
      products: products.map(p => ({ nombre: p.nombre, precio: p.precio, fijo: p.fijo })), orders: await Store.todasLasOrdenes() };
    const l = document.createElement("a");
    l.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    l.download = `BJL_respaldo_${dayKey(new Date().toISOString())}.json`; document.body.appendChild(l); l.click(); l.remove();
    toast("Respaldo descargado");
  } catch (e) { toast("No se pudo crear el respaldo: " + Store.traducir(e), true); }
});
$("btnRestaurar").addEventListener("click", () => $("archivoRestaurar").click());

function convertirViejo(d) {        // respaldos de versiones anteriores (local o con Firebase propio)
  const hora = h => { let hh = 0, mi = 0; const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?/i.exec(h || ""); if (m) { hh = +m[1]; mi = +m[2]; if (m[3]) { const pm = m[3].toLowerCase() === "p"; if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; } } return [hh, mi]; };
  const desdePedido = (p, i) => {
    const [dd, mm, yy] = String(p.fecha || "").split("/").map(Number), [h, mi] = hora(p.hora), n = Number(p.numero) || i + 1;
    return { num: n, codigo: Receipts.numStr(n), fecha: new Date(yy || 2000, (mm || 1) - 1, dd || 1, h, mi).toISOString(), cliente: p.cliente || "", nota: p.observaciones || "", total: Number(p.total) || 0,
      items: (p.productos || []).map(x => ({ nombre: String(x.nombre), cantidad: Number(x.cantidad) || 1, precio: Number(x.precio) || 0, obs: "" })) };
  };
  return { orders: (d.pedidos || []).map(desdePedido), products: d.productos || [] };
}
function normalizarOrden(o) {
  const num = Number.isFinite(o.num) ? o.num : Number(o.id) || 0;
  return { ...o, id: undefined, num, codigo: o.codigo || Receipts.numStr(o.id ?? num) };
}
$("archivoRestaurar").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    let r = Array.isArray(d.orders) ? { orders: d.orders.map(normalizarOrden), products: d.products || [] } : convertirViejo(d);
    r.orders = r.orders.filter(o => Array.isArray(o.items) && o.fecha && !isNaN(new Date(o.fecha)));
    const ya = new Set(orders.map(o => cod(o) + "|" + o.fecha));
    const nuevas = r.orders.filter(o => !ya.has(cod(o) + "|" + o.fecha));
    const nombres = new Set(products.map(p => norm(p.nombre)));
    const prods = r.products.filter(p => p.nombre && !nombres.has(norm(p.nombre))).map(p => ({ nombre: String(p.nombre), precio: Number(p.precio) || 0, fijo: p.fijo ?? Number(p.precio) > 0 }));
    if (!nuevas.length && !prods.length) return alert("No hay nada nuevo para importar: todo ya está en el sistema.");
    if (!confirm(`Se agregarán ${nuevas.length} orden(es) y ${prods.length} producto(s) nuevos.\nNo se borra nada de lo que ya existe. ¿Continuar?`)) return;
    toast("Importando…"); await Store.importar({ orders: nuevas, products: prods }); toast("Importación completa ✅");
  } catch (err) { console.error(err); alert("No se pudo importar: " + (err.message || "archivo no válido")); }
});

// =====================================================
// ACCESO (inicio de sesion)
// =====================================================
let authUltimo = "";
function pantallaAuth(html) {
  $("pantallaAuth").hidden = !html; actualizarInert();
  if (!html) { authUltimo = ""; return; }
  $("authContenido").innerHTML = html;
  if (html !== authUltimo) { authUltimo = html; $("authTitulo").focus(); }   // al cambiar de pantalla, el lector lee el nuevo contenido
}
const salirBtn = '<button type="button" class="enlace" data-auth="salir">Cerrar sesión</button>';

function dibujarAcceso(est) {
  const e = est.estado;
  if (e === "listo") return pantallaAuth(null);
  if (e === "sin-config") return pantallaAuth(`<p><b>Falta configurar la conexión.</b></p><p class="ayuda">La dueña debe completar el archivo <code>firebase-config.js</code> siguiendo la guía de configuración y volver a subirlo.</p>`);
  if (e === "sin-sesion") return pantallaAuth(`
    <button type="button" class="btnGoogle" data-auth="google">
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Continuar con Google
    </button>
    <div class="error" id="authError" role="alert"></div>
    <p class="ayuda">Elige tu cuenta de Gmail. Solo entran la dueña y las personas que ella autorizó. Necesitas internet para entrar la primera vez.</p>
    <button type="button" class="enlace" data-auth="otro" aria-expanded="false" aria-controls="formCorreo">Usar correo y contraseña</button>
    <div id="formCorreo" hidden>
      <form id="formAuth" autocomplete="on" data-modo="entrar">
        <label for="authMail">Correo</label>
        <input id="authMail" type="email" inputmode="email" autocomplete="username" required>
        <label for="authPass">Contraseña <span class="opc" id="authPassAyuda">(mínimo 6 caracteres)</span></label>
        <input id="authPass" type="password" autocomplete="current-password" minlength="6" required aria-describedby="authPassAyuda">
        <label class="check"><input type="checkbox" id="verPass" data-auth="verpass"> Mostrar contraseña</label>
        <div class="fila"><button class="primario" type="submit" id="authEnviar" data-auth="entrar">Entrar</button><button class="secundario" type="button" id="authModo" data-auth="modo">Crear una cuenta nueva</button></div>
      </form>
      <button type="button" class="enlace" data-auth="olvide">Olvidé mi contraseña</button>
    </div>`);
  if (e === "verificar") return pantallaAuth(`
    <p><b>Confirma tu correo</b></p>
    <p class="ayuda">Te enviamos un mensaje a <b>${esc(est.email)}</b>. Abre el enlace que trae (revisa también «spam») y luego toca el botón.</p>
    <div class="error" id="authError" role="alert"></div>
    <div class="fila"><button type="button" class="primario" data-auth="confirmado">Ya confirmé</button><button type="button" class="secundario" data-auth="reenviar">Reenviar correo</button></div>${salirBtn}`);
  if (e === "no-autorizada") return pantallaAuth(`
    <p><b>Tu correo no está autorizado</b></p>
    <p class="ayuda">${esc(est.email || "")} no está en la lista de personas autorizadas. Pídele a la dueña que te agregue en <i>Ajustes → Usuarios autorizados</i> y toca «Reintentar».</p>
    <div class="fila"><button type="button" class="primario" data-auth="reintentar">Reintentar</button></div>${salirBtn}`);
  if (e === "desactivada") return pantallaAuth(`<p><b>Acceso desactivado</b></p><p class="ayuda">La dueña desactivó tu acceso. Si crees que es un error, habla con ella.</p>${salirBtn}`);
  if (e === "sin-conexion") return pantallaAuth(`<p><b>Sin conexión</b></p><p class="ayuda">Para entrar por primera vez en este equipo necesitas internet. Conéctate y toca «Reintentar».</p><div class="fila"><button type="button" class="primario" data-auth="recargar">Reintentar</button></div>${salirBtn}`);
  pantallaAuth(`<p><b>No se pudo conectar</b></p><p class="ayuda">${esc(est.mensaje || "Error desconocido")}</p><div class="fila"><button type="button" class="primario" data-auth="recargar">Reintentar</button></div>${salirBtn}`);
}

async function accionAuth(a) {
  const err = $("authError"), mostrar = m => {
    if (err) err.textContent = m;
    ["authMail", "authPass"].forEach(id => { const el = $(id); if (!el) return; if (m) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "authError"); } else el.removeAttribute("aria-invalid"); });
  };
  try {
    if (a === "google") { mostrar(""); await Store.entrarGoogle(); }
    else if (a === "otro") { $("formCorreo").hidden = false; document.querySelector('[data-auth="otro"]').setAttribute("aria-expanded", "true"); $("authMail").focus(); }
    else if (a === "modo") {
      const f = $("formAuth"), crear = f.dataset.modo !== "crear"; f.dataset.modo = crear ? "crear" : "entrar";
      $("authPass").autocomplete = crear ? "new-password" : "current-password";
      $("authEnviar").textContent = crear ? "Crear cuenta" : "Entrar"; $("authModo").textContent = crear ? "Ya tengo cuenta" : "Crear una cuenta nueva";
      mostrar(""); anunciar(crear ? "Modo crear cuenta" : "Modo entrar");
    }
    else if (a === "entrar" || a === "crear") {
      const m = $("authMail").value, p = $("authPass").value;
      if (!m || !p) { mostrar("Escribe tu correo y contraseña."); return ($(!m ? "authMail" : "authPass")).focus(); }
      mostrar(""); a === "entrar" ? await Store.entrar(m, p) : await Store.registrar(m, p);
    } else if (a === "olvide") {
      const m = ($("authMail") || {}).value; if (!m) { mostrar("Escribe primero tu correo."); return $("authMail").focus(); }
      await Store.recuperar(m); toast("Te enviamos un correo para cambiar la contraseña");
    } else if (a === "confirmado") { mostrar(""); await Store.yaConfirme(); }
    else if (a === "reenviar") { await Store.reenviarVerificacion(); toast("Correo reenviado"); }
    else if (a === "reintentar" || a === "recargar") location.reload();
    else if (a === "salir") await Store.salir();
  } catch (e) { mostrar(e.code === "no-verificado" ? "Aún no aparece confirmado. Abre el enlace del correo y vuelve a intentar." : Store.traducir(e)); }
}
$("authContenido").addEventListener("click", e => {
  const el = e.target.closest("[data-auth]"); const a = el && el.dataset.auth;
  if (a === "verpass") { $("authPass").type = el.checked ? "text" : "password"; return; }
  if (a && a !== "entrar") { e.preventDefault(); accionAuth(a); }
});
$("authContenido").addEventListener("submit", e => { e.preventDefault(); accionAuth($("formAuth").dataset.modo === "crear" ? "crear" : "entrar"); });

// =====================================================
// ARRANQUE
// =====================================================
function alCambiarDatos() {
  const s = Store.state;
  cfg = { ...s.cfg }; products = s.products; orders = s.orders;
  renderSelector(); pintarNumero(); pintarSync();
  if (vistaActual === "historial") renderHistorial();
  if (vistaActual === "productos") renderProductos();
  if (vistaActual === "ajustes") { renderAjustes(); }
  if (cierreAbierto && $("cDia")) pintarCierre();
}
let datosCargadosUnaVez = false;
Store.on(() => { if (Store.perfil) { alCambiarDatos(); if (!datosCargadosUnaVez) { datosCargadosUnaVez = true; llenarCamposRecibo(); } } });

tickReloj(); setInterval(tickReloj, 1000);
actualizarInert(); renderLineas(); pintarSync();
Store.init(est => { dibujarAcceso(est); if (est.estado === "listo") { alCambiarDatos(); llenarCamposRecibo(); irA(vistaActual); } }, msg => toast(msg, true));
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("service-worker.js").catch(() => { });
