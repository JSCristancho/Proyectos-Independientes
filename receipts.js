// =====================================================
// BJL - Recibos PDF (rollo termico 80 mm)
// Diseno elegante. Recibe (doc, order, cfg) y devuelve
// la altura final usada, para ajustar el largo exacto del papel.
// =====================================================

const Receipts = (() => {

  const W = 80;            // ancho del rollo en mm
  const M = 5;             // margen lateral
  const IW = W - M * 2;    // ancho util

  // ---------- Formatos (manuales, sin depender del idioma del navegador) ----------
  const money = n => "$" + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const pad = n => String(n).padStart(2, "0");
  const fmtFecha = iso => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const fmtHora = iso => {
    const d = new Date(iso); let h = d.getHours(); const ap = h >= 12 ? "p. m." : "a. m.";
    h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`;
  };
  const numStr = id => String(id).padStart(4, "0");
  const cod = o => o.codigo || numStr(o.id);   // "A-0012" (o solo "0012" en ordenes antiguas)

  function setColor(doc, hex, kind) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    if (kind === "fill") doc.setFillColor(r, g, b);
    else if (kind === "draw") doc.setDrawColor(r, g, b);
    else doc.setTextColor(r, g, b);
  }

  // Texto ajustado al ancho; devuelve numero de lineas escritas
  function wrapText(doc, txt, x, y, width, lh, opt) {
    const lines = doc.splitTextToSize(String(txt), width);
    lines.forEach((l, i) => doc.text(l, x, y + i * lh, opt));
    return lines.length;
  }

  function logo(doc, y, w) {
    const h = w * LOGO_RATIO;
    doc.addImage(LOGO_DATA, "PNG", (W - w) / 2, y, w, h);
    return h;
  }

  // =====================================================
  // RECIBO - ELEGANTE (logo, costura punteada, tipografia fina)
  // =====================================================
  function elegante(doc, o, cfg) {
    const K = "#222222", G = "#777777";
    let y = 9;
    y += logo(doc, y, 36) + 3;
    setColor(doc, K); setColor(doc, K, "draw");
    doc.setFont("times", "normal").setFontSize(7.5);
    [cfg.direccion, [cfg.telefono && "Tel. " + cfg.telefono, cfg.nit && "NIT " + cfg.nit].filter(Boolean).join("  •  ")].filter(Boolean)
      .forEach(t => { y += wrapText(doc, t, W / 2, y, IW - 4, 3.5, { align: "center" }) * 3.5; });

    const stitch = (yy) => { doc.setLineDashPattern([1.2, 0.9], 0).setLineWidth(0.35).line(M + 2, yy, W - M - 2, yy); doc.setLineDashPattern([], 0); };
    y += 2; stitch(y); y += 7;

    doc.setFont("times", "bold").setFontSize(12);
    doc.text("RECIBO DE PEDIDO", W / 2, y, { align: "center" }); y += 5.5;
    doc.setFont("times", "normal").setFontSize(9);
    doc.text(`N° ${cod(o)}  •  ${fmtFecha(o.fecha)}  •  ${fmtHora(o.fecha)}`, W / 2, y, { align: "center" }); y += 5;
    if (o.cliente) {
      doc.setFont("times", "italic").setFontSize(9.5);
      y += wrapText(doc, "Cliente: " + o.cliente, W / 2, y, IW - 4, 4.2, { align: "center" }) * 4.2;
    }
    y += 1; stitch(y); y += 6;

    o.items.forEach(it => {
      doc.setFont("times", "bold").setFontSize(9.5);
      const n = wrapText(doc, it.nombre, M + 2, y, IW - 4 - 22, 4.2);
      doc.text(money(it.cantidad * it.precio), W - M - 2, y, { align: "right" });
      y += n * 4.2 - 0.6;
      setColor(doc, G); doc.setFont("times", "normal").setFontSize(8);
      doc.text(`${it.cantidad} x ${money(it.precio)}`, M + 2, y); y += 3.5;
      if (it.obs) { doc.setFont("times", "italic").setFontSize(8); y += wrapText(doc, "“" + it.obs + "”", M + 2, y, IW - 4, 3.5) * 3.5; }
      setColor(doc, K); y += 2.6;
    });
    if (o.nota) { setColor(doc, G); doc.setFont("times", "italic").setFontSize(8); y += wrapText(doc, "Nota: " + o.nota, M + 2, y, IW - 4, 3.5) * 3.5 + 1.5; setColor(doc, K); }

    doc.setLineWidth(0.5).line(M + 2, y, W - M - 2, y); y += 7;
    doc.setFont("times", "bold").setFontSize(11); doc.text("TOTAL", M + 2, y);
    doc.setFontSize(16); doc.text(money(o.total), W - M - 2, y + 0.5, { align: "right" }); y += 5;
    doc.setLineWidth(0.5).line(M + 2, y, W - M - 2, y); y += 8;

    doc.setFont("times", "italic").setFontSize(9);
    y += wrapText(doc, cfg.mensaje, W / 2, y, IW - 4, 4.2, { align: "center" }) * 4.2;
    y += 3; stitch(y);
    return y + 8;
  }

  // Genera el PDF; mide primero el alto real y luego dibuja con el papel exacto
  function build(order, cfgActual) {
    const cfg = { ...cfgActual, ...(order.emisor || {}) };   // el recibo conserva los datos que tenia al emitirse
    const { jsPDF } = window.jspdf;
    const fn = elegante;
    const probe = new jsPDF({ unit: "mm", format: [W, 2000] });
    const h = Math.max(fn(probe, order, cfg), 90);
    const doc = new jsPDF({ unit: "mm", format: [W, h] });
    fn(doc, order, cfg);
    doc.setProperties({ title: `Recibo ${cod(order)} - BJL Bordados`, subject: "Recibo de orden", author: "BJL Bordados", creator: "BJL Bordados" });
    try { doc.setLanguage("es"); doc.viewerPreferences({ DisplayDocTitle: true }); } catch (e) { /* version sin estas opciones */ }
    return doc;
  }

  return { build, money, fmtFecha, fmtHora, numStr, cod };
})();
