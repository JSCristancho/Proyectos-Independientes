// =====================================================
// BJL Bordados - Sistema de gestion local (sin internet)
// =====================================================

const DEFAULTS = {
  nombre: "Juana Leyton", slogan: "del hilo al corazón", direccion: "CRA 34B # 50-163", telefono: "300 2503560", nit: "63524107",
  mensaje: "¡Gracias por confiar en nosotros!",
};
const SEED_PRODUCTS = [
  ["Bordado Pecho", 18000], ["Bordado Espalda", 30000], ["Bordado Manga", 12000], ["Gorra", 15000],
  ["Camisa Polo", 35000], ["Chaqueta", 45000], ["Sudadera", 55000],
];

let cfg = { ...DEFAULTS };
let products = [];
let orders = [];
let lineas = [];          // lineas de la orden en curso
let editing = null;       // orden que se esta editando (o null)
let nextNum = 1;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const { money, fmtFecha, fmtHora, numStr } = Receipts;
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dayKey = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const esMovil = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600);
}
function abrirModal(html) { $("modalCaja").innerHTML = html; $("modal").hidden = false; }
function cerrarModal() { $("modal").hidden = true; $("modalCaja").innerHTML = ""; }
$("modal").addEventListener("click", e => { if (e.target === $("modal")) cerrarModal(); });

// ---------------- Reloj ----------------
function tickReloj() {
  const now = new Date().toISOString();
  $("hdrFecha").textContent = fmtFecha(now); $("hdrHora").textContent = fmtHora(now);
  if (!editing) { $("oFecha").textContent = fmtFecha(now); $("oHora").textContent = fmtHora(now); }
}

// ---------------- Navegacion ----------------
function irA(v) {
  document.querySelectorAll(".vista").forEach(s => s.classList.toggle("activa", s.id === "v-" + v));
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("activa", b.dataset.vista === v));
  $("barraTotal").classList.toggle("visible", v === "orden");
  document.body.classList.toggle("conTotal", v === "orden");
  if (v === "historial") renderHistorial();
  if (v === "productos") renderProductos();
  if (v === "ajustes") renderAjustes();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => irA(b.dataset.vista)));

// =====================================================
// ORDEN
// =====================================================
function totalOrden() { return lineas.reduce((t, l) => t + l.cantidad * (Number(l.precio) || 0), 0); }

function pintarTotal() { $("total").textContent = money(totalOrden()); }

function pintarNumero() { $("oNumero").textContent = numStr(editing ? editing.id : nextNum); }

function renderSelector() {
  const sel = $("selProducto");
  sel.innerHTML = products.map(p => `<option value="${p.id}">${esc(p.nombre)}${p.fijo ? " — " + money(p.precio) : ""}</option>`).join("");
  $("ayudaVacio").hidden = products.length > 0;
  $("btnAgregar").disabled = products.length === 0;
  sel.disabled = products.length === 0;
}

function renderLineas() {
  $("sinLineas").hidden = lineas.length > 0;
  $("lineas").innerHTML = lineas.map((l, i) => `
    <div class="linea" data-i="${i}">
      <div class="cab"><b>${esc(l.nombre)}</b><button class="quitar" data-act="quitar" aria-label="Quitar">✕</button></div>
      <div class="campos">
        <div><label>Cantidad</label>
          <div class="cant">
            <button data-act="menos" aria-label="Menos">−</button>
            <input type="number" inputmode="numeric" min="1" step="1" data-f="cantidad" value="${l.cantidad}">
            <button data-act="mas" aria-label="Más">＋</button>
          </div></div>
        <div><label>Valor unitario ($)</label>
          <input type="number" inputmode="numeric" min="0" data-f="precio" placeholder="0" value="${l.precio === "" ? "" : l.precio}"></div>
      </div>
      <textarea rows="2" data-f="obs" placeholder="Observaciones de este producto (opcional)">${esc(l.obs)}</textarea>
      <div class="sub">Subtotal: <b data-sub>${money(l.cantidad * (Number(l.precio) || 0))}</b></div>
    </div>`).join("");
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
  if (a === "quitar") { lineas.splice(i, 1); renderLineas(); }
  else {
    lineas[i].cantidad = Math.max(1, lineas[i].cantidad + (a === "mas" ? 1 : -1));
    b.closest(".cant").querySelector("input").value = lineas[i].cantidad; actualizarSub(i);
  }
});

$("btnAgregar").addEventListener("click", () => {
  const p = products.find(x => x.id === Number($("selProducto").value)); if (!p) return;
  lineas.push({ nombre: p.nombre, cantidad: 1, precio: p.fijo ? p.precio : "", obs: "" });
  renderLineas();
  const card = $("lineas").lastElementChild;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  if (!p.fijo) card.querySelector('[data-f="precio"]').focus({ preventScroll: true });
});

