/* WPP — ต่อยอดรายงานกลุ่มเสี่ยง (ใช้คู่กับ period.js · โหลดหลัง period.js)
 *  1) มุมมองครูที่ปรึกษา: กรอง "ห้องที่ปรึกษาของฉัน" (p_settings/advisors)
 *  2) บันทึกการช่วยเหลือ: p_care/{auto} {key, room, no, name, code, date, method, note, term, by, byName, at}
 *  3) บันทึกข้อความรายงาน ผอ. และ 4) หนังสือแจ้งผู้ปกครอง — Word (.docx) / PDF · TH Sarabun New
 */
var RISK_SCHOOL = 'โรงเรียนวังโพรงพิทยาคม';
var RISK_ADDR = 'อำเภอเนินมะปราง จังหวัดพิษณุโลก';
var RISK_DIRECTOR = {name: 'นางสาวสมใจ  จันทรงกรด', pos: ['ครูชำนาญการพิเศษ รักษาการในตำแหน่ง', 'ผู้อำนวยการโรงเรียนวังโพรงพิทยาคม']}; // แก้ชื่อผู้บริหารได้ที่นี่
var RISK_DOCX = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
var CARE_METHODS = ['📞 โทรแจ้งผู้ปกครอง', '✉️ ส่งหนังสือถึงผู้ปกครอง', '🏠 เยี่ยมบ้าน', '💬 พูดคุย/ให้คำปรึกษานักเรียน', '🤝 ประสานครูผู้สอน', '📤 ส่งต่อ (แนะแนว/ฝ่ายปกครอง)', '📝 อื่น ๆ'];
var R_DOTS = '..................................................';

