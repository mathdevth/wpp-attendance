/* WPP — ส่งงานเขตพื้นที่ประจำวัน (area.html)
 * Firestore: p_area/{date}_{roomId} {date,room,roomId,term,by,name,updated, hr:{topics:[],other,at}, photos:{area:[{id,t}],toilet:[…],room:[…],hr:[…]}}
 *   p_settings/advisors {byRoom:{roomId:[email,email]}}   ครูที่ปรึกษา (แอดมินกำหนด)
 * รูปเก็บใน Google Drive ผ่าน Apps Script (area.gs) → CFG.AREA_UPLOAD_URL
 */
var CFG = window.WPP_CONFIG || {};
var LEADER_DOMAIN = 'wpp-leader.app', TZ = 'Asia/Bangkok';
var TASKS = [
  {k: 'area', icon: '🌳', name: 'เขตพื้นที่ประจำวัน', hint: 'ถ่ายให้เห็นพื้นที่ที่รับผิดชอบหลังทำความสะอาด'},
  {k: 'toilet', icon: '🚻', name: 'เวรทำความสะอาดห้องน้ำ', hint: 'ส่งเฉพาะวันที่ห้องเราเข้าเวร'},
  {k: 'room', icon: '🏫', name: 'ทำความสะอาดห้องเรียน', hint: 'ถ่ายให้เห็นสภาพห้องทั้งห้อง'}
];
var MAX_PICS = 6;
// คุณลักษณะอันพึงประสงค์ 8 ประการ (หัวข้ออบรมโฮมรูม ตามแบบบันทึกของโรงเรียน)
var TRAITS = ['รักชาติ ศาสน์ กษัตริย์', 'ความซื่อสัตย์', 'ระเบียบวินัย', 'ใฝ่รู้ใฝ่เรียน', 'ความพอเพียง', 'ความมุ่งมั่น', 'รักความเป็นไทย', 'จิตสาธารณะ'];
var HR_TASK = {k: 'hr', icon: '🏠', name: 'กิจกรรมโฮมรูม', hint: 'เลือกเรื่องที่ครูอบรม แล้วแนบรูประหว่างทำกิจกรรม'};
var DEFAULT_ROOMS = ['ม.1/1', 'ม.1/2', 'ม.2/1', 'ม.2/2', 'ม.3/1', 'ม.3/2', 'ม.4/1', 'ม.4/2', 'ม.5/1', 'ม.5/2', 'ม.6/1', 'ม.6/2'];

firebase.initializeApp(CFG.FIREBASE);
var auth = firebase.auth(), db = firebase.firestore(), FV = firebase.firestore.FieldValue;
var me = null, termCfg = null, HR_BY = 'leader'; // ผู้บันทึกโฮมรูม: leader | advisor | both (p_settings/hr)

