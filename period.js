/*
 * WPP Student Attendance — ส่วนบันทึกเวลาเรียน (period.html)
 * แยกจากระบบเช็คเข้าแถวเดิมทั้งหมด: ใช้ Firebase project เดียวกัน, login ครูชุดเดิม
 * อ่านข้อมูลเดิม (teachers, roster/all, attendance, settings/term) แบบอ่านอย่างเดียว
 * เขียนเฉพาะคอลเลกชันใหม่ที่ขึ้นต้นด้วย p_
 *
 *   p_settings/rooms      {list:[ 'ม.1/1', ... ]}
 *   p_settings/subjects   {map:{ 'ค21101':'คณิตศาสตร์พื้นฐาน 1' }}
 *   p_settings/leaders    {byRoom:{ roomId:{sid,name,email} }}
 *   p_teacherInfo/{email} {codes:[ ... ]}               รหัสวิชาที่สอน (สูงสุด 15)
 *   p_students/{roomId}   {room, students:[{no,name,sid,status}], syncedAt}
 *   p_timetable/{roomId}  {room, slots:{ '1-3':{code,name} }}   วันจันทร์=1 … ศุกร์=5, คาบ HR,1..10
 *   p_leaders/{authEmail} {sid,name,room,roomId}
 *   p_leaderLogin/{sid}   {email}                        ใช้แปลงเลขประจำตัว → บัญชีหัวหน้าห้อง
 *   p_daily/{date}_{roomId}            {date,room,roomId,term,morning:{key:status},home:{key:status},note,...}
 *   p_class/{date}_{roomId}_{period}   {date,term,room,roomId,period,periods,code,subject,coTeacher,topic,work,records,note,teacher,teacherName,
 *                                        by:'leader'|'teacher', confirmed, leaderName, leaderSid, confirmedAt}
 *     หัวหน้าห้องบันทึกแทนได้ (confirmed:false) → ครูประจำวิชากดยืนยัน (ไอเดีย: นายกิตติศักดิ์ รัตนชัย)
 */
'use strict';

