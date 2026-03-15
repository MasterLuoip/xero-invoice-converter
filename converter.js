// ── Store → Contact mapping ──
const STORE_CONTACT = {
  strathfield: 'Weplus trading pty ltd',
  hurstville: 'H.P Butchery PTY LTD',
  chinatown: 'LM INTERNATIONAL CATERING GROUP PTY LTD',
  townhall: 'LM INTERNATIONAL CATERING GROUP PTY LTD',
  ultimo: 'LM INTERNATIONAL CATERING GROUP PTY LTD',
  parramatta: 'Weplus trading pty ltd',
  eastwood: 'Weplus trading pty ltd',
  chatswood: 'Dovel butchery pty Ltd',
  cabramatta: 'GMO butchery Cabramatta Pty Ltd',
};

// ── Store → Short code for invoice numbers ──
const STORE_CODE = {
  strathfield: 'STR',
  hurstville: 'HUR',
  chinatown: 'CHI',
  townhall: 'TOW',
  ultimo: 'ULT',
  parramatta: 'PAR',
  eastwood: 'EAS',
  chatswood: 'CHA',
  cabramatta: 'CAB',
};

// ── CSV parser (handles quoted fields with commas/newlines) ──
function parseCSV(text) {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        // quoted field
        i++;
        let val = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') {
              val += '"';
              i += 2;
            } else {
              i++; // closing quote
              break;
            }
          } else {
            val += text[i];
            i++;
          }
        }
        row.push(val);
        // skip comma or line end
        if (i < text.length && text[i] === ',') i++;
        else if (i < text.length && (text[i] === '\r' || text[i] === '\n')) {
          if (text[i] === '\r' && i + 1 < text.length && text[i + 1] === '\n') i += 2;
          else i++;
          break;
        }
      } else {
        // unquoted field
        let val = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          val += text[i];
          i++;
        }
        row.push(val);
        if (i < text.length && text[i] === ',') i++;
        else if (i < text.length && (text[i] === '\r' || text[i] === '\n')) {
          if (text[i] === '\r' && i + 1 < text.length && text[i + 1] === '\n') i += 2;
          else i++;
          break;
        }
      }
    }
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }
  return rows;
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.replace(/^\*/, '').trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] || '').trim();
    });
    return obj;
  });
}

// ── Normalize product name for matching ──
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Parse POS orders ──
function parsePOSOrders(rows) {
  const objects = rowsToObjects(rows);
  // Group into orders: IN-STORE row is header, Item rows follow
  const orders = [];
  let current = null;

  for (const row of objects) {
    if (row.Type === 'IN-STORE') {
      current = {
        store: (row['Table Number'] || '').trim(),
        date: (row.Date || '').trim(),
        orderNumber: (row['Order Number'] || '').trim(),
        items: [],
      };
      orders.push(current);
    } else if (row.Type === 'Item' && current) {
      const name = (row['Product Name'] || '').trim();
      const qty = parseInt(row.Quantity, 10) || 0;
      if (name && name !== '/' && qty > 0) {
        current.items.push({ name, qty });
      }
    } else if (row.Type === '' && current) {
      // summary row – ignore
    }
  }
  return orders;
}

// ── Build Xero Items lookup ──
// Supports two formats:
//   1. Xero Items export: ItemName, ItemCode, SalesUnitPrice, SalesAccount, SalesTaxRate
//   2. Xero Invoice import: Description, InventoryItemCode, UnitAmount, AccountCode, TaxType
function buildXeroItemsLookup(rows) {
  const objects = rowsToObjects(rows);
  const lookup = new Map(); // normalized name → item info
  const warnings = [];

  for (const item of objects) {
    const name = (item.ItemName || item.Description || '').trim();
    const code = (item.ItemCode || item.InventoryItemCode || '').trim();
    if (!name || !code) continue;

    const entry = {
      itemName: name,
      itemCode: code,
      unitPrice: (item.SalesUnitPrice || item.UnitAmount || '').trim(),
      accountCode: (item.SalesAccount || item.AccountCode || '').trim(),
      taxType: (item.SalesTaxRate || item.TaxType || '').trim(),
    };

    // Check for missing required fields
    const missing = [];
    if (!entry.accountCode) missing.push('AccountCode');
    if (!entry.taxType) missing.push('TaxType');
    if (!entry.unitPrice) missing.push('UnitPrice');
    if (missing.length > 0) {
      warnings.push(`${name} (${code}): missing ${missing.join(', ')}`);
    }

    // Deduplicate: if same product appears multiple times (e.g. from invoice file),
    // keep the first occurrence
    const key = normalizeName(name);
    if (!lookup.has(key)) {
      lookup.set(key, entry);
    }
  }

  return { lookup, warnings };
}

