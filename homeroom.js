/* WPP — เล่มบันทึกกิจกรรมโฮมรูม (ส่งออก Word / PDF, ฟอนต์ TH Sarabun New)
 * ต้นแบบเล่ม: นางสาวนลินี กาศแสวง
 * ใช้คู่กับ area.js (ต้องโหลดหลัง area.js)
 * ข้อมูล: p_area.hr (หัวหน้าห้องติ๊กหัวข้อ + รูป) · การเข้าเรียน: p_class คาบ HR → ถ้าไม่มีใช้ p_daily.morning
 */
var SCHOOL = 'โรงเรียนวังโพรงพิทยาคม';
var SIGNERS = [ // แก้ชื่อผู้ลงนามได้ที่นี่
  {title: 'ความคิดเห็นของหัวหน้างานระบบดูแลช่วยเหลือนักเรียน', name: 'นางสาวนลินี  กาศแสวง', pos: []},
  {title: 'ความคิดเห็นของหัวหน้าฝ่ายบริหารทั่วไป', name: 'นายพิสันต์  สายโรจน์', pos: []},
  {title: 'ความคิดเห็นของผู้อำนวยการโรงเรียน', name: 'นางสาวสมใจ  จันทรงกรด', pos: ['ครูชำนาญการพิเศษ รักษาการในตำแหน่ง', 'ผู้อำนวยการโรงเรียนวังโพรงพิทยาคม']}
];
var LOCK_ST = ['ขาดเรียนนาน', 'พักการเรียน', 'ลาออก', 'ไม่มีตัวตน'];
var DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
var DOTS = '..................................................';

function shortTh(d) { var a = d.split('-'); return (+a[2]) + ' ' + TH_M[+a[1] - 1] + ' ' + String(+a[0] + 543).slice(2); }
function lvl(room) { var m = /ม\.?\s*(\d)\s*\/?\s*(\d*)/.exec(room); return m ? m[1] + (m[2] ? '/' + m[2] : '') : room; }
function mondayOf(d) { var x = new Date(d + 'T00:00:00Z'), w = x.getUTCDay(); x.setUTCDate(x.getUTCDate() - (w === 0 ? 6 : w - 1)); return x.getTime(); }
function absUrl(p) { return new URL(p, location.href).href; }

// ---------- ข้อมูลครู / ครูที่ปรึกษา ----------
var HR = {teachers: null, advisors: null, rooms: null};
function hrTeachers() {
  if (HR.teachers) return Promise.resolve(HR.teachers);
  return db.collection('teachers').get().then(function (q) { var m = {}; q.forEach(function (d) { if (d.data().active !== false) m[d.id] = d.data().name || d.id; }); return (HR.teachers = m); });
}
function hrAdvisors(force) {
  if (HR.advisors && !force) return Promise.resolve(HR.advisors);
  return db.doc('p_settings/advisors').get().then(function (s) { return (HR.advisors = s.exists ? s.data().byRoom || {} : {}); });
}

// ---------- แอดมิน: กำหนดครูที่ปรึกษา ----------
var Advisors = {
  show: function (box) {
    loading(true);
    Promise.all([hrTeachers(), hrAdvisors(true)]).then(function (v) {
      loading(false);
      var T = v[0], A = v[1], emails = Object.keys(T).sort(function (a, b) { return T[a].localeCompare(T[b], 'th'); });
      var opt = function (cur) { return '<option value="">— ไม่ระบุ —</option>' + emails.map(function (e) { return '<option value="' + esc(e) + '"' + (e === cur ? ' selected' : '') + '>' + esc(T[e]) + '</option>'; }).join(''); };
      box.innerHTML = '<div class="card"><h2>👩‍🏫 ครูที่ปรึกษาประจำห้อง</h2><div class="muted">ห้องละไม่เกิน 2 คน · ใช้กับเล่มบันทึกโฮมรูม และครูที่ปรึกษาจะเห็นห้องของตัวเองก่อน</div>' +
        '<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>ห้อง</th><th>ครูที่ปรึกษา 1</th><th>ครูที่ปรึกษา 2</th></tr></thead><tbody>' +
        Staff.rooms.map(function (r) { var a = A[roomId(r)] || []; return '<tr><td><b>' + esc(r) + '</b></td><td><select data-r="' + esc(roomId(r)) + '" data-i="0">' + opt(a[0]) + '</select></td><td><select data-r="' + esc(roomId(r)) + '" data-i="1">' + opt(a[1]) + '</select></td></tr>'; }).join('') +
        '</tbody></table></div><button class="btn pri" style="width:100%;margin-top:12px" id="advSave">💾 บันทึกครูที่ปรึกษา</button></div>' +
        '<div class="card"><h2>🏠 ผู้บันทึกกิจกรรมโฮมรูม</h2><div class="muted">ใครเป็นคนติ๊กหัวข้อที่อบรม + แนบรูป (ใช้ทั้งโรงเรียน)</div><div class="stack" style="margin-top:10px">' +
        [['leader', '🧑‍🎓 หัวหน้าห้อง', 'หัวหน้าห้องบันทึกในหน้าส่งงาน'], ['advisor', '👩‍🏫 ครูที่ปรึกษา', 'ครูบันทึกที่แท็บ 🏠 บันทึกโฮมรูม · หัวหน้าห้องไม่เห็นช่องโฮมรูม'], ['both', '🤝 ทั้งสองคน', 'ใครบันทึกก่อนก็ได้ แก้ไขต่อกันได้']].map(function (o) {
          return '<label class="tr"><input type="radio" name="hrBy" value="' + o[0] + '"' + (HR_BY === o[0] ? ' checked' : '') + '> <span><b>' + o[1] + '</b><br><small class="muted">' + o[2] + '</small></span></label>'; }).join('') +
        '</div><button class="btn pri" style="width:100%;margin-top:10px" id="hrBySave">💾 บันทึกผู้บันทึกโฮมรูม</button></div>';
      $('hrBySave').onclick = function () {
        var v = (box.querySelector('input[name=hrBy]:checked') || {}).value || 'leader';
        loading(true); db.doc('p_settings/hr').set({by: v}).then(function () { loading(false); HR_BY = v; toast('บันทึกแล้ว ✓'); Staff.tab = 'adv'; Staff.show(); }).catch(fail);
      };
      $('advSave').onclick = function () {
        var by = {};
        box.querySelectorAll('select[data-r]').forEach(function (s) { if (s.value) { (by[s.dataset.r] = by[s.dataset.r] || []); if (by[s.dataset.r].indexOf(s.value) < 0) by[s.dataset.r].push(s.value); } });
        loading(true); db.doc('p_settings/advisors').set({byRoom: by}).then(function () { loading(false); HR.advisors = by; toast('บันทึกครูที่ปรึกษาแล้ว ✓'); }).catch(fail);
      };
    }).catch(fail);
  }
};