function resetOrden() {
  lineas = []; editing = null; $("cliente").value = "";
  $("bannerEdicion").hidden = true; $("btnGenerar").textContent = "🧾 Generar recibo";
  pintarNumero(); tickReloj(); renderLineas();
}

function cargarEdicion(o) {
  editing = o; $("cliente").value = o.cliente || "";
  lineas = o.items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio, obs: i.obs || "" }));
  $("edNum").textContent = numStr(o.id); $("bannerEdicion").hidden = false;
  $("btnGenerar").textContent = "💾 Guardar cambios";
  $("oFecha").textContent = fmtFecha(o.fecha); $("oHora").textContent = fmtHora(o.fecha);
  pintarNumero(); renderLineas(); irA("orden");
}
$("btnCancelarEdicion").addEventListener("click", () => { if (confirm("¿Cancelar la edición? Se descartan los cambios.")) resetOrden(); });

// ---------------- Generar recibo ----------------
$("btnGenerar").addEventListener("click", async () => {
  if (!lineas.length) return toast("Agrega al menos un producto");
  if (lineas.some(l => !(Number(l.precio) > 0)) && !confirm("Hay productos con valor $0. ¿Generar el recibo así?")) return;
  const items = lineas.map(l => ({ nombre: l.nombre, cantidad: l.cantidad, precio: Number(l.precio) || 0, obs: l.obs.trim() }));
  const order = {
    ...(editing || {}),
    id: editing ? editing.id : nextNum,
    fecha: editing ? editing.fecha : new Date().toISOString(),
    cliente: $("cliente").value.trim(), items,
    total: items.reduce((t, i) => t + i.cantidad * i.precio, 0),
  };
  if (editing) order.editada = new Date().toISOString();
  try {
    const ab = Receipts.build(order, cfg).output("arraybuffer");
    if (editing) await DB.saveEdit(order, ab); else await DB.saveNew(order, ab);
  } catch (err) { console.error(err); return toast("No se pudo guardar: " + err.message); }
  await recargar();
  const era = !!editing; resetOrden();
  modalRecibo(order, era);
});

function modalRecibo(o, edit) {
  abrirModal(`
    <h3>${edit ? "✅ Orden actualizada" : "✅ Recibo generado"}</h3>
    <div>Orden <b>N° ${numStr(o.id)}</b>${o.cliente ? " · " + esc(o.cliente) : ""}</div>
    <div class="big">${money(o.total)}</div>
    <div class="ayuda">Guardado en el historial de este equipo.</div>
    <div class="grid">
      <button class="secundario" data-a="ver">👁 Ver PDF</button>
      <button class="secundario" data-a="imprimir">🖨 Imprimir</button>
      <button class="secundario" data-a="compartir">📤 Compartir</button>
      <button class="secundario" data-a="descargar">⬇ Descargar</button>
      <button class="primario full" data-a="cerrar">Nueva orden</button>
    </div>`);
  $("modalCaja").onclick = e => {
    const a = e.target.closest("button")?.dataset.a; if (!a) return;
    if (a === "cerrar") { cerrarModal(); $("modalCaja").onclick = null; } else accionPdf(a, o);
  };
}

// =====================================================
// PDF: ver / imprimir / compartir / descargar
// =====================================================
async function getPdf(o) {
  const r = await DB.get("pdfs", o.id); if (r) return r.data;
  const ab = Receipts.build(o, cfg).output("arraybuffer");   // se regenera si falta
  await DB.savePdf(o.id, ab); return ab;
}
const nombreArchivo = o => `Recibo-${numStr(o.id)}${o.cliente ? "-" + norm(o.cliente).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) : ""}.pdf`;

