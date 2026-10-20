// =====================================================
// BJL - Almacenamiento local (IndexedDB). Todo queda en el equipo.
// Almacenes: orders (pedidos), pdfs (recibos), products, meta (ajustes y contador)
// =====================================================

const DB = (() => {
  let db;

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("bjl-local", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("orders", { keyPath: "id" });
        d.createObjectStore("pdfs", { keyPath: "id" });
        d.createObjectStore("products", { keyPath: "id", autoIncrement: true });
        d.createObjectStore("meta", { keyPath: "k" });
      };
      r.onsuccess = () => { db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  }

  // Ejecuta fn(stores) dentro de una transaccion; resuelve al completarla
  function run(names, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(names, mode);
      const s = {}; names.forEach(n => s[n] = t.objectStore(n));
      let out; const pending = fn(s);
      if (pending && pending.onsuccess !== undefined) pending.onsuccess = () => out = pending.result;
      t.oncomplete = () => res(out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }

  const getAll = store => run([store], "readonly", s => s[store].getAll());
  const get = (store, key) => run([store], "readonly", s => s[store].get(key));

  async function getMeta(k, def) { const r = await get("meta", k); return r ? r.v : def; }
  const setMeta = (k, v) => run(["meta"], "readwrite", s => s.meta.put({ k, v }));

  async function nextNumber() {
    const c = await getMeta("counter", 1);
    const orders = await getAll("orders");
    const max = orders.reduce((m, o) => Math.max(m, o.id), 0);
    return Math.max(c, max + 1);
  }

  // Guarda un pedido nuevo + su PDF + avanza el contador, todo en una sola transaccion
  function saveNew(order, pdf) {
    return run(["orders", "pdfs", "meta"], "readwrite", s => {
      s.orders.put(order); s.pdfs.put({ id: order.id, data: pdf });
      s.meta.put({ k: "counter", v: order.id + 1 });
    });
  }
  const saveEdit = (order, pdf) => run(["orders", "pdfs"], "readwrite", s => { s.orders.put(order); s.pdfs.put({ id: order.id, data: pdf }); });
  const removeOrder = id => run(["orders", "pdfs"], "readwrite", s => { s.orders.delete(id); s.pdfs.delete(id); });
  const savePdf = (id, data) => run(["pdfs"], "readwrite", s => s.pdfs.put({ id, data }));

  // Reemplaza todos los datos (restaurar respaldo)
  function replaceAll({ orders, products, counter, settings }) {
    return run(["orders", "pdfs", "products", "meta"], "readwrite", s => {
      s.orders.clear(); s.pdfs.clear(); s.products.clear();
      orders.forEach(o => s.orders.put(o));
      products.forEach(p => s.products.put({ nombre: p.nombre, precio: p.precio || 0, fijo: p.fijo ?? (p.precio > 0) }));
      s.meta.put({ k: "counter", v: counter });
      if (settings) s.meta.put({ k: "settings", v: settings });
    });
  }

  const addProduct = (nombre, precio, fijo) => run(["products"], "readwrite", s => s.products.add({ nombre, precio: fijo ? precio : 0, fijo: !!fijo }));
  const removeProduct = id => run(["products"], "readwrite", s => s.products.delete(id));

  return { open, getAll, get, getMeta, setMeta, nextNumber, saveNew, saveEdit, removeOrder, savePdf, replaceAll, addProduct, removeProduct };
})();
