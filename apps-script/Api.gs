/**
 * SMASH ARCH — 게임 서버 (Google Apps Script 웹앱)
 * 사무소 목록 제공 + 랭킹 + 구별 정복 진행도를 웹앱 하나로 처리합니다.
 * 기존 Ranking.gs 를 대신합니다. (Ranking.gs 가 같은 프로젝트에 있으면 지워주세요. doGet 이 겹칩니다.)
 *
 * [설치] '건축사사무소_좌표작업' 구글 시트에서
 * 1. 확장 프로그램 > Apps Script > 파일 옆 + > 스크립트 > 이름 "Api" > 이 내용 붙여넣기 > 저장
 * 2. 배포 > 새 배포 > 유형: 웹 앱
 *      - 다음 사용자 인증 정보로 실행: 나
 *      - 액세스 권한이 있는 사용자: 모든 사용자
 *    → "웹 앱 URL"(…/exec)을 사이트의 config.js 에 붙여넣기
 * 3. 코드를 고친 뒤에는 배포 > 배포 관리 > 수정(연필) > 버전: 새 버전 으로 다시 배포
 *
 * [시트 탭]
 *   건축사사무소 : 번호|사무소명|시도|시군구|원본주소|검색용주소|위도|경도|상태|검증|메모  (읽기만 함)
 *   랭킹        : 시각|회사키|회사명|닉네임|점수              (자동 생성)
 *   철거        : 회사키|번호|최초 철거 시각|최초 철거자|횟수  (자동 생성, 회사키당 한 줄)
 *
 * [API]
 *   GET  ?action=firms     → { ok, updated, rows:[[사무소명,원본주소,위도,경도,상태코드,키번호,시도,시군구]] }
 *                             상태코드 0 확정 · 1 확인 필요 · 2 좌표 없음 / 키번호 = 번호-1 (회사키 "d"+키번호)
 *   GET  ?action=top       → { firms:[{key,name,total,count}], players:[{nick,firm,score}] }
 *   GET  ?action=progress  → { ok, done:{"서울특별시 송파구":12,…}, total, updated }
 *   POST {nick,firmKey,firmName,score}        (Content-Type: text/plain) → 랭킹 등록 { ok, top }
 *   POST {type:"kill", keys:["d5523",…], nick} (Content-Type: text/plain) → 철거 기록 { ok, added }
 *
 * [공개 범위] 사무소명·주소·좌표·시도·시군구만 내보냅니다. 메모·검증 칸과 시트 자체는 공개되지 않습니다.
 * [주의] 누구나 점수를 보낼 수 있는 구조라 조작을 완벽히 막지는 못합니다. 이상한 기록은 시트에서 행을 지우세요.
 */

var SA = {
  FIRM_SHEET: "건축사사무소",
  RANK_SHEET: "랭킹",
  KILL_SHEET: "철거",
  MAX_SCORE: 2000000000,
  COOLDOWN_S: 20,
  WEEK_DAYS: 7,
  TOP_N: 10,
  FIRMS_TTL_S: 600,      // 사무소 목록 캐시 10분 (시트를 고치면 최대 10분 뒤 반영)
  PROGRESS_TTL_S: 60,
  MAX_KILL_KEYS: 200
};

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "top";
  try {
    if (action === "firms") return saText_(saFirmsJson_());
    if (action === "top") return saJson_(saTop_());
    if (action === "progress") return saJson_(saProgress_());
    return saJson_({ ok: false, error: "unknown action" });
  } catch (err) {
    return saJson_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (d.type === "kill") return saJson_(saRecordKills_(d));
    return saJson_(saRecordScore_(d));
  } catch (err) {
    return saJson_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------------- 사무소 목록 ---------------- */
function saFirmRows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SA.FIRM_SHEET);
  if (!sh) throw new Error("'" + SA.FIRM_SHEET + "' 탭이 없어요");
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 11).getValues();
}

