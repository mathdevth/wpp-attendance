/*
 * WPP Student Attendance — ชั้นข้อมูล Firebase
 * แทนที่ Google Apps Script API: หน้าเว็บเดิมยังเรียก google.script.run.xxx() ได้เหมือนเดิม
 * แต่ข้อมูลอ่าน/เขียนที่ Firestore โดยตรง ส่วนการคำนวณรายงานใช้ฟังก์ชันชุดเดิมจาก Code.gs ทุกบรรทัด
 *
 * โครงสร้างข้อมูล Firestore
 *   teachers/{อีเมลตัวเล็ก}   {name, role: 'admin'|'teacher', active, lastLogin}
 *   roster/all                {students: [{no, name, room}], updatedAt}      ← ทะเบียนนักเรียนทั้งโรงเรียนในเอกสารเดียว (อ่าน 1 ครั้ง)
 *   attendance/{วันที่_รอบ_ห้อง} {date, time, period, room, term, records: [{no, name, status}], by, updatedAt}
 *   settings/term             {current, next, nextFrom}
 *   settings/meta             {terms: [], rooms: [], minDate, maxDate}
 *   settings/views            {count}
 *   logs/{auto}               {time, email, event, detail}
 */
'use strict';

// ใช้ฟังก์ชันคำนวณเดิมที่เรียก Utilities.formatDate — จำลองให้ทำงานในเบราว์เซอร์ (เวลาไทย)
window.Utilities = {
  formatDate: function (d, tz, f) {
    var p = {};
    new Intl.DateTimeFormat('en-GB', {timeZone: tz || 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  }
};
var WPP_TZ = 'Asia/Bangkok';
function wppToday_() { return Utilities.formatDate(new Date(), WPP_TZ, 'yyyy-MM-dd'); }

// ===== ฟังก์ชันคำนวณชุดเดิมจาก Code.gs (คัดลอกมาโดยไม่แก้) =====
function getPeriodFromTime(time) {
  if (!time) return 'ไม่ระบุเวลา';
  const parts = String(time).split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return 'ไม่ระบุเวลา';
  const totalMinutes = parts[0] * 60 + parts[1];
  if (totalMinutes < 720) return 'เช้า';
  if (totalMinutes < 1020) return 'บ่าย';
  return 'เย็น';
}
function wppStatsText_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function wppStatsTerm_(v) { return wppStatsText_(v).replace(/^'+/, '').replace(/\s/g,''); }
function wppStatsCompare_(a,b) { return a.localeCompare(b, 'th', {numeric:true}); }
function wppStatsValidDate_(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  var d = new Date(v+'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0,10) === v;
}
function wppStatsDate_(v,tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v,tz,'yyyy-MM-dd');
  if (typeof v === 'number' && isFinite(v)) return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);
  var s = wppStatsText_(v), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/), y, mo, d;
  if (m) { y=+m[1];mo=+m[2];d=+m[3]; }
  else { m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(!m)return '';d=+m[1];mo=+m[2];y=+m[3]; }
  if (y > 2400) y -= 543;
  var result=y+'-'+('0'+mo).slice(-2)+'-'+('0'+d).slice(-2);
  return wppStatsValidDate_(result)?result:'';
}
function wppStatsTime_(v,tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v,tz,'HH:mm:ss');
  if (typeof v === 'number' && isFinite(v)) { var n=Math.round(((v%1)+1)%1*86400)%86400;return ('0'+Math.floor(n/3600)).slice(-2)+':'+('0'+Math.floor(n%3600/60)).slice(-2)+':'+('0'+n%60).slice(-2); }
  var m=wppStatsText_(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(!m || +m[1]>23 || +m[2]>59 || +(m[3]||0)>59) return '';
  return ('0'+m[1]).slice(-2)+':'+m[2]+':'+(m[3]||'00');
}
function wppStatsAggregate_(values, roster, f, tz) {
  var statuses=['มา','สาย','ขาด','ลากิจ','ลาป่วย','กิจกรรม','พักการเรียน'];
  function blank() { return {counts:[0,0,0,0,0,0,0],total:0,rate:null}; }
  function key(parts) { return JSON.stringify(parts); }
  var latest=new Map(), matched=0, duplicates=0, invalidDates=0, invalidRows=0, missingTimes=0;
  var allRooms=new Set(roster.map(function(r){return r.room;}));
  values.forEach(function(row) {
    if(row.every(function(v){return v==='' || v===null;}))return;
    var room=wppStatsText_(row[3]), t=wppStatsTerm_(row[7]);
    if(room)allRooms.add(room);
    if ((f.rooms.length && f.rooms.indexOf(room)<0) || (f.term && t!==f.term)) return;
    if(f.student && (room!==f.student.room || wppStatsText_(row[4])!==f.student.no || wppStatsText_(row[5])!==f.student.name))return;
    var date=wppStatsDate_(row[0],tz);
    if(!date){invalidDates++;return;}
    if(date<f.start || date>f.end)return;
    var time=wppStatsTime_(row[1],tz), p=wppStatsText_(row[2]);
    if(!p) p=time?(+time.slice(0,2)<12?'เช้า':+time.slice(0,2)<17?'บ่าย':'เย็น'):'ไม่ระบุเวลา';
    if(f.period && p!==f.period)return;
    matched++;
    var no=wppStatsText_(row[4]),name=wppStatsText_(row[5]);
    if(!room || !name){invalidRows++;return;}
    if(!time)missingTimes++;
    // Same student + term + date + exact time + period + room: last sheet row wins.
    var k=key([t,date,time,p,room,no,name]);
    if(latest.has(k))duplicates++;
    latest.set(k,{date:date,time:time,period:p,room:room,no:no,name:name,term:t,status:wppStatsText_(row[6])});
  });
  var selectedRooms=(f.rooms.length?f.rooms:Array.from(allRooms)).slice().sort(wppStatsCompare_);
  var roomMap=new Map(), dayMap=new Map(), peopleMap=new Map(), coverageMap=new Map();
  var currentRoster=new Map(), uniquePeople=new Set(), sessions=new Set(), total=blank(), unknownStatuses=0;
  roster.forEach(function(r){if(selectedRooms.indexOf(r.room)>=0 && (!f.student || (r.room===f.student.room && r.no===f.student.no && r.name===f.student.name)))currentRoster.set(key([r.room,r.no,r.name]),r);});
  selectedRooms.forEach(function(room){var b=blank();b.room=room;b.rosterCount=0;b.recordedStudents=0;roomMap.set(room,b);});
  currentRoster.forEach(function(r){roomMap.get(r.room).rosterCount++;});
  function add(b,index) {b.counts[index]++;b.total++;}
  latest.forEach(function(r){
    var index=statuses.indexOf(r.status);if(index<0){unknownStatuses++;return;}
    add(total,index);
    if(!roomMap.has(r.room)){var rb=blank();rb.room=r.room;rb.rosterCount=0;rb.recordedStudents=0;roomMap.set(r.room,rb);}
    add(roomMap.get(r.room),index);
    if(!dayMap.has(r.date)){var db=blank();db.date=r.date;dayMap.set(r.date,db);}
    add(dayMap.get(r.date),index);
    var studentKey=key([r.room,r.no,r.name]);uniquePeople.add(studentKey);
    // Separate student summaries by term; roster has no permanent student IDs.
    var personKey=key([r.term,r.room,r.no,r.name]);
    if(!peopleMap.has(personKey)){var pb=blank();pb.term=r.term;pb.room=r.room;pb.no=r.no;pb.name=r.name;peopleMap.set(personKey,pb);}
    add(peopleMap.get(personKey),index);
    sessions.add(key([r.date,r.time,r.period,r.room,r.term]));
    if(!coverageMap.has(r.date))coverageMap.set(r.date,new Set());coverageMap.get(r.date).add(r.room);
  });
  uniquePeople.forEach(function(k){roomMap.get(JSON.parse(k)[0]).recordedStudents++;});
  function finish(b){b.rate=b.total?100*(b.counts[0]+b.counts[1])/b.total:null;return b;}
  var byRoom=Array.from(roomMap.values()).sort(function(a,b){return wppStatsCompare_(a.room,b.room);}).map(finish);
  var byDay=Array.from(dayMap.values()).sort(function(a,b){return a.date.localeCompare(b.date);}).map(finish);
  var byStudent=Array.from(peopleMap.values()).sort(function(a,b){return wppStatsCompare_(a.room,b.room)||wppStatsCompare_(a.no,b.no)||wppStatsCompare_(a.name,b.name)||wppStatsCompare_(a.term,b.term);}).map(finish);
  var coverage=byDay.map(function(d){var seen=coverageMap.get(d.date);return {date:d.date,recordedRooms:selectedRooms.filter(function(r){return seen.has(r);}),missingRooms:selectedRooms.filter(function(r){return !seen.has(r);})};});
  var history=f.student?Array.from(latest.values()).filter(function(r){return statuses.indexOf(r.status)>=0;}).sort(function(a,b){return b.date.localeCompare(a.date)||b.time.localeCompare(a.time)||wppStatsCompare_(a.term,b.term);}):[];
  return {history:history,studentsWithoutRecords:Array.from(currentRoster.entries()).filter(function(entry){return !uniquePeople.has(entry[0]);}).map(function(entry){return entry[1];}),filters:f,statuses:statuses,summary:finish(total),byRoom:byRoom,byDay:byDay,byStudent:byStudent,coverage:coverage,
    rosterCount:currentRoster.size,recordedStudents:uniquePeople.size,days:byDay.length,sessions:sessions.size,
    roomsWithoutRecords:byRoom.filter(function(r){return r.total===0;}).map(function(r){return r.room;}),
    quality:{matchedRows:matched,duplicateRows:duplicates,invalidDateRows:invalidDates,invalidRows:invalidRows,unknownStatusRows:unknownStatuses,missingTimeRows:missingTimes},
    generatedAt:Utilities.formatDate(new Date(),tz,'yyyy-MM-dd HH:mm:ss'),timezone:tz};
}
function wppDailyAggregate_(rows,roster,f,tz) {
  var statuses=['มา','สาย','ขาด','ลากิจ','ลาป่วย','กิจกรรม','พักการเรียน'];
  var rooms=new Map(),people=new Map(),latest=new Map(),duplicates=0,invalidIdentities=0;
  function key(room,no,name){return JSON.stringify([room,no,name]);}
  roster.forEach(function(p){
    if(f.room&&p.room!==f.room)return;
    var k=key(p.room,p.no,p.name);if(people.has(k))return;
    people.set(k,p);
    if(!rooms.has(p.room))rooms.set(p.room,{room:p.room,total:0,checked:0,missing:0,counts:[0,0,0,0,0,0,0],state:'none'});
    rooms.get(p.room).total++;
  });
  rows.forEach(function(r){
    var room=wppStatsText_(r[3]);
    if(f.room&&room!==f.room)return;
    if(f.term&&wppStatsTerm_(r[7])!==f.term)return;
    if(wppStatsDate_(r[0],tz)!==f.date)return;
    var time=wppStatsTime_(r[1],tz),period=wppStatsText_(r[2]);
    if(!period&&time)period=+time.slice(0,2)<12?'เช้า':+time.slice(0,2)<17?'บ่าย':'เย็น';
    if(period!==f.period)return;
    var no=wppStatsText_(r[4]),name=wppStatsText_(r[5]);
    if(!room||!name){invalidIdentities++;return;}
    var k=key(room,no,name);if(latest.has(k))duplicates++;
    latest.set(k,{room:room,status:wppStatsText_(r[6])});
  });
  var counts=[0,0,0,0,0,0,0],unmatched=0,invalidStatuses=0,extraRooms=new Set();
  latest.forEach(function(r,k){
    if(!people.has(k)){unmatched++;extraRooms.add(r.room);return;}
    var i=statuses.indexOf(r.status);if(i<0){invalidStatuses++;return;}
    counts[i]++;var room=rooms.get(r.room);room.checked++;room.counts[i]++;
  });
  var results=Array.from(rooms.values()).sort(function(a,b){return wppStatsCompare_(a.room,b.room);});
  var groups={complete:0,partial:0,none:0};
  results.forEach(function(r){r.missing=r.total-r.checked;r.state=r.checked===r.total?'complete':r.checked?'partial':'none';groups[r.state]++;});
  var checked=counts.reduce(function(a,b){return a+b;},0);
  return {filters:f,statuses:statuses,counts:counts,total:people.size,checked:checked,missing:people.size-checked,rooms:results,groups:groups,
    quality:{replacedRows:duplicates,unmatchedStudents:unmatched,unmatchedRooms:Array.from(extraRooms).sort(wppStatsCompare_),invalidStatuses:invalidStatuses,invalidIdentities:invalidIdentities},
    generatedAt:Utilities.formatDate(new Date(),tz,'yyyy-MM-dd HH:mm:ss'),timezone:tz};
}

// ===== ชั้นข้อมูล Firestore: ชื่อฟังก์ชันและผลลัพธ์เหมือน Code.gs เดิม =====
var WPPData = (function () {
  var cfg = window.WPP_CONFIG || {};
  if (!cfg.FIREBASE || !cfg.FIREBASE.apiKey) throw new Error('ยังไม่ได้ใส่ FIREBASE ใน config.js');
  firebase.initializeApp(cfg.FIREBASE);
  var auth = firebase.auth(), db = firebase.firestore(), FV = firebase.firestore.FieldValue;
  var STATUSES = ['มา', 'สาย', 'ขาด', 'ลากิจ', 'ลาป่วย', 'กิจกรรม', 'พักการเรียน'];
  var me = null, rosterCache = null, metaCache = null;

  function setUser(u) { me = u; rosterCache = null; metaCache = null; }
  function emailKey(e) { return String(e || '').trim().toLowerCase(); }
  function sessionId(date, period, room) { return date + '_' + period + '_' + String(room).replace(/[\/\s]+/g, '-'); }
  function log(event, detail) {
    if (!me) return;
    db.collection('logs').add({time: FV.serverTimestamp(), email: me.email, event: event, detail: detail || ''}).catch(function () {});
  }

  // ----- ทะเบียนนักเรียน (เอกสารเดียว) -----
  function roster() {
    if (rosterCache) return Promise.resolve(rosterCache);
    return db.doc('roster/all').get().then(function (s) {
      rosterCache = (s.exists && s.data().students || []).map(function (r) { return {no: wppStatsText_(r.no), name: wppStatsText_(r.name), room: wppStatsText_(r.room)}; });
      return rosterCache;
    });
  }
  function editRoster(change) {
    var ref = db.doc('roster/all');
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (s) {
        var list = (s.exists && s.data().students || []).slice(), result = change(list);
        tx.set(ref, {students: list, updatedAt: FV.serverTimestamp()});
        return result;
      });
    }).then(function (r) { rosterCache = null; return r; });
  }
  function meta() {
    if (metaCache) return Promise.resolve(metaCache);
    return db.doc('settings/meta').get().then(function (s) { metaCache = s.exists ? s.data() : {}; return metaCache; });
  }
  function sessionsToRows(snap) {
    var rows = [];
    snap.forEach(function (d) {
      var s = d.data();
      (s.records || []).forEach(function (r) { rows.push([s.date, s.time || '', s.period || '', s.room, r.no, r.name, r.status, s.term || '']); });
    });
    return rows;
  }

  var api = {
    countViewAndGet: function () {
      var ref = db.doc('settings/views');
      return db.runTransaction(function (tx) {
        return tx.get(ref).then(function (s) { var n = (s.exists && Number(s.data().count) || 0) + 1; tx.set(ref, {count: n}); return n; });
      });
    },
    getLogoBase64: function () { return Promise.reject(new Error('ใช้ไฟล์ logo.png แทน')); },

    getStudentList: function (classroom) {
      var room = wppStatsText_(classroom);
      return roster().then(function (list) {
        return list.filter(function (r) { return r.room === room; }).map(function (r) { return [r.no, r.name, r.room]; });
      });
    },
    saveStudentList: function (data) {
      if (!Array.isArray(data) || !data.length) throw new Error('ไม่มีรายชื่อนักเรียนสำหรับบันทึก');
      var clean = data.map(function (row) {
        var no = wppStatsText_(row.no), name = wppStatsText_(row.name), room = wppStatsText_(row.classroom);
        if (!no || !name || !room) throw new Error('เลขที่ ชื่อ และห้องเรียนต้องไม่ว่าง');
        return {no: no, name: name, room: room};
      });
      return editRoster(function (list) {
        var keys = new Set(list.map(function (r) { return JSON.stringify([wppStatsText_(r.name), wppStatsText_(r.room)]); }));
        var added = 0;
        clean.forEach(function (r) { var k = JSON.stringify([r.name, r.room]); if (!keys.has(k)) { list.push(r); keys.add(k); added++; } });
        return added;
      }).then(function (added) { log('เพิ่มรายชื่อนักเรียน', clean[0].room + ' +' + added); return 'บันทึกรายชื่อใหม่เรียบร้อยแล้ว'; });
    },
    updateStudentInSheet: function (no, newName, classroom, oldName) {
      return editRoster(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (wppStatsText_(list[i].name) === String(oldName) && wppStatsText_(list[i].room) === String(classroom)) {
            list[i] = {no: wppStatsText_(no), name: wppStatsText_(newName), room: wppStatsText_(classroom)};
            return true;
          }
        }
        return false;
      }).then(function (ok) { if (ok) log('แก้ไขรายชื่อนักเรียน', classroom + ' ' + oldName + ' → ' + newName); return ok; });
    },
    deleteStudentFromSheet: function (name, classroom) {
      return editRoster(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (wppStatsText_(list[i].name) === String(name) && wppStatsText_(list[i].room) === String(classroom)) { list.splice(i, 1); return true; }
        }
        return false;
      }).then(function (ok) { if (ok) log('ลบรายชื่อนักเรียน', classroom + ' ' + name); return ok; });
    },

    // บันทึกการเช็คชื่อ 1 ห้อง 1 รอบ = 1 เอกสาร (บันทึกซ้ำรอบเดิม = แทนที่ของเดิม เหมือน "ใช้แถวล่างสุด")
    saveAttendanceAndNotify: function (data) {
      if (!Array.isArray(data) || !data.length) throw new Error('ไม่มีข้อมูลสำหรับเช็คชื่อ');
      data.forEach(function (row) {
        if (!row.date || !row.time || !row.classroom || !row.name || !row.term) throw new Error('กรุณากรอกข้อมูลวันที่ เวลา ห้องเรียน ชื่อ และภาคเรียนให้ครบ');
        if (STATUSES.indexOf(row.status) < 0) throw new Error('สถานะการเช็คชื่อไม่ถูกต้อง');
      });
      var first = data[0], period = getPeriodFromTime(first.time), term = wppStatsTerm_(first.term);
      var doc = {date: first.date, time: first.time, period: period, room: first.classroom, term: term,
        records: data.map(function (r) { return {no: wppStatsText_(r.no), name: wppStatsText_(r.name), status: r.status}; }),
        by: me.email, updatedAt: FV.serverTimestamp()};
      var ref = db.collection('attendance').doc(sessionId(doc.date, period, doc.room));
      return ref.set(doc).then(function () {
        log('เช็คชื่อ', doc.room + ' ' + doc.date + ' ' + period);
        return meta().then(function (m) {
          var upd = {terms: FV.arrayUnion(term), rooms: FV.arrayUnion(doc.room)};
          if (!m.minDate || doc.date < m.minDate) upd.minDate = doc.date;
          if (!m.maxDate || doc.date > m.maxDate) upd.maxDate = doc.date;
          metaCache = null;
          return db.doc('settings/meta').set(upd, {merge: true}).catch(function () {});
        });
      }).then(function () { return notifyTelegram(data); })
        .then(function () { return 'บันทึกการเช็คชื่อและแจ้งเตือนเรียบร้อยแล้ว'; });
    },

    wppStatisticsOptions: function () {
      return Promise.all([roster(), meta()]).then(function (v) {
        var rooms = {}, m = v[1];
        v[0].forEach(function (r) { rooms[r.room] = true; });
        (m.rooms || []).forEach(function (r) { rooms[r] = true; });
        return {rooms: Object.keys(rooms).sort(wppStatsCompare_), terms: (m.terms || []).filter(Boolean).sort().reverse(), minDate: m.minDate || '', maxDate: m.maxDate || ''};
      });
    },
    wppStatisticsReport: function (filters) {
      filters = filters || {};
      var start = wppStatsText_(filters.start), end = wppStatsText_(filters.end);
      if (!wppStatsValidDate_(start) || !wppStatsValidDate_(end) || start > end) throw new Error('กรุณาเลือกวันเริ่มต้นและวันสิ้นสุดให้ถูกต้อง');
      var rooms = Array.isArray(filters.rooms) ? filters.rooms.map(wppStatsText_).filter(Boolean) : [];
      var term = wppStatsTerm_(filters.term), period = wppStatsText_(filters.period);
      if (period && ['เช้า', 'บ่าย', 'เย็น', 'ไม่ระบุเวลา'].indexOf(period) < 0) throw new Error('ช่วงเวลาไม่ถูกต้อง');
      var selected = null;
      if (filters.student) {
        selected = {room: wppStatsText_(filters.student.room), no: wppStatsText_(filters.student.no), name: wppStatsText_(filters.student.name)};
        if (!selected.room || !selected.name || rooms.length !== 1 || rooms[0] !== selected.room) throw new Error('กรุณาเลือกห้องและนักเรียนให้ตรงกัน');
      }
      var q = db.collection('attendance').where('date', '>=', start).where('date', '<=', end);
      return Promise.all([q.get(), roster()]).then(function (v) {
        return wppStatsAggregate_(sessionsToRows(v[0]), v[1], {start: start, end: end, rooms: rooms, term: term, period: period, student: selected}, WPP_TZ);
      });
    },
    wppReportStudents: function (classroom) {
      var room = wppStatsText_(classroom);
      if (!room) throw new Error('กรุณาเลือกห้องเรียน');
      return Promise.all([roster(), db.collection('attendance').where('room', '==', room).get()]).then(function (v) {
        var people = new Map();
        function add(no, name, r) { no = wppStatsText_(no); name = wppStatsText_(name); r = wppStatsText_(r); if (r === room && name) people.set(JSON.stringify([r, no, name]), {room: r, no: no, name: name}); }
        v[0].forEach(function (r) { add(r.no, r.name, r.room); });
        sessionsToRows(v[1]).forEach(function (r) { add(r[4], r[5], r[3]); });
        return Array.from(people.values()).sort(function (a, b) { return wppStatsCompare_(a.no, b.no) || wppStatsCompare_(a.name, b.name); });
      });
    },
    wppDailyDashboard: function (filters) {
      filters = filters || {};
      var date = wppStatsText_(filters.date), period = wppStatsText_(filters.period);
      if (!wppStatsValidDate_(date)) throw new Error('กรุณาเลือกวันที่ให้ถูกต้อง');
      if (['เช้า', 'บ่าย', 'เย็น'].indexOf(period) < 0) throw new Error('กรุณาเลือกรอบเช้า บ่าย หรือเย็น');
      return Promise.all([db.collection('attendance').where('date', '==', date).get(), roster()]).then(function (v) {
        return wppDailyAggregate_(sessionsToRows(v[0]), v[1], {date: date, period: period, room: wppStatsText_(filters.room), term: wppStatsTerm_(filters.term)}, WPP_TZ);
      });
    },

    getCurrentTerm: function () {
      return db.doc('settings/term').get().then(function (s) {
        var t = s.exists ? s.data() : {}, today = wppToday_();
        var current = t.current || '', next = t.next || '', from = t.nextFrom || '';
        return {term: next && from && today >= from ? next : current, current: current, next: next, nextFrom: from, today: today};
      });
    },
    adminSetTerm: function (d) {
      d = d || {};
      var ok = function (t) { return /^[123]\/25\d\d$/.test(String(t || '')); };
      var current = wppStatsText_(d.current), next = wppStatsText_(d.next), from = wppStatsText_(d.nextFrom);
      if (!ok(current)) throw new Error('ภาคเรียนปัจจุบันไม่ถูกต้อง (รูปแบบ 1/2569)');
      if (next || from) {
        if (!ok(next)) throw new Error('ภาคเรียนถัดไปไม่ถูกต้อง (รูปแบบ 2/2569)');
        if (!wppStatsValidDate_(from)) throw new Error('กรุณาระบุวันเปิดภาคเรียนถัดไป');
      }
      return db.doc('settings/term').set({current: current, next: next, nextFrom: next ? from : ''}).then(function () {
        log('ตั้งค่าภาคเรียน', current + (next ? ' → ' + next + ' ตั้งแต่ ' + from : ''));
        return api.getCurrentTerm();
      });
    },

    adminListTeachers: function () {
      return db.collection('teachers').get().then(function (snap) {
        var list = [];
        snap.forEach(function (d) {
          var t = d.data(), last = t.lastLogin && t.lastLogin.toDate ? Utilities.formatDate(t.lastLogin.toDate(), WPP_TZ, 'yyyy-MM-dd HH:mm') : '';
          list.push({email: d.id, name: t.name || '', role: t.role === 'admin' ? 'admin' : 'teacher', active: t.active !== false, lastLogin: last});
        });
        return list.sort(function (a, b) { return (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || a.name.localeCompare(b.name, 'th'); });
      });
    },
    adminSaveTeacher: function (data, originalEmail) {
      data = data || {};
      var email = emailKey(data.email), name = wppStatsText_(data.name), orig = emailKey(originalEmail);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
      if (!name) throw new Error('กรุณากรอกชื่อครู');
      var role = data.role === 'admin' ? 'admin' : 'teacher', active = data.active !== false;
      if (orig && orig === me.email && (role !== 'admin' || !active)) throw new Error('ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
      if (orig && orig === me.email && email !== orig) throw new Error('ไม่สามารถเปลี่ยนอีเมลของบัญชีตนเองได้');
      var ref = db.collection('teachers').doc(email);
      return ref.get().then(function (s) {
        if (s.exists && email !== orig) throw new Error('อีเมลนี้ลงทะเบียนไว้แล้ว');
        var batch = db.batch();
        batch.set(ref, {name: name, role: role, active: active}, {merge: true});
        if (orig && orig !== email) batch.delete(db.collection('teachers').doc(orig));
        return batch.commit();
      }).then(function () { log(orig ? 'แก้ไขครู' : 'เพิ่มครู', email + ' (' + role + ', ' + (active ? 'ใช้งาน' : 'ระงับ') + ')'); return true; });
    },
    adminDeleteTeacher: function (raw) {
      var email = emailKey(raw);
      if (email === me.email) throw new Error('ไม่สามารถลบบัญชีของตนเองได้');
      return db.collection('teachers').doc(email).delete().then(function () { log('ลบครู', email); return true; });
    },
    adminLoginLog: function (limit) {
      var n = Math.min(Math.max(Number(limit) || 100, 1), 500);
      return db.collection('logs').orderBy('time', 'desc').limit(n).get().then(function (snap) {
        var list = [];
        snap.forEach(function (d) {
          var x = d.data();
          list.push({time: x.time && x.time.toDate ? Utilities.formatDate(x.time.toDate(), WPP_TZ, 'yyyy-MM-dd HH:mm:ss') : '', email: x.email || '', event: x.event || '', detail: x.detail || ''});
        });
        return list;
      });
    },
    changeMyPassword: function (oldPassword, newPassword) {
      var u = auth.currentUser;
      if (!u.providerData.some(function (p) { return p.providerId === 'password'; })) throw new Error('บัญชีนี้เข้าด้วย Google จึงไม่มีรหัสผ่านให้เปลี่ยน');
      newPassword = String(newPassword || '');
      if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข');
      var cred = firebase.auth.EmailAuthProvider.credential(u.email, String(oldPassword || ''));
      return u.reauthenticateWithCredential(cred).then(function () { return u.updatePassword(newPassword); })
        .then(function () { log('เปลี่ยนรหัสผ่าน', ''); return true; });
    }
  };

  // ----- Telegram: ส่งผ่าน Apps Script (เก็บ bot token ไว้ฝั่งเซิร์ฟเวอร์) -----
  function notifyTelegram(data) {
    var url = cfg.TELEGRAM_URL;
    if (!url) return Promise.resolve(false);
    var present = 0, late = 0, absent = 0;
    var statuses = data.map(function (r) { if (r.status === 'มา') present++; else if (r.status === 'สาย') late++; else absent++; return {name: r.name, status: r.status}; });
    var summary = {date: data[0].date, time: data[0].time, classroom: data[0].classroom, total: data.length, present: present, late: late, absent: absent, studentStatuses: statuses};
    return auth.currentUser.getIdToken().then(function (idToken) {
      return fetch(url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify({idToken: idToken, summary: summary})});
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      return true;
    }).catch(function (e) {
      throw new Error('บันทึกการเช็คชื่อแล้ว แต่แจ้งเตือน Telegram ไม่สำเร็จ (' + e.message + ') ไม่ต้องบันทึกซ้ำ');
    });
  }

  return {auth: auth, db: db, api: api, setUser: setUser, log: log, emailKey: emailKey, sessionId: sessionId, statuses: STATUSES,
    clearCache: function () { rosterCache = null; metaCache = null; }};
})();

