/* SMASH ARCH 설정 — 배포 전에 이 파일만 고치면 됩니다 */
window.SMASH_CONFIG = {
  // Apps Script 웹앱 주소 (배포 > 웹 앱 URL, …/exec 로 끝남)
  // 비워두면 저장된 사무소 목록(data/firms.json)으로만 동작하고, 랭킹·모두의 정복 기록은 꺼져요.
  API_URL: 'https://script.google.com/macros/s/AKfycbzqpFTse3TbOwWhhun1pjDCruLIIRxufeMsCB3gXckywAuFcLEKBj8PmvhKbx22veXl/exec',
  // 카카오톡 공유 카드(이미지+‘게임하러 가기’ 버튼)용 JavaScript 키 — developers.kakao.com 에서 발급. 비워두면
  // 휴대폰은 공유 시트(카카오톡 선택), PC는 문구+링크 복사 → 카톡 대화창에 붙여넣기 방식으로 동작해요.
  KAKAO_JS_KEY: ''
};