// ---------------------------------------------------------------------
// ข้อมูลการช่วยเหลือ + ห้องที่ปรึกษา
// ---------------------------------------------------------------------
var RiskCare = {
  term: null, care: {}, adv: {}, names: {}, mine: false, onChange: null,
  key: function (x) { return x.room + '|' + x.no + '|' + x.name; },
  load: function (term) {
    var R = this; R.term = term;
    return Promise.all([
      db.collection('p_care').where('term', '==', term).get().then(function (q) {
        var m = {}; q.forEach(function (d) { var x = Object.assign({_id: d.id}, d.data()); (m[x.key] = m[x.key] || []).push(x); });
        Object.keys(m).forEach(function (k) { m[k].sort(function (a, b) { return b.date.localeCompare(a.date); }); });
        R.care = m;
      }).catch(function (e) { console.warn('p_care', e); R.care = {}; }),
      db.doc('p_settings/advisors').get().then(function (s) { R.adv = s.exists ? s.data().byRoom || {} : {}; }).catch(function () { R.adv = {}; }),
      db.collection('teachers').get().then(function (q) { q.forEach(function (d) { R.names[d.id] = d.data().name || d.id; }); }).catch(function () {})
    ]);
  },
  myRooms: function () { var R = this, out = []; Object.keys(R.adv).forEach(function (rid) { if ((R.adv[rid] || []).indexOf(me.email) >= 0) out.push(rid); }); return out; },
  advisorsOf: function (room) { var R = this; return (R.adv[roomId(room)] || []).map(function (e) { return R.names[e] || e; }); },
  mineBox: function () {
    var my = this.myRooms(); if (!my.length) return '';
    return '<div style="align-self:end"><label style="display:flex;gap:8px;align-items:center;min-height:44px;margin:0;cursor:pointer"><input type="checkbox" id="rMine" style="width:20px;height:20px;min-height:0"' + (this.mine ? ' checked' : '') + '> 👩‍🏫 ห้องที่ปรึกษาของฉัน</label></div>';
  },
  mineOk: function (room) { return !this.mine || this.myRooms().indexOf(roomId(room)) >= 0; },
  last: function (x) { var l = this.care[this.key(x)] || []; return l.filter(function (c) { return !c.code || c.code === x.code; }); },
  text: function (x) { var l = this.last(x); return l.length ? l[0].method.replace(/^\S+\s/, '') + ' (' + shortDate(l[0].date) + ')' + (l.length > 1 ? ' +' + (l.length - 1) : '') : '-'; },
  cell: function (x, i) {
    var l = this.last(x);
    return {html: (l.length ? '<span class="pill e-ok" title="' + esc(l.map(function (c) { return c.date + ' ' + c.method; }).join('\n')) + '">' + esc(l[0].method.split(' ')[0]) + ' ' + l.length + ' ครั้ง</span> ' : '') +
      '<button class="btn sm" type="button" onclick="RiskCare.open(' + i + ')">＋ บันทึก</button>', text: this.text(x)};
  },
  open: function (i) {
    var R = this, x = (window.RISK_LIST || [])[i]; if (!x) return;
    var hist = R.care[R.key(x)] || [];
    openModal('<h2 style="margin:0 0 4px;font-size:17px">🤝 บันทึกการช่วยเหลือ</h2><div class="muted">' + esc(x.name) + ' · ' + esc(x.room) + ' เลขที่ ' + esc(x.no) + ' · ' + esc(x.code) + ' มาเรียน ' + (Math.round(x.att * 10) / 10) + '%</div>' +
      '<div class="grid" style="margin-top:10px"><div><label for="cDate">วันที่</label><input type="date" id="cDate" value="' + today() + '"></div>' +
      '<div><label for="cScope">รายวิชา</label><select id="cScope"><option value="' + esc(x.code) + '">เฉพาะ ' + esc(x.code) + '</option><option value="">ทุกวิชา (ภาพรวมนักเรียน)</option></select></div></div>' +
      '<label style="margin-top:10px">วิธีการช่วยเหลือ</label><div class="chips" id="cMeth">' + CARE_METHODS.map(function (m, k) { return '<button type="button" class="chip' + (k === 0 ? ' on' : '') + '" data-m="' + esc(m) + '">' + esc(m) + '</button>'; }).join('') + '</div>' +
      '<label for="cNote" style="margin-top:10px">รายละเอียด / ผลการติดตาม</label><textarea id="cNote" rows="3" maxlength="500" placeholder="เช่น ผู้ปกครองรับทราบ จะกำกับให้มาเรียน"></textarea>' +
      '<button class="btn pri" style="width:100%;margin-top:10px" id="cSave">💾 บันทึกการช่วยเหลือ</button>' +
      (hist.length ? '<h3 style="font-size:14px;margin:16px 0 6px">ประวัติการช่วยเหลือ (' + hist.length + ')</h3>' + hist.map(function (c) {
        return '<div class="stu"><span class="nm"><b>' + thDate(c.date) + ' · ' + esc(c.method) + '</b><small>' + esc(c.code || 'ทุกวิชา') + (c.note ? ' · ' + esc(c.note) : '') + ' · โดย ' + esc(c.byName || '') + '</small></span>' +
          (c.by === me.email || me.role === 'admin' ? '<button class="btn sm" type="button" onclick="RiskCare.del(\'' + esc(c._id) + '\',' + i + ')">ลบ</button>' : '') + '</div>';
      }).join('') : ''));
    $('cMeth').querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { $('cMeth').querySelectorAll('.chip').forEach(function (z) { z.classList.toggle('on', z === b); }); }; });
    $('cSave').onclick = function () {
      var m = ($('cMeth').querySelector('.chip.on') || {}).dataset;
      var d = {key: R.key(x), room: x.room, no: String(x.no), name: x.name, code: $('cScope').value, date: $('cDate').value || today(), method: m ? m.m : CARE_METHODS[0],
        note: $('cNote').value.trim(), term: R.term, by: me.email, byName: me.name, at: FV.serverTimestamp()};
      loading(true); db.collection('p_care').add(d).then(function (ref) {
        loading(false); d._id = ref && ref.id || ''; (R.care[d.key] = R.care[d.key] || []).unshift(d); R.care[d.key].sort(function (a, b) { return b.date.localeCompare(a.date); });
        closeModal(); toast('บันทึกการช่วยเหลือแล้ว ✓'); if (R.onChange) R.onChange();
      }).catch(fail);
    };
  },
  del: function (id, i) {
    var R = this; if (!confirm('ลบบันทึกการช่วยเหลือนี้?')) return;
    loading(true); db.doc('p_care/' + id).delete().then(function () {
      loading(false); Object.keys(R.care).forEach(function (k) { R.care[k] = R.care[k].filter(function (c) { return c._id !== id; }); });
      if (R.onChange) R.onChange(); R.open(i);
    }).catch(fail);
  },
  bar: function (n) {
    if (!n) return '';
    return '<div class="card" style="margin-top:12px;background:#fbfcff"><h3 style="margin:0 0 6px;font-size:15px">📄 ออกเอกสารจากรายชื่อที่แสดงอยู่ (' + n + ' คน-วิชา)</h3>' +
      '<div class="row"><button class="btn pri sm" type="button" onclick="RiskDoc.memo(\'docx\')">📝 บันทึกข้อความรายงาน ผอ. · Word</button><button class="btn sm" type="button" onclick="RiskDoc.memo(\'pdf\')">PDF</button></div>' +
      '<div class="row" style="margin-top:6px"><button class="btn pri sm" type="button" onclick="RiskDoc.letters(\'docx\')">✉️ หนังสือแจ้งผู้ปกครอง · Word</button><button class="btn sm" type="button" onclick="RiskDoc.letters(\'pdf\')">PDF</button></div>' +
      '<p class="muted" style="margin:6px 0 0;font-size:12px">ใช้ตัวกรองด้านบนเลือกห้อง/วิชา/ระดับก่อน · หนังสือแจ้งผู้ปกครองรวมทุกวิชาของนักเรียนคนเดียวกันในหน้าเดียว พร้อมใบตอบรับ</p></div>';
  }
};
function shortDate(d) { var a = String(d || '').split('-'); return a.length < 3 ? d : (+a[2]) + '/' + (+a[1]) + '/' + String(+a[0] + 543).slice(2); }

