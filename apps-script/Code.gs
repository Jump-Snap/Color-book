// Install this code in the Apps Script project bound to the orders spreadsheet.
// Keep BOT_TOKEN and ADMIN_CHAT_ID in Script Properties, never in the public site.
const ORDERS_SHEET_NAME = 'Sheet1';
const ORDER_COLUMNS = {
  childName: 10, orderId: 16, telegramMessageId: 17,
  status: 18, deposit: 19, remainder: 20, confirmedAt: 21, orderDate: 22
};
const ORDER_STAGES = ['تم التأكيد', 'تم الشحن', 'تم التوصيل'];
const SHIPPING_SHEET_NAME = 'Sheet1 (1)';
const DEPOSIT_APP_URL = 'https://jump-snap.github.io/Color-book/deposit.html';
const STAGE_HEADERS = [
  'تاريخ الأوردر', 'رقم الطلب', 'الاسم', 'رقم التليفون', 'العنوان',
  'المحافظة', 'الباقة', 'السعر الإجمالي', 'المبلغ المدفوع', 'الباقي',
  'الحالة', 'ملاحظات', 'اسم الطفل', 'رقم رسالة تليجرام'
];

function ordersSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) throw new Error('Missing orders sheet: ' + ORDERS_SHEET_NAME);
  return sheet;
}

function prepareOrdersSheet() {
  const sheet = ordersSheet_();
  const headers = [
    [ORDER_COLUMNS.childName, 'اسم الطفل'],
    [ORDER_COLUMNS.orderId, 'رقم الطلب'],
    [ORDER_COLUMNS.telegramMessageId, 'رقم رسالة تليجرام'],
    [ORDER_COLUMNS.status, 'حالة الطلب'],
    [ORDER_COLUMNS.deposit, 'المبلغ المدفوع'],
    [ORDER_COLUMNS.remainder, 'الباقي'],
    [ORDER_COLUMNS.confirmedAt, 'وقت التأكيد'],
    [ORDER_COLUMNS.orderDate, 'تاريخ الأوردر']
  ];
  headers.forEach(([column, label]) => {
    const cell = sheet.getRange(1, column);
    if (!cell.getValue()) cell.setValue(label);
  });
  sheet.getRange('B:B').setNumberFormat('@');
  sheet.getRange('P:Q').setNumberFormat('@');
  sheet.getRange('S:T').setNumberFormat('0.00');
  sheet.getRange('U:U').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange('V:V').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange('R2:R').setDataValidation(statusValidation_());
}

function prepareWorkflowSheets() {
  prepareOrdersSheet();
  ORDER_STAGES.forEach(ensureStageSheet_);
  reconcileAllOrders();
}

// Run once after installing this version. It keeps historical rows and their unknown dates intact.
function reconcileAllOrders() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ordersSheet_();
    ORDER_STAGES.forEach(ensureStageSheet_);
    for (let row = 2; row <= sheet.getLastRow(); row++) {
      if (!hasOrderData_(sheet, row)) continue;
      ensureOrderIdentity_(sheet, row, false);
      normalizeOrderAmounts_(sheet, row, true);
      const statusCell = sheet.getRange(row, ORDER_COLUMNS.status);
      const status = String(statusCell.getValue() || '').trim();
      if (!status || status === 'مؤكد') {
        const paid = parseAmount_(sheet.getRange(row, ORDER_COLUMNS.deposit).getDisplayValue());
        statusCell.setValue(paid > 0 ? 'تم التأكيد' : 'جديد');
      }
      syncOrderStage_(row);
      syncShippingQueue_(row);
    }
  } finally {
    lock.releaseLock();
  }
}

function hasOrderData_(sheet, row) {
  const cells = sheet.getRange(row, 1, 1, 10).getDisplayValues()[0];
  return [cells[0], cells[1], cells[2], cells[5], cells[9]].some(value => String(value).trim());
}

function ensureOrderIdentity_(sheet, row, stampDate) {
  const idCell = sheet.getRange(row, ORDER_COLUMNS.orderId);
  let id = String(idCell.getDisplayValue() || '').trim();
  if (!id) {
    id = 'JS-' + Utilities.getUuid();
    idCell.setNumberFormat('@').setValue(id);
  }
  const dateCell = sheet.getRange(row, ORDER_COLUMNS.orderDate);
  if (stampDate && !dateCell.getValue()) dateCell.setValue(new Date());
  return id;
}