function saStatus_(st, chk, lat) {
  if (lat === "" || lat === null || isNaN(Number(lat))) return 2;
  st = String(st || ""); chk = String(chk || "");
  var s;
  if (st === "성공" || st === "성공(원본주소)" || st === "수동") s = 0;
  else if (st.indexOf("근사") === 0) s = 1;
  else return 2;
  if (/확인|이상|의심/.test(chk)) s = 1;
  return s;
}

function saRound6_(v) { return Math.round(Number(v) * 1e6) / 1e6; }

function saFirmsJson_() {
  var cache = CacheService.getScriptCache();
  var meta = cache.get("firms_n");
  if (meta) {
    var keys = []; for (var i = 0; i < Number(meta); i++) keys.push("firms_" + i);
    var got = cache.getAll(keys), parts = [];
    for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) { parts = null; break; } parts.push(got[keys[j]]); }
    if (parts) return parts.join("");
  }
  var rows = saFirmRows_().filter(function (r) { return String(r[1]).trim() !== ""; }).map(function (r) {
    var s = saStatus_(r[8], r[9], r[6]);
    return [String(r[1]), String(r[4]), s === 2 ? null : saRound6_(r[6]), s === 2 ? null : saRound6_(r[7]), s,
            Number(r[0]) - 1, String(r[2]), String(r[3])];
  });
  var json = JSON.stringify({ ok: true, source: "sheet", updated: new Date().toISOString(), rows: rows });
  // CacheService 는 키 하나에 100KB까지라 잘라서 저장
  var CH = 25000, put = {}, cnt = Math.ceil(json.length / CH);
  for (var k = 0; k < cnt; k++) put["firms_" + k] = json.slice(k * CH, (k + 1) * CH);
  try { cache.putAll(put, SA.FIRMS_TTL_S); cache.put("firms_n", String(cnt), SA.FIRMS_TTL_S); } catch (e) {}
  return json;
}

/* ---------------- 랭킹 (기존 Ranking.gs 와 같은 형식) ---------------- */
function saRecordScore_(d) {
  var nick = saClean_(d.nick, 20) || "익명";
  var firmKey = saClean_(d.firmKey, 40);
  var firmName = saClean_(d.firmName, 60);
  var score = Math.floor(Number(d.score));
  if (!firmKey || !firmName || !isFinite(score) || score < 0 || score > SA.MAX_SCORE) {
    return { ok: false, error: "잘못된 입력" };
  }
  var cache = CacheService.getScriptCache();
  var ck = "c_" + Utilities.base64EncodeWebSafe(Utilities.newBlob(nick + "|" + firmKey).getBytes()).slice(0, 200);
  if (cache.get(ck)) return { ok: false, error: SA.COOLDOWN_S + "초 뒤에 다시 등록해주세요" };
  cache.put(ck, "1", SA.COOLDOWN_S);
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try { saSheet_(SA.RANK_SHEET, ["시각", "회사키", "회사명", "닉네임", "점수"]).appendRow([new Date(), firmKey, firmName, nick, score]); }
  finally { lock.releaseLock(); }
  return { ok: true, top: saTop_() };
}

function saTop_() {
  var sh = saSheet_(SA.RANK_SHEET, ["시각", "회사키", "회사명", "닉네임", "점수"]);
  var n = sh.getLastRow() - 1;
  if (n < 1) return { firms: [], players: [] };
  var rows = sh.getRange(2, 1, n, 5).getValues();
  var since = Date.now() - SA.WEEK_DAYS * 86400000;
  var firms = {}, players = [];
  rows.forEach(function (r) {
    var t = new Date(r[0]).getTime(), sc = Number(r[4]) || 0;
    if (t >= since) {
      var k = String(r[1]);
      if (!firms[k]) firms[k] = { key: k, name: String(r[2]), total: 0, count: 0 };
      firms[k].total += sc; firms[k].count++;
    }
    players.push({ nick: String(r[3]), firm: String(r[2]), score: sc });
  });
  var firmList = Object.keys(firms).map(function (k) { return firms[k]; })
    .sort(function (a, b) { return b.total - a.total; }).slice(0, SA.TOP_N);
  players.sort(function (a, b) { return b.score - a.score; });
  return { firms: firmList, players: players.slice(0, SA.TOP_N) };
}

