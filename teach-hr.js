/* WPP — บันทึกโฮมรูมในหน้า "บันทึกการสอน" (ใช้คู่กับ period.js · โหลดหลัง period.js)
 * เลือกคาบ HR (ห้องเดียว) → แทนช่อง "เนื้อหาที่สอน" ด้วย: ติ๊กคุณลักษณะ 8 ข้อ + อื่นๆ + แนบรูป
 * เก็บที่เดียวกับหน้าส่งงานเขตพื้นที่: p_area/{date}_{roomId}.hr และ .photos.hr → เล่มบันทึกโฮมรูมดึงไปใช้ได้ทันที
 * เวลาเรียนคาบ HR ยังบันทึกใน p_class ตามปกติ (topic = สรุปหัวข้อที่ติ๊ก)
 */
var HR_TRAITS = ['รักชาติ ศาสน์ กษัตริย์', 'ความซื่อสัตย์', 'ระเบียบวินัย', 'ใฝ่รู้ใฝ่เรียน', 'ความพอเพียง', 'ความมุ่งมั่น', 'รักความเป็นไทย', 'จิตสาธารณะ'];
var HR_MAX_PICS = 6;

var TeachHR = {
  date: null, room: null, doc: {},
  ref: function () { return db.doc('p_area/' + this.date + '_' + roomId(this.room)); },
  // HTML แทนช่องเนื้อหา (เติมค่าจากบันทึกเดิมทีหลังใน load)
  panel: function (date, room, topic) {
    this.date = date; this.room = room; this.doc = {};
    var T = this; setTimeout(function () { T.load(); }, 0);
    return '<div id="tHr" style="margin-top:10px"><label>🏠 เรื่องที่อบรมในคาบโฮมรูม <span class="muted" style="font-weight:400">(คุณลักษณะอันพึงประสงค์)</span></label>' +
      '<div class="hr-traits">' + HR_TRAITS.map(function (t) { return '<label class="hr-tr"><input type="checkbox" value="' + esc(t) + '"> ' + esc(t) + '</label>'; }).join('') + '</div>' +
      '<label for="tHrO">อื่น ๆ / รายละเอียด</label><input id="tHrO" maxlength="200" placeholder="เช่น ชี้แจงตารางสอบกลางภาค">' +
      '<label style="margin-top:10px">📷 ภาพกิจกรรม <span class="muted" style="font-weight:400">(ใช้ในเล่มบันทึกโฮมรูม · ไม่เกิน ' + HR_MAX_PICS + ' รูป)</span></label><div class="hr-pics" id="tHrPics"></div>' +
      '<label class="btn" id="tHrAdd" style="width:100%;margin-top:6px">📷 ถ่ายรูป / เลือกรูป<input type="file" accept="image/*" multiple hidden onchange="TeachHR.add(this)"></label>' +
      '<div class="muted" id="tHrMsg" style="margin-top:6px;font-size:12px"></div></div>';
  },
  load: function () {
    var T = this, d = T.date, r = T.room;
    T.ref().get().then(function (s) {
      if (T.date !== d || T.room !== r || !$('tHr')) return;
      T.doc = s.exists ? s.data() : {};
      var hr = T.doc.hr || {};
      $('tHr').querySelectorAll('.hr-traits input').forEach(function (x) { x.checked = (hr.topics || []).indexOf(x.value) >= 0; });
      if (hr.other) $('tHrO').value = hr.other;
      if (hr.at) $('tHrMsg').textContent = '✓ บันทึกหัวข้อแล้ว ' + hr.at + ' น.' + (hr.byName ? ' โดย ' + hr.byName : '');
      T.pics();
    }).catch(function (e) { console.warn('p_area', e); T.pics(); });
  },
  pics: function () {
    var list = ((this.doc.photos || {}).hr || []), box = $('tHrPics'); if (!box) return;
    box.innerHTML = list.map(function (p) {
      return '<a class="hr-pic" href="https://drive.google.com/file/d/' + encodeURIComponent(p.id) + '/view" target="_blank" rel="noopener"><img src="https://drive.google.com/thumbnail?id=' + encodeURIComponent(p.id) + '&sz=w300" alt="" loading="lazy"><span>' + esc(p.t || '') + '</span></a>';
    }).join('');
    $('tHrAdd').style.display = list.length >= HR_MAX_PICS ? 'none' : '';
  },
  // อ่านค่าที่ติ๊ก → {topics, other, text} (null = ยังไม่เลือก)
  collect: function () {
    var topics = Array.prototype.map.call(document.querySelectorAll('#tHr .hr-traits input:checked'), function (x) { return x.value; }), other = $('tHrO').value.trim();
    if (!topics.length && !other) { toast('เลือกเรื่องที่อบรมอย่างน้อย 1 ข้อ', 'err'); return null; }
    return {topics: topics, other: other, text: 'โฮมรูม: ' + topics.concat(other ? [other] : []).join(', ')};
  },
  base: function () { return {date: this.date, room: this.room, roomId: roomId(this.room), term: termFor(this.date), updated: FV.serverTimestamp()}; },
  saveArea: function (hr) {
    var d = this.base(); d.hr = {topics: hr.topics, other: hr.other, at: hrNow(), byName: me.name, byEmail: me.email};
    return this.ref().set(d, {merge: true}).catch(function (e) { console.warn('save p_area hr', e); toast('บันทึกเวลาเรียนแล้ว แต่บันทึกหัวข้อโฮมรูมไม่สำเร็จ: ' + (e.message || e), 'err'); });
  },
  add: function (input) {
    var T = this, files = Array.prototype.slice.call(input.files || []); input.value = '';
    var url = CFG.AREA_UPLOAD_URL; if (!url) return toast('ยังไม่ได้ตั้งค่า AREA_UPLOAD_URL ใน config.js', 'err');
    files = files.slice(0, HR_MAX_PICS - ((T.doc.photos || {}).hr || []).length); if (!files.length) return;
    var chain = Promise.resolve(), n = 0, d = T.date, r = T.room;
    loading(true, 'กำลังส่งรูป…');
    files.forEach(function (f) {
      chain = chain.then(function () { return hrShrink(f); }).then(function (data) {
        return auth.currentUser.getIdToken().then(function (tok) {
          return fetch(url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify({idToken: tok, task: 'hr', date: d, room: r, term: termFor(d), image: data})});
        });
      }).then(function (res) { return res.json(); }).then(function (j) {
        if (!j.ok) throw new Error(j.error || 'ส่งรูปไม่สำเร็จ');
        var item = {id: j.id, t: hrNow()}, add = {updated: FV.serverTimestamp()}; add['photos.hr'] = FV.arrayUnion(item);
        return T.ref().set(T.base(), {merge: true}).then(function () { return T.ref().update(add); }).then(function () { T.doc.photos = T.doc.photos || {}; (T.doc.photos.hr = T.doc.photos.hr || []).push(item); n++; });
      });
    });
    chain.then(function () { loading(false); toast('ส่งรูปแล้ว ' + n + ' รูป ✓'); T.pics(); }).catch(function (e) { loading(false); T.pics(); fail(e); });
  }
};
function hrNow() { return new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date()); }
function hrShrink(file) {
  return new Promise(function (ok, no) {
    var u = URL.createObjectURL(file), img = new Image();
    img.onload = function () { var s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', 0.78)); };
    img.onerror = function () { no(new Error('เปิดไฟล์รูปไม่ได้')); }; img.src = u;
  });
}