async function accionPdf(a, o) {
  const ab = await getPdf(o), blob = new Blob([ab], { type: "application/pdf" }), name = nombreArchivo(o);
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
  const lista = orders.filter(o => {
    if (fd && dayKey(o.fecha) !== fd) return false;
    if (!q) return true;
    return norm([numStr(o.id), o.cliente || "", fmtFecha(o.fecha)].join(" ")).includes(q);
  }).sort((a, b) => b.id - a.id);
  const suma = lista.reduce((t, o) => t + o.total, 0);
  $("hResumen").textContent = lista.length ? `${lista.length} orden(es) · Suma: ${money(suma)}` : "";
  $("hLista").innerHTML = lista.length ? lista.map(o => `
    <div class="card" data-id="${o.id}">
      <div class="t"><b>N° ${numStr(o.id)} · ${o.cliente ? esc(o.cliente) : "<i>Sin cliente</i>"}</b><span class="m">${money(o.total)}</span></div>
      <div class="s">${fmtFecha(o.fecha)} · ${fmtHora(o.fecha)} · ${o.items.length} producto(s)${o.editada ? " · editada" : ""}</div>
      <div class="acc">
        <button data-a="ver">👁 Ver</button><button data-a="imprimir">🖨</button><button data-a="compartir">📤</button>
        <button data-a="editar">✏️ Editar</button><button class="peligro" data-a="eliminar">🗑</button>
      </div>
    </div>`).join("") : `<p class="vacio">${orders.length ? "No hay órdenes con ese filtro." : "Aún no hay órdenes guardadas."}</p>`;
}
$("hBuscar").addEventListener("input", renderHistorial);
$("hFecha").addEventListener("input", renderHistorial);
$("hLimpiar").addEventListener("click", () => { $("hBuscar").value = ""; $("hFecha").value = ""; renderHistorial(); });
$("hLista").addEventListener("click", async e => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const o = orders.find(x => x.id === +b.closest(".card").dataset.id); if (!o) return;
  if (b.dataset.a === "editar") cargarEdicion(o);
  else if (b.dataset.a === "eliminar") {
    if (!confirm(`¿Eliminar la orden N° ${numStr(o.id)}? No se puede deshacer.`)) return;
    await DB.removeOrder(o.id); await recargar(); renderHistorial(); toast("Orden eliminada");
  } else accionPdf(b.dataset.a, o);
});

// ---------------- Cierre del dia ----------------
$("btnCierre").addEventListener("click", () => {
  abrirModal(`<h3>💰 Cierre del día</h3>
    <input type="date" id="cDia" value="${dayKey(new Date().toISOString())}">
    <div id="cRes"></div>
    <div class="grid"><button class="primario full" data-a="x">Cerrar</button></div>`);
  const pintar = () => {
    const d = $("cDia").value, os = orders.filter(o => dayKey(o.fecha) === d).sort((a, b) => a.id - b.id);
    const t = os.reduce((s, o) => s + o.total, 0);
    $("cRes").innerHTML = `<div class="big">${money(t)}</div>
      <div class="ayuda">${os.length} pedido(s) · Promedio: ${money(os.length ? t / os.length : 0)}</div>
      ${os.length ? "<table>" + os.map(o => `<tr><td>N° ${numStr(o.id)} ${esc(o.cliente || "")}</td><td>${money(o.total)}</td></tr>`).join("") + "</table>" : ""}`;
  };
  $("cDia").addEventListener("input", pintar); pintar();
  $("modalCaja").onclick = e => { if (e.target.dataset.a === "x") { cerrarModal(); $("modalCaja").onclick = null; } };
});

// =====================================================
// PRODUCTOS
// =====================================================
function renderProductos() {
  $("pLista").innerHTML = products.length ? products.map(p => `
    <div class="card prod" data-id="${p.id}">
      <div><div class="n">${esc(p.nombre)}</div><div class="pr">${p.fijo ? "Precio fijo: " + money(p.precio) : "Sin precio fijo (lo escribes en cada orden)"}</div></div>
      <button class="peligro" data-a="del">🗑 Quitar</button>
    </div>`).join("") : `<p class="vacio">La lista está vacía.</p>`;
}
function alternarPrecioFijo() {
  const f = $("pFijo").checked; $("pPrecioWrap").hidden = !f; $("pAyudaPrecio").hidden = f;
  if (f) $("pPrecio").focus();
}
$("pFijo").addEventListener("change", alternarPrecioFijo);
$("btnNuevoProducto").addEventListener("click", async () => {
  const nombre = $("pNombre").value.trim(), fijo = $("pFijo").checked, precio = Math.max(0, Number($("pPrecio").value) || 0);
  if (!nombre) return toast("Escribe el nombre del producto");
  if (fijo && !precio) return toast("Escribe el precio fijo o desmarca la casilla");
  if (products.some(p => norm(p.nombre) === norm(nombre))) return toast("Ese producto ya está en la lista");
  await DB.addProduct(nombre, precio, fijo); $("pNombre").value = ""; $("pPrecio").value = ""; $("pFijo").checked = false; alternarPrecioFijo();
  await recargar(); renderProductos(); toast("Producto añadido");
});
$("pLista").addEventListener("click", async e => {
  if (e.target.dataset.a !== "del") return;
  const p = products.find(x => x.id === +e.target.closest(".card").dataset.id);
  if (!confirm(`¿Quitar "${p.nombre}" de la lista? Las órdenes ya hechas no cambian.`)) return;
  await DB.removeProduct(p.id); await recargar(); renderProductos();
});

