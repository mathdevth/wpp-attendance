/* WPP — ปฏิทินวันหยุด / งดเรียน (ใช้คู่กับ period.js · โหลดหลัง period.js)
 * p_settings/holidays {days: {'yyyy-mm-dd': 'ชื่อวันหยุด/กิจกรรม'}}
 * ผล: ตารางครูเวรไม่นับเป็นคาบค้าง · แดชบอร์ด/แจ้งเตือน Telegram ข้ามวันนี้
 */
var Holidays = {
  days: null,
  load: function (force) {
    var H = this; if (H.days && !force) return Promise.resolve(H.days);
    return db.doc('p_settings/holidays').get().then(function (s) { H.days = s.exists ? s.data().days || {} : {}; return H.days; }).catch(function () { H.days = H.days || {}; return H.days; });
  },
  name: function (date) { return (this.days || {})[date] || ''; },
  // ---------- แท็บผู้ดูแลระบบ ----------
  admin: function () {
    var H = this;
    H.load(true).then(function (days) {
      var keys = Object.keys(days).sort(), t = today(), next = keys.filter(function (k) { return k >= t; }), past = keys.filter(function (k) { return k < t; });
      var row = function (k) { return '<div class="stu"><span class="nm"><b>' + thDate(k) + '</b><small>' + esc(days[k]) + '</small></span><button class="btn sm" type="button" onclick="Holidays.del(\'' + k + '\')">ลบ</button></div>'; };
      $('aBody').innerHTML = '<div class="card"><h2>📅 วันหยุด / งดเรียน</h2><p class="muted">วันที่อยู่ในรายการนี้ ตารางครูเวรจะไม่นับเป็นคาบค้าง และระบบแจ้งเตือน/แดชบอร์ดจะข้ามวันนั้น (เสาร์–อาทิตย์ไม่ต้องใส่)</p>' +
        '<div class="grid"><div><label for="hFrom">ตั้งแต่วันที่</label><input type="date" id="hFrom" value="' + t + '"></div><div><label for="hTo">ถึงวันที่ <span class="muted" style="font-weight:400">(วันเดียวเว้นว่าง)</span></label><input type="date" id="hTo"></div></div>' +
        '<label for="hName" style="margin-top:8px">ชื่อวันหยุด / กิจกรรม</label><input id="hName" maxlength="80" placeholder="เช่น วันพ่อแห่งชาติ · สอบกลางภาค · กีฬาสี">' +
        '<button class="btn pri" type="button" style="width:100%;margin-top:10px" id="hAdd">＋ เพิ่ม</button>' +
        '<details style="margin-top:12px"><summary class="muted" style="cursor:pointer">วางหลายวันพร้อมกัน</summary><p class="muted" style="font-size:12px">บรรทัดละ 1 วัน: <code>2026-12-07 วันพ่อแห่งชาติ (ชดเชย)</code> หรือ <code>7/12/2569 วันพ่อ</code></p><textarea id="hPaste" rows="5"></textarea><button class="btn" type="button" style="width:100%;margin-top:6px" id="hImport">นำเข้า</button></details></div>' +
        '<div class="card"><h2>กำลังจะถึง (' + next.length + ')</h2>' + (next.length ? next.map(row).join('') : '<p class="muted">ยังไม่มี</p>') +
        (past.length ? '<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">ผ่านมาแล้ว ' + past.length + ' วัน</summary>' + past.reverse().map(row).join('') + '</details>' : '') + '</div>';
      $('hAdd').onclick = function () {
        var a = $('hFrom').value, b = $('hTo').value || a, nm = $('hName').value.trim();
        if (!a || !nm) return toast('กรุณาเลือกวันที่และใส่ชื่อ', 'err');
        if (b < a) return toast('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'err');
        var add = {}, d = new Date(a + 'T00:00:00Z'), end = new Date(b + 'T00:00:00Z'), n = 0;
        while (d <= end && n < 120) { var w = d.getUTCDay(), k = d.toISOString().slice(0, 10); if (w !== 0 && w !== 6) add[k] = nm; d.setUTCDate(d.getUTCDate() + 1); n++; }
        if (!Object.keys(add).length) return toast('ช่วงนี้เป็นเสาร์–อาทิตย์ทั้งหมด ไม่ต้องเพิ่ม', 'err');
        H.save(add, Object.keys(add).length);
      };
      $('hImport').onclick = function () {
        var add = {};
        $('hPaste').value.split(/\r?\n/).forEach(function (l) {
          var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s+(.+)$/.exec(l) || null, y, mo, da, nm;
          if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; nm = m[4]; }
          else { m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/.exec(l); if (!m) return; da = +m[1]; mo = +m[2]; y = +m[3]; nm = m[4]; }
          if (y > 2400) y -= 543;
          add[y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0')] = nm.trim().slice(0, 80);
        });
        if (!Object.keys(add).length) return toast('ไม่พบบรรทัดที่อ่านได้', 'err');
        H.save(add, Object.keys(add).length);
      };
    }).catch(fail);
  },
  save: function (add, n) {
    var H = this, days = Object.assign({}, H.days, add); loading(true);
    db.doc('p_settings/holidays').set({days: days, updatedAt: FV.serverTimestamp()}).then(function () { loading(false); H.days = days; toast('เพิ่มแล้ว ' + n + ' วัน ✓'); H.admin(); }).catch(fail);
  },
  del: function (k) {
    var H = this; if (!confirm('ลบ ' + thDate(k) + ' (' + H.days[k] + ') ออกจากวันหยุด?')) return;
    var days = Object.assign({}, H.days); delete days[k]; loading(true);
    db.doc('p_settings/holidays').set({days: days, updatedAt: FV.serverTimestamp()}).then(function () { loading(false); H.days = days; H.admin(); }).catch(fail);
  }
};