// ---------- เล่มบันทึกโฮมรูม ----------
var Book = {
  data: null,
  show: function (box) {
    var B = this;
    hrAdvisors().catch(function () { return {}; }).then(function (A) {
      var mine = Staff.rooms.filter(function (r) { return (A[roomId(r)] || []).indexOf(me.email) >= 0; });
      var list = me.role === 'admin' ? Staff.rooms : (mine.length ? mine : Staff.rooms);
      var others = list.filter(function (r) { return mine.indexOf(r) < 0; });
      box.innerHTML = '<div class="card"><h2>📘 เล่มบันทึกกิจกรรมโฮมรูม</h2><div class="muted">สร้างเล่มจากข้อมูลที่หัวหน้าห้องบันทึก + ผลเช็คชื่อคาบโฮมรูม ส่งออกเป็น Word หรือ PDF (TH Sarabun New)<br>📄 ต้นแบบเล่มบันทึกโฮมรูม: นางสาวนลินี กาศแสวง</div>' +
        '<div class="row" style="margin-top:10px"><div style="flex:1;min-width:140px"><label for="bRoom">ห้อง</label><select id="bRoom">' +
        (mine.length ? '<optgroup label="ห้องที่ปรึกษาของฉัน">' + mine.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</optgroup>' : '') +
        (others.length ? '<optgroup label="ห้องอื่น">' + others.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</optgroup>' : '') + '</select></div>' +
        '<div style="flex:1;min-width:120px"><label for="bTerm">ภาคเรียน</label><input id="bTerm" value="' + esc(termFor(today())) + '"></div></div>' +
        '<label class="tr" style="margin-top:10px"><input type="checkbox" id="bPics" checked> แนบภาพประกอบท้ายเล่ม</label>' +
        '<button class="btn pri" style="width:100%;margin-top:10px" id="bLoad">🔍 ดึงข้อมูล</button><div id="bOut"></div></div>';
      $('bLoad').onclick = function () { B.load(); };
    });
  },
  load: function () {
    var B = this, room = $('bRoom').value, rid = roomId(room), term = $('bTerm').value.trim();
    loading(true, 'กำลังรวบรวมข้อมูลทั้งภาคเรียน…');
    Promise.all([
      db.doc('p_students/' + rid).get(),
      db.collection('p_area').where('roomId', '==', rid).get(),
      db.collection('p_daily').where('roomId', '==', rid).get(),
      db.collection('p_class').where('roomId', '==', rid).where('period', '==', 'HR').get(),
      hrAdvisors(), hrTeachers()
    ]).then(function (v) {
      loading(false);
      var studs = ((v[0].exists && v[0].data().students) || []).filter(function (s) { return !s.hidden && LOCK_ST.indexOf(s.status) < 0; });
      var area = {}, daily = {}, cls = {};
      v[1].forEach(function (d) { var x = d.data(); if (termFor(x.date) === term) area[x.date] = x; });
      v[2].forEach(function (d) { var x = d.data(); if (termFor(x.date) === term && x.morning) daily[x.date] = x.morning; });
      v[3].forEach(function (d) { var x = d.data(); if (termFor(x.date) === term && !x.group) cls[x.date] = x.records || []; });
      var dates = {};
      Object.keys(area).forEach(function (k) { var a = area[k]; if (a.hr || ((a.photos || {}).hr || []).length) dates[k] = 1; });
      Object.keys(daily).concat(Object.keys(cls)).forEach(function (k) { dates[k] = 1; });
      dates = Object.keys(dates).filter(function (d) { var w = new Date(d + 'T00:00:00Z').getUTCDay(); return w >= 1 && w <= 5; }).sort();
      var days = dates.map(function (d) {
        var rows = null;
        if (cls[d]) rows = cls[d];
        else if (daily[d]) rows = studs.map(function (s) { return {no: s.no, name: s.name, status: daily[d][String(s.no).trim() + '|' + String(s.name).trim()] || 'มา'}; });
        var c = null, absent = [];
        if (rows) {
          rows = rows.filter(function (r) { return LOCK_ST.indexOf(r.status) < 0; });
          c = {total: rows.length, come: 0, abs: 0, sick: 0, biz: 0, act: 0};
          rows.forEach(function (r) {
            var s = r.status;
            if (s === 'มา' || s === 'สาย') c.come++; else if (s === 'ขาด' || s === 'โดด') { c.abs++; absent.push(r); }
            else if (s === 'ลาป่วย') c.sick++; else if (s === 'ลากิจ') c.biz++; else if (s === 'กิจกรรม') c.act++;
          });
        }
        var hr = (area[d] || {}).hr || {};
        return {date: d, topics: hr.topics || [], other: hr.other || '', cnt: c, absent: absent.sort(function (a, b) { return (+a.no || 0) - (+b.no || 0); }), photos: ((area[d] || {}).photos || {}).hr || []};
      });
      var weeks = [], m0 = dates.length ? mondayOf(dates[0]) : 0;
      days.forEach(function (x) { var w = Math.floor((mondayOf(x.date) - m0) / 6048e5) + 1; var last = weeks[weeks.length - 1]; if (!last || last.no !== w) weeks.push(last = {no: w, days: []}); last.days.push(x); });
      var tp = term.split('/'), A = v[4][rid] || [], T = v[5];
      B.data = {room: room, rid: rid, term: term, sem: tp[0] || '', year: tp[1] || '', cls: lvl(room), advisors: A.map(function (e) { return T[e] || e; }),
        students: studs.length, weeks: weeks, days: days, pics: $('bPics').checked,
        photos: [].concat.apply([], days.map(function (x) { return x.photos.map(function (p) { return {id: p.id, date: x.date}; }); }))};
      B.preview();
    }).catch(fail);
  },
  preview: function () {
    var d = this.data, noTopic = d.days.filter(function (x) { return !x.topics.length && !x.other; }).length, noAtt = d.days.filter(function (x) { return !x.cnt; }).length;
    $('bOut').innerHTML = !d.days.length ? '<div class="note warn">ยังไม่มีข้อมูลโฮมรูมของ ' + esc(d.room) + ' ภาคเรียน ' + esc(d.term) + '</div>' :
      '<div class="sum" style="margin-top:12px"><div>📅<b>' + d.days.length + '</b><span class="muted">วัน · ' + d.weeks.length + ' สัปดาห์</span></div><div>📝<b>' + (d.days.length - noTopic) + '</b><span class="muted">วันที่บันทึกหัวข้อ</span></div><div>📷<b>' + d.photos.length + '</b><span class="muted">ภาพประกอบ</span></div></div>' +
      (d.advisors.length ? '' : '<div class="note warn">ห้องนี้ยังไม่ได้กำหนดครูที่ปรึกษา (แอดมิน → แท็บครูที่ปรึกษา) ในเล่มจะเว้นชื่อเป็นจุดไข่ปลา</div>') +
      (noTopic ? '<div class="note info">' + noTopic + ' วันยังไม่มีหัวข้ออบรม จะแสดงเป็นช่องว่างให้ติ๊กด้วยมือ</div>' : '') +
      (noAtt ? '<div class="note info">' + noAtt + ' วันไม่มีผลเช็คชื่อ ช่องจำนวนนักเรียนจะเว้นว่าง</div>' : '') +
      '<div class="row"><button class="btn pri" style="flex:1" onclick="Book.word()">📄 ส่งออก Word</button><button class="btn pri" style="flex:1" onclick="Book.pdf()">🖨️ ส่งออก PDF</button></div>' +
      '<p class="muted">PDF: หน้าต่างพิมพ์จะเปิดขึ้น เลือก "บันทึกเป็น PDF" · กระดาษ A4</p>';
  },

  // ---------- PDF (หน้าพิมพ์ของเบราว์เซอร์) ----------
  pdf: function () {
    var d = this.data, w = window.open('', '_blank');
    if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาตป๊อปอัป', 'err');
    var ck = function (on) { return on ? '☑' : '☐'; };
    var adv = function (i) { return d.advisors[i] || DOTS; };
    var signs = '<table class="sg"><tr><td>ลงชื่อ ' + DOTS + ' ครูที่ปรึกษา<br>(' + adv(0) + ')</td><td>ลงชื่อ ' + DOTS + ' ครูที่ปรึกษา<br>(' + adv(1) + ')</td></tr></table>';
    var head = '<div class="wh">แบบบันทึกการเข้าร่วมกิจกรรมโฮมรูม (Homeroom) ' + SCHOOL + '<br>ชั้นมัธยมศึกษาปีที่ ' + esc(d.cls) + '  ภาคเรียนที่ ' + esc(d.sem) + '  ปีการศึกษา ' + esc(d.year) + '</div>';
    var weeks = d.weeks.map(function (wk) {
      return '<section class="wk">' + head + '<table class="t"><thead><tr><th style="width:9%">สัปดาห์ที่</th><th style="width:14%">วัน/เดือน/ปี</th><th>เรื่อง/รายการที่อบรม</th><th style="width:30%">หมายเหตุ</th></tr></thead><tbody>' +
        wk.days.map(function (x, i) {
          var c = x.cnt, n = function (k) { return c ? c[k] : '......'; };
          return '<tr><td class="c">' + (i === 0 ? wk.no : '') + '</td><td class="c">' + shortTh(x.date) + '</td><td><div class="tg">' +
            TRAITS.map(function (t) { return '<span>' + ck(x.topics.indexOf(t) >= 0) + ' ' + esc(t) + '</span>'; }).join('') + '</div>' +
            '<div>' + ck(!!x.other) + ' อื่นๆ ' + (x.other ? esc(x.other) : '.............................................') + '</div></td>' +
            '<td>นักเรียนทั้งหมด ' + n('total') + ' คน<br>มา ' + n('come') + ' คน &nbsp;ขาด ' + n('abs') + ' คน<br>ลาป่วย ' + n('sick') + ' คน &nbsp;ลากิจ ' + n('biz') + ' คน<br>กิจกรรม ' + n('act') + ' คน' +
            '<br><b>รายชื่อนักเรียนที่ขาด</b><br>' + (x.absent.length ? x.absent.map(function (r) { return esc(r.no) + '. ' + esc(r.name); }).join('<br>') : (c ? '-' : '..................................')) + '</td></tr>';
        }).join('') + '</tbody></table>' + signs + '</section>';
    }).join('');
    var pics = d.pics && d.photos.length ? '<section class="pg"><h2 class="ph">ภาพประกอบการจัดกิจกรรมโฮมรูม (HOME ROOM)</h2><div class="gal">' +
      d.photos.map(function (p) { return '<figure><img src="' + thumb(p.id, 1000) + '" alt=""><figcaption>' + thDate(p.date) + '</figcaption></figure>'; }).join('') + '</div></section>' : '';
    var html = '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>บันทึกกิจกรรมโฮมรูม ' + esc(d.room) + ' ' + esc(d.term) + '</title><style>' +
      '@font-face{font-family:"THSN";src:url("' + absUrl('fonts/THSarabunNew.ttf') + '")}@font-face{font-family:"THSN";font-weight:bold;src:url("' + absUrl('fonts/THSarabunNew-Bold.ttf') + '")}' +
      '@page{size:A4;margin:15mm 15mm 15mm 18mm}*{box-sizing:border-box}body{margin:0;font-family:"THSN","TH Sarabun New",sans-serif;font-size:16pt;line-height:1.25;color:#000}' +
      '.pg{page-break-after:always}.pg:last-child{page-break-after:auto}.cover{text-align:center;height:255mm;display:flex;flex-direction:column;justify-content:space-between;padding:10mm 0}' +
      '.cover h1{font-size:26pt;margin:6mm 0 0}.cover .big{font-size:22pt;font-weight:bold;line-height:1.5}.krut{display:block;width:16mm}.memo h1{text-align:center;font-size:29pt;margin:-14mm 0 2mm}' +
      '.memo p{margin:0}.memo .ind{text-indent:25mm}.memo .sig{margin:4mm 0 0 80mm;text-align:center}.memo .cm{margin-top:2mm}.memo .cm .ln{border-bottom:1px dotted #000;height:8mm}.memo .sig{margin-top:2mm}' +
      '.wk{page-break-before:always}.wh{text-align:center;font-weight:bold;border:1.5px solid #555;padding:1mm 3mm;margin:0 auto 3mm;width:fit-content}' +
      '.t{width:100%;border-collapse:collapse;font-size:14pt}.t th{background:#e7e6e6;border:1px solid #000;padding:1mm}.t td{border:1px solid #000;padding:1mm 2mm;vertical-align:top}.t tr{page-break-inside:avoid}.t .c{text-align:center}' +
      '.tg{display:grid;grid-template-columns:1fr 1fr;column-gap:3mm}.sg{width:100%;margin-top:6mm;text-align:center}.sg td{width:50%}' +
      '.ph{text-align:center;font-size:20pt;margin:0 0 5mm}.gal{display:grid;grid-template-columns:1fr 1fr;gap:5mm}figure{margin:0;page-break-inside:avoid;text-align:center}figure img{width:100%;height:62mm;object-fit:cover;border:1px solid #999}figcaption{font-size:14pt}' +
      '</style></head><body>' +
      '<section class="pg cover"><div><img src="' + absUrl('img/school-logo.jpg') + '" style="width:42mm" alt=""><h1>บันทึกกิจกรรมโฮมรูม (HOME ROOM)</h1><div class="big">ภาคเรียนที่ ' + esc(d.sem) + ' ปีการศึกษา ' + esc(d.year) + '<br>ชั้นมัธยมศึกษาปีที่ ' + esc(d.cls) + '</div></div>' +
      '<div class="big">คุณครูที่ปรึกษา<br>' + (d.advisors.length ? d.advisors.map(esc).join('<br>') : DOTS + '<br>' + DOTS) + '</div><div class="big">' + SCHOOL + '<br><span style="font-size:18pt;font-weight:normal">สังกัดสำนักงานเขตพื้นที่การศึกษามัธยมศึกษาพิษณุโลก อุตรดิตถ์<br>สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน กระทรวงศึกษาธิการ</span></div></section>' +
      '<section class="pg memo"><img class="krut" src="' + absUrl('img/krut.png') + '" alt=""><h1>บันทึกข้อความ</h1>' +
      '<p><b>ส่วนราชการ</b>  ' + SCHOOL + '  อำเภอเนินมะปราง  จังหวัดพิษณุโลก</p><p><b>ที่</b> ............../' + esc(d.year) + ' <span style="margin-left:40mm"><b>วันที่</b> ..................................................</span></p>' +
      '<p><b>เรื่อง</b>  รายงานสรุปบันทึกการจัดกิจกรรมโฮมรูม (Home Room)</p><hr><p><b>เรียน</b>  ผู้อำนวยการ' + SCHOOL + '</p>' +
      '<p><b>สิ่งที่ส่งมาด้วย</b>  รายงานสรุปบันทึกการจัดกิจกรรมโฮมรูม ชั้นมัธยมศึกษาปีที่ ' + esc(d.cls) + ' ภาคเรียนที่ ' + esc(d.sem) + ' ปีการศึกษา ' + esc(d.year) + '</p>' +
      '<p class="ind">ด้วยข้าพเจ้า ' + (d.advisors.length ? d.advisors.map(esc).join(' และ ') : DOTS) + ' ตามคำสั่งแต่งตั้งให้ปฏิบัติหน้าที่ครูที่ปรึกษานักเรียนชั้นมัธยมศึกษาปีที่ ' + esc(d.cls) + ' ภาคเรียนที่ ' + esc(d.sem) + ' ปีการศึกษา ' + esc(d.year) + ' ได้ดำเนินการเสร็จสิ้นแล้ว</p>' +
      '<p class="ind">บัดนี้ได้สิ้นสุดระยะเวลาดำเนินการดังกล่าว ข้าพเจ้าขอรายงานบันทึกการจัดกิจกรรมโฮมรูม ภาคเรียนที่ ' + esc(d.sem) + ' ปีการศึกษา ' + esc(d.year) + ' จำนวน 1 เล่ม เพื่อเป็นข้อมูลพื้นฐานของโรงเรียน และเพื่อเป็นประโยชน์ต่อการนำไปใช้ในกลุ่มงานต่าง ๆ ที่เกี่ยวข้องต่อไป</p>' +
      '<p class="ind">จึงเรียนมาเพื่อโปรดทราบ</p>' +
      [0, 1].map(function (i) { return '<p class="sig">ลงชื่อ ' + DOTS + '<br>(' + adv(i) + ')<br>ครูที่ปรึกษา</p>'; }).join('') +
      SIGNERS.map(function (s) { return '<div class="cm"><b>' + s.title + '</b><div class="ln"></div><p class="sig">ลงชื่อ ' + DOTS + '<br>(' + s.name + ')' + s.pos.map(function (p) { return '<br>' + p; }).join('') + '</p></div>'; }).join('') +
      '</section>' + weeks + pics + '</body></html>';
    w.document.open(); w.document.write(html); w.document.close();
    var go = function () {
      var imgs = Array.prototype.slice.call(w.document.images);
      Promise.all([w.document.fonts ? w.document.fonts.ready : 0].concat(imgs.map(function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); })))
        .then(function () { setTimeout(function () { w.focus(); w.print(); }, 300); });
    };
    if (w.document.readyState === 'complete') go(); else w.onload = go;
  },

  // ---------- Word (.docx) ----------
  word: function () {
    var B = this, d = B.data;
    loading(true, 'กำลังสร้างไฟล์ Word…');
    var lib = window.docx ? Promise.resolve() : new Promise(function (ok, no) { var s = document.createElement('script'); s.src = DOCX_URL; s.onload = ok; s.onerror = function () { no(new Error('โหลดตัวสร้างไฟล์ Word ไม่สำเร็จ')); }; document.head.appendChild(s); });
    var bin = function (url) { return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }); };
    Promise.all([lib, bin('img/school-logo.jpg'), bin('img/krut.png'), d.pics ? B.fetchPhotos() : {}]).then(function (v) {
      return B.buildDocx(v[1], v[2], v[3]);
    }).then(function (blob) {
      loading(false);
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'บันทึกโฮมรูม-' + d.room.replace(/\//g, '-') + '-' + d.term.replace(/\//g, '-') + '.docx';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      toast('สร้างไฟล์ Word แล้ว ✓');
    }).catch(fail);
  },
  fetchPhotos: function () {
    var ids = this.data.photos.map(function (p) { return p.id; }), out = {}, chain = Promise.resolve(), done = 0;
    if (!ids.length) return Promise.resolve(out);
    if (!CFG.AREA_UPLOAD_URL) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า AREA_UPLOAD_URL'));
    for (var i = 0; i < ids.length; i += 6) (function (part) {
      chain = chain.then(function () { return auth.currentUser.getIdToken(); }).then(function (tok) {
        return fetch(CFG.AREA_UPLOAD_URL, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify({action: 'img', idToken: tok, ids: part})});
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || 'ดึงรูปไม่สำเร็จ');
        Object.keys(j.images || {}).forEach(function (k) { var s = atob(j.images[k]), u = new Uint8Array(s.length); for (var q = 0; q < s.length; q++) u[q] = s.charCodeAt(q); out[k] = u; });
        done += part.length; loading(true, 'กำลังดึงภาพประกอบ ' + done + '/' + ids.length + '…');
      });
    })(ids.slice(i, i + 6));
    return chain.then(function () { return out; });
  },
  buildDocx: function (logo, krut, photos) {
    var D = window.docx, d = this.data, F = 'TH Sarabun New';
    var R = function (t, o) { return new D.TextRun(Object.assign({text: t, font: F}, o || {})); };
    var P = function (runs, o) { return new D.Paragraph(Object.assign({children: (Array.isArray(runs) ? runs : [runs]).map(function (r) { return typeof r === 'string' ? R(r) : r; }), spacing: {after: 0, line: 240}}, o || {})); };
    var C = D.AlignmentType.CENTER, ck = function (on) { return on ? '☑ ' : '☐ '; };
    var none = {style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF'}, NB = {top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none};
    var line = {style: D.BorderStyle.SINGLE, size: 6, color: '000000'};
    var adv = function (i) { return d.advisors[i] || DOTS; };
    var sz = function (u8) { return new Promise(function (ok) { var im = new Image(), url = URL.createObjectURL(new Blob([u8])); im.onload = function () { ok({w: im.naturalWidth, h: im.naturalHeight}); URL.revokeObjectURL(url); }; im.onerror = function () { ok({w: 4, h: 3}); }; im.src = url; }); };
    var ids = Object.keys(photos);
    return Promise.all(ids.map(function (k) { return sz(photos[k]); })).then(function (dims) {
      var dim = {}; ids.forEach(function (k, i) { dim[k] = dims[i]; });
      var kids = [];
      // ปก
      kids.push(P(new D.ImageRun({data: logo, transformation: {width: 160, height: 160}}), {alignment: C, spacing: {before: 600}}));
      kids.push(P(R('บันทึกกิจกรรมโฮมรูม (HOME  ROOM)', {bold: true, size: 52}), {alignment: C, spacing: {before: 300}}));
      kids.push(P(R('ภาคเรียนที่ ' + d.sem + ' ปีการศึกษา ' + d.year, {bold: true, size: 44}), {alignment: C}));
      kids.push(P(R('ชั้นมัธยมศึกษาปีที่ ' + d.cls, {bold: true, size: 44}), {alignment: C}));
      kids.push(P(R('คุณครูที่ปรึกษา', {bold: true, size: 44}), {alignment: C, spacing: {before: 1800}}));
      (d.advisors.length ? d.advisors : [DOTS, DOTS]).forEach(function (n) { kids.push(P(R(n, {bold: true, size: 40}), {alignment: C})); });
      kids.push(P(R(SCHOOL, {bold: true, size: 44}), {alignment: C, spacing: {before: 1800}}));
      kids.push(P(R('สังกัดสำนักงานเขตพื้นที่การศึกษามัธยมศึกษาพิษณุโลก อุตรดิตถ์', {size: 36}), {alignment: C}));
      kids.push(P(R('สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน  กระทรวงศึกษาธิการ', {size: 36}), {alignment: C}));
      // บันทึกข้อความ
      kids.push(P(new D.ImageRun({data: krut, transformation: {width: 58, height: 64}}), {pageBreakBefore: true, alignment: C}));
      kids.push(P(R('บันทึกข้อความ', {bold: true, size: 58}), {alignment: C, spacing: {after: 120}}));
      kids.push(P([R('ส่วนราชการ', {bold: true, size: 36}), '  ' + SCHOOL + '  อำเภอเนินมะปราง  จังหวัดพิษณุโลก']));
      kids.push(P([R('ที่', {bold: true, size: 36}), ' ............../' + d.year + '\t\t\t\t', R('วันที่', {bold: true, size: 36}), '  ........................................................']));
      kids.push(P([R('เรื่อง', {bold: true, size: 36}), '  รายงานสรุปบันทึกการจัดกิจกรรมโฮมรูม (Home Room)'], {border: {bottom: line}, spacing: {after: 120}}));
      kids.push(P([R('เรียน', {bold: true}), '   ผู้อำนวยการ' + SCHOOL], {spacing: {after: 60}}));
      kids.push(P([R('สิ่งที่ส่งมาด้วย', {bold: true}), '\tรายงานสรุปบันทึกการจัดกิจกรรมโฮมรูม  ชั้นมัธยมศึกษาปีที่ ' + d.cls + ' ภาคเรียนที่ ' + d.sem + ' ปีการศึกษา ' + d.year], {spacing: {after: 60}}));
      kids.push(P('ด้วยข้าพเจ้า ' + (d.advisors.length ? d.advisors.join(' และ ') : DOTS) + ' ตามคำสั่งแต่งตั้งให้ปฏิบัติหน้าที่ครูที่ปรึกษานักเรียนชั้นมัธยมศึกษาปีที่ ' + d.cls + ' ภาคเรียนที่ ' + d.sem + ' ปีการศึกษา ' + d.year + ' ได้ดำเนินการเสร็จสิ้นแล้ว', {indent: {firstLine: 1418}, alignment: D.AlignmentType.THAI_DISTRIBUTE || D.AlignmentType.JUSTIFIED}));
      kids.push(P('บัดนี้ได้สิ้นสุดระยะเวลาดำเนินการดังกล่าว ข้าพเจ้าขอรายงานบันทึกการจัดกิจกรรมโฮมรูม ภาคเรียนที่ ' + d.sem + ' ปีการศึกษา ' + d.year + ' จำนวน 1 เล่ม เพื่อเป็นข้อมูลพื้นฐานของโรงเรียน และเพื่อเป็นประโยชน์ต่อการนำไปใช้ในกลุ่มงานต่าง ๆ ที่เกี่ยวข้องต่อไป', {indent: {firstLine: 1418}, alignment: D.AlignmentType.THAI_DISTRIBUTE || D.AlignmentType.JUSTIFIED}));
      kids.push(P('จึงเรียนมาเพื่อโปรดทราบ', {indent: {firstLine: 1418}}));
      [0, 1].forEach(function (i) { [ 'ลงชื่อ ' + DOTS, '(' + adv(i) + ')', 'ครูที่ปรึกษา'].forEach(function (t, j) { kids.push(P(t, {indent: {left: 4536}, alignment: C, spacing: {before: j === 0 ? 200 : 0, after: 0}})); }); });
      SIGNERS.forEach(function (s) {
        kids.push(P(R(s.title, {bold: true}), {spacing: {before: 200}}));
        kids.push(P('……………………………………………………………………………………………………………………………………………'));
        kids.push(P('ลงชื่อ ' + DOTS, {indent: {left: 4536}, alignment: C, spacing: {before: 120}}));
        ['(' + s.name + ')'].concat(s.pos).forEach(function (t) { kids.push(P(t, {indent: {left: 4536}, alignment: C})); });
      });
      // ตารางรายสัปดาห์
      var cell = function (paras, o) { return new D.TableCell(Object.assign({children: paras, margins: {top: 40, bottom: 40, left: 80, right: 80}}, o || {})); };
      var S = 28, p14 = function (t, o) { return P(R(t, Object.assign({size: S}, o || {}))); };
      var W = [800, 1300, 4400, 3000];
      d.weeks.forEach(function (wk) {
        kids.push(P(R('แบบบันทึกการเข้าร่วมกิจกรรมโฮมรูม (Homeroom)  ' + SCHOOL, {bold: true}), {alignment: C, pageBreakBefore: true}));
        kids.push(P(R('ชั้นมัธยมศึกษาปีที่ ' + d.cls + '  ภาคเรียนที่ ' + d.sem + '  ปีการศึกษา ' + d.year, {bold: true}), {alignment: C, spacing: {after: 120}}));
        var hdr = new D.TableRow({tableHeader: true, children: ['สัปดาห์ที่', 'วัน/เดือน/ปี', 'เรื่อง/รายการที่อบรม', 'หมายเหตุ'].map(function (t, i) { return cell([P(R(t, {bold: true, size: S}), {alignment: C})], {shading: {fill: 'E7E6E6'}, width: {size: W[i], type: D.WidthType.DXA}, verticalAlign: D.VerticalAlign.CENTER}); })});
        var rows = wk.days.map(function (x, i) {
          var c = x.cnt, n = function (k) { return c ? String(c[k]) : '......'; };
          var tr = [];
          for (var q = 0; q < TRAITS.length; q += 2) tr.push(new D.Paragraph({children: [R(ck(x.topics.indexOf(TRAITS[q]) >= 0) + TRAITS[q], {size: S}), R('\t' + ck(x.topics.indexOf(TRAITS[q + 1]) >= 0) + TRAITS[q + 1], {size: S})], tabStops: [{type: D.TabStopType.LEFT, position: 2250}], spacing: {after: 0}}));
          tr.push(p14(ck(!!x.other) + 'อื่นๆ ' + (x.other || '.................................................')));
          var note = [p14('นักเรียนทั้งหมด ' + n('total') + ' คน'), p14('มา ' + n('come') + ' คน   ขาด ' + n('abs') + ' คน'), p14('ลาป่วย ' + n('sick') + ' คน   ลากิจ ' + n('biz') + ' คน'), p14('กิจกรรม ' + n('act') + ' คน'), p14('รายชื่อนักเรียนที่ขาด', {bold: true})]
            .concat(x.absent.length ? x.absent.map(function (r) { return p14(r.no + '. ' + r.name); }) : [p14(c ? '-' : '..................................')]);
          return new D.TableRow({cantSplit: true, children: [cell([P(R(i === 0 ? String(wk.no) : '', {size: S}), {alignment: C})], {width: {size: W[0], type: D.WidthType.DXA}}), cell([P(R(shortTh(x.date), {size: S}), {alignment: C})], {width: {size: W[1], type: D.WidthType.DXA}}), cell(tr, {width: {size: W[2], type: D.WidthType.DXA}}), cell(note, {width: {size: W[3], type: D.WidthType.DXA}})]});
        });
        kids.push(new D.Table({width: {size: 9500, type: D.WidthType.DXA}, columnWidths: W, rows: [hdr].concat(rows)}));
        kids.push(new D.Table({width: {size: 9500, type: D.WidthType.DXA}, borders: NB, rows: [new D.TableRow({children: [0, 1].map(function (i) { return cell([P('ลงชื่อ ' + DOTS + ' ครูที่ปรึกษา', {alignment: C, spacing: {before: 300}}), P('(' + adv(i) + ')', {alignment: C})], {borders: NB, width: {size: 4750, type: D.WidthType.DXA}}); })})]}));
      });
      // ภาพประกอบ
      var ph = d.photos.filter(function (p) { return photos[p.id]; });
      if (d.pics && ph.length) {
        kids.push(P(R('ภาพประกอบการจัดกิจกรรมโฮมรูม (HOME  ROOM)', {bold: true, size: 40}), {alignment: C, pageBreakBefore: true, spacing: {after: 200}}));
        var rowsP = [];
        for (var i = 0; i < ph.length; i += 2) rowsP.push(new D.TableRow({cantSplit: true, children: [ph[i], ph[i + 1]].map(function (p) {
          if (!p) return cell([P('')], {borders: NB, width: {size: 4750, type: D.WidthType.DXA}});
          var m = dim[p.id], w = 290, h = Math.round(w * m.h / m.w); if (h > 220) { h = 220; w = Math.round(h * m.w / m.h); }
          return cell([P(new D.ImageRun({data: photos[p.id], transformation: {width: w, height: h}}), {alignment: C, spacing: {before: 120}}), P(R(thDate(p.date), {size: S}), {alignment: C, spacing: {after: 120}})], {borders: NB, width: {size: 4750, type: D.WidthType.DXA}});
        })}));
        kids.push(new D.Table({width: {size: 9500, type: D.WidthType.DXA}, borders: NB, rows: rowsP}));
      }
      var doc = new D.Document({creator: 'WPP Student Attendance', title: 'บันทึกกิจกรรมโฮมรูม ' + d.room,
        styles: {default: {document: {run: {font: F, size: 32}}}},
        sections: [{properties: {page: {size: {width: 11906, height: 16838}, margin: {top: 851, bottom: 851, left: 1021, right: 851}}}, children: kids}]});
      return D.Packer.toBlob(doc);
    });
  }
};