// ── Match POS product name to Xero item ──
function matchProduct(posName, xeroLookup) {
  const norm = normalizeName(posName);

  // Exact match
  if (xeroLookup.has(norm)) return xeroLookup.get(norm);

  // Try substring match: Xero name contained in POS name or vice versa
  for (const [key, val] of xeroLookup) {
    if (norm.includes(key) || key.includes(norm)) return val;
  }

  return null;
}

// ── Format date DD/MM/YYYY → YYYY-MM-DD (Xero format) ──
function formatDate(dateStr) {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm}-${dd}`;
  }
  return dateStr;
}

// ── Format date for invoice number: DD/MM/YYYY → YYYYMMDD ──
function dateForInvoice(dateStr) {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    return `${yyyy}${mm}${dd}`;
  }
  return dateStr.replace(/\//g, '');
}

// ── Main conversion ──
function convert(posText, xeroText) {
  const posRows = parseCSV(posText);
  const xeroRows = parseCSV(xeroText);

  const orders = parsePOSOrders(posRows);
  const { lookup: xeroLookup, warnings: itemWarnings } = buildXeroItemsLookup(xeroRows);

  const unmatchedProducts = new Map(); // name → total qty
  const missingFieldItems = [];
  const invoiceRows = [];
  const invoiceQtyChecks = []; // for validation

  for (const order of orders) {
    const storeLower = order.store.toLowerCase();
    const contact = STORE_CONTACT[storeLower];
    const storeCode = STORE_CODE[storeLower];

    if (!contact) {
      // Unknown store
      for (const item of order.items) {
        const key = `[Unknown store: ${order.store}] ${item.name}`;
        unmatchedProducts.set(key, (unmatchedProducts.get(key) || 0) + item.qty);
      }
      continue;
    }

    const invoiceDate = formatDate(order.date);
    const invoiceNumber = `${storeCode}-${dateForInvoice(order.date)}-${order.orderNumber}`;

    // Merge items by InventoryItemCode within this order
    const merged = new Map(); // itemCode → { xeroItem, qty, posName }
    let totalQtyBefore = 0;

    for (const item of order.items) {
      totalQtyBefore += item.qty;
      const xeroItem = matchProduct(item.name, xeroLookup);

      if (!xeroItem) {
        unmatchedProducts.set(item.name, (unmatchedProducts.get(item.name) || 0) + item.qty);
        continue;
      }

      if (!xeroItem.accountCode || !xeroItem.taxType || !xeroItem.unitPrice) {
        missingFieldItems.push({
          posName: item.name,
          itemCode: xeroItem.itemCode,
          missing: [
            !xeroItem.accountCode && 'SalesAccount',
            !xeroItem.taxType && 'SalesTaxRate',
            !xeroItem.unitPrice && 'SalesUnitPrice',
          ].filter(Boolean),
        });
        continue;
      }

      const key = xeroItem.itemCode;
      if (merged.has(key)) {
        merged.get(key).qty += item.qty;
      } else {
        merged.set(key, {
          xeroItem,
          qty: item.qty,
          posName: item.name,
        });
      }
    }

    // Validation: total qty after merge
    let totalQtyAfter = 0;
    for (const [, val] of merged) {
      totalQtyAfter += val.qty;
    }

    invoiceQtyChecks.push({
      invoiceNumber,
      before: totalQtyBefore,
      after: totalQtyAfter,
      unmatchedQty: totalQtyBefore - totalQtyAfter,
    });

    // Generate rows — repeat invoice-level fields on every row
    for (const [, val] of merged) {
      invoiceRows.push({
        ContactName: contact,
        EmailAddress: '',
        POAddressLine1: '',
        POAddressLine2: '',
        POAddressLine3: '',
        POAddressLine4: '',
        POCity: '',
        PORegion: '',
        POPostalCode: '',
        POCountry: '',
        InvoiceNumber: invoiceNumber,
        Reference: '',
        InvoiceDate: invoiceDate,
        DueDate: invoiceDate,
        InventoryItemCode: val.xeroItem.itemCode,
        Description: val.posName,
        Quantity: val.qty,
        UnitAmount: val.xeroItem.unitPrice,
        Discount: '',
        AccountCode: val.xeroItem.accountCode,
        TaxType: val.xeroItem.taxType,
        TrackingName1: '',
        TrackingOption1: '',
        TrackingName2: '',
        TrackingOption2: '',
        Currency: '',
        BrandingTheme: '',
      });
    }
  }

  return {
    invoiceRows,
    unmatchedProducts,
    missingFieldItems,
    itemWarnings,
    invoiceQtyChecks,
    totalOrders: orders.length,
    totalInvoices: invoiceQtyChecks.length,
  };
}

// ── Generate CSV string ──
function generateCSV(invoiceRows) {
  const headers = [
    '*ContactName', 'EmailAddress',
    'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4',
    'POCity', 'PORegion', 'POPostalCode', 'POCountry',
    '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate',
    'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount',
    'Discount', '*AccountCode', '*TaxType',
    'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2',
    'Currency', 'BrandingTheme',
  ];

  const fieldKeys = [
    'ContactName', 'EmailAddress',
    'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4',
    'POCity', 'PORegion', 'POPostalCode', 'POCountry',
    'InvoiceNumber', 'Reference', 'InvoiceDate', 'DueDate',
    'InventoryItemCode', 'Description', 'Quantity', 'UnitAmount',
    'Discount', 'AccountCode', 'TaxType',
    'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2',
    'Currency', 'BrandingTheme',
  ];

  const escapeField = (val) => {
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [headers.join(',')];
  for (const row of invoiceRows) {
    lines.push(fieldKeys.map(k => escapeField(row[k])).join(','));
  }
  return lines.join('\r\n');
}

// ── localStorage keys ──
const XERO_STORAGE_KEY = 'xeroItemsCSV';
const XERO_META_KEY = 'xeroItemsMeta'; // { filename, uploadedAt }

// ── UI Logic ──
const posFileInput = document.getElementById('pos-file');
const posDrop = document.getElementById('pos-drop');
const xeroFileInput = document.getElementById('xero-file');
const xeroDrop = document.getElementById('xero-drop');
const xeroUploadArea = document.getElementById('xero-upload-area');
const xeroSavedBadge = document.getElementById('xero-saved');
const xeroFilenameEl = document.getElementById('xero-filename');
const xeroDateEl = document.getElementById('xero-date');
const clearXeroBtn = document.getElementById('clear-xero');
const convertBtn = document.getElementById('convert-btn');
const outputDiv = document.getElementById('output');
const summaryDiv = document.getElementById('summary');
const warningsDiv = document.getElementById('warnings');
const unmatchedDiv = document.getElementById('unmatched');
const previewDiv = document.getElementById('preview');
const downloadBtn = document.getElementById('download-btn');

let csvResult = '';
let posFile = null; // track file from drag-and-drop or input

function getXeroMeta() {
  try {
    return JSON.parse(localStorage.getItem(XERO_META_KEY));
  } catch {
    return null;
  }
}

function hasXeroData() {
  const data = localStorage.getItem(XERO_STORAGE_KEY);
  const meta = getXeroMeta();
  if ((data && !meta) || (!data && meta)) {
    localStorage.removeItem(XERO_STORAGE_KEY);
    localStorage.removeItem(XERO_META_KEY);
    return false;
  }
  return !!data && !!meta && !!meta.filename;
}

function formatUploadDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function updateXeroUI() {
  const meta = getXeroMeta();
  if (hasXeroData() && meta) {
    xeroUploadArea.classList.add('hidden');
    xeroSavedBadge.classList.remove('hidden');
    xeroFilenameEl.textContent = meta.filename;
    xeroDateEl.textContent = '上传时间: ' + formatUploadDate(meta.uploadedAt);
  } else {
    xeroUploadArea.classList.remove('hidden');
    xeroSavedBadge.classList.add('hidden');
  }
  checkReady();
}

function saveXeroData(text, filename) {
  localStorage.setItem(XERO_STORAGE_KEY, text);
  localStorage.setItem(XERO_META_KEY, JSON.stringify({
    filename: filename,
    uploadedAt: new Date().toISOString(),
  }));
}

function checkReady() {
  const hasPOS = posFile || posFileInput.files.length > 0;
  const hasXero = xeroFileInput.files.length > 0 || hasXeroData();
  convertBtn.disabled = !(hasPOS && hasXero);
}

posFileInput.addEventListener('change', () => {
  posFile = posFileInput.files[0] || null;
  if (posFile) showFileSelected(posDrop, posFile.name);
  checkReady();
});
xeroFileInput.addEventListener('change', checkReady);

clearXeroBtn.addEventListener('click', () => {
  localStorage.removeItem(XERO_STORAGE_KEY);
  localStorage.removeItem(XERO_META_KEY);
  xeroFileInput.value = '';
  updateXeroUI();
});

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });
}

// ── Drag and drop ──
// Use window (not document) to reliably prevent browser file open/download.
// Safari requires dragenter + dragover both cancelled, plus dropEffect = 'copy'.
window.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); }, false);
window.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); }, false);
window.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); }, false);

function setupDropZone(dropEl, fileInput, onDrop) {
  let dragCounter = 0;

  dropEl.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropEl.classList.add('drag-over');
  }, false);

  dropEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, false);

  dropEl.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropEl.classList.remove('drag-over');
    }
  }, false);

  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropEl.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      onDrop(file);
    }
  });
}

function showFileSelected(dropEl, filename) {
  // Remove existing badge if any
  const existing = dropEl.querySelector('.file-selected');
  if (existing) existing.remove();
  // Hide everything else in the box (input, hints)
  Array.from(dropEl.children).forEach((child) => {
    if (child.tagName === 'LABEL') return; // keep the label
    child.style.display = 'none';
  });
  // Add prominent green badge
  const badge = document.createElement('div');
  badge.className = 'file-selected';
  badge.innerHTML = '<span class="file-selected-name">' + filename + '</span>';
  const reselect = document.createElement('button');
  reselect.className = 'clear-btn';
  reselect.textContent = '重新选择';
  reselect.addEventListener('click', (e) => {
    e.stopPropagation();
    badge.remove();
    // Show everything again
    Array.from(dropEl.children).forEach((child) => {
      if (child.tagName === 'LABEL') return;
      child.style.display = '';
    });
    posFile = null;
    posFileInput.value = '';
    checkReady();
  });
  badge.appendChild(reselect);
  dropEl.appendChild(badge);
}

setupDropZone(posDrop, posFileInput, (file) => {
  posFile = file;
  showFileSelected(posDrop, file.name);
  checkReady();
});

setupDropZone(xeroDrop, xeroFileInput, (file) => {
  // Read and save immediately
  readFile(file).then((text) => {
    saveXeroData(text, file.name);
    updateXeroUI();
  });
});

async function getXeroText() {
  if (xeroFileInput.files.length > 0) {
    const file = xeroFileInput.files[0];
    const text = await readFile(file);
    saveXeroData(text, file.name);
    updateXeroUI();
    return text;
  }
  return localStorage.getItem(XERO_STORAGE_KEY);
}

convertBtn.addEventListener('click', async () => {
  convertBtn.disabled = true;
  convertBtn.textContent = '转换中...';

  try {
    const file = posFile || posFileInput.files[0];
    if (!file) throw new Error('请上传 POS 订单 CSV 文件');

    const posText = await readFile(file);
    const xeroText = await getXeroText();

    if (!xeroText) {
      throw new Error('没有 Xero 商品数据，请先上传 Xero 商品 CSV 文件。');
    }

    const result = convert(posText, xeroText);

    // Summary
    summaryDiv.innerHTML = `
      <strong>转换完成</strong><br>
      POS 订单数: ${result.totalOrders}<br>
      生成发票数: ${result.totalInvoices}<br>
      总行项目数: ${result.invoiceRows.length}
    `;

    // Warnings
    const allWarnings = [];

    if (result.missingFieldItems.length > 0) {
      allWarnings.push('<h3>以下商品缺少 Xero 字段（已排除）</h3><ul>');
      for (const item of result.missingFieldItems) {
        allWarnings.push(`<li><strong>${item.posName}</strong> (${item.itemCode}): 缺少 ${item.missing.join(', ')}</li>`);
      }
      allWarnings.push('</ul>');
    }

    const qtyMismatches = result.invoiceQtyChecks.filter(c => c.unmatchedQty > 0);
    if (qtyMismatches.length > 0) {
      allWarnings.push('<h3>数量差异（部分商品未匹配）</h3><ul>');
      for (const c of qtyMismatches) {
        allWarnings.push(`<li>${c.invoiceNumber}: POS 共 ${c.before} 项, 已匹配 ${c.after} 项 (${c.unmatchedQty} 项未匹配)</li>`);
      }
      allWarnings.push('</ul>');
    }

    if (allWarnings.length > 0) {
      warningsDiv.innerHTML = allWarnings.join('');
      warningsDiv.classList.remove('hidden');
    } else {
      warningsDiv.classList.add('hidden');
    }

    if (result.unmatchedProducts.size > 0) {
      let html = '<h3>未匹配商品（在 Xero 商品列表中未找到）</h3><ul>';
      for (const [name, qty] of result.unmatchedProducts) {
        html += `<li><strong>${name}</strong> — 总数量: ${qty}</li>`;
      }
      html += '</ul>';
      unmatchedDiv.innerHTML = html;
      unmatchedDiv.classList.remove('hidden');
    } else {
      unmatchedDiv.classList.add('hidden');
    }

    if (result.invoiceRows.length > 0) {
      const previewCols = [
        { key: 'ContactName', label: '客户' },
        { key: 'InvoiceNumber', label: '发票号' },
        { key: 'InvoiceDate', label: '日期' },
        { key: 'InventoryItemCode', label: '商品编码' },
        { key: 'Description', label: '描述' },
        { key: 'Quantity', label: '数量' },
        { key: 'UnitAmount', label: '单价' },
        { key: 'AccountCode', label: '科目' },
        { key: 'TaxType', label: '税种' },
      ];
      let html = '<table><thead><tr>';
      for (const col of previewCols) html += `<th>${col.label}</th>`;
      html += '</tr></thead><tbody>';
      for (const row of result.invoiceRows) {
        html += '<tr>';
        for (const col of previewCols) html += `<td>${row[col.key]}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
      previewDiv.innerHTML = html;
    }

    csvResult = generateCSV(result.invoiceRows);
    downloadBtn.classList.remove('hidden');
    outputDiv.classList.remove('hidden');

  } catch (err) {
    summaryDiv.innerHTML = `<strong style="color:red">错误:</strong> ${err.message}`;
    outputDiv.classList.remove('hidden');
  }

  convertBtn.disabled = false;
  convertBtn.textContent = '开始转换';
});

downloadBtn.addEventListener('click', () => {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvResult], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  a.download = `XeroInvoice-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ── Init ──
updateXeroUI();
