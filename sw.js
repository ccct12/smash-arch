/* SMASH ARCH 서비스 워커 (Service Worker)
 * - 게임 파일(index.html · game.js · config.js): 항상 인터넷에서 먼저 받고, 안 될 때만 저장본 사용
 *   → 새로 올린 파일이 옛 저장본에 가려지는 일이 없음
 * - 지도 타일(tiles/…): 저장본을 바로 쓰고 뒤에서 새로 받아 갱신 → 두 번째 방문부터 지도가 빨리 뜸
 * - 다른 사이트(Apps Script 서버 · 글꼴 · 허브)는 건드리지 않음
 * 저장본을 전부 비우고 싶으면 아래 CACHE 이름의 숫자만 바꿔서 올리면 됩니다.
 */
const CACHE = 'smasharch-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('smasharch-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;          // 다른 사이트는 그대로 통과

  // 지도 타일: 저장본 먼저, 뒤에서 갱신
  if (url.pathname.indexOf('/tiles/') >= 0 && !/meta\.json$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => put(req, res)).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // 그 밖의 게임 파일: 인터넷 먼저, 실패하면 저장본
  e.respondWith(
    fetch(req).then(res => put(req, res)).catch(() =>
      caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))
        .then(hit => hit || Response.error())
    )
  );
});