function normalizeOrderAmounts_(sheet, row, useLegacyPaid) {
  const paidCell = sheet.getRange(row, ORDER_COLUMNS.deposit);
  let paid = parseAmount_(paidCell.getDisplayValue());
  if (!paid && useLegacyPaid) {
    paid = parseAmount_(sheet.getRange(row, 12).getDisplayValue());
    if (paid) paidCell.setValue(paid);
  }
  const legacyTotal = parseAmount_(sheet.getRange(row, 11).getDisplayValue());
  const listedTotal = parseAmount_(sheet.getRange(row, 6).getDisplayValue());
  const total = legacyTotal || listedTotal;
  const status = String(sheet.getRange(row, ORDER_COLUMNS.status).getValue() || '');
  if (total > 0 && paid <= total && (paid > 0 || ORDER_STAGES.includes(status))) {
    sheet.getRange(row, ORDER_COLUMNS.remainder).setValue(roundedRemainder_(total, paid));
  }
  return { total: total, paid: paid, valid: total > 0 && paid <= total };
}

function installWorkflowEditing() {
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'onStatusEdit')) {
    ScriptApp.newTrigger('onStatusEdit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
      .onEdit().create();
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Empty request');
    const order = JSON.parse(e.postData.contents);
    if (order.action === 'confirmDepositWebApp') return confirmDepositWebApp_(order);
    const required = ['name', 'phone', 'address', 'governorate', 'package', 'totalPrice'];
    required.forEach(key => { if (!String(order[key] || '').trim()) throw new Error('Missing ' + key); });
    const token = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
    const chatId = PropertiesService.getScriptProperties().getProperty('ADMIN_CHAT_ID');
    if (!token || !chatId) throw new Error('Set BOT_TOKEN and ADMIN_CHAT_ID in Script Properties');

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = ordersSheet_();
      const orderId = validOrderId_(order.orderId) || 'JS-' + Utilities.getUuid().slice(0, 8).toUpperCase();
      const existingRow = findRowByValue_(sheet, ORDER_COLUMNS.orderId, orderId);
      if (existingRow) return textResponse_('Already received');

      const row = sheet.getLastRow() + 1;
      const cells = new Array(22).fill('');
      cells[0] = safeCell_(order.name);
      cells[1] = String(order.phone).trim();
      cells[2] = safeCell_(order.address);
      cells[3] = safeCell_(order.governorate);
      cells[4] = safeCell_(order.package);
      cells[5] = safeCell_(order.totalPrice);
      cells[6] = safeCell_(order.notes || '');
      cells[7] = 'وصلت على تليجرام ✅';
      cells[8] = 'وصلت على تليجرام ✅';
      cells[9] = safeCell_(order.childName || '');
      cells[15] = orderId;
      cells[17] = 'جديد';
      cells[21] = new Date();
      sheet.getRange(row, 2).setNumberFormat('@');
      sheet.getRange(row, ORDER_COLUMNS.orderId, 1, 2).setNumberFormat('@');
      sheet.getRange(row, 1, 1, cells.length).setValues([cells]);

      // The current public site still sends its own Telegram message. It does
      // not include orderId; only the updated site does. Avoid duplicate alerts
      // while the Apps Script deployment and site update happen in sequence.
      if (!validOrderId_(order.orderId)) return textResponse_('Saved ' + orderId);

      try {
        const sent = telegramCall_(token, 'sendMessage', {
          chat_id: chatId,
          text: orderMessage_(order, orderId),
          parse_mode: 'HTML',
          reply_markup: statusKeyboard_('جديد', orderId)
        });
        sheet.getRange(row, ORDER_COLUMNS.telegramMessageId).setValue(String(sent.message_id));
      } catch (telegramError) {
        sheet.getRange(row, ORDER_COLUMNS.status).setValue('خطأ إرسال تليجرام');
        throw telegramError;
      }
      return textResponse_('Saved ' + orderId);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return textResponse_('Error: ' + error.message);
  }
}

function confirmDepositWebApp_(request) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('BOT_TOKEN');
  const adminChatId = props.getProperty('ADMIN_CHAT_ID');
  if (!token || !adminChatId) throw new Error('Missing bot settings');
  validateTelegramInitData_(request.initData, token, adminChatId);
  const id = validOrderId_(request.orderId);
  const amount = parsePlainAmount_(request.amount);
  if (!id || !amount) throw new Error('Invalid order or amount');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ordersSheet_();
    const row = findRowByValue_(sheet, ORDER_COLUMNS.orderId, id);
    if (!row) throw new Error('Order not found');
    const messageId = Number(sheet.getRange(row, ORDER_COLUMNS.telegramMessageId).getDisplayValue());
    if (!messageId) throw new Error('Telegram order message not found');
    const msg = { chat: { id: adminChatId }, message_id: messageId };
    const saved = confirmDeposit_(sheet, row, amount, token, msg, messageId);
    return textResponse_(saved ? 'Confirmed' : 'Not confirmed');
  } finally {
    lock.releaseLock();
  }
}