function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
function today() { var p = {}; new Intl.DateTimeFormat('en-GB', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
function nowTime() { return new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date()); }
var TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
var TH_D = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
function thDate(d) { var a = d.split('-'); return 'วัน' + TH_D[new Date(d + 'T00:00:00Z').getUTCDay()] + 'ที่ ' + (+a[2]) + ' ' + TH_M[+a[1] - 1] + ' ' + (+a[0] + 543); }
function roomId(room) { return String(room).trim().replace(/[\/\s]+/g, '-'); }
function thumb(id, w) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (w || 400); }
function view(id) { return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view'; }
function loading(on, t) { $('loading').hidden = !on; if (t) $('loading').textContent = t; }
function toast(text, kind) {
  var n = document.createElement('div'); n.className = 'note ' + (kind || 'ok'); n.textContent = text;
  n.style.cssText = 'position:fixed;left:16px;right:16px;top:12px;z-index:70;max-width:520px;margin:auto;box-shadow:0 6px 20px #0002';
  document.body.appendChild(n); setTimeout(function () { n.remove(); }, kind === 'err' ? 6000 : 2600);
}
function fail(e) { loading(false); console.error(e); toast(e && e.code === 'permission-denied' ? 'ไม่มีสิทธิ์ทำรายการนี้' : (e && e.message) || String(e), 'err'); }
function openModal(html) { $('modalBox').innerHTML = html + '<div class="row" style="margin-top:14px"><button class="btn" style="flex:1" onclick="closeModal()">ปิด</button></div>'; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; }
$('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
function termFor(date) {
  var t = termCfg; if (t && t.current) return t.next && t.nextFrom && date >= t.nextFrom ? t.next : t.current;
  var m = +date.slice(5, 7), y = +date.slice(0, 4) + 543;
  return m >= 5 && m < 11 ? '1/' + y : '2/' + (m >= 11 ? y : y - 1);
}

// ---------- เข้าสู่ระบบ ----------
function msg(t, k) { var m = $('loginMsg'); m.hidden = !t; m.className = 'note ' + (k || 'err'); m.textContent = t || ''; }
function authErr(e) {
  var m = {'auth/invalid-credential': 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง', 'auth/wrong-password': 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง', 'auth/user-not-found': 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง',
    'auth/too-many-requests': 'ลองผิดหลายครั้ง กรุณารอสักครู่', 'auth/popup-closed-by-user': 'ปิดหน้าต่างก่อนเข้าสู่ระบบ', 'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้'};
  return m[e && e.code] || (e && e.message) || String(e);
}
$('segLeader').onclick = function () { this.classList.add('on'); $('segTeacher').classList.remove('on'); $('leaderLogin').hidden = false; $('teacherLogin').hidden = true; msg(''); };
$('segTeacher').onclick = function () { this.classList.add('on'); $('segLeader').classList.remove('on'); $('leaderLogin').hidden = true; $('teacherLogin').hidden = false; msg(''); };
$('gLogin').onclick = function () { var p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({prompt: 'select_account'}); auth.signInWithPopup(p).catch(function (e) { msg(authErr(e)); }); };
$('tForm').onsubmit = function (ev) { ev.preventDefault(); msg('กำลังตรวจสอบ…', 'info'); auth.signInWithEmailAndPassword($('tEmail').value.trim(), $('tPw').value).catch(function (e) { msg(authErr(e)); }); };
$('leaderLogin').onsubmit = function (ev) {
  ev.preventDefault();
  var sid = $('lSid').value.trim(), pin = $('lPin').value.trim();
  if (!/^\d{6}$/.test(pin)) return msg('PIN ต้องเป็นตัวเลข 6 หลัก');
  msg('กำลังตรวจสอบ…', 'info');
  db.doc('p_leaderLogin/' + sid).get().then(function (s) {
    if (!s.exists) throw {code: 'auth/invalid-credential'};
    return auth.signInWithEmailAndPassword(s.data().email, pin);
  }).catch(function (e) { msg(authErr(e)); });
};
$('logoutBtn').onclick = function () { auth.signOut(); };

auth.onAuthStateChanged(function (u) {
  if (!u) { me = null; $('top').hidden = true; $('app').hidden = true; $('loginView').hidden = false; return; }
  var email = String(u.email || '').toLowerCase(), p;
  loading(true, 'กำลังตรวจสิทธิ์…');
  if (email.slice(-LEADER_DOMAIN.length - 1) === '@' + LEADER_DOMAIN) {
    p = db.doc('p_leaders/' + email).get().then(function (s) {
      if (!s.exists) throw new Error('บัญชีหัวหน้าห้องนี้ถูกยกเลิกแล้ว กรุณาติดต่อครู');
      var d = s.data(); me = {email: email, name: d.name, sid: d.sid, room: d.room, roomId: d.roomId, role: 'leader'};
      return Promise.all([db.doc('settings/term').get().then(function (t) { termCfg = t.exists ? t.data() : null; }).catch(function () {}),
        db.doc('p_settings/hr').get().then(function (t) { HR_BY = t.exists && t.data().by || 'leader'; }).catch(function () {})]);
    });
  } else if (!u.emailVerified) p = Promise.reject(new Error('กรุณายืนยันอีเมลในระบบเช็คเข้าแถวก่อน'));
  else p = db.doc('teachers/' + email).get().then(function (s) {
    if (!s.exists || s.data().active === false) throw new Error('อีเมล ' + email + ' ยังไม่ได้รับสิทธิ์ใช้งาน');
    var d = s.data(); me = {email: email, name: d.name || email, role: d.role === 'admin' ? 'admin' : 'teacher'};
    return Promise.all([db.doc('settings/term').get().then(function (t) { termCfg = t.exists ? t.data() : null; }).catch(function () {}),
      db.doc('p_settings/hr').get().then(function (t) { HR_BY = t.exists && t.data().by || 'leader'; }).catch(function () {})]);
  });
  p.then(function () {
    loading(false); $('loginView').hidden = true; $('top').hidden = false; $('app').hidden = false;
    $('whoName').textContent = me.role === 'leader' ? 'หัวหน้าห้อง ' + me.room + ' · ' + me.name : me.name;
    me.role === 'leader' ? Leader.show() : Staff.show();
  }).catch(function (e) { loading(false); auth.signOut(); $('loginView').hidden = false; msg(e.code === 'permission-denied' ? 'ไม่มีสิทธิ์ใช้งาน' : e.message); });
});

// ---------- ย่อรูปก่อนส่ง (ด้านยาว 1280px, JPEG ~200–400KB) ----------
function shrink(file) {
  return new Promise(function (ok, no) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = function () { no(new Error('เปิดไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}
function upload(dataUrl, task, date, room) {
  if (!CFG.AREA_UPLOAD_URL) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า AREA_UPLOAD_URL ใน config.js'));
  return auth.currentUser.getIdToken().then(function (tok) {
    return fetch(CFG.AREA_UPLOAD_URL, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({idToken: tok, task: task, date: date, room: room || '', term: termFor(date), image: dataUrl})});
  }).then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || 'ส่งรูปไม่สำเร็จ'); return j.id; });
}

// ---------- หัวหน้าห้อง ----------
var Leader = {
  date: null, doc: null,
  show: function () {
    this.date = today();
    $('app').innerHTML = '<div class="card"><h2>📸 ' + esc(me.room) + '</h2><div class="muted">' + thDate(this.date) + ' · ส่งได้งานละไม่เกิน ' + MAX_PICS + ' รูป</div><div id="lSum"></div></div><div id="lHr"></div><div id="lTasks"></div>';
    this.load();
  },
  ref: function () { return db.doc('p_area/' + this.date + '_' + me.roomId); },
  load: function () {
    var L = this; loading(true);
    L.ref().get().then(function (s) { loading(false); L.doc = s.exists ? s.data() : {photos: {}}; L.render(); }).catch(fail);
  },
  pics: function (t, list) {
    return '<div class="pics" id="pics_' + t.k + '">' +
      list.map(function (p) { return '<div class="pic"><a href="' + view(p.id) + '" target="_blank" rel="noopener"><img src="' + thumb(p.id) + '" alt="" loading="lazy"></a><span class="t">' + esc(p.t) + ' น.</span><button class="x" title="ลบรูป" onclick="Leader.del(\'' + t.k + '\',\'' + esc(p.id) + '\')">✕</button></div>'; }).join('') +
      '</div><label class="btn pri" style="width:100%' + (list.length >= MAX_PICS ? ';opacity:.5;pointer-events:none' : '') + '">📷 ถ่ายรูป / เลือกรูป<input type="file" accept="image/*" multiple hidden onchange="Leader.add(\'' + t.k + '\',this)"></label>';
  },
  render: function () {
    var L = this, ph = this.doc.photos || {}, done = 0, hr = this.doc.hr || {}, hp = ph.hr || [], saved = (hr.topics || []).length || hr.other;
    if (HR_BY === 'advisor') $('lHr').innerHTML = '<div class="card"><h2>' + HR_TASK.icon + ' ' + HR_TASK.name + '<span class="badge' + (saved ? ' ok' : '') + '">' + (saved ? '✓ ครูบันทึกแล้ว' : 'ครูที่ปรึกษาบันทึก') + '</span></h2><div class="muted">โรงเรียนกำหนดให้ครูที่ปรึกษาเป็นผู้บันทึกโฮมรูม</div></div>';
    else $('lHr').innerHTML = '<div class="card"><h2>' + HR_TASK.icon + ' ' + HR_TASK.name + '<span class="badge' + (saved ? ' ok' : '') + '">' + (saved ? '✓ บันทึกแล้ว' + (hp.length ? ' · ' + hp.length + ' รูป' : '') : 'ยังไม่บันทึก') + '</span></h2>' +
      '<div class="muted">' + HR_TASK.hint + '</div><div class="traits">' + TRAITS.map(function (t, i) {
        return '<label class="tr"><input type="checkbox" value="' + esc(t) + '"' + ((hr.topics || []).indexOf(t) >= 0 ? ' checked' : '') + '> ' + esc(t) + '</label>'; }).join('') + '</div>' +
      '<label for="hrOther">อื่นๆ / รายละเอียดที่อบรม</label><input id="hrOther" maxlength="200" value="' + esc(hr.other || '') + '" placeholder="เช่น ชี้แจงกำหนดสอบกลางภาค">' +
      '<button class="btn" style="width:100%;margin:10px 0 0" onclick="Leader.saveHr()">💾 บันทึกเรื่องที่อบรม</button>' + L.pics(HR_TASK, hp) + '</div>';
    $('lTasks').innerHTML = TASKS.map(function (t) {
      var list = ph[t.k] || []; if (list.length) done++;
      return '<div class="card"><h2>' + t.icon + ' ' + t.name + '<span class="badge' + (list.length ? ' ok' : '') + '">' + (list.length ? '✓ ส่งแล้ว ' + list.length + ' รูป' : 'ยังไม่ส่ง') + '</span></h2>' +
        '<div class="muted">' + t.hint + '</div>' + L.pics(t, list) + '</div>';
    }).join('');
    $('lSum').innerHTML = done === 3 ? '<div class="note ok">ส่งครบทั้ง 3 งานแล้ว 👍</div>' : '<div class="note info">ส่งแล้ว ' + done + ' / 3 งาน (เวรห้องน้ำ ส่งเฉพาะวันที่เข้าเวร)</div>';
  },
  base: function () { return {date: this.date, room: me.room, roomId: me.roomId, term: termFor(this.date), by: me.email, name: me.name, updated: FV.serverTimestamp()}; },
  saveHr: function () {
    var L = this, topics = Array.prototype.map.call(document.querySelectorAll('#lHr .traits input:checked'), function (x) { return x.value; }), other = $('hrOther').value.trim();
    if (!topics.length && !other) return toast('เลือกเรื่องที่อบรมอย่างน้อย 1 ข้อ', 'err');
    var d = L.base(); d.hr = {topics: topics, other: other, at: nowTime()};
    loading(true); L.ref().set(d, {merge: true}).then(function () { loading(false); L.doc.hr = d.hr; toast('บันทึกโฮมรูมแล้ว ✓'); L.render(); }).catch(fail);
  },
  add: function (task, input) {
    var L = this, files = Array.prototype.slice.call(input.files || []); input.value = '';
    var room = MAX_PICS - ((L.doc.photos || {})[task] || []).length;
    if (files.length > room) { toast('เลือกได้อีก ' + room + ' รูป', 'err'); files = files.slice(0, room); }
    if (!files.length) return;
    var box = $('pics_' + task), date = L.date;
    var chain = Promise.resolve(), okN = 0;
    files.forEach(function (f) {
      chain = chain.then(function () { return shrink(f); }).then(function (data) {
        var ph = document.createElement('div'); ph.className = 'pic up'; ph.innerHTML = '<img src="' + data + '" alt="">'; box.appendChild(ph);
        return upload(data, task, date).then(function (id) {
          var item = {id: id, t: nowTime()}, upd = L.base(), add = {updated: FV.serverTimestamp()};
          add['photos.' + task] = FV.arrayUnion(item);
          return L.ref().set(upd, {merge: true}).then(function () { return L.ref().update(add); }).then(function () {
            L.doc.photos = L.doc.photos || {}; (L.doc.photos[task] = L.doc.photos[task] || []).push(item); okN++;
          });
        }).catch(function (e) { ph.remove(); throw e; });
      });
    });
    chain.then(function () { toast('ส่งรูปแล้ว ' + okN + ' รูป ✓'); L.render(); }).catch(function (e) { fail(e); L.render(); });
  },
  del: function (task, id) {
    if (!confirm('ลบรูปนี้ออกจากรายการส่งงาน?')) return;
    var L = this, list = (L.doc.photos || {})[task] || [], item = list.filter(function (p) { return p.id === id; })[0];
    if (!item) return;
    var upd = {updated: FV.serverTimestamp()}; upd['photos.' + task] = FV.arrayRemove(item);
    loading(true); L.ref().update(upd).then(function () { loading(false); L.doc.photos[task] = list.filter(function (p) { return p !== item; }); L.render(); }).catch(fail);
  }
};

// ---------- ครู / แอดมิน : ตรวจการส่ง ----------
var Staff = {
  rooms: null, docs: {},
  tab: 'day',
  show: function () {
    var S = this;
    $('app').innerHTML = '<div class="stabs" id="sTabs"><button data-t="day">🧹 ตรวจรายวัน</button><button data-t="book">📘 เล่มโฮมรูม</button>' + (HR_BY !== 'leader' ? '<button data-t="hr">🏠 บันทึกโฮมรูม</button>' : '') + (me.role === 'admin' ? '<button data-t="adv">👩‍🏫 ครูที่ปรึกษา</button>' : '') + '</div><div id="sView"></div>';
    $('sTabs').querySelectorAll('button').forEach(function (b) { b.onclick = function () { S.tab = b.dataset.t; S.go(); }; });
    db.doc('p_settings/rooms').get().then(function (s) { S.rooms = s.exists && (s.data().list || []).length ? s.data().list : DEFAULT_ROOMS; }).catch(function () { S.rooms = DEFAULT_ROOMS; }).then(function () { S.go(); });
  },
  go: function () {
    var S = this; $('sTabs').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === S.tab); });
    if (S.tab === 'book') return Book.show($('sView'));
    if (S.tab === 'adv') return Advisors.show($('sView'));
    if (S.tab === 'hr') return TeacherHR.show($('sView'));
    S.day();
  },
  day: function () {
    $('sView').innerHTML = '<div class="card"><h2>🧹 ตรวจการส่งงานรายวัน</h2><div class="row" style="margin-top:8px"><div style="flex:1;min-width:160px"><label for="sDate">วันที่</label><input type="date" id="sDate" value="' + today() + '"></div>' +
      '<button class="btn sm" id="sPrev">◀ วันก่อน</button><button class="btn sm" id="sNext">วันถัดไป ▶</button></div><div id="sBody"></div></div>';
    var S = this;
    $('sDate').onchange = function () { S.load(); };
    $('sPrev').onclick = function () { S.shift(-1); }; $('sNext').onclick = function () { S.shift(1); };
    S.load();
  },
  shift: function (n) { var d = new Date($('sDate').value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); $('sDate').value = d.toISOString().slice(0, 10); this.load(); },
  load: function () {
    var S = this, date = $('sDate').value; if (!date) return; loading(true);
    db.collection('p_area').where('date', '==', date).get().then(function (q) {
      loading(false); S.docs = {}; q.forEach(function (d) { S.docs[d.data().roomId] = d.data(); }); S.render(date);
    }).catch(fail);
  },
  render: function (date) {
    var S = this, cnt = {area: 0, toilet: 0, room: 0, hr: 0}, COLS = [HR_TASK].concat(TASKS);
    var rows = S.rooms.map(function (r) {
      var d = S.docs[roomId(r)] || {}, ph = d.photos || {};
      return '<tr><td><b>' + esc(r) + '</b>' + (d.name ? '<br><span class="muted">' + esc(d.name) + '</span>' : '') + '</td>' + COLS.map(function (t) {
        var n = (ph[t.k] || []).length, ok = n || (t.k === 'hr' && d.hr); if (ok) cnt[t.k]++;
        return ok ? '<td class="c y" onclick="Staff.open(\'' + esc(roomId(r)) + '\',\'' + t.k + '\')">✓' + (n ? ' ' + n : '') + '</td>' : '<td class="n">—</td>';
      }).join('') + '</tr>';
    }).join('');
    var N = S.rooms.length;
    $('sBody').innerHTML = '<p class="muted" style="margin:10px 0 0">' + thDate(date) + '</p><div class="sum" style="grid-template-columns:repeat(4,1fr)">' + COLS.map(function (t) { return '<div>' + t.icon + '<b>' + cnt[t.k] + '/' + N + '</b><span class="muted">' + t.name + '</span></div>'; }).join('') + '</div>' +
      '<div style="overflow-x:auto"><table><thead><tr><th>ห้อง</th>' + COLS.map(function (t) { return '<th>' + t.icon + ' ' + t.name + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="muted">แตะ ✓ เพื่อดูรูป · รูปทั้งหมดอยู่ใน Google Drive ของโรงเรียน แยกโฟลเดอร์ ภาคเรียน / วันที่ / ห้อง</p>';
  },
  open: function (rid, task) {
    var d = this.docs[rid], t = [HR_TASK].concat(TASKS).filter(function (x) { return x.k === task; })[0], list = (d.photos || {})[task] || [], hr = d.hr || {};
    openModal('<h2 style="margin:0 0 4px;font-size:17px">' + t.icon + ' ' + esc(d.room) + ' · ' + t.name + '</h2><div class="muted">' + thDate(d.date) + ' · ส่งโดย ' + esc(d.name || '-') + '</div>' +
      (task === 'hr' ? '<div class="note info">เรื่องที่อบรม: ' + esc((hr.topics || []).concat(hr.other ? [hr.other] : []).join(' · ') || '-') + '</div>' : '') + '<div class="pics" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">' +
      list.map(function (p) { return '<div class="pic"><a href="' + view(p.id) + '" target="_blank" rel="noopener"><img src="' + thumb(p.id, 600) + '" alt="" loading="lazy"></a><span class="t">' + esc(p.t) + ' น.</span></div>'; }).join('') + '</div>');
  }
};