// ---------- ค่าคงที่ ----------
var CFG = window.WPP_CONFIG || {};
var LEADER_DOMAIN = 'wpp-leader.app';
var TZ = 'Asia/Bangkok';
var ST_CLASS = ['มา', 'สาย', 'ขาด', 'โดด', 'ลาป่วย', 'ลากิจ', 'กิจกรรม'];
var ST_LEADER = ['มา', 'สาย', 'ขาด', 'ลาป่วย', 'ลากิจ', 'กิจกรรม'];
var LOCK = ['ขาดเรียนนาน', 'พักการเรียน', 'ลาออก', 'ไม่มีตัวตน'];
var STUDENT_STATUS = ['ปกติ'].concat(LOCK);
var ABSENT = ['ขาด', 'โดด'];
var PERIODS = ['HR', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
var HOME_LABEL = 'แถวกลับบ้าน';
var DAYS = {1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์'};
var DEFAULT_ROOMS = ['ม.1/1', 'ม.1/2', 'ม.2/1', 'ม.2/2', 'ม.3/1', 'ม.3/2', 'ม.4/1', 'ม.4/2', 'ม.5/1', 'ม.5/2', 'ม.6/1', 'ม.6/2'];
// เกณฑ์ประเมินตามร้อยละการเข้าเรียน (ปรับได้)
// มส. เมื่อเวลาเรียนต่ำกว่า 80% ตามระเบียบวัดผล
var EVAL = [{min: 90, label: 'ปกติ', cls: 'e-ok'}, {min: 85, label: 'เสี่ยง', cls: 'e-risk'}, {min: 80, label: 'ติดต่อครูผู้สอน', cls: 'e-call'}, {min: -1, label: 'หมดสิทธิ์สอบ (มส.)', cls: 'e-out'}];

firebase.initializeApp(CFG.FIREBASE);
var auth = firebase.auth(), db = firebase.firestore(), FV = firebase.firestore.FieldValue;

// ---------- เครื่องมือทั่วไป ----------
function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
function today() { var p = {}; new Intl.DateTimeFormat('en-GB', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
function nowTime() { return new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date()); }
var TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thDate(d) { if (!d) return '—'; var a = d.split('-'); return (+a[2]) + ' ' + TH_M[+a[1] - 1] + ' ' + (+a[0] + 543); }
function roomId(room) { return String(room).trim().replace(/[\/\s]+/g, '-'); }
function skey(s) { return String(s.no).trim() + '|' + String(s.name).trim(); }
function dow(date) { return new Date(date + 'T00:00:00Z').getUTCDay(); }
function pLabel(p) { return p === 'HR' ? 'โฮมรูม' : p === 'HOME' ? HOME_LABEL : 'คาบ ' + p; }
function pShort(p) { return p === 'HR' ? 'HR' : p === 'HOME' ? 'กลับ' : p; }
function level(room) { var m = /ม\.?\s*(\d)/.exec(room); return m ? 'ม.' + m[1] : room; }
function cmpTh(a, b) { return String(a).localeCompare(String(b), 'th', {numeric: true}); }
function byNo(a, b) { return (Number(a.no) || 0) - (Number(b.no) || 0) || cmpTh(a.name, b.name); }
function loading(on, text) { $('loading').hidden = !on; if (text) $('loading').textContent = text; }
function toast(text, kind) {
  var n = document.createElement('div'); n.className = 'note ' + (kind || 'ok'); n.textContent = text;
  n.style.cssText = 'position:fixed;left:16px;right:16px;top:12px;z-index:70;max-width:520px;margin:auto;box-shadow:0 6px 20px #0002';
  document.body.appendChild(n); setTimeout(function () { n.remove(); }, kind === 'err' ? 6000 : 2600);
}
function fail(e) { loading(false); console.error(e); toast(e && e.code === 'permission-denied' ? 'ไม่มีสิทธิ์ทำรายการนี้' : (e && e.message) || String(e), 'err'); }
function openModal(html) { $('modalBox').innerHTML = html + '<div class="row" style="margin-top:14px"><button class="btn" style="flex:1" onclick="closeModal()">ปิด</button></div>'; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; }
$('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
function statusOptions(list, cur) { return list.map(function (s) { return '<option' + (s === cur ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join(''); }
function stClass(s) { return LOCK.indexOf(s) >= 0 ? 'st-lock' : 'st-' + s; }

// ---------- ภาคเรียน ----------
var termCfg = null;
function termFor(date) {
  var t = termCfg;
  if (t && t.current) return t.next && t.nextFrom && date >= t.nextFrom ? t.next : t.current;
  var m = +date.slice(5, 7), y = +date.slice(0, 4) + 543;
  var t1 = CFG.TERM1_START_MONTH || 5, t2 = CFG.TERM2_START_MONTH || 11;
  if (m >= t1 && m < t2) return '1/' + y;
  return '2/' + (m >= t2 ? y : y - 1);
}

// ---------- ผู้ใช้ ----------
var me = null; // {email,name,role:'admin'|'teacher'|'leader',room,roomId,sid}
var cache = {};
function isStaff() { return me && (me.role === 'admin' || me.role === 'teacher'); }

function showLoginMsg(t, kind) { var m = $('loginMsg'); m.hidden = !t; m.className = 'note ' + (kind || 'err'); m.textContent = t || ''; }
$('segTeacher').onclick = function () { this.classList.add('on'); $('segLeader').classList.remove('on'); $('teacherLogin').hidden = false; $('leaderLogin').hidden = true; showLoginMsg(''); };
$('segLeader').onclick = function () { this.classList.add('on'); $('segTeacher').classList.remove('on'); $('teacherLogin').hidden = true; $('leaderLogin').hidden = false; showLoginMsg(''); };
$('gLogin').onclick = function () { var p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({prompt: 'select_account'}); auth.signInWithPopup(p).catch(function (e) { showLoginMsg(authErr(e)); }); };
$('tForm').onsubmit = function (ev) { ev.preventDefault(); showLoginMsg('กำลังตรวจสอบ…', 'info'); auth.signInWithEmailAndPassword($('tEmail').value.trim(), $('tPw').value).catch(function (e) { showLoginMsg(authErr(e)); }); };
$('leaderLogin').onsubmit = function (ev) {
  ev.preventDefault();
  var sid = $('lSid').value.trim(), pin = $('lPin').value.trim();
  if (!/^\d{6}$/.test(pin)) return showLoginMsg('PIN ต้องเป็นตัวเลข 6 หลัก');
  showLoginMsg('กำลังตรวจสอบ…', 'info');
  db.doc('p_leaderLogin/' + sid).get().then(function (s) {
    if (!s.exists) throw {code: 'auth/invalid-credential'};
    return auth.signInWithEmailAndPassword(s.data().email, pin);
  }).catch(function (e) { showLoginMsg(authErr(e)); });
};
$('logoutBtn').onclick = function () { auth.signOut(); };
function authErr(e) {
  var m = {'auth/invalid-credential': 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง', 'auth/wrong-password': 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง', 'auth/user-not-found': 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง',
    'auth/too-many-requests': 'ลองผิดหลายครั้ง กรุณารอสักครู่', 'auth/popup-closed-by-user': 'ปิดหน้าต่างก่อนเข้าสู่ระบบ', 'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้'};
  return m[e && e.code] || (e && e.message) || String(e);
}

auth.onAuthStateChanged(function (u) {
  cache = {};
  if (!u) { me = null; $('top').hidden = true; $('app').hidden = true; $('bar').hidden = true; $('loginView').hidden = false; return; }
  var email = String(u.email || '').toLowerCase();
  loading(true, 'กำลังตรวจสิทธิ์…');
  var p;
  if (email.slice(-LEADER_DOMAIN.length - 1) === '@' + LEADER_DOMAIN) {
    p = db.doc('p_leaders/' + email).get().then(function (s) {
      if (!s.exists) throw new Error('บัญชีหัวหน้าห้องนี้ถูกยกเลิกแล้ว กรุณาติดต่อครู');
      var d = s.data(); me = {email: email, name: d.name, sid: d.sid, room: d.room, roomId: d.roomId, role: 'leader'};
      return db.doc('settings/term').get().then(function (t) { termCfg = t.exists ? t.data() : null; }).catch(function () {});
    });
  } else {
    if (!u.emailVerified) p = Promise.reject(new Error('กรุณายืนยันอีเมลในระบบเช็คเข้าแถวก่อน'));
    else p = db.doc('teachers/' + email).get().then(function (s) {
      if (!s.exists || s.data().active === false) throw new Error('อีเมล ' + email + ' ยังไม่ได้รับสิทธิ์ใช้งาน');
      var d = s.data(); me = {email: email, name: d.name || email, role: d.role === 'admin' ? 'admin' : 'teacher'};
      return Promise.all([db.doc('settings/term').get().then(function (t) { termCfg = t.exists ? t.data() : null; }).catch(function () {}), syncStudents().catch(function (e) { console.warn('sync', e); })]);
    });
  }
  p.then(function () { loading(false); startApp(); }).catch(function (e) {
    loading(false); auth.signOut(); $('loginView').hidden = false; showLoginMsg(e.code === 'permission-denied' ? 'ไม่มีสิทธิ์ใช้งาน' : e.message);
  });
});

// ---------- ข้อมูล ----------
function getRooms() {
  if (cache.rooms) return Promise.resolve(cache.rooms);
  return db.doc('p_settings/rooms').get().then(function (s) {
    var list = s.exists && s.data().list && s.data().list.length ? s.data().list : null;
    if (list) return list;
    return db.doc('roster/all').get().then(function (r) {
      var set = {}; (r.exists && r.data().students || []).forEach(function (x) { if (x.room) set[String(x.room).trim()] = 1; });
      var l = Object.keys(set).sort(cmpTh); return l.length ? l : DEFAULT_ROOMS.slice();
    }).catch(function () { return DEFAULT_ROOMS.slice(); });
  }).then(function (l) { cache.rooms = l; return l; });
}
// รายชื่อห้องเรียนของส่วนนี้ = ทะเบียนจากระบบเดิม + เลขประจำตัว/สถานะที่แอดมินกำหนด (ซิงก์อัตโนมัติเมื่อทะเบียนเดิมเปลี่ยน)
function syncStudents(force) {
  return Promise.all([db.doc('roster/all').get(), db.doc('p_students/_sync').get()]).then(function (v) {
    if (!v[0].exists) return;
    var r = v[0].data(), at = r.updatedAt && r.updatedAt.toMillis ? r.updatedAt.toMillis() : 0;
    var last = v[1].exists ? v[1].data().rosterAt || 0 : -1;
    if (!force && at && last >= at) return;
    var rooms = {};
    (r.students || []).forEach(function (s) { var room = String(s.room || '').trim(); if (!room || !s.name) return; (rooms[room] = rooms[room] || []).push({no: String(s.no || '').trim(), name: String(s.name).trim()}); });
    return Promise.all(Object.keys(rooms).map(function (room) { return db.doc('p_students/' + roomId(room)).get(); })).then(function (snaps) {
      var batch = db.batch();
      Object.keys(rooms).forEach(function (room, i) {
        var old = snaps[i].exists ? snaps[i].data().students || [] : [], byKey = {}, byName = {};
        old.forEach(function (o) { byKey[skey(o)] = o; byName[o.name] = o; });
        var list = rooms[room].map(function (s) { var o = byKey[skey(s)] || byName[s.name] || {}; var x = {no: s.no, name: s.name, sid: o.sid || '', status: o.status || 'ปกติ'}; if (o.hidden) x.hidden = true; return x; });
        old.forEach(function (o) { if (o.extra && !list.some(function (x) { return skey(x) === skey(o); })) list.push(o); }); // นักเรียนที่แอดมินเพิ่มเองในส่วนนี้
        list.sort(byNo);
        batch.set(db.doc('p_students/' + roomId(room)), {room: room, students: list, syncedAt: FV.serverTimestamp()});
      });
      batch.set(db.doc('p_students/_sync'), {rosterAt: at || Date.now()});
      return batch.commit();
    });
  });
}
// raw = true → รวมรายชื่อที่แอดมินลบ (ซ่อน) ไว้ด้วย ใช้เฉพาะหน้าแอดมิน
function getStudents(room, raw) {
  var k = 'stuR_' + room;
  var pick = function (l) { return raw ? l : l.filter(function (x) { return !x.hidden; }); };
  if (cache[k]) return Promise.resolve(pick(cache[k]));
  return db.doc('p_students/' + roomId(room)).get().then(function (s) { var l = (s.exists && s.data().students || []).slice().sort(byNo); cache[k] = l; return pick(l); });
}
function clearStu(room) { delete cache['stuR_' + room]; }
function normName(n) { return String(n || '').replace(/\s+/g, ' ').trim(); }
function getGroups(force) {
  if (cache.groups && !force) return Promise.resolve(cache.groups);
  return db.collection('p_groups').get().then(function (q) { var a = []; q.forEach(function (d) { a.push(Object.assign({id: d.id}, d.data())); }); a.sort(function (x, y) { return cmpTh(x.name, y.name); }); cache.groups = a; return a; });
}
function getTimetable(room) {
  var k = 'tt_' + room; if (cache[k]) return Promise.resolve(cache[k]);
  return db.doc('p_timetable/' + roomId(room)).get().then(function (s) { cache[k] = s.exists ? s.data().slots || {} : {}; return cache[k]; });
}
function getAllTimetables() {
  if (cache.ttAll) return Promise.resolve(cache.ttAll);
  return db.collection('p_timetable').get().then(function (q) { var m = {}; q.forEach(function (d) { m[d.data().room || d.id] = d.data().slots || {}; }); cache.ttAll = m; return m; });
}
function getSubjects() {
  if (cache.subjects) return Promise.resolve(cache.subjects);
  return db.doc('p_settings/subjects').get().then(function (s) { cache.subjects = s.exists ? s.data().map || {} : {}; return cache.subjects; });
}
function getLineup(date, room) { // ข้อมูลเข้าแถวเช้าจากระบบเดิม (อ่านอย่างเดียว)
  return db.doc('attendance/' + date + '_เช้า_' + roomId(room)).get().then(function (s) {
    if (!s.exists) return null; var m = {}; (s.data().records || []).forEach(function (r) { m[skey(r)] = r.status; }); return m;
  }).catch(function () { return null; });
}
function getDaily(date, room) { return db.doc('p_daily/' + date + '_' + roomId(room)).get().then(function (s) { return s.exists ? s.data() : null; }); }
function classLogsByDate(date) { return db.collection('p_class').where('date', '==', date).get().then(function (q) { var a = []; q.forEach(function (d) { a.push(d.data()); }); return a; }); }

// ---------- โครงหน้า ----------
var VIEWS = [
  {id: 'teach', label: '📝 บันทึกการสอน', who: 'staff'},
  {id: 'duty', label: '🛡️ ครูเวรประจำวัน', who: 'staff'},
  {id: 'stats', label: '📊 สถิติ / รายงาน', who: 'staff'},
  {id: 'admin', label: '⚙️ ผู้ดูแลระบบ', who: 'admin'},
  {id: 'leader', label: '🧑‍🎓 เช็คชื่อประจำวัน', who: 'leader'},
  {id: 'teachL', label: '📝 บันทึกเวลาเรียนรายคาบ', who: 'leader'}
];
var current = null;
function startApp() {
  $('loginView').hidden = true; $('top').hidden = false; $('app').hidden = false;
  $('whoName').textContent = me.role === 'leader' ? 'หัวหน้าห้อง ' + me.room + ' · ' + me.name : me.name + (me.role === 'admin' ? ' · แอดมิน' : '');
  var list = VIEWS.filter(function (v) { return v.who === 'leader' ? me.role === 'leader' : v.who === 'admin' ? me.role === 'admin' : isStaff(); });
  $('tabs').innerHTML = list.map(function (v) { return '<button class="tab" data-v="' + v.id + '">' + v.label + '</button>'; }).join('');
  $('tabs').querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { show(b.dataset.v); }; });
  var saved = null; try { saved = sessionStorage.getItem('p_view'); } catch (e) {}
  show(list.some(function (v) { return v.id === saved; }) ? saved : list[0].id);
}
function show(id) {
  current = id; try { sessionStorage.setItem('p_view', id); } catch (e) {}
  document.querySelectorAll('[data-view]').forEach(function (s) { s.hidden = s.id !== 'v-' + (id === 'teachL' ? 'teach' : id); });
  $('tabs').querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.v === id); });
  $('bar').hidden = true;
  ({teach: Teach, teachL: Teach, duty: Duty, stats: Stats, admin: Admin, leader: Leader})[id].init();
  window.scrollTo(0, 0);
}
function setBar(html) { $('barIn').innerHTML = html; $('bar').hidden = !html; }

// ---------- รายการนักเรียนพร้อมเลือกสถานะ (ใช้ร่วมหลายหน้า) ----------
function studentRows(students, statusMap, options, prefix) {
  return students.map(function (s, i) {
    var lock = LOCK.indexOf(s.status) >= 0, st = lock ? s.status : (statusMap[skey(s)] || 'มา');
    if (!lock && options.indexOf(st) < 0) st = 'มา';
    return '<div class="stu"><span class="no">' + esc(s.no) + '</span><span class="nm">' + esc(s.name) + (s.sid || s._room ? '<small>' + esc([s._room, s.sid].filter(Boolean).join(' · ')) + '</small>' : '') + '</span>' +
      '<select id="' + prefix + i + '" class="' + stClass(st) + '"' + (lock ? ' disabled' : '') + ' onchange="this.className=\'st-\'+this.value;' + prefix + 'Changed()">' +
      (lock ? '<option>' + esc(st) + '</option>' : statusOptions(options, st)) + '</select></div>';
  }).join('');
}
function readRows(students, prefix) { return students.map(function (s, i) { return {no: s.no, name: s.name, sid: s.sid || '', status: $(prefix + i).value}; }); }
function countLine(records, list) {
  var c = {}; records.forEach(function (r) { c[r.status] = (c[r.status] || 0) + 1; });
  return '<div class="sum">' + list.concat(LOCK).filter(function (s) { return c[s]; }).map(function (s) { return '<span class="' + stClass(s) + '">' + esc(s) + ' ' + c[s] + '</span>'; }).join('') + '<span>รวม ' + records.length + ' คน</span></div>';
}

// =====================================================================
// หน้า: ครูบันทึกการสอน
// =====================================================================
var Teach = (function () {
  // mode: 'room' = สอนทั้งห้อง · 'group' = วิชาเลือก/กลุ่มเรียน (นักเรียนต่างห้อง)
  var st = {date: today(), mode: 'room', room: '', gid: '', sel: [], students: [], logged: {}, warnDismissed: false};
  var L = function () { return me.role === 'leader'; };
  function init() {
    if (L()) { st.mode = 'room'; st.room = me.room; }
    Promise.all([L() ? [me.room] : getRooms(), L() ? [] : getGroups().catch(function () { return []; }), L() ? null : pending()]).then(function (v) {
      var rooms = v[0], gs = v[1].slice().sort(function (a, b) { return ((b.teachers || []).indexOf(me.email) >= 0) - ((a.teachers || []).indexOf(me.email) >= 0) || cmpTh(a.name, b.name); });
      st.groups = gs;
      $('v-teach').innerHTML =
        (L() ? '' : '<div id="tPend"></div>') +
        '<div class="card"><h2>📝 บันทึกการเข้าเรียนรายคาบ</h2>' +
        (L() ? '<div class="note info">หัวหน้าห้องบันทึกแทนครูได้ · <b>ครูประจำวิชาจะตรวจและกดยืนยัน</b> รายการที่ครูยืนยันแล้วจะแก้ไม่ได้</div>' : '') +
        (gs.length ? '<div class="seg" id="tMode"><button type="button" data-m="room">🏫 สอนทั้งห้อง</button><button type="button" data-m="group">📚 วิชาเลือก / กลุ่มเรียน</button></div>' : '') +
        '<div class="grid">' +
        '<div><label for="tDate">วันที่</label><input type="date" id="tDate" value="' + st.date + '"></div>' +
        '<div><label for="tTerm">ภาคเรียน/ปีการศึกษา</label><input id="tTerm" value="' + termFor(st.date) + '"></div>' +
        '<div id="tRoomBox"><label for="tRoom">ห้องที่สอน</label><select id="tRoom"' + (L() ? ' disabled' : '') + '><option value="">— เลือกห้อง —</option>' + rooms.map(function (r) { return '<option' + (r === st.room ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
        '<div id="tGroupBox" hidden><label for="tGroup">กลุ่มเรียน</label><select id="tGroup"><option value="">— เลือกกลุ่ม —</option>' + gs.map(function (g) { var mine = (g.teachers || []).indexOf(me.email) >= 0; return '<option value="' + esc(g.id) + '"' + (g.id === st.gid ? ' selected' : '') + '>' + (mine ? '⭐ ' : '') + esc(g.name) + (g.code ? ' (' + esc(g.code) + ')' : '') + '</option>'; }).join('') + '</select></div></div>' +
        '<div id="tDay" class="muted" style="margin-top:8px"></div>' +
        '<label style="margin-top:12px">คาบเรียน <span class="muted">(เลือกได้สูงสุด 2 คาบที่ติดกัน · สีเขียว = บันทึกแล้ว)</span></label><div class="chips" id="tChips"></div></div>' +
        '<div id="tBody"></div>';
      $('tDate').onchange = function () { st.date = this.value || today(); $('tTerm').value = termFor(st.date); st.sel = []; refresh(); };
      $('tRoom').onchange = function () { st.room = this.value; st.sel = []; refresh(); };
      $('tGroup').onchange = function () { st.gid = this.value; st.sel = []; refresh(); };
      if ($('tMode')) $('tMode').querySelectorAll('button').forEach(function (b) { b.onclick = function () { st.mode = b.dataset.m; st.sel = []; mode(); refresh(); }; });
      mode(); refresh(); if (!L()) drawPending(v[2]);
    }).catch(fail);
  }
  // ---- รายการที่หัวหน้าห้องบันทึกแทน รอครูยืนยัน ----
  function pending() {
    return Promise.all([db.collection('p_class').where('confirmed', '==', false).get(), db.doc('p_teacherInfo/' + me.email).get().catch(function () { return null; })]).then(function (v) {
      var codes = v[1] && v[1].exists ? v[1].data().codes || [] : [], all = [], mine = [];
      v[0].forEach(function (d) { var x = Object.assign({_id: d.id}, d.data()); all.push(x); if (codes.indexOf(x.code) >= 0) mine.push(x); });
      var list = me.role === 'admin' && !codes.length ? all : mine;
      return list.sort(function (a, b) { return b.date.localeCompare(a.date) || cmpTh(a.room, b.room) || PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period); });
    }).catch(function (e) { console.warn('pending', e); return []; });
  }
  function drawPending(list) {
    st.pend = list || [];
    var box = $('tPend'); if (!box) return;
    if (!st.pend.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card" style="border-color:#f5d79a;background:#fffdf5"><h2>📥 หัวหน้าห้องบันทึกแทน · รอครูยืนยัน <span class="muted" style="font-size:13px">(' + st.pend.length + ' คาบ)</span></h2>' +
      '<div class="muted" style="margin-bottom:6px">วิชาที่ตรงกับรหัสวิชาของครู · ตรวจรายชื่อ/เนื้อหา แล้วกดยืนยัน หรือกด "ตรวจ/แก้" เพื่อเปิดแก้ไขก่อน</div>' +
      st.pend.slice(0, 30).map(function (l, i) {
        var ab = (l.records || []).filter(function (x) { return ABSENT.indexOf(x.status) >= 0; });
        return '<div class="stu" style="flex-wrap:wrap"><span class="nm"><b>' + thDate(l.date) + ' · ' + esc(l.room) + ' · ' + pLabel(l.period) + '</b><small>' + esc(l.code) + ' ' + esc(l.subject || '') + ' · ' + esc(l.topic || '-') + ' · ขาด ' + ab.length + ' คน · โดย ' + esc(l.leaderName || 'หัวหน้าห้อง') + '</small></span>' +
          '<button class="btn sm" onclick="Teach.openLog(' + i + ')">ตรวจ/แก้</button><button class="btn sm ok" onclick="Teach.confirm([' + i + '])">✓ ยืนยัน</button></div>';
      }).join('') + (st.pend.length > 1 ? '<button class="btn ok" style="width:100%;margin-top:8px" onclick="Teach.confirmAll()">✓ ยืนยันทั้งหมด ' + Math.min(st.pend.length, 30) + ' คาบ</button>' : '') + '</div>';
  }
  function confirmLogs(idx) {
    var batch = db.batch();
    idx.forEach(function (i) { var l = st.pend[i]; batch.set(db.doc('p_class/' + l._id), {confirmed: true, teacher: me.email, teacherName: me.name, confirmedAt: FV.serverTimestamp()}, {merge: true}); });
    loading(true, 'กำลังยืนยัน…');
    batch.commit().then(function () { loading(false); toast('ยืนยันแล้ว ' + idx.length + ' คาบ ✓'); pending().then(drawPending); if (ready()) refresh(); }).catch(fail);
  }
  function openLog(i) {
    var l = st.pend[i]; st.mode = 'room'; st.room = l.room; st.date = l.date; st.sel = [l.period];
    $('tDate').value = l.date; $('tTerm').value = termFor(l.date); $('tRoom').value = l.room; mode();
    var keep = st.sel.slice(); refresh(keep); window.scrollTo(0, $('tChips').offsetTop - 80);
  }
  function mode() {
    if ($('tMode')) $('tMode').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === st.mode); });
    $('tRoomBox').hidden = st.mode !== 'room'; $('tGroupBox').hidden = st.mode !== 'group';
  }
  function group() { return (st.groups || []).find(function (g) { return g.id === st.gid; }); }
  function ready() { return st.mode === 'room' ? !!st.room : !!group(); }
  function refresh(keepSel) {
    var d = dow(st.date); $('tDay').textContent = 'วัน' + (DAYS[d] || (d === 0 ? 'อาทิตย์' : 'เสาร์')) + 'ที่ ' + thDate(st.date) + (DAYS[d] ? '' : ' · วันหยุด');
    st.logged = {}; st.warnDismissed = false; st.tt = null; if (keepSel) st.sel = keepSel;
    if (!ready()) { renderChips(); $('tBody').innerHTML = '<div class="card muted">' + (st.mode === 'room' ? 'เลือกห้องเรียนก่อน' : 'เลือกกลุ่มเรียนก่อน') + '</div>'; setBar(''); return; }
    loading(true);
    var docs = function (q) { return q.get().then(function (r) { var a = []; r.forEach(function (x) { a.push(x.data()); }); return a; }); };
    if (st.mode === 'room') {
      Promise.all([docs(db.collection('p_class').where('date', '==', st.date).where('roomId', '==', roomId(st.room))), getStudents(st.room), getTimetable(st.room).catch(function () { return {}; })]).then(function (v) {
        v[0].forEach(function (l) { if (!l.group) st.logged[l.period] = l; });
        st.students = v[1]; st.tt = v[2]; loading(false); renderChips(); renderBody();
      }).catch(fail);
    } else {
      var g = group(), rooms = {}; (g.members || []).forEach(function (m) { rooms[m.room] = 1; });
      Promise.all([docs(db.collection('p_class').where('date', '==', st.date).where('group', '==', g.id))].concat(Object.keys(rooms).map(function (r) { return getStudents(r).then(function (l) { return [r, l]; }); }))).then(function (v) {
        v[0].forEach(function (l) { var x = st.logged[l.period]; if (x) x.records = x.records.concat(l.records || []); else st.logged[l.period] = Object.assign({}, l, {records: (l.records || []).slice()}); });
        var stat = {}; v.slice(1).forEach(function (p) { p[1].forEach(function (x) { stat[p[0] + '|' + skey(x)] = x.status; }); });
        st.students = (g.members || []).map(function (m) { return {no: m.no, name: m.name, sid: m.sid || '', _room: m.room, status: stat[m.room + '|' + skey(m)] || 'ปกติ'}; })
          .sort(function (a, b) { return cmpTh(a._room, b._room) || byNo(a, b); });
        loading(false); renderChips(); renderBody();
      }).catch(fail);
    }
  }
  function slotOf(p) {
    var d = dow(st.date);
    if (st.mode === 'group') { var g = group(); return g && (g.slots || []).indexOf(d + '-' + p) >= 0 ? {code: g.code, name: g.subject || g.name} : null; }
    return st.tt && st.tt[d + '-' + p];
  }
  function renderChips() {
    $('tChips').innerHTML = PERIODS.map(function (p) {
      var slot = slotOf(p);
      return '<button type="button" class="chip' + (st.sel.indexOf(p) >= 0 ? ' on' : '') + (st.logged[p] ? ' has' + (st.logged[p].confirmed === false ? ' pend' : '') : '') + '" data-p="' + p + '" title="' + esc(slot ? (slot.code || '') + ' ' + (slot.name || '') : '') + '"' + (slot && st.mode === 'group' && !st.logged[p] ? ' style="border-style:dashed;border-color:var(--blue)"' : '') + (ready() ? '' : ' disabled') + '>' + (p === 'HR' ? 'โฮมรูม' : p) + '</button>';
    }).join('');
    $('tChips').querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { pick(b.dataset.p); }; });
  }
  function pick(p) {
    var i = PERIODS.indexOf(p), s = st.sel.slice();
    if (s.indexOf(p) >= 0) s = s.filter(function (x) { return x !== p; });
    else if (s.length === 1 && Math.abs(PERIODS.indexOf(s[0]) - i) === 1) s.push(p);
    else s = [p];
    s.sort(function (a, b) { return PERIODS.indexOf(a) - PERIODS.indexOf(b); });
    st.sel = s; renderChips(); renderBody();
  }
  // ค่าเริ่มต้นสถานะ: บันทึกเดิม → หัวหน้าห้อง → เข้าแถวเช้า → "มา" (ทำแยกรายห้อง สำหรับกลุ่มเรียน)
  function defaults(log) {
    var rooms = st.mode === 'room' ? [st.room] : Object.keys(st.students.reduce(function (o, x) { o[x._room] = 1; return o; }, {}));
    return Promise.all(rooms.map(function (r) { return Promise.all([getDaily(st.date, r).catch(function () { return null; }), getLineup(st.date, r)]); })).then(function (v) {
      var map = {}, src = {};
      if (log) { (log.records || []).forEach(function (r) { map[skey(r)] = r.status; }); return {map: map, src: 'saved'}; }
      v.forEach(function (x) {
        var daily = x[0], lineup = x[1], m = daily && daily.morning ? daily.morning : lineup;
        src[daily && daily.morning ? 'leader' : lineup ? 'lineup' : 'none'] = 1;
        if (m) Object.keys(m).forEach(function (k) { map[k] = m[k] === 'สาย' ? 'มา' : m[k]; });
      });
      return {map: map, src: src.none ? (src.lineup ? 'mixed' : 'none') : src.lineup ? 'lineup' : 'leader'};
    });
  }
  function renderBody() {
    if (!st.sel.length) { $('tBody').innerHTML = '<div class="card muted">เลือกคาบที่สอน</div>'; setBar(''); return; }
    var first = st.sel[0], log = st.logged[first], slot = slotOf(first) || {}, g = st.mode === 'group' ? group() : null;
    var code = log ? log.code : slot.code || (g ? g.code : '') || '', name = log ? log.subject : slot.name || (g ? g.subject || g.name : '') || '';
    loading(true);
    Promise.all([defaults(log), getSubjects().catch(function () { return {}; })]).then(function (v) {
      loading(false);
      var map = v[0].map, src = v[0].src, subjects = v[1], title = st.mode === 'room' ? st.room : g.name;
      var warn = '';
      var locked = L() && log && log.confirmed !== false;
      if (src === 'saved' && log.confirmed === false) warn = '<div class="note warn">⏳ หัวหน้าห้อง (' + esc(log.leaderName || '') + ') บันทึกแทนแล้ว · <b>รอครูยืนยัน</b>' + (L() ? ' · แก้ไขได้จนกว่าครูจะยืนยัน' : ' · ตรวจแล้วกดบันทึก = ยืนยัน') + '</div>';
      else if (locked) warn = '<div class="note ok">🔒 ' + esc(log.teacherName || 'ครูผู้สอน') + ' บันทึก/ยืนยันคาบนี้แล้ว หัวหน้าห้องแก้ไขไม่ได้</div>';
      else if (src === 'saved') warn = '<div class="note ok">✓ บันทึก ' + st.sel.map(pLabel).join(', ') + ' แล้วโดย ' + esc(log.teacherName || log.teacher) + (log.leaderName ? ' (หัวหน้าห้อง ' + esc(log.leaderName) + ' บันทึกเบื้องต้น)' : '') + ' · แก้ไขแล้วบันทึกทับได้</div>';
      else if (src === 'leader') warn = '<div class="note info">ค่าเริ่มต้นจากการเช็คชื่อของหัวหน้าห้องวันนี้ ปรับสถานะคนที่โดดหรือสายในคาบนี้ได้</div>';
      else if (!st.warnDismissed) warn = '<div class="note warn" id="tWarn">⚠️ <b>หัวหน้าห้อง' + (st.mode === 'group' ? 'บางห้อง' : '') + 'ยังไม่ได้เช็คชื่อวันนี้</b> กรุณาแจ้งหัวหน้าห้อง<br>' + (src === 'lineup' || src === 'mixed' ? 'ระหว่างนี้ใช้ข้อมูลเข้าแถวเช้าเป็นค่าเริ่มต้น' : 'ระหว่างนี้ตั้งทุกคนเป็น "มา" ไว้ก่อน') + ' ครูปรับแก้และบันทึกเองได้เลย<div style="margin-top:8px"><button class="btn sm" type="button" onclick="Teach.dismiss()">รับทราบ ปิดแจ้งเตือน</button></div></div>';
      var w = log && log.work || {};
      var need = !code && (first === '9' || first === '10' || !slot.code);
      $('tBody').innerHTML =
        '<div class="card"><h2>' + esc(title) + ' · ' + st.sel.map(pLabel).join(' + ') + '</h2>' + warn +
        '<div class="grid"><div><label for="tCode">รหัสวิชา' + (need ? ' <span style="color:var(--bad)">*กรอกเอง</span>' : '') + '</label><input id="tCode" list="subjList" value="' + esc(code) + '" placeholder="เช่น ค21101"></div>' +
        '<div><label for="tSubj">ชื่อวิชา</label><input id="tSubj" value="' + esc(name) + '"></div>' +
        '<div><label for="tCo">ผู้สอนร่วม / ผู้สอนแทน</label><input id="tCo" value="' + esc(log ? log.coTeacher || '' : '') + '" placeholder="ถ้ามี"></div></div>' +
        '<datalist id="subjList">' + Object.keys(subjects).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(subjects[c]) + '</option>'; }).join('') + '</datalist>' +
        '<label for="tTopic" style="margin-top:10px">เนื้อหา / เรื่องที่สอน</label><textarea id="tTopic" placeholder="เช่น การแก้สมการเชิงเส้นตัวแปรเดียว">' + esc(log ? log.topic : '') + '</textarea>' +
        '<label style="margin-top:10px">มีการบ้านหรืองานในห้องไหม?</label><div class="seg" id="tWorkSeg">' + ['ไม่มี', 'งานในห้อง', 'การบ้าน'].map(function (x) { return '<button type="button" data-w="' + x + '" class="' + ((w.type || 'ไม่มี') === x ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div>' +
        '<div id="tWork" class="grid"' + (w.type && w.type !== 'ไม่มี' ? '' : ' hidden') + '><div style="grid-column:1/-1"><label for="tWorkD">งานอะไร</label><input id="tWorkD" value="' + esc(w.detail || '') + '" placeholder="เช่น แบบฝึกหัด 2.1 ข้อ 1–10"></div><div><label for="tDue">กำหนดส่ง</label><input type="date" id="tDue" value="' + esc(w.due || '') + '"></div></div></div>' +
        '<div class="card"><h2>การเข้าเรียน' + (st.mode === 'group' ? ' <span class="muted" style="font-size:13px">(' + st.students.length + ' คน จากหลายห้อง)</span>' : '') + '</h2><div id="tCount"></div>' + (st.students.length ? studentRows(st.students, map, ST_CLASS, 'ts') : '<div class="note warn">ยังไม่มีรายชื่อนักเรียน' + (st.mode === 'group' ? 'ในกลุ่มนี้' : 'ห้องนี้') + '</div>') +
        '<label for="tNote" style="margin-top:12px">บันทึกเพิ่มเติม</label><textarea id="tNote" placeholder="พฤติกรรม ปัญหา ข้อเสนอแนะ">' + esc(log ? log.note || '' : '') + '</textarea></div>';
      $('tCode').oninput = function () { var n = subjects[this.value.trim()]; if (n) $('tSubj').value = n; };
      $('tWorkSeg').querySelectorAll('button').forEach(function (b) { b.onclick = function () { $('tWorkSeg').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('tWork').hidden = b.dataset.w === 'ไม่มี'; }; });
      window.tsChanged();
      if (locked) { setBar(''); $('tBody').querySelectorAll('input,select,textarea,button').forEach(function (x) { x.disabled = true; }); return; }
      var lbl = L() ? '💾 ส่งให้ครูยืนยัน ' : log && log.confirmed === false ? '✓ ยืนยันและบันทึก ' : '💾 บันทึก ';
      setBar('<button class="btn pri" id="tSave">' + lbl + st.sel.map(pLabel).join(' + ') + '</button>'); $('tSave').onclick = save;
    }).catch(fail);
  }
  window.tsChanged = function () { if ($('tCount') && st.students.length) $('tCount').innerHTML = countLine(readRows(st.students, 'ts'), ST_CLASS); };
  function save() {
    var code = $('tCode').value.trim(), topic = $('tTopic').value.trim(), wt = ($('tWorkSeg').querySelector('.on') || {}).dataset;
    if (!code) return toast('กรุณากรอกรหัสวิชา', 'err');
    if (!topic) return toast('กรุณาบันทึกเนื้อหาที่สอน', 'err');
    var work = wt && wt.w !== 'ไม่มี' ? {type: wt.w, detail: $('tWorkD').value.trim(), due: $('tDue').value} : null;
    if (work && !work.detail) return toast('กรุณาระบุงาน/การบ้าน', 'err');
    var base = {date: st.date, term: $('tTerm').value.trim() || termFor(st.date), periods: st.sel.slice(), code: code, subject: $('tSubj').value.trim(),
      coTeacher: $('tCo').value.trim(), topic: topic, work: work, note: $('tNote').value.trim(), teacher: me.email, teacherName: me.name, updatedAt: FV.serverTimestamp()};
    var prev = st.logged[st.sel[0]] || {};
    if (L()) Object.assign(base, {teacher: '', teacherName: '', by: 'leader', confirmed: false, leaderName: me.name, leaderSid: me.sid});
    else Object.assign(base, {by: 'teacher', confirmed: true, leaderName: prev.leaderName || null, leaderSid: prev.leaderSid || null});
    if (L() && st.sel.some(function (p) { return st.logged[p] && st.logged[p].confirmed !== false; })) return toast('มีคาบที่ครูยืนยันแล้ว แก้ไขไม่ได้', 'err');
    var rows = readRows(st.students, 'ts'), batch = db.batch();
    if (st.mode === 'room') {
      st.sel.forEach(function (p) { batch.set(db.doc('p_class/' + st.date + '_' + roomId(st.room) + '_' + p), Object.assign({}, base, {room: st.room, roomId: roomId(st.room), records: rows, period: p})); });
    } else {
      // กลุ่มเรียน: แยกบันทึกตามห้องของนักเรียน 1 ห้อง = 1 รายการ เพื่อให้รายงานรายห้อง/รายบุคคลนับถูกต้อง
      var g = group(), byRoom = {};
      rows.forEach(function (r, i) { var rm = st.students[i]._room; (byRoom[rm] = byRoom[rm] || []).push(r); });
      st.sel.forEach(function (p) { Object.keys(byRoom).forEach(function (rm) {
        batch.set(db.doc('p_class/' + st.date + '_' + roomId(rm) + '_' + p + '_' + g.id), Object.assign({}, base, {room: rm, roomId: roomId(rm), group: g.id, groupName: g.name, records: byRoom[rm], period: p}));
      }); });
    }
    $('tSave').disabled = true; loading(true, 'กำลังบันทึก…');
    batch.commit().then(function () { loading(false); toast(L() ? 'ส่งให้ครูยืนยันแล้ว ✓' : 'บันทึก ' + st.sel.map(pLabel).join(' + ') + ' เรียบร้อย ✓'); st.sel = []; refresh(); if (!L()) pending().then(drawPending); }).catch(function (e) { $('tSave').disabled = false; fail(e); });
  }
  return {init: init, openLog: openLog, confirm: confirmLogs, confirmAll: function () { confirmLogs(st.pend.slice(0, 30).map(function (x, i) { return i; })); }, dismiss: function () { st.warnDismissed = true; var w = $('tWarn'); if (w) w.remove(); }};
})();

// =====================================================================
// หน้า: หัวหน้าห้อง เช็คชื่อประจำวัน (เข้าแถวเช้า + แถวกลับบ้าน)
// =====================================================================
var Leader = (function () {
  var st = {date: today(), part: 'morning', students: [], daily: null};
  function init() {
    $('v-leader').innerHTML = '<div class="card"><h2>🧑‍🎓 เช็คชื่อประจำวัน · ' + esc(me.room) + '</h2><div class="grid"><div><label for="lDate">วันที่</label><input type="date" id="lDate" value="' + st.date + '"></div><div><label>ภาคเรียน</label><input id="lTerm" value="' + termFor(st.date) + '" readonly></div></div>' +
      '<div class="seg" style="margin-top:12px"><button type="button" data-p="morning">🌅 เข้าแถวเช้า</button><button type="button" data-p="home">🏠 ' + HOME_LABEL + '</button></div><div id="lInfo"></div></div><div id="lBody"></div>' +
      '<div class="card"><button class="btn sm" type="button" id="lPinBtn">🔑 เปลี่ยน PIN</button></div>';
    $('lDate').onchange = function () { st.date = this.value || today(); $('lTerm').value = termFor(st.date); load(); };
    $('v-leader').querySelectorAll('.seg button').forEach(function (b) { b.onclick = function () { st.part = b.dataset.p; render(); }; });
    $('lPinBtn').onclick = changePin;
    load();
  }
  function load() {
    loading(true);
    Promise.all([getStudents(me.room), getDaily(st.date, me.room), getLineup(st.date, me.room)]).then(function (v) { loading(false); st.students = v[0]; st.daily = v[1]; st.lineup = v[2]; render(); }).catch(fail);
  }
  function render() {
    $('v-leader').querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.p === st.part); });
    var d = st.daily || {}, map = {}, info;
    if (st.part === 'morning') {
      if (d.morning) { map = d.morning; info = '<div class="note ok">✓ บันทึกเข้าแถวเช้าแล้ว ' + esc(d.morningAt || '') + ' · แก้ไขแล้วบันทึกซ้ำได้</div>'; }
      else if (st.lineup) { map = st.lineup; info = '<div class="note info">ดึงผลเข้าแถวเช้าที่ครูเช็คไว้มาให้แล้ว ตรวจและแก้ไขได้</div>'; }
      else info = '<div class="note info">ยังไม่มีผลเข้าแถวเช้าจากครู ตั้งทุกคนเป็น "มา" ไว้ก่อน</div>';
    } else {
      if (d.home) { map = d.home; info = '<div class="note ok">✓ บันทึก' + HOME_LABEL + 'แล้ว ' + esc(d.homeAt || '') + '</div>'; }
      else { var src = d.morning || st.lineup || {}; Object.keys(src).forEach(function (k) { map[k] = src[k] === 'สาย' ? 'มา' : src[k]; }); info = '<div class="note info">ค่าเริ่มต้นจากการเช็คชื่อตอนเช้า ตรวจคนที่กลับก่อนหรือไม่อยู่แถว</div>'; }
    }
    $('lInfo').innerHTML = info;
    $('lBody').innerHTML = '<div class="card"><div id="lCount"></div>' + (st.students.length ? studentRows(st.students, map, ST_LEADER, 'ls') : '<div class="note warn">ยังไม่มีรายชื่อ กรุณาแจ้งครู</div>') +
      '<label for="lNote" style="margin-top:12px">บันทึกเพิ่มเติม</label><textarea id="lNote">' + esc(d.note || '') + '</textarea></div>';
    window.lsChanged(); setBar('<button class="btn pri" id="lSave">💾 บันทึก' + (st.part === 'morning' ? 'เข้าแถวเช้า' : HOME_LABEL) + '</button>'); $('lSave').onclick = save;
  }
  window.lsChanged = function () { if ($('lCount') && st.students.length) $('lCount').innerHTML = countLine(readRows(st.students, 'ls'), ST_LEADER); };
  function save() {
    var m = {}; readRows(st.students, 'ls').forEach(function (r) { m[skey(r)] = r.status; });
    var data = {date: st.date, room: me.room, roomId: me.roomId, term: termFor(st.date), note: $('lNote').value.trim(), by: me.sid, updatedAt: FV.serverTimestamp()};
    data[st.part] = m; data[st.part + 'At'] = nowTime();
    $('lSave').disabled = true; loading(true, 'กำลังบันทึก…');
    db.doc('p_daily/' + st.date + '_' + me.roomId).set(data, {merge: true}).then(function () { loading(false); toast('บันทึกเรียบร้อย ✓'); load(); }).catch(function (e) { $('lSave').disabled = false; fail(e); });
  }
  function changePin() {
    openModal('<h2>เปลี่ยน PIN</h2><label for="np1">PIN ใหม่ 6 หลัก</label><input id="np1" type="password" inputmode="numeric" maxlength="6"><label for="np2" style="margin-top:8px">ยืนยัน PIN</label><input id="np2" type="password" inputmode="numeric" maxlength="6"><button class="btn pri" style="width:100%;margin-top:12px" id="npSave">บันทึก PIN</button>');
    $('npSave').onclick = function () {
      var a = $('np1').value, b = $('np2').value;
      if (!/^\d{6}$/.test(a)) return toast('PIN ต้องเป็นตัวเลข 6 หลัก', 'err');
      if (a !== b) return toast('PIN ไม่ตรงกัน', 'err');
      auth.currentUser.updatePassword(a).then(function () { closeModal(); toast('เปลี่ยน PIN แล้ว ✓'); }).catch(function (e) { fail(e.code === 'auth/requires-recent-login' ? new Error('กรุณาออกจากระบบแล้วเข้าใหม่ก่อนเปลี่ยน PIN') : e); });
    };
  }
  return {init: init};
})();