// ---------- ครูที่ปรึกษาบันทึกโฮมรูมเอง (เมื่อแอดมินตั้งเป็น advisor หรือ both) ----------
var TeacherHR = {
  room: null, date: null, doc: null,
  show: function (box) {
    var T = this;
    hrAdvisors().catch(function () { return {}; }).then(function (A) {
      var mine = Staff.rooms.filter(function (r) { return (A[roomId(r)] || []).indexOf(me.email) >= 0; }), others = Staff.rooms.filter(function (r) { return mine.indexOf(r) < 0; });
      T.room = T.room || mine[0] || Staff.rooms[0]; T.date = T.date || today();
      box.innerHTML = '<div class="card"><h2>🏠 บันทึกกิจกรรมโฮมรูม</h2><div class="row"><div style="flex:1;min-width:130px"><label for="thRoom">ห้อง</label><select id="thRoom">' +
        (mine.length ? '<optgroup label="ห้องที่ปรึกษาของฉัน">' + mine.map(function (r) { return '<option' + (r === T.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</optgroup>' : '') +
        '<optgroup label="ห้องอื่น">' + others.map(function (r) { return '<option' + (r === T.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</optgroup></select></div>' +
        '<div style="flex:1;min-width:130px"><label for="thDate">วันที่</label><input type="date" id="thDate" value="' + T.date + '"></div></div><div id="thBody"></div></div>';
      $('thRoom').onchange = function () { T.room = this.value; T.load(); };
      $('thDate').onchange = function () { T.date = this.value || today(); T.load(); };
      T.load();
    });
  },
  ref: function () { return db.doc('p_area/' + this.date + '_' + roomId(this.room)); },
  load: function () {
    var T = this; loading(true);
    T.ref().get().then(function (s) { loading(false); T.doc = s.exists ? s.data() : {}; T.render(); }).catch(fail);
  },
  render: function () {
    var T = this, hr = T.doc.hr || {}, hp = (T.doc.photos || {}).hr || [];
    $('thBody').innerHTML = (hr.at ? '<div class="note ok">✓ บันทึกแล้ว ' + esc(hr.at) + ' น.' + (hr.byName ? ' โดย ' + esc(hr.byName) : '') + ' · แก้ไขแล้วบันทึกซ้ำได้</div>' : '') +
      '<div class="traits">' + TRAITS.map(function (t) { return '<label class="tr"><input type="checkbox" value="' + esc(t) + '"' + ((hr.topics || []).indexOf(t) >= 0 ? ' checked' : '') + '> ' + esc(t) + '</label>'; }).join('') + '</div>' +
      '<label for="thOther">อื่นๆ / รายละเอียดที่อบรม</label><input id="thOther" maxlength="200" value="' + esc(hr.other || '') + '">' +
      '<button class="btn pri" style="width:100%;margin:10px 0" onclick="TeacherHR.save()">💾 บันทึกเรื่องที่อบรม</button>' +
      '<div class="pics" id="thPics">' + hp.map(function (p) { return '<div class="pic"><a href="' + view(p.id) + '" target="_blank" rel="noopener"><img src="' + thumb(p.id) + '" alt="" loading="lazy"></a><span class="t">' + esc(p.t) + ' น.</span></div>'; }).join('') + '</div>' +
      (hp.length < MAX_PICS ? '<label class="btn" style="width:100%">📷 แนบรูปกิจกรรม<input type="file" accept="image/*" multiple hidden onchange="TeacherHR.add(this)"></label>' : '');
  },
  base: function () { return {date: this.date, room: this.room, roomId: roomId(this.room), term: termFor(this.date), updated: FV.serverTimestamp()}; },
  save: function () {
    var T = this, topics = Array.prototype.map.call(document.querySelectorAll('#thBody .traits input:checked'), function (x) { return x.value; }), other = $('thOther').value.trim();
    if (!topics.length && !other) return toast('เลือกเรื่องที่อบรมอย่างน้อย 1 ข้อ', 'err');
    var d = T.base(); d.hr = {topics: topics, other: other, at: nowTime(), byName: me.name, byEmail: me.email};
    loading(true); T.ref().set(d, {merge: true}).then(function () { loading(false); T.doc.hr = d.hr; toast('บันทึกโฮมรูมแล้ว ✓'); T.render(); }).catch(fail);
  },
  add: function (input) {
    var T = this, files = Array.prototype.slice.call(input.files || []).slice(0, MAX_PICS - ((T.doc.photos || {}).hr || []).length), chain = Promise.resolve(), n = 0; input.value = '';
    if (!files.length) return; loading(true, 'กำลังส่งรูป…');
    files.forEach(function (f) {
      chain = chain.then(function () { return shrink(f); }).then(function (data) { return upload(data, 'hr', T.date, T.room); }).then(function (id) {
        var item = {id: id, t: nowTime()}, add = {updated: FV.serverTimestamp()}; add['photos.hr'] = FV.arrayUnion(item);
        return T.ref().set(T.base(), {merge: true}).then(function () { return T.ref().update(add); }).then(function () { T.doc.photos = T.doc.photos || {}; (T.doc.photos.hr = T.doc.photos.hr || []).push(item); n++; });
      });
    });
    chain.then(function () { loading(false); toast('ส่งรูปแล้ว ' + n + ' รูป ✓'); T.render(); }).catch(function (e) { fail(e); T.render(); });
  }
};