// ---------------------------------------------------------------------
// เอกสาร: บันทึกข้อความรายงาน ผอ. / หนังสือแจ้งผู้ปกครอง
// ---------------------------------------------------------------------
var RiskDoc = {
  meta: function () {
    var s = Stats.range ? Stats.range() : {start: '', end: today()}, t = termFor(s.end || today()).split('/');
    return {start: s.start, end: s.end, sem: t[0] || '', year: t[1] || '', today: today()};
  },
  pct: function (x) { return (Math.round(x.att * 100) / 100).toFixed(2); },
  students: function (list) {
    var m = {}, out = [];
    list.forEach(function (x) { var k = RiskCare.key(x); if (!m[k]) { m[k] = {name: x.name, room: x.room, no: x.no, subj: []}; out.push(m[k]); } m[k].subj.push(x); });
    return out.sort(function (a, b) { return cmpTh(a.room, b.room) || (Number(a.no) || 0) - (Number(b.no) || 0); });
  },
  scope: function (list) {
    var rooms = {}, codes = {}; list.forEach(function (x) { rooms[x.room] = 1; codes[x.code] = 1; });
    var r = Object.keys(rooms).sort(cmpTh), c = Object.keys(codes).sort(cmpTh);
    return (r.length === 1 ? 'ชั้น ' + r[0] : r.length <= 4 ? 'ชั้น ' + r.join(', ') : 'ทุกห้องเรียน') + (c.length === 1 ? ' รายวิชา ' + c[0] + (list[0].subject ? ' ' + list[0].subject : '') : '');
  },
  get: function () {
    var list = (window.RISK_LIST || []).filter(function (x) { return x.ev && x.ev.label !== 'ปกติ'; });
    if (!list.length) { toast('ไม่มีนักเรียนกลุ่มเสี่ยงในรายการที่แสดง', 'err'); return null; }
    return list;
  },

  // ---------- เนื้อหาร่วม (ใช้ทั้ง Word และ PDF) ----------
  memoModel: function (list) {
    var M = this.meta(), cnt = {}, ppl = this.students(list).length;
    list.forEach(function (x) { cnt[x.ev.label] = (cnt[x.ev.label] || 0) + 1; });
    return {M: M, list: list, ppl: ppl, cnt: cnt, scope: this.scope(list),
      body1: 'ด้วยข้าพเจ้า ' + me.name + ' ได้ตรวจสอบเวลาเรียนของนักเรียน' + this.scope(list) + ' ภาคเรียนที่ ' + M.sem + ' ปีการศึกษา ' + M.year +
        ' ระหว่างวันที่ ' + thDate(M.start) + ' ถึงวันที่ ' + thDate(M.end) + ' จากระบบบันทึกเวลาเรียน พบนักเรียนที่มีเวลาเรียนต่ำกว่าร้อยละ 90 จำนวน ' + ppl + ' คน (' + list.length + ' คน-รายวิชา) ' +
        'จำแนกเป็น กลุ่มเสี่ยง ' + (cnt['เสี่ยง'] || 0) + ' รายการ ต้องติดต่อครูผู้สอน ' + (cnt['ติดต่อครูผู้สอน'] || 0) + ' รายการ และมีเวลาเรียนต่ำกว่าร้อยละ 80 (หมดสิทธิ์สอบ) ' + (cnt['หมดสิทธิ์สอบ (มส.)'] || 0) + ' รายการ รายละเอียดดังตารางแนบ',
      body2: 'ทั้งนี้ ตามเกณฑ์การวัดและประเมินผล นักเรียนต้องมีเวลาเรียนไม่น้อยกว่าร้อยละ 80 ของเวลาเรียนทั้งหมดในแต่ละรายวิชา จึงจะมีสิทธิ์เข้ารับการวัดผลปลายภาคเรียน ข้าพเจ้าได้ดำเนินการติดตามและช่วยเหลือนักเรียนตามที่ระบุในตาราง และจะติดตามอย่างต่อเนื่อง',
      head: ['ที่', 'ชื่อ–นามสกุล', 'ห้อง', 'เลขที่', 'รหัสวิชา', 'ขาด/คาบ', 'มาเรียน (%)', 'ผลการประเมิน', 'การช่วยเหลือ'],
      rows: list.map(function (x, i) { return [String(i + 1), x.name, x.room, String(x.no), x.code, x.a + '/' + x.n, RiskDoc.pct(x), x.ev.label, RiskCare.text(x)]; })};
  },
  letterModel: function (s) {
    var M = this.meta(), adv = RiskCare.advisorsOf(s.room);
    return {M: M, s: s, adv: adv,
      body1: 'ด้วย' + RISK_SCHOOL + ' ได้ตรวจสอบเวลาเรียนของ ' + s.name + ' นักเรียนชั้นมัธยมศึกษาปีที่ ' + s.room.replace(/^ม\.?/, '') + ' เลขที่ ' + s.no +
        ' ภาคเรียนที่ ' + M.sem + ' ปีการศึกษา ' + M.year + ' ระหว่างวันที่ ' + thDate(M.start) + ' ถึงวันที่ ' + thDate(M.end) + ' พบว่านักเรียนมีเวลาเรียนในรายวิชาต่อไปนี้ต่ำกว่าเกณฑ์',
      body2: 'ตามเกณฑ์การวัดและประเมินผล นักเรียนต้องมีเวลาเรียนไม่น้อยกว่าร้อยละ 80 ของเวลาเรียนทั้งหมดในแต่ละรายวิชา หากเวลาเรียนไม่ถึงเกณฑ์จะไม่มีสิทธิ์เข้ารับการวัดผลปลายภาคเรียน (มส.) ' +
        'โรงเรียนจึงขอความร่วมมือจากท่านกำกับดูแลให้นักเรียนมาเรียนอย่างสม่ำเสมอ และหากมีข้อสงสัยหรือมีเหตุจำเป็น โปรดติดต่อครูที่ปรึกษาของนักเรียน',
      head: ['ที่', 'รหัสวิชา', 'รายวิชา', 'ขาด/คาบที่บันทึก', 'มาเรียน (%)', 'ผลการประเมิน'],
      rows: s.subj.map(function (x, i) { return [String(i + 1), x.code, x.subject || '', x.a + '/' + x.n, RiskDoc.pct(x), x.ev.label]; })};
  },

  // ---------- PDF (หน้าพิมพ์) ----------
  css: function () {
    var u = function (p) { return new URL(p, location.href).href; };
    return '@font-face{font-family:THSN;src:url("' + u('fonts/THSarabunNew.ttf') + '")}@font-face{font-family:THSN;font-weight:bold;src:url("' + u('fonts/THSarabunNew-Bold.ttf') + '")}' +
      '@page{size:A4;margin:14mm 16mm 10mm 24mm}*{box-sizing:border-box}body{margin:0;font-family:THSN,"TH Sarabun New",sans-serif;font-size:15.5pt;line-height:1.22;color:#000}' +
      '.pg{page-break-after:always}.pg:last-child{page-break-after:auto}p{margin:0}.ind{text-indent:25mm;text-align:justify}.c{text-align:center}.r{text-align:right}' +
      'h1{font-size:28pt;text-align:center;margin:-13mm 0 2mm}.krut{width:14mm;display:block}.logo{width:19mm;display:block;margin:0 auto}' +
      'table.t{width:100%;border-collapse:collapse;font-size:13.5pt;margin:2mm 0}.t td:nth-child(2){white-space:nowrap}.t th{border:1px solid #000;background:#e7e6e6;padding:.6mm 1.5mm}.t td{border:1px solid #000;padding:.4mm 1.5mm;vertical-align:top}.t tr{page-break-inside:avoid}' +
      '.sig{margin:4mm 0 0 75mm;text-align:center}.ln{border-bottom:1px dotted #000;height:7mm}.cut{border-top:1.5px dashed #000;margin:6mm 0 3mm;text-align:center;font-size:13pt}.cut span{position:relative;top:-3.2mm;background:#fff;padding:0 3mm}';
  },
  pdfWin: function (title, body) {
    var w = window.open('', '_blank'); if (!w) { toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาตป๊อปอัป', 'err'); return; }
    w.document.open(); w.document.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + this.css() + '</style></head><body>' + body + '</body></html>'); w.document.close();
    var go = function () {
      var imgs = Array.prototype.slice.call(w.document.images);
      Promise.all([w.document.fonts ? w.document.fonts.ready : 0].concat(imgs.map(function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); })))
        .then(function () { setTimeout(function () { w.focus(); w.print(); }, 300); });
    };
    if (w.document.readyState === 'complete') go(); else w.onload = go;
  },
  table: function (head, rows, left) {
    return '<table class="t"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (left.indexOf(i) >= 0 ? '' : ' class="c"') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  },
  memoHTML: function (m) {
    var u = function (p) { return new URL(p, location.href).href; };
    return '<section class="pg"><img class="krut" src="' + u('img/krut.png') + '" alt=""><h1>บันทึกข้อความ</h1>' +
      '<p><b>ส่วนราชการ</b>  ' + RISK_SCHOOL + '  ' + RISK_ADDR + '</p><p><b>ที่</b> ............../' + esc(m.M.year) + '<span style="margin-left:45mm"><b>วันที่</b> ' + thDate(m.M.today) + '</span></p>' +
      '<p><b>เรื่อง</b>  รายงานนักเรียนที่มีเวลาเรียนไม่ถึงเกณฑ์ (กลุ่มเสี่ยง)</p><hr><p><b>เรียน</b>  ผู้อำนวยการ' + RISK_SCHOOL + '</p>' +
      '<p><b>สิ่งที่ส่งมาด้วย</b>  ตารางรายชื่อนักเรียนกลุ่มเสี่ยง จำนวน 1 ชุด</p><p class="ind" style="margin-top:2mm">' + esc(m.body1) + '</p>' +
      this.table(m.head, m.rows, [1, 8]) + '<p class="ind">' + esc(m.body2) + '</p><p class="ind">จึงเรียนมาเพื่อโปรดทราบและพิจารณา</p>' +
      '<p class="sig">ลงชื่อ ' + R_DOTS + '<br>(' + esc(me.name) + ')<br>ผู้รายงาน</p>' +
      '<div style="margin-top:4mm"><b>ความคิดเห็นของผู้อำนวยการโรงเรียน</b><div class="ln"></div><div class="ln"></div>' +
      '<p class="sig">ลงชื่อ ' + R_DOTS + '<br>(' + esc(RISK_DIRECTOR.name) + ')<br>' + RISK_DIRECTOR.pos.map(esc).join('<br>') + '</p></div></section>';
  },
  letterHTML: function (m) {
    var u = function (p) { return new URL(p, location.href).href; }, s = m.s, adv = m.adv.length ? m.adv : [R_DOTS];
    return '<section class="pg"><img class="logo" src="' + u('img/school-logo.jpg') + '" alt="">' +
      '<p style="display:flex;justify-content:space-between;margin-top:2mm"><span>ที่ ศธ ............../' + esc(m.M.year) + '</span><span class="r">' + RISK_SCHOOL + '<br>' + RISK_ADDR + '</span></p>' +
      '<p style="margin:2mm 0 2mm 85mm">' + thDate(m.M.today) + '</p><p><b>เรื่อง</b>  แจ้งผลการมาเรียนของนักเรียน</p><p><b>เรียน</b>  ผู้ปกครองของ ' + esc(s.name) + '</p>' +
      '<p class="ind" style="margin-top:3mm">' + esc(m.body1) + '</p>' + this.table(m.head, m.rows, [2]) + '<p class="ind">' + esc(m.body2) + '</p>' +
      '<p class="ind" style="margin-top:2mm">จึงเรียนมาเพื่อโปรดทราบและให้ความร่วมมือ</p><p class="c" style="margin:5mm 0 0 75mm">ขอแสดงความนับถือ</p>' +
      '<div style="display:flex;justify-content:space-around;text-align:center;margin-top:5mm">' + adv.slice(0, 2).map(function (n) { return '<p>ลงชื่อ ' + R_DOTS + '<br>(' + esc(n) + ')<br>ครูที่ปรึกษา</p>'; }).join('') + '</div>' +
      '<div class="cut"><span>✂ ตัดส่วนนี้ส่งคืนครูที่ปรึกษา</span></div><p class="c"><b>ใบตอบรับ</b></p>' +
      '<p class="ind">ข้าพเจ้า ' + R_DOTS + ' ผู้ปกครองของ ' + esc(s.name) + ' ชั้น ' + esc(s.room) + ' เลขที่ ' + esc(s.no) + ' ได้รับทราบผลการมาเรียนของนักเรียนแล้ว และจะกำกับดูแลให้นักเรียนมาเรียนอย่างสม่ำเสมอ</p>' +
      '<p class="sig" style="margin-top:4mm">ลงชื่อ ' + R_DOTS + ' ผู้ปกครอง<br>(' + R_DOTS + ')<br>วันที่ ........./................/.........</p></section>';
  },

  // ---------- Word (.docx) ----------
  lib: function () {
    return window.docx ? Promise.resolve() : new Promise(function (ok, no) { var s = document.createElement('script'); s.src = RISK_DOCX; s.onload = ok; s.onerror = function () { no(new Error('โหลดตัวสร้างไฟล์ Word ไม่สำเร็จ')); }; document.head.appendChild(s); });
  },
  bin: function (url) { return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }); },
  K: function () {
    var D = window.docx, F = 'TH Sarabun New', C = D.AlignmentType.CENTER, J = D.AlignmentType.THAI_DISTRIBUTE || D.AlignmentType.JUSTIFIED;
    var R = function (t, o) { return new D.TextRun(Object.assign({text: t, font: F}, o || {})); };
    var P = function (runs, o) { return new D.Paragraph(Object.assign({children: (Array.isArray(runs) ? runs : [runs]).map(function (r) { return typeof r === 'string' ? R(r) : r; }), spacing: {after: 0, line: 240}}, o || {})); };
    var none = {style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF'}, NB = {top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none};
    var cell = function (ps, o) { return new D.TableCell(Object.assign({children: ps, margins: {top: 20, bottom: 20, left: 60, right: 60}}, o || {})); };
    var table = function (head, rows, widths, left) {
      var S = 28, tot = widths.reduce(function (a, b) { return a + b; }, 0);
      return new D.Table({width: {size: tot, type: D.WidthType.DXA}, columnWidths: widths, rows: [new D.TableRow({tableHeader: true, children: head.map(function (h, i) { return cell([P(R(h, {bold: true, size: S}), {alignment: C})], {shading: {fill: 'E7E6E6'}, width: {size: widths[i], type: D.WidthType.DXA}, verticalAlign: D.VerticalAlign.CENTER}); })})]
        .concat(rows.map(function (r) { return new D.TableRow({cantSplit: true, children: r.map(function (c, i) { return cell([P(R(String(c), {size: S}), {alignment: left.indexOf(i) >= 0 ? D.AlignmentType.LEFT : C})], {width: {size: widths[i], type: D.WidthType.DXA}}); })}); }))});
    };
    var sig = function (lines, indent) { return lines.map(function (t, j) { return P(t, {alignment: C, indent: {left: indent == null ? 4536 : indent}, spacing: {before: j === 0 ? 300 : 0, after: 0}}); }); };
    return {D: D, F: F, C: C, J: J, R: R, P: P, NB: NB, cell: cell, table: table, sig: sig};
  },
  page: function (kids) { var D = window.docx; return {properties: {page: {size: {width: 11906, height: 16838}, margin: {top: 1021, bottom: 851, left: 1418, right: 1021}}}, children: kids}; },
  save: function (sections, name) {
    var D = window.docx, doc = new D.Document({creator: 'WPP Student Attendance', styles: {default: {document: {run: {font: 'TH Sarabun New', size: 32}}}}, sections: sections});
    return D.Packer.toBlob(doc).then(function (blob) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.docx'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    });
  },
  memoDocx: function (m, krut) {
    var k = this.K(), D = k.D, P = k.P, R = k.R, kids = [];
    kids.push(P(new D.ImageRun({data: krut, transformation: {width: 56, height: 62}}), {spacing: {after: 0}}));
    kids.push(P(R('บันทึกข้อความ', {bold: true, size: 58}), {alignment: k.C, spacing: {after: 120}}));
    kids.push(P([R('ส่วนราชการ', {bold: true, size: 36}), '  ' + RISK_SCHOOL + '  ' + RISK_ADDR]));
    kids.push(P([R('ที่', {bold: true, size: 36}), ' ............../' + m.M.year + '\t\t\t\t', R('วันที่', {bold: true, size: 36}), '  ' + thDate(m.M.today)]));
    kids.push(P([R('เรื่อง', {bold: true, size: 36}), '  รายงานนักเรียนที่มีเวลาเรียนไม่ถึงเกณฑ์ (กลุ่มเสี่ยง)'], {border: {bottom: {style: D.BorderStyle.SINGLE, size: 6, color: '000000'}}, spacing: {after: 120}}));
    kids.push(P([R('เรียน', {bold: true}), '   ผู้อำนวยการ' + RISK_SCHOOL], {spacing: {after: 60}}));
    kids.push(P([R('สิ่งที่ส่งมาด้วย', {bold: true}), '   ตารางรายชื่อนักเรียนกลุ่มเสี่ยง จำนวน 1 ชุด'], {spacing: {after: 60}}));
    kids.push(P(m.body1, {indent: {firstLine: 1418}, alignment: k.J, spacing: {after: 100}}));
    kids.push(k.table(m.head, m.rows, [450, 2100, 650, 550, 950, 750, 850, 1300, 1867], [1, 8]));
    kids.push(P(m.body2, {indent: {firstLine: 1418}, alignment: k.J, spacing: {before: 120}}));
    kids.push(P('จึงเรียนมาเพื่อโปรดทราบและพิจารณา', {indent: {firstLine: 1418}}));
    k.sig(['ลงชื่อ ' + R_DOTS, '(' + me.name + ')', 'ผู้รายงาน']).forEach(function (p) { kids.push(p); });
    kids.push(P(R('ความคิดเห็นของผู้อำนวยการโรงเรียน', {bold: true}), {spacing: {before: 300}}));
    kids.push(P('…………………………………………………………………………………………………………………………………'));
    kids.push(P('…………………………………………………………………………………………………………………………………'));
    k.sig(['ลงชื่อ ' + R_DOTS, '(' + RISK_DIRECTOR.name + ')'].concat(RISK_DIRECTOR.pos)).forEach(function (p) { kids.push(p); });
    return this.page(kids);
  },
  letterDocx: function (m, logo) {
    var k = this.K(), D = k.D, P = k.P, R = k.R, kids = [], adv = m.adv.length ? m.adv : [R_DOTS], s = m.s;
    kids.push(P(new D.ImageRun({data: logo, transformation: {width: 90, height: 90}}), {alignment: k.C, spacing: {after: 60}}));
    kids.push(new D.Table({width: {size: 9467, type: D.WidthType.DXA}, borders: k.NB, rows: [new D.TableRow({children: [
      k.cell([P('ที่ ศธ ............../' + m.M.year)], {borders: k.NB, width: {size: 4700, type: D.WidthType.DXA}}),
      k.cell([P(RISK_SCHOOL, {alignment: D.AlignmentType.RIGHT}), P(RISK_ADDR, {alignment: D.AlignmentType.RIGHT})], {borders: k.NB, width: {size: 4767, type: D.WidthType.DXA}})]})]}));
    kids.push(P(thDate(m.M.today), {indent: {left: 4800}, spacing: {before: 160, after: 160}}));
    kids.push(P([R('เรื่อง', {bold: true}), '  แจ้งผลการมาเรียนของนักเรียน']));
    kids.push(P([R('เรียน', {bold: true}), '  ผู้ปกครองของ ' + s.name], {spacing: {after: 120}}));
    kids.push(P(m.body1, {indent: {firstLine: 1418}, alignment: k.J, spacing: {after: 100}}));
    kids.push(k.table(m.head, m.rows, [500, 1250, 3100, 1600, 1300, 1717], [2]));
    kids.push(P(m.body2, {indent: {firstLine: 1418}, alignment: k.J, spacing: {before: 120}}));
    kids.push(P('จึงเรียนมาเพื่อโปรดทราบและให้ความร่วมมือ', {indent: {firstLine: 1418}, spacing: {before: 80}}));
    kids.push(P('ขอแสดงความนับถือ', {alignment: k.C, indent: {left: 4536}, spacing: {before: 240}}));
    kids.push(new D.Table({width: {size: 9467, type: D.WidthType.DXA}, borders: k.NB, rows: [new D.TableRow({children: adv.slice(0, 2).map(function (n) {
      return k.cell(k.sig(['ลงชื่อ ' + R_DOTS, '(' + n + ')', 'ครูที่ปรึกษา'], 0), {borders: k.NB, width: {size: Math.floor(9467 / Math.min(2, adv.length)), type: D.WidthType.DXA}}); })})]}));
    kids.push(P(R('✂ ----------------------------- ตัดส่วนนี้ส่งคืนครูที่ปรึกษา -----------------------------', {size: 26}), {alignment: k.C, spacing: {before: 360, after: 120}}));
    kids.push(P(R('ใบตอบรับ', {bold: true}), {alignment: k.C}));
    kids.push(P('ข้าพเจ้า ' + R_DOTS + ' ผู้ปกครองของ ' + s.name + ' ชั้น ' + s.room + ' เลขที่ ' + s.no + ' ได้รับทราบผลการมาเรียนของนักเรียนแล้ว และจะกำกับดูแลให้นักเรียนมาเรียนอย่างสม่ำเสมอ', {indent: {firstLine: 1418}, alignment: k.J}));
    k.sig(['ลงชื่อ ' + R_DOTS + ' ผู้ปกครอง', '(' + R_DOTS + ')', 'วันที่ ........./................/.........']).forEach(function (p) { kids.push(p); });
    return this.page(kids);
  },

  // ---------- ปุ่ม ----------
  memo: function (fmt) {
    var R = this, list = R.get(); if (!list) return;
    var m = R.memoModel(list), name = 'รายงานกลุ่มเสี่ยง-' + m.scope.replace(/[\/\s,]+/g, '-') + '-' + m.M.end;
    if (fmt === 'pdf') return R.pdfWin(name, R.memoHTML(m));
    loading(true, 'กำลังสร้างไฟล์ Word…');
    Promise.all([R.lib(), R.bin('img/krut.png')]).then(function (v) { return R.save([R.memoDocx(m, v[1])], name); }).then(function () { loading(false); toast('สร้างบันทึกข้อความแล้ว ✓'); }).catch(fail);
  },
  letters: function (fmt) {
    var R = this, list = R.get(); if (!list) return;
    var studs = R.students(list), name = 'หนังสือแจ้งผู้ปกครอง-' + R.scope(list).replace(/[\/\s,]+/g, '-') + '-' + R.meta().end;
    if (studs.length > 60 && !confirm('จะสร้างหนังสือ ' + studs.length + ' ฉบับ ใช้เวลาสักครู่ ดำเนินการต่อ?')) return;
    if (fmt === 'pdf') return R.pdfWin(name, studs.map(function (s) { return R.letterHTML(R.letterModel(s)); }).join(''));
    loading(true, 'กำลังสร้างหนังสือ ' + studs.length + ' ฉบับ…');
    Promise.all([R.lib(), R.bin('img/school-logo.jpg')]).then(function (v) { return R.save(studs.map(function (s) { return R.letterDocx(R.letterModel(s), v[1]); }), name); })
      .then(function () { loading(false); toast('สร้างหนังสือแจ้งผู้ปกครอง ' + studs.length + ' ฉบับ ✓'); }).catch(fail);
  }
};