// =====================================================================
// หน้า: ครูเวรประจำวัน
// =====================================================================
var Duty = (function () {
  var st = {date: today()};
  function init() {
    $('v-duty').innerHTML = '<div class="card"><h2>🛡️ ตรวจการบันทึกประจำวัน</h2><div class="row"><div style="flex:1;min-width:160px"><label for="dDate">วันที่</label><input type="date" id="dDate" value="' + st.date + '"></div><button class="btn" id="dReload" style="margin-top:20px">↻ โหลดใหม่</button></div>' +
      '<p class="muted" style="margin:10px 0 0">✓ บันทึกแล้ว (ตัวเลข = ขาด/โดด) · ✗ ยังไม่บันทึก · – ไม่มีคาบในตาราง · แตะช่องเพื่อดูรายละเอียด</p></div><div id="dBody"></div>';
    $('dDate').onchange = function () { st.date = this.value || today(); load(); };
    $('dReload').onclick = function () { cache.ttAll = null; load(); };
    load();
  }
  function load() {
    loading(true);
    Promise.all([getRooms(), classLogsByDate(st.date), db.collection('p_daily').where('date', '==', st.date).get(), getAllTimetables(), getGroups(true).catch(function () { return []; })]).then(function (v) {
      var rooms = v[0], logs = {}, glogs = {}, daily = {}, tts = v[3], d = dow(st.date), gs = v[4], gexp = {};
      v[1].forEach(function (l) { if (l.group) (glogs[l.room + '|' + l.period] = glogs[l.room + '|' + l.period] || {})[l.group] = l; else logs[l.room + '|' + l.period] = l; });
      // กลุ่มเรียนที่ต้องมีบันทึก: กลุ่มที่มีคาบวันนี้ และมีสมาชิกจากห้องนั้น
      gs.forEach(function (g) { var rs = {}; (g.members || []).forEach(function (m) { rs[m.room] = 1; }); (g.slots || []).forEach(function (k) { var a = k.split('-'); if (+a[0] !== d) return; Object.keys(rs).forEach(function (r) { (gexp[r + '|' + a[1]] = gexp[r + '|' + a[1]] || []).push(g); }); }); });
      v[2].forEach(function (s) { daily[s.data().room] = s.data(); });
      return Promise.all(rooms.map(getStudents)).then(function (stu) {
        loading(false);
        var maxP = 8; v[1].forEach(function (l) { if (+l.period > maxP) maxP = +l.period; });
        rooms.forEach(function (r) { [9, 10].forEach(function (p) { if ((tts[r] || {})[d + '-' + p]) maxP = Math.max(maxP, p); }); });
        var cols = PERIODS.filter(function (p) { return p === 'HR' || +p <= maxP; });
        st.view = {rooms: rooms, logs: logs, glogs: glogs, gexp: gexp, gs: gs, daily: daily, tts: tts, cols: cols, stu: stu};
        var done = 0, missing = 0;
        var rows = rooms.map(function (r, ri) {
          var tt = tts[r] || {}, hasTT = Object.keys(tt).length > 0, dm = (daily[r] || {}).morning, cnt = {};
          if (dm) Object.keys(dm).forEach(function (k) { cnt[dm[k]] = (cnt[dm[k]] || 0) + 1; });
          var cells = cols.map(function (p) {
            var l = logs[r + '|' + p], expected = DAYS[d] && (hasTT ? !!tt[d + '-' + p] : p !== 'HR' && +p <= 8);
            var ge = gexp[r + '|' + p] || [], gl = glogs[r + '|' + p] || {}, gd = Object.keys(gl);
            if (ge.length || gd.length) { // คาบวิชาเลือก/กลุ่มเรียน
              var need = {}; ge.forEach(function (g) { need[g.id] = 1; }); gd.forEach(function (id) { need[id] = 1; });
              var n = Object.keys(need).length, ok = Object.keys(need).filter(function (id) { return gl[id]; }).length;
              var ab = gd.reduce(function (t, id) { return t + (gl[id].records || []).filter(function (x) { return ABSENT.indexOf(x.status) >= 0; }).length; }, 0);
              if (ok === n) { done++; return '<td><button class="ck y" title="วิชาเลือก ' + n + ' กลุ่ม" onclick="Duty.detail(' + ri + ',\'' + p + '\')">✓' + (ab ? '<small>' + ab + '</small>' : '') + '</button></td>'; }
              missing += n - ok; return '<td><button class="ck n" title="บันทึกแล้ว ' + ok + '/' + n + ' กลุ่ม" onclick="Duty.detail(' + ri + ',\'' + p + '\')">' + (ok ? ok + '/' + n : '✗') + '</button></td>';
            }
            if (l) { done++; var a = (l.records || []).filter(function (x) { return ABSENT.indexOf(x.status) >= 0; }).length; return '<td><button class="ck y' + (l.confirmed === false ? ' pend' : '') + '"' + (l.confirmed === false ? ' title="หัวหน้าห้องบันทึกแทน รอครูยืนยัน"' : '') + ' onclick="Duty.detail(' + ri + ',\'' + p + '\')">✓' + (a ? '<small>' + a + '</small>' : '') + '</button></td>'; }
            if (expected) { missing++; return '<td><button class="ck n" onclick="Duty.detail(' + ri + ',\'' + p + '\')">✗</button></td>'; }
            return '<td><span class="ck z">–</span></td>';
          });
          var dh = (daily[r] || {}).home, homeCell = dh ? '<td><button class="ck y" onclick="Duty.detail(' + ri + ',\'HOME\')">✓' + (function () { var a = Object.keys(dh).filter(function (k) { return dh[k] !== 'มา' && dh[k] !== 'สาย'; }).length; return a ? '<small>' + a + '</small>' : ''; })() + '</button></td>' : '<td><button class="ck n" onclick="Duty.detail(' + ri + ',\'HOME\')">✗</button></td>';
          return '<tr><td class="l"><b>' + esc(r) + '</b></td><td>' + stu[ri].length + '</td>' + cells.join('') + homeCell +
            '<td>' + (dm ? (cnt['มา'] || 0) + (cnt['สาย'] || 0) : '–') + '</td><td>' + (dm ? cnt['ขาด'] || 0 : '–') + '</td><td>' + (dm ? cnt['ลาป่วย'] || 0 : '–') + '</td><td>' + (dm ? cnt['ลากิจ'] || 0 : '–') + '</td><td>' + (dm ? cnt['กิจกรรม'] || 0 : '–') + '</td></tr>';
        });
        $('dBody').innerHTML = '<div class="card"><div class="kpi"><div><b>' + done + '</b><span>คาบที่บันทึกแล้ว</span></div><div><b>' + missing + '</b><span>คาบที่ยังไม่บันทึก (ตามตาราง)</span></div><div><b>' + Object.keys(daily).length + '/' + rooms.length + '</b><span>ห้องที่หัวหน้าห้องเช็คแล้ว</span></div></div>' +
          '<div class="tbl-wrap"><table><thead><tr><th>ห้อง</th><th>นักเรียน</th>' + cols.map(function (p) { return '<th>' + (p === 'HR' ? 'โฮมรูม' : p) + '</th>'; }).join('') + '<th>' + HOME_LABEL + '</th><th>มา</th><th>ขาด</th><th>ลาป่วย</th><th>ลากิจ</th><th>กิจกรรม</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
          '<p class="muted">มา/ขาด/ลา นับจากการเช็คชื่อตอนเช้าของหัวหน้าห้อง</p></div>';
      });
    }).catch(fail);
  }
  function detail(ri, p) {
    var v = st.view, room = v.rooms[ri], d = dow(st.date);
    if (p === 'HOME') {
      var dh = (v.daily[room] || {}).home;
      if (!dh) return openModal('<h2>' + esc(room) + ' · ' + HOME_LABEL + '</h2><div class="note warn">หัวหน้าห้องยังไม่ได้บันทึก' + HOME_LABEL + '</div>');
      return openModal('<h2>' + esc(room) + ' · ' + HOME_LABEL + '</h2>' + listNotPresent(v.stu[ri].map(function (s) { return {no: s.no, name: s.name, status: dh[skey(s)] || 'มา'}; })));
    }
    var ge = v.gexp[room + '|' + p] || [], gl = v.glogs[room + '|' + p] || {};
    if (ge.length || Object.keys(gl).length) {
      var ids = {}; ge.forEach(function (g) { ids[g.id] = 1; }); Object.keys(gl).forEach(function (id) { ids[id] = 1; });
      return openModal('<h2>' + esc(room) + ' · ' + pLabel(p) + ' · วิชาเลือก</h2>' + Object.keys(ids).map(function (id) {
        var g = v.gs.find(function (x) { return x.id === id; }) || {name: (gl[id] || {}).groupName || id}, l = gl[id];
        return '<div class="card" style="padding:12px;margin:10px 0"><b>' + esc(g.name) + '</b> ' + (l ? '<span class="pill e-ok">บันทึกแล้ว</span><br><span class="muted">' + esc(l.code + ' · ' + (l.teacherName || l.teacher)) + '</span><p style="margin:6px 0"><b>เนื้อหา:</b> ' + esc(l.topic) + '</p>' + listNotPresent(l.records || []) : '<span class="pill e-out">ยังไม่บันทึก</span>') + '</div>';
      }).join(''));
    }
    var l = v.logs[room + '|' + p], slot = (v.tts[room] || {})[d + '-' + p];
    if (!l) return openModal('<h2>' + esc(room) + ' · ' + pLabel(p) + '</h2><div class="note warn">ยังไม่มีการบันทึก' + (slot ? '<br>วิชา ' + esc(slot.code + ' ' + (slot.name || '')) : '') + '</div>');
    openModal('<h2>' + esc(room) + ' · ' + pLabel(p) + '</h2><p><b>' + esc(l.code) + ' ' + esc(l.subject || '') + '</b><br><span class="muted">ผู้สอน ' + esc(l.teacherName || l.teacher) + (l.coTeacher ? ' · ร่วม/แทน: ' + esc(l.coTeacher) : '') + '</span></p>' +
      '<p><b>เนื้อหา:</b> ' + esc(l.topic) + '</p>' + (l.work ? '<p><b>' + esc(l.work.type) + ':</b> ' + esc(l.work.detail) + (l.work.due ? ' · ส่ง ' + thDate(l.work.due) : '') + '</p>' : '') + (l.note ? '<p><b>บันทึก:</b> ' + esc(l.note) + '</p>' : '') +
      listNotPresent(l.records || []));
  }
  function listNotPresent(recs) {
    var nb = recs.filter(function (r) { return r.status !== 'มา'; }).sort(byNo);
    return countLine(recs, ST_CLASS) + (nb.length ? '<div>' + nb.map(function (r) { return '<div class="stu"><span class="no">' + esc(r.no) + '</span><span class="nm">' + esc(r.name) + '</span><span class="pill ' + stClass(r.status) + '">' + esc(r.status) + '</span></div>'; }).join('') + '</div>' : '<div class="note ok">มาครบทุกคน</div>');
  }
  return {init: init, detail: detail};
})();

