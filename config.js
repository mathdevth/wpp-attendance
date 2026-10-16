// ตั้งค่าหน้าเว็บ
window.WPP_CONFIG = {
  // Firebase project: wpp-attendance
  FIREBASE: {
    apiKey: 'AIzaSyDIpWO175cz6kcnKpM7W_RKsrkc18gA_SY',
    authDomain: 'wpp-attendance.firebaseapp.com',
    projectId: 'wpp-attendance',
    storageBucket: 'wpp-attendance.firebasestorage.app',
    messagingSenderId: '121275926965',
    appId: '1:121275926965:web:3dacd47569486c8d32b1fc'
  },
  // URL Web app ของ Apps Script ตัวส่ง Telegram (telegram.gs) — เว้นว่าง = ยังไม่แจ้งเตือน
  TELEGRAM_URL: 'https://script.google.com/macros/s/AKfycbzOPRWq8Yg9cF_2owUBYZSAbt3bdnxHlCpMeZdQLDF1G2ROOvOn1Hsp1TTjq1q_lm15/exec',
  // ใช้เมื่อแอดมินยังไม่ได้ตั้งภาคเรียน
  TERM1_START_MONTH: 5,
  TERM2_START_MONTH: 11
};
