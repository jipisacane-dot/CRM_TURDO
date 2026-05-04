import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtUSD, fmtARS, fmtDate, monthLabel, type CommissionWithRefs, type DBAgent } from './commissions';

interface ReceiptInput {
  agent: DBAgent;
  commissions: CommissionWithRefs[];
  yearMonth: string;
  exchangeRate: number;
}

const CRIMSON = '#8B1F1F';
const TEXT_DARK = '#0F172A';
const TEXT_MUTED = '#64748B';
const BORDER = '#CBD5E1';

const drawTurdoLogo = (doc: jsPDF, x: number, y: number, size = 14) => {
  // Triangle 1 (crimson) — diagonal superior
  doc.setFillColor(CRIMSON);
  doc.triangle(x, y, x + size, y, x + size * 0.55, y + size * 0.55, 'F');
  // Triangle 2 (light gray) — diagonal inferior
  doc.setFillColor('#D9D9D9');
  doc.triangle(x, y, x + size * 0.55, y + size * 0.55, x, y + size, 'F');
  // Circle (crimson)
  doc.setFillColor(CRIMSON);
  doc.circle(x + size * 0.65, y + size * 0.62, size * 0.09, 'F');
};

export const generatePayrollReceipt = (input: ReceiptInput): jsPDF => {
  const { agent, commissions, yearMonth, exchangeRate } = input;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;

  // ── Header ──────────────────────────────────────────────────────────────
  drawTurdoLogo(doc, margin, margin - 2, 14);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(TEXT_DARK);
  doc.text('TURDO', margin + 18, margin + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.text('GROUP · REAL ESTATE', margin + 18, margin + 8.5);

  // Right side — receipt number + date
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  const receiptNum = `Recibo ${yearMonth.replace('-', '')}-${agent.id.slice(0, 6).toUpperCase()}`;
  doc.text(receiptNum, pageW - margin, margin + 2, { align: 'right' });
  doc.text(`Emitido: ${fmtDate(new Date().toISOString().slice(0, 10))}`, pageW - margin, margin + 6.5, { align: 'right' });

  // Separator line
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.3);
  doc.line(margin, margin + 14, pageW - margin, margin + 14);

  // ── Title ───────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(TEXT_DARK);
  doc.text('Liquidación mensual', margin, margin + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_MUTED);
  const monthStr = monthLabel(yearMonth);
  doc.text(monthStr.charAt(0).toUpperCase() + monthStr.slice(1), margin, margin + 28);

  // ── Recipient block ─────────────────────────────────────────────────────
  let y = margin + 38;
  doc.setFillColor('#F8FAFC');
  doc.roundedRect(margin, y, pageW - margin * 2, 18, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('VENDEDOR', margin + 4, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(TEXT_DARK);
  doc.text(agent.name, margin + 4, y + 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text([agent.branch ?? '', agent.email].filter(Boolean).join(' · '), margin + 4, y + 15.5);

  // ── Tabla de comisiones ─────────────────────────────────────────────────
  y += 26;

  const rows = commissions.map(c => [
    c.operation ? fmtDate(c.operation.fecha_boleto) : '—',
    c.operation?.property?.address ?? '—',
    c.tipo === 'venta' ? 'Venta' : 'Captación',
    `${Number(c.porcentaje).toFixed(2)}%`,
    c.operation ? fmtUSD(Number(c.operation.precio_venta_usd)) : '—',
    fmtUSD(Number(c.monto_usd)),
  ]);

  if (rows.length === 0) {
    rows.push(['—', 'Sin comisiones este mes', '', '', '', fmtUSD(0)]);
  }

  autoTable(doc, {
    startY: y,
    head: [['Fecha boleto', 'Propiedad', 'Tipo', '%', 'Precio venta', 'Comisión']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, textColor: TEXT_DARK, cellPadding: 2.5 },
    alternateRowStyles: { fillColor: '#F8FAFC' },
    columnStyles: {
      3: { halign: 'center' },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin },
  });

  // ── Resumen ────────────────────────────────────────────────────────────
  type AT = jsPDF & { lastAutoTable?: { finalY: number } };
  let finalY = (doc as AT).lastAutoTable?.finalY ?? y + 30;
  finalY += 8;

  const totalCommUsd = commissions.reduce((s, c) => s + Number(c.monto_usd), 0);
  const totalCommArs = totalCommUsd * exchangeRate;
  const baseSalary = Number(agent.base_salary_ars);
  const total = baseSalary + totalCommArs;

  // Box derecha con resumen
  const boxW = 86;
  const boxX = pageW - margin - boxW;
  doc.setFillColor('#F8FAFC');
  doc.setDrawColor(BORDER);
  doc.roundedRect(boxX, finalY, boxW, 48, 2, 2, 'FD');

  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.setFont('helvetica', 'normal');

  const lineY = (i: number) => finalY + 7 + i * 6.5;
  const labelX = boxX + 4;
  const valueX = boxX + boxW - 4;

  doc.text('Sueldo fijo:', labelX, lineY(0));
  doc.setTextColor(TEXT_DARK);
  doc.text(fmtARS(baseSalary), valueX, lineY(0), { align: 'right' });

  doc.setTextColor(TEXT_MUTED);
  doc.text('Comisiones USD:', labelX, lineY(1));
  doc.setTextColor(TEXT_DARK);
  doc.text(fmtUSD(totalCommUsd), valueX, lineY(1), { align: 'right' });

  doc.setTextColor(TEXT_MUTED);
  doc.text(`Cotización (×${exchangeRate}):`, labelX, lineY(2));
  doc.setTextColor(TEXT_DARK);
  doc.text(fmtARS(totalCommArs), valueX, lineY(2), { align: 'right' });

  doc.setDrawColor(BORDER);
  doc.line(labelX, lineY(2) + 3, valueX, lineY(2) + 3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DARK);
  doc.text('TOTAL A PAGAR', labelX, lineY(3) + 3);
  doc.setTextColor(CRIMSON);
  doc.text(fmtARS(total), valueX, lineY(3) + 3, { align: 'right' });

  // ── Firma ───────────────────────────────────────────────────────────────
  let signY = finalY + 65;
  if (signY > 250) {
    doc.addPage();
    signY = margin + 30;
  }

  // Línea para firma
  doc.setDrawColor(TEXT_MUTED);
  doc.setLineWidth(0.3);
  doc.line(margin, signY, margin + 70, signY);
  doc.line(pageW - margin - 70, signY, pageW - margin, signY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Firma del vendedor', margin, signY + 4);
  doc.text('Aclaración: ' + agent.name, margin, signY + 8);
  doc.text('Firma de la administración', pageW - margin - 70, signY + 4);
  doc.text('Aclaración: Leticia Turdo', pageW - margin - 70, signY + 8);

  // ── Footer ──────────────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Turdo Estudio Inmobiliario · Mar del Plata · turdogroup.com', pageW / 2, footerY, { align: 'center' });

  return doc;
};

export const downloadReceiptPDF = (input: ReceiptInput) => {
  try {
    const doc = generatePayrollReceipt(input);
    const safeName = input.agent.name
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin tildes para nombre de archivo
      .replace(/\s+/g, '_').toLowerCase();
    const fileName = `recibo_${safeName}_${input.yearMonth}.pdf`;
    doc.save(fileName);
  } catch (err) {
    console.error('Error generando recibo PDF:', err);
    alert('No se pudo generar el recibo: ' + (err as Error).message);
    throw err;
  }
};