// =====================================================================
// หน้า: สถิติ / รายงาน
// =====================================================================
var Stats = (function () {
  var st = {tab: 'class', start: '', end: today(), data: null};
  var TABS = [['class', 'รายระดับชั้น'], ['person', 'รายบุคคล'], ['subject', 'รายวิชา'], ['teach', 'การเข้าสอน'], ['risk', 'กลุ่มเสี่ยง']];
  function init() {
    if (!st.start) { var t = today(); st.start = t.slice(0, 8) + '01'; }
    $('v-stats').innerHTML = '<div class="card"><h2>📊 สถิติและรายงาน</h2><div class="grid"><div><label for="sStart">ตั้งแต่วันที่</label><input type="date" id="sStart" value="' + st.start + '"></div><div><label for="sEnd">ถึงวันที่</label><input type="date" id="sEnd" value="' + st.end + '"></div><div style="align-self:end"><button class="btn pri" style="width:100%" id="sLoad">ดึงข้อมูล</button></div></div>' +
      '<div class="chips" style="margin-top:12px" id="sTabs">' + TABS.map(function (t) { return '<button type="button" class="chip" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div id="sMsg" class="muted" style="margin-top:8px"></div></div><div id="sBody"></div>';
    $('sStart').onchange = function () { st.start = this.value; st.data = null; };
    $('sEnd').onchange = function () { st.end = this.value; st.data = null; };
    $('sLoad').onclick = function () { st.data = null; load(); };
    $('sTabs').querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { st.tab = b.dataset.t; tabs(); render(); }; });
    tabs(); if (st.data) render(); else $('sBody').innerHTML = '<div class="card muted">เลือกช่วงวันที่ แล้วกด "ดึงข้อมูล"</div>';
  }
  function tabs() { $('sTabs').querySelectorAll('.chip').forEach(function (b) { b.classList.toggle('on', b.dataset.t === st.tab); }); }
  function load() {
    if (!st.start || !st.end || st.start > st.end) return toast('เลือกช่วงวันที่ให้ถูกต้อง', 'err');
    loading(true, 'กำลังดึงข้อมูล…');
    var range = function (c) { return db.collection(c).where('date', '>=', st.start).where('date', '<=', st.end).get(); };
    Promise.all([range('p_class'), range('p_daily'), range('attendance').catch(function () { return null; }), getRooms(), getSubjects()]).then(function (v) {
      var logs = [], daily = [], lineup = {};
      v[0].forEach(function (d) { logs.push(d.data()); }); v[1].forEach(function (d) { daily.push(d.data()); });
      if (v[2]) v[2].forEach(function (d) { var x = d.data(); if (x.period !== 'เช้า') return; var m = {}; (x.records || []).forEach(function (r) { m[skey(r)] = r.status; }); lineup[x.date + '|' + x.room] = m; });
      return Promise.all(v[3].map(getStudents)).then(function (stu) {
        loading(false);
        var students = {}; v[3].forEach(function (r, i) { students[r] = stu[i]; });
        st.data = {logs: logs, daily: daily, lineup: lineup, rooms: v[3], students: students, subjects: v[4]};
        $('sMsg').textContent = 'ข้อมูล ' + thDate(st.start) + ' – ' + thDate(st.end) + ' · บันทึกการสอน ' + logs.length + ' คาบ · เช็คชื่อประจำวัน ' + daily.length + ' รายการ';
        render();
      });
    }).catch(fail);
  }
  function render() {
    if (!st.data) return;
    ({class: byClass, person: byPerson, subject: bySubject, teach: teachLog, risk: risk})[st.tab]();
  }
  // ---- ตารางทั่วไป + ส่งออก ----
  var lastSheet = null;
  function tableHTML(head, rows, opt) {
    opt = opt || {};
    return '<div class="tbl-wrap"><table><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) { return '<tr>' + r.map(function (c, i) { var html = c && c.html != null ? c.html : esc(c); return '<td' + ((opt.left || []).indexOf(i) >= 0 ? ' class="l"' : (opt.wrap || []).indexOf(i) >= 0 ? ' class="wrap"' : '') + '>' + html + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + head.length + '" class="muted">ไม่มีข้อมูลในช่วงนี้</td></tr>') + '</tbody></table></div>';
  }
  function plain(v) { return v && v.html != null ? v.text : v; }
  function exportBar(title) { return '<div class="row" style="margin-top:12px"><button class="btn sm" onclick="Stats.excel()">⬇ Excel</button><button class="btn sm" onclick="Stats.print()">🖨 พิมพ์ / PDF</button></div>'; }
  function setSheet(title, head, rows, opt) { lastSheet = {title: title, head: head, rows: rows.map(function (r) { return r.map(plain); }), opt: opt || {}}; }
  function sub() { return ['ช่วงวันที่ ' + thDate(st.start) + ' – ' + thDate(st.end), 'สร้างเมื่อ ' + thDate(today()) + ' ' + nowTime() + ' · ' + (me.name || '')]; }
  function excel() {
    if (!lastSheet) return;
    var s = lastSheet, blob = wppWorkbook([{name: s.title.slice(0, 31), title: s.title, subtitle: sub(), filter: true, rows: [s.head].concat(s.rows)}]);
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'WPP_' + s.title.replace(/\s+/g, '_') + '_' + st.start + '_' + st.end + '.xlsx'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function print() {
    if (!lastSheet) return;
    var s = lastSheet;
    $('printArea').innerHTML = '<div class="ph"><img src="logo.png" alt="" onerror="this.style.visibility=\'hidden\'"><div><p>โรงเรียนวังโพรงพิทยาคม</p><small>สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาพิษณุโลก อุตรดิตถ์</small><h1>' + esc(s.title) + '</h1></div><span></span></div><div class="pm">' + sub().map(esc).join('<br>') + '</div>' +
      tableHTML(s.head, s.rows, s.opt) + '<div class="sig">ลงชื่อ ..................................................... ผู้รายงาน<br>(.....................................................)</div>';
    window.print();
  }
  function statusOf(map, s) { var lock = LOCK.indexOf(s.status) >= 0; return lock ? s.status : (map && map[skey(s)]) || null; }
  // ---- รายระดับชั้น ----
  function byClass() {
    var D = st.data, dailyBy = {}; D.daily.forEach(function (d) { dailyBy[d.date + '|' + d.room] = d; });
    var cols = PERIODS.concat(['HOME']);
    var head = ['ห้อง', 'นักเรียน'].concat(cols.map(function (p) { return p === 'HR' ? 'โฮมรูม' : p === 'HOME' ? HOME_LABEL : 'คาบ ' + p; })).concat(['มา', 'ขาด', 'ลาป่วย', 'ลากิจ', 'กิจกรรม']);
    var rows = D.rooms.map(function (room) {
      var stu = D.students[room] || [], abs = {}, cnt = {};
      cols.forEach(function (p) { abs[p] = {}; });
      D.logs.filter(function (l) { return l.room === room; }).forEach(function (l) { (l.records || []).forEach(function (r) { if (ABSENT.indexOf(r.status) >= 0) abs[l.period][r.no] = (abs[l.period][r.no] || 0) + 1; }); });
      var dates = {}; D.daily.forEach(function (d) { if (d.room === room) dates[d.date] = 1; }); Object.keys(D.lineup).forEach(function (k) { var a = k.split('|'); if (a[1] === room) dates[a[0]] = 1; });
      Object.keys(dates).forEach(function (date) {
        var d = dailyBy[date + '|' + room], m = d && d.morning || D.lineup[date + '|' + room], h = d && d.home;
        stu.forEach(function (s) { var x = statusOf(m, s); if (x) cnt[x] = (cnt[x] || 0) + 1; var y = statusOf(h, s); if (h && y && y !== 'มา' && y !== 'สาย' && LOCK.indexOf(y) < 0) abs.HOME[s.no] = (abs.HOME[s.no] || 0) + 1; });
      });
      var nums = function (o) { return Object.keys(o).sort(function (a, b) { return a - b; }).map(function (n) { return o[n] > 1 ? n + '(' + o[n] + ')' : n; }).join(', ') || '–'; };
      return [room, stu.length].concat(cols.map(function (p) { return nums(abs[p]); })).concat([(cnt['มา'] || 0) + (cnt['สาย'] || 0), cnt['ขาด'] || 0, cnt['ลาป่วย'] || 0, cnt['ลากิจ'] || 0, cnt['กิจกรรม'] || 0]);
    });
    setSheet('รายงานการเข้าเรียนรายระดับชั้น', head, rows, {left: [0], wrap: []});
    $('sBody').innerHTML = '<div class="card"><h2>รายงานการเข้าเรียน ภาพรวมรายระดับชั้น</h2><p class="muted">ช่องคาบ = เลขที่ที่ขาด/โดด (ตัวเลขในวงเล็บ = จำนวนครั้ง) · มา/ขาด/ลา = จำนวนคน-วัน จากการเช็คชื่อตอนเช้า</p>' + tableHTML(head, rows, {left: [0]}) + exportBar() + '</div>';
  }
  // ---- รายบุคคล ----
  function byPerson() {
    var D = st.data;
    $('sBody').innerHTML = '<div class="card"><h2>รายงานรายบุคคล</h2><div class="grid"><div><label for="pRoom">ห้อง</label><select id="pRoom">' + D.rooms.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div><div><label for="pStu">นักเรียน</label><select id="pStu"></select></div><div><label for="pSid">หรือค้นด้วยเลขประจำตัว</label><input id="pSid" inputmode="numeric" placeholder="เลขประจำตัว"></div></div><div id="pOut"></div></div>';
    var fill = function () { var l = D.students[$('pRoom').value] || []; $('pStu').innerHTML = l.map(function (s, i) { return '<option value="' + i + '">' + esc(s.no + '. ' + s.name) + '</option>'; }).join(''); out(); };
    $('pRoom').onchange = fill; $('pStu').onchange = out;
    $('pSid').onchange = function () { var q = this.value.trim(); if (!q) return; for (var r in D.students) { var i = D.students[r].findIndex(function (s) { return s.sid === q; }); if (i >= 0) { $('pRoom').value = r; fill(); $('pStu').value = i; out(); return; } } toast('ไม่พบเลขประจำตัวนี้', 'err'); };
    fill();
  }
  function out() {
    var D = st.data, room = $('pRoom').value, s = (D.students[room] || [])[+$('pStu').value];
    if (!s) { $('pOut').innerHTML = '<p class="muted">ไม่มีรายชื่อ</p>'; return; }
    var k = skey(s), dates = {}, total = {};
    D.logs.forEach(function (l) { if (l.room !== room) return; var r = (l.records || []).find(function (x) { return skey(x) === k; }); if (!r) return; (dates[l.date] = dates[l.date] || {})[l.period] = r.status; total[r.status] = (total[r.status] || 0) + 1; });
    D.daily.forEach(function (d) { if (d.room === room && d.home) { var x = d.home[k]; if (x) (dates[d.date] = dates[d.date] || {}).HOME = x; } });
    var ab = {'มา': '✓', 'สาย': 'ส', 'ขาด': 'ข', 'โดด': 'ด', 'ลาป่วย': 'ป', 'ลากิจ': 'ก', 'กิจกรรม': 'กจ'};
    var head = ['วันที่'].concat(PERIODS.map(function (p) { return p === 'HR' ? 'HR' : p; })).concat([HOME_LABEL]);
    var rows = Object.keys(dates).sort().map(function (d) { return [thDate(d)].concat(PERIODS.concat(['HOME']).map(function (p) { var x = dates[d][p]; return x ? {html: '<span class="pill ' + stClass(x) + '">' + esc(ab[x] || x) + '</span>', text: x} : ''; })); });
    var periods = Object.keys(total).reduce(function (a, b) { return a + total[b]; }, 0), absent = (total['ขาด'] || 0) + (total['โดด'] || 0);
    setSheet('รายงานรายบุคคล ' + s.name + ' ' + room, head, rows, {left: [0]});
    $('pOut').innerHTML = '<div class="kpi"><div><b>' + periods + '</b><span>คาบที่มีบันทึก</span></div><div><b>' + (total['มา'] || 0) + '</b><span>มา</span></div><div><b>' + absent + '</b><span>ขาด + โดด</span></div><div><b>' + ((total['ลาป่วย'] || 0) + (total['ลากิจ'] || 0)) + '</b><span>ลา</span></div><div><b>' + (periods ? Math.round((periods - absent) * 1000 / periods) / 10 : 0) + '%</b><span>ร้อยละเข้าเรียน</span></div></div>' +
      '<p class="muted">✓ มา · ส สาย · ข ขาด · ด โดด · ป ลาป่วย · ก ลากิจ · กจ กิจกรรม</p>' + tableHTML(head, rows, {left: [0]}) + exportBar();
  }
  // ---- รายวิชา ----
  function bySubject() {
    var D = st.data, g = {};
    D.logs.forEach(function (l) {
      var k = l.code + '|' + l.room, x = g[k] = g[k] || {code: l.code, subject: l.subject || D.subjects[l.code] || '', room: l.room, teachers: {}, periods: 0, seats: 0, present: 0, absent: 0, late: 0, leave: 0};
      x.periods++; x.teachers[l.teacherName || l.teacher] = 1;
      (l.records || []).forEach(function (r) { if (LOCK.indexOf(r.status) >= 0) return; x.seats++; if (r.status === 'มา' || r.status === 'สาย') x.present++; if (ABSENT.indexOf(r.status) >= 0) x.absent++; if (r.status === 'สาย') x.late++; if (r.status === 'ลาป่วย' || r.status === 'ลากิจ') x.leave++; });
    });
    var head = ['รหัสวิชา', 'ชื่อวิชา', 'ห้อง', 'ผู้สอน', 'คาบที่สอน', 'ขาด/โดด (ครั้ง)', 'สาย', 'ลา', 'ร้อยละเข้าเรียน (%)'];
    var rows = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return cmpTh(a.code, b.code) || cmpTh(a.room, b.room); }).map(function (x) {
      return [x.code, x.subject, x.room, Object.keys(x.teachers).join(', '), x.periods, x.absent, x.late, x.leave, x.seats ? Math.round(x.present * 10000 / x.seats) / 100 : 0];
    });
    setSheet('รายงานการเข้าเรียนรายวิชา', head, rows, {left: [0, 1, 3]});
    $('sBody').innerHTML = '<div class="card"><h2>รายงานรายวิชา</h2>' + tableHTML(head, rows, {left: [0, 1, 3]}) + exportBar() + '</div>';
  }
  // ---- รายงานการเข้าสอน ----
  function teachLog() {
    var D = st.data, logs = D.logs.slice().sort(function (a, b) { return b.date.localeCompare(a.date) || cmpTh(a.room, b.room) || PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period); });
    var uniq = function (f) { var o = {}; logs.forEach(function (l) { var v = f(l); if (v) o[v] = 1; }); return Object.keys(o).sort(cmpTh); };
    var sel = function (id, label, vals) { return '<div><label for="' + id + '">' + label + '</label><select id="' + id + '"><option value="">ทั้งหมด</option>' + vals.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('') + '</select></div>'; };
    $('sBody').innerHTML = '<div class="card"><h2>รายงานการเข้าสอน</h2><div class="grid">' + sel('fCode', 'รหัสวิชา', uniq(function (l) { return l.code; })) + sel('fRoom', 'ชั้น/ห้อง', uniq(function (l) { return l.room; })) + sel('fT', 'ผู้สอน', uniq(function (l) { return l.teacherName || l.teacher; })) + '</div><div id="tOut" style="margin-top:12px"></div></div>';
    var draw = function () {
      var fc = $('fCode').value, fr = $('fRoom').value, ft = $('fT').value;
      var list = logs.filter(function (l) { return (!fc || l.code === fc) && (!fr || l.room === fr) && (!ft || (l.teacherName || l.teacher) === ft); });
      var head = ['วันที่', 'ชั้น/ห้อง', 'คาบ', 'รหัสวิชา', 'ผู้สอน', 'ผู้สอนร่วม/แทน', 'เลขที่ไม่เข้าเรียน', 'รวมไม่เข้าเรียน', 'เนื้อหาที่สอน', 'งาน/การบ้าน', 'บันทึก'];
      var rows = list.map(function (l) {
        var nb = (l.records || []).filter(function (r) { return r.status !== 'มา' && r.status !== 'สาย' && LOCK.indexOf(r.status) < 0; });
        return [thDate(l.date), l.room + (l.groupName ? ' · ' + l.groupName : ''), pShort(l.period), l.code, l.confirmed === false ? '⏳ รอยืนยัน (หัวหน้าห้อง ' + (l.leaderName || '') + ')' : (l.teacherName || l.teacher) + (l.leaderName ? ' (หน.ห้องบันทึก)' : ''), l.coTeacher || '-', nb.map(function (r) { return r.no; }).sort(function (a, b) { return a - b; }).join(', ') || '-', nb.length, l.topic, l.work ? l.work.type + ': ' + l.work.detail + (l.work.due ? ' (ส่ง ' + thDate(l.work.due) + ')' : '') : '-', l.note || '-'];
      });
      setSheet('รายงานการเข้าสอน', head, rows, {left: [0, 4], wrap: [8, 9, 10]});
      $('tOut').innerHTML = '<p class="muted">' + list.length + ' คาบ</p>' + tableHTML(head, rows, {left: [0, 4], wrap: [8, 9, 10]}) + exportBar();
    };
    ['fCode', 'fRoom', 'fT'].forEach(function (id) { $(id).onchange = draw; }); draw();
  }
  // ---- กลุ่มเสี่ยง ----
  function risk() {
    var D = st.data, g = {};
    D.logs.forEach(function (l) {
      (l.records || []).forEach(function (r) {
        if (LOCK.indexOf(r.status) >= 0) return;
        var k = l.room + '|' + r.no + '|' + r.name + '|' + l.code, x = g[k] = g[k] || {name: r.name, no: r.no, room: l.room, code: l.code, subject: l.subject || D.subjects[l.code] || '', teachers: {}, n: 0, a: 0};
        x.n++; if (ABSENT.indexOf(r.status) >= 0) x.a++; x.teachers[l.teacherName || l.teacher] = 1;
      });
    });
    var all = Object.keys(g).map(function (k) { var x = g[k]; x.pa = x.n ? x.a * 100 / x.n : 0; x.att = 100 - x.pa; x.ev = EVAL.find(function (e) { return x.att >= e.min; }); return x; }).sort(function (a, b) { return b.pa - a.pa || cmpTh(a.room, b.room) || a.no - b.no; });
    var uniq = function (f) { var o = {}; all.forEach(function (x) { o[f(x)] = 1; }); return Object.keys(o).sort(cmpTh); };
    var sel = function (id, label, vals, def) { return '<div><label for="' + id + '">' + label + '</label><select id="' + id + '"><option value="">ทั้งหมด</option>' + vals.map(function (v) { return '<option' + (v === def ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select></div>'; };
    $('sBody').innerHTML = '<div class="card"><h2>นักเรียนกลุ่มเสี่ยงที่ขาดเรียนบ่อย</h2><p class="muted">นับเฉพาะ "ขาด" และ "โดด" · ร้อยละการเข้าเรียน: ปกติ ≥90% · เสี่ยง 85–89% · ติดต่อครูผู้สอน 80–84% · หมดสิทธิ์สอบ (มส.) &lt;80%</p><div class="grid">' +
      sel('rLv', 'ระดับชั้น', uniq(function (x) { return level(x.room); })) + sel('rRoom', 'ห้อง', uniq(function (x) { return x.room; })) + sel('rCode', 'รหัสวิชา', uniq(function (x) { return x.code; })) +
      '<div><label for="rEv">ผลการประเมิน</label><select id="rEv"><option value="!">ไม่ปกติทั้งหมด</option><option value="">ทั้งหมด</option>' + EVAL.map(function (e) { return '<option>' + e.label + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="rQ">ค้นหาชื่อ</label><input id="rQ" type="search"></div></div><div id="rOut" style="margin-top:12px"></div></div>';
    var draw = function () {
      var lv = $('rLv').value, rm = $('rRoom').value, cd = $('rCode').value, ev = $('rEv').value, q = $('rQ').value.trim();
      var list = all.filter(function (x) { return (!lv || level(x.room) === lv) && (!rm || x.room === rm) && (!cd || x.code === cd) && (ev === '!' ? x.ev.label !== 'ปกติ' : !ev || x.ev.label === ev) && (!q || x.name.indexOf(q) >= 0); });
      var head = ['ชื่อ–นามสกุล', 'ระดับชั้น', 'ห้อง', 'เลขที่', 'รหัสวิชา', 'ครูผู้สอน', 'จำนวนคาบ', 'ขาด/โดด (ครั้ง)', 'ร้อยละที่ขาด (%)', 'ผลการประเมิน'];
      var rows = list.map(function (x) { return [x.name, level(x.room), x.room, Number(x.no) || x.no, x.code, Object.keys(x.teachers).join(', '), x.n, x.a, Math.round(x.pa * 100) / 100, {html: '<span class="pill ' + x.ev.cls + '">' + x.ev.label + '</span>', text: x.ev.label}]; });
      setSheet('นักเรียนกลุ่มเสี่ยง', head, rows, {left: [0, 5]});
      var c = {}; all.forEach(function (x) { c[x.ev.label] = (c[x.ev.label] || 0) + 1; });
      $('rOut').innerHTML = '<div class="kpi">' + EVAL.map(function (e) { return '<div><b>' + (c[e.label] || 0) + '</b><span>' + e.label + ' (คน-วิชา)</span></div>'; }).join('') + '</div>' + tableHTML(head, rows, {left: [0, 5]}) + exportBar();
    };
    ['rLv', 'rRoom', 'rCode', 'rEv'].forEach(function (id) { $(id).onchange = draw; }); $('rQ').oninput = draw; draw();
  }
  return {init: init, excel: excel, print: print};
})();

// =====================================================================
// หน้า: ผู้ดูแลระบบ
// =====================================================================
var Admin = (function () {
  var tab = 'teachers';
  var TABS = [['teachers', '👩‍🏫 ครู / รายวิชา'], ['leaders', '🧑‍🎓 หัวหน้าห้อง'], ['students', '📋 นักเรียน'], ['groups', '📚 วิชาเลือก / กลุ่มเรียน'], ['timetable', '🗓️ ตารางเรียน'], ['rooms', '🏫 ห้องเรียน']];
  function init() {
    $('v-admin').innerHTML = '<div class="card"><h2>⚙️ ผู้ดูแลระบบ · บันทึกเวลาเรียน</h2><div class="chips" id="aTabs">' + TABS.map(function (t) { return '<button type="button" class="chip" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div></div><div id="aBody"></div>';
    $('aTabs').querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { tab = b.dataset.t; render(); }; });
    render();
  }
  function render() {
    $('aTabs').querySelectorAll('.chip').forEach(function (b) { b.classList.toggle('on', b.dataset.t === tab); });
    ({teachers: teachers, leaders: leaders, students: students, groups: groups, timetable: timetable, rooms: rooms})[tab]();
  }
  // ---- ครู + รายวิชา ----
  function teachers() {
    loading(true);
    Promise.all([db.collection('teachers').get(), db.collection('p_teacherInfo').get(), getSubjects()]).then(function (v) {
      loading(false);
      var info = {}; v[1].forEach(function (d) { info[d.id] = d.data(); });
      var list = []; v[0].forEach(function (d) { if (d.data().active !== false) list.push({email: d.id, name: d.data().name || d.id}); }); list.sort(function (a, b) { return cmpTh(a.name, b.name); });
      var subj = v[2];
      $('aBody').innerHTML = '<div class="card"><h2>รหัสวิชาที่ครูแต่ละคนสอน</h2><p class="muted">ใส่ได้สูงสุด 15 รหัส คั่นด้วยเว้นวรรคหรือจุลภาค · รายชื่อครูมาจากระบบเช็คเข้าแถว</p>' +
        list.map(function (t, i) { return '<div class="stu"><span class="nm">' + esc(t.name) + '<small>' + esc(t.email) + '</small></span><input id="tc' + i + '" style="max-width:52%" value="' + esc(((info[t.email] || {}).codes || []).join(' ')) + '" placeholder="ค21101 ค22101"></div>'; }).join('') +
        '<button class="btn pri" style="width:100%;margin-top:12px" id="tcSave">บันทึกรหัสวิชาของครู</button></div>' +
        '<div class="card"><h2>รายวิชา (รหัส → ชื่อวิชา)</h2><p class="muted">บรรทัดละ 1 วิชา: รหัสวิชา เว้นวรรค ชื่อวิชา · คัดลอกจาก Excel ได้</p><textarea id="subjText" style="min-height:180px">' + esc(Object.keys(subj).sort().map(function (c) { return c + ' ' + subj[c]; }).join('\n')) + '</textarea><button class="btn pri" style="width:100%;margin-top:10px" id="subjSave">บันทึกรายวิชา</button></div>';
      $('tcSave').onclick = function () {
        var batch = db.batch(), bad = '';
        list.forEach(function (t, i) { var c = $('tc' + i).value.split(/[\s,]+/).map(function (x) { return x.trim(); }).filter(Boolean); if (c.length > 15) bad = t.name; batch.set(db.doc('p_teacherInfo/' + t.email), {codes: c.slice(0, 15)}); });
        if (bad) return toast(bad + ' ใส่เกิน 15 รหัส', 'err');
        loading(true); batch.commit().then(function () { loading(false); toast('บันทึกแล้ว ✓'); }).catch(fail);
      };
      $('subjSave').onclick = function () {
        var map = {}; $('subjText').value.split('\n').forEach(function (line) { var m = /^\s*(\S+)[\s,\t]+(.+?)\s*$/.exec(line); if (m) map[m[1]] = m[2]; });
        loading(true); db.doc('p_settings/subjects').set({map: map}).then(function () { cache.subjects = map; loading(false); toast('บันทึก ' + Object.keys(map).length + ' วิชา ✓'); }).catch(fail);
      };
    }).catch(fail);
  }
  // ---- หัวหน้าห้อง ----
  function leaders() {
    loading(true);
    Promise.all([getRooms(), db.doc('p_settings/leaders').get()]).then(function (v) {
      var rs = v[0], by = v[1].exists ? v[1].data().byRoom || {} : {};
      return Promise.all(rs.map(getStudents)).then(function (stu) {
        loading(false);
        $('aBody').innerHTML = '<div class="card"><h2>หัวหน้าห้อง</h2><p class="muted">เลือกหัวหน้าห้อง (ต้องมีเลขประจำตัวในหน้า "นักเรียน") แล้วกด "ออก PIN" ระบบสุ่ม PIN 6 หลักให้ แจ้งหัวหน้าห้องโดยตรง · ออก PIN ใหม่ = PIN เก่าใช้ไม่ได้ทันที</p>' +
          rs.map(function (r, i) {
            var cur = by[roomId(r)], opts = stu[i].filter(function (s) { return s.sid; });
            return '<div class="stu" style="flex-wrap:wrap"><span class="nm"><b>' + esc(r) + '</b><small>' + (cur ? 'ปัจจุบัน: ' + esc(cur.name) + ' (' + esc(cur.sid) + ')' : 'ยังไม่มีหัวหน้าห้อง') + '</small></span>' +
              '<select id="ld' + i + '" style="min-width:180px;flex:1"><option value="">— เลือกนักเรียน —</option>' + opts.map(function (s) { return '<option value="' + esc(s.sid) + '"' + (cur && cur.sid === s.sid ? ' selected' : '') + '>' + esc(s.no + '. ' + s.name + ' · ' + s.sid) + '</option>'; }).join('') + '</select>' +
              '<button class="btn sm pri" onclick="Admin.issue(' + i + ')">ออก PIN</button>' + (cur ? '<button class="btn sm danger" onclick="Admin.revoke(' + i + ')">ยกเลิก</button>' : '') + '</div>';
          }).join('') + (rs.some(function (r, i) { return !stu[i].some(function (s) { return s.sid; }); }) ? '<div class="note warn">บางห้องยังไม่มีเลขประจำตัวนักเรียน ไปที่แท็บ "นักเรียน" เพื่อเพิ่มก่อน</div>' : '') + '</div>';
        Admin._ld = {rooms: rs, stu: stu, by: by};
      });
    }).catch(fail);
  }
  function secondaryAuth() {
    var app = firebase.apps.find(function (a) { return a.name === 'leaderAdmin'; }) || firebase.initializeApp(CFG.FIREBASE, 'leaderAdmin');
    var a = app.auth(); return a.setPersistence(firebase.auth.Auth.Persistence.NONE).then(function () { return a; });
  }
  function issue(i) {
    var L = Admin._ld, room = L.rooms[i], sid = $('ld' + i).value, s = L.stu[i].find(function (x) { return x.sid === sid; });
    if (!s) return toast('เลือกนักเรียนก่อน', 'err');
    var pin = String(Math.floor(100000 + Math.random() * 900000)), email = 's' + sid.replace(/\W/g, '') + '.' + Date.now().toString(36) + '@' + LEADER_DOMAIN, old = L.by[roomId(room)];
    loading(true, 'กำลังสร้างบัญชีหัวหน้าห้อง…');
    secondaryAuth().then(function (a) { return a.createUserWithEmailAndPassword(email, pin).then(function () { return a.signOut(); }); }).then(function () {
      var batch = db.batch();
      if (old && old.email) { batch.delete(db.doc('p_leaders/' + old.email)); if (old.sid !== sid) batch.delete(db.doc('p_leaderLogin/' + old.sid)); }
      batch.set(db.doc('p_leaders/' + email), {sid: sid, name: s.name, room: room, roomId: roomId(room)});
      batch.set(db.doc('p_leaderLogin/' + sid), {email: email});
      var by = {}; by[roomId(room)] = {sid: sid, name: s.name, email: email};
      batch.set(db.doc('p_settings/leaders'), {byRoom: by}, {merge: true});
      return batch.commit();
    }).then(function () {
      loading(false);
      openModal('<h2>PIN หัวหน้าห้อง ' + esc(room) + '</h2><div class="note ok" style="font-size:15px">' + esc(s.name) + '<br>เลขประจำตัว: <b>' + esc(sid) + '</b><br>PIN: <b style="font-size:26px;letter-spacing:4px">' + pin + '</b></div><p class="muted">แจ้ง PIN นี้กับหัวหน้าห้องโดยตรง ระบบจะไม่แสดง PIN นี้อีก หัวหน้าห้องเปลี่ยน PIN เองได้หลังเข้าระบบ<br>ลิงก์เข้าใช้: ' + esc(location.href.split('#')[0]) + '</p>');
      leaders();
    }).catch(fail);
  }
  function revoke(i) {
    var L = Admin._ld, room = L.rooms[i], cur = L.by[roomId(room)];
    if (!cur || !confirm('ยกเลิกสิทธิ์หัวหน้าห้อง ' + room + ' (' + cur.name + ')?')) return;
    loading(true);
    Promise.all([db.doc('p_leaders/' + cur.email).delete(), db.doc('p_leaderLogin/' + cur.sid).delete(), db.doc('p_settings/leaders').update(new firebase.firestore.FieldPath('byRoom', roomId(room)), FV.delete())]).then(function () { loading(false); toast('ยกเลิกแล้ว'); leaders(); }).catch(fail);
  }
  // ---- นักเรียน ----
  function students() {
    getRooms().then(function (rs) {
      $('aBody').innerHTML = '<div class="card"><h2>นักเรียน · เลขประจำตัว · สถานะ</h2><div class="row"><div style="flex:1;min-width:150px"><label for="asRoom">ห้อง</label><select id="asRoom">' + rs.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div><button class="btn" style="margin-top:20px" id="asSync">↻ ดึงรายชื่อล่าสุดจากระบบเช็คเข้าแถว</button></div>' +
        '<p class="muted">รายชื่อมาจากระบบเช็คเข้าแถวอัตโนมัติ · สถานะ ขาดเรียนนาน / พักการเรียน / ลาออก / ไม่มีตัวตน จะถูกล็อกในการเช็คชื่อทุกคาบจนกว่าจะเปลี่ยนกลับเป็นปกติ</p><div id="asList"></div></div>' +
        '<div class="card"><h2>นำเข้าจาก Excel</h2><p class="muted">คัดลอกจาก Excel มาวางได้ 3 แบบ<br>① <b>เลขประจำตัวคอลัมน์เดียว</b> เรียงตามเลขที่ 1, 2, 3… (ง่ายสุด)<br>② <b>เลขที่ | เลขประจำตัว</b><br>③ <b>เลขที่ | เลขประจำตัว | ชื่อ–นามสกุล | สถานะ</b> (ถ้าเลขที่ไม่มีในห้อง จะเพิ่มเป็นนักเรียนใหม่)</p><textarea id="asPaste" style="min-height:140px" placeholder="12345&#10;12346&#10;12347"></textarea><button class="btn pri" style="width:100%;margin-top:10px" id="asImport">นำเข้า</button></div>';
      $('asRoom').onchange = draw;
      $('asSync').onclick = function () { loading(true); syncStudents(true).then(function () { cache = {rooms: cache.rooms, groups: cache.groups}; loading(false); toast('ดึงรายชื่อล่าสุดแล้ว ✓'); draw(); }).catch(fail); };
      $('asImport').onclick = importPaste;
      draw();
    }).catch(fail);
  }
  var asList = [];
  function collect() { asList.forEach(function (s, i) { if ($('sid' + i)) { s.sid = $('sid' + i).value.trim(); s.status = $('sst' + i).value; } }); }
  function draw() {
    var room = $('asRoom').value; clearStu(room);
    getStudents(room, true).then(function (l) {
      asList = l.map(function (s) { return Object.assign({}, s); });
      var vis = asList.filter(function (s) { return !s.hidden; }).length, hid = asList.filter(function (s) { return s.hidden; });
      $('asList').innerHTML = (vis ? asList.map(function (s, i) { if (s.hidden) return ''; return '<div class="stu" style="flex-wrap:wrap"><span class="no">' + esc(s.no) + '</span><span class="nm">' + esc(s.name) + (s.extra ? '<small>เพิ่มในส่วนนี้</small>' : '') + '</span><input id="sid' + i + '" style="max-width:130px" inputmode="numeric" placeholder="เลขประจำตัว" value="' + esc(s.sid || '') + '"><select id="sst' + i + '" style="width:auto;min-width:130px" class="' + (s.status && s.status !== 'ปกติ' ? 'st-lock' : '') + '">' + statusOptions(STUDENT_STATUS, s.status || 'ปกติ') + '</select><button type="button" class="btn sm danger" title="ลบชื่อนี้" onclick="Admin.delStu(' + i + ')">🗑</button></div>'; }).join('') : '<div class="note warn">ห้องนี้ยังไม่มีรายชื่อ เพิ่มรายชื่อในระบบเช็คเข้าแถว หรือนำเข้าด้านล่าง</div>') +
        (vis ? '<button class="btn pri" style="width:100%;margin-top:12px" id="asSave">บันทึก</button>' : '') +
        (hid.length ? '<details style="margin-top:12px"><summary class="muted">ชื่อที่ลบไว้ ' + hid.length + ' คน (กดเพื่อกู้คืน)</summary>' + asList.map(function (s, i) { return s.hidden ? '<div class="stu"><span class="no">' + esc(s.no) + '</span><span class="nm" style="color:var(--muted);text-decoration:line-through">' + esc(s.name) + '</span><button type="button" class="btn sm" onclick="Admin.restoreStu(' + i + ')">↩ กู้คืน</button></div>' : ''; }).join('') + '</details>' : '');
      if (vis) $('asSave').onclick = function () { collect(); saveList(room, asList); };
    }).catch(fail);
  }
  function delStu(i) {
    collect(); var s = asList[i], room = $('asRoom').value;
    if (!confirm('ลบ "' + s.name + '" (เลขที่ ' + s.no + ') ออกจากห้อง ' + room + ' ในส่วนบันทึกเวลาเรียน?' + (s.extra ? '' : '\n\nชื่อนี้มาจากระบบเช็คเข้าแถว จะถูกซ่อนในส่วนนี้ (กู้คืนได้) ถ้าต้องการลบถาวรทั้ง 2 ระบบ ให้ลบที่ระบบเช็คเข้าแถว → จัดการนักเรียน'))) return;
    if (s.extra) asList.splice(i, 1); else s.hidden = true;
    saveList(room, asList);
  }
  function restoreStu(i) { collect(); delete asList[i].hidden; saveList($('asRoom').value, asList); }
  function saveList(room, list) {
    var seen = {}, dup = list.find(function (s) { if (!s.sid) return false; if (seen[s.sid]) return true; seen[s.sid] = 1; return false; });
    if (dup) return toast('เลขประจำตัว ' + dup.sid + ' ซ้ำกัน', 'err');
    loading(true);
    db.doc('p_students/' + roomId(room)).set({room: room, students: list.slice().sort(byNo), syncedAt: FV.serverTimestamp()}).then(function () { clearStu(room); loading(false); toast('บันทึกแล้ว ✓'); draw(); }).catch(fail);
  }
  // วางได้ 3 แบบ: (1) เลขประจำตัวคอลัมน์เดียว เรียงตามเลขที่ (2) เลขที่ | เลขประจำตัว (3) เลขที่ | เลขประจำตัว | ชื่อ | สถานะ
  function importPaste() {
    var room = $('asRoom').value, list = asList.map(function (s) { return Object.assign({}, s); }).sort(byNo), n = 0, added = 0;
    var lines = $('asPaste').value.split(/\r?\n/).map(function (l) { return l.split(/\t|\s*,\s*/).map(function (x) { return x.trim(); }).filter(Boolean); }).filter(function (c) { return c.length; });
    if (!lines.length) return toast('ยังไม่ได้วางข้อมูล', 'err');
    if (lines.every(function (c) { return c.length === 1; })) {
      var vis = list.filter(function (x) { return !x.hidden; });
      if (lines.length !== vis.length && !confirm('วางเลขประจำตัว ' + lines.length + ' รายการ แต่ห้องนี้มี ' + vis.length + ' คน\nระบบจะใส่ให้ตามลำดับเลขที่ ' + Math.min(lines.length, vis.length) + ' คนแรก ดำเนินการต่อ?')) return;
      lines.slice(0, vis.length).forEach(function (c, i) { vis[i].sid = c[0]; n++; });
    } else {
      lines.forEach(function (c) {
        var no = c[0], sid = c[1] || '', name = c[2] || '', stt = STUDENT_STATUS.indexOf(c[3]) >= 0 ? c[3] : null;
        var s = list.find(function (x) { return String(x.no) === String(no) && !x.hidden; });
        if (s) { s.sid = sid; if (stt) s.status = stt; n++; }
        else if (name) { list.push({no: no, name: name, sid: sid, status: stt || 'ปกติ', extra: true}); added++; }
      });
    }
    if (!n && !added) return toast('ไม่พบเลขที่ที่ตรงกับรายชื่อในห้องนี้', 'err');
    asList = list; saveList(room, list); toast('ใส่เลขประจำตัว ' + n + ' คน' + (added ? ' · เพิ่มใหม่ ' + added + ' คน' : ''));
  }

  // ---- วิชาเลือก / กลุ่มเรียน: นักเรียนต่างห้องเรียนร่วมกัน ครูและตารางของกลุ่มเอง ----
  var G = null; // กลุ่มที่กำลังแก้ไข
  function allStudents() { // ทุกห้อง: ใช้จับคู่สมาชิกกลุ่ม
    return getRooms().then(function (rs) { return Promise.all(rs.map(function (r) { return getStudents(r); })).then(function (l) { var all = []; rs.forEach(function (r, i) { l[i].forEach(function (x) { all.push(Object.assign({room: r}, x)); }); }); return all; }); });
  }
  function matchMember(all, row) { // row: {no,sid,name,room}
    var sid = String(row.sid || '').trim(), room = String(row.room || '').trim(), nm = normName(row.name);
    return (sid && all.find(function (x) { return x.sid && x.sid === sid; })) ||
      (room && row.no && all.find(function (x) { return x.room === room && String(x.no) === String(row.no) && (!nm || normName(x.name) === nm); })) ||
      (nm && all.find(function (x) { return normName(x.name) === nm && (!room || x.room === room); })) || null;
  }
  function parseRows(rows) { // แถวจาก Excel: เลขที่ | เลขประจำตัว | ชื่อ | ห้อง (เรียงคอลัมน์ไหนก็ได้ ระบบเดาจากรูปแบบ)
    return rows.map(function (c) {
      c = c.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean); if (!c.length) return null;
      if (c.some(function (v) { return /^(เลขที่|เลขประจำตัว|ชื่อ|ชื่อ\s*[–-]\s*นามสกุล|ชื่อ\s*[–-]\s*สกุล|ห้อง|ชั้น)$/.test(v); })) return null; // แถวหัวตาราง
      var o = {}; c.forEach(function (v) {
        if (/^ม\.?\s*\d+\s*\/\s*\d+$/.test(v)) o.room = v.replace(/\s/g, '').replace(/^ม(?!\.)/, 'ม.');
        else if (/^\d{4,}$/.test(v)) o.sid = v;
        else if (/^\d{1,3}$/.test(v) && !o.no) o.no = String(+v);
        else if (/[ก-๙a-zA-Z]/.test(v) && !o.name) o.name = v;
      });
      return o.sid || o.name ? o : null;
    }).filter(Boolean);
  }
  function groups() {
    loading(true);
    Promise.all([getGroups(true), db.collection('teachers').get()]).then(function (v) {
      loading(false); var gs = v[0], tn = {}; v[1].forEach(function (d) { tn[d.id] = d.data().name || d.id; });
      $('aBody').innerHTML = '<div class="card"><h2>วิชาเลือก / กลุ่มเรียน</h2><p class="muted">ใช้กับวิชาที่นักเรียน<b>ต่างห้องเรียนร่วมกัน</b> หรือแบ่งนักเรียนในห้องตามวิชาเลือก (เช่น จีนเพิ่มเติม · ดาราศาสตร์ · ศิลปะเพิ่มเติม) แต่ละกลุ่มมีรายชื่อ ครูผู้สอน และคาบเรียนของตัวเอง</p>' +
        (gs.length ? gs.map(function (g) {
          var rooms = {}; (g.members || []).forEach(function (m) { rooms[m.room] = (rooms[m.room] || 0) + 1; });
          return '<div class="stu" style="flex-wrap:wrap"><span class="nm"><b>' + esc(g.name) + '</b>' + (g.code ? ' · ' + esc(g.code) : '') + '<small>' + (g.members || []).length + ' คน (' + Object.keys(rooms).sort(cmpTh).map(function (r) { return r + ' ' + rooms[r]; }).join(', ') + ')' +
            ' · ครู: ' + ((g.teachers || []).map(function (e) { return tn[e] || e; }).join(', ') || '<span style="color:var(--bad)">ยังไม่กำหนด</span>') + ' · คาบ: ' + ((g.slots || []).map(slotLabel).join(', ') || '<span style="color:var(--bad)">ยังไม่กำหนด</span>') + '</small></span>' +
            '<button class="btn sm" onclick="Admin.editGroup(\'' + g.id + '\')">✎ แก้ไข</button><button class="btn sm danger" onclick="Admin.delGroup(\'' + g.id + '\')">🗑</button></div>';
        }).join('') : '<div class="note info">ยังไม่มีกลุ่มเรียน</div>') +
        '<div class="row" style="margin-top:12px"><button class="btn pri" style="flex:1" onclick="Admin.editGroup(\'\')">＋ สร้างกลุ่มใหม่</button></div></div>' +
        '<div class="card"><h2>นำเข้าจากไฟล์ Excel</h2><p class="muted">1 ชีต = 1 กลุ่ม (ชื่อชีต = ชื่อกลุ่ม) · คอลัมน์: <b>เลขที่ | เลขประจำตัว | ชื่อ–นามสกุล | ห้อง</b><br>ถ้ามีชีตชื่อ <b>"รายวิชา"</b> (กลุ่ม | รหัสวิชา | ชื่อวิชา | ครูผู้สอน) ระบบจะใส่รหัสวิชาและครูให้ด้วย · กลุ่มชื่อเดิมจะถูกอัปเดต (คาบเรียนเดิมยังอยู่)</p><input type="file" id="gFile" accept=".xlsx,.xls"><div id="gPrev"></div></div>';
      $('gFile').onchange = function () { importGroupsFile(this.files[0]); };
    }).catch(fail);
  }
  function slotLabel(k) { var a = k.split('-'); return (DAYS[a[0]] || '').slice(0, 2) + '.' + (a[1] === 'HR' ? 'HR' : a[1]); }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = ok; sc.onerror = function () { no(new Error('โหลดตัวอ่าน Excel ไม่สำเร็จ')); }; document.head.appendChild(sc); });
  }
  function teacherMatcher(snap) { // จับคู่ครูจากชื่อ (มี/ไม่มีคำนำหน้า) หรืออีเมล
    var ts = []; snap.forEach(function (d) { ts.push({email: d.id, name: normName(d.data().name || '')}); });
    var bare = function (n) { return normName(n).replace(/^(นางสาว|นาง|นาย|ว่าที่\s*ร\.?\s*ต\.?\s*(หญิง)?|ดร\.)\s*/, '').replace(/\s/g, ''); };
    return function (q) { q = normName(q); if (!q) return null; var lo = q.toLowerCase();
      return ts.find(function (t) { return t.email === lo; }) || ts.find(function (t) { return t.name === q; }) || ts.find(function (t) { return t.name && bare(t.name) === bare(q); }) || null; };
  }
  function importGroupsFile(file) {
    if (!file) return; loading(true, 'กำลังอ่านไฟล์…');
    Promise.all([loadXlsx(), allStudents(), getGroups(true), db.collection('teachers').get(), getSubjects()]).then(function (v) {
      var all = v[1], gs = v[2], findT = teacherMatcher(v[3]), subj = v[4];
      return file.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(buf, {type: 'array'}), plan = [], meta = {};
        var metaSheet = wb.SheetNames.find(function (n) { return /^(รายวิชา|ข้อมูลกลุ่ม)$/.test(n.trim()); });
        if (metaSheet) XLSX.utils.sheet_to_json(wb.Sheets[metaSheet], {header: 1, raw: false, defval: ''}).forEach(function (r) {
          var c = r.map(function (x) { return String(x).trim(); }); if (!c[0] || /^(กลุ่ม|ชื่อกลุ่ม|ชีต)/.test(c[0]) || /^คำอธิบาย|^หมายเหตุ/.test(c[0])) return;
          var tnames = String(c[3] || '').split(/\s*[,\/\n]\s*/).filter(Boolean);
          meta[c[0]] = {code: c[1] || '', subject: c[2] || subj[c[1]] || '', teachers: tnames.map(function (n) { var t = findT(n); return t ? t.email : null; }).filter(Boolean), missT: tnames.filter(function (n) { return !findT(n); })};
        });
        wb.SheetNames.forEach(function (sn) {
          if (sn === metaSheet) return;
          var rows = parseRows(XLSX.utils.sheet_to_json(wb.Sheets[sn], {header: 1, raw: false, defval: ''})), mem = [], miss = [];
          rows.forEach(function (r) { var m = matchMember(all, r); if (m) { if (!mem.some(function (x) { return x.room === m.room && skey(x) === skey(m); })) mem.push({room: m.room, no: m.no, name: m.name, sid: m.sid || r.sid || ''}); } else miss.push(r); });
          if (rows.length) plan.push({name: sn.trim(), members: mem, miss: miss, meta: meta[sn.trim()], exist: gs.find(function (g) { return g.name === sn.trim(); })});
        });
        loading(false);
        if (!plan.length) return toast('ไม่พบรายชื่อในไฟล์', 'err');
        $('gPrev').innerHTML = '<div class="note info">' + plan.map(function (p) { var m = p.meta;
          return '<b>' + esc(p.name) + '</b> ' + (p.exist ? '(อัปเดตกลุ่มเดิม)' : '(กลุ่มใหม่)') + ': พบ ' + p.members.length + ' คน' +
            (m ? ' · ' + esc(m.code) + ' · ครู ' + (m.teachers.length ? m.teachers.length + ' คน' : '-') + (m.missT.length ? ' · <span style="color:var(--bad)">ไม่พบครู: ' + esc(m.missT.join(', ')) + ' (เพิ่มครูในระบบเช็คเข้าแถวก่อน หรือเลือกภายหลัง)</span>' : '') : '') +
            (p.miss.length ? ' · <span style="color:var(--bad)">ไม่พบนักเรียน ' + p.miss.length + ' คน: ' + p.miss.map(function (m) { return esc((m.room || '') + ' ' + (m.name || m.sid)); }).join(', ') + '</span>' : ''); }).join('<br>') + '</div><button class="btn pri" style="width:100%" id="gDo">ยืนยันนำเข้า ' + plan.length + ' กลุ่ม</button>';
        $('gDo').onclick = function () {
          var batch = db.batch();
          plan.forEach(function (p) {
            var ref = p.exist ? db.doc('p_groups/' + p.exist.id) : db.collection('p_groups').doc(), m = p.meta || {};
            var data = {members: p.members, updatedAt: FV.serverTimestamp()};
            if (!p.exist) { data.name = p.name; data.code = ''; data.subject = p.name; data.teachers = []; data.slots = []; }
            if (m.code) data.code = m.code; if (m.subject) data.subject = m.subject; if (m.teachers && m.teachers.length) data.teachers = m.teachers;
            batch.set(ref, data, {merge: true});
          });
          loading(true); batch.commit().then(function () { loading(false); toast('นำเข้า ' + plan.length + ' กลุ่มแล้ว ✓ กด "แก้ไข" เพื่อกำหนดคาบเรียน'); groups(); }).catch(fail);
        };
      });
    }).catch(fail);
  }
  function editGroup(id) {
    loading(true);
    Promise.all([getGroups(), db.collection('teachers').get(), getSubjects(), getRooms(), allStudents()]).then(function (v) {
      loading(false);
      var g = v[0].find(function (x) { return x.id === id; }) || {name: '', code: '', subject: '', teachers: [], slots: [], members: []};
      G = JSON.parse(JSON.stringify(g)); G.id = id; G._all = v[4];
      var ts = []; v[1].forEach(function (d) { if (d.data().active !== false) ts.push({email: d.id, name: d.data().name || d.id}); }); ts.sort(function (a, b) { return cmpTh(a.name, b.name); });
      var subj = v[2], rooms = v[3];
      openModal('<h2>' + (id ? 'แก้ไขกลุ่ม' : 'สร้างกลุ่มใหม่') + '</h2><div class="grid"><div><label for="gName">ชื่อกลุ่ม</label><input id="gName" value="' + esc(G.name) + '" placeholder="เช่น จีนเพิ่มเติม ม.3"></div><div><label for="gCode">รหัสวิชา</label><input id="gCode" list="gSubj" value="' + esc(G.code || '') + '"></div><div><label for="gSubjName">ชื่อวิชา</label><input id="gSubjName" value="' + esc(G.subject || '') + '"></div></div>' +
        '<datalist id="gSubj">' + Object.keys(subj).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(subj[c]) + '</option>'; }).join('') + '</datalist>' +
        '<h3>ครูผู้สอน</h3><div class="chips">' + ts.map(function (t) { return '<button type="button" class="chip' + (G.teachers.indexOf(t.email) >= 0 ? ' on' : '') + '" data-e="' + esc(t.email) + '">' + esc(t.name) + '</button>'; }).join('') + '</div>' +
        '<h3>คาบเรียนของกลุ่ม <span class="muted">(แตะเพื่อเลือก)</span></h3><div class="tbl-wrap"><table><thead><tr><th>วัน</th>' + PERIODS.map(function (p) { return '<th>' + (p === 'HR' ? 'HR' : p) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        [1, 2, 3, 4, 5].map(function (d) { return '<tr><td><b>' + DAYS[d] + '</b></td>' + PERIODS.map(function (p) { var k = d + '-' + p; return '<td><button type="button" class="ck ' + (G.slots.indexOf(k) >= 0 ? 'y' : 'z') + '" style="cursor:pointer" data-k="' + k + '">' + (G.slots.indexOf(k) >= 0 ? '✓' : '·') + '</button></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
        '<h3>สมาชิก <span class="muted" id="gCount"></span></h3><div id="gMem"></div>' +
        '<div class="grid" style="margin-top:8px"><div><label for="gAddRoom">เพิ่มจากห้อง</label><select id="gAddRoom">' + rooms.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div></div><div id="gPick" style="max-height:240px;overflow:auto;margin-top:6px"></div>' +
        '<label for="gPaste" style="margin-top:10px">หรือวางจาก Excel (เลขที่ | เลขประจำตัว | ชื่อ | ห้อง หรือเลขประจำตัวอย่างเดียว)</label><textarea id="gPaste"></textarea><button class="btn sm" type="button" id="gPasteBtn" style="margin-top:6px">เพิ่มจากที่วาง</button>' +
        '<button class="btn pri" style="width:100%;margin-top:14px" id="gSave">💾 บันทึกกลุ่ม</button>');
      $('gCode').oninput = function () { var n = subj[this.value.trim()]; if (n && !$('gSubjName').value) $('gSubjName').value = n; };
      $('modalBox').querySelectorAll('.chip[data-e]').forEach(function (b) { b.onclick = function () { b.classList.toggle('on'); }; });
      $('modalBox').querySelectorAll('.ck[data-k]').forEach(function (b) { b.onclick = function () { var on = b.classList.toggle('y'); b.classList.toggle('z', !on); b.textContent = on ? '✓' : '·'; }; });
      $('gAddRoom').onchange = drawPick; $('gPasteBtn').onclick = function () {
        var rows = parseRows($('gPaste').value.split(/\r?\n/).map(function (l) { return l.split(/\t|,/); })), add = 0, miss = [];
        rows.forEach(function (r) { var m = matchMember(G._all, r); if (!m) return miss.push(r.name || r.sid); if (!G.members.some(function (x) { return x.room === m.room && skey(x) === skey(m); })) { G.members.push({room: m.room, no: m.no, name: m.name, sid: m.sid || r.sid || ''}); add++; } });
        $('gPaste').value = ''; drawMem(); drawPick(); toast('เพิ่ม ' + add + ' คน' + (miss.length ? ' · ไม่พบ ' + miss.length + ' คน: ' + miss.join(', ') : ''), miss.length ? 'err' : 'ok');
      };
      $('gSave').onclick = saveGroup; drawMem(); drawPick();
    }).catch(fail);
  }
  function memKey(m) { return m.room + '|' + skey(m); }
  function drawMem() {
    G.members.sort(function (a, b) { return cmpTh(a.room, b.room) || byNo(a, b); });
    $('gCount').textContent = '(' + G.members.length + ' คน)';
    $('gMem').innerHTML = G.members.length ? G.members.map(function (m, i) { return '<div class="stu"><span class="no">' + esc(m.no) + '</span><span class="nm">' + esc(m.name) + '<small>' + esc(m.room + (m.sid ? ' · ' + m.sid : '')) + '</small></span><button type="button" class="btn sm danger" onclick="Admin._gDel(' + i + ')">✕</button></div>'; }).join('') : '<p class="muted">ยังไม่มีสมาชิก</p>';
  }
  function drawPick() {
    var room = $('gAddRoom').value, inG = {}; G.members.forEach(function (m) { inG[memKey(m)] = 1; });
    var list = G._all.filter(function (x) { return x.room === room; });
    $('gPick').innerHTML = list.map(function (x, i) { var on = inG[memKey(x)]; return '<label class="stu" style="margin:0;cursor:pointer;font-weight:400"><input type="checkbox" style="width:22px;min-height:22px;height:22px" data-i="' + i + '"' + (on ? ' checked' : '') + '><span class="no">' + esc(x.no) + '</span><span class="nm">' + esc(x.name) + '</span></label>'; }).join('') || '<p class="muted">ไม่มีรายชื่อ</p>';
    $('gPick').querySelectorAll('input').forEach(function (cb) { cb.onchange = function () { var x = list[+cb.dataset.i], k = memKey(x); if (cb.checked) { if (!G.members.some(function (m) { return memKey(m) === k; })) G.members.push({room: x.room, no: x.no, name: x.name, sid: x.sid || ''}); } else G.members = G.members.filter(function (m) { return memKey(m) !== k; }); drawMem(); }; });
  }
  function saveGroup() {
    var name = $('gName').value.trim(); if (!name) return toast('กรุณาตั้งชื่อกลุ่ม', 'err');
    var data = {name: name, code: $('gCode').value.trim(), subject: $('gSubjName').value.trim() || name,
      teachers: Array.prototype.map.call($('modalBox').querySelectorAll('.chip[data-e].on'), function (b) { return b.dataset.e; }),
      slots: Array.prototype.map.call($('modalBox').querySelectorAll('.ck[data-k].y'), function (b) { return b.dataset.k; }),
      members: G.members.map(function (m) { return {room: m.room, no: m.no, name: m.name, sid: m.sid || ''}; }), updatedAt: FV.serverTimestamp()};
    if (!data.members.length) return toast('ยังไม่มีสมาชิกในกลุ่ม', 'err');
    var ref = G.id ? db.doc('p_groups/' + G.id) : db.collection('p_groups').doc();
    loading(true); ref.set(data).then(function () { loading(false); closeModal(); cache.groups = null; toast('บันทึกกลุ่ม ' + name + ' ✓'); groups(); }).catch(fail);
  }
  function delGroup(id) {
    var g = (cache.groups || []).find(function (x) { return x.id === id; }); if (!g || !confirm('ลบกลุ่ม "' + g.name + '"?\nบันทึกการสอนที่เคยบันทึกไว้ยังอยู่ในรายงาน')) return;
    loading(true); db.doc('p_groups/' + id).delete().then(function () { loading(false); cache.groups = null; groups(); }).catch(fail);
  }
  // ---- ตารางเรียน ----
  function timetable() {
    Promise.all([getRooms(), getSubjects()]).then(function (v) {
      var rs = v[0], subj = v[1];
      $('aBody').innerHTML = '<div class="card"><h2>ตารางเรียน</h2><div class="row"><div style="flex:1;min-width:150px"><label for="ttRoom">ห้อง</label><select id="ttRoom">' + rs.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div><div style="flex:1;min-width:150px"><label for="ttCopy">คัดลอกตารางไปห้อง</label><select id="ttCopy"><option value="">—</option>' + rs.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div></div>' +
        '<p class="muted">ใส่รหัสวิชาในแต่ละช่อง (ชื่อวิชาดึงจากแท็บครู/รายวิชาอัตโนมัติ) · ปกติเรียนถึงคาบ 8 · ช่องว่าง = ไม่มีเรียน</p><datalist id="ttSubj">' + Object.keys(subj).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(subj[c]) + '</option>'; }).join('') + '</datalist><div id="ttGrid"></div><button class="btn pri" style="width:100%;margin-top:12px" id="ttSave">บันทึกตารางเรียน</button></div>';
      var load = function () {
        var room = $('ttRoom').value; delete cache['tt_' + room];
        getTimetable(room).then(function (slots) {
          $('ttGrid').innerHTML = '<div class="tbl-wrap tt"><table><thead><tr><th>คาบ</th>' + [1, 2, 3, 4, 5].map(function (d) { return '<th>' + DAYS[d] + '</th>'; }).join('') + '</tr></thead><tbody>' +
            PERIODS.map(function (p) { return '<tr><td><b>' + (p === 'HR' ? 'โฮมรูม' : p) + '</b></td>' + [1, 2, 3, 4, 5].map(function (d) { var s = slots[d + '-' + p] || {}; return '<td><input list="ttSubj" data-k="' + d + '-' + p + '" value="' + esc(s.code || '') + '" title="' + esc(s.name || '') + '"></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        }).catch(fail);
      };
      $('ttRoom').onchange = load;
      $('ttSave').onclick = function () {
        var room = $('ttRoom').value, slots = {};
        $('ttGrid').querySelectorAll('input').forEach(function (inp) { var c = inp.value.trim(); if (c) slots[inp.dataset.k] = {code: c, name: subj[c] || ''}; });
        var targets = [room]; if ($('ttCopy').value && $('ttCopy').value !== room) targets.push($('ttCopy').value);
        var batch = db.batch(); targets.forEach(function (r) { batch.set(db.doc('p_timetable/' + roomId(r)), {room: r, slots: slots}); });
        loading(true); batch.commit().then(function () { targets.forEach(function (r) { delete cache['tt_' + r]; }); cache.ttAll = null; loading(false); toast('บันทึกตาราง ' + targets.join(', ') + ' ✓'); }).catch(fail);
      };
      load();
    }).catch(fail);
  }
  // ---- ห้องเรียน ----
  function rooms() {
    getRooms().then(function (rs) {
      $('aBody').innerHTML = '<div class="card"><h2>ห้องเรียนที่ใช้ในส่วนบันทึกเวลาเรียน</h2><p class="muted">บรรทัดละ 1 ห้อง ต้องสะกดตรงกับระบบเช็คเข้าแถว (เช่น ม.1/1) · ค่าเริ่มต้น 12 ห้อง</p><textarea id="rmText" style="min-height:240px">' + esc(rs.join('\n')) + '</textarea><div class="row" style="margin-top:10px"><button class="btn" id="rmDef">ใช้ค่าเริ่มต้น 12 ห้อง</button><button class="btn pri" style="flex:1" id="rmSave">บันทึก</button></div></div>';
      $('rmDef').onclick = function () { $('rmText').value = DEFAULT_ROOMS.join('\n'); };
      $('rmSave').onclick = function () {
        var list = $('rmText').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        list = list.filter(function (x, i) { return list.indexOf(x) === i; });
        if (!list.length) return toast('ต้องมีอย่างน้อย 1 ห้อง', 'err');
        loading(true); db.doc('p_settings/rooms').set({list: list}).then(function () { cache.rooms = list; loading(false); toast('บันทึก ' + list.length + ' ห้อง ✓'); }).catch(fail);
      };
    }).catch(fail);
  }
  return {init: init, issue: issue, revoke: revoke, delStu: delStu, restoreStu: restoreStu, editGroup: editGroup, delGroup: delGroup, _gDel: function (i) { G.members.splice(i, 1); drawMem(); drawPick(); }};
})();

// =====================================================================
// ตัวเขียนไฟล์ Excel แบบจัดรูปแบบ (ชุดเดียวกับระบบเช็คเข้าแถว)
// =====================================================================
function wppXml(value){return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function wppColumn(index){let s='';for(let n=index+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function wppCRC32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function wppZip(files){const enc=new TextEncoder(),parts=[],central=[];let offset=0,size=0;const put=(view,off,val,len)=>len===2?view.setUint16(off,val,true):view.setUint32(off,val,true);
 for(const [path,text] of files){const name=enc.encode(path),data=enc.encode(text),crc=wppCRC32(data),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);put(v,0,0x04034b50,4);put(v,4,20,2);put(v,6,0x0800,2);put(v,12,0x21,2);put(v,14,crc,4);put(v,18,data.length,4);put(v,22,data.length,4);put(v,26,name.length,2);local.set(name,30);parts.push(local,data);
 const h=new Uint8Array(46+name.length),d=new DataView(h.buffer);put(d,0,0x02014b50,4);put(d,4,20,2);put(d,6,20,2);put(d,8,0x0800,2);put(d,14,0x21,2);put(d,16,crc,4);put(d,20,data.length,4);put(d,24,data.length,4);put(d,28,name.length,2);put(d,42,offset,4);h.set(name,46);central.push(h);offset+=local.length+data.length;size+=h.length;}
 const end=new Uint8Array(22),v=new DataView(end.buffer);put(v,0,0x06054b50,4);put(v,8,files.length,2);put(v,10,files.length,2);put(v,12,size,4);put(v,16,offset,4);return new Blob([...parts,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function wppThaiDateText(v){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);if(!m)return v;const th=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return `${+m[3]} ${th[+m[2]-1]} ${+m[1]+543}`;}
function wppWorkbook(sheets){const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/package/2006/relationships',office='http://schemas.openxmlformats.org/officeDocument/2006/relationships',xml='<'+'?xml version="1.0" encoding="UTF-8" standalone="yes"?'+'>';
 // style ids: 0 ปกติ 1 หัวตาราง 2 ชื่อรายงาน 3 รายละเอียดใต้ชื่อ 4 ข้อความ 5 ตัวเลข 6 ร้อยละ 7-9 แถวสลับ 10 ป้ายหัวข้อ (ตัวหนา) 11 ข้อความยาว 12 ชื่อโรงเรียน
 const styles=xml+`<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/></numFmts>
<fonts count="7"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font><font><b/><sz val="16"/><color rgb="FF1F4E79"/><name val="Tahoma"/></font><font><sz val="10"/><color rgb="FF5B6B82"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FF1F4E79"/><name val="Tahoma"/></font><font><b/><sz val="12"/><color rgb="FFC2185B"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FF1F4E79"/><name val="Tahoma"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2E86C1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F8FD"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1FA"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC9D9EA"/></left><right style="thin"><color rgb="FFC9D9EA"/></right><top style="thin"><color rgb="FFC9D9EA"/></top><bottom style="thin"><color rgb="FFC9D9EA"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="6" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/></styleSheet>`;
 const files=[['[Content_Types].xml',xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((x,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'],
  ['_rels/.rels',xml+`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ['xl/workbook.xml',xml+`<workbook xmlns="${ns}" xmlns:r="${office}"><sheets>`+sheets.map((x,i)=>`<sheet name="${wppXml(String(x.name).slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets><definedNames>'+sheets.map((x,i)=>x._printTitle?`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${wppXml(String(x.name).slice(0,31)).replace(/'/g,"''")}'!$${x._printTitle}:$${x._printTitle}</definedName>`:'').join('')+'</definedNames></workbook>'],
  ['xl/_rels/workbook.xml.rels',xml+`<Relationships xmlns="${rel}">`+sheets.map((x,i)=>`<Relationship Id="rId${i+1}" Type="${office}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${sheets.length+1}" Type="${office}/styles" Target="styles.xml"/></Relationships>`],
  ['xl/styles.xml',styles]];
 const school='โรงเรียนวังโพรงพิทยาคม';
 sheets.forEach((sh,i)=>{
  const header=sh.rows[0]||[],body=sh.rows.slice(1),cols=Math.max(header.length,...body.map(r=>r.length),1),kv=!!sh.kv;
  const pct=header.map(h=>/%/.test(String(h))),pre=[];
  pre.push([[school,12]]);pre.push([[sh.title||sh.name,2]]);(sh.subtitle||[]).forEach(t=>pre.push([[t,3]]));pre.push([]);
  const hr=pre.length+1;sheets[i]._printTitle=hr;
  // ความกว้างคอลัมน์: ใช้ที่กำหนด หรือคำนวณจากความยาวข้อความ (ภาษาไทยกว้างกว่า)
  const widths=[];for(let c=0;c<cols;c++){if(sh.widths&&sh.widths[c]){widths[c]=sh.widths[c];continue;}let w=String(header[c]??'').length*1.3+4;body.slice(0,300).forEach(r=>{const v=r[c];const l=typeof v==='number'?String(v).length+3:String(v??'').length*1.05+3;if(l>w)w=l;});widths[c]=Math.max(8,Math.min(60,Math.round(w)));}
  let x=xml+`<worksheet xmlns="${ns}" xmlns:r="${office}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${hr}" topLeftCell="A${hr+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>`;
  widths.forEach((w,c)=>{x+=`<col min="${c+1}" max="${c+1}" width="${w}" customWidth="1"/>`;});x+='</cols><sheetData>';
  const cell=(ref,v,st)=>{if(typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;const t=wppThaiDateText(String(v??''));return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${wppXml(t)}</t></is></c>`;};
  let rn=0;pre.forEach(r=>{rn++;x+=`<row r="${rn}"${r.length&&r[0][1]===2?' ht="28" customHeight="1"':''}>`+(r.length?cell('A'+rn,r[0][0],r[0][1]):'')+'</row>';});
  rn++;x+=`<row r="${rn}" ht="34" customHeight="1">`+header.map((h,c)=>cell(wppColumn(c)+rn,h,1)).join('')+'</row>';
  body.forEach((row,bi)=>{rn++;const z=bi%2===1,tot=!kv&&/^รวม/.test(String(row[0]??''));x+=`<row r="${rn}">`;for(let c=0;c<cols;c++){let v=row[c]??'';let st;
   if(kv&&typeof v==='number')v=v.toLocaleString('th-TH');if(tot)st=typeof v==='number'?(pct[c]?15:14):13;else if(kv&&c===0)st=10;else if(kv)st=11;else if(typeof v==='number')st=pct[c]?(z?9:6):(z?8:5);else st=z?7:4;x+=cell(wppColumn(c)+rn,v,st);}x+='</row>';});
  x+='</sheetData>';
  const merges=pre.map((r,k)=>r.length&&cols>1?`<mergeCell ref="A${k+1}:${wppColumn(Math.min(cols,kv?2:cols)-1)}${k+1}"/>`:'').filter(Boolean);
  if(sh.filter&&body.length>1)x+=`<autoFilter ref="A${hr}:${wppColumn(cols-1)}${hr+body.length}"/>`;
  if(merges.length)x+=`<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>`;
  // แถบสีร้อยละ: แดง (ต่ำ) → เหลือง → เขียว (สูง)
  let pr=1;const dataRows=body.length-(body.length&&/^รวม/.test(String(body[body.length-1][0]??''))&&!kv?1:0);pct.forEach((on,c)=>{if(on&&dataRows>1){const col=wppColumn(c);x+=`<conditionalFormatting sqref="${col}${hr+1}:${col}${hr+dataRows}"><cfRule type="colorScale" priority="${pr++}"><colorScale><cfvo type="num" val="50"/><cfvo type="num" val="80"/><cfvo type="num" val="100"/><color rgb="FFF8B4B4"/><color rgb="FFFFE9A8"/><color rgb="FFB7E4C7"/></colorScale></cfRule></conditionalFormatting>`;}});
  x+=`<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.25" footer="0.25"/><pageSetup paperSize="9" orientation="${cols>7?'landscape':'portrait'}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${wppXml(school)}&amp;C${wppXml(sh.title||sh.name)}&amp;Rหน้า &amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;
  files.push([`xl/worksheets/sheet${i+1}.xml`,x]);});
 return wppZip(files);
}