/* ---------------- 철거 기록 · 정복 진행도 ---------------- */
function saRecordKills_(d) {
  var nick = saClean_(d.nick, 20) || "익명";
  var keys = (Array.isArray(d.keys) ? d.keys : []).map(String).filter(function (k) { return /^d\d{1,6}$/.test(k); });
  var uniq = {}; keys.forEach(function (k) { uniq[k] = 1; });
  keys = Object.keys(uniq).slice(0, SA.MAX_KILL_KEYS);
  if (!keys.length) return { ok: true, added: 0 };
  var firmCount = Math.max(0, SpreadsheetApp.getActive().getSheetByName(SA.FIRM_SHEET).getLastRow() - 1);
  var lock = LockService.getScriptLock();
  lock.waitLock(8000);
  var added = 0;
  try {
    var sh = saSheet_(SA.KILL_SHEET, ["회사키", "번호", "최초 철거 시각", "최초 철거자", "횟수"]);
    var n = sh.getLastRow() - 1;
    var have = {}, counts = n > 0 ? sh.getRange(2, 1, n, 5).getValues() : [];
    counts.forEach(function (r, i) { have[String(r[0])] = i; });
    var now = new Date(), newRows = [];
    keys.forEach(function (k) {
      var no = Number(k.slice(1)) + 1;
      if (no < 1 || no > firmCount + 50) return;
      if (have[k] != null) counts[have[k]][4] = (Number(counts[have[k]][4]) || 0) + 1;
      else { newRows.push([k, no, now, nick, 1]); have[k] = -1; added++; }
    });
    if (n > 0) sh.getRange(2, 5, n, 1).setValues(counts.map(function (r) { return [r[4]]; }));
    if (newRows.length) sh.getRange(sh.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
  } finally { lock.releaseLock(); }
  if (added) CacheService.getScriptCache().remove("progress");
  return { ok: true, added: added };
}

function saProgress_() {
  var cache = CacheService.getScriptCache();
  var c = cache.get("progress");
  if (c) return JSON.parse(c);
  var regionOf = {};
  saFirmRows_().forEach(function (r) {
    if (saStatus_(r[8], r[9], r[6]) === 2) return;   // 좌표 없는 곳은 진행도에서 뺌
    regionOf["d" + (Number(r[0]) - 1)] = String(r[2]) + " " + String(r[3]);
  });
  var sh = saSheet_(SA.KILL_SHEET, ["회사키", "번호", "최초 철거 시각", "최초 철거자", "횟수"]);
  var n = sh.getLastRow() - 1, done = {}, total = 0;
  if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach(function (r) {
    var reg = regionOf[String(r[0])]; if (!reg) return;
    done[reg] = (done[reg] || 0) + 1; total++;
  });
  var out = { ok: true, done: done, total: total, updated: new Date().toISOString() };
  try { cache.put("progress", JSON.stringify(out), SA.PROGRESS_TTL_S); } catch (e) {}
  return out;
}

/* ---------------- 공통 ---------------- */
function saSheet_(name, header) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

/** 입력 정리: 제어문자·꺾쇠 제거, 길이 제한, 시트 수식으로 해석되지 않게 앞에 ' 붙임 */
function saClean_(s, max) {
  var v = String(s == null ? "" : s).replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, max);
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return v;
}

function saJson_(o) { return saText_(JSON.stringify(o)); }
function saText_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }

/** 편집기에서 한 번 실행해 권한 승인 + 동작 확인용 */
function testSmashApi() {
  var f = JSON.parse(saFirmsJson_());
  Logger.log("사무소 " + f.rows.length + "곳, 첫 행: " + JSON.stringify(f.rows[0]));
  Logger.log("진행도: " + JSON.stringify(saProgress_()).slice(0, 300));
}