function validateTelegramInitData_(raw, token, adminChatId) {
  if (typeof raw !== 'string' || !raw || raw.length > 16000) throw new Error('Telegram login required');
  const data = {};
  raw.split('&').forEach(part => {
    const separator = part.indexOf('=');
    if (separator < 1) throw new Error('Invalid Telegram data');
    const key = decodeURIComponent(part.slice(0, separator).replace(/\+/g, ' '));
    const value = decodeURIComponent(part.slice(separator + 1).replace(/\+/g, ' '));
    if (Object.prototype.hasOwnProperty.call(data, key)) throw new Error('Duplicate Telegram field');
    data[key] = value;
  });
  if (!/^[a-f0-9]{64}$/i.test(data.hash || '')) throw new Error('Telegram hash missing');
  const check = Object.keys(data).filter(key => key !== 'hash').sort()
    .map(key => key + '=' + data[key]).join('\n');
  const key = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(token).getBytes(), Utilities.newBlob('WebAppData').getBytes());
  const signed = Utilities.computeHmacSha256Signature(Utilities.newBlob(check).getBytes(), key);
  const expected = signed.map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
  let difference = 0;
  const received = data.hash.toLowerCase();
  for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  if (difference !== 0) throw new Error('Telegram signature invalid');
  const age = Date.now() / 1000 - Number(data.auth_date);
  if (!Number.isFinite(age) || age < -60 || age > 86400) throw new Error('Telegram login expired');
  const user = JSON.parse(data.user || '{}');
  if (String(user.id) !== String(adminChatId)) throw new Error('This Telegram user is not authorized');
}

function installReplyPolling() {
  const token = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  if (!token) throw new Error('Set BOT_TOKEN first');
  const info = telegramCall_(token, 'getWebhookInfo', {});
  if (info.url) throw new Error('The bot has a webhook. Keep that integration and add the reply handler there.');
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'pollTelegramReplies')) {
    ScriptApp.newTrigger('pollTelegramReplies').timeBased().everyMinutes(1).create();
  }
}

function pollTelegramReplies() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('BOT_TOKEN');
  const adminChatId = props.getProperty('ADMIN_CHAT_ID');
  if (!token || !adminChatId) throw new Error('Missing BOT_TOKEN or ADMIN_CHAT_ID');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const offset = Number(props.getProperty('LAST_UPDATE_ID') || 0) + 1;
    const updates = telegramCall_(token, 'getUpdates', {
      offset: offset, limit: 100, timeout: 0, allowed_updates: ['message', 'callback_query']
    });
    console.log('Telegram polling: ' + updates.length + ' update(s), offset ' + offset);
    updates.forEach(update => {
      try {
        if (update.callback_query) {
          console.log('Telegram callback: ' + String(update.callback_query.data || '').split(':')[0]);
          processDepositButton_(update.callback_query, token, adminChatId);
        }
        const msg = update.message;
        if (msg && String(msg.chat.id) === String(adminChatId)) processReply_(msg, token);
      } catch (error) {
        console.error('Update ' + update.update_id + ': ' + error);
        throw error;
      }
      props.setProperty('LAST_UPDATE_ID', String(update.update_id));
    });
  } finally {
    lock.releaseLock();
  }
}

function processReply_(msg, token) {
  const pending = pendingForReply_(msg);
  if (pending) {
    const amount = parsePlainAmount_(msg.text || '');
    if (!amount) {
      reply_(token, msg, 'اكتب المبلغ رقم فقط، مثل: 60');
      return;
    }
    if (confirmDeposit_(ordersSheet_(), pending.row, amount, token, msg, pending.orderMessageId)) {
      PropertiesService.getScriptProperties().deleteProperty('PENDING_PROMPT_' + pending.promptMessageId);
    }
    return;
  }
  const parsed = parseConfirmation_(msg.text || '');
  if (!parsed) return;
  if (!msg.reply_to_message) {
    reply_(token, msg, 'اعمل Reply على رسالة الأوردر نفسها، واكتب: تم التأكيد 500');
    return;
  }
  const sheet = ordersSheet_();
  const originalId = String(msg.reply_to_message.message_id);
  let row = findRowByValue_(sheet, ORDER_COLUMNS.telegramMessageId, originalId);
  if (!row) {
    const candidates = findLegacyRows_(sheet, msg.reply_to_message.text || '');
    if (candidates.length !== 1) {
      reply_(token, msg, candidates.length > 1
        ? 'لقيت أكثر من أوردر بنفس البيانات في الشيت؛ ما حدّثتش أي صف. حدّد الصف يدويًا.'
        : 'ما لقيتش الأوردر المقابل للرسالة في الشيت؛ ما حدّثتش أي صف.');
      return;
    }
    row = candidates[0];
    sheet.getRange(row, ORDER_COLUMNS.telegramMessageId).setNumberFormat('@').setValue(originalId);
  }
  confirmDeposit_(sheet, row, parsed.amount, token, msg, Number(originalId));
}