// ===== ระบบเข้าสู่ระบบ (Firebase Authentication) =====
var WPPAuth = (function () {
  var auth = WPPData.auth, db = WPPData.db, $ = function (id) { return document.getElementById(id); };
  var profile = null, readyResolve, ready = new Promise(function (r) { readyResolve = r; });
  var ERR = {'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'auth/wrong-password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'auth/user-not-found': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'auth/invalid-email': 'รูปแบบอีเมลไม่ถูกต้อง', 'auth/too-many-requests': 'ลองผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่', 'auth/email-already-in-use': 'อีเมลนี้มีบัญชีแล้ว ใช้ "ลืมรหัสผ่าน" เพื่อตั้งรหัสใหม่',
    'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัว', 'auth/popup-closed-by-user': 'ปิดหน้าต่าง Google ก่อนเข้าสู่ระบบ', 'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้',
    'auth/requires-recent-login': 'กรุณาออกจากระบบแล้วเข้าใหม่ก่อนทำรายการนี้', 'auth/unauthorized-domain': 'โดเมนเว็บนี้ยังไม่ได้รับอนุญาตใน Firebase (Authorized domains)'};
  function thai(e) { return ERR[e && e.code] || (e && e.message) || String(e); }
  function msg(t, cls) { $('authMsg').textContent = t || ''; $('authMsg').className = cls || ''; }
  function mode(m) { ['authLoginForm', 'authSignupForm', 'authVerifyBox'].forEach(function (id) { $(id).hidden = id !== m; }); }
  function showGate(text, cls) { $('authGate').hidden = false; $('headerUser').hidden = true; msg(text, text ? (cls || 'err') : ''); }

  function enter(u, t) {
    profile = {email: WPPData.emailKey(u.email), name: t.name || u.displayName || u.email, role: t.role === 'admin' ? 'admin' : 'teacher'};
    WPPData.setUser(profile);
    $('authGate').hidden = true; $('headerUser').hidden = false;
    $('headerUserName').textContent = profile.name + (profile.role === 'admin' ? ' · แอดมิน' : '');
    $('navAdmin').hidden = profile.role !== 'admin';
    $('pwButton').hidden = !u.providerData.some(function (p) { return p.providerId === 'password'; });
    readyResolve();
    db.collection('teachers').doc(profile.email).update({lastLogin: firebase.firestore.FieldValue.serverTimestamp()}).catch(function () {});
    try { if (!sessionStorage.getItem('wpp_logged')) { sessionStorage.setItem('wpp_logged', '1'); WPPData.log('เข้าสู่ระบบ', u.providerData[0] ? u.providerData[0].providerId : ''); } } catch (e) {}
    WPPData.api.getCurrentTerm().then(applyTerm).catch(function () {});
  }

  auth.onAuthStateChanged(function (u) {
    if (!u) { if (profile) location.reload(); mode('authLoginForm'); showGate(''); return; }
    if (!u.emailVerified) { mode('authVerifyBox'); $('verifyEmail').textContent = u.email; showGate(''); return; }
    db.collection('teachers').doc(WPPData.emailKey(u.email)).get().then(function (s) {
      if (!s.exists || s.data().active === false) throw {code: 'not-teacher'};
      enter(u, s.data());
    }).catch(function (e) {
      var text = e && e.code === 'not-teacher' || e && e.code === 'permission-denied'
        ? 'อีเมล ' + u.email + ' ยังไม่ได้รับสิทธิ์ใช้งาน หรือถูกระงับ กรุณาติดต่อผู้ดูแลระบบ'
        : 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ: ' + thai(e);
      auth.signOut().then(function () { mode('authLoginForm'); showGate(text); });
    });
  });

  function busy(btn, on) { $(btn).disabled = on; }
  document.addEventListener('DOMContentLoaded', function () {
    $('authLoginForm').addEventListener('submit', function (ev) {
      ev.preventDefault(); busy('authSubmit', true); msg('กำลังตรวจสอบ…');
      auth.signInWithEmailAndPassword($('authEmail').value.trim(), $('authPassword').value)
        .then(function () { $('authPassword').value = ''; msg('กำลังตรวจสิทธิ์…'); })
        .catch(function (e) { msg(thai(e), 'err'); }).finally(function () { busy('authSubmit', false); });
    });
    $('authGoogle').addEventListener('click', function () {
      var p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({prompt: 'select_account'});
      msg('กำลังเปิดหน้าต่าง Google…');
      auth.signInWithPopup(p).catch(function (e) { msg(thai(e), 'err'); });
    });
    $('authForgot').addEventListener('click', function () {
      var email = $('authEmail').value.trim();
      if (!email) return msg('กรอกอีเมลก่อน แล้วกด "ลืมรหัสผ่าน" อีกครั้ง', 'err');
      auth.sendPasswordResetEmail(email).then(function () { msg('ส่งลิงก์ตั้งรหัสผ่านไปที่ ' + email + ' แล้ว (ดูในสแปมด้วย)', 'ok'); })
        .catch(function (e) { msg(thai(e), 'err'); });
    });
    $('authToSignup').addEventListener('click', function () { $('signupEmail').value = $('authEmail').value; mode('authSignupForm'); msg(''); });
    $('authToLogin').addEventListener('click', function () { mode('authLoginForm'); msg(''); });
    $('authSignupForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pw = $('signupPassword').value;
      if (pw !== $('signupPassword2').value) return msg('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'err');
      if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return msg('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข', 'err');
      busy('signupSubmit', true); msg('กำลังสร้างบัญชี…');
      auth.createUserWithEmailAndPassword($('signupEmail').value.trim(), pw)
        .then(function (c) { return c.user.sendEmailVerification(); })
        .then(function () { msg('ส่งลิงก์ยืนยันไปที่อีเมลแล้ว กดลิงก์ในอีเมล แล้วกลับมากด "ยืนยันแล้ว"', 'ok'); })
        .catch(function (e) { msg(thai(e), 'err'); }).finally(function () { busy('signupSubmit', false); });
    });
    $('verifyResend').addEventListener('click', function () {
      auth.currentUser.sendEmailVerification().then(function () { msg('ส่งลิงก์ยืนยันอีกครั้งแล้ว', 'ok'); }).catch(function (e) { msg(thai(e), 'err'); });
    });
    $('verifyDone').addEventListener('click', function () {
      var u = auth.currentUser;
      u.reload().then(function () { return u.getIdToken(true); }).then(function () {
        if (!auth.currentUser.emailVerified) return msg('ยังไม่ได้ยืนยัน กดลิงก์ในอีเมลก่อน', 'err');
        location.reload();
      });
    });
    $('verifyLogout').addEventListener('click', function () { auth.signOut(); });
    $('pwForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pm = function (t, c) { $('pwMsg').textContent = t; $('pwMsg').className = c || ''; };
      if ($('pwNew').value !== $('pwNew2').value) return pm('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน', 'err');
      $('pwSubmit').disabled = true; pm('กำลังบันทึก…');
      Promise.resolve().then(function () { return WPPData.api.changeMyPassword($('pwOld').value, $('pwNew').value); })
        .then(function () { pm('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'ok'); setTimeout(closePw, 1200); })
        .catch(function (e) { pm(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' ? 'รหัสผ่านเดิมไม่ถูกต้อง' : thai(e), 'err'); })
        .finally(function () { $('pwSubmit').disabled = false; });
    });
  });

  function call(fn, args) {
    return ready.then(function () {
      var f = WPPData.api[fn];
      if (!f) throw new Error('ไม่รู้จักคำสั่ง ' + fn);
      if (/^admin/.test(fn) && profile.role !== 'admin') throw new Error('เฉพาะผู้ดูแลระบบเท่านั้น');
      return f.apply(null, args);
    }).catch(function (e) {
      if (e && e.code === 'permission-denied') throw new Error('ไม่มีสิทธิ์ทำรายการนี้ (บัญชีอาจถูกระงับ)');
      throw e;
    });
  }
  function applyTerm(t) {
    window.WPP_TERM = t;
    if (!t || !/^\d\/\d{4}$/.test(t.term || '')) return;
    var p = t.term.split('/'); $('termSelect').value = p[0]; $('yearSelect').value = p[1]; updateTermYear();
    var d = $('dailyTerm'); if (d && d.value !== t.term) { d.value = t.term; if (window.WPPDaily) { WPPDaily.changed(); WPPDaily.load(); } }
    if (window.WPPAdmin) WPPAdmin.showTerm(t);
  }
  function logoFallback(img) { img.onerror = null; img.style.visibility = 'hidden'; }
  function openPw() { ['pwOld', 'pwNew', 'pwNew2'].forEach(function (id) { $(id).value = ''; }); $('pwMsg').textContent = ''; $('pwDialog').hidden = false; $('pwOld').focus(); }
  function closePw() { $('pwDialog').hidden = true; }
  function logout() { try { sessionStorage.removeItem('wpp_logged'); } catch (e) {} auth.signOut(); }
  return {call: call, logout: logout, openPw: openPw, closePw: closePw, logoFallback: logoFallback, applyTerm: applyTerm, user: function () { return profile; }};
})();

// google.script.run เดิม → เรียกชั้นข้อมูล Firebase
(function () {
  function make() {
    var ok = function () {}, fail = function (e) { console.error(e); };
    var p = new Proxy({}, {get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { ok = f; return p; };
      if (name === 'withFailureHandler') return function (f) { fail = f; return p; };
      return function () { var args = Array.prototype.slice.call(arguments); WPPAuth.call(String(name), args).then(function (r) { ok(r); }, function (e) { fail(e); }); };
    }});
    return p;
  }
  window.google = {script: {get run() { return make(); }}};
})();

// ===== ย้ายข้อมูลจาก Google Sheet (ไฟล์ .xlsx) — ใช้ในหน้าผู้ดูแลระบบ =====
var WPPMigrate = (function () {
  var parsed = null, $ = function (id) { return document.getElementById(id); };
  function status(t) { $('migStatus').textContent = t; }
  function sheet(wb, name) { var ws = wb.Sheets[name]; return ws ? XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: ''}) : null; }

  // แปลงแถวชีต "เช็คชื่อ" เป็นเอกสารรายห้อง-รายรอบ (คนเดิมในรอบเดียวกันใช้แถวล่างสุด เหมือนรายงานเดิม)
  function groupAttendance(rows) {
    var sessions = new Map(), skipped = 0;
    rows.forEach(function (r) {
      if (r.every(function (v) { return v === '' || v === null; })) return;
      var date = wppStatsDate_(r[0], WPP_TZ), time = wppStatsTime_(r[1], WPP_TZ), room = wppStatsText_(r[3]), name = wppStatsText_(r[5]);
      var status = wppStatsText_(r[6]), period = wppStatsText_(r[2]);
      if (!date || !room || !name || WPPData.statuses.indexOf(status) < 0) { skipped++; return; }
      if (!period) period = time ? getPeriodFromTime(time) : 'ไม่ระบุเวลา';
      var id = WPPData.sessionId(date, period, room);
      if (!sessions.has(id)) sessions.set(id, {date: date, time: '', period: period, room: room, term: '', people: new Map()});
      var s = sessions.get(id), no = wppStatsText_(r[4]);
      s.time = time ? time.slice(0, 5) : s.time; s.term = wppStatsTerm_(r[7]) || s.term;
      s.people.delete(JSON.stringify([no, name]));
      s.people.set(JSON.stringify([no, name]), {no: no, name: name, status: status});
    });
    return {sessions: sessions, skipped: skipped};
  }

  function read(file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') return status('โหลดตัวอ่าน Excel ไม่สำเร็จ กรุณารีเฟรชหน้า');
    status('กำลังอ่านไฟล์…'); $('migRun').disabled = true;
    file.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, {type: 'array'});
      var students = sheet(wb, 'นักเรียน'), teachers = sheet(wb, 'ครู'), att = sheet(wb, 'เช็คชื่อ'), views = sheet(wb, 'views');
      if (!students || !att) throw new Error('ไม่พบชีต "นักเรียน" หรือ "เช็คชื่อ" ในไฟล์ (ต้องดาวน์โหลดทั้งไฟล์เป็น .xlsx)');
      var roster = students.slice(1).map(function (r) { return {no: wppStatsText_(r[0]), name: wppStatsText_(r[1]), room: wppStatsText_(r[2])}; }).filter(function (r) { return r.name && r.room; });
      var tlist = (teachers || []).slice(1).map(function (r) {
        return {email: WPPData.emailKey(r[0]), name: wppStatsText_(r[1]), role: wppStatsText_(r[2]) === 'admin' ? 'admin' : 'teacher', active: wppStatsText_(r[3]) !== 'ระงับ'};
      }).filter(function (t) { return /@/.test(t.email); });
      var g = groupAttendance(att.slice(1));
      var count = views && views[0] ? Number(views[0][1]) || 0 : 0;
      parsed = {roster: roster, teachers: tlist, sessions: g.sessions, views: count};
      var records = 0; g.sessions.forEach(function (s) { records += s.people.size; });
      status('พบ: นักเรียน ' + roster.length + ' คน · ครู ' + tlist.length + ' คน · การเช็คชื่อ ' + g.sessions.size + ' รอบ (' + records + ' รายการ)' +
        (g.skipped ? ' · ข้ามแถวที่ไม่สมบูรณ์ ' + g.skipped + ' แถว' : '') + ' · ยอดเข้าชม ' + count + ' · กด "เริ่มย้ายข้อมูล" เพื่อยืนยัน');
      $('migRun').disabled = false;
    }).catch(function (e) { parsed = null; status('อ่านไฟล์ไม่สำเร็จ: ' + e.message); });
  }

  function run() {
    if (!parsed) return;
    if (!confirm('ย้ายข้อมูลเข้า Firebase?\n• ทะเบียนนักเรียนใน Firebase จะถูกแทนที่ด้วยข้อมูลจากไฟล์\n• การเช็คชื่อรอบเดียวกันจะถูกเขียนทับ (กดซ้ำได้ ไม่เกิดข้อมูลซ้ำ)\n• รายชื่อครูจะถูกเพิ่ม/อัปเดต (ไม่ลบคนที่มีอยู่)')) return;
    var db = WPPData.db, FV = firebase.firestore.FieldValue, p = parsed, me = WPPAuth.user().email;
    $('migRun').disabled = true;
    var ops = [];
    ops.push(function (b) { b.set(db.doc('roster/all'), {students: p.roster, updatedAt: FV.serverTimestamp()}); });
    p.teachers.forEach(function (t) {
      if (t.email === me) return;   // ไม่แตะสิทธิ์ของตัวเอง
      ops.push(function (b) { b.set(db.collection('teachers').doc(t.email), {name: t.name, role: t.role, active: t.active}, {merge: true}); });
    });
    var terms = new Set(), rooms = new Set(), minDate = '', maxDate = '';
    p.sessions.forEach(function (s, id) {
      terms.add(s.term); rooms.add(s.room);
      if (!minDate || s.date < minDate) minDate = s.date; if (s.date > maxDate) maxDate = s.date;
      ops.push(function (b) {
        b.set(db.collection('attendance').doc(id), {date: s.date, time: s.time, period: s.period, room: s.room, term: s.term,
          records: Array.from(s.people.values()), by: 'ย้ายจาก Google Sheet', updatedAt: FV.serverTimestamp()});
      });
    });
    ops.push(function (b) { b.set(db.doc('settings/meta'), {terms: Array.from(terms).filter(Boolean), rooms: Array.from(rooms), minDate: minDate, maxDate: maxDate}, {merge: true}); });
    if (p.views) ops.push(function (b) { b.set(db.doc('settings/views'), {count: p.views}); });
    var done = 0, size = 400;
    (function next(i) {
      if (i >= ops.length) {
        WPPData.clearCache(); WPPData.log('ย้ายข้อมูลจาก Google Sheet', p.sessions.size + ' รอบเช็คชื่อ, ' + p.roster.length + ' นักเรียน');
        status('ย้ายข้อมูลเสร็จแล้ว ✓ ' + ops.length + ' รายการ'); return;
      }
      var b = db.batch(); ops.slice(i, i + size).forEach(function (op) { op(b); });
      b.commit().then(function () { done = Math.min(i + size, ops.length); status('กำลังย้าย… ' + done + ' / ' + ops.length); next(i + size); })
        .catch(function (e) { status('หยุดที่ ' + done + ' / ' + ops.length + ': ' + e.message + ' · กดเริ่มใหม่ได้ ข้อมูลไม่ซ้ำ'); $('migRun').disabled = false; });
    })(0);
  }
  return {read: read, run: run, groupAttendance: groupAttendance};
})();
