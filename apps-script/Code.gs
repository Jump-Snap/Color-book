// Install this code in the Apps Script project bound to the orders spreadsheet.
// Keep BOT_TOKEN and ADMIN_CHAT_ID in Script Properties, never in the public site.
const ORDERS_SHEET_NAME = 'Sheet1';
const ORDER_COLUMNS = {
  childName: 10, orderId: 16, telegramMessageId: 17,
  status: 18, deposit: 19, remainder: 20, confirmedAt: 21, orderDate: 22
};
const ORDER_STAGES = ['تم التأكيد', 'تم الشحن', 'تم التوصيل'];
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
  const sheet = ordersSheet_();
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    if (sheet.getRange(row, ORDER_COLUMNS.orderId).getValue()) {
      syncOrderStage_(row);
      refreshTelegramKeyboard_(row);
    }
  }
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
          reply_markup: { inline_keyboard: [[{
            text: '💰 تأكيد الديبوزيت', callback_data: 'deposit:' + orderId
          }]] }
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
    text: 'اكتب المبلغ المدفوع للأوردر ' + id + ' (رقم فقط، مثال: 60)',
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
    reply_(token, msg, 'الأوردر مؤكد بالفعل. لم أغيّر المبلغ.');
    return false;
  }
  const total = parseAmount_(String(sheet.getRange(row, 6).getDisplayValue()));
  if (!total || amount > total) {
    reply_(token, msg, 'المبلغ أكبر من إجمالي الطلب أو السعر غير واضح. راجع الرقم ثم حاول مرة أخرى.');
    return false;
  }
  const remainder = roundedRemainder_(total, amount);
  sheet.getRange(row, ORDER_COLUMNS.status, 1, 4)
    .setValues([['تم التأكيد', amount, remainder, new Date()]]);
  syncOrderStage_(row);
  const orderId = String(sheet.getRange(row, ORDER_COLUMNS.orderId).getValue() || '');
  reply_(token, msg, 'تم تحديث الأوردر' + (orderId ? ' ' + orderId : '') +
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

function onStatusEdit(e) {
  if (!e || !e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  const edited = e.range.getSheet();
  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row < 2 || (edited.getName() === ORDERS_SHEET_NAME && col !== ORDER_COLUMNS.status) ||
      (ORDER_STAGES.includes(edited.getName()) && col !== 11)) return;
  if (edited.getName() !== ORDERS_SHEET_NAME && !ORDER_STAGES.includes(edited.getName())) return;
  const status = String(e.range.getValue() || '');
  if (!['جديد'].concat(ORDER_STAGES).includes(status)) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const source = ordersSheet_();
    const sourceRow = edited.getName() === ORDERS_SHEET_NAME ? row :
      findRowByValue_(source, ORDER_COLUMNS.orderId, edited.getRange(row, 2).getDisplayValue());
    if (!sourceRow) throw new Error('Order ID not found in Sheet1');
    source.getRange(sourceRow, ORDER_COLUMNS.status).setValue(status);
    syncOrderStage_(sourceRow);
    refreshTelegramKeyboard_(sourceRow);
    notifyTelegramStatus_(sourceRow);
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
    text: '💰 تأكيد الديبوزيت', callback_data: 'deposit:' + id
  }]] };
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
      text: 'حالة الأوردر ' + id + ': ' + status + ' ✅'
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