function processDepositButton_(callback, token, adminChatId) {
  const data = String(callback.data || '');
  if (String(callback.from.id) !== String(adminChatId) ||
      String(callback.message && callback.message.chat.id) !== String(adminChatId)) {
    console.error('Telegram callback rejected: wrong admin ID');
    answerCallbackSafely_(token, {
      callback_query_id: callback.id, text: 'الزر ده مخصص لصاحب الأوردرات فقط', show_alert: true
    });
    return;
  }
  if (data.startsWith('status:')) {
    processStatusButton_(callback, token);
    return;
  }
  if (!data.startsWith('deposit:')) {
    answerCallbackSafely_(token, { callback_query_id: callback.id });
    return;
  }
  const sheet = ordersSheet_();
  const id = data.slice('deposit:'.length);
  const row = findRowByValue_(sheet, ORDER_COLUMNS.orderId, id);
  if (!row || String(sheet.getRange(row, ORDER_COLUMNS.telegramMessageId).getDisplayValue()) !==
      String(callback.message.message_id)) {
    answerCallbackSafely_(token, {
      callback_query_id: callback.id, text: 'لم أجد الأوردر في الشيت', show_alert: true
    });
    return;
  }
  if (ORDER_STAGES.includes(String(sheet.getRange(row, ORDER_COLUMNS.status).getValue()))) {
    answerCallbackSafely_(token, {
      callback_query_id: callback.id, text: 'الديبوزيت مؤكد بالفعل', show_alert: true
    });
    return;
  }
  const prompt = telegramCall_(token, 'sendMessage', {
    chat_id: adminChatId,
    reply_to_message_id: callback.message.message_id,
    text: 'اكتب المبلغ المدفوع لأوردر ' + orderDisplayLabel_(sheet, row) +
      ' (رقم فقط، مثال: 60)',
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'مثال: 60' }
  });
  PropertiesService.getScriptProperties().setProperty('PENDING_PROMPT_' + prompt.message_id,
    JSON.stringify({ row: row, promptMessageId: prompt.message_id,
      orderMessageId: callback.message.message_id, createdAt: Date.now() }));
  answerCallbackSafely_(token, { callback_query_id: callback.id });
}

function answerCallbackSafely_(token, payload) {
  try { telegramCall_(token, 'answerCallbackQuery', payload); }
  catch (error) { console.log('Callback answer expired: ' + error.message); }
}

function pendingForReply_(msg) {
  const repliedId = msg.reply_to_message && msg.reply_to_message.message_id;
  if (!repliedId) return null;
  const raw = PropertiesService.getScriptProperties().getProperty('PENDING_PROMPT_' + repliedId);
  if (!raw) return null;
  const pending = JSON.parse(raw);
  if (Date.now() - pending.createdAt > 24 * 60 * 60 * 1000) return null;
  return pending;
}

function confirmDeposit_(sheet, row, amount, token, msg, orderMessageId) {
  const status = String(sheet.getRange(row, ORDER_COLUMNS.status).getValue() || '');
  if (ORDER_STAGES.includes(status) || status === 'مؤكد') {
    reply_(token, msg, 'أوردر ' + orderDisplayLabel_(sheet, row) +
      ' مؤكد بالفعل. لم أغيّر المبلغ.');
    return false;
  }
  const total = parseAmount_(sheet.getRange(row, 11).getDisplayValue()) ||
    parseAmount_(sheet.getRange(row, 6).getDisplayValue());
  if (!total || amount > total) {
    reply_(token, msg, 'المبلغ أكبر من إجمالي الطلب أو السعر غير واضح. راجع الرقم ثم حاول مرة أخرى.');
    return false;
  }
  const remainder = roundedRemainder_(total, amount);
  sheet.getRange(row, ORDER_COLUMNS.status, 1, 4)
    .setValues([['تم التأكيد', amount, remainder, new Date()]]);
  ensureOrderIdentity_(sheet, row, false);
  syncOrderStage_(row);
  syncShippingQueue_(row);
  const orderId = String(sheet.getRange(row, ORDER_COLUMNS.orderId).getValue() || '');
  reply_(token, msg, 'تم تأكيد أوردر ' + orderDisplayLabel_(sheet, row) +
    ' ✅\nالمدفوع: ' + amount + ' ج.م\nالباقي بعد التقريب: ' + remainder + ' ج.م');
  if (orderMessageId && orderId) {
    try {
      telegramCall_(token, 'editMessageReplyMarkup', {
        chat_id: msg.chat.id, message_id: orderMessageId,
        reply_markup: statusKeyboard_('تم التأكيد', orderId)
      });
    } catch (error) { console.error('Button update: ' + error); }
  }
  return true;
}