// =====================================================
// AJUSTES
// =====================================================
function renderAjustes() {
  $("aDir").value = cfg.direccion;
  $("aTel").value = cfg.telefono; $("aNit").value = cfg.nit; $("aMsg").value = cfg.mensaje;
  $("infoAlmacen").textContent = `${orders.length} orden(es) guardada(s) en este equipo.`;
}
$("btnGuardarAjustes").addEventListener("click", async () => {
  cfg = { ...cfg, direccion: $("aDir").value.trim(),
    telefono: $("aTel").value.trim(), nit: $("aNit").value.trim(), mensaje: $("aMsg").value.trim() };
  await DB.setMeta("settings", cfg); toast("Ajustes guardados");
});

// ---------------- Respaldo / restaurar ----------------
$("btnRespaldo").addEventListener("click", () => {
  const data = { app: "BJL", version: 2, exportado: new Date().toISOString(), counter: nextNum, settings: cfg,
    products: products.map(p => ({ nombre: p.nombre, precio: p.precio, fijo: p.fijo })), orders };
  const l = document.createElement("a");
  l.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  l.download = `BJL_respaldo_${dayKey(new Date().toISOString())}.json`; document.body.appendChild(l); l.click(); l.remove();
  toast("Respaldo descargado");
});
$("btnRestaurar").addEventListener("click", () => $("archivoRestaurar").click());

function convertirViejo(d) {        // respaldo de la version anterior (localStorage)
  const os = (d.pedidos || []).map((p, i) => {
    const [dd, mm, yy] = String(p.fecha || "").split("/").map(Number);
    let h = 0, mi = 0; const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?/i.exec(p.hora || "");
    if (m) { h = +m[1]; mi = +m[2]; if (m[3]) { const pm = m[3].toLowerCase() === "p"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; } }
    return { id: Number(p.numero) || i + 1, fecha: new Date(yy || 2000, (mm || 1) - 1, dd || 1, h, mi).toISOString(),
      cliente: p.cliente || "", nota: p.observaciones || "", total: Number(p.total) || 0,
      items: (p.productos || []).map(x => ({ nombre: String(x.nombre), cantidad: Number(x.cantidad) || 1, precio: Number(x.precio) || 0, obs: "" })) };
  });
  return { orders: os, products: d.productos || [], counter: Number(d.numeroRecibo) || 1, settings: null };
}
$("archivoRestaurar").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const r = Array.isArray(d.orders) ? { orders: d.orders, products: d.products || [], counter: Number(d.counter) || 1, settings: d.settings || null } : convertirViejo(d);
    r.orders = r.orders.filter(o => Number.isInteger(o.id) && Array.isArray(o.items) && o.fecha && !isNaN(new Date(o.fecha)));
    r.counter = Math.max(r.counter, ...r.orders.map(o => o.id + 1), 1);
    if (!confirm(`Se restaurarán ${r.orders.length} orden(es) y ${r.products.length} producto(s).\nEsto REEMPLAZA los datos actuales. ¿Continuar?`)) return;
    await DB.replaceAll(r);
    if (r.settings) cfg = { ...DEFAULTS, ...r.settings };
    await recargar(); resetOrden(); renderAjustes(); toast("Respaldo restaurado ✅");
  } catch (err) { console.error(err); alert("No se pudo leer el archivo de respaldo."); }
});

// =====================================================
// ARRANQUE
// =====================================================
async function recargar() {
  products = (await DB.getAll("products")).sort((a, b) => a.id - b.id).map(p => ({ ...p, fijo: p.fijo ?? p.precio > 0 }));
  orders = await DB.getAll("orders");
  nextNum = await DB.nextNumber();
  renderSelector(); pintarNumero();
}

(async function iniciar() {
  try {
    await DB.open();
    cfg = { ...DEFAULTS, ...(await DB.getMeta("settings", {})) };
    if (!(await DB.getMeta("migr2", false))) {   // v2: datos oficiales del recibo
      cfg = { ...cfg, direccion: DEFAULTS.direccion, telefono: DEFAULTS.telefono, nit: DEFAULTS.nit };
      await DB.setMeta("settings", cfg); await DB.setMeta("migr2", true);
    }
    if (!(await DB.getMeta("seeded", false))) {
      for (const [n, p] of SEED_PRODUCTS) await DB.addProduct(n, p, true);
      await DB.setMeta("seeded", true);
    }
    await recargar();
    if (navigator.storage?.persist) navigator.storage.persist();   // evita que el navegador borre los datos
  } catch (err) {
    console.error(err);
    document.querySelector("main").innerHTML = `<p class="vacio">No se pudo abrir el almacenamiento local.<br>Si estás en modo privado, abre la app en una ventana normal.</p>`;
    return;
  }
  tickReloj(); setInterval(tickReloj, 1000);
  renderLineas(); irA("orden");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("service-worker.js").catch(() => { });
})();