function statusValidation_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(['جديد'].concat(ORDER_STAGES), true)
    .setAllowInvalid(false).build();
}

function orderDisplayLabel_(sheet, row) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const child = clean(sheet.getRange(row, ORDER_COLUMNS.childName).getDisplayValue());
  if (child) return 'الطفل ' + child;
  const parent = clean(sheet.getRange(row, 1).getDisplayValue());
  return parent ? 'العميل ' + parent : 'الطلب';
}

function ensureStageSheet_(name) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(name);
  if (sheet) return sheet;
  sheet = book.insertSheet(name);
  sheet.getRange(1, 1, 1, STAGE_HEADERS.length).setValues([STAGE_HEADERS])
    .setFontWeight('bold').setBackground('#dceaf7');
  sheet.setFrozenRows(1);
  sheet.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange('B2:B').setNumberFormat('@');
  sheet.getRange('D2:D').setNumberFormat('@');
  sheet.getRange('I2:J').setNumberFormat('0.00');
  sheet.getRange('K2:K').setDataValidation(statusValidation_());
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(5, 260);
  return sheet;
}

function stageRowFromOrder_(sheet, row) {
  const v = sheet.getRange(row, 1, 1, ORDER_COLUMNS.orderDate).getValues()[0];
  return [v[21], v[15], v[0], v[1], v[2], v[3], v[4], v[5],
    v[18], v[19], v[17], v[6], v[9], v[16]];
}

function syncOrderStage_(row) {
  const source = ordersSheet_();
  const id = String(source.getRange(row, ORDER_COLUMNS.orderId).getDisplayValue() || '');
  if (!id) return;
  let status = String(source.getRange(row, ORDER_COLUMNS.status).getValue() || '');
  if (status === 'مؤكد') {
    status = 'تم التأكيد';
    source.getRange(row, ORDER_COLUMNS.status).setValue(status);
  }
  const projected = stageRowFromOrder_(source, row);
  ORDER_STAGES.forEach(name => {
    const view = ensureStageSheet_(name);
    const existing = findRowByValue_(view, 2, id);
    if (name === status) {
      const target = existing || view.getLastRow() + 1;
      view.getRange(target, 1, 1, STAGE_HEADERS.length).setValues([projected]);
    } else if (existing) {
      view.deleteRow(existing);
    }
    compactStageSheet_(view);
  });
}

function compactStageSheet_(sheet) {
  const last = sheet.getLastRow();
  if (last < 3) return;
  const rows = sheet.getRange(2, 1, last - 1, STAGE_HEADERS.length).getDisplayValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].every(value => !String(value).trim())) sheet.deleteRow(i + 2);
  }
}

function shippingCity_(value) {
  const key = String(value || '').trim().replace(/[\u064b-\u065f]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ').toLowerCase();
  const cities = {
    'القاهره': 'CAIRO', 'الجيزه': 'GIZA', 'الاسكندريه': 'ALEXANDRIA',
    'البحيره': 'BEHIRA', 'القليوبيه': 'QALIUBIA', 'الغربيه': 'GHARBIA',
    'المنوفيه': 'MONOUFIA', 'دمياط': 'DOMITTA', 'الدقهليه': 'DAKAHLIA',
    'كفر الشيخ': 'KAFR EL SHEIKH', 'مطروح': 'MARSA MATROUH',
    'مرسى مطروح': 'MARSA MATROUH', 'الاسماعيليه': 'ISMAILIA',
    'السويس': 'SUEZ', 'بورسعيد': 'PORT SAID', 'الشرقيه': 'SHARKIA',
    'الفيوم': 'FAYOUM', 'بني سويف': 'BANI SWEIF', 'المنيا': 'MENIA',
    'اسيوط': 'ASSIUT', 'سوهاج': 'SOUHAGE', 'قنا': 'QENA',
    'اسوان': 'ASWAN', 'الاقصر': 'LOUXOR', 'البحر الاحمر': 'RED SEA',
    'الوادي الجديد': 'NEW VALLLEY', 'شمال سيناء': 'NOURTH SINAI',
    'جنوب سيناء': 'SOUTH SINAI'
  };
  const mapped = cities[key] || String(value || '').trim().toUpperCase();
  const list = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet2');
  if (!list || list.getLastRow() < 2) return cities[key] || '';
  const allowed = list.getRange(2, 5, list.getLastRow() - 1, 1).getDisplayValues()
    .map(row => row[0]).filter(Boolean);
  return allowed.includes(mapped) ? mapped : '';
}

function syncShippingQueue_(sourceRow) {
  const source = ordersSheet_();
  const shipping = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHIPPING_SHEET_NAME);
  if (!shipping) return;
  const id = String(source.getRange(sourceRow, ORDER_COLUMNS.orderId).getDisplayValue() || '').trim();
  if (!id) return;
  const status = String(source.getRange(sourceRow, ORDER_COLUMNS.status).getValue() || '');
  const existing = findShippingOrderRow_(shipping, id);
  if (status !== 'تم التأكيد') {
    if (existing) shipping.deleteRow(existing);
    return;
  }
  const data = source.getRange(sourceRow, 1, 1, ORDER_COLUMNS.orderDate).getDisplayValues()[0];
  const target = existing || firstFreeShippingRow_(shipping);
  const city = shippingCity_(data[3]);
  shipping.getRange(target, 2).setValue(shippingDescription_(data[4]));
  shipping.getRange(target, 3).setValue(1);
  shipping.getRange(target, 4).setValue('Small');
  shipping.getRange(target, 5).setValue(parseAmount_(data[19]));
  shipping.getRange(target, 6).clearContent();
  shipping.getRange(target, 8).setNumberFormat('@');
  shipping.getRange(target, 7, 1, 5)
    .setValues([[data[0], shippingPhone_(data[1]), data[2], city, '']]);
  shipping.getRange(target, 7).setNote('JumpSnapOrderId=' + id);
  shipping.getRange(target, 12, 1, 4)
    .setValues([['Jump Snap', 'Jump Snap', 'yes', 'Jump Snap']]);
}

function shippingDescription_(value) {
  const text = String(value || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
  const match = text.match(/(?:^|[^0-9])(1|3|6)(?![0-9])/);
  const count = match ? Number(match[1]) : /كتاب\s*واحد|كتاب\s*واحدة/.test(text) ? 1 : 0;
  return count ? count + (count === 1 ? ' كتاب تلوين' : ' كتب تلوين') : '';
}

function shippingPhone_(value) {
  let digits = String(value || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[^0-9]/g, '');
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2);
  return digits && !digits.startsWith('0') ? '0' + digits : digits;
}

function findShippingOrderRow_(sheet, id) {
  if (sheet.getLastRow() < 2) return 0;
  const notes = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getNotes();
  const index = notes.findIndex(row => row[0] === 'JumpSnapOrderId=' + id);
  // Migrate an existing export row before clearing its visible reference.
  return index >= 0 ? index + 2 : findRowByValue_(sheet, 11, id);
}

function firstFreeShippingRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 2;
  const references = sheet.getRange(2, 7, last - 1, 1).getDisplayValues();
  const blank = references.findIndex(row => !String(row[0]).trim());
  return blank < 0 ? last + 1 : blank + 2;
}

function onStatusEdit(e) {
  if (!e || !e.range) return;
  const edited = e.range.getSheet();
  if (edited.getName() !== ORDERS_SHEET_NAME && !ORDER_STAGES.includes(edited.getName())) return;
  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  if (edited.getName() === ORDERS_SHEET_NAME &&
      !((firstCol <= 12 && lastCol >= 1) || (firstCol <= 19 && lastCol >= 18))) return;
  if (edited.getName() !== ORDERS_SHEET_NAME && !(firstCol <= 11 && lastCol >= 11)) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const source = ordersSheet_();
    const statusEdit = edited.getName() !== ORDERS_SHEET_NAME ||
      (firstCol <= ORDER_COLUMNS.status && lastCol >= ORDER_COLUMNS.status);
    const paymentEdit = edited.getName() === ORDERS_SHEET_NAME &&
      ((firstCol <= ORDER_COLUMNS.deposit && lastCol >= ORDER_COLUMNS.deposit) ||
       (firstCol <= 12 && lastCol >= 12));
    for (let row = Math.max(2, e.range.getRow());
         row < e.range.getRow() + e.range.getNumRows(); row++) {
      const sourceRow = edited.getName() === ORDERS_SHEET_NAME ? row :
        findRowByValue_(source, ORDER_COLUMNS.orderId, edited.getRange(row, 2).getDisplayValue());
      if (!sourceRow || !hasOrderData_(source, sourceRow)) continue;
      const wasStatus = String(source.getRange(sourceRow, ORDER_COLUMNS.status).getValue() || '');
      const legacy = source.getRange(sourceRow, 11, 1, 3).getDisplayValues()[0].some(Boolean);
      ensureOrderIdentity_(source, sourceRow, !legacy);
      const paymentColumnEdited = edited.getName() === ORDERS_SHEET_NAME &&
        firstCol <= ORDER_COLUMNS.deposit && lastCol >= ORDER_COLUMNS.deposit;
      const money = normalizeOrderAmounts_(source, sourceRow, !paymentColumnEdited);
      let status = edited.getName() === ORDERS_SHEET_NAME ? wasStatus :
        String(edited.getRange(row, 11).getValue() || '');
      if (paymentEdit && !statusEdit && money.paid > 0 && money.valid &&
          (!status || status === 'جديد')) status = 'تم التأكيد';
      if (!status) status = 'جديد';
      if (!['جديد'].concat(ORDER_STAGES).includes(status)) continue;
      const previous = edited.getName() === ORDERS_SHEET_NAME && statusEdit &&
        e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 ?
        String(e.oldValue || '') : wasStatus;
      const statusChanged = status !== previous;
      if (status !== wasStatus) source.getRange(sourceRow, ORDER_COLUMNS.status).setValue(status);
      if (status === 'تم التأكيد' && statusChanged &&
          !source.getRange(sourceRow, ORDER_COLUMNS.confirmedAt).getValue()) {
        source.getRange(sourceRow, ORDER_COLUMNS.confirmedAt).setValue(new Date());
      }
      if (statusEdit || status !== 'جديد') syncOrderStage_(sourceRow);
      if (statusEdit || status !== 'جديد') syncShippingQueue_(sourceRow);
      if (statusEdit || statusChanged) {
        refreshTelegramKeyboard_(sourceRow);
        if (statusChanged) notifyTelegramStatus_(sourceRow);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function statusKeyboard_(status, id) {
  if (status === 'تم التأكيد') return { inline_keyboard: [[{
    text: '🚚 تم الشحن', callback_data: 'status:ship:' + id
  }]] };
  if (status === 'تم الشحن') return { inline_keyboard: [[{
    text: '📦 تم التوصيل', callback_data: 'status:deliver:' + id
  }]] };
  if (status === 'تم التوصيل') return null;
  return { inline_keyboard: [[{
    text: '💰 تأكيد الديبوزيت', web_app: { url: DEPOSIT_APP_URL + '?orderId=' + encodeURIComponent(id) }
  }]] };
}

function upgradeDepositButtons() {
  const sheet = ordersSheet_();
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const status = String(sheet.getRange(row, ORDER_COLUMNS.status).getValue() || '');
    if (status === 'جديد') refreshTelegramKeyboard_(row);
  }
}

function refreshTelegramKeyboard_(row) {
  const sheet = ordersSheet_();
  const id = String(sheet.getRange(row, ORDER_COLUMNS.orderId).getDisplayValue() || '');
  const messageId = String(sheet.getRange(row, ORDER_COLUMNS.telegramMessageId).getDisplayValue() || '');
  const status = String(sheet.getRange(row, ORDER_COLUMNS.status).getValue() || '');
  if (!id || !messageId) return;
  const props = PropertiesService.getScriptProperties();
  try {
    const payload = {
      chat_id: props.getProperty('ADMIN_CHAT_ID'), message_id: Number(messageId)
    };
    const markup = statusKeyboard_(status, id);
    if (markup) payload.reply_markup = markup;
    telegramCall_(props.getProperty('BOT_TOKEN'), 'editMessageReplyMarkup', payload);
  } catch (error) {
    if (!String(error.message || error).includes('message is not modified')) {
      console.error('Telegram button refresh: ' + error);
    }
  }
}

function notifyTelegramStatus_(row) {
  const sheet = ordersSheet_();
  const id = String(sheet.getRange(row, ORDER_COLUMNS.orderId).getDisplayValue() || '');
  const messageId = String(sheet.getRange(row, ORDER_COLUMNS.telegramMessageId).getDisplayValue() || '');
  const status = String(sheet.getRange(row, ORDER_COLUMNS.status).getValue() || '');
  if (!id || !messageId) return;
  const props = PropertiesService.getScriptProperties();
  try {
    telegramCall_(props.getProperty('BOT_TOKEN'), 'sendMessage', {
      chat_id: props.getProperty('ADMIN_CHAT_ID'), reply_to_message_id: Number(messageId),
      text: 'حالة أوردر ' + orderDisplayLabel_(sheet, row) + ': ' + status + ' ✅'
    });
  } catch (error) { console.error('Telegram status notice: ' + error); }
}

function processStatusButton_(callback, token) {
  const match = String(callback.data || '').match(/^status:(ship|deliver):(JS-[A-Za-z0-9-]{8,50})$/);
  if (!match) {
    answerCallbackSafely_(token, { callback_query_id: callback.id, text: 'حالة غير معروفة' });
    return;
  }
  const id = match[2];
  const previous = match[1] === 'ship' ? 'تم التأكيد' : 'تم الشحن';
  const next = match[1] === 'ship' ? 'تم الشحن' : 'تم التوصيل';
  const sheet = ordersSheet_();
  const row = findRowByValue_(sheet, ORDER_COLUMNS.orderId, id);
  if (!row || String(sheet.getRange(row, ORDER_COLUMNS.telegramMessageId).getDisplayValue()) !==
      String(callback.message.message_id)) {
    answerCallbackSafely_(token, { callback_query_id: callback.id,
      text: 'لم أجد الأوردر في الشيت', show_alert: true });
    return;
  }
  const status = String(sheet.getRange(row, ORDER_COLUMNS.status).getValue() || '');
  if (status !== previous) {
    answerCallbackSafely_(token, { callback_query_id: callback.id,
      text: 'حالة الأوردر الحالية: ' + status, show_alert: true });
    refreshTelegramKeyboard_(row);
    return;
  }
  sheet.getRange(row, ORDER_COLUMNS.status).setValue(next);
  syncOrderStage_(row);
  syncShippingQueue_(row);
  refreshTelegramKeyboard_(row);
  answerCallbackSafely_(token, { callback_query_id: callback.id });
  notifyTelegramStatus_(row);
}

function parsePlainAmount_(text) {
  const normalized = String(text).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).trim();
  if (!/^[0-9]+(?:[.,][0-9]{1,2})?$/.test(normalized)) return 0;
  const amount = Number(normalized.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function roundedRemainder_(total, paid) {
  return Math.ceil(Math.max(0, total - paid) / 10) * 10;
}

function findLegacyRows_(sheet, message) {
  const extract = label => {
    const line = message.split('\n').find(x => x.indexOf(label) !== -1);
    return line ? line.split(':').slice(1).join(':').trim() : '';
  };
  const name = normalize_(extract('اسم ولي الأمر'));
  const phone = normalizePhone_(extract('الموبايل'));
  const address = normalize_(extract('العنوان'));
  const pack = normalize_(extract('الباقة'));
  const total = parseAmount_(extract('الإجمالي'));
  if (!name || !phone || !address || !pack || !total) return [];
  const values = sheet.getRange(2, 1, Math.max(0, sheet.getLastRow() - 1), 6).getDisplayValues();
  return values.flatMap((r, i) =>
    normalize_(r[0]) === name && normalizePhone_(r[1]) === phone &&
    normalize_(r[2]) === address && normalize_(r[4]) === pack &&
    parseAmount_(r[5]) === total ? [i + 2] : []);
}

function parseConfirmation_(text) {
  const normalized = String(text).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).trim();
  const match = normalized.match(/^(?:تم\s+التأكيد|تأكيد)\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:جنيه|ج\.?\s*م\.?)?$/);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? { amount } : null;
}

function parseAmount_(value) {
  const normalized = String(value).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
  const match = normalized.match(/[0-9]+(?:[.,][0-9]{1,2})?/);
  return match ? Number(match[0].replace(',', '.')) : 0;
}

function findRowByValue_(sheet, column, value) {
  if (sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getDisplayValues();
  const index = values.findIndex(r => String(r[0]) === String(value));
  return index < 0 ? 0 : index + 2;
}

function safeCell_(value) {
  const text = String(value || '').trim();
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function normalize_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhone_(value) {
  let digits = String(value || '').replace(/[^0-9٠-٩۰-۹]/g, '')
    .replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
  if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2);
  return digits.replace(/^0/, '');
}

function validOrderId_(value) {
  const text = String(value || '').trim();
  return /^JS-[A-Za-z0-9-]{8,50}$/.test(text) ? text : '';
}

function html_(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function orderMessage_(order, id) {
  return '🆕 <b>طلب جديد - كتاب البطل</b> 🆕\n\n' +
    '🆔 <b>رقم الطلب:</b> ' + html_(id) + '\n' +
    '👤 <b>اسم ولي الأمر:</b> ' + html_(order.name) + '\n' +
    '👶 <b>اسم الطفل:</b> ' + html_(order.childName) + '\n' +
    '📱 <b>الموبايل:</b> ' + html_(order.phone) + '\n' +
    '📍 <b>المحافظة:</b> ' + html_(order.governorate) + '\n' +
    '🏠 <b>العنوان:</b> ' + html_(order.address) + '\n' +
    '📦 <b>الباقة:</b> ' + html_(order.package) + '\n' +
    '💰 <b>الإجمالي:</b> ' + html_(order.totalPrice) + '\n' +
    '📝 <b>ملاحظات:</b> ' + html_(order.notes) + '\n\n' +
    '⚠️ <i>العميل تم تحويله للواتساب لاستكمال الصور والدفع</i>';
}

function reply_(token, msg, text) {
  telegramCall_(token, 'sendMessage', {
    chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: text
  });
}

function telegramCall_(token, method, payload) {
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const body = JSON.parse(response.getContentText());
  if (!body.ok) throw new Error('Telegram ' + method + ': ' + body.description);
  return body.result;
}

function textResponse_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

