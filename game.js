"use strict";

/* =========================================================
   SMASH ARCH — 건축사사무소 사옥 부수기 (비공식 팬 게임)
   - 의존성 없음: WebGL 직접 렌더링 (그림자 맵 포함)
   - 건물/도로/녹지/나무: OpenStreetMap Overpass API (실행 시 브라우저에서 호출)
   - 전국 건축사사무소 목록: 공공데이터포털 '전국건축사사무소표준데이터' (사무소명·주소만 사용)
   ========================================================= */

// ---------- 회사 목록 ----------
// [사무소명, 원본주소, 위도, 경도, 상태]  상태: 0 좌표 확정 · 1 근사(이름검색) · 2 좌표 없음(작업 중/실패)
// 좌표는 구글 시트(Apps Script 웹앱 ?action=firms)에서 실행할 때 불러옴. 실패하면 data/firms.json 스냅샷 사용
const FIRMDATA = Array.isArray(window.FIRMDATA_BOOT)?window.FIRMDATA_BOOT:[];
// [사무소명, 원본주소, 위도, 경도, 상태, 키번호(=시트 번호-1), 시도, 시군구]
// 좌표 이상치: 같은 시군구 중심에서 60km 넘게 떨어진 좌표는 "확인 필요"(1)로 표시
(function flagOutliers(){const g=new Map();for(const r of FIRMDATA){if(r[4]!==0||r[2]==null||!r[7])continue;const k=r[6]+' '+r[7];if(!g.has(k))g.set(k,[[],[]]);const a=g.get(k);a[0].push(r[2]);a[1].push(r[3])}
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1]};const c=new Map([...g].map(([k,v])=>[k,[med(v[0]),med(v[1])]]));
  for(const r of FIRMDATA){if(r[4]!==0||r[2]==null)continue;const m=c.get(r[6]+' '+r[7]);if(!m)continue;const dy=(r[2]-m[0])*110.5,dx=(r[3]-m[1])*111.3*Math.cos(m[0]*Math.PI/180);if(Math.hypot(dx,dy)>60)r[4]=1}})();
const FIRM_GEO_COUNT = FIRMDATA.filter(r=>r[4]===0).length;
// 대형사 목록: 좌표가 없으면 공공데이터에서 같은 주소의 확정 좌표를 가져옴 (시트 작업이 진행될수록 자동 반영)
function presetFromData(f){if(f.lat!=null&&f.dkey)return;const key=(f.addr||'').replace(/\([^)]*\)/g,'').replace(/^서울\s/,'서울특별시 ').trim();
  const row=FIRMDATA.find(r=>r[4]===0&&r[1].replace(/\s+/g,' ').startsWith(key));if(row){if(f.lat==null){f.lat=row[2];f.lng=row[3]}if(!f.dkey)f.dkey='d'+row[5]}}
const FIRMS = [
  {key:'map',dkey:'d5523',name:'(주)엠에이피건축종합건축사사무소', addr:'서울 송파구 송파대로22길 5-23 (MAP DESIGN CAMPUS)', lat:37.4884025081465, lng:127.121785337452},
  {key:'samoo',  name:'삼우종합건축사사무소', addr:'서울 강동구 천호대로 1077 (이스트센트럴타워)', lat:37.53726, lng:127.13144},
  {key:'heerim', name:'희림종합건축사사무소', addr:'서울 강동구 상일로6길 39', q:addrQueries('서울특별시 강동구 상일로6길 39'), approxLast:true},
  {key:'haeahn', name:'해안종합건축사사무소', addr:'서울 강남구 봉은사로 208 (해안빌딩)', lat:37.50736, lng:127.03483},
  {key:'gansam', name:'간삼건축', addr:'서울 중구 동호로20다길 16', q:addrQueries('서울특별시 중구 동호로20다길 16'), approxLast:true},
  {key:'junglim',name:'정림건축', addr:'서울 중구 세종대로12길 12', q:addrQueries('서울특별시 중구 세종대로12길 12'), approxLast:true},
];
// 주소 → 지오코딩 후보 (마지막은 도로 이름까지만 = 근사 위치)
function addrQueries(addr){
  const a1=addr.replace(/\([^)]*\)/g,' ').split(',')[0].replace(/\s+/g,' ').trim();
  const tk=a1.split(' ');
  const out=[a1];
  if(tk.length>2)out.push(tk.slice(1).join(' '));
  let ri=-1;for(let i=tk.length-1;i>=0;i--){if(/(로|길)$/.test(tk[i])||/(로|길)\d*번?길?$/.test(tk[i])){ri=i;break}}
  if(ri>0)out.push(tk.slice(0,ri+1).join(' '));
  return [...new Set(out)];
}

// ---------- 설정 ----------
const FLOOR_Y = -60, BOTTOM_Y = -75;
const GAME_VER='2026.11.04';   // 패치 노트 버전 — 바꾸면 재방문자에게 업데이트 창이 한 번 뜸 (index.html #mPatch 내용도 같이 수정)
const opts = {sound:true, labels:true, debris:true, shadows:true, pins:true, mini:false, shake:false, night:true, patch:true};
try{ const s = JSON.parse(localStorage.getItem('smasharch_opts')||'null'); if(s) Object.assign(opts,s);}catch(e){}
// ---------- 낮·밤 (야근 모드) ----------
//  낮 DAY_SEC초 → 밤 NIGHT_SEC초 반복. 밤에는 불 켜진 건물(층) 점수 ×NIGHT_X, 꺼진 건물 ×NIGHT_OFF
//  불 켜짐은 밤마다 새로 정함 (사옥은 늘 야근 중이라 항상 켜짐). 설정 '낮·밤 바뀜'으로 끌 수 있음
const DAY_SEC=90,NIGHT_SEC=60,NIGHT_LIT=0.45,NIGHT_X=2,NIGHT_OFF=0.25;
let DAY={t:0,night:false,k:0,n:0};
function litHash(a,b){const v=Math.sin(a*12.9898+b*78.233)*43758.5453;return v-Math.floor(v)}
// 불 켜짐은 건물마다 '번호표(1~127)'를 메시에 한 번만 새겨두고, 밤마다 번호표별 켜짐 표(LITB, 128칸 텍스처)만 바꿈
//  → 낮·밤이 바뀔 때 도시 전체 메시를 다시 만들지 않음 (예전엔 바뀔 때마다 0.1초 넘게 멈칫)
const LITB=new Uint8Array(128);LITB[1]=255;
function litBucket(b){return b.hq?1:2+((((b.id|0)%126)+126)%126)}
function bLit(b){return !!b&&LITB[litBucket(b)]>0}
function litSt(b,st){return st>=0?st+10*litBucket(b):st}
function litReroll(){for(let i=2;i<128;i++)LITB[i]=Math.random()<NIGHT_LIT?255:0;LITB[1]=255;if(typeof litTex!=='undefined'){gl.bindTexture(gl.TEXTURE_2D,litTex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,128,1,gl.LUMINANCE,gl.UNSIGNED_BYTE,LITB)}}
function nightK(b){return DAY.night&&MODE==='city'?(bLit(b)?NIGHT_X:NIGHT_OFF):1}
function secLitK(k){return !!SEC&&(k===SEC.ourK||(k>=0&&litHash(k+0.5,DAY.n*1.37+(SEC.b&&SEC.b.id||0)%997)<0.5))}
function secNightK(k){return DAY.night&&MODE==='section'&&SEC?(secLitK(k)?NIGHT_X:NIGHT_OFF):1}
function dayRemesh(){if(SEC)secDirty=true}   // 단면만 다시 그림 (건물 한 채라 가벼움)
function nightStart(){DAY.night=true;DAY.t=0;DAY.n++;litReroll();dayRemesh();
  toast(`🌙 야근 타임 ${NIGHT_SEC}초! 불 켜진 건물 점수 ×${NIGHT_X} · 꺼진 건물 ×${NIGHT_OFF}`,3200);sfx(6,0.4);
  if(BOSS&&BOSS.state==='idle')bossSay(pickL(['오늘 야근이다. 불 끄지 마!','저녁은 컵라면으로 시켜.','퇴근? 도면 다 끝나면.']),3)}
function dayStart(){DAY.night=false;DAY.t=0;dayRemesh();toast('☀ 아침이 밝았어요 — 점수 배율이 원래대로 돌아와요',2200)}
function dayReset(){const was=DAY.night;DAY.t=0;DAY.night=false;DAY.k=0;if(was)dayRemesh()}
function dayUpdate(dt){
  if(opts.night&&CUR){DAY.t+=dt;if(DAY.t>=(DAY.night?NIGHT_SEC:DAY_SEC)){if(DAY.night)dayStart();else nightStart()}}
  else if(DAY.night)dayStart();
  const tg=DAY.night?1:0;DAY.k+=clamp(tg-DAY.k,-dt/2.5,dt/2.5);
  for(let i=0;i<3;i++)FOG[i]=FOG_DAY[i]+(FOG_NIGHT[i]-FOG_DAY[i])*DAY.k;
  const dk=DAY.k>0.5;if(document.body.classList.contains('night')!==dk)document.body.classList.toggle('night',dk)}

// ---------- 유틸 ----------
const $ = s => document.querySelector(s);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function toast(msg,ms=2200){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),ms)}
function fmt(n){return Math.floor(n).toLocaleString('ko-KR')}
const TOUCH=matchMedia('(pointer:coarse)').matches;   // 휴대폰·태블릿(손가락) 여부
function lsGet(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
const CSSCOL={white:[.95,.95,.95],grey:[.6,.6,.6],gray:[.6,.6,.6],silver:[.75,.75,.75],black:[.2,.2,.2],red:[.7,.25,.2],brown:[.5,.35,.25],beige:[.85,.8,.68],yellow:[.9,.82,.45],blue:[.35,.5,.7],green:[.4,.6,.45],orange:[.85,.55,.3],maroon:[.5,.2,.18]};
function parseColor(s){if(!s)return null;s=s.trim().toLowerCase();if(CSSCOL[s])return CSSCOL[s];const m=s.match(/^#?([0-9a-f]{6})$/);if(m){const n=parseInt(m[1],16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]}return null}

// ---------- WebGL ----------
const canvas = $('#gl');
const gl = canvas.getContext('webgl',{antialias:true}) || canvas.getContext('experimental-webgl');
if(!gl){ document.body.innerHTML='<p style="padding:40px;color:#111">이 브라우저는 WebGL을 지원하지 않아요.</p>'; throw new Error('no webgl'); }
const DERIV=!!gl.getExtension('OES_standard_derivatives');
const HIGHP=(()=>{const f=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);return f&&f.precision>0})();
const PREC=HIGHP?'precision highp float;\n':'precision mediump float;\n';

const VS=PREC+`
attribute vec3 aP;attribute vec3 aN;attribute vec3 aC;attribute vec2 aX;
uniform mat4 uVP;uniform mat4 uLVP;uniform vec3 uCam;uniform vec3 uTgt;uniform vec2 uFogR;
varying vec3 vC;varying vec3 vN;varying vec3 vW;varying vec2 vX;varying vec4 vL;varying float vF;varying float vE;
void main(){
  vec4 w=vec4(aP,1.0);gl_Position=uVP*w;
  vW=aP;vN=aN;vC=aC;vX=aX;vL=uLVP*w;
  vE=length(aN)<0.1?1.0:0.0;
  vF=clamp((length(aP.xz-uTgt.xz)-uFogR.x)/uFogR.y,0.0,1.0);
}`;
const FS=(DERIV?'#extension GL_OES_standard_derivatives : enable\n':'')+PREC+`
uniform sampler2D uSh;uniform vec3 uFog;uniform vec3 uSun;uniform vec3 uCam;uniform float uShOn;uniform float uTexel;uniform float uNight;uniform sampler2D uLit;
varying vec3 vC;varying vec3 vN;varying vec3 vW;varying vec2 vX;varying vec4 vL;varying float vF;varying float vE;
float unpack(vec4 c){return dot(c,vec4(1.0,1.0/255.0,1.0/65025.0,1.0/16581375.0));}
float shadowAt(float nd){
  if(uShOn<0.5)return 1.0;
  vec3 p=vL.xyz/vL.w*0.5+0.5;
  if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0)return 1.0;
  float bias=0.0006+0.0016*(1.0-nd);float s=0.0;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
    float d=unpack(texture2D(uSh,p.xy+vec2(float(x),float(y))*uTexel));
    s+=(p.z-bias>d)?0.0:1.0;}
  return s/9.0;
}
void main(){
  if(vE>0.5){gl_FragColor=vec4(mix(vC,uFog,vF),1.0);return;}
  vec3 n=normalize(vN);vec3 c=vC;float glass=0.0;float em=0.0;vec3 ec=vec3(0.0);
  if(vX.x<-2.5){em=uNight;ec=vC;}   // 단면: 불 켜진 층 유리
  else if(vX.x<-1.5){float fh=fract(sin(floor(vW.y/3.4)*91.7+floor(vW.x*0.05)*7.3)*43758.5453);em=uNight*step(0.3,fh);ec=vec3(1.0,0.82,0.48);}   // MAP 사옥 유리: 밤엔 층마다 켜짐
  if(vX.x>=0.0){
    float u=vX.x,st=vX.y,y=vW.y;float bk=floor((st+0.5)/10.0);st-=bk*10.0;float lit=bk>0.5?step(0.5,texture2D(uLit,vec2((bk+0.5)/128.0,0.5)).r):0.0;   // style+10×번호표 → 켜짐 표에서 찾기
    float fy=fract((y-0.4)/3.4);float fx;float win=0.0;float avg=0.3;
    if(st<0.5){fx=fract(u/3.2);win=step(0.2,fx)*step(fx,0.8)*step(0.3,fy)*step(fy,0.8);avg=0.3;}
    else if(st<1.5){fx=fract(u/1.8);win=step(0.40,fy)*step(fy,0.88)*step(0.08,fx);avg=0.44;}
    else if(st<2.5){fx=fract(u/1.7);win=step(0.05,fx)*step(0.05,fy)*(1.0-step(0.94,fy));avg=0.85;}
    else{fx=fract(u/4.6);win=step(0.3,fx)*step(fx,0.7)*step(0.34,fy)*step(fy,0.72);avg=0.15;}
    if(y<3.9&&y>0.3&&st<2.5&&st>-0.5){float g=fract(u/4.2);win=max(win,step(0.06,g)*step(g,0.94)*0.9);}
    #ifdef GL_OES_standard_derivatives
    float fw=max(fwidth(u),fwidth(y));win=mix(win,avg,clamp((fw-0.35)/1.2,0.0,1.0));
    #endif
    float pn=fract(sin(floor(u/1.7)*12.9898+floor(y/3.4)*78.233)*43758.5453);
    vec3 gc=mix(vec3(0.20,0.28,0.37),vec3(0.50,0.61,0.72),clamp(0.25+pn*0.25+clamp(y*0.004,0.0,0.35),0.0,1.0));
    c=mix(c,gc,win);glass=win;
    float on=lit*step(0.22,pn);em=win*on*uNight;ec=vec3(1.0,0.80,0.46)*(0.8+0.4*pn);
  }
  float nd=max(dot(n,uSun),0.0);
  float sh=nd>0.0?shadowAt(nd):0.0;
  float hemi=0.50+0.16*n.y;
  vec3 col=c*(hemi+0.60*nd*sh*(1.0-0.8*uNight));
  if(glass>0.0){vec3 v=normalize(uCam-vW);vec3 r=reflect(-uSun,n);col+=(vec3(0.9,0.92,0.95)*pow(max(dot(r,v),0.0),30.0)*0.55*glass*sh+vec3(0.05,0.07,0.09)*glass*(1.0-abs(n.y)))*(1.0-uNight);}
  col*=mix(vec3(1.0),vec3(0.30,0.34,0.52),uNight);col=mix(col,ec,clamp(em,0.0,1.0));
  gl_FragColor=vec4(mix(col,uFog,vF),1.0);
}`;
const SVS=`precision highp float;attribute vec3 aP;uniform mat4 uLVP;void main(){gl_Position=uLVP*vec4(aP,1.0);}`;
const SFS=PREC+`vec4 pack(float d){vec4 e=fract(d*vec4(1.0,255.0,65025.0,16581375.0));e-=e.yzww*vec4(1.0/255.0,1.0/255.0,1.0/255.0,0.0);return e;}
void main(){gl_FragColor=pack(gl_FragCoord.z);}`;
function sh(t,s){const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o}
function mkProg(v,f){const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,v));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,f));
  gl.bindAttribLocation(p,0,'aP');gl.bindAttribLocation(p,1,'aN');gl.bindAttribLocation(p,2,'aC');gl.bindAttribLocation(p,3,'aX');gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p}
const prog=mkProg(VS,FS), sprog=mkProg(SVS,SFS);
const U={};for(const n of['uVP','uLVP','uCam','uFog','uSun','uSh','uShOn','uTexel','uTgt','uFogR','uNight','uLit'])U[n]=gl.getUniformLocation(prog,n);
const SU={uLVP:gl.getUniformLocation(sprog,'uLVP')};
gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
for(let i=0;i<4;i++)gl.enableVertexAttribArray(i);

// 그림자 맵
const SHSIZE=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE));
const litTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,litTex);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,128,1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,LITB);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
const shTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,shTex);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,SHSIZE,SHSIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
const shFB=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,shFB);
gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,shTex,0);
const shRB=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,shRB);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,SHSIZE,SHSIZE);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,shRB);
const SH_OK=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
gl.bindFramebuffer(gl.FRAMEBUFFER,null);

const STRIDE=11;
class MB{ // x y z | nx ny nz | r g b | u style
  constructor(cap=4096){this.a=new Float32Array(cap*STRIDE);this.n=0;this.buf=gl.createBuffer();}
  reset(){this.n=0}
  grow(k){if((this.n+k)*STRIDE>this.a.length){let c=this.a.length*2;while((this.n+k)*STRIDE>c)c*=2;const b=new Float32Array(c);b.set(this.a.subarray(0,this.n*STRIDE));this.a=b;}}
  v(x,y,z,nx,ny,nz,r,g,b,u=-1,s=0){const a=this.a,i=this.n*STRIDE;a[i]=x;a[i+1]=y;a[i+2]=z;a[i+3]=nx;a[i+4]=ny;a[i+5]=nz;a[i+6]=r;a[i+7]=g;a[i+8]=b;a[i+9]=u;a[i+10]=s;this.n++}
  upload(){gl.bindBuffer(gl.ARRAY_BUFFER,this.buf);gl.bufferData(gl.ARRAY_BUFFER,this.a.subarray(0,this.n*STRIDE),gl.DYNAMIC_DRAW)}
  draw(){if(!this.n)return;gl.bindBuffer(gl.ARRAY_BUFFER,this.buf);const S=STRIDE*4;
    gl.vertexAttribPointer(0,3,gl.FLOAT,false,S,0);gl.vertexAttribPointer(1,3,gl.FLOAT,false,S,12);gl.vertexAttribPointer(2,3,gl.FLOAT,false,S,24);gl.vertexAttribPointer(3,2,gl.FLOAT,false,S,36);
    gl.drawArrays(gl.TRIANGLES,0,this.n)}
}
const mGround=new MB(1<<17), mRoad=new MB(1<<15), mBld=new MB(1<<17), mTree=new MB(1<<16), mRub=new MB(1<<14), mDyn=new MB(1<<14), mGlow=new MB(1<<12);

// ---------- 카메라 ----------
const cam={theta:0.75,phi:0.92,dist:820,tx:0,ty:0,tz:0,shake:0};
let VP=new Float32Array(16), eye=[0,0,0];
const SUN=(()=>{const v=[0.62,0.62,-0.42];const l=Math.hypot(...v);return v.map(x=>x/l)})();
function persp(f,a,n,fa){const t=1/Math.tan(f/2),nf=1/(n-fa);return[t/a,0,0,0,0,t,0,0,0,0,(fa+n)*nf,-1,0,0,2*fa*n*nf,0]}
function ortho(l,r,b,t,n,f){return[2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,-2/(f-n),0,-(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1]}
function lookAt(e,c,u){let z=[e[0]-c[0],e[1]-c[1],e[2]-c[2]];let l=Math.hypot(...z);z=z.map(v=>v/l);let x=[u[1]*z[2]-u[2]*z[1],u[2]*z[0]-u[0]*z[2],u[0]*z[1]-u[1]*z[0]];l=Math.hypot(...x);x=x.map(v=>v/l);const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
 return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]),-(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]),-(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]),1]}
function mul(a,b){const o=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+j]*b[i*4+k];o[i*4+j]=s}return o}
let LVP=mul(ortho(-560,560,-560,560,10,2600),lookAt([SUN[0]*1300,SUN[1]*1300,SUN[2]*1300],[0,0,0],[0,1,0]));
const FOV=0.75;
let camFly=null;
function moveCam(dt){
  if(camFly){camFly.t=Math.min(1,camFly.t+dt/1.6);const e=1-Math.pow(1-camFly.t,3);for(const k of ['dist','phi','theta'])cam[k]=camFly.from[k]+(camFly.to[k]-camFly.from[k])*e;if(camFly.t>=1)camFly=null}
  let fx=0,fz=0;const k=KEYS;if(k.has('w')||k.has('arrowup'))fz+=1;if(k.has('s')||k.has('arrowdown'))fz-=1;if(k.has('d')||k.has('arrowright'))fx+=1;if(k.has('a')||k.has('arrowleft'))fx-=1;
  if(!fx&&!fz)return;camFly=null;CAMGO=null;if(BOOM.ship)BOOM.ship.follow=false;const sp=cam.dist*0.75*(k.has('shift')?2.2:1)*dt,st=Math.sin(cam.theta),ct=Math.cos(cam.theta);
  cam.tx+=(-st*fz+ct*fx)*sp;cam.tz+=(-ct*fz-st*fx)*sp;
}
function updateCam(){
  const sh=opts.shake?cam.shake:0;   // 화면 흔들림은 설정에서 켤 때만 (멀미 방지)
  const sx=sh?(Math.random()-.5)*sh:0, sz=sh?(Math.random()-.5)*sh:0;
  eye=[cam.tx+cam.dist*Math.sin(cam.phi)*Math.sin(cam.theta)+sx, cam.ty+cam.dist*Math.cos(cam.phi), cam.tz+cam.dist*Math.sin(cam.phi)*Math.cos(cam.theta)+sz];
  VP=mul(persp(FOV,canvas.width/canvas.height,2,6000),lookAt(eye,[cam.tx+sx,cam.ty,cam.tz+sz],[0,1,0]));
}
function project(x,y,z){const m=VP;const cx=m[0]*x+m[4]*y+m[8]*z+m[12],cy=m[1]*x+m[5]*y+m[9]*z+m[13],w=m[3]*x+m[7]*y+m[11]*z+m[15];if(w<=0.1)return null;return[(cx/w*0.5+0.5)*innerWidth,(0.5-cy/w*0.5)*innerHeight]}
function rayFrom(mx,my){
  const c=[cam.tx,cam.ty,cam.tz];let f=[c[0]-eye[0],c[1]-eye[1],c[2]-eye[2]];let l=Math.hypot(...f);f=f.map(v=>v/l);
  let r=[-f[2],0,f[0]];l=Math.hypot(...r);r=r.map(v=>v/l);
  const u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]];
  const t=Math.tan(FOV/2),asp=innerWidth/innerHeight,nx=(mx/innerWidth)*2-1,ny=1-(my/innerHeight)*2;
  let d=[f[0]+r[0]*nx*t*asp+u[0]*ny*t,f[1]+r[1]*nx*t*asp+u[1]*ny*t,f[2]+r[2]*nx*t*asp+u[2]*ny*t];l=Math.hypot(...d);
  return{o:eye.slice(),d:d.map(v=>v/l)};
}

// ---------- 열린 맵: 400m 타일(청크) ----------
// 각 타일이 지면 높이맵·도로·건물·나무 메시를 따로 가짐. 카메라가 움직이면 주변 타일을 차례로 불러옴.
const TILE=400, CN=80, CELL=TILE/CN, CV=CN+1;
const LOAD_R=1, CULL_R=1250;
const CHUNKS=new Map();
let groundDirty=false, maxDepth=0;
const ckey=(i,j)=>i+','+j;
const tileOf=v=>Math.floor((v+TILE/2)/TILE);
function getChunk(i,j,create){const k=ckey(i,j);let c=CHUNKS.get(k);
  if(!c&&create){c={i,j,k,ox:i*TILE-TILE/2,oz:j*TILE-TILE/2,state:'none',Hg:null,mg:new MB(1<<12),mr:new MB(1<<10),mb:new MB(1<<12),mt:new MB(1<<10),blds:[],trees:[],roads:[],dG:false,dB:false,dT:false};CHUNKS.set(k,c)}
  return c}
function chunkAt(x,z,create){return getChunk(tileOf(x),tileOf(z),create)}
function groundAt(x,z){
  const c=chunkAt(x,z);if(!c||!c.Hg)return 0;
  const fx=(x-c.ox)/CELL,fz=(z-c.oz)/CELL;let i=clamp(Math.floor(fx),0,CN-1),j=clamp(Math.floor(fz),0,CN-1);const u=fx-i,v=fz-j;const H=c.Hg;
  return H[j*CV+i]*(1-u)*(1-v)+H[j*CV+i+1]*u*(1-v)+H[(j+1)*CV+i]*(1-u)*v+H[(j+1)*CV+i+1]*u*v;
}
function vtxAt(x,z){const c=chunkAt(x,z);if(!c||!c.Hg)return null;const i=clamp(Math.round((x-c.ox)/CELL),0,CN),j=clamp(Math.round((z-c.oz)/CELL),0,CN);return{c,k:j*CV+i}}
function depthAt(x,z){const v=vtxAt(x,z);return v?v.c.H0[v.k]-v.c.Hg[v.k]:0}
function vdAt(x,z){const v=vtxAt(x,z);return v?v.c.VD[v.k]:0}
const LANDCOL={green:[0.36,0.52,0.30],forest:[0.26,0.42,0.24],water:[0.30,0.48,0.62],sand:[0.78,0.72,0.58],park:[0.40,0.56,0.33],pitch:[0.33,0.55,0.32],parking:[0.50,0.50,0.49],plaza:[0.66,0.64,0.60]};
function initChunkGround(c){
  const N=CV*CV;c.Hg=new Float32Array(N);c.H0=new Float32Array(N);c.VD=new Float32Array(N);c.GCOL=new Float32Array(N*3);
  const R=mulberry((c.i*7919+c.j*104729)|0);const noise=new Float32Array(N);for(let k=0;k<N;k++)noise[k]=R();c.noise=noise;
  const paved=new Float32Array(N);
  for(const b of B){const r=Math.sqrt(b.area)/2+12;if(b.cx+r<c.ox||b.cx-r>c.ox+TILE||b.cz+r<c.oz||b.cz-r>c.oz+TILE)continue;
    const i0=Math.max(0,Math.floor((b.cx-r-c.ox)/CELL)),i1=Math.min(CN,Math.ceil((b.cx+r-c.ox)/CELL)),j0=Math.max(0,Math.floor((b.cz-r-c.oz)/CELL)),j1=Math.min(CN,Math.ceil((b.cz+r-c.oz)/CELL));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const d=Math.hypot(c.ox+i*CELL-b.cx,c.oz+j*CELL-b.cz);if(d<r)paved[j*CV+i]=Math.max(paved[j*CV+i],1-d/r*0.5)}}
  for(let j=0;j<=CN;j++)for(let i=0;i<=CN;i++){const k=j*CV+i;
    let n=0,cnt=0;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const ii=i+di,jj=j+dj;if(ii>=0&&jj>=0&&ii<=CN&&jj<=CN){n+=noise[jj*CV+ii];cnt++}}n/=cnt;
    const p=clamp(paved[k],0,1);const g=[0.40+n*0.06,0.47+n*0.10,0.36+n*0.04],a=[0.47+n*0.04,0.47+n*0.04,0.46+n*0.04],pv=[0.66,0.65,0.62];
    const base=n>0.53?g:a;for(let q=0;q<3;q++)c.GCOL[k*3+q]=base[q]*(1-p*0.8)+pv[q]*p*0.8}
  for(const lu of LANDUSE)paintLanduse(c,lu);
  c.dG=true;
}
function paintLanduse(c,lu){if(!c.Hg)return;const [x0,z0,x1,z1]=lu.bb;if(x1<c.ox||x0>c.ox+TILE||z1<c.oz||z0>c.oz+TILE)return;const col=LANDCOL[lu.kind];
  for(let j=Math.max(0,Math.floor((z0-c.oz)/CELL));j<=Math.min(CN,Math.ceil((z1-c.oz)/CELL));j++)
    for(let i=Math.max(0,Math.floor((x0-c.ox)/CELL));i<=Math.min(CN,Math.ceil((x1-c.ox)/CELL));i++){
      if(!pip(c.ox+i*CELL,c.oz+j*CELL,lu.pts))continue;const k=j*CV+i,n=c.noise[k]*0.06;
      c.GCOL[k*3]=col[0]+n;c.GCOL[k*3+1]=col[1]+n*1.4;c.GCOL[k*3+2]=col[2]+n*0.5;
      if(lu.kind==='water'&&c.Hg[k]===c.H0[k]){c.Hg[k]=c.H0[k]=-0.6}}
  c.dG=true}
function groundColor(c,k,out){
  const d=c.H0[k]-c.Hg[k];let r=c.GCOL[k*3],g=c.GCOL[k*3+1],b=c.GCOL[k*3+2];
  if(c.Hg[k]>c.H0[k]+0.15){r=0.72;g=0.63;b=0.48}
  else if(d>0.35){if(c.Hg[k]<=FLOOR_Y+0.5){r=1.0;g=0.5;b=0.12}
    else{const ring=(Math.floor(d/2.2)%2)?1:0;const t=Math.min(d/45,1);r=(0.70-0.05*t)+ring*0.10;g=(0.60+0.08*t)+ring*0.11;b=(0.45+0.25*t)+ring*0.12}}
  out[0]=r;out[1]=g;out[2]=b}
function buildChunkGround(c){
  const m=c.mg;m.reset();if(!c.Hg){m.upload();return}m.grow(CN*CN*6);const H=c.Hg;
  const ca=[0,0,0],cb=[0,0,0],cc=[0,0,0],cd=[0,0,0];
  for(let j=0;j<CN;j++)for(let i=0;i<CN;i++){
    const k00=j*CV+i,k10=k00+1,k01=k00+CV,k11=k01+1;const x0=c.ox+i*CELL,x1=x0+CELL,z0=c.oz+j*CELL,z1=z0+CELL;
    const y00=H[k00],y10=H[k10],y01=H[k01],y11=H[k11];
    groundColor(c,k00,ca);groundColor(c,k10,cb);groundColor(c,k01,cc);groundColor(c,k11,cd);
    let ux=0,uy=y01-y00,uz=CELL,vx=CELL,vy=y10-y00,vz=0;
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;let l=Math.hypot(nx,ny,nz);nx/=l;ny/=l;nz/=l;if(ny<0){nx=-nx;ny=-ny;nz=-nz}
    m.v(x0,y00,z0,nx,ny,nz,ca[0],ca[1],ca[2]);m.v(x0,y01,z1,nx,ny,nz,cc[0],cc[1],cc[2]);m.v(x1,y10,z0,nx,ny,nz,cb[0],cb[1],cb[2]);
    ux=-CELL;uy=y01-y10;uz=CELL;vx=0;vy=y11-y10;vz=CELL;
    nx=uy*vz-uz*vy;ny=uz*vx-ux*vz;nz=ux*vy-uy*vx;l=Math.hypot(nx,ny,nz);nx/=l;ny/=l;nz/=l;if(ny<0){nx=-nx;ny=-ny;nz=-nz}
    m.v(x1,y10,z0,nx,ny,nz,cb[0],cb[1],cb[2]);m.v(x0,y01,z1,nx,ny,nz,cc[0],cc[1],cc[2]);m.v(x1,y11,z1,nx,ny,nz,cd[0],cd[1],cd[2]);
  }
  m.upload();buildChunkRoads(c);
}
// 땅 파기 — 여러 타일에 걸쳐도 동작. 반환: 파낸 부피
function carve(x,z,r,depth,rim=true,vdInc=0){
  let vol=0;const R2=r*1.35;
  for(let ti=tileOf(x-R2);ti<=tileOf(x+R2);ti++)for(let tj=tileOf(z-R2);tj<=tileOf(z+R2);tj++){
    const c=getChunk(ti,tj);if(!c||!c.Hg)continue;const H=c.Hg,H0=c.H0,VD=c.VD;
    const i0=Math.max(0,Math.floor((x-R2-c.ox)/CELL)),i1=Math.min(CN,Math.ceil((x+R2-c.ox)/CELL));
    const j0=Math.max(0,Math.floor((z-R2-c.oz)/CELL)),j1=Math.min(CN,Math.ceil((z+R2-c.oz)/CELL));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const k=j*CV+i,d=Math.hypot(c.ox+i*CELL-x,c.oz+j*CELL-z);
      if(d<r){const prof=1-(d/r)*(d/r);
        if(vdInc){const dd=depth*prof;VD[k]=Math.max(VD[k],H0[k]-H[k])+vdInc*prof;const ny=Math.max(FLOOR_Y,H[k]-dd);vol+=(H[k]-ny)*CELL*CELL;H[k]=ny}
        else{const target=Math.max(FLOOR_Y,H0[k]-depth*prof);if(target<H[k]){vol+=(H[k]-target)*CELL*CELL;H[k]=target}VD[k]=Math.max(VD[k],H0[k]-H[k])}
        if(VD[k]>maxDepth)maxDepth=VD[k];
      }else if(rim&&d<R2&&!vdInc){const t=(d-r)/(R2-r);const up=depth*0.07*Math.sin(t*Math.PI);if(H[k]>=H0[k]-0.1)H[k]=Math.max(H[k],H0[k]+up)}
    }
    c.dG=true;c.dT=true;
  }
  forBuildingsNear(x,z,r+20,b=>{if(b.alive&&groundAt(b.cx,b.cz)<b.base-2.5)killBuilding(b,true)});
  forTreesNear(x,z,r+2,t=>{if(t.alive&&groundAt(t.x,t.z)<-1.2)killTree(t)});
  return vol;
}

// ---------- 도로 (타일별) ----------
let LANDUSE=[];
function addRoad(rd){for(let s=0;s<rd.pts.length-1;s++){const [ax,az]=rd.pts[s],[bx,bz]=rd.pts[s+1];if(Math.hypot(bx-ax,bz-az)<0.01)continue;
  const c=chunkAt((ax+bx)/2,(az+bz)/2,true);c.roads.push({ax,az,bx,bz,w:rd.w,c:rd.c,lift:rd.lift,line:rd.line});c.dG=true}}
function buildChunkRoads(c){
  const m=c.mr;m.reset();c.roads.sort((a,b)=>a.lift-b.lift);
  for(const s of c.roads){const {ax,az,bx,bz}=s,w=s.w/2,col=s.c,lift=s.lift;const len=Math.hypot(bx-ax,bz-az);
    const n=Math.max(1,Math.ceil(len/CELL));const px=-(bz-az)/len*w,pz=(bx-ax)/len*w;
    for(let q=0;q<n;q++){const t0=q/n,t1=(q+1)/n;const x0=ax+(bx-ax)*t0,z0=az+(bz-az)*t0,x1=ax+(bx-ax)*t1,z1=az+(bz-az)*t1;
      if(depthAt((x0+x1)/2,(z0+z1)/2)>0.4)continue;
      const y0=groundAt(x0,z0)+lift,y1=groundAt(x1,z1)+lift;m.grow(12);
      m.v(x0+px,y0,z0+pz,0,1,0,...col);m.v(x0-px,y0,z0-pz,0,1,0,...col);m.v(x1+px,y1,z1+pz,0,1,0,...col);
      m.v(x1+px,y1,z1+pz,0,1,0,...col);m.v(x0-px,y0,z0-pz,0,1,0,...col);m.v(x1-px,y1,z1-pz,0,1,0,...col);
      if(s.line&&q%2===0){const lw=0.18,lx=-(bz-az)/len*lw,lz=(bx-ax)/len*lw,yl=0.03,lc=[0.88,0.82,0.45];
        m.v(x0+lx,y0+yl,z0+lz,0,1,0,...lc);m.v(x0-lx,y0+yl,z0-lz,0,1,0,...lc);m.v(x1+lx,y1+yl,z1+lz,0,1,0,...lc);
        m.v(x1+lx,y1+yl,z1+lz,0,1,0,...lc);m.v(x0-lx,y0+yl,z0-lz,0,1,0,...lc);m.v(x1-lx,y1+yl,z1-lz,0,1,0,...lc)}}}
  m.upload()}

// 아직 안 불러온 타일 자리를 채우는 평평한 바닥 (안개 속으로 사라짐)
function buildBasePlane(){const m=mGround;m.reset();const ti=tileOf(cam.tx),tj=tileOf(cam.tz),col=[0.50,0.51,0.50];
  for(let i=ti-4;i<=ti+4;i++)for(let j=tj-4;j<=tj+4;j++){const c=getChunk(i,j);if(c&&c.Hg)continue;const x0=i*TILE-TILE/2,z0=j*TILE-TILE/2,x1=x0+TILE,z1=z0+TILE;m.grow(6);
    m.v(x0,0,z0,0,1,0,...col);m.v(x0,0,z1,0,1,0,...col);m.v(x1,0,z0,0,1,0,...col);m.v(x1,0,z0,0,1,0,...col);m.v(x0,0,z1,0,1,0,...col);m.v(x1,0,z1,0,1,0,...col)}
  m.upload();basePlaneAt=ti+','+tj}
let basePlaneAt='';

// ---------- 타일 불러오기 (묶음 요청 · 동시 2개 · 브라우저 저장) ----------
const SEEN={b:new Set(),r:new Set(),l:new Set(),t:new Set()};const OSMARCH=new Map();
let TQ=[],tileBusy=0,WORLD={fake:false,gen:0,failed:0};
function resetWorld(){for(const c of CHUNKS.values()){for(const m of [c.mg,c.mr,c.mb,c.mt])try{gl.deleteBuffer(m.buf)}catch(e){}}
  CHUNKS.clear();OSMARCH.clear();SEEN.b.clear();SEEN.r.clear();SEEN.l.clear();SEEN.t.clear();B=[];T=[];LANDUSE=[];BGRID=new Map();TGRID=new Map();TQ=[];maxDepth=0;WORLD={fake:false,gen:WORLD.gen+1,failed:0};basePlaneAt=''}
// IndexedDB 캐시: 한 번 받은 지역은 다음부터 즉시
const IDB=(()=>{let dbp=null;const open=()=>dbp||(dbp=new Promise((res,rej)=>{try{const r=indexedDB.open('smasharch',1);r.onupgradeneeded=()=>r.result.createObjectStore('osm');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}}));
  return{async get(k){try{const db=await open();return await new Promise(res=>{const q=db.transaction('osm').objectStore('osm').get(k);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null)})}catch(e){return null}},
    async set(k,v){try{const db=await open();db.transaction('osm','readwrite').objectStore('osm').put(v,k)}catch(e){}}}})();
// 게임에 쓰는 것만 요청 (보행로·자전거길·기타 토지이용 제외) → 응답이 훨씬 작아짐
function osmQuery(bb){return `[out:json][timeout:40];(way["building"](${bb});way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street|pedestrian)(_link)?$"](${bb});way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|cemetery|reservoir|basin)$"](${bb});way["leisure"~"^(park|garden|pitch|playground|golf_course)$"](${bb});way["natural"~"^(water|wood|scrub|grassland|sand|beach)$"](${bb});node["natural"="tree"](${bb});node["office"="architect"](${bb});way["office"="architect"](${bb});node["name"~"건축사|건축사무소|Architect",i](${bb});way["name"~"건축사|건축사무소"](${bb}););out tags geom qt;`}
// ---------- 미리 만든 지도 타일 (tiles/) — GitHub Actions가 한국 OSM 파일에서 사무소 주변만 잘라 둔 것 ----------
// 셀: 위도 0.004° × 경도 0.005° (약 440m). tiles/meta.json 이 없으면 공개 지도 서버(Overpass)만 사용
const STATIC={meta:null,ready:null,cells:new Map()};
STATIC.ready=(async()=>{try{const c=new AbortController();const t=setTimeout(()=>c.abort(),4000);
  const r=await fetch('tiles/meta.json',{signal:c.signal,cache:'no-cache'});clearTimeout(t);if(!r.ok)return null;const m=await r.json();
  if(!m||!m.cellLat||!m.cellLon)return null;STATIC.meta=m;return m}catch(e){return null}})();
async function gunzipJSON(buf){const u=new Uint8Array(buf);
  if(u[0]===0x1f&&u[1]===0x8b){if(typeof DecompressionStream==='undefined')throw new Error('no gzip');
    const s=new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(s).text())}
  return JSON.parse(new TextDecoder().decode(u))}
// 셀 하나 받기: 있으면 {e:[...]} · 범위 밖이면 null
function staticCell(ci,cj){const k=ci+'/'+cj;let p=STATIC.cells.get(k);if(p)return p;
  p=(async()=>{const r=await fetch(`tiles/${ci}/${cj}.bin`);if(r.status===404)return null;if(!r.ok)throw new Error('HTTP '+r.status);return gunzipJSON(await r.arrayBuffer())})();
  p.catch(()=>STATIC.cells.delete(k));STATIC.cells.set(k,p);if(STATIC.cells.size>400)STATIC.cells.delete(STATIC.cells.keys().next().value);return p}
// 압축 형식 → Overpass 응답과 같은 모양 ({elements:[{type,id,tags,geometry|lat,lon}]})
function expandCell(d,out,seen){const o0=d.o[0],o1=d.o[1];
  for(const [t,id,tags,c] of d.e){const key=t+id;if(seen.has(key))continue;seen.add(key);
    let la=o0,lo=o1;const g=[];for(let i=0;i<c.length;i+=2){la+=c[i];lo+=c[i+1];g.push({lat:la/1e6,lon:lo/1e6})}
    if(t===0)out.push({type:'node',id,tags,lat:g[0].lat,lon:g[0].lon});else out.push({type:'way',id,tags,geometry:g})}}
async function staticArea(la0,ln0,la1,ln1){
  const m=await Promise.race([STATIC.ready,new Promise(r=>setTimeout(()=>r(null),4000))]);if(!m)return null;
  const ci0=Math.floor(la0/m.cellLat),ci1=Math.floor(la1/m.cellLat),cj0=Math.floor(ln0/m.cellLon),cj1=Math.floor(ln1/m.cellLon);
  if((ci1-ci0+1)*(cj1-cj0+1)>64)return null;
  const jobs=[];for(let i=ci0;i<=ci1;i++)for(let j=cj0;j<=cj1;j++)jobs.push(staticCell(i,j));
  const cells=await Promise.all(jobs);if(cells.some(c=>!c))return null;   // 한 칸이라도 범위 밖이면 공개 서버로
  const elements=[],seen=new Set();for(const d of cells)expandCell(d,elements,seen);return{elements,src:'static'}}

// ---------- 지도 범위 받기: 미리 만든 타일 → 브라우저 저장본 → 공개 지도 서버 ----------
let EP_I=0,OVP_BUSY=0,AREA_SRC='';
const AREA_P=new Map();   // 같은 범위 요청은 하나로 합침 (미리 받기와 실제 불러오기가 겹쳐도 한 번만)
function areaBBox(i0,j0,i1,j1,lat0,lng0){const k=Math.cos(lat0*Math.PI/180)*111320;
  const U=(x,z)=>[lat0-z/110540,lng0+x/k];
  const [la0,ln0]=U(i0*TILE-TILE/2-10,j1*TILE+TILE/2+10),[la1,ln1]=U(i1*TILE+TILE/2+10,j0*TILE-TILE/2-10);return[la0,ln0,la1,ln1]}
function fetchArea(i0,j0,i1,j1,opt){return fetchAreaAt(i0,j0,i1,j1,LAT0,LNG0,opt)}
function fetchAreaAt(i0,j0,i1,j1,lat0,lng0,opt){opt=opt||{};
  const bbA=areaBBox(i0,j0,i1,j1,lat0,lng0),bb=bbA.map(v=>v.toFixed(5)).join(',');
  let p=AREA_P.get(bb);
  if(p&&!(opt.full&&p.staticOnly))return p;
  p=(async()=>{
    try{const s=await staticArea(...bbA);if(s)return s}catch(e){}
    const hit=await IDB.get('v3:'+bb);if(hit)return hit;
    if(opt.staticOnly)return null;
    return overpassArea(bb,opt.bg)})();
  p.staticOnly=!!opt.staticOnly;
  p.then(v=>{if(!v)AREA_P.delete(bb)},()=>AREA_P.delete(bb));
  AREA_P.set(bb,p);if(AREA_P.size>24)AREA_P.delete(AREA_P.keys().next().value);
  return p}
async function overpassArea(bb,bg){
  // 배경(주변 타일) 요청은 한 번에 하나, 서버 한 곳에만 — 공개 서버가 요청을 막지 않게
  if(bg){while(OVP_BUSY>=1)await new Promise(r=>setTimeout(r,250))}
  OVP_BUSY++;
  try{const body='data='+encodeURIComponent(osmQuery(bb)),hd={'Content-Type':'application/x-www-form-urlencoded'};
    const one=ep=>fetchT(ep,{method:'POST',body,headers:hd},45000).then(j=>{if(!j||!j.elements)throw new Error('bad');return j});
    let json;
    if(bg){const a=OVERPASS[EP_I++%OVERPASS.length];try{json=await one(a)}catch(e){json=await one(OVERPASS[EP_I++%OVERPASS.length])}}
    else{// 첫 화면: 서버 두 곳에 동시에 보내고 먼저 오는 응답 사용
      const a=OVERPASS[EP_I%OVERPASS.length],b=OVERPASS[(EP_I+1)%OVERPASS.length];EP_I++;
      try{json=await Promise.any([one(a),one(b)])}catch(e){json=await one(OVERPASS[(EP_I+1)%OVERPASS.length])}}
    IDB.set('v3:'+bb,json);json.src='overpass';return json}
  finally{OVP_BUSY--}}
// 회사 목록에서 고르기 전에 미리 받아 두기
let prefT=0;
function prefetchFirm(f,full){if(!f||f.lat==null)return;fetchAreaAt(0,0,0,0,f.lat,f.lng,full?{full:true}:{staticOnly:true}).catch(()=>{})}
/** 여러 타일을 한 번의 요청으로 불러와 세계에 추가. 반환: 추가된 건물 수 */
async function loadTiles(list,opt){
  const cs=list.map(([i,j])=>getChunk(i,j,true)).filter(c=>c.state==='none');if(!cs.length)return 0;
  cs.forEach(c=>c.state='loading');const gen=WORLD.gen;
  const i0=Math.min(...cs.map(c=>c.i)),i1=Math.max(...cs.map(c=>c.i)),j0=Math.min(...cs.map(c=>c.j)),j1=Math.max(...cs.map(c=>c.j));
  let data=null;
  if(!WORLD.fake){try{const j=await fetchArea(i0,j0,i1,j1,opt);AREA_SRC=j&&j.src||AREA_SRC;data=j?parseOSM(j):null}catch(e){data=null}}
  if(gen!==WORLD.gen)return 0;
  if(!data){if(WORLD.fake){data={bs:[],rs:[],lus:[],treeNodes:[]};for(const c of cs){const f=fakeCity((c.i*31+c.j*17+WORLD.gen)|0,c.ox,c.oz);data.bs.push(...f.bs);data.rs.push(...f.rs);data.lus.push(...f.lus)}}
    else{WORLD.failed++;cs.forEach(c=>c.state='none');setTimeout(()=>{},0);return -1}}
  const n0=B.length,t0=T.length;
  for(const a of (data.archPois||[]))if(!OSMARCH.has(a.id))OSMARCH.set(a.id,a);
  for(const b of data.bs){if(SEEN.b.has(b.id)||HIDE_BLD.has(b.id))continue;SEEN.b.add(b.id);b.ck=chunkAt(b.cx,b.cz,true);b.ck.blds.push(b);B.push(b);indexBuilding(b,B.length-1);b.ck.dB=true}
  for(const rd of data.rs){if(rd.id!=null){if(SEEN.r.has(rd.id))continue;SEEN.r.add(rd.id)}addRoad(rd)}
  const newLu=[];for(const lu of data.lus){if(lu.id!=null){if(SEEN.l.has(lu.id))continue;SEEN.l.add(lu.id)}LANDUSE.push(lu);newLu.push(lu)}
  LANDUSE.sort((a,b)=>b.area-a.area);
  for(const lu of newLu)for(const o of CHUNKS.values())if(o.Hg&&!cs.includes(o))paintLanduse(o,lu);
  for(const c of cs){initChunkGround(c);plantTreesTile(c,data,newLu);c.state='ready';
    if(BASE)BASE.chunks.set(c.k,{H:c.Hg.slice(),VD:c.VD.slice()})}
  if(BASE){for(let k=n0;k<B.length;k++){BASE.h[k]=B[k].h;BASE.a[k]=true;BASE.det[k]=null}for(let k=t0;k<T.length;k++)BASE.t[k]=true}
  basePlaneAt='';
  return B.length-n0;
}
function loadTile(i,j){return loadTiles([[i,j]],{full:true})}
function neededTiles(){const r=cam.dist>1300&&!camFly?2:LOAD_R,ti=tileOf(cam.tx),tj=tileOf(cam.tz),out=[];
  for(let d=0;d<=r;d++)for(let i=ti-d;i<=ti+d;i++)for(let j=tj-d;j<=tj+d;j++){if(Math.max(Math.abs(i-ti),Math.abs(j-tj))!==d)continue;const c=getChunk(i,j);if(!c||c.state==='none')out.push([i,j])}
  return out}
let retryAt=0,retryN=0,tileWaitT=0;
function pumpTiles(){
  if(!CUR||MODE!=='city')return;const need=neededTiles();
  // 안내는 1.5초 넘게 기다릴 때만 작게 표시 (미리 만든 타일은 금방 와서 안 보임)
  if(need.length||tileBusy){if(!tileWaitT)tileWaitT=performance.now()}else tileWaitT=0;
  const show=tileWaitT&&performance.now()-tileWaitT>1500;const tb=$('#tileBox');
  tb.style.display=show?'':'none';if(show){const t=`주변 지도 ${need.length+tileBusy*3}칸 받는 중${OVP_BUSY?' · 처음 가는 동네라 조금 걸려요':''}`;if(tb.textContent!==t)tb.textContent=t}
  if(!need.length||tileBusy>=3||performance.now()<retryAt)return;
  // 첫 타일 기준 3×3 블록 안에서 아직 없는 타일을 한 요청으로 묶음 (가까운 타일부터)
  const [a,b]=need[0],bi=Math.floor((a+1)/3)*3-1,bj=Math.floor((b+1)/3)*3-1;
  const grp=need.filter(([i,j])=>i>=bi&&i<=bi+2&&j>=bj&&j<=bj+2).slice(0,9);
  tileBusy++;
  loadTiles(grp,{bg:true}).then(n=>{if(n<0){retryN++;retryAt=performance.now()+Math.min(30000,3000*Math.pow(2,retryN-1));if(!pumpTiles.warned){pumpTiles.warned=1;toast('지도 서버가 바빠요. 잠시 뒤 다시 시도해요',2500)}}
    else{retryN=0;buildNeighborhood();applyLandmarks();if(MODE==='city')makeLabels()}}).finally(()=>{tileBusy--});
}
// 카메라를 따라다니는 그림자 범위
function cityLVP(){const cx=Math.round(cam.tx/40)*40,cz=Math.round(cam.tz/40)*40,R=clamp(cam.dist*0.75,320,900);
  return mul(ortho(-R,R,-R,R,10,3000),lookAt([cx+SUN[0]*1400,SUN[1]*1400,cz+SUN[2]*1400],[cx,0,cz],[0,1,0]))}

// ---------- 건물 ----------
let B=[];let BGRID=new Map(); const BG=30;let bldDirty=true;
function markB(b){if(b&&b.ck)b.ck.dB=true;else bldDirty=true}
function polyArea(p){let a=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];a+=p[i][0]*q[1]-q[0]*p[i][1]}return a/2}
function pinTri(p,a,b,c){const s=(u,v,w)=>(u[0]-w[0])*(v[1]-w[1])-(v[0]-w[0])*(u[1]-w[1]);const d1=s(p,a,b),d2=s(p,b,c),d3=s(p,c,a);return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0))}
function earcut(pts){const n=pts.length;const idx=[...Array(n).keys()];const tris=[];let guard=0;
  while(idx.length>3&&guard++<n*n+10){let found=false;
    for(let i=0;i<idx.length;i++){const a=idx[(i+idx.length-1)%idx.length],b=idx[i],c=idx[(i+1)%idx.length];const A=pts[a],Bp=pts[b],C=pts[c];
      const cr=(Bp[0]-A[0])*(C[1]-A[1])-(Bp[1]-A[1])*(C[0]-A[0]);if(cr<=1e-7)continue;
      let ok=true;for(const k of idx){if(k===a||k===b||k===c)continue;if(pinTri(pts[k],A,Bp,C)){ok=false;break}}
      if(ok){tris.push(a,b,c);idx.splice(i,1);found=true;break}}
    if(!found)break}
  if(idx.length===3)tris.push(idx[0],idx[1],idx[2]);else for(let i=1;i<idx.length-1;i++)tris.push(idx[0],idx[i],idx[i+1]);
  return tris}
function pip(x,z,p){let ins=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const xi=p[i][0],zi=p[i][1],xj=p[j][0],zj=p[j][1];if(((zi>z)!==(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))ins=!ins}return ins}
function cleanRing(pts){if(pts.length>2){const f=pts[0],l=pts[pts.length-1];if(Math.abs(f[0]-l[0])<0.01&&Math.abs(f[1]-l[1])<0.01)pts=pts.slice(0,-1)}
  // 거의 일직선인 점 제거
  const out=[];for(let i=0;i<pts.length;i++){const a=pts[(i+pts.length-1)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];const cr=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(cr)>0.05||pts.length<=4)out.push(b)}
  return out.length>=3?out:pts}
function makeBuilding(id,pts,tags){
  pts=cleanRing(pts);if(pts.length<3)return null;
  let a=polyArea(pts);if(a<0){pts=pts.slice().reverse();a=-a}
  if(a<8)return null;
  let cx=0,cz=0;for(const p of pts){cx+=p[0];cz+=p[1]}cx/=pts.length;cz/=pts.length;
  const R=mulberry(typeof id==='number'?id:String(id).length*7919);
  tags=tags||{};const bt=tags.building||'yes',name=tags.name||'';
  let h=0;
  if(tags.height)h=parseFloat(tags.height);
  if(!h&&tags['building:levels'])h=parseFloat(tags['building:levels'])*3.4+1.2;
  const isHouse=/^(house|detached|garage|garages|shed|hut|kiosk|roof|semidetached_house|bungalow|cabin|farm_auxiliary|greenhouse)$/.test(bt);
  const isApt=/^(apartments|residential|dormitory)$/.test(bt)||/\d+\s*동$/.test(name)||/아파트/.test(name);
  if(!h||!isFinite(h)){
    if(isHouse)h=3.5+R()*4;
    else if(isApt)h=a>500?35+R()*45:12+R()*10;
    else if(a<120)h=7+R()*7;else if(a<600)h=10+R()*20;else if(a<2500)h=14+R()*36;else h=12+R()*28;
  }
  h=clamp(h,3,320);
  // 스타일: 0 창문형, 1 아파트(발코니 띠), 2 커튼월, 3 저층 주택
  let style=isHouse?3:isApt?1:0;
  if(!isHouse&&!isApt&&(/office|commercial|retail/.test(bt)||h>45)&&R()<0.7)style=2;
  if(h<9&&style===0&&R()<0.5)style=3;
  const tint=0.92+R()*0.08;
  const pal0=[[0.88,0.88,0.86],[0.84,0.85,0.86],[0.90,0.87,0.80],[0.78,0.76,0.73],[0.72,0.55,0.45],[0.86,0.83,0.76]];
  const pal1=[[0.93,0.93,0.91],[0.91,0.90,0.86],[0.88,0.89,0.90]];
  const pal2=[[0.62,0.70,0.78],[0.55,0.62,0.68],[0.70,0.74,0.76],[0.50,0.58,0.66]];
  const pal3=[[0.90,0.86,0.78],[0.80,0.70,0.60],[0.92,0.92,0.90],[0.70,0.52,0.42]];
  const pal=[pal0,pal1,pal2,pal3][style];
  let col=parseColor(tags['building:colour'])||pal[Math.floor(R()*pal.length)].map(v=>v*tint);
  const rc=parseColor(tags['roof:colour']);
  let roof=rc||(style===3?[[0.62,0.32,0.26],[0.30,0.42,0.58],[0.40,0.55,0.42],[0.55,0.55,0.55]][Math.floor(R()*4)]:R()<0.55?[0.42+R()*0.06,0.60+R()*0.06,0.52+R()*0.04]:[0.70,0.71,0.70]);
  // 옥상 설비 (큰 건물)
  const units=[];
  if(style!==3&&a>250&&pip(cx,cz,pts)){const n=1+Math.floor(R()*3);const s=Math.sqrt(a);
    for(let k=0;k<n;k++){const w=s*(0.12+R()*0.15),d=s*(0.12+R()*0.15),ox=(R()-.5)*s*0.3,oz=(R()-.5)*s*0.3,hh=1.8+R()*2.5;
      if(pip(cx+ox-w/2,cz+oz-d/2,pts)&&pip(cx+ox+w/2,cz+oz+d/2,pts)&&pip(cx+ox+w/2,cz+oz-d/2,pts)&&pip(cx+ox-w/2,cz+oz+d/2,pts))units.push([ox,oz,w,d,hh])}}
  return{id,pts,tris:earcut(pts),area:a,cx,cz,h,h0:h,base:0,alive:true,col,roof,style,units,name,hq:false};
}
function indexBuilding(b,i){let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const p of b.pts){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1])}b.bb=[x0,z0,x1,z1];
  for(let gx=Math.floor(x0/BG);gx<=Math.floor(x1/BG);gx++)for(let gz=Math.floor(z0/BG);gz<=Math.floor(z1/BG);gz++){const k=gx+','+gz;if(!BGRID.has(k))BGRID.set(k,[]);BGRID.get(k).push(i)}}
function forBuildingsNear(x,z,r,fn){const seen=new Set();for(let gx=Math.floor((x-r)/BG);gx<=Math.floor((x+r)/BG);gx++)for(let gz=Math.floor((z-r)/BG);gz<=Math.floor((z+r)/BG);gz++){const l=BGRID.get(gx+','+gz);if(!l)continue;for(const i of l){if(seen.has(i))continue;seen.add(i);fn(B[i])}}}
function distToBuilding(b,x,z){if(pip(x,z,b.pts))return 0;let best=1e9;const p=b.pts;for(let i=0;i<p.length;i++){const a=p[i],c=p[(i+1)%p.length];const dx=c[0]-a[0],dz=c[1]-a[1];const l2=dx*dx+dz*dz||1;let t=((x-a[0])*dx+(z-a[1])*dz)/l2;t=clamp(t,0,1);best=Math.min(best,Math.hypot(a[0]+dx*t-x,a[1]+dz*t-z))}return best}
function boxMesh(m,x0,y0,z0,x1,y1,z1,c){ // 축 정렬 상자 (창문 없음)
  const ct=[c[0]*1.04,c[1]*1.04,c[2]*1.04];m.grow(36);
  const q=(a,b,cc,d,n,col)=>{m.v(...a,...n,...col);m.v(...b,...n,...col);m.v(...cc,...n,...col);m.v(...a,...n,...col);m.v(...cc,...n,...col);m.v(...d,...n,...col)};
  q([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],[0,1,0],ct);
  q([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1],c);q([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[0,0,-1],c);
  q([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[1,0,0],c);q([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0],c);
}
function buildBuildings(){for(const c of CHUNKS.values())buildChunkBuildings(c)}
function buildChunkBuildings(c){
  const m=c.mb;m.reset();c.dB=false;
  for(const b of c.blds){
    if(!b.alive||b.h<0.5||b.det||b.lifted)continue;
    const intact=b.h>=b.h0-0.3;
    const y0=b.base-1.5,y1=b.base+b.h,p=b.pts,c=b.col,cb=[c[0]*0.80,c[1]*0.80,c[2]*0.82],st=litSt(b,b.style);
    const par=intact&&b.style!==3?0.9:0;
    m.grow(p.length*12+b.tris.length+b.units.length*36);
    let u=0;
    for(let i=0;i<p.length;i++){const a=p[i],q=p[(i+1)%p.length];let nx=q[1]-a[1],nz=-(q[0]-a[0]);const l=Math.hypot(nx,nz)||1;nx/=l;nz/=l;
      const u1=u+l;
      m.v(a[0],y0,a[1],nx,0,nz,...cb,u,st);m.v(q[0],y0,q[1],nx,0,nz,...cb,u1,st);m.v(q[0],y1,q[1],nx,0,nz,...c,u1,st);
      m.v(a[0],y0,a[1],nx,0,nz,...cb,u,st);m.v(q[0],y1,q[1],nx,0,nz,...c,u1,st);m.v(a[0],y1,a[1],nx,0,nz,...c,u,st);
      if(par){const pc=[c[0]*1.02,c[1]*1.02,c[2]*1.02];
        m.v(a[0],y1,a[1],nx,0,nz,...pc);m.v(q[0],y1,q[1],nx,0,nz,...pc);m.v(q[0],y1+par,q[1],nx,0,nz,...pc);
        m.v(a[0],y1,a[1],nx,0,nz,...pc);m.v(q[0],y1+par,q[1],nx,0,nz,...pc);m.v(a[0],y1+par,a[1],nx,0,nz,...pc);}
      u=u1+0.7;
    }
    const r=intact?b.roof:[0.56,0.54,0.51];
    for(let t=0;t<b.tris.length;t+=3){for(let q=0;q<3;q++){const P=p[b.tris[t+q]];m.v(P[0],y1+0.02,P[1],0,1,0,r[0],r[1],r[2])}}
    if(par){ // 파라펫 윗면(테두리)
      const pc=[c[0]*1.06,c[1]*1.06,c[2]*1.06],k=0.94;
      for(let i=0;i<p.length;i++){const a=p[i],q=p[(i+1)%p.length];
        const ai=[b.cx+(a[0]-b.cx)*k,b.cz+(a[1]-b.cz)*k],qi=[b.cx+(q[0]-b.cx)*k,b.cz+(q[1]-b.cz)*k],y=y1+par;
        m.v(a[0],y,a[1],0,1,0,...pc);m.v(q[0],y,q[1],0,1,0,...pc);m.v(qi[0],y,qi[1],0,1,0,...pc);
        m.v(a[0],y,a[1],0,1,0,...pc);m.v(qi[0],y,qi[1],0,1,0,...pc);m.v(ai[0],y,ai[1],0,1,0,...pc);
        let nx=-(q[1]-a[1]),nz=(q[0]-a[0]);const l=Math.hypot(nx,nz)||1;nx/=l;nz/=l;const ic=[c[0]*0.9,c[1]*0.9,c[2]*0.9];
        m.v(ai[0],y1,ai[1],nx,0,nz,...ic);m.v(qi[0],y1,qi[1],nx,0,nz,...ic);m.v(qi[0],y,qi[1],nx,0,nz,...ic);
        m.v(ai[0],y1,ai[1],nx,0,nz,...ic);m.v(qi[0],y,qi[1],nx,0,nz,...ic);m.v(ai[0],y,ai[1],nx,0,nz,...ic);}
      for(const [ox,oz,w,d,hh] of b.units)boxMesh(m,b.cx+ox-w/2,y1,b.cz+oz-d/2,b.cx+ox+w/2,y1+hh,b.cz+oz+d/2,[0.74,0.75,0.75]);
    }
  }
  m.upload();
}

// ---------- 나무 ----------
let T=[], TGRID=new Map(), treeDirty=true;
const ICO=(()=>{const t=(1+Math.sqrt(5))/2;const v=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(p=>{const l=Math.hypot(...p);return p.map(x=>x/l)});
  const f=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const out=[];for(const [a,b,c] of f){const A=v[a],Bv=v[b],C=v[c];const n=[(A[0]+Bv[0]+C[0])/3,(A[1]+Bv[1]+C[1])/3,(A[2]+Bv[2]+C[2])/3];const l=Math.hypot(...n);for(const p of[A,Bv,C])out.push([p,n.map(x=>x/l)])}return out})();
function addTree(x,z,s,R,c){if(c.trees.length>=1500)return;
  let blocked=false;forBuildingsNear(x,z,1,b=>{if(!blocked&&x>=b.bb[0]-1&&x<=b.bb[2]+1&&z>=b.bb[1]-1&&z<=b.bb[3]+1&&pip(x,z,b.pts))blocked=true});if(blocked)return;
  const g=R();const t={x,z,s,alive:true,c:[0.22+g*0.12,0.40+g*0.14,0.20+g*0.06],ck:c};T.push(t);c.trees.push(t);c.dT=true;
  const k=Math.floor(x/BG)+','+Math.floor(z/BG);if(!TGRID.has(k))TGRID.set(k,[]);TGRID.get(k).push(T.length-1)}
function forTreesNear(x,z,r,fn){for(let gx=Math.floor((x-r)/BG);gx<=Math.floor((x+r)/BG);gx++)for(let gz=Math.floor((z-r)/BG);gz<=Math.floor((z+r)/BG);gz++){const l=TGRID.get(gx+','+gz);if(l)for(const i of l)fn(T[i])}}
function killTree(t){if(!t.alive)return;t.alive=false;t.ck.dT=true;addScore(40);
  for(let k=0;k<4;k++)spawn(t.x,groundAt(t.x,t.z)+t.s,t.z,(Math.random()-.5)*10,6+Math.random()*8,(Math.random()-.5)*10,0.8+Math.random(),t.c)}
function buildTrees(){for(const c of CHUNKS.values())buildChunkTrees(c)}
function buildChunkTrees(c){const m=c.mt;m.reset();c.dT=false;m.grow(c.trees.length*(ICO.length*2+36));
  for(const t of c.trees){if(!t.alive)continue;const g=groundAt(t.x,t.z),s=t.s;
    pushShape(m,CUBE,t.x,g+s*0.45,t.z,s*0.12,s*0.9,s*0.12,0,[0.38,0.29,0.21],0,1);
    pushShape(m,ICO,t.x,g+s*1.15,t.z,s*0.62,s*0.7,s*0.62,t.x,t.c,0,1);
    pushShape(m,ICO,t.x+s*0.18,g+s*1.55,t.z-s*0.1,s*0.42,s*0.45,s*0.42,t.z,[t.c[0]*1.1,t.c[1]*1.1,t.c[2]*1.08],0,1)}
  m.upload()}

// ---------- 잔해 파티클 ----------
const MAXD=6000;
// ---- 자동 화질 조절: 프레임이 계속 느리면 그림자 → 해상도 → 잔해 양 순서로 낮추고, 여유가 생기면 다시 올림
const PERF_CAP=[2,1.5,1,0.75];
const PERF={q:TOUCH?1:0,min:TOUCH?1:0,ema:16,hi:0,lo:0,told:false};
function perfTick(ms){if(ms>250||document.hidden)return;PERF.ema=PERF.ema*0.94+ms*0.06;
  if(PERF.ema>32){PERF.lo=0;PERF.hi+=ms;if(PERF.hi>2000&&PERF.q<3){PERF.q++;PERF.hi=0;resize();if(!PERF.told){PERF.told=true;toast('렉이 있어서 화질을 자동으로 낮췄어요',2200)}}}
  else if(PERF.ema<18){PERF.hi=0;PERF.lo+=ms;if(PERF.lo>12000&&PERF.q>PERF.min){PERF.q--;PERF.lo=0;resize()}}
  else{PERF.hi=Math.max(0,PERF.hi-ms);PERF.lo=0}}
const D={x:new Float32Array(MAXD),y:new Float32Array(MAXD),z:new Float32Array(MAXD),vx:new Float32Array(MAXD),vy:new Float32Array(MAXD),vz:new Float32Array(MAXD),s:new Float32Array(MAXD),r:new Float32Array(MAXD),c:new Float32Array(MAXD*3),life:new Float32Array(MAXD),glow:new Uint8Array(MAXD),rest:new Uint8Array(MAXD),used:new Uint8Array(MAXD)};
let dHead=0, rubDirty=false;
function spawn(x,y,z,vx,vy,vz,s,c,life=0,glow=0){
  if(!opts.debris&&!glow&&Math.random()<0.6)return;
  if(PERF.q>=2&&!glow&&Math.random()<(PERF.q===2?0.4:0.65))return;
  const i=dHead;dHead=(dHead+1)%MAXD;if(D.used[i]&&D.rest[i])rubDirty=true;
  D.x[i]=x;D.y[i]=y;D.z[i]=z;D.vx[i]=vx;D.vy[i]=vy;D.vz[i]=vz;D.s[i]=s;D.r[i]=Math.random()*6;D.c[i*3]=c[0];D.c[i*3+1]=c[1];D.c[i*3+2]=c[2];D.life[i]=life;D.glow[i]=glow;D.rest[i]=0;D.used[i]=1;
}
const CUBE=(()=>{const f=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];const out=[];for(const n of f){const [a,b]=n[0]?[[0,1,0],[0,0,1]]:n[1]?[[1,0,0],[0,0,1]]:[[1,0,0],[0,1,0]];const c=(s,t)=>[n[0]*.5+a[0]*s*.5+b[0]*t*.5,n[1]*.5+a[1]*s*.5+b[1]*t*.5,n[2]*.5+a[2]*s*.5+b[2]*t*.5];const q=[c(-1,-1),c(1,-1),c(1,1),c(-1,1)];for(const k of[0,1,2,0,2,3])out.push([q[k],n])}return out})();
const SPHERE=(()=>{const out=[];const la=7,lo=12;const P=(i,j)=>{const t=i/la*Math.PI,p=j/lo*Math.PI*2;return[Math.sin(t)*Math.cos(p),Math.cos(t),Math.sin(t)*Math.sin(p)]};for(let i=0;i<la;i++)for(let j=0;j<lo;j++){const a=P(i,j),b=P(i+1,j),c=P(i+1,j+1),d=P(i,j+1);for(const v of[a,b,c,a,c,d])out.push([v,v])}return out})();
function pushShape(m,shape,x,y,z,sx,sy,sz,rot,c,glow,nk=0.8){
  const cr=Math.cos(rot),sr=Math.sin(rot),k=glow?0:nk;m.grow(shape.length);
  for(const[p,n]of shape){const px=p[0]*sx,py=p[1]*sy,pz=p[2]*sz;
    m.v(x+px*cr-pz*sr,y+py,z+px*sr+pz*cr,(n[0]*cr-n[2]*sr)*k,n[1]*k,(n[0]*sr+n[2]*cr)*k,c[0],c[1],c[2])}
}
function updateDebris(dt){
  const m=mDyn,mg=mGlow;m.reset();mg.reset();
  for(let i=0;i<MAXD;i++){
    if(!D.used[i]||D.rest[i])continue;
    if(D.glow[i]){D.life[i]-=dt;if(D.life[i]<=0){D.used[i]=0;continue}}
    D.vy[i]-=(D.glow[i]===2?-4:D.glow[i]===3?3.5:32)*dt;if(D.glow[i]===3){D.vx[i]+=Math.sin(D.life[i]*7+i)*dt*4;D.vz[i]+=Math.cos(D.life[i]*6+i)*dt*4}
    D.x[i]+=D.vx[i]*dt;D.y[i]+=D.vy[i]*dt;D.z[i]+=D.vz[i]*dt;D.r[i]+=dt*3;
    const g=surfaceAt(D.x[i],D.y[i],D.z[i]);
    if(D.y[i]-D.s[i]*0.5<g){
      if(D.glow[i]){D.used[i]=0;continue}
      if(g<-300){if(D.y[i]<-200)D.used[i]=0;}
      else{D.y[i]=g+D.s[i]*0.35;D.vy[i]*=-0.25;D.vx[i]*=0.5;D.vz[i]*=0.5;
        if(Math.abs(D.vy[i])<2.5&&Math.hypot(D.vx[i],D.vz[i])<2){D.rest[i]=1;rubDirty=true;continue}}
    }
    const c=[D.c[i*3],D.c[i*3+1],D.c[i*3+2]];
    if(D.glow[i]){const f=Math.max(0.2,D.life[i]);pushShape(mg,CUBE,D.x[i],D.y[i],D.z[i],D.s[i]*f,D.s[i]*f,D.s[i]*f,D.r[i],c,1)}
    else pushShape(m,CUBE,D.x[i],D.y[i],D.z[i],D.s[i],D.s[i]*0.7,D.s[i],D.r[i],c,0);
  }
  for(const o of FALL){
    if(o.kind==='ball'){pushShape(m,SPHERE,o.x,o.y,o.z,o.r,o.r,o.r,0,[0.22,0.23,0.25],0);pushShape(m,CUBE,o.x,o.y+o.r+150,o.z,0.6,300,0.6,0,[0.15,0.15,0.15],0);}
    else if(o.kind==='roll'){pushShape(m,CUBE,o.x,o.y,o.z,o.r*0.6,o.r*0.6,o.r*2.6,o.rot,[0.96,0.96,0.94],0);pushShape(m,CUBE,o.x,o.y,o.z,o.r*0.62,o.r*0.62,o.r*0.4,o.rot,[0.2,0.4,0.85],0)}
  }
  if(beam){const g=beam.y;pushShape(mg,CUBE,beam.x,g+200,beam.z,1.6,400,1.6,0,[1,0.1,0.08],1);pushShape(mg,CUBE,beam.x,g+200,beam.z,4,400,4,0,[1,0.45,0.4],1);pushShape(mg,SPHERE,beam.x,g,beam.z,5,5,5,0,[1,0.55,0.15],1)}
  if(shock){const n=110;const t=1-shock.r/shock.max;for(let k=0;k<n;k++){const a=k/n*Math.PI*2;const x=shock.x+Math.cos(a)*shock.r,z=shock.z+Math.sin(a)*shock.r;const g=groundAt(x,z);if(g<-300)continue;pushShape(mg,CUBE,x,g+2,z,4*t+1,3*t+0.5,4*t+1,a,[1,0.93,0.8],1)}}
  drawFxCommon(m,mg);if(MODE==='section')drawSecDyn(m,mg);else drawTools(m,mg);
  m.upload();mg.upload();
  if(rubDirty){rubDirty=false;const r=mRub;r.reset();for(let i=0;i<MAXD;i++){if(!D.used[i]||!D.rest[i])continue;
      const g=surfaceAt(D.x[i],D.y[i],D.z[i]);if(D.y[i]-D.s[i]*0.5>g+1.5||D.y[i]<g-2){D.rest[i]=0;continue}
      pushShape(r,CUBE,D.x[i],D.y[i],D.z[i],D.s[i],D.s[i]*0.7,D.s[i],D.r[i],[D.c[i*3],D.c[i*3+1],D.c[i*3+2]],0)}r.upload()}
}
function wakeRubble(x,z,r){for(let i=0;i<MAXD;i++){if(D.used[i]&&D.rest[i]&&Math.hypot(D.x[i]-x,D.z[i]-z)<r){D.rest[i]=0;D.vy[i]=2;rubDirty=true}}}

// ---------- 점수 & 랭크 ----------
let score=0;
// 한 판 = 회사 하나 불러와서(또는 [전부 복구]부터) 다시 불러올 때까지. 랭킹은 한 판에 닉네임 하나, 기록 한 줄(점수만 갱신)
let GAME_ID='',RANK_LOCK=null;function newGame(){GAME_ID=(Date.now().toString(36)+Math.random().toString(36).slice(2,10)).slice(0,20);RANK_LOCK=null;if(typeof boomReset==='function')boomReset();if(typeof dayReset==='function')dayReset()}
const RANKS=[[0,'F','인턴'],[3000,'E','사원'],[15000,'D','대리'],[50000,'C','과장'],[150000,'B','소장'],[450000,'A','대표 건축사'],[1500000,'S','ANNIHILATOR']];
function addScore(v){v*=comboMult();score+=v;chargeUlt(v)}
// ---- 연속 콤보: 2.5초 안에 계속 부수면 n COMBO, 점수 배율 최대 ×2 (화면 흔들림 대신 글자로만)
let COMBO={n:0,t:0};
function comboMult(){return COMBO.n>=2&&performance.now()-COMBO.t<2500?Math.min(2,1+0.1*(COMBO.n-1)):1}
function comboHit(w){const now=performance.now();if(now-COMBO.t>2500)COMBO.n=0;COMBO.n+=w||1;COMBO.t=now;
  const el=$('#combo');if(!el||COMBO.n<2)return;el.innerHTML=`<b>${COMBO.n} COMBO!</b><small>점수 ×${comboMult().toFixed(1)}</small>`;
  el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop','on');clearTimeout(comboHit._t);comboHit._t=setTimeout(()=>{el.classList.remove('on');COMBO.n=0},2500)}
function updateHUD(){
  $('#scoreV').textContent=fmt(score);
  let k=0;for(let i=0;i<RANKS.length;i++)if(score>=RANKS[i][0])k=i;
  $('#rankLetter').textContent=RANKS[k][1];$('#rankTitle').textContent=RANKS[k][2];
  const nx=RANKS[k+1];$('#rankBar i').style.width=(nx?((score-RANKS[k][0])/(nx[0]-RANKS[k][0])*100):100)+'%';
  $('#depth').textContent=depthText(maxDepth);
  {const n=nbStats();const el=$('#nbBox');if(n.t){el.style.display='';el.textContent=`${districtName()} 지구 · 건축사무소 철거 ${n.d} / ${n.t}`;checkStage(n)}else el.style.display='none'}
  {const el=$('#dayBox');if(el){if(!opts.night||!CUR)el.style.display='none';else{el.style.display='';const left=Math.max(0,Math.ceil((DAY.night?NIGHT_SEC:DAY_SEC)-DAY.t));
    const t=DAY.night?`🌙 야근 타임 ${left}초 · 불 켜진 곳 ×${NIGHT_X} · 꺼진 곳 ×${NIGHT_OFF}`:`☀ 낮 · 야근까지 ${left}초`;if(el.textContent!==t)el.textContent=t;el.classList.toggle('night',DAY.night)}}}
  if(MODE==='section')updateSecPanel();
}
function depthText(m){if(m>=12742000)return '지구 관통! 반대편 도착';if(m>=1000)return '지하 '+fmt(m/1000)+' km';return '지하 '+fmt(m)+' m'}

// ---------- 데미지 ----------
// (호환용) 예전 '높이 깎기' 피해 → 구조 단위 피해로 변환
function damageBuilding(b,amt,x,z,force=1){
  if(!b.alive||amt<=0)return;
  const y=pip(x,z,b.pts)?b.base+b.h-1:b.base+Math.min(b.h*0.5,2+Math.random()*b.h*0.4);
  structDamage(b,x,y,z,4+Math.min(8,amt*0.1),amt/22);
}
function killBuilding(b){
  if(!b.alive||b.lifted)return;freeDet(b);STATS.kills++;stopNote(b);
  addScore((Math.max(b.h,0)*b.area*0.35+b.area*2+(b.hq?50000:0))*nightK(b));
  if(DAY.night&&MODE==='city'){const L=bLit(b);floatText(b.cx,b.base+Math.max(b.h,3)+6,b.cz,L?'🌙 야근 ×2':'소등 ×0.25','cad',1.1)}
  const n=Math.min(opts.debris?60:20,Math.floor(Math.sqrt(b.area)*1.2)+6);
  for(let k=0;k<n;k++){const p=b.pts[Math.floor(Math.random()*b.pts.length)];const t=Math.random();
    spawn(b.cx+(p[0]-b.cx)*t,b.base+Math.random()*Math.max(b.h,3),b.cz+(p[1]-b.cz)*t,(Math.random()-.5)*6,Math.random()*5,(Math.random()-.5)*6,1.5+Math.random()*3,Math.random()<0.5?b.col:[0.52,0.51,0.49])}
  b.alive=false;b.h=0;markB(b);comboHit(2);
  firmsKilled(b);
  if(b.hq)toast(b.hqName+' 사옥 철거 완료! +50,000');
}
function blast(x,z,r,power,force=1){
  if(CLIENT)clientHitAt(x,groundAt(x,z)+3,z,r,power/25);
  forBuildingsNear(x,z,r,b=>{if(!b.alive)return;const d=distToBuilding(b,x,z);if(d<r){
    const inside=pip(x,z,b.pts);const y=inside?b.base+b.h:b.base+2;   // 위에서 떨어지면 지붕부터, 옆이면 아래부터
    structDamage(b,x,y,z,Math.max(3,r*0.55),(power/25)*(1-d/r*0.7))}});
  forTreesNear(x,z,r,t=>{if(t.alive&&Math.hypot(t.x-x,t.z-z)<r*0.9)killTree(t)});
}


// =====================================================================
//  구조 단위 파괴 (동네 모드) — 건물이 처음 맞는 순간 층·기둥·외피 단위로 쪼개짐
//  외피(창호 패널)가 떨어져 나가면 슬래브·기둥이 드러나고, 기둥이 빠진 층은 주저앉으며
//  위층이 내려앉아 아래층을 다시 누르는 연쇄 붕괴가 일어남
// =====================================================================
const DETS=new Set();
const REBAR=[0.55,0.24,0.14], CONC=[0.70,0.69,0.66], CONC_D=[0.52,0.51,0.49], RUBBLE=[0.55,0.52,0.48];
const COL_HP=1.5, SUPPORT_MIN=0.45;
// 사옥 전체를 쓰는 회사의 사옥 = 레이드 보스 (기둥 2배)
function raidMult(b){return b.hq&&CUR&&!CUR.tenant&&parseFloor(CUR.addr)==null?2:1}

function makeDet(b){
  const F=b.customF||clamp(Math.round(b.h0/3.4),1,40),fh=b.h0/F;
  // 외곽 기둥 위치: 각 변을 약 5.5m 간격으로 분할
  let per=b.pts.reduce((a,p,i)=>{const q=b.pts[(i+1)%b.pts.length];return a+Math.hypot(q[0]-p[0],q[1]-p[1])},0);
  const sp=Math.max(5.5,per/56);
  const nodes=[],edgeN=[];
  for(let i=0;i<b.pts.length;i++){const a=b.pts[i],c=b.pts[(i+1)%b.pts.length];const len=Math.hypot(c[0]-a[0],c[1]-a[1]);const n=Math.max(1,Math.round(len/sp));
    let nx=c[1]-a[1],nz=-(c[0]-a[0]);const l=Math.hypot(nx,nz)||1;nx/=l;nz/=l;
    for(let s=0;s<n;s++){nodes.push([a[0]+(c[0]-a[0])*s/n,a[1]+(c[1]-a[1])*s/n]);edgeN.push([nx,nz])}}
  const M=nodes.length;
  const cols=nodes.map(([x,z])=>{const dx=b.cx-x,dz=b.cz-z,l=Math.hypot(dx,dz)||1;return[x+dx/l*0.55,z+dz/l*0.55]});
  // 내부 기둥: 7.5m 격자 (외곽에서 2.5m 이상 안쪽)
  const ic=[];const [x0,z0,x1,z1]=b.bb;
  for(let x=x0+4;x<x1-2;x+=7.5)for(let z=z0+4;z<z1-2;z+=7.5){if(ic.length>=48)break;if(pip(x,z,b.pts)&&distToBuilding2(b,x,z)>2.5)ic.push([x,z])}
  const C=M+ic.length;
  const d={F,fh,M,nodes,edgeN,cols,ic,C,
    panel:new Uint8Array(F*M).fill(1),
    hp:new Float32Array(F*C).fill(COL_HP*raidMult(b)),hp0:COL_HP*raidMult(b),
    fl:new Uint8Array(F).fill(1),
    fy:new Float32Array(F),vy:new Float32Array(F),
    mb:new MB(4096),dirty:true,weak:0,weakT:0,tint:0};
  for(let f=0;f<F;f++)d.fy[f]=f*fh;
  b.det=d;DETS.add(b);markB(b);
  return d;
}
function distToBuilding2(b,x,z){let best=1e9;const p=b.pts;for(let i=0;i<p.length;i++){const a=p[i],c=p[(i+1)%p.length];const dx=c[0]-a[0],dz=c[1]-a[1];const l2=dx*dx+dz*dz||1;let t=((x-a[0])*dx+(z-a[1])*dz)/l2;t=clamp(t,0,1);best=Math.min(best,Math.hypot(a[0]+dx*t-x,a[1]+dz*t-z))}return best}
function ensureDet(b){return b.det||makeDet(b)}
function freeDet(b){if(!b.det)return;try{gl.deleteBuffer(b.det.mb.buf)}catch(e){}b.det=null;DETS.delete(b)}
function colPos(d,j){return j<d.M?d.cols[j]:d.ic[j-d.M]}

// 각 층이 놓일 높이 (무너진 층은 0.6m 잔해층이 됨)
function detTargets(d){const t=new Float32Array(d.F);let y=0;for(let f=0;f<d.F;f++){t[f]=y;y+=d.fl[f]?d.fh:0.6}return t}
function detTop(b){const d=b.det;let top=0;for(let f=d.F-1;f>=0;f--){if(d.fl[f]){top=d.fy[f]+d.fh;break}}return top}

/** 점 (x,y,z) 반경 r 안의 외피 패널과 기둥에 피해. power≈1 이면 기둥 하나가 거의 부러짐 */
function structDamage(b,x,y,z,r,power,opt){
  if(!b.alive||b.lifted||power<=0)return;opt=opt||{};
  if(CLIENT){clientHitAt(x,y,z,r,power);if(CLIENT&&CLIENT.tape&&CLIENT.b===b&&b.det)power=clientTape(b,y,power)}
  const d=ensureDet(b);let changed=false,pan=0,cols=0;
  for(let f=0;f<d.F;f++){if(!d.fl[f])continue;
    const y0=b.base+d.fy[f],y1=y0+d.fh,dy=Math.max(0,y0-y,y-y1);if(dy>r)continue;
    if(opt.floors&&!opt.floors.includes(f))continue;
    // 외피 패널
    for(let j=0;j<d.M;j++){if(!d.panel[f*d.M+j])continue;const a=d.nodes[j],c=d.nodes[(j+1)%d.M];
      const px=(a[0]+c[0])/2,pz=(a[1]+c[1])/2,dist=Math.hypot(px-x,pz-z,dy);
      if(dist<r&&Math.random()<0.55+power*0.5){d.panel[f*d.M+j]=0;pan++;changed=true;
        const bay=Math.hypot(c[0]-a[0],c[1]-a[1]);const blk=clamp(Math.min(bay*0.55,d.fh*0.8),1.4,3.2);
        spawn(px,y0+d.fh*0.5,pz,d.edgeN[j][0]*(2+Math.random()*5)*power,1+Math.random()*3,d.edgeN[j][1]*(2+Math.random()*5)*power,blk,Math.random()<0.5?b.col:[b.col[0]*0.85,b.col[1]*0.85,b.col[2]*0.88]);
        if(opts.debris)spawn(px,y0+Math.random()*d.fh,pz,d.edgeN[j][0]*(3+Math.random()*6),2+Math.random()*4,d.edgeN[j][1]*(3+Math.random()*6),0.5+Math.random()*0.8,[0.55,0.68,0.78])}}
    // 기둥
    for(let j=0;j<d.C;j++){const i=f*d.C+j;if(d.hp[i]<=0)continue;const [cx,cz]=colPos(d,j);const dist=Math.hypot(cx-x,cz-z,dy);
      const rr=j<d.M?r*0.85:r*0.6;   // 내부 기둥은 외피 뒤에 있어 덜 맞음
      if(dist<rr){d.hp[i]-=power*(1-dist/rr*0.6);changed=true;if(d.hp[i]<=0){cols++;
        for(let k=0;k<2;k++)spawn(cx,y0+Math.random()*d.fh,cz,(Math.random()-.5)*5,2+Math.random()*3,(Math.random()-.5)*5,0.6+Math.random()*0.8,CONC_D)}}}
  }
  if(!changed)return;
  addScore((pan*60+cols*400)*nightK(b));clientDamage(b,pan+cols*3);
  if(BOSS&&b===BOSS.b)bossHit(cols?'col':'facade');
  d.dirty=true;detCheck(b);
}
// 외피만 벗겨내는 피해 (충격파 등)
function facadeStrip(b,x,z,strength){
  if(!b.alive)return;const d=ensureDet(b);let n=0;
  for(let f=0;f<d.F;f++){if(!d.fl[f])continue;for(let j=0;j<d.M;j++){if(!d.panel[f*d.M+j])continue;const n2=d.edgeN[j];
    const a=d.nodes[j];const facing=(a[0]-x)*n2[0]+(a[1]-z)*n2[1]<0;   // 폭심 쪽을 향한 면
    if(Math.random()<strength*(facing?0.9:0.25)){d.panel[f*d.M+j]=0;n++;if(Math.random()<0.25)spawn(a[0],b.base+d.fy[f]+d.fh*0.5,a[1],n2[0]*6,3,n2[1]*6,0.8+Math.random(),[0.55,0.68,0.78])}}
    for(let j=0;j<d.C;j++)if(Math.random()<strength*0.35)d.hp[f*d.C+j]-=strength*1.2*Math.random()}
  addScore(n*40*nightK(b));d.dirty=true;detCheck(b);
}
function floorSupport(d,f){let a=0;for(let j=0;j<d.C;j++)if(d.hp[f*d.C+j]>0)a++;return a/d.C}
function detCheck(b){
  const d=b.det;if(!d)return;
  for(let f=0;f<d.F;f++){if(!d.fl[f])continue;if(floorSupport(d,f)<SUPPORT_MIN){
    collapseFloor(b,f);return detCheck(b)}}
  if(!d.fl.some(v=>v)){freeDet(b);killBuilding(b)}
}
function collapseFloor(b,f){
  const d=b.det;d.fl[f]=0;d.dirty=true;
  const y=b.base+d.fy[f];
  // 슬래브 조각 · 기둥 토막 · 철근
  const n=Math.min(opts.debris?16:6,Math.ceil(Math.sqrt(b.area)/3)+3);
  for(let k=0;k<n;k++){const p=b.pts[Math.floor(Math.random()*b.pts.length)],t=Math.random();const x=b.cx+(p[0]-b.cx)*t,z=b.cz+(p[1]-b.cz)*t;
    const r=Math.random();const c=r<0.55?CONC:r<0.75?b.col:r<0.9?[0.55,0.68,0.78]:REBAR;
    spawn(x,y+Math.random()*d.fh,z,(x-b.cx)*0.25+(Math.random()-.5)*5,1+Math.random()*4,(z-b.cz)*0.25+(Math.random()-.5)*5,r<0.55?2.2+Math.random()*2.4:0.8+Math.random()*1.4,c)}
  comboHit(1);addScore((b.area*d.fh*0.35+300)*nightK(b));
  sfx(10+Math.min(30,Math.sqrt(b.area)));cam.shake=Math.max(cam.shake,Math.min(5,Math.sqrt(b.area)/15));
  if(BOSS&&b===BOSS.b)bossHit('floor');
  spillToNeighbors(b,f);
}
// 위에 남은 층이 많을수록 잔해가 멀리 튀어 바로 옆 건물 외벽·기둥을 때림 (지구 단위 연쇄 철거)
let spillDepth=0;
function spillToNeighbors(b,f){
  if(spillDepth>2)return;const d=b.det;let above=0;for(let k=f;k<d.F;k++)if(d.fl[k])above++;
  const reach=3+above*0.7;if(reach<4)return;
  const y=b.base+d.fy[f]+d.fh*0.5;spillDepth++;
  try{forBuildingsNear(b.cx,b.cz,Math.sqrt(b.area)/2+reach+10,o=>{if(o===b||!o.alive)return;
    const P=facadePoint(o,b.cx,b.cz);if(!P)return;const gap=distToBuilding(b,P.x,P.z);if(gap>reach)return;
    const yy=clamp(y,o.base+1,o.base+Math.max(1,o.h-1));
    structDamage(o,P.x,yy,P.z,4.5+above*0.3,0.6+above*0.08*(1-gap/reach));
    if(!o.domino){o.domino=1;if(o.firms)toast(`잔해가 ${o.firms[0].short} 건물까지 덮쳤어요! 도미노 철거`,1800)}})}
  finally{spillDepth--}
}
// 매 프레임: 위층 낙하 · 충돌 · 순살(철근 빠짐) 진행
function updateDet(dt){
  for(const b of DETS){const d=b.det;if(!d||!b.alive)continue;
    const t=detTargets(d);let moving=false;
    for(let f=0;f<d.F;f++){if(!d.fl[f])continue;
      if(d.fy[f]>t[f]+0.01){d.vy[f]-=30*dt;d.fy[f]=Math.max(t[f],d.fy[f]+d.vy[f]*dt);moving=true;
        if(d.fy[f]<=t[f]+0.01){const v=-d.vy[f];d.vy[f]=0;d.fy[f]=t[f];detLand(b,f,v)}}}
    if(d.weak){d.weakT+=dt;if(d.weakT>0.22){d.weakT=0;const alive=[];for(let f=0;f<d.F;f++)if(d.fl[f])alive.push(f);
      if(alive.length){const f=alive[Math.floor(Math.random()*Math.min(alive.length,Math.max(2,alive.length/2)))];for(let j=0;j<d.C;j++)if(Math.random()<0.35)d.hp[f*d.C+j]-=0.3;
        for(let j=0;j<d.M;j++)if(Math.random()<0.04)d.panel[f*d.M+j]=0;d.dirty=true;detCheck(b)}}}
    if(moving){d.dirty=true;b.h=detTop(b);wakeRubble(b.cx,b.cz,Math.sqrt(b.area))}
    if(d.dirty&&b.det){d.dirty=false;b.h=detTop(b);buildDetMesh(b)}
  }
}
function detLand(b,f,v){
  const d=b.det;if(v<4)return;
  // 바로 아래 살아있는 층에 충격
  let g=f-1;while(g>=0&&!d.fl[g])g--;if(g<0)return;
  let mass=0;for(let k=f;k<d.F;k++)if(d.fl[k])mass++;
  const p=Math.min(0.9,0.06*mass+v*0.015);
  for(let j=0;j<d.C;j++)if(Math.random()<p)d.hp[g*d.C+j]-=COL_HP*(0.5+Math.random()*0.6);
  for(let j=0;j<d.M;j++)if(Math.random()<p)d.panel[g*d.M+j]=0;
  const y=b.base+d.fy[f];for(let k=0;k<6;k++)spawn(b.cx+(Math.random()-.5)*Math.sqrt(b.area),y,b.cz+(Math.random()-.5)*Math.sqrt(b.area),(Math.random()-.5)*10,3+Math.random()*4,(Math.random()-.5)*10,1+Math.random()*1.5,[0.75,0.73,0.70],0.6+Math.random()*0.5,1);
  d.dirty=true;detCheck(b);
}

// ---------- 메시 ----------
function quad(m,a,b,c,d,n,col,u0,u1,st){m.v(a[0],a[1],a[2],n[0],n[1],n[2],col[0],col[1],col[2],u0,st);m.v(b[0],b[1],b[2],n[0],n[1],n[2],col[0],col[1],col[2],u1,st);m.v(c[0],c[1],c[2],n[0],n[1],n[2],col[0],col[1],col[2],u1,st);
  m.v(a[0],a[1],a[2],n[0],n[1],n[2],col[0],col[1],col[2],u0,st);m.v(c[0],c[1],c[2],n[0],n[1],n[2],col[0],col[1],col[2],u1,st);m.v(d[0],d[1],d[2],n[0],n[1],n[2],col[0],col[1],col[2],u0,st)}
function prismCol(m,x,z,y0,y1,w,c){const h=w/2;m.grow(24);
  quad(m,[x-h,y0,z+h],[x+h,y0,z+h],[x+h,y1,z+h],[x-h,y1,z+h],[0,0,1],c,-1,-1,0);quad(m,[x-h,y0,z-h],[x+h,y0,z-h],[x+h,y1,z-h],[x-h,y1,z-h],[0,0,-1],c,-1,-1,0);
  quad(m,[x+h,y0,z-h],[x+h,y0,z+h],[x+h,y1,z+h],[x+h,y1,z-h],[1,0,0],c,-1,-1,0);quad(m,[x-h,y0,z-h],[x-h,y0,z+h],[x-h,y1,z+h],[x-h,y1,z-h],[-1,0,0],c,-1,-1,0)}
function rebars(m,x,z,y,R){for(let k=0;k<4;k++){const ox=(k%2?0.18:-0.18)+(R()-.5)*0.1,oz=(k<2?0.18:-0.18)+(R()-.5)*0.1,hh=0.8+R()*1.0;pushShape(m,CUBE,x+ox+(R()-.5)*0.3,y+hh/2,z+oz+(R()-.5)*0.3,0.07,hh,0.07,0,REBAR,0)}}
function buildDetMesh(b){
  if(b.custom==='map'){buildMapMesh(b);return}
  const d=b.det,m=d.mb;m.reset();const st=litSt(b,b.style),c=b.col,base=b.base,R=mulberry(b.id%9973+5);
  const dark=d.weak?[c[0]*0.7,c[1]*0.66,c[2]*0.62]:c;
  let topF=-1;for(let f=d.F-1;f>=0;f--)if(d.fl[f]){topF=f;break}
  const collapsedAbove=topF>=0&&topF<d.F-1;   // 위층이 날아간 상태 → 철근이 삐죽
  const t=detTargets(d);
  for(let f=0;f<d.F;f++){
    if(!d.fl[f]){ // 잔해층
      const y=base+t[f]+0.6;m.grow(b.tris.length);for(let q=0;q<b.tris.length;q+=3)for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],y,P[1],0,1,0,...RUBBLE)}
      continue}
    const y0=base+d.fy[f],y1=y0+d.fh,ys=y1-0.4;
    let intact=true;for(let j=0;j<d.M;j++)if(!d.panel[f*d.M+j]){intact=false;break}
    if(intact)for(let j=0;j<d.C;j++)if(d.hp[f*d.C+j]<d.hp0){intact=false;break}
    // 외피 패널 (창호)
    let u=f===0?0:0;m.grow(d.M*12);
    for(let j=0;j<d.M;j++){const a=d.nodes[j],e=d.nodes[(j+1)%d.M],n=d.edgeN[j];const len=Math.hypot(e[0]-a[0],e[1]-a[1]);
      if(d.panel[f*d.M+j]){const cb=f===0?[dark[0]*0.85,dark[1]*0.85,dark[2]*0.87]:dark;
        quad(m,[a[0],y0,a[1]],[e[0],y0,e[1]],[e[0],ys,e[1]],[a[0],ys,a[1]],[n[0],0,n[1]],cb,u,u+len,st)}
      // 슬래브 테두리(보) — 층마다 가로 띠
      quad(m,[a[0],ys,a[1]],[e[0],ys,e[1]],[e[0],y1,e[1]],[a[0],y1,a[1]],[n[0],0,n[1]],f===topF&&!collapsedAbove?dark:CONC,-1,-1,0);
      u+=len}
    // 슬래브 윗면 / 아랫면
    const top=f===topF&&!collapsedAbove?b.roof:CONC;m.grow(b.tris.length*2);
    for(let q=0;q<b.tris.length;q+=3){for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],y1,P[1],0,1,0,...top)}
      if(!intact)for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],ys,P[1],0,-1,0,...CONC_D)}}
    if(f===0&&!intact)for(let q=0;q<b.tris.length;q+=3)for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],y0+0.05,P[1],0,1,0,...CONC_D)}
    // 기둥 (외피가 다 붙어 있으면 안 보이므로 생략)
    if(!intact){for(let j=0;j<d.C;j++){const hp=d.hp[f*d.C+j],[x,z]=colPos(d,j);
      if(hp>0){const s=1-hp/d.hp0;const cc=[CONC[0]+(0.85-CONC[0])*s,CONC[1]+(0.40-CONC[1])*s,CONC[2]+(0.25-CONC[2])*s];prismCol(m,x,z,y0,ys,0.7,cc)}
      else{prismCol(m,x,z,y0,y0+0.5,0.7,CONC_D);rebars(m,x,z,y0+0.5,R);prismCol(m,x,z,ys-0.4,ys,0.7,CONC_D);}}}
    // 꼭대기층 위로 철근
    if(f===topF&&collapsedAbove){for(let j=0;j<d.C;j+=1)if(d.hp[f*d.C+j]>0){const [x,z]=colPos(d,j);rebars(m,x,z,y1,R)}}
  }
  m.upload();
}
// =====================================================================
//  랜드마크 — MAP 사옥 (문정동 디자인 캠퍼스) 전용 3D 모델
//  치수: 도면(X2~X6 33.9m + 북쪽 매스 + 남쪽 계단, 깊이 14.7m) · 지상 9층
//  외관: 흰 세로 루버, 가운데 유리 커튼월, 9층 테라스 정원, 높은 남쪽 타워(루버 스크린 + 초록 지그재그 계단), MAP GROUP 글자
//  구조(층·기둥·외피)는 일반 건물과 같아서 똑같이 부서짐
// =====================================================================
const LIT_GLASS=[1.0,0.82,0.48],LM_WHITE=[0.95,0.96,0.97],LM_FIN=[0.985,0.985,0.98],LM_GLASS=[0.40,0.54,0.66],LM_GLASS2=[0.52,0.64,0.74],LM_DARK=[0.22,0.28,0.34],LM_GREEN=[0.12,0.78,0.32];
const LM_FH=4.2, LM_F=9;
// OpenStreetMap 에 실제와 다르게 그려진 건물(OSM 웨이 번호) — 지도에서 빼기
//  1067088272: MAP DESIGN CAMPUS 옆에 겹쳐 그려진 두 번째 동 (실제 사옥은 1067088271 한 동)
const HIDE_BLD=new Set([1067088272]);
function isMapFirmKey(k){return k==='map'||k==='d5523'}
function applyLandmark(b){if(!b||b.custom)return;b.custom='map';b.customF=LM_F;b.h0=LM_F*LM_FH;b.h=b.h0;b.col=LM_WHITE.slice();b.col0=b.col;b.roof=[0.86,0.87,0.88];b.lm=null;freeDet(b);ensureDet(b);markB(b)}
function applyLandmarks(){
  if(CUR&&(isMapFirmKey(CUR.key)||isMapFirmKey(CUR.dkey))){const h=B.find(x=>x.hq&&x.alive);if(h)applyLandmark(h)}
  for(const f of NB){if(f.i!=null&&FIRMDATA[f.i]&&FIRMDATA[f.i][5]===5523&&f.b&&f.b.alive)applyLandmark(f.b)}}
// 건물 축: u = 긴 방향(북쪽 끝 s=0 → 남쪽 끝 s=1), v = 짧은 방향
function lmFrame(b){if(b.lm)return b.lm;const ob=obbOf(b),ca=Math.cos(ob.ang),sa=Math.sin(ob.ang);let u0=1e9,u1=-1e9,v0=1e9,v1=-1e9;
  for(const p of b.pts){const u=(p[0]-b.cx)*ca+(p[1]-b.cz)*sa,v=-(p[0]-b.cx)*sa+(p[1]-b.cz)*ca;u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v)}
  const flip=sa<0;   // +u 쪽이 북쪽(-z)이면 뒤집음
  return b.lm={ca,sa,u0,u1,v0,v1,L:Math.max(1,u1-u0),flip}}
function lmUV(b,x,z){const f=lmFrame(b);return[(x-b.cx)*f.ca+(z-b.cz)*f.sa,-(x-b.cx)*f.sa+(z-b.cz)*f.ca]}
function lmS(b,x,z){const f=lmFrame(b),u=lmUV(b,x,z)[0];return f.flip?(f.u1-u)/f.L:(u-f.u0)/f.L}
function lmXZ(b,s,v){const f=lmFrame(b),u=f.flip?f.u1-s*f.L:f.u0+s*f.L;return[b.cx+u*f.ca-v*f.sa,b.cz+u*f.sa+v*f.ca]}
function lmZone(s){return s<0.24?'A':s<0.58?'B':'C'}
function bossSpotOf(b){if(b.custom==='map'){const [x,z]=lmXZ(b,0.12,0);return{x,z}}return{x:b.cx,z:b.cz}}
// 5×7 글자
const PIXFONT={M:['10001','11011','10101','10101','10001','10001','10001'],A:['01110','10001','10001','11111','10001','10001','10001'],P:['11110','10001','10001','11110','10000','10000','10000'],
  G:['01111','10000','10000','10111','10001','10001','01111'],R:['11110','10001','10001','11110','10100','10010','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],U:['10001','10001','10001','10001','10001','10001','01110'],' ':['00000','00000','00000','00000','00000','00000','00000']};
function pixText(m,text,cx,cy,cz,rx,rz,nx,nz,px,col){const n=text.length*6-1,x0=-n*px/2,rot=Math.atan2(-rz,rx);
  for(let i=0;i<text.length;i++){const g=PIXFONT[text[i]]||PIXFONT[' '];for(let r=0;r<7;r++)for(let c=0;c<5;c++){if(g[r][c]!=='1')continue;
    const o=x0+(i*6+c)*px+px/2,y=cy+(3-r)*px;pushShape(m,CUBE,cx+rx*o+nx*px*0.3,y,cz+rz*o+nz*px*0.3,px*0.96,px*0.96,px*0.6,rot,col,0)}}}
// 세로 루버를 선분 a→e 위에 늘어놓기 (n: 바깥 방향)
function fins(m,a,e,n,y0,y1,step,off,dep,w,col){const L=Math.hypot(e[0]-a[0],e[1]-a[1]);if(L<0.3)return;const dx=(e[0]-a[0])/L,dz=(e[1]-a[1])/L,rot=Math.atan2(-dz,dx);
  for(let t=(off%step)+step*0.25;t<L;t+=step){const x=a[0]+dx*t+n[0]*dep/2,z=a[1]+dz*t+n[1]*dep/2;pushShape(m,CUBE,x,(y0+y1)/2,z,w,y1-y0,dep,rot,col,0)}}
function buildMapMesh(b){
  const d=b.det,m=d.mb;m.reset();const base=b.base,R=mulberry(b.id%9973+5);const F=d.F;
  let topF=-1;for(let f=F-1;f>=0;f--)if(d.fl[f]){topF=f;break}
  const t=detTargets(d);const fr=lmFrame(b);
  const off=(p,n,k)=>[p[0]+n[0]*k,p[1]+n[1]*k];
  for(let f=0;f<F;f++){
    if(!d.fl[f]){const y=base+t[f]+0.6;m.grow(b.tris.length);for(let q=0;q<b.tris.length;q+=3)for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],y,P[1],0,1,0,...RUBBLE)}continue}
    const y0=base+d.fy[f],y1=y0+d.fh,ys=y1-0.45,top=f===F-1;
    let intact=true;for(let j=0;j<d.M;j++)if(!d.panel[f*d.M+j]){intact=false;break}
    if(intact)for(let j=0;j<d.C;j++)if(d.hp[f*d.C+j]<d.hp0){intact=false;break}
    m.grow(d.M*40);
    for(let j=0;j<d.M;j++){const a=d.nodes[j],e=d.nodes[(j+1)%d.M],n=d.edgeN[j];const N3=[n[0],0,n[1]];
      // 층마다 흰 슬래브 띠
      quad(m,[a[0],ys,a[1]],[e[0],ys,e[1]],[e[0],y1,e[1]],[a[0],y1,a[1]],N3,LM_WHITE,-1,-1,0);
      if(!d.panel[f*d.M+j])continue;
      const mx=(a[0]+e[0])/2,mz=(a[1]+e[1])/2,s=lmS(b,mx,mz),zone=lmZone(s);
      const L=Math.hypot(e[0]-a[0],e[1]-a[1]),longSide=Math.abs(((e[0]-a[0])*fr.ca+(e[1]-a[1])*fr.sa)/(L||1))>0.7;
      if(zone==='B'){
        if(top){// 9층 테라스: 안쪽으로 물러난 유리벽 + 낮은 유리 난간
          const ia=off(a,n,-2.6),ie=off(e,n,-2.6);quad(m,[ia[0],y0,ia[1]],[ie[0],y0,ie[1]],[ie[0],ys,ie[1]],[ia[0],ys,ia[1]],N3,LM_GLASS2,-2,-2,0);
          quad(m,[a[0],y0,a[1]],[e[0],y0,e[1]],[e[0],y0+1.1,e[1]],[a[0],y0+1.1,a[1]],N3,[0.72,0.82,0.88],-1,-1,0);continue}
        quad(m,[a[0],y0,a[1]],[e[0],y0,e[1]],[e[0],ys,e[1]],[a[0],ys,a[1]],N3,LM_GLASS,-2,-2,0);
        // 사무실 조명 줄 · 멀리언
        const dx=(e[0]-a[0])/L,dz=(e[1]-a[1])/L,rot=Math.atan2(-dz,dx);
        for(let k=0.9;k<L;k+=1.8){const x=a[0]+dx*k-n[0]*0.35,z=a[1]+dz*k-n[1]*0.35;pushShape(m,CUBE,x,ys-0.15,z,1.1,0.06,0.12,rot,[1,1,0.96],1)}
        for(let k=1.5;k<L;k+=1.5)pushShape(m,CUBE,a[0]+dx*k+n[0]*0.04,(y0+ys)/2,a[1]+dz*k+n[1]*0.04,0.07,ys-y0,0.08,rot,[0.85,0.88,0.9],0);
        if(f<=2)fins(m,a,e,n,y0,y1,1.25,f%2*0.6,0.55,0.15,LM_FIN);
      }else{
        // A(북쪽 매스)는 흰 벽, C(남쪽 타워)는 유리 뒤에 루버
        let wall=zone==='A'?LM_WHITE:LM_GLASS;
        const win=zone==='A'&&longSide&&(f===F-2||f===F-3);   // 7·8층 큰 창 (사진의 MAP GROUP 아래)
        if(win)wall=LM_DARK;
        const wl=wall!==LM_WHITE;quad(m,[a[0],y0,a[1]],[e[0],y0,e[1]],[e[0],ys,e[1]],[a[0],ys,a[1]],N3,wall,wl?-2:-1,wl?-2:-1,0);
        if(!win)fins(m,a,e,n,y0+0.05,y1,0.85,(f%2)*0.42,0.55,0.16,LM_FIN);
      }
    }
    // 슬래브 윗면 / 아랫면
    const roof=f===topF&&topF===F-1?b.roof:CONC;m.grow(b.tris.length*2);
    for(let q=0;q<b.tris.length;q+=3){for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],y1,P[1],0,1,0,...roof)}
      if(!intact)for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],ys,P[1],0,-1,0,...CONC_D)}}
    if(f===0&&!intact)for(let q=0;q<b.tris.length;q+=3)for(let k=0;k<3;k++){const P=b.pts[b.tris[q+k]];m.v(P[0],y0+0.05,P[1],0,1,0,...CONC_D)}
    if(!intact){for(let j=0;j<d.C;j++){const hp=d.hp[f*d.C+j],[x,z]=colPos(d,j);
      if(hp>0){const sx=1-hp/d.hp0;const cc=[CONC[0]+(0.85-CONC[0])*sx,CONC[1]+(0.40-CONC[1])*sx,CONC[2]+(0.25-CONC[2])*sx];prismCol(m,x,z,y0,ys,0.8,cc)}
      else{prismCol(m,x,z,y0,y0+0.5,0.8,CONC_D);rebars(m,x,z,y0+0.5,R);prismCol(m,x,z,ys-0.4,ys,0.8,CONC_D)}}}
    if(f===topF&&topF<F-1){for(let j=0;j<d.C;j++)if(d.hp[f*d.C+j]>0){const [x,z]=colPos(d,j);rebars(m,x,z,y1,R)}}
  }
  // 9층이 살아 있을 때만: 남쪽 타워 루버 스크린 · 지그재그 계단 · 글자 · 테라스 정원
  if(topF===F-1){const roofY=base+d.fy[F-1]+d.fh,f9=F-1;
    for(let j=0;j<d.M;j++){if(!d.panel[f9*d.M+j])continue;const a=d.nodes[j],e=d.nodes[(j+1)%d.M],n=d.edgeN[j];if(lmZone(lmS(b,(a[0]+e[0])/2,(a[1]+e[1])/2))!=='C')continue;
      fins(m,a,e,n,roofY,roofY+6,0.85,0,0.55,0.16,LM_FIN);
      const dx=e[0]-a[0],dz=e[1]-a[1],L=Math.hypot(dx,dz);pushShape(m,CUBE,(a[0]+e[0])/2+n[0]*0.25,roofY+6,(a[1]+e[1])/2+n[1]*0.25,L,0.25,0.5,Math.atan2(-dz,dx),LM_FIN,0)}
    // 남쪽 끝면: 초록 점선 지그재그 (외부 계단)
    const sv=fr.v1-fr.v0,endN=fr.flip?[-fr.ca,-fr.sa]:[fr.ca,fr.sa],ex=lmXZ(b,1,0);
    for(let f=0;f<F;f++){if(!d.fl[f])continue;const y0=base+d.fy[f];
      for(let k=0;k<10;k++){const u=k/9,v=fr.v0+sv*(0.08+0.84*(f%2?1-u:u)),y=y0+0.5+u*(d.fh-1.0);
        const [x,z]=lmXZ(b,1,v);pushShape(m,CUBE,x+endN[0]*0.85,y,z+endN[1]*0.85,0.6,0.24,0.6,Math.atan2(endN[0],endN[1]),LM_GREEN,0)}}
    // MAP GROUP (북쪽 매스 양쪽 긴 면, 9층 창 위)
    for(const side of [1,-1]){const v=side>0?fr.v1:fr.v0,nn=[-fr.sa*side,fr.ca*side],[x,z]=lmXZ(b,0.12,v);const r=[nn[1],-nn[0]];
      const px=Math.min(0.24,(0.2*fr.L)/53);pixText(m,'MAP GROUP',x+nn[0]*0.75,base+d.fy[f9]+d.fh*0.5,z+nn[1]*0.6,r[0],r[1],nn[0],nn[1],px,LM_GREEN)}
    // 남쪽 타워 꼭대기에도 작은 MAP
    {const [x,z]=lmXZ(b,1,0);pixText(m,'MAP',x+endN[0]*0.8,roofY+3,z+endN[1]*0.8,endN[1],-endN[0],endN[0],endN[1],0.32,LM_GREEN)}
    // 9층 테라스 정원 (가운데 유리 부분)
    const y9=base+d.fy[f9];for(let k=0;k<6;k++){const s=0.27+k*0.055,v=(k%2?0.3:-0.3)*sv*0.6,[x,z]=lmXZ(b,s,v),sz=2.2+R()*0.8;
      pushShape(m,CUBE,x,y9+sz*0.4,z,sz*0.12,sz*0.8,sz*0.12,0,[0.38,0.29,0.21],0,1);pushShape(m,ICO,x,y9+sz*1.1,z,sz*0.6,sz*0.75,sz*0.6,x,[0.24,0.45,0.22],0,1)}}
  m.upload();
}

function drawDets(){for(const b of DETS)if(b.alive&&b.det)b.det.mb.draw()}

// ---------- 되돌리기용 ----------
function detSnap(b){const d=b.det;return d?{panel:d.panel.slice(),hp:d.hp.slice(),fl:d.fl.slice(),fy:d.fy.slice(),weak:d.weak}:null}
function detRestore(b,s){if(!s){freeDet(b);return}const d=ensureDet(b);d.panel.set(s.panel);d.hp.set(s.hp);d.fl.set(s.fl);d.fy.set(s.fy);d.vy.fill(0);d.weak=s.weak;d.dirty=true}

// =====================================================================
//  건축 현장 도구 (동네 모드) — 타워크레인 · 철거반 · 불도저 · 철근 빼기
// =====================================================================
let CRANES=[], CREWS=[], DOZERS=[], REBARFX=[], dozerPath=null;
const YEL=[0.98,0.76,0.10], YEL_D=[0.80,0.58,0.06], STEEL=[0.30,0.31,0.33], TRACK=[0.13,0.13,0.14];
const TOY=2.2;   // 사람·장비를 멀리서도 보이게 키우는 배율

function nearestBuilding(x,z,r){let best=null,bd=1e9;forBuildingsNear(x,z,r,b=>{if(!b.alive)return;const d=distToBuilding(b,x,z);if(d<bd){bd=d;best=b}});return bd<=r?best:null}
// 건물 외곽 위의 가장 가까운 점과 바깥쪽 방향
function facadePoint(b,x,z){let best=null,bd=1e9;const p=b.pts;
  for(let i=0;i<p.length;i++){const a=p[i],c=p[(i+1)%p.length];const dx=c[0]-a[0],dz=c[1]-a[1];const l2=dx*dx+dz*dz||1;let t=clamp(((x-a[0])*dx+(z-a[1])*dz)/l2,0,1);
    const px=a[0]+dx*t,pz=a[1]+dz*t,d=Math.hypot(px-x,pz-z);if(d<bd){bd=d;const l=Math.sqrt(l2);best={x:px,z:pz,nx:dz/l,nz:-dx/l}}}
  return best}

// ---------- 1. 타워크레인 쇠공 — 선을 그으면 그 선을 따라 휘두름 ----------
// A→B 방향으로 한 번 크게 휘두르고(100%), 되돌아오며 한 번 더(60%) 쓸어버림
function spawnCraneLine(A,B){
  let dx=B.x-A.x,dy=B.y-A.y,dz=B.z-A.z,L=Math.hypot(dx,dy,dz);
  if(L<6){toast('쇠공: 휘두를 방향으로 길게 선을 그어주세요');return false}
  if(L>150){const k=150/L;B={x:A.x+dx*k,y:A.y+dy*k,z:A.z+dz*k};dx*=k;dy*=k;dz*=k;L=150}
  const mx=(A.x+B.x)/2,mz=(A.z+B.z)/2;
  let top=Math.max(A.y,B.y);forBuildingsNear(mx,mz,L/2+10,b=>{if(b.alive)top=Math.max(top,b.base+b.h)});
  const hl=Math.hypot(dx,dz)||1;let nx=-dz/hl,nz=dx/hl;
  if((eye[0]-mx)*nx+(eye[2]-mz)*nz>0){nx=-nx;nz=-nz}   // 크레인은 카메라 반대편에 세워 휘두르는 모습이 가리지 않게
  const piv={x:mx,y:top+16+L*0.08,z:mz},mast={x:mx+nx*(18+L*0.12),z:mz+nz*(18+L*0.12)};
  CRANES.push({A,B,L,piv,mast,t:0,grow:0,phase:'rise',pass:0,s:0,lastS:0,hit:new Set(),trail:[]});
  sfx(8);toast('타워크레인 쇠공 — 그은 선을 따라 휘둘러요!',1300);statTool('crane');return true;
}
const BALL_R=3.4;
function craneBall(c,s){const A=c.A,B=c.B,sag=Math.sin(Math.PI*s)*Math.min(7,c.L*0.08);
  return[A.x+(B.x-A.x)*s,A.y+(B.y-A.y)*s-sag,A.z+(B.z-A.z)*s]}
function updateCranes(dt){
  for(let i=CRANES.length-1;i>=0;i--){const c=CRANES[i];c.t+=dt;
    if(c.phase==='rise'){c.grow=Math.min(1,c.grow+dt*2.4);if(c.grow>=1){c.phase='swing';c.t=0;c.s=0;c.lastS=0;sfx(12,0.8)}continue}
    if(c.phase==='swing'){const T=0.55+c.L/130;const u=Math.min(1,c.t/T);const e=(1-Math.cos(Math.PI*u))/2;
      const s=c.pass===0?e:1-e;const pw=c.pass===0?1:0.6;
      // 지나간 구간을 1.5m 간격으로 훑으며 피해
      const a=c.lastS,b=s,n=Math.max(1,Math.ceil(Math.abs(b-a)*c.L/1.5));
      const spd=Math.abs(b-a)*c.L/Math.max(dt,1e-3);
      for(let k=1;k<=n;k++){const p=craneBall(c,a+(b-a)*k/n);if(CLIENT)clientHitAt(p[0],p[1],p[2],BALL_R+1,2,c.hit);
        forBuildingsNear(p[0],p[2],BALL_R+8,o=>{if(!o.alive||o.lifted)return;if(distToBuilding(o,p[0],p[2])>BALL_R+0.8)return;
          if(p[1]<o.base-2||p[1]>o.base+o.h+BALL_R)return;
          const y=clamp(p[1],o.base+1,o.base+Math.max(1.2,o.h-0.6));
          structDamage(o,p[0],y,p[2],BALL_R*2.4,(1.3+Math.min(1.5,spd/50))*pw);
          if(!c.hit.has(o)){c.hit.add(o);hitStop(0.06);cam.shake=Math.max(cam.shake,7*pw);boom3(p[0],y,p[2],14);sfxBoom(0.5*pw);
            for(let q=0;q<10;q++)spawn(p[0],y,p[2],(Math.random()-.5)*20,4+Math.random()*10,(Math.random()-.5)*20,1+Math.random()*1.8,Math.random()<0.5?o.col:CONC)}});
        forTreesNear(p[0],p[2],BALL_R+2,t=>{if(t.alive&&Math.hypot(t.x-p[0],t.z-p[2])<BALL_R+1.5&&p[1]<groundAt(t.x,t.z)+t.s*2)killTree(t)})}
      c.lastS=s;const bp=craneBall(c,s);c.trail.push(bp);if(c.trail.length>7)c.trail.shift();
      if(u>=1){if(c.pass===0){c.pass=1;c.t=0;c.hit=new Set();c.trail=[]}else{c.phase='retract';c.t=0}}
      continue}
    c.grow-=dt*1.6;if(c.grow<=0)CRANES.splice(i,1)}
}
function drawCrane(m,mg,c){
  const g=clamp(c.grow,0,1),gy=groundAt(c.mast.x,c.mast.z),H=(c.piv.y-gy+3)*g,x=c.mast.x,z=c.mast.z;
  pushShape(m,CUBE,x,gy+0.6,z,8,1.2,8,0,[0.55,0.55,0.53],0);
  pushShape(m,CUBE,x,gy+H/2,z,2.4,H,2.4,0,YEL,0);
  for(let y=6;y<H-2;y+=6)pushShape(m,CUBE,x,gy+y,z,2.7,0.35,2.7,0,YEL_D,0);
  if(g<0.5)return;
  const top=gy+H,dx=c.piv.x-x,dz=c.piv.z-z,L=Math.hypot(dx,dz)||1,ang=Math.atan2(dz,dx);
  pushShape(m,CUBE,x+dx/2,top,z+dz/2,L+4,1.5,1.5,-ang,YEL,0);
  pushShape(m,CUBE,x-dx/L*6,top,z-dz/L*6,12,1.3,1.3,-ang,YEL_D,0);
  pushShape(m,CUBE,x-dx/L*11,top-1.6,z-dz/L*11,3,3,3,-ang,[0.6,0.6,0.58],0);
  pushShape(m,CUBE,x,top+1.7,z,2.8,1.9,2.8,-ang,[0.95,0.95,0.93],0);
  const p=c.phase==='rise'?(()=>{const q=craneBall(c,0);return[q[0],q[1]+(1-g)*20,q[2]]})():c.phase==='retract'?craneBall(c,c.pass?0:1):craneBall(c,c.phase==='swing'?c.lastS:0);
  const by=Math.min(p[1],top-2);
  drawSeg(m,[c.piv.x,top,c.piv.z],[p[0],by+BALL_R,p[2]],0.3,STEEL);
  pushShape(m,SPHERE,p[0],by,p[2],BALL_R,BALL_R,BALL_R,0,[0.16,0.16,0.18],0);
  pushShape(m,CUBE,p[0],by+BALL_R+0.4,p[2],0.9,0.8,0.9,0,STEEL,0);
  // 휘두르는 궤적(잔상)
  if(c.phase==='swing')c.trail.forEach((q,k)=>{const s=BALL_R*(0.35+k/c.trail.length*0.5);pushShape(mg,CUBE,q[0],q[1],q[2],s,s,s,k,[0.95,0.9,0.75],1)});
}

// ---------- 2. 철거반 인부떼 — 수십 명이 외벽을 타고 올라가 층마다 동시에 오함마질 ----------
const CREW_MAX=160;
function crewCount(){let n=0;for(const c of CREWS)n+=c.ws.length;return n}
function spawnCrew(h){
  const b=h.b||nearestBuilding(h.x,h.z,40);if(!b){toast('철거할 건물을 눌러주세요');return}
  const room=CREW_MAX-crewCount();if(room<10){toast('현장에 인부가 꽉 찼어요 — 잠시 뒤 다시');return}
  const d=ensureDet(b);const n=Math.min(room,clamp(Math.round(Math.sqrt(b.area)*2.4+d.F*2),30,90));
  const ws=[],R=Math.sqrt(b.area)/2;
  for(let k=0;k<n;k++){const a=Math.random()*Math.PI*2,r=R+28+Math.random()*30;
    const j=Math.floor(Math.random()*d.M),A=d.nodes[j],C=d.nodes[(j+1)%d.M],tt=Math.random(),nn=d.edgeN[j];
    const fx=A[0]+(C[0]-A[0])*tt,fz=A[1]+(C[1]-A[1])*tt;
    const f=Math.random()<0.7?Math.min(d.F-1,Math.floor(Math.random()*3)):Math.min(d.F-1,Math.floor(Math.pow(Math.random(),1.3)*d.F));
    const sx=b.cx+Math.cos(a)*r,sz=b.cz+Math.sin(a)*r;
    ws.push({x:sx,z:sz,y:groundAt(sx,sz),fx,fz,nx:nn[0],nz:nn[1],f,state:'run',t:-Math.random()*1.4,hit:0,vy:0,dir:0,
      vest:Math.random()<0.5?[1,0.45,0.1]:[0.95,0.85,0.15],helm:Math.random()<0.3?[0.95,0.95,0.95]:[0.98,0.8,0.1]})}
  CREWS.push({b,ws,t:0});
  toast(`철거반 ${n}명 투입! 반장: "오늘 안에 다 끝낸다!"`,2000);sfx(10,1.2);
  floatText(b.cx,b.base+b.h+8,b.cz,`인부 ${n}명 투입`,'cad',1.6);
}
function updateCrews(dt){
  for(let i=CREWS.length-1;i>=0;i--){const c=CREWS[i];c.t+=dt;const b=c.b,live=b.alive;const d=live?b.det:null;let any=false;
    for(const w of c.ws){if(w.gone)continue;any=true;w.t+=dt;if(w.t<0)continue;
      if((w.state==='climb'||w.state==='hit')&&(!live||!d||!d.fl[w.f])){w.state='fall';w.vy=2;w.t=0}
      if(w.state==='run'){const tx=w.fx+w.nx*0.7,tz=w.fz+w.nz*0.7,dx=tx-w.x,dz=tz-w.z,l=Math.hypot(dx,dz);
        if(!live){w.state='leave';w.t=0}else if(l<0.6){w.state='climb';w.t=0;w.x=tx;w.z=tz}
        else{const sp=Math.min(l,12*dt);w.x+=dx/l*sp;w.z+=dz/l*sp;w.dir=Math.atan2(dz,dx)}w.y=groundAt(w.x,w.z)}
      else if(w.state==='climb'){const ty=b.base+d.fy[w.f]+0.1;w.dir=Math.atan2(-w.nz,-w.nx);
        if(w.y<ty){w.y=Math.min(ty,w.y+7.5*dt)}else{w.y=ty;w.state='hit';w.t=Math.random()*0.4}}
      else if(w.state==='hit'){w.y=b.base+d.fy[w.f]+0.1;w.dir=Math.atan2(-w.nz,-w.nx);
        if(w.t>0.5){w.t=0;w.hit++;
          let bj=-1,bd=1e9;for(let j=0;j<d.C;j++){if(d.hp[w.f*d.C+j]<=0)continue;const [x,z]=colPos(d,j);const dd=Math.hypot(x-w.x,z-w.z);if(dd<bd){bd=dd;bj=j}}
          if(bj<0){// 이 층 기둥이 다 부러짐 → 한 층 위로
            if(w.f+1<d.F&&d.fl[w.f+1]){w.f++;w.state='climb'}else{w.state='fall';w.vy=3}}
          else{const ii=w.f*d.C+bj;d.hp[ii]-=0.38;addScore(90*nightK(b));
            for(let q=-1;q<=1;q++){const pj=(Math.floor(Math.random()*d.M));if(Math.hypot(d.nodes[pj][0]-w.x,d.nodes[pj][1]-w.z)<5)d.panel[w.f*d.M+pj]=0}
            spawn(w.x,w.y+1.6,w.z,w.nx*4+(Math.random()-.5)*3,3,w.nz*4+(Math.random()-.5)*3,0.5,[0.72,0.71,0.68]);
            if(Math.random()<0.25)spawn(w.x,w.y+1.8,w.z,(Math.random()-.5)*3,2,(Math.random()-.5)*3,0.25,[1,0.85,0.4],0.25,1);
            if(d.hp[ii]<=0)addScore(320*nightK(b));d.dirty=true;detCheck(b)}}}
      else if(w.state==='fall'){w.vy-=30*dt;w.y+=w.vy*dt;w.x+=w.nx*4*dt;w.z+=w.nz*4*dt;w.dir+=dt*8;
        const g=groundAt(w.x,w.z);if(w.y<=g){w.y=g;w.t=-0.4;
          // 살아남은 인부는 남은 가장 낮은 층으로 다시 달려듦
          const dd=b.alive?b.det:null;let lf=-1;if(dd&&c.t<40)for(let k=0;k<dd.F;k++)if(dd.fl[k]){lf=k;break}
          if(lf>=0){w.f=lf;w.state='run'}else w.state='leave'}}
      else if(w.state==='leave'){const dx=w.x-b.cx,dz=w.z-b.cz,l=Math.hypot(dx,dz)||1;w.x+=dx/l*11*dt;w.z+=dz/l*11*dt;w.dir=Math.atan2(dz,dx);w.y=groundAt(w.x,w.z);if(w.t>3.5)w.gone=true}}
    if(live&&d&&c.t>40)for(const w of c.ws)if(w.state==='hit'||w.state==='climb'){w.state='fall';w.vy=2}
    if(!any)CREWS.splice(i,1)}
}
function drawWorker(m,w,S){
  if(w.gone||w.t<0&&w.state==='run')return;
  const s=S||TOY,gy=w.y!=null?w.y:groundAt(w.x,w.z),rot=w.dir||0,st=w.state;
  const fx=Math.cos(rot),fz=Math.sin(rot),now=performance.now();
  const ph=st==='run'||st==='leave'||st==='walk'?Math.sin(now/80+w.x*3)*0.25:0;
  pushShape(m,CUBE,w.x,gy+0.45*s,w.z,0.28*s,0.9*s,0.32*s,rot,[0.2,0.22,0.3],0);
  pushShape(m,CUBE,w.x,gy+1.15*s+ph*0.1*s,w.z,0.32*s,0.6*s,0.46*s,rot,w.vest,0);
  pushShape(m,CUBE,w.x,gy+1.6*s,w.z,0.24*s,0.26*s,0.24*s,rot,[0.95,0.78,0.62],0);
  pushShape(m,CUBE,w.x,gy+1.78*s,w.z,0.3*s,0.12*s,0.3*s,rot,w.helm,0);
  const rx=-fz,rz=fx;
  if(st==='climb'){const a=Math.sin(now/90+w.x*5)*0.25*s;   // 팔 번갈아 뻗으며 기어오름
    pushShape(m,CUBE,w.x+rx*0.28*s+fx*0.15*s,gy+(1.75)*s+a,w.z+rz*0.28*s+fz*0.15*s,0.1*s,0.6*s,0.1*s,rot,w.vest,0);
    pushShape(m,CUBE,w.x-rx*0.28*s+fx*0.15*s,gy+(1.75)*s-a,w.z-rz*0.28*s+fz*0.15*s,0.1*s,0.6*s,0.1*s,rot,w.vest,0)}
  else if(st==='fall'){pushShape(m,CUBE,w.x,gy+1.4*s,w.z,0.9*s,0.1*s,0.1*s,rot,w.vest,0)}
  if(st==='hit'){const sw=Math.sin(w.t/0.5*Math.PI);const hy=gy+(1.9-sw*1.2)*s;
    pushShape(m,CUBE,w.x+fx*0.35*s,hy-0.3*s,w.z+fz*0.35*s,0.06*s,0.75*s,0.06*s,rot,[0.55,0.38,0.2],0);
    pushShape(m,CUBE,w.x+fx*0.35*s,hy+0.08*s,w.z+fz*0.35*s,0.34*s,0.16*s,0.16*s,rot,STEEL,0)}
}

// ---------- 3. 불도저 — 선을 그으면 그 방향으로 밀고 가며 경로의 건물 저층에 구멍을 뚫음 ----------
const DZ_S=TOY*1.8;   // 불도저 크기 (길이 약 17m · 높이 약 7m)
function spawnDozerLine(A,B){
  let dx=B.x-A.x,dz=B.z-A.z,l=Math.hypot(dx,dz);
  if(l<10){toast('불도저: 밀고 갈 방향으로 길게 그어주세요');return false}
  l=Math.min(l,400);dx/=Math.hypot(B.x-A.x,B.z-A.z);dz/=Math.hypot(B.x-A.x,B.z-A.z);
  const px=-dz,pz=dx,gap=4.6*DZ_S+2;
  for(const [o,back] of [[0,0],[-gap,8],[gap,8]])DOZERS.push({x:A.x-dx*(14+back)+px*o,z:A.z-dz*(14+back)+pz*o,dx,dz,left:l+14+back,t:0,gone:0,v:4,acc:0,inB:null,hits:new Set(),shake:0});
  toast('불도저 3대 출동 — 나란히 밀고 지나가요!',1300);sfx(12,1.5);statTool('dozer');return true}
function dozerBlade(d){const s=DZ_S;return[d.x+d.dx*3.0*s,d.z+d.dz*3.0*s]}
function updateDozers(dt){
  for(let i=DOZERS.length-1;i>=0;i--){const d=DOZERS[i];d.t+=dt;
    if(d.left<=0){d.gone+=dt;if(d.gone>1.2)DOZERS.splice(i,1);continue}
    const [bx,bz]=dozerBlade(d);let inside=null;
    forBuildingsNear(bx,bz,8,b=>{if(!inside&&b.alive&&!b.lifted&&distToBuilding(b,bx,bz)<3.5)inside=b});
    // 건물 안에서는 느려지고(밀어붙이는 느낌), 밖에서는 빨라짐
    const vmax=inside?15:32;d.v+=(vmax-d.v)*Math.min(1,dt*(inside?5:2.5));
    const sp=d.v*dt;d.x+=d.dx*sp;d.z+=d.dz*sp;d.left-=sp;
    if(inside&&!d.hits.has(inside)){d.hits.add(inside);hitStop(0.05);cam.shake=Math.max(cam.shake,5);boom3(bx,inside.base+2,bz,12);sfxBoom(0.4);floatText(bx,inside.base+6,bz,'쾅!','boom',0.7)}
    d.acc+=dt;
    if(d.acc>0.07){d.acc=0;const w=1.8*DZ_S;   // 블레이드 폭
      if(CLIENT)clientHitAt(bx,groundAt(bx,bz)+2,bz,w+2,2.2,d.hits);
      forBuildingsNear(bx,bz,w+6,b=>{if(!b.alive||b.lifted)return;if(distToBuilding(b,bx,bz)>w*0.6)return;
        if(b.area<90&&b.h0<9){killBuilding(b);return}
        structDamage(b,bx,b.base+1.8,bz,w+1.5,2.2,{floors:[0]});
        if(b.alive&&b.det&&b.det.F>1)structDamage(b,bx,b.base+b.det.fh+1.5,bz,w,1.4,{floors:[1]});
        if(b.alive&&b.det&&b.det.F>2)structDamage(b,bx,b.base+b.det.fh*2+1.5,bz,w*0.7,0.8,{floors:[2]});
        if(Math.random()<0.6)spawn(bx,b.base+1.5,bz,d.dx*9+(Math.random()-.5)*5,3+Math.random()*3,d.dz*9+(Math.random()-.5)*5,0.8+Math.random()*1.2,Math.random()<0.5?b.col:CONC)});
      if(inside)cam.shake=Math.max(cam.shake,1.6)}
    forTreesNear(bx,bz,8,t=>{if(t.alive&&Math.hypot(t.x-bx,t.z-bz)<8)killTree(t)});
    for(let k=0;k<MAXD;k++){if(!D.used[k]||!D.rest[k])continue;if(Math.hypot(D.x[k]-bx,D.z[k]-bz)<7){D.rest[k]=0;D.vx[k]=d.dx*8+(Math.random()-.5)*3;D.vz[k]=d.dz*8+(Math.random()-.5)*3;D.vy[k]=2;rubDirty=true}}
    if(Math.random()<0.35)spawn(d.x-d.dx*2,groundAt(d.x,d.z)+4.5*DZ_S*0.7,d.z-d.dz*2,(Math.random()-.5),3,(Math.random()-.5),0.6,[0.35,0.35,0.36],0.8,2);
  }
}
function drawDozerAt(m,x,gy,z,dx,dz,s,jig){
  const rot=Math.atan2(dz,dx),f=[dx,dz],r=[-dz,dx],j=jig||0;
  const P=(a,b,y)=>[x+f[0]*a+r[0]*b,gy+y+j,z+f[1]*a+r[1]*b];const ro=-rot;
  let p=P(0,1.5*s,0.55*s);pushShape(m,CUBE,p[0],p[1]-j,p[2],4.2*s,1.1*s,0.8*s,ro,TRACK,0);
  p=P(0,-1.5*s,0.55*s);pushShape(m,CUBE,p[0],p[1]-j,p[2],4.2*s,1.1*s,0.8*s,ro,TRACK,0);
  p=P(0,0,1.5*s);pushShape(m,CUBE,p[0],p[1],p[2],3.6*s,1.2*s,2.6*s,ro,YEL,0);
  p=P(-0.6*s,0,2.8*s);pushShape(m,CUBE,p[0],p[1],p[2],1.6*s,1.5*s,1.8*s,ro,YEL_D,0);
  p=P(-0.6*s,0,3.65*s);pushShape(m,CUBE,p[0],p[1],p[2],1.7*s,0.15*s,1.9*s,ro,[0.2,0.2,0.2],0);
  p=P(1.0*s,0.6*s,2.9*s);pushShape(m,CUBE,p[0],p[1],p[2],0.18*s,1.2*s,0.18*s,ro,[0.15,0.15,0.15],0);
  p=P(2.2*s,0,1.1*s);pushShape(m,CUBE,p[0],p[1],p[2],1.4*s,0.25*s,0.25*s,ro,STEEL,0);
  p=P(2.9*s,0,1.1*s);pushShape(m,CUBE,p[0],p[1],p[2],0.4*s,1.8*s,4.4*s,ro,[0.42,0.42,0.42],0);   // 블레이드
}
function drawDozer(m,d){const a=d.left<=0?Math.max(0,1-d.gone/1.2):1;if(a<=0)return;drawDozerAt(m,d.x,groundAt(d.x,d.z),d.z,d.dx,d.dz,DZ_S,d.hits.size&&d.v<17?(Math.random()-.5)*0.4:0)}

// ---------- 4. 철근 빼기 (순살 공법) ----------
function spawnRebar(h){
  const b=h.b||nearestBuilding(h.x,h.z,25);if(!b){toast('철근을 뺄 건물을 눌러주세요');return}
  const d=ensureDet(b);
  for(let i=0;i<d.hp.length;i++)d.hp[i]=Math.min(d.hp[i],d.hp0*(0.32+Math.random()*0.12));
  d.weak=1;d.weakT=-1.6;d.dirty=true;
  const bars=[];for(let j=0;j<d.C;j+=Math.max(1,Math.floor(d.C/18))){const [x,z]=colPos(d,j);bars.push({x,z,v:8+Math.random()*10,y:0,del:Math.random()*0.6})}
  REBARFX.push({b,bars,t:0});
  toast('철근 빼는 중… 순살 구조라 자기 무게도 못 버텨요',3000);sfx(15,1.6);
}
function updateRebar(dt){for(let i=REBARFX.length-1;i>=0;i--){const r=REBARFX[i];r.t+=dt;for(const b of r.bars){if(r.t>b.del)b.y+=b.v*dt}if(r.t>3)REBARFX.splice(i,1)}}
function drawRebarFx(m,r){const top=r.b.base+(r.b.alive?r.b.h:0);for(const b of r.bars){if(r.t<b.del)continue;const len=6;pushShape(m,CUBE,b.x,top+b.y+len/2-2,b.z,0.18,len,0.18,0,REBAR,0)}}

// ---------- 5. 심의 보류 도장 ----------
let STAMPS=[];
function spawnStamp(h){
  const b=h.b||nearestBuilding(h.x,h.z,15);
  const R=b?clamp(Math.sqrt(b.area)/2+2,7,26):12,x=b?b.cx:h.x,z=b?b.cz:h.z;
  const top=b?b.base+b.h:groundAt(x,z);
  STAMPS.push({b,x,z,R,y:top+220,vy:-160,state:'drop',t:0,stop:b?b.base+b.h0*0.35:groundAt(x,z)});
  sfx(5);
}
function updateStamps(dt){
  for(let i=STAMPS.length-1;i>=0;i--){const s=STAMPS[i];s.t+=dt;
    if(s.state==='drop'){s.y+=s.vy*dt;const top=s.b&&s.b.alive?s.b.base+s.b.h:groundAt(s.x,s.z);
      if(s.y<=top){s.y=top;s.state='press';s.t=0;cam.shake=Math.max(cam.shake,6);boom3(s.x,top,s.z,16);sfx(35);
        floatText(s.x,top+3,s.z,'보 류','mark',3);if(!s.b){carve(s.x,s.z,s.R,3,true);forTreesNear(s.x,s.z,s.R,t=>{if(Math.hypot(t.x-s.x,t.z-s.z)<s.R)killTree(t)})}}}
    else if(s.state==='press'){
      if(s.b&&s.b.alive){const d=ensureDet(s.b);s.y-=12*dt;
        // 도장 바닥보다 위에 있는 층은 차례로 찍혀 무너짐
        for(let f=d.F-1;f>=0;f--){if(!d.fl[f])continue;if(s.b.base+d.fy[f]+d.fh*0.5>s.y){collapseFloor(s.b,f);d.dirty=true}break}
        if(!d.fl.some(v=>v)){freeDet(s.b);killBuilding(s.b)}
        if(s.y<=s.stop||!s.b.alive){s.state='lift';s.t=0;detCheck(s.b)}}
      else if(s.t>0.5){s.state='lift';s.t=0}}
    else{s.y+=60*dt;if(s.t>2)STAMPS.splice(i,1)}}
}
function drawStamp(m,s){
  const red=[0.82,0.10,0.10],dk=[0.36,0.22,0.14];
  pushShape(m,CUBE,s.x,s.y+1.2,s.z,s.R*2,2.4,s.R*2,0.3,red,0);
  pushShape(m,CUBE,s.x,s.y+3.4,s.z,s.R*1.6,2,s.R*1.6,0.3,[0.95,0.93,0.88],0);
  pushShape(m,CUBE,s.x,s.y+3.4+s.R*0.9,s.z,s.R*0.35,s.R*1.6,s.R*0.35,0.3,dk,0);
  pushShape(m,SPHERE,s.x,s.y+4+s.R*1.8,s.z,s.R*0.45,s.R*0.4,s.R*0.45,0,dk,0);
}
// ---------- 공통 ----------
function boom3(x,y,z,size){const n=Math.min(40,Math.floor(size*2.5));
  for(let k=0;k<n;k++){const a=Math.random()*Math.PI*2,s=Math.random()*size*0.6;spawn(x,y,z,Math.cos(a)*s,2+Math.random()*size*0.6,Math.sin(a)*s,0.6+Math.random()*size*0.08,Math.random()<0.5?[0.8,0.78,0.74]:[0.62,0.6,0.57],0.5+Math.random()*0.5,1)}
  sfx(size)}
function updateTools(dt){bossUpdate(dt);boomUpdate(dt);adUpdate(dt);clientUpdate(dt);updateCranes(dt);updateCrews(dt);updateDozers(dt);updateRebar(dt);updateStamps(dt);updateTools2(dt)}
function drawTools(m,mg){
  for(const c of CRANES)drawCrane(m,mg,c);
  for(const c of CREWS)for(const w of c.ws)drawWorker(m,w,TOY);
  for(const d of DOZERS)drawDozer(m,d);
  for(const r of REBARFX)drawRebarFx(m,r);
  for(const s of STAMPS)drawStamp(m,s);
  drawTools2(m,mg);drawBoss(m,mg);drawClient(m,mg);drawShip(m,mg);drawAd(m,mg);drawStopFence(m);
  if(dozerPath&&dozerPath.b){const a=dozerPath.a,b=dozerPath.b,l=Math.hypot(b.x-a.x,b.z-a.z);const n=Math.max(1,Math.floor(l/4));
    for(let k=0;k<=n;k+=1){const x=a.x+(b.x-a.x)*k/n,z=a.z+(b.z-a.z)*k/n;pushShape(mg,CUBE,x,groundAt(x,z)+0.6,z,1.6,0.3,1.6,0,[1,0.8,0.1],1)}}
}
function clearTools(){CRANES=[];CREWS=[];DOZERS=[];REBARFX=[];STAMPS=[];dozerPath=null;clearTools2()}

// =====================================================================
//  설계팀 · 시공팀 신규 도구
//  시공: 레미콘 과타설 · 다이너마이트   설계: TRIM
//  + 떠다니는 글씨(FLOATS) · CAD 명령줄 · 필살기 게이지 · 철거 일보 통계
// =====================================================================
let POURS=[], FLOATS=[];
let ULT=0, ultArmed=false;
let STATS={t0:0,kills:0,tools:{}};
function statTool(id){STATS.tools[id]=(STATS.tools[id]||0)+1;if(!STATS.t0)STATS.t0=performance.now()}

// ---------- 떠다니는 글씨 (보류 도장 · 카운트다운 · CAD 명령) ----------
function floatText(x,y,z,text,cls,dur){FLOATS.push({x,y,z,text,cls:cls||'mark',t:0,dur:dur||3})}
function updateFloats(dt){for(let i=FLOATS.length-1;i>=0;i--){FLOATS[i].t+=dt;if(FLOATS[i].t>FLOATS[i].dur)FLOATS.splice(i,1)}}
function drawFloats(){const box=$('#marks');
  while(box.children.length<FLOATS.length)box.appendChild(document.createElement('div'));
  [...box.children].forEach((e,i)=>{const f=FLOATS[i];if(!f){e.style.display='none';return}const p=project(f.x,f.y,f.z);if(!p){e.style.display='none';return}
    if(e.className!==f.cls)e.className=f.cls;if(e.textContent!==f.text)e.textContent=f.text;
    e.style.display='';e.style.left=p[0]+'px';e.style.top=p[1]+'px';e.style.opacity=Math.min(1,(f.dur-f.t)*1.5);
    e.style.transform=f.cls==='mark'?`translate(-50%,-50%) rotate(-12deg) scale(${1+Math.max(0,0.4-f.t)})`:`translate(-50%,-50%) scale(${1+Math.max(0,0.3-f.t)})`})}

// ---------- CAD 명령줄 ----------
function cmdLine(lines){const el=$('#cmdbar');el.innerHTML=lines.map(l=>`<div>${esc(l)}</div>`).join('');el.classList.add('show');clearTimeout(cmdLine._t);cmdLine._t=setTimeout(()=>el.classList.remove('show'),3200)}

// ---------- 선 위에 상자 늘어놓기 (크레인 줄, 펌프카 붐) ----------
function drawSeg(m,a,b,w,c){const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],l=Math.hypot(dx,dy,dz);const n=Math.max(1,Math.ceil(l/(w*0.9)));
  for(let k=0;k<=n;k++){const t=k/n;pushShape(m,CUBE,a[0]+dx*t,a[1]+dy*t,a[2]+dz*t,w,w,w,Math.atan2(dz,dx),c,0)}}

// ---------- 시공 2. 레미콘 과타설 ----------
function spawnPour(h){
  const b=h.b||nearestBuilding(h.x,h.z,40);if(!b){toast('콘크리트를 부을 건물을 눌러주세요');return}
  const fp=facadePoint(b,h.x,h.z);
  POURS.push({b,x:fp.x+fp.nx*48,z:fp.z+fp.nz*48,tx:fp.x+fp.nx*9,tz:fp.z+fp.nz*9,nx:fp.nx,nz:fp.nz,state:'drive',t:0,load:0,acc:0,boom:0,floorsGone:0});
  toast('레미콘 도착 — 옥상에 타설 시작',1500);sfx(10,1.4);
}
function updatePours(dt){
  for(let i=POURS.length-1;i>=0;i--){const p=POURS[i];p.t+=dt;
    if(p.state==='drive'){const dx=p.tx-p.x,dz=p.tz-p.z,l=Math.hypot(dx,dz);if(l<0.5){p.state='pump';p.t=0}else{const sp=Math.min(l,11*dt);p.x+=dx/l*sp;p.z+=dz/l*sp}}
    else if(p.state==='pump'){p.boom=Math.min(1,p.boom+dt*0.8);if(!p.b.alive){p.state='leave';p.t=0;continue}
      if(p.boom>=1){p.load+=dt*0.5;
        const top=p.b.base+p.b.h;if(Math.random()<0.7)spawn(p.b.cx+(Math.random()-.5)*2,top+12,p.b.cz+(Math.random()-.5)*2,(Math.random()-.5)*2,-6,(Math.random()-.5)*2,0.7+Math.random()*0.6,[0.58,0.58,0.56]);
        if(p.load>1.2){p.acc+=dt;if(!p.warned){p.warned=1;toast('과타설! 설계하중 초과 — 슬래브가 버티지 못해요',2500)}
          if(p.acc>0.3){p.acc=0;const d=ensureDet(p.b);let top=-1;for(let f=d.F-1;f>=0;f--)if(d.fl[f]){top=f;break}
            if(top>=0){for(let j=0;j<d.C;j++)d.hp[top*d.C+j]-=0.35*p.load;d.dirty=true;const before=d.fl.reduce((a,v)=>a+v,0);detCheck(p.b);
              if(p.b.det&&p.b.det.fl.reduce((a,v)=>a+v,0)<before){p.floorsGone++;p.load=Math.max(1.2,p.load*0.8)}}
            if(p.floorsGone>=Math.max(3,Math.ceil((d.F||4)*0.5))||!p.b.alive){p.state='leave';p.t=0}}}}}
    else{p.boom=Math.max(0,p.boom-dt);p.x+=p.nx*9*dt;p.z+=p.nz*9*dt;if(p.t>4)POURS.splice(i,1)}}
}
function drawPour(m,p){
  const s=TOY*0.75,gy=groundAt(p.x,p.z),rot=Math.atan2(-p.nz,-p.nx),f=[-p.nx,-p.nz];
  const P=(a,y)=>[p.x+f[0]*a,gy+y,p.z+f[1]*a];
  let q=P(0,1.2*s);pushShape(m,CUBE,q[0],q[1],q[2],5.6*s,0.8*s,2.2*s,rot,[0.25,0.25,0.27],0);
  q=P(1.9*s,2.2*s);pushShape(m,CUBE,q[0],q[1],q[2],1.6*s,1.6*s,2.1*s,rot,[0.95,0.95,0.95],0);
  q=P(-0.8*s,2.6*s);pushShape(m,SPHERE,q[0],q[1],q[2],2.2*s,1.2*s,1.2*s,rot+p.t*2,[0.98,0.55,0.12],0);
  if(p.boom>0&&p.b.alive){const top=p.b.base+p.b.h,root=P(-0.4*s,3.6*s),end=[p.b.cx,top+12,p.b.cz];
    const mid=[(root[0]+end[0])/2,Math.max(root[1],end[1])+8*p.boom,(root[2]+end[2])/2];
    const k=p.boom;drawSeg(m,root,[root[0]+(mid[0]-root[0])*k,root[1]+(mid[1]-root[1])*k,root[2]+(mid[2]-root[2])*k],0.5*s,YEL);
    if(k>=1){drawSeg(m,mid,end,0.45*s,YEL_D);
      // 옥상에 쌓이는 콘크리트
      const r=clamp(Math.sqrt(p.b.area)*0.25*Math.min(1,p.load),1,Math.sqrt(p.b.area)*0.45);pushShape(m,SPHERE,p.b.cx,top+0.3,p.b.cz,r,Math.min(3,p.load*1.5)+0.3,r,0,[0.6,0.6,0.58],0)}}
}

// ---------- 시공 3. 다이너마이트 — 클릭해서 여러 곳에 붙이고, Space(기폭)로 한꺼번에 ----------
let CHARGES=[];
const MAX_CHARGES=12;
function floorAtY(b,y){const d=b.det;let f=0;for(let k=0;k<d.F;k++){if(!d.fl[k])continue;if(b.base+d.fy[k]<=y+0.3)f=k}return f}
function placeDynCity(h){
  const b=h.b||nearestBuilding(h.x,h.z,25);if(!b){toast('다이너마이트를 붙일 건물을 눌러주세요');return}
  if(CHARGES.length>=MAX_CHARGES){toast(`장약은 ${MAX_CHARGES}개까지 — Space 로 기폭!`);return}
  const d=ensureDet(b);const f=h.b?floorAtY(b,h.y):0;const fl=[f];if(f>0)fl.push(f-1);else if(d.F>1)fl.push(1);
  const cols=[];for(const ff of fl)for(let j=0;j<d.C;j++)if(d.hp[ff*d.C+j]>0)cols.push({f:ff,j});
  const p=h.b?[h.x,h.y,h.z]:(()=>{const q=facadePoint(b,h.x,h.z);return[q.x,b.base+1.5,q.z]})();
  CHARGES.push({kind:'city',b,f,fl,cols,x:p[0],y:p[1],z:p[2],t:0});
  sfx(3,0.15);updateDetBtn();
  toast(`다이너마이트 ${CHARGES.length}개 설치 (${floorName(f)}) — Space 또는 [기폭] 버튼`,1800);
}
function detonate(){
  if(stopOn()){stopNag();return}
  if(!CHARGES.length){toast('먼저 다이너마이트를 붙여주세요');return}
  if(MODE==='section')secPushUndo();else snapshot();
  const list=CHARGES;CHARGES=[];updateDetBtn();statTool('blast');
  floatText(list[0].x,list[0].y+8,list[0].z,'기폭!','count',0.8);sfx(4,0.3);
  list.forEach((c,i)=>later(0.25+i*0.16,()=>explodeCharge(c)));
}
function explodeCharge(c){
  if(c.kind==='sec'){secExplodeCharge(c);return}
  const b=c.b,x=c.x,y=c.y,z=c.z;
  if(b.alive&&b.det){const d=b.det;for(const {f,j} of c.cols)d.hp[f*d.C+j]=0;
    for(const f of c.fl)for(let j=0;j<d.M;j++)if(Math.random()<0.8)d.panel[f*d.M+j]=0;d.dirty=true;
    structDamage(b,x,y,z,16,4);if(b.det)detCheck(b)}
  forBuildingsNear(x,z,55,o=>{if(!o.alive||o===b||o.lifted)return;const dd=distToBuilding(o,x,z);if(dd>55)return;
    facadeStrip(o,x,z,0.7*(1-dd/55));if(dd<18){const P=facadePoint(o,x,z);if(P)structDamage(o,P.x,clamp(y,o.base+1,o.base+o.h-1),P.z,7,1.6*(1-dd/18))}});
  forTreesNear(x,z,28,t=>{if(t.alive&&Math.hypot(t.x-x,t.z-z)<28)killTree(t)});
  if(y<groundAt(x,z)+5){const v=carve(x,z,7,2.5);addScore(v*0.5)}
  addScore(3000);impact(x,y,z,1.4);floatText(x,y+6,z,'쾅!','boom',1.1);if(CLIENT)clientHitAt(x,y,z,16,4);
}
function drawCharges(m,mg){const on=Math.floor(performance.now()/160)%2;
  for(const c of CHARGES){
    if(c.kind==='city'){const d=c.b.det;if(!d||!c.b.alive)continue;
      c.cols.slice(0,30).forEach(({f,j},k)=>{const [cx,cz]=colPos(d,j);const y=c.b.base+d.fy[f]+1.3;
        pushShape(m,CUBE,cx,y,cz,0.95,1.5,0.95,k,[0.75,0.08,0.06],0);pushShape(m,CUBE,cx,y,cz,1.0,0.25,1.0,k,[0.15,0.15,0.15],0)})}
    else{const s=c.s||0.9;pushShape(m,CUBE,c.x,c.y,c.z,0.5*s,1.4*s,0.5*s,0,[0.8,0.08,0.06],0);pushShape(m,CUBE,c.x+0.35*s,c.y,c.z,0.5*s,1.4*s,0.5*s,0,[0.75,0.06,0.05],0);
      pushShape(m,CUBE,c.x+0.17*s,c.y,c.z,1.0*s,0.22*s,0.6*s,0,[0.12,0.12,0.12],0)}
    // 도화선 불꽃
    const fy=c.kind==='city'?c.y+2:c.y+0.9*(c.s||0.9);pushShape(mg,CUBE,c.x,fy,c.z,on?0.7:0.45,on?0.7:0.45,on?0.7:0.45,performance.now()/100,on?[1,0.9,0.3]:[1,0.4,0.1],1);
    if(Math.random()<0.3)spawn(c.x,fy,c.z,(Math.random()-.5)*2,2+Math.random()*2,(Math.random()-.5)*2,0.15,[1,0.75,0.2],0.3,1)}}
function updateDetBtn(){const el=$('#btnDet');if(!el)return;el.style.display=CHARGES.length?'':'none';el.querySelector('b').textContent=CHARGES.length}

// ---------- 설계 3. TRIM — 선을 그어 건물을 자르면 윗부분이 미끄러져 떨어짐 ----------
let SLICES=[], CUTFX=[];
function runTrimCity(sa,sb){
  const len=Math.hypot(sb.x-sa.x,sb.y-sa.y);if(len<30){cmdLine(['명령: TRIM','절단선을 건물을 가로질러 길게 그어주세요']);return false}
  const cross=(p,q,r,s)=>{const d=(q[0]-p[0])*(s[1]-r[1])-(q[1]-p[1])*(s[0]-r[0]);if(Math.abs(d)<1e-6)return null;
    const t=((r[0]-p[0])*(s[1]-r[1])-(r[1]-p[1])*(s[0]-r[0]))/d,u=((r[0]-p[0])*(q[1]-p[1])-(r[1]-p[1])*(q[0]-p[0]))/d;return t>=0&&t<=1&&u>=0&&u<=1?t:null};
  const A=[sa.x,sa.y],Bp=[sb.x,sb.y],hits=[];
  for(const b of B){if(!b.alive||b.lifted||b.h<4)continue;if(Math.hypot(b.cx-cam.tx,b.cz-cam.tz)>cam.dist*1.4)continue;
    const N=10;let prev=project(b.cx,b.base,b.cz);if(!prev)continue;
    for(let k=1;k<=N;k++){const y=b.base+b.h*k/N,q=project(b.cx,y,b.cz);if(!q)break;const t=cross(prev,q,A,Bp);
      if(t!=null){hits.push({b,y:b.base+b.h*(k-1+t)/N,dist:Math.hypot(b.cx-eye[0],b.cz-eye[2])});break}prev=q}}
  hits.sort((a,b)=>a.dist-b.dist);const sel=hits.slice(0,10);
  if(!sel.length){cmdLine(['명령: TRIM','자를 객체 선택: 0개 — 건물 가운데를 가로질러 그어주세요']);return false}
  // 미끄러지는 방향: 화면에서 선이 내려가는 쪽
  let sx=sb.x-sa.x,sy=sb.y-sa.y;if(sy<0){sx=-sx;sy=-sy}const slope=sy/(Math.abs(sx)+1e-6);
  const f=[cam.tx-eye[0],cam.tz-eye[2]],fl=Math.hypot(...f)||1;const right=[-f[1]/fl,f[0]/fl];
  const sg=slope<0.12?(Math.random()<0.5?1:-1):Math.sign(sx);
  for(const {b,y} of sel){let cut=y-b.base;if(b.h-cut<2.5)continue;if(cut<3)cut=0;
    const ob=obbOf(b),Hup=b.h-cut;
    SLICES.push({col:b.col,style:b.style,roof:b.roof,ob,H:Hup,x:b.cx+ob.ox,y:b.base+cut,z:b.cz+ob.oz,dir:[right[0]*sg,right[1]*sg],v:0,vy:0,tum:0,w:0,t:0,phase:'slide',src:b,mass:Math.sqrt(b.area*Hup)/20});
    CUTFX.push({b,y:b.base+cut,t:0.7});
    freeDet(b);addScore((b.area*Hup*0.3+1500)*nightK(b));
    if(cut<3){b.alive=false;b.h=0;markB(b);STATS.kills++;stopNote(b);firmsKilled(b)}else{b.h0=cut;b.h=cut;markB(b)}}
  for(let k=0;k<20;k++){const c=sel[Math.floor(Math.random()*sel.length)];spawn(c.b.cx+(Math.random()-.5)*Math.sqrt(c.b.area),c.y,c.b.cz+(Math.random()-.5)*Math.sqrt(c.b.area),(Math.random()-.5)*6,3,(Math.random()-.5)*6,0.35,[0.5,0.85,1],0.5,1)}
  sfx(14,0.5);hitStop(0.08);flashScreen(0.25,'#9fd8ff');statTool('trim');
  floatText(sel[0].b.cx,sel[0].y+6,sel[0].b.cz,'TRIM','cad',1.4);
  cmdLine(['명령: TRIM','절단 경계 선택: 선 1개',`자를 객체 선택: ${sel.length}개 — 윗부분이 미끄러져 떨어져요 · Ctrl+Z 되돌리기`]);
  return true;
}
function updateSlices(dt){
  for(let i=CUTFX.length-1;i>=0;i--){CUTFX[i].t-=dt;if(CUTFX[i].t<=0)CUTFX.splice(i,1)}
  for(let i=SLICES.length-1;i>=0;i--){const s=SLICES[i];s.t+=dt;
    if(s.phase==='slide'){s.v+=11*dt;s.vy=-2;s.w+=1.4*dt;if(s.t>0.45){s.phase='fall';s.vy=0}}
    else{s.vy-=32*dt;s.w=Math.max(s.w,0.9)}
    s.x+=s.dir[0]*s.v*dt;s.z+=s.dir[1]*s.v*dt;s.y+=s.vy*dt;s.tum+=s.w*dt;
    if(s.phase!=='fall')continue;
    let hit=s.y<=groundAt(s.x,s.z);
    if(!hit)forBuildingsNear(s.x,s.z,4,o=>{if(hit||!o.alive||o.lifted)return;if(o===s.src&&s.t<0.9)return;if(s.y<o.base+o.h&&pip(s.x,s.z,o.pts))hit=true});
    if(hit){SLICES.splice(i,1);impactSlice(s)}}
}
function impactSlice(s){
  const R=Math.max(s.ob.W,s.ob.D)/2+5,sp=Math.hypot(s.v,s.vy),pw=clamp(0.7+s.mass*sp/55,0.9,3.5);let n=0;
  forBuildingsNear(s.x,s.z,R+10,o=>{if(!o.alive||o.lifted)return;const d=distToBuilding(o,s.x,s.z);if(d>R)return;n++;
    structDamage(o,s.x,clamp(s.y,o.base+1,o.base+o.h-1),s.z,R*0.8,pw*(1-d/R*0.5))});
  const v=carve(s.x,s.z,R*0.5,1.5+s.mass*0.4);addScore(v*0.5+s.mass*800);
  chunkRain(s.x,Math.max(groundAt(s.x,s.z),s.y),s.z,Math.min(50,16+s.mass*3),Math.max(s.ob.W,s.ob.D)*0.6,s.col,10);
  boom3(s.x,Math.max(0,s.y),s.z,10+s.mass*2);impact(s.x,Math.max(groundAt(s.x,s.z),s.y)+1,s.z,Math.min(1.2,0.4+s.mass*0.15));
  if(n)toast(`잘린 윗부분이 ${n}채를 덮쳤어요!`,1500);
}
function drawSlices(m,mg){
  for(const s of SLICES){const ca=Math.cos(s.ob.ang),sa=Math.sin(s.ob.ang);let A=[ca,0,sa],N=[-sa,0,ca],U=[0,1,0];
    const ax=[s.dir[1],0,-s.dir[0]],c=Math.cos(s.tum),sn=Math.sin(s.tum);
    const rot=v=>{const d=v[0]*ax[0]+v[2]*ax[2];const cr=[ax[1]*v[2]-ax[2]*v[1],ax[2]*v[0]-ax[0]*v[2],ax[0]*v[1]-ax[1]*v[0]];return[v[0]*c+cr[0]*sn+ax[0]*d*(1-c),v[1]*c+cr[1]*sn,v[2]*c+cr[2]*sn+ax[2]*d*(1-c)]};
    A=rot(A);N=rot(N);U=rot(U);
    drawOBB(m,[s.x+U[0]*s.H/2,s.y+U[1]*s.H/2,s.z+U[2]*s.H/2],A,U,N,s.ob.W/2,s.H/2,s.ob.D/2,s.col,s.style,s.roof)}
  for(const f of CUTFX){const p=f.b.pts,y=f.y+0.2,a=f.t/0.7;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length],l=Math.hypot(q[0]-p[i][0],q[1]-p[i][1]),ang=Math.atan2(q[1]-p[i][1],q[0]-p[i][0]);
    pushShape(mg,CUBE,(p[i][0]+q[0])/2,y,(p[i][1]+q[1])/2,l+0.6,0.5*a+0.1,0.5*a+0.1,-ang,[0.55,0.85,1],1)}}
}


// =====================================================================
//  설계팀 도구 강화 — MOVE(잡아서 던지기) · EXTRUDE(무한 증축 → 쓰러짐)
//  TRIM(잘라서 윗부분 떨어뜨리기)
// =====================================================================
let HELD=null, THROWN=[], EXTR=[];

// ---------- 회전 상자 그리기 ----------
function obbOf(b){let best=0,ang=0;for(let i=0;i<b.pts.length;i++){const a=b.pts[i],c=b.pts[(i+1)%b.pts.length];const l=Math.hypot(c[0]-a[0],c[1]-a[1]);if(l>best){best=l;ang=Math.atan2(c[1]-a[1],c[0]-a[0])}}
  const c=Math.cos(ang),s=Math.sin(ang);let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
  for(const p of b.pts){const x=(p[0]-b.cx)*c+(p[1]-b.cz)*s,z=-(p[0]-b.cx)*s+(p[1]-b.cz)*c;x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z)}
  return{ox:(x0+x1)/2*c-(z0+z1)/2*s,oz:(x0+x1)/2*s+(z0+z1)/2*c,W:Math.max(2,x1-x0),D:Math.max(2,z1-z0),ang}}
// 중심 C, 단위축 A(가로)·U(세로)·N(깊이), 반길이 a·u·n
function drawOBB(m,C,A,U,N,a,u,n,col,style,roof){
  const P=(sa,su,sn)=>[C[0]+A[0]*a*sa+U[0]*u*su+N[0]*n*sn,C[1]+A[1]*a*sa+U[1]*u*su+N[1]*n*sn,C[2]+A[2]*a*sa+U[2]*u*su+N[2]*n*sn];
  const face=(p0,p1,p2,p3,nm,c,u0,u1,st)=>{m.grow(6);m.v(...p0,...nm,...c,u0,st);m.v(...p1,...nm,...c,u1,st);m.v(...p2,...nm,...c,u1,st);m.v(...p0,...nm,...c,u0,st);m.v(...p2,...nm,...c,u1,st);m.v(...p3,...nm,...c,u0,st)};
  const neg=v=>[-v[0],-v[1],-v[2]],cb=[col[0]*0.85,col[1]*0.85,col[2]*0.87],st=style==null?-1:style;
  face(P(-1,-1,1),P(1,-1,1),P(1,1,1),P(-1,1,1),N,col,0,2*a,st);face(P(1,-1,-1),P(-1,-1,-1),P(-1,1,-1),P(1,1,-1),neg(N),col,0,2*a,st);
  face(P(1,-1,1),P(1,-1,-1),P(1,1,-1),P(1,1,1),A,cb,0,2*n,st);face(P(-1,-1,-1),P(-1,-1,1),P(-1,1,1),P(-1,1,-1),neg(A),cb,0,2*n,st);
  face(P(-1,1,1),P(1,1,1),P(1,1,-1),P(-1,1,-1),U,roof||col,-1,-1,0);face(P(-1,-1,-1),P(1,-1,-1),P(1,-1,1),P(-1,-1,1),neg(U),cb,-1,-1,0);
}
function detach(b){freeDet(b);b.lifted=true;markB(b);b.ob=b.ob||obbOf(b)}
function finishBuilding(b,pts){stopNote(b);b.alive=false;b.lifted=false;b.h=0;markB(b);STATS.kills++;addScore(pts*nightK(b));firmsKilled(b)}
function chunkRain(x,y,z,n,s,col,spd){for(let k=0;k<n;k++)spawn(x+(Math.random()-.5)*s,y+Math.random()*s*0.5,z+(Math.random()-.5)*s,(Math.random()-.5)*spd,2+Math.random()*spd*0.6,(Math.random()-.5)*spd,1.2+Math.random()*2.2,Math.random()<0.4?CONC:col)}

// ---------- MOVE: 건물을 잡아 들어 올려 던지기 ----------
function rayGround(mx,my,y){const {o,d}=rayFrom(mx,my);if(Math.abs(d[1])<1e-4)return null;const t=(y-o[1])/d[1];if(t<0)return null;return[o[0]+d[0]*t,o[2]+d[2]*t]}
function startGrab(b,mx,my){
  if(b.area>9000){toast('너무 큰 건물은 못 들어요 (부지 9,000㎡ 이하)');return false}
  snapshot();detach(b);const g=rayGround(mx,my,0);
  HELD={b,x:b.cx+b.ob.ox,z:b.cz+b.ob.oz,y:b.base,tx:g?g[0]:b.cx,tz:g?g[1]:b.cz,vx:0,vz:0,lift:0,t:0};
  cmdLine(['명령: MOVE','객체 선택: 1개 찾음','이동할 위치를 지정하세요 — 놓으면 던져져요']);sfx(8);return true}
function moveGrab(mx,my){if(!HELD)return;const g=rayGround(mx,my,0);if(g){HELD.tx=g[0];HELD.tz=g[1]}}
function releaseGrab(){if(!HELD)return;const h=HELD;HELD=null;
  const sp=Math.hypot(h.vx,h.vz),k=sp>140?140/sp:1;
  THROWN.push({b:h.b,x:h.x,y:h.y,z:h.z,vx:h.vx*k*1.3,vz:h.vz*k*1.3,vy:6,tum:0,spin:2+sp*0.02});
  floatText(h.x,h.y+h.b.h0+4,h.z,'MOVE','cad',1.2);statTool('move')}
function updateGrab(dt){
  if(HELD){const h=HELD;h.t+=dt;h.lift=Math.min(1,h.lift+dt*1.8);const ty=groundAt(h.tx,h.tz)+12+h.b.h0*0.25;
    const k=Math.min(1,dt*7),nx=h.x+(h.tx-h.x)*k,nz=h.z+(h.tz-h.z)*k;
    h.vx=h.vx*0.7+((nx-h.x)/dt)*0.3;h.vz=h.vz*0.7+((nz-h.z)/dt)*0.3;h.x=nx;h.z=nz;h.y=h.b.base+(ty-h.b.base)*h.lift;
    if(Math.random()<0.15)spawn(h.x,h.y,h.z,(Math.random()-.5)*2,-2,(Math.random()-.5)*2,0.6+Math.random(),CONC)}
  for(let i=THROWN.length-1;i>=0;i--){const t=THROWN[i];t.vy-=32*dt;t.x+=t.vx*dt;t.y+=t.vy*dt;t.z+=t.vz*dt;t.tum+=t.spin*dt;
    let hit=t.y<=groundAt(t.x,t.z);
    if(!hit)forBuildingsNear(t.x,t.z,4,o=>{if(hit||!o.alive||o.lifted)return;if(t.y<o.base+o.h&&pip(t.x,t.z,o.pts))hit=true});
    if(hit){THROWN.splice(i,1);impactThrown(t)}}
}
function impactThrown(t){
  const b=t.b,ob=b.ob,R=Math.max(ob.W,ob.D)/2+6,sp=Math.hypot(t.vx,t.vy,t.vz),mass=Math.sqrt(b.area*b.h0)/20;
  const pw=clamp(0.6+mass*sp/60,0.8,3.5);let n=0;
  forBuildingsNear(t.x,t.z,R+10,o=>{if(!o.alive||o.lifted||o===b)return;const d=distToBuilding(o,t.x,t.z);if(d>R)return;n++;
    structDamage(o,t.x,clamp(t.y,o.base+1,o.base+o.h-1),t.z,R*0.8,pw*(1-d/R*0.5))});
  const v=carve(t.x,t.z,R*0.6,2+mass*0.5);addScore(v*0.5);
  chunkRain(t.x,Math.max(groundAt(t.x,t.z),t.y),t.z,Math.min(50,18+mass*3),Math.max(ob.W,ob.D)*0.6,b.col,10);
  boom3(t.x,Math.max(0,t.y),t.z,12+mass*2);cam.shake=Math.max(cam.shake,Math.min(10,3+mass*0.8));
  finishBuilding(b,b.area*b.h0*0.4+2000);toast(`던진 건물이 ${n?n+'채를 덮쳤어요':'떨어졌어요'}!`,1600);
}

// ---------- EXTRUDE: 끝없이 증축 → 자중 초과로 쓰러지며 주변을 덮침 ----------
function spawnExtrude(h){
  const b=h.b||nearestBuilding(h.x,h.z,20);if(!b){toast('증축할 건물을 눌러주세요');return}
  if(b.lifted)return;detach(b);
  const top=Math.min(300,Math.max(b.h0*2.4,b.h0+70));
  // 가장 많이 덮칠 수 있는 방향으로 쓰러짐
  let best=0,dir=[1,0];for(let k=0;k<12;k++){const a=k/12*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a);let s=0;
    for(let d=10;d<top;d+=12)forBuildingsNear(b.cx+dx*d,b.cz+dz*d,6,o=>{if(o.alive&&o!==b)s+=o.h0});if(s>best){best=s;dir=[dx,dz]}}
  EXTR.push({b,h:b.h,top,dir,th:0,w:0,phase:'grow',lastF:Math.floor(b.h/3.4)});
  cmdLine(['명령: EXTRUDE','돌출 높이 지정: '+Math.round(top)+'m','용적률 검토: 초과 ⚠']);sfx(10);statTool('extrude');
}
function updateExtrude(dt){
  for(let i=EXTR.length-1;i>=0;i--){const e=EXTR[i],b=e.b;
    if(e.phase==='grow'){e.h=Math.min(e.top,e.h+(14+e.h*0.25)*dt);const f=Math.floor(e.h/3.4);
      if(f>e.lastF){e.lastF=f;addScore(150);if(f%5===0)floatText(b.cx,b.base+e.h+3,b.cz,`+${f}층`,'cad',0.8);sfx(2)}
      if(e.h>=e.top){e.phase='sway';e.t=0;toast('용적률 초과! 자중을 못 버티고 기울어요…',2200)}}
    else if(e.phase==='sway'){e.t+=dt;e.th=Math.sin(e.t*9)*0.015*e.t;cam.shake=Math.max(cam.shake,1);if(e.t>1.2){e.phase='fall';e.th=0.04;e.w=0.05}}
    else{const H=e.h;e.w+=(3*32/(2*H))*Math.sin(e.th)*dt;e.th+=e.w*dt;
      // 쓰러지는 동안 지나가는 건물 윗부분을 긁음
      const L=H*Math.sin(e.th),tipY=b.base+H*Math.cos(e.th);
      forBuildingsNear(b.cx+e.dir[0]*L,b.cz+e.dir[1]*L,8,o=>{if(o.alive&&!o.lifted&&o!==b&&o.base+o.h>tipY)structDamage(o,b.cx+e.dir[0]*L,o.base+o.h-1,b.cz+e.dir[1]*L,6,0.6)});
      if(e.th>=Math.PI/2*0.97){EXTR.splice(i,1);impactExtrude(e)}}}
}
function impactExtrude(e){
  const b=e.b,ob=b.ob,W=Math.max(ob.W,ob.D),pw=clamp(1+e.h/90,1.2,3);let n=0,hitB=new Set();
  for(let d=4;d<e.h;d+=5){const x=b.cx+e.dir[0]*d,z=b.cz+e.dir[1]*d;
    forBuildingsNear(x,z,W/2+4,o=>{if(!o.alive||o.lifted||o===b)return;if(distToBuilding(o,x,z)>W/2+2)return;if(!hitB.has(o)){hitB.add(o);n++}
      structDamage(o,x,o.base+Math.min(o.h-1,4),z,W*0.45+2,pw)});
    if(d%10<5){carve(x,z,W*0.35,1.5);chunkRain(x,groundAt(x,z)+2,z,4,W*0.6,b.col,8)}}
  forTreesNear(b.cx+e.dir[0]*e.h/2,b.cz+e.dir[1]*e.h/2,e.h/2,t=>{if(t.alive)killTree(t)});
  boom3(b.cx+e.dir[0]*e.h*0.6,2,b.cz+e.dir[1]*e.h*0.6,30);cam.shake=12;sfx(45,2.4);
  finishBuilding(b,e.h*b.area*0.3+5000);toast(`EXTRUDE 자중 붕괴! ${n}채를 덮쳤어요`,2200);
}

function updateDesign(dt){updateGrab(dt);updateExtrude(dt);updateSlices(dt)}
function drawDesign(m,mg){
  const draw=(b,x,y,z,tum,dirx,dirz)=>{const ob=b.ob,ca=Math.cos(ob.ang),sa=Math.sin(ob.ang);let A=[ca,0,sa],N=[-sa,0,ca],U=[0,1,0];
    let rot=v=>v;if(tum){const ax=[dirz,0,-dirx],c=Math.cos(tum),s=Math.sin(tum);rot=v=>{const d=v[0]*ax[0]+v[2]*ax[2];const cr=[ax[1]*v[2]-ax[2]*v[1],ax[2]*v[0]-ax[0]*v[2],ax[0]*v[1]-ax[1]*v[0]];
        return[v[0]*c+cr[0]*s+ax[0]*d*(1-c),v[1]*c+cr[1]*s,v[2]*c+cr[2]*s+ax[2]*d*(1-c)]};A=rot(A);N=rot(N);U=rot(U)}
    return{A,U,N,rot}};
  if(HELD){const h=HELD,b=h.b,f=draw(b,0,0,0);drawOBB(m,[h.x,h.y+b.h0/2,h.z],f.A,f.U,f.N,b.ob.W/2,b.h0/2,b.ob.D/2,b.col,b.style,b.roof);
    const gy=groundAt(h.x,h.z)+0.4;pushShape(mg,CUBE,h.x,gy,h.z,b.ob.W*1.05,0.15,b.ob.D*1.05,-b.ob.ang,[0.25,0.55,1],1)}
  for(const t of THROWN){const b=t.b,sp=Math.hypot(t.vx,t.vz)||1,f=draw(b,0,0,0,t.tum,t.vx/sp,t.vz/sp);drawOBB(m,[t.x+f.U[0]*b.h0/2,t.y+f.U[1]*b.h0/2,t.z+f.U[2]*b.h0/2],f.A,f.U,f.N,b.ob.W/2,b.h0/2,b.ob.D/2,b.col,b.style,b.roof)}
  for(const e of EXTR){const b=e.b,f=draw(b,0,0,0,e.th,e.dir[0],e.dir[1]);const H=e.h;
    // 쓰러지는 축(밑변 모서리)을 기준으로 회전
    const ca=Math.cos(b.ob.ang),sa=Math.sin(b.ob.ang),ext=Math.abs(e.dir[0]*ca+e.dir[1]*sa)*b.ob.W/2+Math.abs(-e.dir[0]*sa+e.dir[1]*ca)*b.ob.D/2;
    const piv=[b.cx+b.ob.ox+e.dir[0]*ext,b.base,b.cz+b.ob.oz+e.dir[1]*ext],back=f.rot([-e.dir[0]*ext,0,-e.dir[1]*ext]);
    drawOBB(m,[piv[0]+back[0]+f.U[0]*H/2,piv[1]+back[1]+f.U[1]*H/2,piv[2]+back[2]+f.U[2]*H/2],f.A,f.U,f.N,b.ob.W/2,H/2,b.ob.D/2,b.col,b.style,b.roof)}
  drawSlices(m,mg);
}
function clearDesign(){if(HELD)HELD.b.lifted=false;HELD=null;for(const t of THROWN)t.b.lifted=false;for(const e of EXTR)e.b.lifted=false;THROWN=[];EXTR=[];SLICES=[];CUTFX=[]}

// ---------- 필살기 게이지 ----------
function chargeUlt(v){if(v>0&&!ultArmed){ULT=Math.min(1,ULT+v/150000);}}
function updateUltUI(){const el=$('#ult');if(!el)return;el.style.setProperty('--p',(ULT*100).toFixed(1)+'%');el.classList.toggle('ready',ULT>=1);el.classList.toggle('armed',ultArmed)}
function armUlt(){if(stopOn()){stopNag();return}if(ULT<1){toast(`필살기 게이지 ${Math.floor(ULT*100)}% — 더 부수면 차올라요`);return}ultArmed=!ultArmed;
  $('#hint').textContent=ultArmed?'클릭: 클라이언트 전화 — "그냥 전부 다시 해와요"':'';if(ultArmed)toast('필살기 준비! 부술 곳을 클릭하세요',1800)}

// =====================================================================
//  공통 타격감 — 히트스톱(순간 멈춤) · 섬광 · 충격파 링 · 불덩이 · 저음 폭발음 · 예약 실행
// =====================================================================
let HSTOP=0, RINGS=[], LATER=[], BALLS=[];
function hitStop(s){HSTOP=Math.max(HSTOP,s)}
function flashScreen(a,col){const f=$('#flash');if(!f)return;f.style.background=col||'#fff';f.style.transition='none';f.style.opacity=a;requestAnimationFrame(()=>requestAnimationFrame(()=>{f.style.transition='opacity 0.9s';f.style.opacity=0}))}
function later(t,fn){LATER.push({t,fn,mode:MODE})}
function updateLater(dt){for(let i=LATER.length-1;i>=0;i--){const L=LATER[i];if(L.mode!==MODE){LATER.splice(i,1);continue}L.t-=dt;if(L.t<=0){LATER.splice(i,1);try{L.fn()}catch(e){console.error(e)}}}}
function ring(x,y,z,max,col){RINGS.push({x,y,z,r:1,max,col:col||[1,0.88,0.65]})}
function updateRings(dt){for(let i=BALLS.length-1;i>=0;i--){BALLS[i].t+=dt;if(BALLS[i].t>BALLS[i].dur)BALLS.splice(i,1)}for(let i=RINGS.length-1;i>=0;i--){const r=RINGS[i];r.r+=Math.max(25,r.max*1.6)*dt;if(r.r>r.max)RINGS.splice(i,1)}}
function clearFx(){RINGS=[];LATER=[];BALLS=[];HSTOP=0}
function drawFxCommon(m,mg){
  for(const b of BALLS){const u=b.t/b.dur,r=b.max*(u<0.25?u/0.25:1-(u-0.25)/0.75*0.6),c=u<0.3?[1,0.95,0.7]:[1,0.55-u*0.3,0.12];
    pushShape(mg,SPHERE,b.x,b.y+r*0.3,b.z,r,r*0.85,r,0,c,1);pushShape(mg,SPHERE,b.x,b.y+r*0.6,b.z,r*0.6,r*0.6,r*0.6,0,[1,1,0.85],1)}
  for(const r of RINGS){const n=56,t=1-r.r/r.max,w=(0.6+r.max*0.035)*t+0.15;
    for(let k=0;k<n;k++){const a=k/n*Math.PI*2;pushShape(mg,CUBE,r.x+Math.cos(a)*r.r,r.y,r.z+Math.sin(a)*r.r,w*1.6,w*0.6,w*1.6,a,r.col,1)}}
}
function fireball(x,y,z,size){
  const n=Math.min(110,Math.floor(size*7));
  for(let k=0;k<n;k++){const a=Math.random()*Math.PI*2,e=Math.random()*Math.PI-Math.PI/2,sp=size*(0.4+Math.random()*1.1);
    const vx=Math.cos(a)*Math.cos(e)*sp,vz=Math.sin(a)*Math.cos(e)*sp,vy=Math.abs(Math.sin(e))*sp*0.8+size*0.4;
    const r=Math.random();const c=r<0.35?[1,0.95,0.6]:r<0.7?[1,0.6,0.15]:[0.95,0.3,0.08];
    spawn(x,y,z,vx,vy,vz,size*(0.08+Math.random()*0.18),c,0.35+Math.random()*0.6,r<0.5?2:1)}
  later(0.18,()=>{for(let k=0;k<Math.min(28,size*2);k++)spawn(x+(Math.random()-.5)*size,y+Math.random()*size*0.5,z+(Math.random()-.5)*size,(Math.random()-.5)*size*0.5,size*0.25+Math.random()*size*0.35,(Math.random()-.5)*size*0.5,size*(0.1+Math.random()*0.12),[0.6,0.58,0.55],1.0+Math.random()*1.0,2)})
}
// p: 0.3(작음) ~ 2(아주 큼)
function impact(x,y,z,p){
  const sec=MODE==='section';
  hitStop(0.04+0.06*p);flashScreen(Math.min(0.9,0.2+0.35*p),p>1?'#fff6e0':'#fff');
  cam.shake=Math.max(cam.shake,sec?2+p*3:4+p*6);
  ring(x,(sec?Math.max(0.3,y):y)+0.4,z,sec?8+p*12:25+p*45);
  fireball(x,y,z,sec?4.5+p*4:6+p*7);BALLS.push({x,y,z,t:0,dur:0.45+p*0.15,max:sec?1.8+p*1.6:5+p*5});sfxBoom(p);
}
function sfxBoom(p){if(!AC||!opts.sound)return;try{const t=AC.currentTime,len=0.5+p*0.5;
  const o=AC.createOscillator();o.type='sine';o.frequency.setValueAtTime(95+p*20,t);o.frequency.exponentialRampToValueAtTime(28,t+len);
  const g=AC.createGain();g.gain.setValueAtTime(Math.min(0.9,0.35+p*0.3),t);g.gain.exponentialRampToValueAtTime(0.001,t+len);o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+len)}catch(e){}
  sfx(18+p*18,0.4+p*0.6)}

// ---------- 선 긋기 (쇠공 · TRIM · 불도저) — 클릭으로 시작점 → 다시 클릭으로 끝점 ----------
// 드래그는 항상 화면 회전이라 마우스 조작이 겹치지 않음. Esc · 우클릭 · 같은 곳 다시 클릭 = 취소
let gesture=null;
const GKIND={crane:'쇠공',trim:'TRIM',dozer:'불도저',sink:'싱크홀'};
function gestureStart(mx,my){const id=WEAPONS[weapon].id;
  if(id==='sink'&&sinkLeft()>0){toast(`싱크홀 재충전 중 — ${Math.ceil(sinkLeft())}초 남았어요`,1400);return false}
  if(MODE==='section'){const p=secPlane(mx,my);if(!p||Math.abs(p.x)>SEC.W/2+30||p.y>secTop()+35||p.y<SEC.st[0].y0-3)return false;gesture={kind:id,A:p,cur:{x:mx,y:my}}}
  else{const h=pick(mx,my);if(!h)return false;gesture={kind:id,A:{x:h.x,y:h.y,z:h.z},wa:h,cur:{x:mx,y:my}}}
  $('#hint').textContent=`${GKIND[id]}: 끝점을 클릭하세요 · 드래그로 화면을 돌려도 시작점은 그대로예요 · Esc/우클릭 취소`;sfx(2,0.08);return true}
function gestureCancel(){if(!gesture)return;gesture=null;drawGesture();selectWeapon(weapon)}
function drawGesture(){const svg=$('#gest');if(!svg)return;
  if(!gesture){svg.style.display='none';return}
  const a=project(gesture.A.x,gesture.A.y,gesture.A.z);if(!a){svg.style.display='none';return}
  const b=gesture.cur,l=svg.querySelector('line'),c=svg.querySelector('circle');
  svg.style.display='';l.setAttribute('x1',a[0]);l.setAttribute('y1',a[1]);l.setAttribute('x2',b.x);l.setAttribute('y2',b.y);
  if(c){c.setAttribute('cx',a[0]);c.setAttribute('cy',a[1])}
  svg.setAttribute('class',gesture.kind)}
function gestureEnd(mx,my){const g=gesture;gesture=null;drawGesture();selectWeapon(weapon);if(!g)return;
  const A=g.A,sa=project(A.x,A.y,A.z);if(!sa)return;
  if(Math.hypot(mx-sa[0],my-sa[1])<12){toast('같은 곳을 눌러 취소했어요',1000);return}
  if(MODE==='section'){const Bq=secPlane(mx,my);if(!Bq)return;secPushUndo();
    if(g.kind==='trim')secTrim(A,Bq);else if(g.kind==='dozer')secDozerLine(A,Bq);else secCraneLine(A,Bq);bossTool(g.kind,A.x,A.z);return}
  if(g.kind==='trim'){snapshot();runTrimCity({x:sa[0],y:sa[1]},{x:mx,y:my});bossTool('trim',A.x,A.z);return}
  if(g.kind==='dozer'){let hb=pick(mx,my);if(!hb){const q=rayGround(mx,my,groundAt(A.x,A.z));if(q)hb={x:q[0],z:q[1]}}if(!hb)return;
    snapshot();spawnDozerLine({x:A.x,z:A.z},{x:hb.x,z:hb.z});bossTool('dozer',A.x,A.z);return}
  // 쇠공: 끝점은 시작점과 같은 깊이(화면과 나란한 면)에 둬서, 화면에 그은 선 그대로 휘두름
  const {o,d}=rayFrom(mx,my);let f=[cam.tx-eye[0],cam.ty-eye[1],cam.tz-eye[2]];const fl=Math.hypot(...f);f=f.map(v=>v/fl);
  const dn=d[0]*f[0]+d[1]*f[1]+d[2]*f[2];if(Math.abs(dn)<1e-4)return;const t=((A.x-o[0])*f[0]+(A.y-o[1])*f[1]+(A.z-o[2])*f[2])/dn;
  const hb={x:o[0]+d[0]*t,y:o[1]+d[1]*t,z:o[2]+d[2]*t};hb.y=Math.max(hb.y,groundAt(hb.x,hb.z)+1.5);
  const ins=2.5;hb.x+=f[0]*ins;hb.z+=f[2]*ins;
  snapshot();spawnCraneLine({x:A.x+f[0]*ins,y:Math.max(A.y,groundAt(A.x,A.z)+1.5),z:A.z+f[2]*ins},hb);bossTool('crane',A.x,A.z)}

function updateTools2(dt){updatePours(dt);updateFloats(dt);updateDesign(dt);updateSinks(dt)}
// ---------- 싱크홀 (0번) — 누른 곳 일대 지반이 약해져 몇 초 동안 무작위로 땅이 여러 번 꺼짐. 재사용 대기 없음 ----------
const SINK_COOL=0.8;let SINK_UNTIL=0,SINKS=[];   // 재사용 대기 없음 (연타 실수 방지 0.8초만)
function sinkLeft(){return Math.max(0,(SINK_UNTIL-performance.now())/1000)}
function sinkReady(){if(sinkLeft()>0)return false;SINK_UNTIL=performance.now()+SINK_COOL*1000;statTool('sink');return true}
// 동네: 탭한 곳 반경 약 50m 안에 6~9개 구멍이 0.3초 간격으로 무작위로 꺼짐
function sinkStorm(h){if(!sinkReady())return;const x0=h.x,z0=h.z,RA=50,n=6+Math.floor(Math.random()*4);
  toast('지반 약화! 일대 땅이 무작위로 꺼져요',1600);floatText(x0,groundAt(x0,z0)+10,z0,'지반 약화!','boom',1.4);sfx(25,1.6);comboHit(1);
  for(let k=0;k<n;k++){const a=Math.random()*Math.PI*2,r=k===0?0:RA*(0.25+Math.random()*0.75),x=x0+Math.cos(a)*r,z=z0+Math.sin(a)*r,R=7+Math.random()*10,t=0.15+k*0.3+Math.random()*0.15;
    SINKS.push({x,z,R,t:-t,pre:true});later(t,()=>sinkHole(x,z,R))}}
function sinkHole(x,z,R){const g0=groundAt(x,z);const v=carve(x,z,R,6+R*0.35);addScore(v*0.4);
  forBuildingsNear(x,z,R+30,b=>{if(!b.alive||b.lifted)return;if(distToBuilding(b,x,z)>R)return;
    if(b.area<90&&b.h0<9){killBuilding(b);return}
    const inside=pip(x,z,b.pts)||Math.hypot(b.cx-x,b.cz-z)<R*0.85,d=ensureDet(b),nf=inside?Math.min(d.F,3):1;
    for(let f=0;f<nf;f++){for(let j=0;j<d.C;j++){const [cx,cz]=colPos(d,j);if(inside||Math.hypot(cx-x,cz-z)<R)d.hp[f*d.C+j]=0}for(let j=0;j<d.M;j++)if(Math.random()<0.6)d.panel[f*d.M+j]=0}
    d.dirty=true;addScore(2000*nightK(b));detCheck(b)});
  forTreesNear(x,z,R,t=>{if(t.alive&&Math.hypot(t.x-x,t.z-z)<R)killTree(t)});
  if(CLIENT)clientHitAt(x,g0+2,z,R,5);
  SINKS.push({x,z,R,t:0});sfxBoom(0.7);hitStop(0.03);cam.shake=Math.max(cam.shake,4);comboHit(1);floatText(x,g0+5,z,'쿵!','boom',0.7)}
function updateSinks(dt){if(MODE!=='city'){SINKS=[];return}for(let i=SINKS.length-1;i>=0;i--){const s=SINKS[i];s.t+=dt;
  if(s.pre){if(s.t>=0){SINKS.splice(i,1);continue}   // 꺼지기 직전: 금 가는 먼지
    if(Math.random()<0.5){const a=Math.random()*Math.PI*2,r=s.R*Math.random(),px=s.x+Math.cos(a)*r,pz=s.z+Math.sin(a)*r;spawn(px,groundAt(px,pz)+0.5,pz,0,2,0,0.5,[0.6,0.56,0.5],0.8,3)}continue}
  if(s.t>1.4){SINKS.splice(i,1);continue}
  for(let k=0;k<2;k++){const a=Math.random()*Math.PI*2,r=s.R*(0.8+Math.random()*0.3),px=s.x+Math.cos(a)*r,pz=s.z+Math.sin(a)*r,g=groundAt(px,pz);
    spawn(px,g+1,pz,(s.x-px)*1.1,-1,(s.z-pz)*1.1,0.8+Math.random()*1.4,Math.random()<0.5?[0.45,0.4,0.34]:[0.58,0.55,0.5])}}}
// 단면: 누른 위치 주변 지하·1층에서 3~4번 무작위로 꺼짐
function secSinkStorm(h){if(!sinkReady())return;const n=3+Math.floor(Math.random()*2);toast('지반 약화! 지하·1층이 무작위로 꺼져요',1600);sfx(25,1.6);
  for(let k=0;k<n;k++){const c=clamp(h.x+(Math.random()-.5)*SEC.W*0.8,-SEC.W/2,SEC.W/2),w=4+Math.random()*5;later(0.2+k*0.35,()=>{if(SEC)secSinkRange(c-w/2,c+w/2)})}}
function secSinkRange(x0,x1){SEC_BATCH=true;
  for(const e of SEC.els){if(!e.alive||e.hp0>=1e8||e.k>0)continue;const b=elWorld(e);if(b[3]<x0||b[0]>x1)continue;secDestroy(e,true)}
  for(const e of SEC.els){if(!e.alive||e.k!==1||(e.kind!=='col'&&e.kind!=='core'))continue;const b=elWorld(e);if(b[3]<x0||b[0]>x1)continue;if(Math.random()<0.5)secDestroy(e,true)}
  SEC_BATCH=false;secBoom((x0+x1)/2,1,SEC.D*0.3,20);secDirty=true;secCheck();comboHit(1);floatText((x0+x1)/2,4,SEC.D/2,'쿵!','boom',0.8)}
setInterval(()=>{const b=document.querySelector('.tool[data-w="9"]');if(!b)return;const l=Math.ceil(sinkLeft());const t=SINK_COOL>2&&l>0?String(l):'';if(b.dataset.cd!==t){b.dataset.cd=t;b.classList.toggle('cool',l>0)}},300);
function drawTools2(m,mg){drawDesign(m,mg);for(const p of POURS)drawPour(m,p);drawCharges(m,mg)}
function clearTools2(){clearDesign();POURS=[];CHARGES=[];FLOATS=[];gesture=null;clearFx();updateDetBtn();$('#marks').innerHTML=''}

// ---------- 낙하물 & 효과 ----------
let FALL=[], beam=null, shock=null, quake=null;
function boom(x,z,size){
  const n=Math.min(80,Math.floor(size*3));
  for(let k=0;k<n;k++){const a=Math.random()*Math.PI*2,s=Math.random()*size*0.8;
    spawn(x+Math.cos(a)*s*0.3,groundAt(x,z)+2,z+Math.sin(a)*s*0.3,Math.cos(a)*s,10+Math.random()*size,Math.sin(a)*s,1.5+Math.random()*size*0.12,Math.random()<0.5?[1,0.62,0.2]:[1,0.85,0.4],0.5+Math.random()*0.6,1)}
  sfx(size);
}

// ---------- 무기 ----------
// hold: 동네 모드 조작(없으면 클릭), shold: 단면 모드 조작
let weapon=0;
const WEAPONS=[
  // 시공팀
  {id:'crew',team:'시공',name:'철거반',fire(h){spawnCrew(h)}},
  {id:'dozer',team:'시공',name:'불도저',hold:'line',shold:'line'},
  {id:'crane',team:'시공',name:'쇠공',hold:'line',shold:'line'},
  {id:'pour',team:'시공',name:'레미콘',fire(h){spawnPour(h)}},
  {id:'blast',team:'시공',name:'다이너마이트',fire(h){placeDynCity(h)},nosnap:true},
  {id:'rebar',team:'시공',name:'철근 빼기',fire(h){spawnRebar(h)}},
  // 설계팀
  {id:'move',team:'설계',name:'MOVE',hold:'grab',shold:'sgrab'},
  {id:'extrude',team:'설계',name:'EXTRUDE',fire(h){spawnExtrude(h)},shold:'sext'},
  {id:'trim',team:'설계',name:'TRIM',hold:'line',shold:'line'},
  {id:'sink',team:'설계',name:'싱크홀',fire(h){sinkStorm(h)},nosnap:false},
];
function holdOf(){const w=WEAPONS[weapon];return MODE==='section'?(w.shold||null):(w.hold||null)}
const ULTIMATE={id:'nuke',name:'전부 다시',fire({x,z}){
    const f=$('#flash');f.style.transition='none';f.style.opacity=1;requestAnimationFrame(()=>{f.style.transition='opacity 1.6s';f.style.opacity=0});
    const v=carve(x,z,80,40);addScore(v*0.6);
    forBuildingsNear(x,z,100,b=>{if(b.alive&&distToBuilding(b,x,z)<70)killBuilding(b)});
    forTreesNear(x,z,90,t=>{if(Math.hypot(t.x-x,t.z-z)<90)killTree(t)});
    shock={x,z,r:20,max:420,id:Math.random()};boom(x,z,60);boom(x,z,45);
    for(let k=0;k<90;k++){spawn(x+(Math.random()-.5)*30,groundAt(x,z)+5,z+(Math.random()-.5)*30,(Math.random()-.5)*26,25+Math.random()*50,(Math.random()-.5)*26,3+Math.random()*5,[1,0.5+Math.random()*0.3,0.15],1.2+Math.random()*1.2,2)}
    cam.shake=14;toast('클라이언트: "그냥 전부 다시 해와요"')}};
const HINTS=['클릭: 철거반 인부떼 — 수십 명이 외벽을 타고 올라가 층마다 동시에 오함마질','클릭 → 클릭으로 선 긋기: 불도저 — 그 방향으로 밀고 가며 경로의 건물 저층에 구멍을 뚫어요','클릭 → 클릭으로 선 긋기: 쇠공 — 그은 선을 따라 휘두르고 되돌아오며 한 번 더','클릭: 레미콘 과타설 — 옥상에 콘크리트를 부어 과하중 붕괴','클릭: 다이너마이트 설치(최대 12개, 누른 층) → Space 또는 [기폭]으로 연쇄 폭파','클릭: 철근 빼기 — 순살 구조가 스스로 무너짐','건물을 잡고 끌어서 놓기: MOVE — 들어 올려 던지면 떨어진 곳을 덮쳐요','클릭: EXTRUDE — 무한 증축 → 용적률 초과로 쓰러지며 옆 건물들을 덮침','클릭 → 클릭으로 건물을 가로질러 선 긋기: TRIM — 잘린 윗부분이 미끄러져 떨어짐','클릭: 싱크홀 — 누른 곳 일대 지반이 약해져 몇 초 동안 무작위로 땅이 여러 번 꺼져요'];
const SHINTS=['클릭: 철거반 인부떼 — 외벽을 타고 각 층으로 올라가 기둥을 오함마로','클릭 → 클릭으로 좌우 선 긋기: 불도저 — 시작한 층 바닥을 따라 밀고 가며 터널','클릭 → 클릭으로 선 긋기: 쇠공 — 그은 선을 따라 휘둘러 지나간 자리를 쓸어버림','클릭: 레미콘 — 옥상에 타설, 위층부터 내려앉음','클릭: 다이너마이트 붙이기(최대 12개) → Space 또는 [기폭]으로 연쇄 폭파','클릭: 철근 빼기 (기둥이 서서히 약해짐)','층을 잡고 끌어서 던지기: MOVE — 빼낸 층은 위층이 내려앉고, 던진 층은 떨어진 곳을 부숴요','누른 채 위로 끌기: EXTRUDE — 끈 만큼 증축, 놓으면 하중 초과로 아래층부터 무너짐','클릭 → 클릭으로 선 긋기: TRIM — 선 위쪽이 잘려 미끄러져 떨어짐','클릭: 싱크홀 — 누른 곳 주변 지하·1층이 무작위로 여러 번 꺼지며 위층이 내려앉아요'];
function selectWeapon(i){if(i<0||i>=WEAPONS.length)return;if(gesture&&i!==weapon){gesture=null;drawGesture()}weapon=i;pickHQ=false;document.querySelectorAll('.tool[data-w]').forEach(b=>b.classList.toggle('on',+b.dataset.w===i));
  flashHint();
  if(TOUCH){const hd=holdOf();let t=(MODE==='section'?SHINTS:HINTS)[i].replace(/클릭/g,'탭').replace(/Space 또는 /g,'');
    if(hd==='grab'||hd==='sgrab'||hd==='sext')t='꾹 눌렀다가 끌기 · '+t;
    $('#hint').textContent=t+' · 한 손가락: 회전 · 두 손가락: 이동·확대';return}
  if(MODE==='section'){$('#hint').textContent=SHINTS[i]+' · 빈 곳 드래그: 회전 · 휠: 확대';return}
  $('#hint').textContent=HINTS[i]+' · WASD 이동 · 빈 곳 드래그 회전 · 휠 확대'}
function flashHint(){const h=$('#hint');if(!h)return;h.classList.add('flash');clearTimeout(flashHint._t);flashHint._t=setTimeout(()=>h.classList.remove('flash'),4500)}

// ---------- 레이 피킹 ----------
function pick(mx,my){
  const {o,d}=rayFrom(mx,my);
  let t0=0,t1=8000;
  const C=[cam.tx,0,cam.tz];for(let a=0;a<3;a++){const lo=a===1?FLOOR_Y-5:C[a]-1800,hi=a===1?400:C[a]+1800;if(Math.abs(d[a])<1e-6){if(o[a]<lo||o[a]>hi)return null;continue}
    let ta=(lo-o[a])/d[a],tb=(hi-o[a])/d[a];if(ta>tb)[ta,tb]=[tb,ta];t0=Math.max(t0,ta);t1=Math.min(t1,tb)}
  if(t0>t1)return null;
  for(let t=t0;t<=t1;t+=1.5){
    const x=o[0]+d[0]*t,y=o[1]+d[1]*t,z=o[2]+d[2]*t;
    let hitB=null;
    forBuildingsNear(x,z,1,b=>{if(!hitB&&b.alive&&!b.lifted&&y<=b.base+b.h+1&&y>=b.base-2&&x>=b.bb[0]&&x<=b.bb[2]&&z>=b.bb[1]&&z<=b.bb[3]&&pip(x,z,b.pts))hitB=b});
    if(hitB)return{x,y,z,b:hitB};
    if(y<=groundAt(x,z))return{x,y:groundAt(x,z),z};
  }
  return null;
}

// ---------- 되돌리기 / 전부 복구 ----------
const UNDO=[];let BASE=null;
function takeState(){const chunks=new Map();for(const c of CHUNKS.values())if(c.Hg)chunks.set(c.k,{H:c.Hg.slice(),VD:c.VD.slice()});return{chunks,h:B.map(b=>b.h),h0:B.map(b=>b.h0),a:B.map(b=>b.alive),det:B.map(detSnap),t:T.map(t=>t.alive),score,maxDepth,boss:BOSS?{bi:B.indexOf(BOSS.b),flees:BOSS.flees,state:BOSS.state==='caught'?'caught':'idle',firm:BOSS.firm,vis:[...BOSS.visited].map(x=>B.indexOf(x)),x:BOSS.x,y:BOSS.y,z:BOSS.z}:null}}
function snapshot(){UNDO.push(takeState());if(UNDO.length>15)UNDO.shift();$('#btnUndo').disabled=false;$('#btnReset').disabled=false}
function restore(s){clientReset();for(const [k,v] of s.chunks){const c=CHUNKS.get(k);if(c&&c.Hg){c.Hg.set(v.H);c.VD.set(v.VD)}}clearTools();
  B.forEach((b,i)=>{b.lifted=false;if(b.colPre){b.col=b.colPre;b.colPre=null}if(i>=s.h.length)return;if(s.h0)b.h0=s.h0[i];b.h=s.h[i];b.alive=s.a[i];if(s.det)detRestore(b,s.a[i]?s.det[i]:null)});T.forEach((t,i)=>{if(i<s.t.length)t.alive=s.t[i]});score=s.score;maxDepth=s.maxDepth;
  D.used.fill(0);D.rest.fill(0);FALL=[];beam=null;firing=false;humStop();shock=null;quake=null;cam.shake=0;
  if(BOSS&&s.boss&&B[s.boss.bi]){const k=s.boss;Object.assign(BOSS,{b:B[k.bi],flees:k.flees,state:k.state,firm:k.firm,x:k.x,y:k.y,z:k.z,jump:null,visited:new Set(k.vis.map(i=>B[i]).filter(Boolean)),textT:0});CAMGO=null}
  groundDirty=true;bldDirty=true;rubDirty=true;treeDirty=true;updateHUD()}
$('#btnUndo').onclick=()=>{if(MODE==='section'){const v=SUNDO.pop();if(v)secRestore(v);$('#btnUndo').disabled=!SUNDO.length;return}const s=UNDO.pop();if(s)restore(s);$('#btnUndo').disabled=!UNDO.length};
$('#btnReset').onclick=()=>{if(MODE==='section'){secRestore(SEC.base);SUNDO=[];$('#btnUndo').disabled=true;toast('단면 건물을 전부 복구했어요');return}if(!BASE)return;restore(BASE);newGame();UNDO.length=0;$('#btnUndo').disabled=true;$('#btnReset').disabled=true;toast('전부 복구했어요')};

// ---------- 입력 ----------
const ptrs=new Map();let drag=null,pinch=null,firing=false,pickHQ=false;
// ---- 휴대폰 조작 보정 ----
//  탭 판정 여유(손가락 14px) · 잡기 도구는 꾹 눌러야(0.22초) 잡힘 · 두 손가락은 이동+확대(회전 없음) · 단면에서 건물 안으로 너무 들어가지 않게
function minDist(){return MODE==='section'?(SEC&&SEC.inside?11:Math.max(24,((SEC&&SEC.D)||0)*1.3)):120}
function armHold(d,go){d.hold=setTimeout(()=>{d.hold=null;if(drag===d&&!d.moved&&ptrs.size===1&&go()){try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}}},220)}
function clearHold(d){if(d&&d.hold){clearTimeout(d.hold);d.hold=null}}
let PINARM=null;
function pinAt(mx,my){for(const L of LBL){if(!L.pin||L.el.style.display==='none')continue;const r=L.el.getBoundingClientRect();
  if(mx>=r.left-6&&mx<=r.right+6&&my>=r.top-6&&my<=r.bottom+6)return L}return null}
function pinTap(L){const now=performance.now();
  if(PINARM&&PINARM.L===L&&now-PINARM.t<3000){PINARM=null;L.el.classList.remove('armed');L.el.click();return}
  if(PINARM)PINARM.L.el.classList.remove('armed');PINARM={L,t:now};L.el.classList.add('armed');
  toast(`${L.el.textContent} — 한 번 더 누르면 이 건물 단면으로 들어가요`,2600)}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
function cancelHolds(){if(drag){if(drag.grab)releaseGrab();if(drag.sgrab)secGrabRelease();if(drag.sext)secExtRelease()}}
// 선 긋기 중에는 버튼을 누르지 않고 움직여도 미리보기 선이 따라옴
canvas.addEventListener('pointermove',e=>{if(gesture&&(e.pointerType==='mouse'||!ptrs.size)){gesture.cur={x:e.clientX,y:e.clientY}}});
canvas.addEventListener('pointerdown',e=>{
  canvas.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});audioInit();
  if(ptrs.size===2){firing=false;clearHold(drag);cancelHolds();const [a,b]=[...ptrs.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,lx:(a.x+b.x)/2,ly:(a.y+b.y)/2,dist:cam.dist,theta:cam.theta,phi:cam.phi};drag=null;return}
  drag={x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,btn:e.button,moved:false,shift:e.shiftKey,pt:e.pointerType,t0:performance.now()};
  if(e.button!==0||pickHQ||ultArmed||e.shiftKey||gesture)return;
  if(stopOn())return;
  const hold=holdOf(),mx=e.clientX,my=e.clientY;
  const d=drag;let go=null;
  if(MODE==='city'){
    if(hold==='grab')go=()=>{const h=pick(mx,my);if(h&&h.b&&startGrab(h.b,mx,my)){d.moved=true;d.grab=true;bossTool('move',h.x,h.z);return true}return false};
  }else if(MODE==='section'&&SEC){
    if(hold==='sgrab')go=()=>{const h=secPick(mx,my);if(h&&h.el){secPushUndo();if(secGrabStart(h,mx,my)){d.moved=true;d.sgrab=true;bossTool('move');return true}else SUNDO.pop()}return false};
    else if(hold==='sext')go=()=>{const h=secPick(mx,my);if(h&&h.el){secPushUndo();secExtStart(my);d.moved=true;d.sext=true;return true}return false};
  }
  if(go){if(e.pointerType==='touch')armHold(d,go);else go()}
});
canvas.addEventListener('pointermove',e=>{
  if(!ptrs.has(e.pointerId))return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&ptrs.size===2){const [a,b]=[...ptrs.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);cam.dist=clamp(pinch.dist*pinch.d/Math.max(d,1),minDist(),2600);
    const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,mdx=cx-pinch.lx,mdy=cy-pinch.ly;pinch.lx=cx;pinch.ly=cy;
    const s=cam.dist/900,ct=Math.cos(cam.theta),st=Math.sin(cam.theta);
    if(MODE==='section'&&SEC){cam.tx-=ct*mdx*s;cam.tz+=st*mdx*s;cam.ty=clamp(cam.ty+mdy*s,0,secTop()+8)}
    else{cam.tx=cam.tx-ct*mdx*s-st*mdy*s;cam.tz=cam.tz+st*mdx*s-ct*mdy*s}
    return}
  if(!drag)return;
  if(drag.sgrab){secGrabMove(e.clientX,e.clientY);return}
  if(drag.sext){secExtMove(e.clientY);return}
  if(drag.grab){moveGrab(e.clientX,e.clientY);return}
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
  if(Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)>(drag.pt==='touch'?14:6)){drag.moved=true;clearHold(drag)}
  if(!drag.moved)return;
  if(drag.btn===2||drag.btn===1||drag.shift){const s=cam.dist/900;const ct=Math.cos(cam.theta),st=Math.sin(cam.theta);
    cam.tx=cam.tx-ct*dx*s-st*dy*s;cam.tz=cam.tz+st*dx*s-ct*dy*s;}
  else{cam.theta-=dx*0.006;cam.phi=clamp(cam.phi-dy*0.005,0.12,1.42)}
});
function endPtr(e){
  if(!ptrs.has(e.pointerId))return;ptrs.delete(e.pointerId);
  if(pinch){if(ptrs.size<2)pinch=null;drag=null;return}
  clearHold(drag);
  if(drag&&drag.sgrab){secGrabRelease();drag=null;return}
  if(drag&&drag.sext){secExtRelease();drag=null;return}
  if(drag&&drag.grab){releaseGrab();drag=null;return}
  const click=drag&&!drag.moved&&!(drag.pt==='touch'&&performance.now()-drag.t0>650),mx=e.clientX,my=e.clientY;
  // 우클릭(드래그 없이) = 선 긋기 취소
  if(click&&drag.btn===2&&gesture){gestureCancel();drag=null;return}
  // 구청 공사중지 중에는 도구를 못 씀 (화면 이동·회전은 됨)
  if(click&&drag.btn===0&&!pickHQ&&stopOn()){stopNag();drag=null;return}
  // 선 긋기 도구: 클릭 = 시작점 / 끝점, 드래그 = 화면 회전
  if(click&&drag.btn===0&&!ultArmed&&!pickHQ&&holdOf()==='line'){if(gesture)gestureEnd(mx,my);else gestureStart(mx,my);drag=null;return}
  if(click&&drag.btn===0&&bossClick(mx,my)){drag=null;return}
  if(click&&drag.btn===0&&TOUCH&&MODE==='city'&&!ultArmed&&!pickHQ){const L=pinAt(mx,my);if(L){pinTap(L);drag=null;return}}
  if(MODE==='section'){if(click&&drag.btn===0){const h=secPick(mx,my);
      if(h){if(ultArmed){secPushUndo();secFire(-1,h);ULT=0;ultArmed=false;statTool('nuke');selectWeapon(weapon);bossTool('nuke')}
        else if(!holdOf()){const id=WEAPONS[weapon].id;if(id!=='blast')secPushUndo();secFire(weapon,h);statTool(id);bossTool(id)}}}
    drag=null;return}
  if(click&&drag.btn===0){const h=pick(mx,my);
    if(pickHQ){pickHQ=false;selectWeapon(weapon);if(h&&h.b){setHQ(h.b,true);toast('사옥으로 지정했어요 (이 브라우저에 저장)')}else{const g=rayGround(mx,my,0),nb=g&&hqSynth(g[0],g[1]);if(nb){setHQ(nb,true);toast('🏗 여기에 사옥을 세웠어요 (이 브라우저에 저장)',3000)}else toast('건물이나 빈 땅을 눌러주세요')}}
    else if(h&&ultArmed){snapshot();STOP.grace=performance.now()+8000;ULTIMATE.fire(h);ULT=0;ultArmed=false;statTool('nuke');selectWeapon(weapon);bossTool('nuke',h.x,h.z)}
    else if(h&&!holdOf()){const w=WEAPONS[weapon];if(!w.nosnap)snapshot();w.fire(h);if(w.id!=='blast')statTool(w.id);bossTool(w.id,h.x,h.z)}}
  drag=null;
}
canvas.addEventListener('pointerup',endPtr);canvas.addEventListener('pointercancel',endPtr);
canvas.addEventListener('wheel',e=>{e.preventDefault();cam.dist=clamp(cam.dist*Math.exp(e.deltaY*0.0012),MODE==='section'?15:120,2600)},{passive:false});
function stopBeam(){beam=null;sBeam=null;humStop()}
const KEYS=new Set();addEventListener('keyup',e=>KEYS.delete(e.key.toLowerCase()));addEventListener('blur',()=>KEYS.clear());
addEventListener('keydown',e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;if(!e.ctrlKey&&!e.metaKey)KEYS.add(e.key.toLowerCase());
  const k=e.key.toLowerCase();
  if(k==='c'&&!e.ctrlKey&&!e.metaKey)enterSection();
  if(k==='h'&&!e.ctrlKey&&!e.metaKey)toggleMini();
  if(k==='f'&&MODE==='section')toggleInside();
  if(e.key>='1'&&e.key<='9')selectWeapon(+e.key-1);if(e.key==='0')selectWeapon(9);
  if(e.key===' '){e.preventDefault();detonate()}
  if(e.key==='Escape')gestureCancel();
  if(k==='q')armUlt();if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();$('#btnUndo').click()}});
document.querySelectorAll('.tool[data-w]').forEach(b=>b.onclick=()=>selectWeapon(+b.dataset.w));

// ---------- 사운드 ----------
let AC=null,noiseBuf=null,hum=null;
function audioInit(){if(AC||!opts.sound)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();noiseBuf=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1}catch(e){AC=null}}
function sfx(size,dur){if(!AC||!opts.sound)return;try{const s=AC.createBufferSource();s.buffer=noiseBuf;const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=Math.max(120,1400-size*18);const g=AC.createGain();const t=AC.currentTime,len=dur||Math.min(2.2,0.25+size*0.03);
  g.gain.setValueAtTime(Math.min(0.9,0.15+size*0.02),t);g.gain.exponentialRampToValueAtTime(0.001,t+len);s.connect(f);f.connect(g);g.connect(AC.destination);s.start(t);s.stop(t+len)}catch(e){}}
function humStart(){if(!AC||!opts.sound||hum)return;try{const o=AC.createOscillator();o.type='sawtooth';o.frequency.value=92;const g=AC.createGain();g.gain.value=0.05;o.connect(g);g.connect(AC.destination);o.start();hum={o,g}}catch(e){}}
function humStop(){if(hum){try{hum.o.stop()}catch(e){}hum=null}}

// ---------- 라벨 ----------
let LBL=[];
function makeLabels(){const box=$('#labels');box.innerHTML='';LBL=[];
  const named=B.filter(b=>b.name&&!b.hq).sort((a,b)=>b.area*b.h0-a.area*a.h0).slice(0,14);
  for(const b of [...B.filter(b=>b.hq),...named]){const el=document.createElement('div');el.className='lbl'+(b.hq?' hq':'');el.textContent=b.hq?b.hqName:b.name;box.appendChild(el);LBL.push({b,el})}
  if(!B.some(b=>b.hq)&&CUR){const el=document.createElement('div');el.className='lbl hq';el.textContent=CUR.name+' (위치)';box.appendChild(el);LBL.push({b:{alive:true,cx:0,cz:0,base:0,h:6,hq:true},el})}
  makePins();
}
function updateLabels(){
  drawFloats();updateUltUI();drawGesture();drawBossUI();drawClientUI();stopUI();shipUI();adUI();
  if(MODE==='section'){updateSecLabels();return}
  const occ=new Set();
  for(const L of LBL){const b=L.b;if(!b.alive||(L.pin?!opts.pins||b.hq:!opts.labels)){L.el.style.display='none';continue}
    const p=project(b.cx,b.base+b.h+(L.pin?2:4),b.cz);if(!p||p[0]<-50||p[0]>innerWidth+50||p[1]<0||p[1]>innerHeight){L.el.style.display='none';continue}
    const key=Math.floor(p[0]/96)+','+Math.floor(p[1]/22);
    if(L.pin&&occ.has(key)){L.el.style.display='none';continue}occ.add(key);
    L.el.style.display='';L.el.style.left=p[0]+'px';L.el.style.top=p[1]+'px';}
}

// ---------- 데이터 로딩 ----------
let CUR=null, LAT0=0, LNG0=0;
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
function proj(lat,lng){return[(lng-LNG0)*Math.cos(LAT0*Math.PI/180)*111320,-(lat-LAT0)*110540]}
function unproj(x,z){return[LAT0-z/110540,LNG0+x/(Math.cos(LAT0*Math.PI/180)*111320)]}
async function fetchT(url,o={},ms=25000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{...o,signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}}
async function geocode(q){
  try{const r=await fetchT('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&accept-language=ko&q='+encodeURIComponent(q),{},12000);if(r&&r[0])return{lat:+r[0].lat,lng:+r[0].lon,label:r[0].display_name}}catch(e){}
  try{const r=await fetchT('https://photon.komoot.io/api/?limit=1&lat=36.5&lon=127.8&q='+encodeURIComponent(q),{},12000);const f=r&&r.features&&r.features[0];
    if(f&&f.properties&&(f.properties.countrycode||'').toUpperCase()==='KR')return{lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],label:f.properties.name||q}}catch(e){}
  return null;
}
const ROADSTYLE=new Proxy({},{get:(o,k)=>ROADSTYLE0[String(k).replace(/_link$/,'')]});
const ROADSTYLE0={motorway:[16,0.17,1],trunk:[15,0.17,1],primary:[13,0.19,1],secondary:[11,0.2,1],tertiary:[9,0.21,0],residential:[6.5,0.23,0],unclassified:[6.5,0.23,0],service:[4.5,0.25,0],living_street:[5,0.25,0],pedestrian:[5,0.55,0],footway:[2.4,0.56,0],path:[2,0.52,0],steps:[2.4,0.52,0],cycleway:[2.4,0.45,0],track:[3,0.45,0]};
function landKind(t){
  if(t.natural==='water'||t.landuse==='reservoir'||t.landuse==='basin')return'water';
  if(t.natural==='wood'||t.landuse==='forest'||t.natural==='scrub')return'forest';
  if(t.leisure==='pitch'||t.leisure==='sports_centre'&&false)return'pitch';
  if(t.leisure==='park'||t.leisure==='garden'||t.landuse==='recreation_ground'||t.landuse==='village_green')return'park';
  if(t.landuse==='grass'||t.landuse==='meadow'||t.natural==='grassland'||t.landuse==='cemetery'||t.leisure==='golf_course')return'green';
  if(t.natural==='sand'||t.natural==='beach'||t.leisure==='playground')return'sand';
  if(t.amenity==='parking')return'parking';
  return null;
}
function parseOSM(json){
  const bs=[],rs=[],lus=[],treeNodes=[],archPois=[];
  for(const e of json.elements||[]){
    const t=e.tags||{};
    const isArch=t.name&&(t.office==='architect'||/건축사|건축사무소|architect/i.test(t.name));
    if(isArch){let la=e.lat,lo=e.lon;if(e.geometry&&e.geometry.length){la=e.geometry.reduce((a,g)=>a+g.lat,0)/e.geometry.length;lo=e.geometry.reduce((a,g)=>a+g.lon,0)/e.geometry.length}if(la!=null)archPois.push({id:e.type[0]+e.id,name:t.name,lat:la,lng:lo,addr:[t['addr:street'],t['addr:housenumber']].filter(Boolean).join(' ')})}
    if(e.type==='node'){if(t.natural==='tree')treeNodes.push(proj(e.lat,e.lon));continue}
    if(e.type!=='way'||!e.geometry)continue;
    const pts=e.geometry.map(g=>proj(g.lat,g.lon));
    if(t.building&&t.building!=='no'){const b=makeBuilding(e.id,pts,t);if(b)bs.push(b)}
    else if(t.highway){const st=ROADSTYLE[t.highway];if(!st)continue;const g=st[1];rs.push({id:e.id,pts,w:st[0],c:g>0.4?[g+0.08,g+0.06,g+0.02]:[g,g+0.01,g+0.02],lift:g>0.4?0.12:0.2,line:!!st[2]})}
    else{const k=landKind(t);if(!k)continue;let p=cleanRing(pts);if(p.length<3)continue;
      let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const q of p){x0=Math.min(x0,q[0]);x1=Math.max(x1,q[0]);z0=Math.min(z0,q[1]);z1=Math.max(z1,q[1])}
      lus.push({id:e.id,kind:k,pts:p,bb:[x0,z0,x1,z1],area:Math.abs(polyArea(p))})}
  }
  rs.sort((a,b)=>a.lift-b.lift);
  lus.sort((a,b)=>b.area-a.area); // 큰 것 먼저 칠하고 작은 것이 덮음
  return{bs,rs,lus,treeNodes,archPois};
}
function plantTreesTile(c,data,newLu){
  const R=mulberry((c.i*131+c.j*977+7)|0);const inT=(x,z)=>x>=c.ox&&x<c.ox+TILE&&z>=c.oz&&z<c.oz+TILE;
  for(const [x,z] of data.treeNodes){const k=Math.round(x)+','+Math.round(z);if(SEEN.t.has(k)||!inT(x,z))continue;SEEN.t.add(k);addTree(x,z,4+R()*3,R,c)}
  for(const lu of LANDUSE){if(!/park|forest|green/.test(lu.kind))continue;const [x0,z0,x1,z1]=lu.bb;
    const ax0=Math.max(x0,c.ox),ax1=Math.min(x1,c.ox+TILE),az0=Math.max(z0,c.oz),az1=Math.min(z1,c.oz+TILE);if(ax1<=ax0||az1<=az0)continue;
    const area=(ax1-ax0)*(az1-az0)*Math.min(1,lu.area/((x1-x0)*(z1-z0)||1));
    const dens=lu.kind==='forest'?1/55:lu.kind==='park'?1/140:1/320;const n=Math.min(500,Math.floor(area*dens));let tries=0,k=0;
    while(k<n&&tries<n*6){tries++;const x=ax0+R()*(ax1-ax0),z=az0+R()*(az1-az0);if(!pip(x,z,lu.pts))continue;addTree(x,z,3.5+R()*4,R,c);k++}}
  for(const s of c.roads){if(s.w<9)continue;const {ax,az,bx,bz}=s;const len=Math.hypot(bx-ax,bz-az);if(len<1)continue;
    const nx=-(bz-az)/len,nz=(bx-ax)/len,off=s.w/2+2.2;for(let d=6;d<len;d+=11){const t=d/len,x=ax+(bx-ax)*t,z=az+(bz-az)*t;
      if(R()<0.8&&inT(x+nx*off,z+nz*off))addTree(x+nx*off,z+nz*off,3+R()*1.5,R,c);if(R()<0.8&&inT(x-nx*off,z-nz*off))addTree(x-nx*off,z-nz*off,3+R()*1.5,R,c)}}
}
function fakeCity(seed,ox,oz){
  const R=mulberry(seed);const bs=[],rs=[],lus=[];let id=seed*1000+1;const step=80;
  for(let g=0;g<TILE;g+=step){rs.push({pts:[[ox+g,oz],[ox+g,oz+TILE]],w:10,c:[0.2,0.21,0.22],lift:0.2,line:true});rs.push({pts:[[ox,oz+g],[ox+TILE,oz+g]],w:10,c:[0.2,0.21,0.22],lift:0.2,line:true})}
  for(let gx=0;gx<TILE;gx+=step)for(let gz=0;gz<TILE;gz+=step){const bx=ox+gx,bz=oz+gz;
    if(R()<0.12){const x=bx+8,z=bz+8,w=step-16;lus.push({kind:'park',pts:[[x,z],[x+w,z],[x+w,z+w],[x,z+w]],bb:[x,z,x+w,z+w],area:w*w});continue}
    const n=1+Math.floor(R()*3);for(let k=0;k<n;k++){const w=14+R()*26,d=14+R()*26;const x=bx+10+R()*(step-20-w),z=bz+10+R()*(step-20-d);
      const b=makeBuilding(id++,[[x,z],[x+w,z],[x+w,z+d],[x,z+d]],{height:String(8+R()*R()*90),building:R()<0.3?'apartments':'yes'});if(b)bs.push(b)}}
  return{bs,rs,lus,treeNodes:[]};
}
function setHQ(b,save){for(const o of B){if(o.hq){o.hq=false;o.col=o.col0||o.col}}
  b.hq=true;b.hqName=CUR.name;b.col0=b.col;b.col=[0.98,0.92,0.66];bldDirty=true;markB(b);
  if(save){const [la,ln]=unproj(b.cx,b.cz);lsSet('smasharch_hq_'+CUR.id,b.synth?[la,ln,'new']:[la,ln]);hqFixSend(la,ln)}
  makeLabels();if(BOSS&&!BOSS.flees&&BOSS.state==='idle')bossSpawn();if(BASE){BASE=takeState()}}
// OpenStreetMap 에 건물이 없는 곳(신도시 등)에 사옥을 직접 세움: 가까운 도로 방향에 맞춘 20×16m, 층수는 주소의 층 + 여유
function hqSynth(x,z){
  let ang=0,bd=80;for(const c of CHUNKS.values())for(const s of c.roads){const dx=s.bx-s.ax,dz=s.bz-s.az,l2=dx*dx+dz*dz;if(l2<1)continue;
    const t=clamp(((x-s.ax)*dx+(z-s.az)*dz)/l2,0,1),d=Math.hypot(s.ax+dx*t-x,s.az+dz*t-z);if(d<bd){bd=d;ang=Math.atan2(dz,dx)}}
  const W=20,D=16,cr=Math.cos(ang),sr=Math.sin(ang),pts=[[-W/2,-D/2],[W/2,-D/2],[W/2,D/2],[-W/2,D/2]].map(([u,v])=>[x+u*cr-v*sr,z+u*sr+v*cr]);
  const fl=CUR?parseFloor(CUR.addr):null,floors=Math.max(5,(fl||0)+2);
  const b=makeBuilding('hq'+Date.now().toString(36),pts,{height:String(floors*3.5+1),building:'office'});if(!b)return null;
  b.synth=true;b.units=[];b.ck=chunkAt(b.cx,b.cz,true);b.ck.blds.push(b);B.push(b);indexBuilding(b,B.length-1);b.ck.dB=true;bldDirty=true;return b}
function chooseHQ(){
  const saved=lsGet('smasharch_hq_'+CUR.id);let px=0,pz=0;if(saved){[px,pz]=proj(saved[0],saved[1])}
  if(saved&&saved[2]==='new'){const b=hqSynth(px,pz);if(b)setHQ(b,false);return}
  let best=null,bd=1e9;for(const b of B){const d=pip(px,pz,b.pts)?-1:Math.hypot(b.cx-px,b.cz-pz);if(d<bd){bd=d;best=b}}
  // 좌표가 '확정'인데 그 자리(20m 안)에 건물이 없으면 지도에 건물이 빠진 것 → 좌표 자리에 사옥을 세움 (대학교 캠퍼스는 제외)
  const sure=!saved&&!WORLD.fake&&CUR.dkey&&CUR.lat!=null&&!CUR.approx&&CUR.kind!=='u';
  if(sure&&(!best||bd>=60||distToBuilding(best,px,pz)>20)){const b=hqSynth(px,pz);if(b){setHQ(b,false);return}}
  if(best&&bd<60)setHQ(best,false);
}
function setLoading(on,msg){$('#loading').classList.toggle('on',on);if(msg)$('#loadingMsg').textContent=msg}
async function loadFirm(f){
  if(MODE==='section')exitSection();
  closeModals();setLoading(true,`${f.name} 위치 찾는 중…`);
  f.id=f.key||f.name;
  let lat=f.lat,lng=f.lng,approx=!!f.approx;
  if(lat==null){
    const cache=lsGet('smasharch_geo3_'+f.id);
    if(cache){lat=cache.lat;lng=cache.lng;approx=cache.approx}
    else{const qs=f.q||addrQueries(f.addr||f.name);for(let i=0;i<qs.length;i++){const r=await geocode(qs[i]);if(r){lat=r.lat;lng=r.lng;approx=!!f.approxLast&&i===qs.length-1;break}}
      if(lat!=null)lsSet('smasharch_geo3_'+f.id,{lat,lng,approx})}
  }
  CUR=f;geoNote(false);adReset();$('#firmName').textContent=f.name;$('#firmAddr').textContent=(f.addr||'')+(f.tenant?' · 입주 건물':'');
  bossReset();clientReset();CLIENT_USED=false;SINK_UNTIL=0;for(const b of [...DETS])freeDet(b);clearTools();STATS={t0:0,kills:0,tools:{}};ULT=0;ultArmed=false;
  BASE=null;resetWorld();LAT0=lat!=null?lat:37.5665;LNG0=lat!=null?lng:126.978;
  cam.tx=0;cam.tz=0;
  setLoading(true,'사옥 주변 지도 불러오는 중…');
  const slowMsg=setTimeout(()=>{if($('#loading').classList.contains('on'))setLoading(true,'처음 가는 동네라 OpenStreetMap 서버에서 받는 중… (보통 10~30초, 한 번 받으면 다음부터 바로 떠요)')},2500);
  WORLD.fake=lat==null;let n=await loadTile(0,0);
  let fake=WORLD.fake;
  if(!fake&&n<3){resetWorld();WORLD.fake=true;fake=true;await loadTile(0,0);toast(lat==null?'주소 위치를 찾지 못해 가상 단지로 시작해요. 다른 회사 → 좌표 입력으로 다시 시도해보세요.':'지도 데이터를 불러오지 못해 가상 단지로 시작해요.',4500);$('#firmAddr').textContent=(f.addr||'')+' · 가상 단지'}
  chooseHQ();buildNeighborhood();applyLandmarks();stage={done:false,t0:0};
  D.used.fill(0);D.rest.fill(0);FALL=[];beam=null;shock=null;quake=null;score=0;newGame();UNDO.length=0;$('#btnUndo').disabled=true;$('#btnReset').disabled=true;
  bldDirty=true;rubDirty=true;treeDirty=true;groundDirty=true;makeLabels();
  bossSpawn();BASE=takeState();updateHUD();
  // 하늘에서 사옥으로 날아 들어오기
  cam.theta=0.75;cam.phi=0.62;cam.dist=2400;camFly={t:0,from:{dist:2400,phi:0.62,theta:0.75},to:{dist:Math.min(1600,560*Math.max(1,1.15*innerHeight/innerWidth)),phi:0.95,theta:1.25}};
  clearTimeout(slowMsg);setLoading(false);
  if(!lsGet('smasharch_tut_v2'))setTimeout(showWelcome,400);
  if(HQFIX&&f.dkey==='d'+HQFIX.kid)hqFixAsk();
  else if(!fake&&!B.some(b=>b.hq))toast('사옥 건물을 못 찾았어요. 설정 → "사옥 건물 직접 지정"으로 골라주세요.',4500);
  else if(!fake&&!f.tenant&&parseFloor(f.addr)==null&&B.some(b=>b.hq))toast('레이드 보스 · 사옥 전체를 쓰는 회사예요. 사옥 기둥이 2배 단단해요',3500);
  else if(!fake&&f.tenant&&!approx)toast(f.name+'은(는) 이 건물 일부 층에 입주한 사무소예요.',3500);
  if(!fake&&approx&&!lsGet('smasharch_hq_'+f.id)&&!(HQFIX&&f.dkey==='d'+HQFIX.kid))setTimeout(()=>geoNote(true,'⚠ 이 사옥은 좌표가 근사값이라 위치가 정확하지 않을 수 있어요. 개발자가 확인 후 고칠 예정이에요.'),1800);
  else if(!fake&&f.dkey&&!B.some(b=>b.hq))setTimeout(()=>geoNote(true,'⚠ 이 주소에서 사옥 건물을 못 찾았어요. 직접 골라주시면 개발자가 확인 후 반영해요.'),1800);
  try{const u=new URL(location.href);u.search='';if(f.key)u.searchParams.set('firm',f.key);else{u.searchParams.set('lat',lat.toFixed(5));u.searchParams.set('lng',lng.toFixed(5));u.searchParams.set('name',f.name)}history.replaceState(null,'',u)}catch(e){}
}

// ---------- 회사 검색 / 모달 ----------
function closeModals(){document.querySelectorAll('.modal').forEach(m=>m.classList.remove('open'))}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModals);
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('pointerdown',e=>{if(e.target===m)closeModals()}));
$('#btnFirm').onclick=()=>{$('#mFirm').classList.add('open');loadHot();setTimeout(()=>$('#customQ').focus(),50)};
$('#btnSet').onclick=()=>$('#mSet').classList.add('open');
function firmButton(name,addr,onclick,firm){const b=document.createElement('button');
  if(firm){b.addEventListener('pointerenter',()=>{clearTimeout(prefT);prefT=setTimeout(()=>prefetchFirm(firm,true),350)});b.addEventListener('pointerleave',()=>clearTimeout(prefT));b.addEventListener('pointerdown',()=>prefetchFirm(firm,true))}b.className='firm';b.innerHTML='<b></b><span></span>';b.querySelector('b').textContent=name;b.querySelector('span').textContent=addr;b.onclick=onclick;return b}
FIRMS.forEach(presetFromData);
const fl=$('#firmList');for(const f of FIRMS)fl.appendChild(firmButton(f.name,f.addr,()=>loadFirm(f),f));
{const kc={'':0,c:0,g:0,u:0};for(const r of FIRMDATA)kc[r[8]in kc?r[8]:'']++;
  $('#firmCount').textContent=FIRMDATA.length?`건축사사무소 ${fmt(kc[''])} · 건설사 ${fmt(kc.c)} · 일반 회사 ${fmt(kc.g)} · 대학교 ${fmt(kc.u)}곳 (좌표 확정 ${fmt(FIRM_GEO_COUNT)})`+(window.FIRMDATA_SRC==='snapshot'?' · 저장된 목록':''):'목록을 불러오지 못했어요 (주소 검색은 가능)'}
const norm=s=>s.toLowerCase().replace(/\(주\)|㈜|주식회사|\(유\)|\(합\)|유한회사|합자회사|[\s·.,\-()]/g,'');
const FIDX=FIRMDATA.map(([n,a])=>norm(n)+'|'+norm(a));
function firmFromData(i){const [n,a,la,ln,st,kid,sido,sgg,kd]=FIRMDATA[i];const f={key:'d'+kid,dkey:'d'+kid,sido,sgg,name:n,addr:a,q:addrQueries(a),approxLast:true,kind:kd||'',tenant:kd!=='u'&&/\d+\s*층|\d+\s*호|지층|지하/.test(a)};
  if(st!==2&&la!=null){f.lat=la;f.lng=ln;f.approx=st===1}return f}
const GEO_TAG=['','  · ⚠ 근사 좌표','  · 좌표 준비 중(주소 검색으로 찾기)'];
let FCAT='all';
document.querySelectorAll('#fCats button').forEach(b=>b.onclick=()=>{FCAT=b.dataset.k;document.querySelectorAll('#fCats button').forEach(x=>x.classList.toggle('on',x===b));runSearch();if(!$('#customQ').value.trim())$('#customQ').focus()});
function runSearch(){const q=$('#customQ').value.trim();const box=$('#searchRes');box.innerHTML='';
  if(!q){box.style.display='none';if(FCAT!=='all'){box.style.display='';box.innerHTML=`<div class="small" style="margin:2px 0 8px;opacity:.8">${({'':'건축사사무소',c:'건설사',u:'대학교',g:'일반 회사'})[FCAT]} 중에서 찾아요 — 이름이나 주소를 입력하세요</div>`}return}
  const m=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  box.style.display='';
  if(m){box.appendChild(firmButton('좌표로 이동',`${m[1]}, ${m[2]}`,()=>loadFirm({name:'좌표 '+(+m[1]).toFixed(4)+', '+(+m[2]).toFixed(4),addr:'',lat:+m[1],lng:+m[2]})));return}
  const nq=norm(q);const hits=[];for(let i=0;i<FIDX.length&&hits.length<40;i++)if(FIDX[i].includes(nq)&&(FCAT==='all'||(FIRMDATA[i][8]||'')===FCAT))hits.push(i);
  hits.forEach((i,n)=>{const f=firmFromData(i);box.appendChild(firmButton(({c:'🏗 ',g:'🏢 ',u:'🎓 '}[FIRMDATA[i][8]]||'')+FIRMDATA[i][0],FIRMDATA[i][1]+GEO_TAG[FIRMDATA[i][4]]+({c:' · 건설사',g:' · 일반 회사',u:' · 대학교'}[FIRMDATA[i][8]]||''),()=>loadFirm(f),f));if(n<3)setTimeout(()=>{if($('#customQ').value.trim()===q)prefetchFirm(f,false)},400)});
  box.appendChild(firmButton('“'+q+'” 주소로 직접 찾기','목록에 없으면 주소나 건물 이름으로 검색',()=>loadFirm({name:q,addr:q,q:addrQueries(q)})));
  if(hits.length<3)box.appendChild(firmButton('📮 “'+q+'” 바로 추가하기','목록에 없으면 주소만 넣어주세요. 위치를 찾아 바로 추가돼요 (건축사사무소·건설사·일반 회사·대학교)',()=>openReq('회사 추가',q)));
}
$('#customQ').addEventListener('input',runSearch);
$('#customQ').addEventListener('keydown',e=>{if(e.key==='Enter'){const f=$('#searchRes .firm');if(f)f.click()}});
$('#btnShare').onclick=()=>openShare('result');
$('#btnPickHQ').onclick=()=>{closeModals();pickHQ=true;$('#hint').textContent='사옥 건물(또는 빈 땅)을 눌러주세요';toast('사옥으로 쓸 건물을 눌러주세요. 건물이 없으면 빈 땅을 누르면 새로 세워요',4000)};
for(const k of ['Sound','Labels','Debris','Shadows','Pins','Mini','Shake','Night','Patch']){const el=$('#opt'+k);if(!el)continue;const key=k.toLowerCase();el.checked=!!opts[key];el.onchange=()=>{opts[key]=el.checked;lsSet('smasharch_opts',opts);if(key==='sound'&&!el.checked)humStop();if(key==='mini')applyMini();if(key==='night'){if(!el.checked&&DAY.night)dayStart();DAY.t=0}}}
// ---- 간단 화면: H 키 · 왼쪽 위 [UI] 버튼 · 설정 체크 ----
function applyMini(){document.body.classList.toggle('mini',!!opts.mini);const el=$('#optMini');if(el)el.checked=!!opts.mini;setTimeout(layoutHUD,0)}
function toggleMini(){opts.mini=!opts.mini;lsSet('smasharch_opts',opts);applyMini();toast(opts.mini?'간단 화면 — 필요한 버튼만 남겼어요 (랭킹·정복·공유는 설정 안에)':'기본 화면으로 돌아왔어요',2200)}
if($('#btnMini'))$('#btnMini').onclick=toggleMini;
if($('#btnDonate'))$('#btnDonate').onclick=()=>{closeModals();$('#mDonate').classList.add('open')};
document.querySelectorAll('#setLinks [data-go]').forEach(b=>b.onclick=()=>{closeModals();const t=$('#'+b.dataset.go);if(t)t.click()});
document.querySelectorAll('#toolbar .tool').forEach(b=>{if(!b.title)b.title=b.textContent.trim()});
applyMini();


// =====================================================================
//  단면 모드 — 사옥(입주 건물)을 단면으로 잘라 "우리 층"을 부수는 모드
// =====================================================================
let MODE='city', SEC=null, SUNDO=[], SFALL=[], sQuake=null, sBeam=null, cityCam=null, secDirty=false, LVPcur=LVP;
const mSec=new MB(1<<15);
const FLOOR_H=3.4, GF_H=4.6, BASE_H=3.6, SLAB_T=0.3;
const POCHE=[0.13,0.13,0.15], C_SLAB=[0.78,0.78,0.76], C_COL=[0.64,0.64,0.62], C_CORE=[0.58,0.58,0.57], C_GLASS=[0.42,0.55,0.66], C_OURS=[1.0,0.83,0.26];

// 주소에서 입주 층 추출: "5층"→5, "302호"→3, "지하1층/지층"→-1, 없으면 null(건물 전체 사용)
function parseFloor(addr){
  if(!addr)return null;
  let m=addr.match(/지하\s*(\d+)\s*층/);if(m)return -(+m[1]);
  if(/지층|지하\s*\d*\s*호|,\s*지하/.test(addr))return -1;
  m=addr.match(/(\d+)\s*층/);if(m&&+m[1]>=1&&+m[1]<=80)return +m[1];
  m=addr.match(/(?:^|[\s,])(\d{3,4})\s*호/);if(m){const f=Math.floor(+m[1]/100);if(f>=1&&f<=80)return f}
  return null;
}
function floorName(k){return k<0?'B'+(-k):(k+1)+'F'}
// 바닥 모양을 가장 긴 변 기준으로 회전한 사각형(OBB)으로 단순화
function footprintOBB(pts){
  let best=0,ang=0;
  for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];const l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l>best){best=l;ang=Math.atan2(b[1]-a[1],b[0]-a[0])}}
  const c=Math.cos(ang),s=Math.sin(ang);let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
  for(const p of pts){const x=p[0]*c+p[1]*s,z=-p[0]*s+p[1]*c;x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z)}
  let W=x1-x0,Dp=z1-z0;if(Dp>W)[W,Dp]=[Dp,W];return{W,D:Dp};
}
function lin(a,b,n){const o=[];for(let i=0;i<n;i++)o.push(a+(b-a)*(n===1?0.5:i/(n-1)));return o}

const ITEMS={
  model:{pts:3000,msg:'공모전 모형 파손! 3주 야근 날아감'},
  plotter:{pts:1500,msg:'플로터 사망… 마감 전날이 아니라 다행'},
  rolls:{pts:800,msg:'A0 출력본 50장 증발 — 출력실 원망 중'},
  sample:{pts:600,msg:'마감재 샘플 박살 — 시공사에 다시 요청'},
  ramen:{pts:500,msg:'야근 컵라면 탑 붕괴'},
  nas:{pts:2000,msg:'NAS 날아감… 백업은 있겠죠?'},
  pinup:{pts:700,msg:'크리틱 핀업 보드 증발'},
  coffee:{pts:1000,msg:'커피머신 파손 — 팀 사기 -50%'},
  boss:{pts:2500,msg:'소장실 개방! 결재 서류 소멸'}
};
// 건축사무소 한 층 꾸미기 (full=true: 특수 집기까지)
function addOffice(add,k,W,D,R,full){
  const Y=SLAB_T;const wood=[0.80,0.66,0.48],dark=[0.18,0.19,0.21],white=[0.97,0.97,0.96];
  for(let x=-W/2+3;x<W/2-7;x+=3.6){add(k,'prop',[x,Y,D*0.05,x+1.6,Y+0.75,D*0.05+0.8],1,1,full?wood:[0.86,0.86,0.84]);
    if(full)add(k,'prop',[x+0.5,Y+0.75,D*0.05+0.15,x+1.1,Y+1.15,D*0.05+0.25],1,0.5,dark)}
  if(!full)return;
  // 모형 테이블 + 모형
  const tx=-1.6;add(k,'prop',[tx,Y,D*0.24,tx+3.2,Y+0.9,D*0.24+1.4],1,1,[0.92,0.92,0.9],{name:'model'});
  for(let i=0;i<4;i++){const bx=tx+0.3+i*0.7,hh=0.3+R()*0.9;add(k,'prop',[bx,Y+0.9,D*0.24+0.3,bx+0.5,Y+0.9+hh,D*0.24+0.85],1,1.5,white,{name:'model'})}
  // 플로터 · 도면 롤 · NAS
  add(k,'prop',[-W/2+1.2,Y,D*0.26,-W/2+2.8,Y+1.1,D*0.26+0.7],1,1,dark,{name:'plotter'});
  for(let i=0;i<5;i++){const zz=D*0.26+(i%3)*0.28,yy=Y+Math.floor(i/3)*0.26;add(k,'prop',[-W/2+3.3,yy,zz,-W/2+4.5,yy+0.25,zz+0.25],1,0.3,white,{name:'rolls'})}
  add(k,'prop',[-W/2+5.2,Y,D*0.36,-W/2+5.8,Y+1.0,D*0.36+0.6],1,1,[0.12,0.13,0.15],{name:'nas'});
  // 마감재 샘플판
  const sc=[[0.72,0.55,0.38],[0.62,0.62,0.6],[0.78,0.78,0.8]];
  for(let i=0;i<3;i++){const x=-W/2+6.6+i*0.8;add(k,'prop',[x,Y,D*0.40,x+0.6,Y+0.95,D*0.40+0.06],1,0.3,sc[i],{name:'sample'})}
  // 핀업 보드
  add(k,'prop',[2.2,Y+0.3,D*0.42,4.8,Y+1.9,D*0.42+0.08],1,1,[0.93,0.90,0.82],{name:'pinup'});
  // 컵라면 탑 (첫 책상 위)
  for(let i=0;i<6;i++){const x=-W/2+3.9;add(k,'prop',[x,Y+0.75+i*0.13,D*0.05+0.4,x+0.14,Y+0.87+i*0.13,D*0.05+0.54],1,0.1,i%2?[0.85,0.15,0.12]:[0.95,0.95,0.92],{name:'ramen'})}
  // 커피머신
  add(k,'prop',[W/2-8.4,Y,D*0.02,W/2-7.2,Y+0.9,D*0.02+0.6],1,0.5,[0.6,0.6,0.62]);
  add(k,'prop',[W/2-8.2,Y+0.9,D*0.02+0.1,W/2-7.6,Y+1.4,D*0.02+0.5],1,0.5,[0.2,0.2,0.22],{name:'coffee'});
  // 소장실 (오른쪽 앞 모서리, 유리 칸막이)
  const bx0=W/2-5.4,bz0=D/2-4.4;
  add(k,'prop',[bx0,Y,bz0,bx0+0.08,Y+2.6,D/2-0.4],1,0.5,[0.62,0.75,0.82],{name:'boss'});
  add(k,'prop',[bx0,Y,bz0,W/2-0.5,Y+2.6,bz0+0.08],1,0.5,[0.62,0.75,0.82],{name:'boss'});
  add(k,'prop',[bx0+1.4,Y,bz0+1.6,bx0+3.6,Y+0.78,bz0+2.6],1,1,[0.35,0.24,0.16],{name:'boss'});
}
function buildSectionModel(b,firm,others){
  others=others||[];
  const fl=parseFloor(firm.addr);
  let {W,D}=footprintOBB(b.pts);W=clamp(W,14,80);D=clamp(D,11,46);
  let N=Math.round((b.h0-1.2)/FLOOR_H);if(b.customF)N=b.customF;if(fl>0)N=Math.max(N,fl+1);for(const o of others)if(o.fl>0)N=Math.max(N,o.fl);N=clamp(N,2,45);
  const nb=fl<0?Math.max(1,-fl):(N>=6?2:1);
  const R=mulberry(b.id%100000+7);
  const piloti=b.style===1&&N>=4&&R()<0.6;   // 아파트·다세대형은 1층 필로티 확률
  const ourK=fl==null?null:(fl>0?fl-1:fl);
  const wallCol=(b.col0||b.col).slice();
  const st=[],els=[];let y=0;for(let k=-1;k>=-nb;k--)y-=BASE_H;
  for(let k=-nb;k<N;k++){const h=k<0?BASE_H:k===0?GF_H:FLOOR_H;st.push({k,h,y0:y,y,vy:0,state:'ok'});y+=h}
  const S=k=>st[k+nb];
  const nx=Math.max(2,Math.round(W/8)+1),nz=Math.max(2,Math.round(D/7.5)+1);
  const xs=lin(-W/2+0.5,W/2-0.5,nx),zs=lin(-D/2+0.5,D/2-0.5,nz);
  const cw=Math.min(9,W*0.28),cd=Math.min(6.5,D*0.36),czc=-D/2+cd/2+0.8;
  const inCore=(x,z)=>Math.abs(x)<cw/2+0.6&&Math.abs(z-czc)<cd/2+0.6;
  const add=(k,kind,box,hp,w,col,extra)=>{const e=Object.assign({k,kind,box,hp,hp0:hp,w,col,alive:true},extra||{});els.push(e);return e};
  for(const s of st){const k=s.k,h=s.h,ours=ourK==null?k>=0:k===ourK;
    // 바닥 슬래브 (최하층 기초는 파괴 불가)
    add(k,'slab',[-W/2,0,-D/2,W/2,SLAB_T,D/2],k===-nb?1e9:2,5,ours&&ourK!=null?C_OURS:C_SLAB);
    // 기둥
    for(const x of xs)for(const z of zs){if(inCore(x,z))continue;add(k,'col',[x-0.38,SLAB_T,z-0.38,x+0.38,h,z+0.38],k<0?3:2,3,C_COL)}
    // 코어 (계단·엘리베이터)
    add(k,'core',[-cw/2,SLAB_T,czc-cd/2,cw/2,h,czc+cd/2],5,6,C_CORE);
    // 외벽: 뒤·옆면만 (앞면은 단면으로 잘림)
    const wall=(x0,z0,x1,z1)=>{
      if(k<0){add(k,'wall',[x0,SLAB_T,z0,x1,h,z1],3,1,[0.55,0.54,0.52]);return}
      if(k===0&&piloti)return;
      add(k,'wall',[x0,SLAB_T,z0,x1,h,z1],1,1,wallCol,{glass:k===0?0.85:0.55});
    };
    for(let i=0;i<xs.length-1;i++)wall(xs[i],-D/2,xs[i+1],-D/2+0.3);
    for(let i=0;i<zs.length-1;i++){wall(-W/2,zs[i],-W/2+0.3,zs[i+1]);wall(W/2-0.3,zs[i],W/2,zs[i+1])}
    // 실내 소품
    if(k>=0&&!(k===0&&piloti)){
      // 사옥 전체를 쓰는 회사는 몇 개 층에만 특수 집기 배치 (너무 무거워지지 않게)
      const full=ourK!=null?k===ourK:(k>=1&&(N<=8||k%Math.ceil(N/6)===1));
      addOffice(add,k,W,D,R,ours&&full);
    }
  }
  // 지붕 슬래브 + 파라펫
  const top=st[st.length-1];add(top.k,'roof',[-W/2,top.h,-D/2,W/2,top.h+SLAB_T,D/2],2,5,[0.70,0.71,0.70]);
  const P=Math.max(W,D)/2+28;
  const focusK=ourK!=null?ourK:Math.min(N-1,1);
  return{b,firm,others,focusK,shown:{},W,D,N,nb,st,els,S,ourK,piloti,P,xs,zs,cw,cd,czc,inCore,add,wallCol,depth:-y0Bottom(st)+2,tenant:fl!=null,total:els.reduce((a,e)=>a+(e.hp0<1e8?e.w:0),0)};
}
function y0Bottom(st){return st[0].y0}

// ---------- 진입 / 종료 ----------
function enterSection(bArg,firmArg){
  if(MODE==='section'){exitSection();if(!bArg)return}
  let b=bArg||B.find(x=>x.hq);const firm=firmArg||CUR;
  if(!b){toast('사옥 건물이 지정되지 않았어요. 설정 → "사옥 건물 직접 지정"을 먼저 해주세요.',3500);return}
  const others=(b.firms||[]).filter(f=>'d'+f.i!==firm.key).map(f=>({name:f.short,fl:parseFloor(f.addr)}));
  SEC=buildSectionModel(b,firm,others);if(BOSS)BOSS.sec=null;
  MODE='section';SUNDO=[];SFALL=[];sQuake=null;sBeam=null;clearTools();secClearTools();
  cityCam={...cam};
  const H=SEC.st[SEC.st.length-1].y0+SEC.st[SEC.st.length-1].h;
  cam.tx=0;cam.tz=0;cam.ty=H*0.42;cam.theta=0.38;cam.phi=1.22;cam.dist=Math.max(H*1.7,SEC.W*1.35,70);if(BOSS&&BOSS.b===b){cam.ty=H*0.52;cam.dist*=1.15}if(isCompact()){cam.dist*=1.22;cam.ty-=H*0.04}SEC.overCam={...cam};SEC.inside=false;
  const Rr=Math.max(SEC.P,H)+15;
  LVPcur=mul(ortho(-Rr,Rr,-Rr,Rr,10,2600),lookAt([SUN[0]*1300,SUN[1]*1300+H*0.5,SUN[2]*1300],[0,H*0.4,0],[0,1,0]));
  D.used.fill(0);D.rest.fill(0);rubDirty=true;secDirty=true;
  SEC.base=secSnap();
  $('#btnSection').classList.add('on');$('#btnSection').lastChild.textContent='동네로';
  document.body.classList.add('sec');  $('#secPanel').innerHTML='<div id="secInfo"></div><div id="secHint" class="k"></div><button id="btnFloor" class="btn-s" style="margin-top:5px"></button>';$('#btnFloor').onclick=toggleInside;$('#btnFloor').textContent=(SEC.ourK!=null?'우리 층':floorName(SEC.focusK))+' 확대해서 보기'+(TOUCH?'':' (F)');
  $('#secPanel').style.display='';$('#btnUndo').disabled=true;$('#btnReset').disabled=false;
  makeSecLabels();selectWeapon(weapon);
  const oc=SEC.others.length;
  toast(SEC.tenant?`${SEC.firm.name}은(는) ${floorName(SEC.ourK)}에 입주해 있어요${oc?` (같은 건물에 다른 사무소 ${oc}곳)`:''}. 그 층만 정확히 날려보세요!`:`${SEC.firm.name} 건물 전체가 사옥이에요. 기둥과 코어를 노려 완전 붕괴시켜 보세요!`,4200);
}
function exitSection(){
  if(MODE!=='section')return;
  const c=secCollapse();
  if(c>=0.6&&SEC.b.alive){killBuilding(SEC.b);toast('단면 모드에서 무너뜨린 사옥이 동네에서도 철거됐어요')}
  secClearTools();CHARGES=[];updateDetBtn();
  MODE='section-exit';Object.assign(cam,cityCam);cam.ty=0;LVPcur=LVP;
  D.used.fill(0);D.rest.fill(0);rubDirty=true;SFALL=[];sQuake=null;sBeam=null;
  MODE='city';SEC=null;
  $('#btnSection').classList.remove('on');$('#btnSection').lastChild.textContent='단면';
  document.body.classList.remove('sec');  $('#secPanel').style.display='none';$('#btnUndo').disabled=!UNDO.length;$('#btnReset').disabled=!UNDO.length;
  makeLabels();selectWeapon(weapon);
}

// ---------- 구조 판정 ----------
function secTargets(){ // 각 층이 놓일 높이 (아래층이 무너지면 내려앉음)
  const t=[];let y=SEC.st[0].y0;
  for(const s of SEC.st){t.push(y);y+=s.state==='crushed'?0.9:s.state==='gone'?0:s.h}
  return t;
}
function storyHealth(s){let tot=0,alive=0,core=false,coreHp=0;
  for(const e of SEC.els){if(e.k!==s.k)continue;if(e.kind==='col'){tot++;if(e.alive)alive++}if(e.kind==='core'&&e.alive){core=true;coreHp=e.hp/e.hp0}}
  return{r:tot?alive/tot:1,core,coreHp}}
function toggleInside(){if(!SEC)return;SEC.inside=!SEC.inside;
  if(SEC.inside){const s=SEC.S(SEC.focusK);SEC.overCam={...cam};cam.tx=0;cam.ty=s.y+0.9;cam.tz=SEC.D*0.12;cam.theta=0.22;cam.phi=1.42;cam.dist=Math.max(SEC.W*0.42,11)}
  else Object.assign(cam,SEC.overCam);
  $('#btnFloor').textContent=(SEC.inside?'단면 전체 보기 (F)':((SEC.ourK!=null?'우리 층':floorName(SEC.focusK))+' 확대해서 보기 (F)')).replace(TOUCH?' (F)':'@@','')}
function secCheck(){
  for(const s of SEC.st){
    if(s.state==='ok'&&!s.warned&&s.k>-SEC.nb){const h=storyHealth(s);if(!h.core&&h.r<0.55&&h.r>=0.34){s.warned=1;toast(`⚠ ${floorName(s.k)} 붕괴 임박 — 기둥 ${Math.round(h.r*100)}% 남음`,2500)}}
    if(s.state!=='ok'||s.k===-SEC.nb&&false)continue;
    let tot=0,alive=0,core=false;
    for(const e of SEC.els){if(e.k!==s.k)continue;if(e.kind==='col'){tot++;if(e.alive)alive++}if(e.kind==='core'&&e.alive)core=true}
    if(!core&&tot&&alive/tot<0.34)crushStory(s);
  }
}
function crushStory(s){
  s.state='crushed';comboHit(1);if(BOSS&&SEC&&SEC.b===BOSS.b)bossHit('floor');
  for(const e of SEC.els)if(e.k===s.k&&e.alive&&e.kind!=='slab')secDestroy(e,true);
  secBoom(0,s.y+s.h*0.5,SEC.D*0.3,Math.min(40,SEC.W*0.6));cam.shake=Math.max(cam.shake,5);
  wakeAllRubble();secDirty=true;
}
function wakeAllRubble(){for(let i=0;i<MAXD;i++)if(D.used[i]&&D.rest[i]){D.rest[i]=0;D.vy[i]=0.5}rubDirty=true}
function secUpdate(dt){
  if(!SEC)return;
  const t=secTargets();let moving=false;
  for(let i=0;i<SEC.st.length;i++){const s=SEC.st[i];
    if(s.y>t[i]+0.005){s.vy-=30*dt;s.y=Math.max(t[i],s.y+s.vy*dt);moving=true;
      if(s.y<=t[i]+0.005){const v=-s.vy;s.vy=0;s.y=t[i];secLand(i,v)}}
    else if(s.y<t[i]){s.y=t[i]}
  }
  if(moving){secDirty=true;wakeAllRubble()}
  secUpdateTools(dt);if(BOSS)bossUpdate(dt);clientUpdate(dt);
  if(SEC.rebar){SEC.rebarT=(SEC.rebarT||0)+dt;if(SEC.rebarT>0.2){SEC.rebarT=0;const c=SEC.els.filter(e=>e.alive&&(e.kind==='col'||e.kind==='core')&&e.k>=0);if(c.length)secDamage(c[Math.floor(Math.random()*Math.min(c.length,c.length*0.5+3))],0.5)}}
  // 레드펜
  if(sBeam&&firing){humStart();const h=sBeam.hit;if(h&&h.el&&h.el.alive){secDamage(h.el,3.5*dt);addScore(60*dt*secNightK(h.el.k))}
    if(Math.random()<0.5)spawn(sBeam.x,sBeam.y,sBeam.z,(Math.random()-.5)*8,4+Math.random()*6,2+Math.random()*6,0.3+Math.random()*0.4,[1,0.4,0.1],0.3,1)}
  // 쇠공·도면 (앞쪽에서 날아옴)
  for(let i=SFALL.length-1;i>=0;i--){const o=SFALL[i];o.t-=dt;if(o.t>0)continue;o.z+=o.vz*dt;o.rot=(o.rot||0)+dt*5;
    if(o.z<=o.tz){SFALL.splice(i,1);o.hit(o)}}
  // 지진: 아래층(특히 필로티)일수록 큰 피해
  if(sQuake){sQuake.t+=dt;cam.shake=Math.max(cam.shake,3.5*(1-sQuake.t/sQuake.dur));sQuake.acc+=dt;
    if(sQuake.acc>0.12){sQuake.acc=0;
      const cand=SEC.els.filter(e=>e.alive&&(e.kind==='col'||e.kind==='wall'||e.kind==='core')&&SEC.S(e.k).state==='ok');
      for(let n=0;n<3&&cand.length;n++){const e=cand[Math.floor(Math.random()*cand.length)];
        const lvl=e.k+SEC.nb,w=(1/(1+lvl*0.35))*(e.k===0&&SEC.piloti?3:1)*(e.kind==='core'?0.25:1);
        if(Math.random()<w*0.7)secDamage(e,0.8)}}
    if(sQuake.t>sQuake.dur)sQuake=null}
}
function secLand(i,v){
  // 위층 덩어리가 무너진 층 위로 떨어질 때 → 그 아래층 기둥에 충격 (연쇄 붕괴)
  const below=SEC.st[i-1];if(!below||below.state==='ok'||v<5)return;
  if(SEC.st[i].state==='crushed')return;
  const mass=SEC.st.slice(i).filter(s=>s.state==='ok').length;
  const under=SEC.st[i-2];if(!under||under.state!=='ok')return;
  const p=Math.min(0.95,0.1*mass+v*0.012);
  for(const e of SEC.els)if(e.k===under.k&&e.alive&&(e.kind==='col'||e.kind==='core')&&Math.random()<p*(e.kind==='core'?0.6:1))secDestroy(e);
  secBoom(0,under.y+under.h,SEC.D*0.3,20);cam.shake=Math.max(cam.shake,6);sfx(25);
  secCheck();
}

// ---------- 피해 ----------
function elWorld(e){const s=SEC.S(e.k),b=e.box;return[b[0],b[1]+s.y,b[2],b[3],b[4]+s.y,b[5]]}
function secDamage(e,d){if(!e.alive||e.hp0>=1e8)return;if(SEC.tapeK&&SEC.tapeK.size&&!e.cx&&SEC.tapeK.has(e.k)&&d<1.2)d*=0.35;e.hp-=d;if(BOSS&&SEC.b===BOSS.b&&Math.random()<0.3)bossHit(e.kind==='col'||e.kind==='core'?'col':'facade');if(e.hp<=0)secDestroy(e);secDirty=true;if(!SEC_BATCH)secCheck()}
function secDestroy(e,quiet){
  if(!e.alive)return;e.alive=false;secDirty=true;
  if(e.cx){clientSecBroke(e)}else addScore(e.w*400*secNightK(e.k));
  const it=e.name&&ITEMS[e.name];if(it){addScore(it.pts);if(!SEC.shown[e.name]){SEC.shown[e.name]=1;toast(it.msg+' +'+fmt(it.pts))}
    const [a0,b0,c0,a1,b1,c1]=elWorld(e),cx=(a0+a1)/2,cy=b1,cz=(c0+c1)/2;
    if(e.name==='plotter'||e.name==='rolls'){   // 롤지·청사진이 사방으로 터져 날림
      for(let k=0;k<26;k++)spawn(cx,cy,cz,(Math.random()-.5)*9,5+Math.random()*7,(Math.random()-.5)*9,0.25+Math.random()*0.3,Math.random()<0.6?[0.97,0.97,0.95]:[0.35,0.5,0.85],2.5+Math.random()*1.5,3)}
    if(e.name==='model'){                         // 칼라보드·스티로폼이 눈보라처럼
      const cs=[[0.98,0.98,0.97],[0.98,0.98,0.97],[0.9,0.25,0.2],[0.25,0.45,0.85],[0.98,0.8,0.2]];
      for(let k=0;k<30;k++)spawn(cx,cy,cz,(Math.random()-.5)*6,3+Math.random()*5,(Math.random()-.5)*6,0.12+Math.random()*0.18,cs[k%cs.length],3+Math.random()*1.5,3)}}
  const [x0,y0,z0,x1,y1,z1]=elWorld(e);const vol=(x1-x0)*(y1-y0)*(z1-z0);
  const n=Math.min(quiet?3:10,Math.ceil(vol/3)+1);
  for(let i=0;i<n;i++){const x=x0+Math.random()*(x1-x0),y=y0+Math.random()*(y1-y0),z=z0+Math.random()*(z1-z0);
    const c=e.glass&&Math.random()<0.5?C_GLASS:e.col;
    spawn(x,y,z,(Math.random()-.5)*6,Math.random()*4,1+Math.random()*5,0.25+Math.random()*Math.min(0.9,(x1-x0+z1-z0)*0.2),c)}
  if(e.kind==='slab'){for(const p of SEC.els)if(p.k===e.k&&p.kind==='prop'&&p.alive)secDestroy(p,true)}
}
function boxDist(b,x,y,z){const dx=Math.max(b[0]-x,0,x-b[3]),dy=Math.max(b[1]-y,0,y-b[4]),dz=Math.max(b[2]-z,0,z-b[5]);return Math.hypot(dx,dy,dz)}
function secBlast(x,y,z,r,dmg){for(const e of SEC.els){if(!e.alive)continue;const d=boxDist(elWorld(e),x,y,z);if(d<r)secDamage(e,dmg*(1-d/r*0.7))}}
function secBoom(x,y,z,size){const n=Math.min(50,Math.floor(size*2));
  for(let k=0;k<n;k++){const a=Math.random()*Math.PI*2,s=Math.random()*size*0.5;spawn(x+Math.cos(a)*s*0.2,y,z+Math.sin(a)*s*0.2,Math.cos(a)*s,4+Math.random()*size*0.4,Math.sin(a)*s+2,0.5+Math.random()*size*0.05,Math.random()<0.5?[1,0.62,0.2]:[1,0.85,0.4],0.4+Math.random()*0.5,1)}
  sfx(size)}

// ---------- 무기 (단면 모드) — 클릭형 도구 ----------
function secFire(wi,h){
  const id=wi<0?'nuke':WEAPONS[wi].id;
  if(id!=='blast')SEC.hits=(SEC.hits||0)+1;
  if(id==='crew'){secSpawnCrew(h);return}
  if(id==='pour'){secPour(h);return}
  if(id==='blast'){placeDynSec(h);return}
  if(id==='stamp'){secStamp();return}
  if(id==='sink'){secSinkStorm(h);return}
  if(id==='extrude'){toast('EXTRUDE: 누른 채로 위로 끌어올리세요');return}
  if(id==='rebar'){for(const e of SEC.els)if(e.alive&&(e.kind==='col'||e.kind==='core'))e.hp=Math.min(e.hp,e.hp0*0.4);SEC.rebar=1;SREB={t:0};toast('철근 빼는 중… 순살 구조라 자기 무게도 못 버텨요',3000);sfx(15,1.6);secDirty=true;return}
  if(id==='nuke'){const f=$('#flash');f.style.background='#fff';f.style.transition='none';f.style.opacity=1;requestAnimationFrame(()=>{f.style.transition='opacity 1.6s';f.style.opacity=0});
    for(const e of SEC.els){if(!e.alive)continue;const lv=e.k+SEC.nb;if((e.kind==='col'||e.kind==='core')&&e.k>=0&&e.k<=1)secDestroy(e);else if(Math.random()<0.5/(1+lv*0.1))secDamage(e,2)}
    secBoom(0,4,SEC.D*0.3,40);cam.shake=12;toast('클라이언트: "그냥 전부 다시 해와요"');secCheck()}
}

// =====================================================================
//  단면 모드 도구 — 화면에 실제로 보이는 장비·인부 + 선 긋기/끌기 조작
// =====================================================================
let SEC_BATCH=false;
let SCREW=[], SCRANES=[], SHELD=null, SFLY=[], SEXT=null, SSLICE=[], SCUT=[], SSTAMP=null, SPOUR=null, SREB=null;
function secClearTools(){SCREW=[];SDOZ=[];SCRANES=[];SHELD=null;SFLY=[];SEXT=null;SSLICE=[];SCUT=[];SSTAMP=null;SPOUR=null;SREB=null;
  CHARGES=CHARGES.filter(c=>c.kind!=='sec');updateDetBtn();clearFx();gesture=null;drawGesture()}
function secPlane(mx,my,zp){if(!SEC)return null;if(zp==null)zp=SEC.D/2;const {o,d}=rayFrom(mx,my);if(Math.abs(d[2])<1e-6)return null;const t=(zp-o[2])/d[2];if(t<0)return null;return{x:o[0]+d[0]*t,y:o[1]+d[1]*t,z:zp}}
function secTop(){let t=0;for(const s of SEC.st)if(s.state==='ok')t=Math.max(t,s.y+s.h+(s===SEC.st[SEC.st.length-1]?SLAB_T:0));return t}
function box2(b,x,y){const dx=Math.max(b[0]-x,0,x-b[3]),dy=Math.max(b[1]-y,0,y-b[4]);return Math.hypot(dx,dy)}
// 부재 높이 위쪽 표면 (x 위치에서 살아있는 부재의 가장 높은 윗면)
function secSurfX(x0,x1){let top=0;for(const e of SEC.els){if(!e.alive||e.kind==='prop')continue;const b=elWorld(e);if(b[3]>x0&&b[0]<x1&&b[4]>top)top=b[4]}return top}
// z축 회전 상자 (단면 평면에서 기울어지는 덩어리)
function pushBoxZ(m,x,y,z,sx,sy,sz,ang,c){const cr=Math.cos(ang),sr=Math.sin(ang);m.grow(36);
  for(const [p,n] of CUBE){const px=p[0]*sx,py=p[1]*sy,pz=p[2]*sz;m.v(x+px*cr-py*sr,y+px*sr+py*cr,z+pz,(n[0]*cr-n[1]*sr)*0.8,(n[0]*sr+n[1]*cr)*0.8,n[2]*0.8,c[0],c[1],c[2])}}
function drawGroup(m,g){const c=Math.cos(g.rot),s=Math.sin(g.rot);
  for(const it of g.items){const b=it.b,bx=(b[0]+b[3])/2,by=(b[1]+b[4])/2,bz=(b[2]+b[5])/2;
    pushBoxZ(m,g.x+bx*c-by*s,g.y+bx*s+by*c,bz,b[3]-b[0],b[4]-b[1],b[5]-b[2],g.rot,it.col)}}
function groupBreak(g,x,y){let n=0;const c=Math.cos(g.rot),s=Math.sin(g.rot);
  for(const it of g.items){if(n>160)break;const b=it.b,bx=(b[0]+b[3])/2,by=(b[1]+b[4])/2;if(Math.random()<0.5&&g.items.length>80)continue;n++;
    spawn(g.x+bx*c-by*s,g.y+bx*s+by*c,(b[2]+b[5])/2,(Math.random()-.5)*12+g.vx*0.2,3+Math.random()*7,1+Math.random()*6,0.3+Math.random()*Math.min(1.2,(b[3]-b[0]+b[4]-b[1])*0.25),it.col)}}
// 2D(단면 평면) 범위 피해 — 깊이 방향 전체를 관통
function secHit2D(x,y,r,dmg,set){SEC_BATCH=true;let n=0;
  for(const e of SEC.els){if(!e.alive||e.hp0>=1e8)continue;if(set&&set.has(e))continue;const d=box2(elWorld(e),x,y);if(d<r){secDamage(e,dmg*(1-d/r*0.6));if(set)set.add(e);n++}}
  SEC_BATCH=false;if(n)secCheck();return n}

// ---------- 철거반 인부떼 ----------
function secSpawnCrew(h){
  const room=120-SCREW.filter(w=>!w.gone).length;if(room<8){toast('현장에 인부가 꽉 찼어요 — 잠시 뒤 다시');return}
  const ok=SEC.st.filter(s=>s.state==='ok'&&s.k>=0);if(!ok.length){toast('올라갈 층이 남아있지 않아요');return}
  const n=Math.min(room,clamp(Math.round(SEC.W*1.1+ok.length*1.6),24,60));const side=h.x>=0?1:-1,W=SEC.W,D=SEC.D;
  for(let i=0;i<n;i++){const s=ok[Math.random()<0.65?Math.min(ok.length-1,Math.floor(Math.random()*2)):Math.min(ok.length-1,Math.floor(Math.pow(Math.random(),1.4)*ok.length))];const sd=Math.random()<0.75?side:-side;
    SCREW.push({x:sd*(W/2+8+Math.random()*24),y:0,z:D/2-0.8-Math.random()*3.4,k:s.k,side:sd,state:'run',t:-Math.random()*1.6,el:null,vy:0,dir:sd>0?Math.PI:0,born:0,
      vest:Math.random()<0.5?[1,0.45,0.1]:[0.95,0.85,0.15],helm:Math.random()<0.3?[0.95,0.95,0.95]:[0.98,0.8,0.1]})}
  toast(`철거반 ${n}명 투입! 반장: "층마다 기둥 하나씩 맡아!"`,2000);sfx(10,1.2);floatText(side*(W/2+6),3,D/2,`인부 ${n}명`,'cad',1.5);
}
function secCrewTarget(w){let best=null,bd=1e9;
  for(const e of SEC.els){if(!e.alive||e.k!==w.k||(e.kind!=='col'&&e.kind!=='core'))continue;const cx=(e.box[0]+e.box[3])/2;
    const dd=Math.abs(cx-w.x)+(e.kind==='core'?3:0)+Math.random()*4;if(dd<bd){bd=dd;best=e}}return best}
function updateSecCrew(dt){const W=SEC.W;
  for(const w of SCREW){if(w.gone)continue;w.t+=dt;w.born+=dt;if(w.t<0)continue;const s=SEC.S(w.k);
    if(w.born>45&&w.state!=='fall'&&w.state!=='leave'){w.state='fall';w.vy=1}
    if((w.state==='climb'||w.state==='walk'||w.state==='hit')&&(!s||s.state!=='ok')){w.state='fall';w.vy=1}
    if(w.state==='run'){const tx=w.side*(W/2+0.5),dx=tx-w.x;if(Math.abs(dx)<0.3){w.x=tx;w.state=w.k===0?'walk':'climb'}else{w.x+=Math.sign(dx)*Math.min(Math.abs(dx),9*dt);w.dir=dx>0?0:Math.PI}w.y=0}
    else if(w.state==='climb'){const ty=s.y+SLAB_T;w.dir=w.side>0?Math.PI:0;if(w.y<ty)w.y=Math.min(ty,w.y+6.5*dt);else{w.y=ty;w.state='walk'}}
    else if(w.state==='walk'){w.y=s.y+SLAB_T;if(!w.el||!w.el.alive)w.el=secCrewTarget(w);
      if(!w.el){const up=SEC.S(w.k+1);if(up&&up.state==='ok'){w.k++;w.state='climb'}else{w.state='fall';w.vy=2}continue}
      const b=w.el.box,cx=(b[0]+b[3])/2,sg=Math.sign(cx-w.x)||1,tx=cx-sg*((b[3]-b[0])/2+0.35),tz=Math.min(SEC.D/2-0.4,b[5]+0.35);
      const dx=tx-w.x,dz=tz-w.z,l=Math.hypot(dx,dz);if(l<0.25){w.state='hit';w.t=Math.random()*0.3;w.dir=sg>0?0:Math.PI}
      else{const sp=Math.min(l,5*dt);w.x+=dx/l*sp;w.z+=dz/l*sp;w.dir=Math.atan2(dz,dx)}}
    else if(w.state==='hit'){w.y=s.y+SLAB_T;if(!w.el||!w.el.alive){w.state='walk';continue}
      if(w.t>0.45){w.t=0;secDamage(w.el,w.el.kind==='core'?0.35:0.5);addScore(90*secNightK(w.el.k));
        spawn(w.x+Math.cos(w.dir)*0.5,w.y+1.1,w.z,(Math.random()-.5)*3,2,1+Math.random()*2,0.18,[0.72,0.71,0.68]);
        if(Math.random()<0.3)spawn(w.x+Math.cos(w.dir)*0.5,w.y+1.2,w.z+0.2,(Math.random()-.5)*2,2,1,0.1,[1,0.85,0.4],0.25,1)}}
    else if(w.state==='fall'){w.vy-=30*dt;w.y+=w.vy*dt;w.x+=w.side*1.5*dt;w.dir+=dt*8;const g=surfaceAt(w.x,w.y,w.z);if(w.y<=g&&g>-300){w.y=g;w.state='leave';w.t=0}else if(w.y<-60)w.gone=true}
    else if(w.state==='leave'){w.x+=Math.sign(w.x||1)*9*dt;w.dir=w.x>0?0:Math.PI;if(Math.abs(w.x)>W/2+0.5)w.y=Math.max(0,w.y-12*dt);if(w.t>4)w.gone=true}}
  if(SCREW.length&&SCREW.every(w=>w.gone))SCREW=[];
}

// ---------- 불도저 (단면) — 시작한 층 바닥을 따라 좌우로 밀고 가며 터널 ----------
let SDOZ=[];
const SD_S=1.8;   // 단면 불도저 크기 (위층 바닥까지 긁고 지나감)
function secDozerLine(A,B){const dxs=B.x-A.x;if(Math.abs(dxs)<3){toast('불도저: 좌우로 길게 그어주세요 (단면에서는 그 층을 따라 밀고 가요)');SUNDO.pop();return}
  const dir=Math.sign(dxs),z=SEC.D/2-2.6,hw=SEC.W/2;
  // 선이 건물을 지나가는 높이의 층으로 출발 (건물 밖에서 시작하면 그 층 외벽 안쪽에 내려놓음)
  let x0=A.x,drop=0;if(Math.abs(A.x)>=hw&&dir===-Math.sign(A.x)){x0=Math.sign(A.x)*(hw-1)}
  const yl=A.y+(B.y-A.y)*((x0-A.x)/(B.x-A.x||1));let y0=Math.max(0,surfaceAt(x0,yl+0.5,z));if(y0>1)drop=4;
  if(Math.abs(A.x)>=hw&&y0<=1)x0=A.x-dir*10;
  SDOZ.push({x:x0,y:y0+drop,vy:0,z,dir,end:B.x+dir*8,v:3,acc:0,t:0,hits:new Set(),gone:0,inB:false});
  SEC.hits=(SEC.hits||0)+1;toast('불도저 출동 — 그 층을 밀고 지나가요!',1300);sfx(12,1.5);statTool('dozer')}
function updateSecDozers(dt){
  for(let i=SDOZ.length-1;i>=0;i--){const d=SDOZ[i];d.t+=dt;
    if(d.dir*(d.x-d.end)>0){d.gone+=dt;if(d.gone>1)SDOZ.splice(i,1);continue}
    const inB=Math.abs(d.x)<SEC.W/2;const vmax=inB?11:24;d.v+=(vmax-d.v)*Math.min(1,dt*(inB?5:2.5));d.x+=d.dir*d.v*dt;
    if(inB&&!d.inB){hitStop(0.05);cam.shake=Math.max(cam.shake,2.5);secBoom(d.x+d.dir*3,d.y+1.5,d.z,10);sfxBoom(0.4);floatText(d.x+d.dir*3,d.y+3,SEC.D/2,'쾅!','boom',0.7)}d.inB=inB;
    // 바닥 따라가기 (아래층이 무너지면 같이 떨어짐)
    const g=surfaceAt(d.x,d.y+0.3,d.z),gg=g<-300?0:g;if(d.y>gg+0.05){d.vy-=30*dt;d.y=Math.max(gg,d.y+d.vy*dt)}else{d.y=gg;d.vy=0}
    d.acc+=dt;if(d.acc>0.08){d.acc=0;const bx=d.x+d.dir*3.1*SD_S;
      const n=secHit2D(bx,d.y+2.0,2.5,1.6);if(n){cam.shake=Math.max(cam.shake,1.2);
        for(let q=0;q<3;q++)spawn(bx,d.y+1+Math.random()*1.5,d.z+0.5,d.dir*(5+Math.random()*5),2+Math.random()*3,1+Math.random()*3,0.25+Math.random()*0.5,Math.random()<0.5?C_COL:C_SLAB)}}
    if(Math.random()<0.3)spawn(d.x-d.dir*2,d.y+4.5*SD_S*0.7,d.z,0,3,0,0.35,[0.35,0.35,0.36],0.8,2)}}
function drawSecDozers(m){for(const d of SDOZ){if(d.gone>1)continue;drawDozerAt(m,d.x,d.y,d.z,d.dir,0,SD_S,d.inB?(Math.random()-.5)*0.12:0)}}

// ---------- 쇠공 (선 긋기) ----------
const SBALL=1.9;
function secCraneLine(A,B){let dx=B.x-A.x,dy=B.y-A.y,L=Math.hypot(dx,dy);
  if(L<3){toast('쇠공: 휘두를 방향으로 길게 선을 그어주세요');SUNDO.pop();return}
  if(L>100){B={x:A.x+dx*100/L,y:A.y+dy*100/L,z:B.z};L=100}
  const mx=(A.x+B.x)/2,top=Math.max(secTop(),A.y,B.y),side=mx>=0?1:-1;
  SCRANES.push({A,B,L,piv:{x:mx,y:top+12+L*0.12},mastX:side*(SEC.W/2+15),z:SEC.D/2-1.2,t:0,grow:0,phase:'rise',pass:0,lastS:0,hit:new Set(),trail:[],touched:false});
  SEC.hits=(SEC.hits||0)+1;sfx(8);toast('쇠공 — 그은 선을 따라 휘둘러요!',1300);statTool('crane')}
function sBall(c,s){const sag=Math.sin(Math.PI*s)*Math.min(4,c.L*0.08);return[c.A.x+(c.B.x-c.A.x)*s,c.A.y+(c.B.y-c.A.y)*s-sag]}
function updateSecCranes(dt){
  for(let i=SCRANES.length-1;i>=0;i--){const c=SCRANES[i];c.t+=dt;
    if(c.phase==='rise'){c.grow=Math.min(1,c.grow+dt*2.6);if(c.grow>=1){c.phase='swing';c.t=0;sfx(12,0.8)}continue}
    if(c.phase==='swing'){const T=0.5+c.L/80,u=Math.min(1,c.t/T),e=(1-Math.cos(Math.PI*u))/2,s=c.pass===0?e:1-e,pw=c.pass===0?1:0.6;
      const a=c.lastS,n=Math.max(1,Math.ceil(Math.abs(s-a)*c.L/0.8)),spd=Math.abs(s-a)*c.L/Math.max(dt,1e-3);
      for(let k=1;k<=n;k++){const p=sBall(c,a+(s-a)*k/n);const hit=secHit2D(p[0],p[1],SBALL+0.5,(2.2+Math.min(3,spd/20))*pw,c.hit);
        if(hit&&!c.touched){c.touched=true;hitStop(0.06);cam.shake=Math.max(cam.shake,3.5*pw);secBoom(p[0],p[1],c.z,10);sfxBoom(0.5*pw)}
        if(hit&&Math.random()<0.5)for(let q=0;q<4;q++)spawn(p[0],p[1],c.z+0.5,(Math.random()-.5)*14,3+Math.random()*6,1+Math.random()*6,0.3+Math.random()*0.6,C_SLAB)}
      c.lastS=s;const bp=sBall(c,s);c.trail.push(bp);if(c.trail.length>7)c.trail.shift();
      if(u>=1){if(c.pass===0){c.pass=1;c.t=0;c.hit=new Set();c.touched=false;c.trail=[]}else{c.phase='retract';c.t=0}}continue}
    c.grow-=dt*1.8;if(c.grow<=0)SCRANES.splice(i,1)}
}
function drawSecCranes(m,mg){for(const c of SCRANES){const g=clamp(c.grow,0,1),H=(c.piv.y+2)*g,x=c.mastX,z=c.z-2;
  pushShape(m,CUBE,x,H/2,z,1.4,H,1.4,0,YEL,0);for(let y=4;y<H-1;y+=4)pushShape(m,CUBE,x,y,z,1.6,0.25,1.6,0,YEL_D,0);
  if(g<0.5)continue;const top=H,L=Math.abs(c.piv.x-x);
  pushShape(m,CUBE,(x+c.piv.x)/2,top,z,L+3,0.9,0.9,0,YEL,0);pushShape(m,CUBE,x+Math.sign(x-c.piv.x)*4,top,z,8,0.8,0.8,0,YEL_D,0);
  pushShape(m,CUBE,x,top+1,z,1.8,1.2,1.8,0,[0.95,0.95,0.93],0);
  const p=c.phase==='swing'?sBall(c,c.lastS):c.phase==='rise'?(q=>[q[0],q[1]+(1-g)*15])(sBall(c,0)):sBall(c,c.pass?0:1);const by=Math.min(p[1],top-1.5);
  drawSeg(m,[c.piv.x,top,z],[p[0],by+SBALL,c.z],0.18,STEEL);pushShape(m,SPHERE,p[0],by,c.z,SBALL,SBALL,SBALL,0,[0.16,0.16,0.18],0);
  if(c.phase==='swing')c.trail.forEach((q,k)=>{const s=SBALL*(0.3+k/c.trail.length*0.5);pushShape(mg,CUBE,q[0],q[1],c.z,s,s,s,k,[0.95,0.9,0.75],1)})}}

// ---------- 다이너마이트 ----------
function placeDynSec(h){if(CHARGES.length>=MAX_CHARGES){toast(`장약은 ${MAX_CHARGES}개까지 — Space 로 기폭!`);return}
  const z=Math.min(h.z,SEC.D/2)+0.25;const c={kind:'sec',el:h.el,x:h.x,y:h.y,z,s:1.5,t:0};
  if(h.el){const b=elWorld(h.el);c.off=[h.x-b[0],h.y-b[1]]}CHARGES.push(c);sfx(3,0.15);updateDetBtn();
  toast(`다이너마이트 ${CHARGES.length}개 — Space 또는 [기폭] 버튼`,1500)}
function secChargePos(c){if(c.el&&c.off&&c.el.alive){const b=elWorld(c.el);c.x=b[0]+c.off[0];c.y=b[1]+c.off[1]}return c}
function secExplodeCharge(c){if(!SEC)return;secChargePos(c);secHit2D(c.x,c.y,5.5,9);impact(c.x,c.y,c.z,1.0);floatText(c.x,c.y+2,c.z,'쾅!','boom',1);addScore(2000);SEC.hits=(SEC.hits||0)+1}

// ---------- MOVE: 층을 통째로 빼서 던지기 ----------
function secGrabStart(h,mx,my){const s=SEC.S(h.el.k);if(!s||s.state!=='ok'||s.k<0){toast('지상층 부재를 잡아주세요');return false}
  const cy=s.y+s.h/2,items=[];
  for(const e of SEC.els){if(e.k!==s.k||!e.alive||e.hp0>=1e8)continue;const b=elWorld(e);items.push({b:[b[0],b[1]-cy,b[2],b[3],b[4]-cy,b[5]],col:e.glass?C_GLASS:e.col});e.alive=false}
  if(!items.length)return false;s.state='gone';secDirty=true;SEC.hits=(SEC.hits||0)+1;
  SHELD={items,x:0,y:cy,tx:0,ty:cy,vx:0,vy:0,h:s.h,rot:0};secGrabMove(mx,my);
  cmdLine(['명령: MOVE',`객체 선택: ${floorName(s.k)} 통째로`,'끌어서 던지세요 — 빠진 자리로 위층이 내려앉아요']);sfx(8);addScore(2500);statTool('move');
  return true}
function secGrabMove(mx,my){if(!SHELD)return;const p=secPlane(mx,my,0);if(p){SHELD.tx=p.x;SHELD.ty=Math.max(p.y,SHELD.h/2+0.2)}}
function secGrabRelease(){const h=SHELD;if(!h)return;SHELD=null;const sp=Math.hypot(h.vx,h.vy),k=sp>70?70/sp:1;
  SFLY.push({items:h.items,x:h.x,y:h.y,vx:h.vx*k,vy:h.vy*k+3,h:h.h,rot:h.rot,spin:-h.vx*k*0.02,t:0});floatText(h.x,h.y+h.h,SEC.D/2,'MOVE','cad',1)}
function updateSecMove(dt){
  if(SHELD){const h=SHELD,k=Math.min(1,dt*8),nx=h.x+(h.tx-h.x)*k,ny=h.y+(h.ty-h.y)*k;
    h.vx=h.vx*0.6+((nx-h.x)/Math.max(dt,1e-3))*0.4;h.vy=h.vy*0.6+((ny-h.y)/Math.max(dt,1e-3))*0.4;h.x=nx;h.y=ny;h.rot=clamp(-h.vx*0.008,-0.4,0.4);
    if(Math.random()<0.2)spawn(h.x+(Math.random()-.5)*SEC.W*0.8,h.y-h.h/2,SEC.D/2-1,0,-2,0,0.2+Math.random()*0.3,C_SLAB)}
  for(let i=SFLY.length-1;i>=0;i--){const f=SFLY[i];f.t+=dt;f.vy-=30*dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.rot+=f.spin*dt;
    const hw=SEC.W/2,bot=f.y-f.h/2;
    const surf=Math.abs(f.x)<SEC.W/2+hw?secSurfX(f.x-hw*0.8,f.x+hw*0.8):0;
    if(f.vy<0&&bot<=surf||f.y<-80||f.t>8){SFLY.splice(i,1);if(f.y<-80||f.t>8)continue;
      const sp=Math.hypot(f.vx,f.vy),pw=1.5+sp*0.12;SEC_BATCH=true;let n=0;
      for(const e of SEC.els){if(!e.alive||e.hp0>=1e8)continue;const b=elWorld(e);if(b[3]>f.x-hw&&b[0]<f.x+hw&&b[4]>bot-5&&b[1]<bot+1.5){secDamage(e,pw*(0.6+Math.random()*0.6));n++}}
      SEC_BATCH=false;secCheck();groupBreak(f,f.x,bot);impact(f.x,Math.max(0.3,bot),SEC.D/2-1,clamp(0.6+sp/35,0.6,1.8));addScore(n*400+2000);
      toast(n?`던진 층이 꽂혔어요! 부재 ${n}개 파손`:'던진 층이 땅에 떨어졌어요',1600)}}
}

// ---------- EXTRUDE: 위로 끌어 증축 → 놓으면 하중 초과 ----------
function secAddStory(){
  if(SEC.st.length>=110)return false;const top=SEC.st[SEC.st.length-1];if(top.state!=='ok')return false;
  const k=top.k+1,h=FLOOR_H,{W,D,xs,zs,add,inCore,cw,cd,czc,wallCol}=SEC;
  SEC.st.push({k,h,y0:top.y0+top.h,y:top.y+top.h,vy:0,state:'ok',added:1});
  add(k,'slab',[-W/2,0,-D/2,W/2,SLAB_T,D/2],2,5,C_SLAB);
  for(const x of xs)for(const z of zs){if(inCore(x,z))continue;add(k,'col',[x-0.38,SLAB_T,z-0.38,x+0.38,h,z+0.38],2,3,C_COL)}
  add(k,'core',[-cw/2,SLAB_T,czc-cd/2,cw/2,h,czc+cd/2],5,6,C_CORE);
  for(let i=0;i<xs.length-1;i++)add(k,'wall',[xs[i],SLAB_T,-D/2,xs[i+1],h,-D/2+0.3],1,1,wallCol,{glass:0.55});
  for(let i=0;i<zs.length-1;i++){add(k,'wall',[-W/2,SLAB_T,zs[i],-W/2+0.3,h,zs[i+1]],1,1,wallCol,{glass:0.55});add(k,'wall',[W/2-0.3,SLAB_T,zs[i],W/2,h,zs[i+1]],1,1,wallCol,{glass:0.55})}
  const roof=SEC.els.find(e=>e.kind==='roof');if(roof){roof.k=k;roof.box=[-W/2,h,-D/2,W/2,h+SLAB_T,D/2];roof.alive=true}
  SEC.N++;secDirty=true;return true}
function secExtStart(my){const top=secTop();const a=project(SEC.W/2,top,SEC.D/2),b=project(SEC.W/2,top+FLOOR_H,SEC.D/2);
  SEXT={my0:my,pps:a&&b?Math.max(10,Math.abs(a[1]-b[1])):20,added:0,n0:SEC.st.filter(s=>s.k>=0&&s.state==='ok').length};SEC.hits=(SEC.hits||0)+1;
  cmdLine(['명령: EXTRUDE','돌출 높이 지정: 위로 끌어올리세요']);statTool('extrude')}
function secExtMove(my){if(!SEXT)return;const want=clamp(Math.floor((SEXT.my0-my)/SEXT.pps),0,Math.max(0,90-SEXT.n0));
  while(SEXT.added<want){if(!secAddStory())break;SEXT.added++;addScore(150);sfx(2);const t=SEC.st[SEC.st.length-1];if(SEXT.added%3===0)floatText(SEC.W/2+2,t.y+t.h,SEC.D/2,`+${SEXT.added}층`,'cad',0.7)}
  const H=secTop();cam.ty=Math.max(cam.ty,H*0.45);cam.dist=Math.max(cam.dist,H*1.45)}
function secExtRelease(){const e=SEXT;SEXT=null;if(!e||!e.added){if(e)SUNDO.pop();return}
  makeSecLabels();const r=e.added/Math.max(1,e.n0);
  cmdLine(['명령: EXTRUDE',`돌출: +${e.added}층`,r>0.25?'용적률 검토: 초과 ⚠ 하부 기둥 하중 초과':'용적률 검토: 통과']);
  if(r<=0.25){toast('아직 버틸 만해요 — 더 높이 끌어올려 보세요',2000);return}
  const ok=SEC.st.filter(s=>s.state==='ok'&&s.k>=0);const n=Math.min(ok.length-1,Math.max(1,Math.round(ok.length*Math.min(0.85,r*0.45))));
  toast(`용적률 초과! 아래층부터 ${n}개 층이 하중을 못 버텨요`,2600);cam.shake=Math.max(cam.shake,2.5);sfx(20,1.5);
  for(let i=0;i<n;i++){const s=ok[i];later(0.7+i*0.5,()=>{if(!SEC||s.state!=='ok')return;
    for(const el of SEC.els)if(el.k===s.k&&el.alive&&(el.kind==='col'||el.kind==='core'))el.hp=Math.min(el.hp,el.hp0*0.15);secDirty=true;cam.shake=Math.max(cam.shake,2);
    later(0.2,()=>{if(SEC&&s.state==='ok'){crushStory(s);impact(0,s.y+1,SEC.D/2-1,0.8);secCheck()}})})}}

// ---------- TRIM: 선을 그어 자르기 ----------
function secTrim(A,B){let dx=B.x-A.x,dy=B.y-A.y;const L=Math.hypot(dx,dy);if(L<2){cmdLine(['명령: TRIM','절단선을 길게 그어주세요']);SUNDO.pop();return}
  let nx=-dy/L,ny=dx/L;if(ny<0){nx=-nx;ny=-ny}
  if(ny<0.08){nx=(A.x+B.x)/2>=0?1:-1;ny=0}   // 거의 수직선 → 바깥쪽을 잘라냄
  const sv=(x,y)=>(x-A.x)*nx+(y-A.y)*ny;const items=[];let cutN=0;SEC_BATCH=true;
  for(const e of SEC.els){if(!e.alive||e.hp0>=1e8)continue;const b=elWorld(e);
    const v=[sv(b[0],b[1]),sv(b[3],b[1]),sv(b[0],b[4]),sv(b[3],b[4])],mn=Math.min(...v),mx=Math.max(...v);
    if(mn>0.02){items.push({b:b.slice(),col:e.glass?C_GLASS:e.col});e.alive=false;continue}
    if(mx<=0.02)continue;
    // 걸친 부재: 넓은 판(슬래브·지붕·코어)은 선을 따라 잘라 아래쪽만 남기고, 나머지는 끊어져 나감
    if((e.kind==='slab'||e.kind==='roof'||e.kind==='core')&&Math.abs(nx)>0.12){const ym=(b[1]+b[4])/2,xc=A.x-(ym-A.y)*ny/nx;
      const keepLeft=sv(b[0],ym)<0;const nb=keepLeft?[b[0],xc]:[xc,b[3]],cutp=keepLeft?[xc,b[3]]:[b[0],xc];
      if(nb[1]-nb[0]>0.6&&cutp[1]-cutp[0]>0.05){items.push({b:[cutp[0],b[1],b[2],cutp[1],b[4],b[5]],col:e.col});e.box[0]=nb[0];e.box[3]=nb[1];cutN++;continue}}
    secDestroy(e,true);cutN++}
  SEC_BATCH=false;
  for(const s of SEC.st){if(s.state!=='ok'||s.k<=-SEC.nb)continue;if(!SEC.els.some(e=>e.k===s.k&&e.alive&&e.kind!=='prop'))s.state='gone'}
  secDirty=true;secCheck();
  if(!items.length&&!cutN){cmdLine(['명령: TRIM','자를 객체 선택: 0개 — 건물을 가로질러 그어주세요']);SUNDO.pop();return}
  let cx=0,cy=0,mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;for(const it of items){const b=it.b;cx+=(b[0]+b[3])/2;cy+=(b[1]+b[4])/2}
  cx/=Math.max(1,items.length);cy/=Math.max(1,items.length);
  for(const it of items){const b=it.b;b[0]-=cx;b[3]-=cx;b[1]-=cy;b[4]-=cy;mnx=Math.min(mnx,b[0]);mxx=Math.max(mxx,b[3]);mny=Math.min(mny,b[1]);mxy=Math.max(mxy,b[4])}
  let tx=dx/L,ty=dy/L;if(ty>0){tx=-tx;ty=-ty}if(Math.abs(ty)<0.06){tx=Math.sign(cx)||1;ty=0}
  if(items.length)SSLICE.push({items,x:cx,y:cy,vx:0,vy:0,tx,ty,v:0,rot:0,w:0,t:0,phase:'slide',bb:[mnx,mxx,mny,mxy]});
  SCUT.push({A,B,t:0.7});SEC.hits=(SEC.hits||0)+1;
  for(let k=0;k<30;k++){const u=Math.random();spawn(A.x+dx*u,A.y+dy*u,SEC.D/2+0.2,(Math.random()-.5)*4,2+Math.random()*3,1+Math.random()*3,0.12,[0.6,0.9,1],0.5,1)}
  hitStop(0.08);flashScreen(0.25,'#9fd8ff');sfx(14,0.5);addScore(items.length*250+cutN*200);statTool('trim');
  floatText((A.x+B.x)/2,(A.y+B.y)/2+2,SEC.D/2,'TRIM','cad',1.3);
  cmdLine(['명령: TRIM','절단 경계 선택: 선 1개',`자를 객체 선택: ${items.length+cutN}개 — 위쪽이 미끄러져 떨어져요`]);
}
function updateSecSlices(dt){
  for(let i=SCUT.length-1;i>=0;i--){SCUT[i].t-=dt;if(SCUT[i].t<=0)SCUT.splice(i,1)}
  for(let i=SSLICE.length-1;i>=0;i--){const g=SSLICE[i];g.t+=dt;
    if(g.x0==null)g.x0=g.x;
    if(g.phase==='slide'){g.v+=12*dt;g.vx=g.tx*g.v;g.vy=g.ty*g.v;g.w=-Math.sign(g.tx||1)*0.7;if(Math.abs(g.x-g.x0)>(g.bb[1]-g.bb[0])*0.45||g.t>1.6){g.phase='fall';g.ft=0}}else{g.vy-=30*dt;g.ft+=dt}
    g.x+=g.vx*dt;g.y+=g.vy*dt;g.rot+=g.w*dt;
    if(g.phase!=='fall')continue;
    const c=Math.cos(g.rot),s=Math.sin(g.rot);let my=1e9,mxp=0;for(const [px,py] of [[g.bb[0],g.bb[2]],[g.bb[1],g.bb[2]],[g.bb[0],g.bb[3]],[g.bb[1],g.bb[3]]]){const y=g.y+px*s+py*c;if(y<my){my=y;mxp=g.x+px*c-py*s}}
    const surf=Math.abs(mxp)<SEC.W/2&&g.ft>0.3?secSurfX(mxp-0.5,mxp+0.5):0;
    if(my<=surf||g.t>7){SSLICE.splice(i,1);if(g.t>7)continue;const n=secHit2D(mxp,surf+0.5,7,4);groupBreak(g,mxp,surf);
      impact(mxp,Math.max(0.3,surf),SEC.D/2-1,clamp(0.5+g.items.length/120,0.5,1.8));addScore(n*300+1500)}}
}
function drawSecCut(mg){for(const c of SCUT){const a=c.t/0.7,dx=c.B.x-c.A.x,dy=c.B.y-c.A.y,L=Math.hypot(dx,dy),n=Math.ceil(L/0.6);
  for(let k=0;k<=n;k++){const u=k/n;pushShape(mg,CUBE,c.A.x+dx*u,c.A.y+dy*u,SEC.D/2+0.15,0.35*a+0.1,0.35*a+0.1,0.35*a+0.1,0,[0.55,0.88,1],1)}}}

// ---------- 레미콘 · 심의 보류 · 철근 빼기 (보이게) ----------
function secPour(h){if(SPOUR){toast('이미 타설 중이에요');return}const ok=SEC.st.filter(s=>s.state==='ok'&&s.k>=0);
  SPOUR={side:h.x>=0?1:-1,t:0,boom:0,load:0,state:'boom',n:Math.max(1,Math.ceil(ok.length*0.4)),done:0,acc:0};toast('레미콘 도착 — 옥상에 타설 시작',1500);sfx(10,1.4)}
function updateSecPour(dt){const p=SPOUR;if(!p)return;p.t+=dt;
  if(p.state==='boom'){p.boom=Math.min(1,p.boom+dt*0.9);if(p.boom>=1)p.state='pump'}
  else if(p.state==='pump'){p.load+=dt*0.55;const top=secTop();if(Math.random()<0.8)spawn((Math.random()-.5)*0.8,top+6,SEC.D/2-2.6+(Math.random()-.5)*0.6,(Math.random()-.5),-8,0,0.25+Math.random()*0.25,[0.58,0.58,0.56]);
    if(p.load>1.1){if(!p.warn){p.warn=1;toast('과타설! 설계하중 초과 — 위층부터 내려앉아요',2200)}p.acc+=dt;
      if(p.acc>0.7){p.acc=0;const ok=SEC.st.filter(s=>s.state==='ok'&&s.k>=0);const s=ok[ok.length-1];
        if(s&&ok.length>1){crushStory(s);impact(0,s.y+s.h,SEC.D/2-1,0.6);secCheck();p.done++}if(p.done>=p.n||ok.length<=1){p.state='leave';p.t=0}}}}
  else{p.boom=Math.max(0,p.boom-dt);if(p.t>2.5)SPOUR=null}}
function drawSecPour(m){const p=SPOUR;if(!p)return;const s=1.4,x=p.side*(SEC.W/2+9),z=SEC.D/2-2.6,top=secTop();
  pushShape(m,CUBE,x,1.2*s,z,5.6*s,0.8*s,2.2*s,0,[0.25,0.25,0.27],0);pushShape(m,CUBE,x-p.side*1.9*s,2.2*s,z,1.6*s,1.6*s,2.1*s,0,[0.95,0.95,0.95],0);
  pushShape(m,SPHERE,x+p.side*0.8*s,2.6*s,z,2.2*s,1.2*s,1.2*s,p.t*2,[0.98,0.55,0.12],0);
  if(p.boom>0){const root=[x,3.6*s,z],end=[0,top+6,z],mid=[(x)*0.55,Math.max(root[1],end[1])+8,z],k=p.boom;
    drawSeg(m,root,[root[0]+(mid[0]-root[0])*k,root[1]+(mid[1]-root[1])*k,z],0.5*s,YEL);if(k>=1)drawSeg(m,mid,end,0.45*s,YEL_D);
    if(p.load>0){const l=Math.min(1.4,p.load);pushShape(m,SPHERE,0,top+0.2,0,SEC.W*0.32*l,0.4+l*1.4,SEC.D*0.42*l,0,[0.6,0.6,0.58],0)}}}
function secStamp(){const ok=SEC.st.filter(s=>s.state==='ok'&&s.k>=0);const n=Math.max(1,Math.ceil(ok.length*0.4));
  const stop=ok.length>n?ok[ok.length-n].y:0;SSTAMP={y:secTop()+55,vy:-110,state:'drop',t:0,n,done:0,stop};sfx(5)}
function updateSecStamp(dt){const s=SSTAMP;if(!s)return;s.t+=dt;
  if(s.state==='drop'){s.y+=s.vy*dt;const top=secTop();if(s.y<=top){s.y=top;s.state='press';s.t=0;impact(0,top,SEC.D/2-1,1.1);floatText(0,top+4,SEC.D/2,'보 류','mark',3);toast(`심의 보류! 위에서 ${s.n}개 층을 찍어 눌러요`,2200)}}
  else if(s.state==='press'){s.y-=9*dt;for(const st of SEC.st){if(st.state==='ok'&&st.k>=0&&st.y+st.h*0.5>s.y&&s.done<s.n){crushStory(st);s.done++;cam.shake=Math.max(cam.shake,3);secCheck()}}
    if(s.done>=s.n||s.y<=s.stop||s.t>6){s.state='lift';s.t=0}}
  else{s.y+=45*dt;if(s.t>1.8)SSTAMP=null}}
function drawSecStamp(m){const s=SSTAMP;if(!s)return;const W=SEC.W*0.92,D=SEC.D*0.92,red=[0.82,0.10,0.10],dk=[0.36,0.22,0.14];
  pushShape(m,CUBE,0,s.y+1.4,0,W,2.8,D,0,red,0);pushShape(m,CUBE,0,s.y+3.8,0,W*0.8,2,D*0.8,0,[0.95,0.93,0.88],0);
  pushShape(m,CUBE,0,s.y+4.8+W*0.25,0,W*0.16,W*0.5,W*0.16,0,dk,0);pushShape(m,SPHERE,0,s.y+5+W*0.55,0,W*0.2,W*0.16,W*0.2,0,dk,0)}
function drawSecRebar(m){const r=SREB;if(!r)return;let n=0;for(const e of SEC.els){if(!e.alive||e.kind!=='col'||e.k<0)continue;if(n++>60)break;const b=elWorld(e),cx=(b[0]+b[3])/2,cz=(b[2]+b[5])/2;
  const y=b[4]+Math.max(0,r.t-((cx*7+cz*3)%0.6+0.6)%0.6)*7;pushShape(m,CUBE,cx+0.15,y+1.5,cz,0.08,3,0.08,0,REBAR,0);pushShape(m,CUBE,cx-0.15,y+1.2,cz,0.08,3,0.08,0,REBAR,0)}}

function secUpdateTools(dt){updateSecCrew(dt);updateSecDozers(dt);updateSecCranes(dt);updateSecMove(dt);updateSecSlices(dt);updateSecPour(dt);updateSecStamp(dt);if(SREB){SREB.t+=dt;if(SREB.t>3.5)SREB=null}}
function drawSecTools(m,mg){for(const w of SCREW)drawWorker(m,w,1.3);drawSecDozers(m);drawSecCranes(m,mg);
  if(SHELD)drawGroup(m,SHELD);for(const f of SFLY)drawGroup(m,f);for(const g of SSLICE)drawGroup(m,g);drawSecCut(mg);
  drawSecPour(m);drawSecStamp(m);drawSecRebar(m);for(const c of CHARGES)if(c.kind==='sec')secChargePos(c);drawCharges(m,mg)}

// ---------- 피킹 ----------
function rayBox(o,d,b){let t0=0,t1=1e9;for(let a=0;a<3;a++){const lo=b[a],hi=b[a+3];if(Math.abs(d[a])<1e-9){if(o[a]<lo||o[a]>hi)return null;continue}
  let ta=(lo-o[a])/d[a],tb=(hi-o[a])/d[a];if(ta>tb)[ta,tb]=[tb,ta];t0=Math.max(t0,ta);t1=Math.min(t1,tb);if(t0>t1)return null}return t0}
function secPick(mx,my){
  const {o,d}=rayFrom(mx,my);let best=1e9,hit=null;
  for(const e of SEC.els){if(!e.alive)continue;const t=rayBox(o,d,elWorld(e));if(t!=null&&t<best){best=t;hit=e}}
  if(hit)return{x:o[0]+d[0]*best,y:o[1]+d[1]*best,z:o[2]+d[2]*best,el:hit};
  if(d[1]<0){const t=-o[1]/d[1];const x=o[0]+d[0]*t,z=o[2]+d[2]*t;if(Math.abs(x)<SEC.P&&Math.abs(z)<SEC.P)return{x,y:0,z,el:null}}
  return null;
}

// ---------- 지면/잔해 ----------
function surfaceAt(x,y,z){
  if(MODE!=='section'||!SEC)return groundAt(x,z);
  if(Math.abs(x)>SEC.P||Math.abs(z)>SEC.P)return -400;
  if(Math.abs(x)<=SEC.W/2&&Math.abs(z)<=SEC.D/2){
    let top=SEC.st[0].y+SLAB_T;
    for(const s of SEC.st){const slab=SEC.els.find(e=>e.k===s.k&&e.kind==='slab');const st=s.y+SLAB_T+(s.state==='crushed'?0.6:0);
      if((slab&&slab.alive||s.state==='crushed')&&st<=y+0.4&&st>top)top=st}
    return top;
  }
  if(z>SEC.D/2)return -400;
  return 0;
}

// ---------- 메시 ----------
function secBox(m,x0,y0,z0,x1,y1,z1,top,side,front,u=-1){
  m.grow(36);const q=(a,b,c,d,n,col)=>{m.v(...a,...n,...col,u);m.v(...b,...n,...col,u);m.v(...c,...n,...col,u);m.v(...a,...n,...col,u);m.v(...c,...n,...col,u);m.v(...d,...n,...col,u)};
  q([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],[0,1,0],top);q([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],side);
  q([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1],front);q([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[0,0,-1],side);
  q([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[1,0,0],side);q([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0],side);
}
function buildSection(){
  const m=mSec;m.reset();const {W,D,P}=SEC;const pit=SEC.st[0].y0-1.2;
  // 대지 (흙 단면 포함) — 건물 자리는 비워둠
  const g=[0.56,0.62,0.50],soil=[0.42,0.34,0.26],cut=[0.30,0.24,0.18];
  // 앞쪽(z>D/2)은 단면으로 잘라내서 흙 단면이 보이게 함
  secBox(m,-P,pit,-P,P,0,-D/2,g,soil,cut);
  secBox(m,-P,pit,-D/2,-W/2,0,D/2,g,soil,cut);secBox(m,W/2,pit,-D/2,P,0,D/2,g,soil,cut);
  secBox(m,-W/2,pit-0.5,-D/2,W/2,pit,D/2,soil,soil,cut);
  const HL={};for(const s of SEC.st)HL[s.k]=storyHealth(s);
  for(const e of SEC.els){if(!e.alive)continue;const b=elWorld(e),c=e.col;
    if(e.kind==='slab'||e.kind==='roof'){const ours=SEC.ourK!=null&&e.k===SEC.ourK;secBox(m,b[0],b[1],b[2],b[3],b[4],b[5],c,[c[0]*0.85,c[1]*0.85,c[2]*0.85],ours?[0.95,0.65,0.1]:POCHE)}
    else if(e.kind==='wall'&&e.glass){const sp=b[1]+1.1;const cs=[c[0]*0.95,c[1]*0.95,c[2]*0.95];
      secBox(m,b[0],b[1],b[2],b[3],sp,b[5],cs,cs,POCHE);if(DAY.night&&secLitK(e.k))secBox(m,b[0],sp,b[2],b[3],b[4],b[5],LIT_GLASS,LIT_GLASS,LIT_GLASS,-3);else secBox(m,b[0],sp,b[2],b[3],b[4],b[5],C_GLASS,C_GLASS,C_GLASS)}
    else if(e.kind==='col'||e.kind==='core'){const h=HL[e.k];let st=h.core?0:clamp((0.75-h.r)/0.41,0,1);if(e.kind==='core')st=1-h.coreHp;if(e.hp<e.hp0)st=Math.max(st,0.6);
      const hot=[0.93,0.36,0.16],cc=[c[0]+(hot[0]-c[0])*st,c[1]+(hot[1]-c[1])*st,c[2]+(hot[2]-c[2])*st];secBox(m,b[0],b[1],b[2],b[3],b[4],b[5],cc,cc,e.kind==='core'?POCHE:cc)}
    else secBox(m,b[0],b[1],b[2],b[3],b[4],b[5],c,c,c);
  }
  // 무너진 층 잔해 더미
  for(const s of SEC.st)if(s.state==='crushed'){const R=mulberry(s.k+99);for(let i=0;i<18;i++){const x=-W/2+R()*W,z=-D/2+R()*D,w=1+R()*3,hh=0.3+R()*0.7;const c=R()<0.5?[0.58,0.56,0.53]:[0.5,0.47,0.43];secBox(m,x,s.y+SLAB_T,z,Math.min(W/2,x+w),s.y+SLAB_T+hh,Math.min(D/2,z+w*0.8),c,c,c)}}
  m.upload();
}
function drawSecDyn(m,mg){
  for(const o of SFALL){if(o.t>0)continue;
    if(o.kind==='ball'){pushShape(m,SPHERE,o.x,o.y,o.z,o.r,o.r,o.r,0,[0.22,0.23,0.25],0);pushShape(m,CUBE,o.x,o.y+40,o.z+30,0.2,80,0.2,0,[0.15,0.15,0.15],0)}
    else{pushShape(m,CUBE,o.x,o.y,o.z,o.r*2.6,o.r*0.6,o.r*0.6,o.rot,[0.96,0.96,0.94],0)}}
  if(sBeam&&firing){const L=90;pushShape(mg,CUBE,sBeam.x,sBeam.y,sBeam.z+L/2,0.18,0.18,L,0,[1,0.12,0.08],1);pushShape(mg,CUBE,sBeam.x,sBeam.y,sBeam.z+L/2,0.5,0.5,L,0,[1,0.5,0.45],1);pushShape(mg,SPHERE,sBeam.x,sBeam.y,sBeam.z,0.6,0.6,0.6,0,[1,0.6,0.2],1)}
  drawSecTools(m,mg);if(BOSS)drawBoss(m,mg);drawClient(m,mg);
}

// ---------- 점수 / 목표 ----------
function secStats(){
  let oursT=0,oursD=0,othT=0,othD=0;
  for(const e of SEC.els){if(e.hp0>=1e8||e.cx)continue;const s=SEC.S(e.k);const dropped=s.y<s.y0-0.5;const dead=!e.alive||dropped;
    const ours=SEC.ourK==null?true:e.k===SEC.ourK;
    if(ours){oursT+=e.w;if(dead)oursD+=e.w}else{othT+=e.w;if(dead)othD+=e.w}}
  return{ours:oursT?oursD/oursT:0,other:othT?othD/othT:0};
}
function secCollapse(){let t=0,d=0;for(const e of SEC.els){if(e.hp0>=1e8||e.cx)continue;const s=SEC.S(e.k);t+=e.w;if(!e.alive||s.y<s.y0-0.5)d+=e.w}return t?d/t:0}
function secGrade(o,x){const p=o*100-x*200;return o<0.2&&x<0.05?'-':p>=90?'S':p>=75?'A':p>=55?'B':p>=35?'C':p>=10?'D':'F'}
function updateSecPanel(){
  if(!SEC)return;const p=$('#secInfo');if(!p)return;
  {const tk=SEC.ourK!=null?SEC.ourK:null;let txt;
   if(tk!=null){const h=storyHealth(SEC.S(tk));txt=`구조 여유 · ${floorName(tk)} 기둥 ${Math.round(h.r*100)}% · 코어 ${h.core?'있음':'파괴'} — 기둥 34% 미만 + 코어 파괴 시 그 층이 주저앉아요`}
   else{let w=null;for(const s of SEC.st){if(s.state!=='ok'||s.k<=-SEC.nb)continue;const h=storyHealth(s);const v=h.core?1+h.coreHp:h.r;if(!w||v<w.v)w={s,v,h}}
     txt=w?`가장 약한 층 · ${floorName(w.s.k)} 기둥 ${Math.round(w.h.r*100)}% · 코어 ${w.h.core?'있음':'파괴'}`:''}
   const hn=$('#secHint');if(hn&&hn.textContent!==txt)hn.textContent=txt}
  if(SEC.tenant){const s=secStats();const g=secGrade(s.ours,s.other);
    if(s.other>=0.03&&!SEC.complain){SEC.complain=1;toast('⚠ 다른 층 입주사 민원 접수! 정밀 철거 감점',2500)}
    p.innerHTML=`<div class="k">목표 · ${floorName(SEC.ourK)}(우리 층)만 정밀 철거</div><div class="v">우리 층 ${Math.round(s.ours*100)}% · 다른 층 피해 ${Math.round(s.other*100)}% <span class="grade">${g}</span></div>`}
  else{const c=secCollapse(),h=SEC.hits||0;
    // 적은 타격으로 무너뜨릴수록 높은 등급 (구조 급소 공략)
    const g=c<0.9?(c>=0.6?'B':c>=0.35?'C':c>0.05?'D':'-'):h<=6?'특등급':h<=12?'1등급':h<=20?'2등급':'3등급';
    p.innerHTML=`<div class="k">목표 · 사옥 완전 붕괴 (적은 타격일수록 고득점)</div><div class="v">붕괴율 ${Math.round(c*100)}% · 타격 ${h}회 <span class="grade">${g}</span></div>`;
    if(c>=0.9&&!SEC.cleared){SEC.cleared=1;const bonus=g==='특등급'?80000:g==='1등급'?40000:15000;addScore(bonus);toast(`구조 ${g} 해체! 타격 ${h}회 · +${fmt(bonus)}`,3500)}}
}

// ---------- 층 라벨 ----------
let SLBL=[];
function makeSecLabels(){const box=$('#labels');box.innerHTML='';SLBL=[];
  const step=SEC.st.length>16?5:1;
  for(const s of SEC.st){const ours=SEC.ourK!=null&&s.k===SEC.ourK;
    if(!ours&&s.k!==0&&s.k!==-1&&s.k!==SEC.N-1&&((s.k+1)%step))continue;
    const el=document.createElement('div');el.className='lbl'+(ours?' hq':'');el.textContent=ours?`${SEC.firm.name} · ${floorName(s.k)}`:floorName(s.k);
    box.appendChild(el);SLBL.push({s,el,ours})}
  const byF={};for(const o of SEC.others){if(o.fl==null)continue;const k=o.fl>0?o.fl-1:o.fl;if(k===SEC.ourK||!SEC.S(k))continue;(byF[k]=byF[k]||[]).push(o.name)}
  for(const k in byF){const n=byF[k];const el=document.createElement('div');el.className='lbl other';el.textContent=`${n[0]}${n.length>1?' 외 '+(n.length-1):''} · ${floorName(+k)}`;box.appendChild(el);SLBL.push({s:SEC.S(+k),el,ours:true,other:true})}
  if(SEC.ourK==null){const el=document.createElement('div');el.className='lbl hq';el.textContent=SEC.firm.name+' · 사옥 전체';box.appendChild(el);SLBL.push({s:SEC.st[SEC.st.length-1],el,top:true})}
}
function updateSecLabels(){
  for(const L of SLBL){const s=L.s;const x=L.ours||L.top?SEC.W/2+1:-SEC.W/2-1.5;const y=L.top?s.y+s.h+3:s.y+s.h*0.6;
    const p=project(x,y,SEC.D/2);if(!p||!opts.labels||(s.state==='crushed'||s.state==='gone')&&!L.ours){L.el.style.display='none';continue}
    L.el.style.display='';L.el.style.left=p[0]+'px';L.el.style.top=p[1]+'px';L.el.style.transform=L.ours||L.top?'translate(0,-50%)':'translate(-100%,-50%)'}
}

// ---------- 되돌리기 ----------
function secSnap(){return{n:SEC.els.length,ns:SEC.st.length,N:SEC.N,e:SEC.els.map(e=>[e.hp,e.alive,e.k,e.box.slice()]),s:SEC.st.map(s=>[s.y,s.state]),score}}
function secRestore(v){SEC.els.length=v.n;SEC.st.length=v.ns;SEC.N=v.N;secClearTools();SEC.els.forEach((e,i)=>{e.hp=v.e[i][0];e.alive=v.e[i][1];e.k=v.e[i][2];e.box=v.e[i][3].slice()});SEC.st.forEach((s,i)=>{s.y=v.s[i][0];s.state=v.s[i][1];s.vy=0});score=v.score;if(SEC.tapeK)SEC.tapeK=new Set(SEC.els.filter(e=>e.ctape&&e.alive).map(e=>e.k));
  D.used.fill(0);D.rest.fill(0);rubDirty=true;SFALL=[];sQuake=null;sBeam=null;cam.shake=0;secDirty=true;if(BOSS)BOSS.sec=null;makeSecLabels();updateHUD()}
function secPushUndo(){SUNDO.push(secSnap());if(SUNDO.length>20)SUNDO.shift();$('#btnUndo').disabled=false}


// =====================================================================
//  동네 건축사무소 (좌표 데이터) + 철거 콤보
// =====================================================================
let NB=[], NBB=[], combo={n:0,t:0};
function shortName(n){return n.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|합자회사/g,'').replace(/종합\s*건축사\s*사무소|건축사\s*사무소|건축사사무소/g,'').replace(/\s+/g,' ').trim()||n}
function buildNeighborhood(){
  NB=[];NBB=[];for(const b of B)b.firms=null;
  if(typeof FIRMDATA==='undefined')return;
  const dLat=2400/110540,dLng=2400/(111320*Math.cos(LAT0*Math.PI/180));
  for(let i=0;i<FIRMDATA.length;i++){const r=FIRMDATA[i];if(r[4]===2||r[2]==null)continue;
    if(Math.abs(r[2]-LAT0)>dLat||Math.abs(r[3]-LNG0)>dLng)continue;
    const [x,z]=proj(r[2],r[3]);const c=chunkAt(x,z);if(!c||c.state!=='ready')continue;
    let bb=null,bd=1e9;forBuildingsNear(x,z,25,b=>{const d=pip(x,z,b.pts)?0:distToBuilding(b,x,z);if(d<bd){bd=d;bb=b}});
    if(bd>25)bb=null;
    const f={i,name:r[0],short:shortName(r[0]),addr:r[1],x,z,b:bb,approx:r[4]===1,cons:r[8]==='c',gen:r[8]==='g',univ:r[8]==='u'};
    NB.push(f);if(bb){if(!bb.firms){bb.firms=[];NBB.push(bb)}bb.firms.push(f)}
  }
  // 공공데이터에 없는 지역(송파구 등)은 OpenStreetMap에 등록된 건축사무소로 보충
  for(const a of OSMARCH.values()){const [x,z]=proj(a.lat,a.lng);const c=chunkAt(x,z);if(!c||c.state!=='ready')continue;
    const sn=shortName(a.name);if(NB.some(f=>Math.hypot(f.x-x,f.z-z)<40&&(f.short===sn||Math.hypot(f.x-x,f.z-z)<8)))continue;
    let bb=null,bd=1e9;forBuildingsNear(x,z,25,b=>{const d=pip(x,z,b.pts)?0:distToBuilding(b,x,z);if(d<bd){bd=d;bb=b}});if(bd>25)bb=null;
    const f={i:null,osm:true,name:a.name,short:sn,addr:a.addr||'OpenStreetMap 등록',x,z,b:bb,firm:{key:'o'+a.id,name:a.name,addr:a.addr||'',lat:a.lat,lng:a.lng}};
    NB.push(f);if(bb){if(!bb.firms){bb.firms=[];NBB.push(bb)}bb.firms.push(f)}}
}
function makePins(){
  const box=$('#labels');
  const curKey=CUR&&CUR.dkey;
  for(const b of NBB){
    // 지금 고른 회사는 노란 사옥 이름표로 이미 보이니 파란 핀에서는 뺌 (같은 회사가 두 번 뜨지 않게)
    const curN=CUR?norm(shortName(CUR.name)):'',same=f=>(curKey&&f.i!=null&&FIRMDATA[f.i]&&'d'+FIRMDATA[f.i][5]===curKey)||(f.i==null&&curN&&f.short&&norm(f.short)&&(curN.includes(norm(f.short))||norm(f.short).includes(curN)));
    const fs=b.firms.filter(f=>!same(f));if(!fs.length)continue;
    const el=document.createElement('div');el.className='lbl pin'+(fs[0].cons?' cons':fs[0].gen?' gen':fs[0].univ?' univ':'');
    el.textContent=fs[0].short+(fs.length>1?` 외 ${fs.length-1}`:'');
    el.title=fs.map(f=>f.name).join('\n')+'\n\n클릭: 이 건물 단면 보기';
    el.addEventListener('pointerdown',e=>e.stopPropagation());
    el.addEventListener('click',e=>{e.stopPropagation();const f=fs[0];enterSection(b,f.firm||firmFromData(f.i))});
    box.appendChild(el);LBL.push({b,el,pin:true});
  }
}
function firmsKilled(b){
  conqRecord(b);
  if(!b.firms||!b.firms.length)return;
  const now=performance.now();combo.n=now-combo.t<3500?combo.n+1:1;combo.t=now;
  const k=b.firms.length,bonus=Math.round(5000*k*combo.n*nightK(b));addScore(bonus);
  toast(`${b.firms[0].short}${k>1?` 외 ${k-1}곳`:''} 철거! +${fmt(bonus)}${combo.n>1?` · 콤보 x${combo.n}`:''}`,2200);
}
function districtName(){const a=(CUR&&CUR.addr)||'';let m=a.match(/\(([가-힣0-9]+(?:동|가|읍|면|리))[,)]/);if(m)return m[1].replace(/\d+(?=동$)/,'');
  m=a.match(/([가-힣]+(?:구|시|군))\s/g);return m?m[m.length-1].trim():'이 동네'}
let stage={done:false,t0:0};
function checkStage(n){if(!n.t)return;if(n.d>0&&!stage.t0)stage.t0=performance.now();
  if(n.d===n.t&&!stage.done){stage.done=true;const sec=stage.t0?Math.round((performance.now()-stage.t0)/1000):0;const bonus=30000*n.t;addScore(bonus);
    toast(`${districtName()} 건축사무소 지구 ${n.t}곳 철거 완료! ${Math.floor(sec/60)}분 ${sec%60}초 · +${fmt(bonus)}`,5000)}
  if(n.d<n.t)stage.done=false}
function nbStats(){let t=0,d=0;for(const b of NBB){t+=b.firms.length;if(!b.alive)d+=b.firms.length}return{t,d}}

// =====================================================================
//  사장님 NPC — 사옥 옥상에서 잔소리하고, 부수면 반응하고, 사옥이 무너지면 근처 건축사무소로 도망
//  ※ 대사는 아래 BOSS_LINES 만 고치면 돼요. {firm} = 지금 사장님이 있는 사무소 이름
// =====================================================================
const BOSS_LINES={
  idle:['이번 주 토요일 잠깐만 나올 수 있지?','도면 내일 아침 9시까지. 오늘 말고 내일.','클라이언트가 그냥 처음부터 다시 하재.','야근 식대는 컵라면으로 하자.','설계비는 다음 달에 들어온대.',
    '이거 투시도 하나만 더 뽑아봐. 아니 다른 각도로.','공모전 하나만 더 내보자.','내가 젊을 땐 손으로 다 그렸어.','창호 디테일 또 바뀌었다며?','회의는 짧게 하자. 두 시간만.',
    '연차? 마감 끝나고 생각해보자.','CAD 레이어 정리 누가 했어?','허가는 다음 주면 나온다니까.','이번 프로젝트 끝나면 다 같이 회식하자.','우리 회사는 가족 같은 회사야.'],
  newOffice:['{firm} 직원들, 오늘부터 토요일 출근이야.','전 대표 도면은 싹 다 다시 그려.','여기도 야근 되지?','{firm}? 간판부터 바꾸자.','내가 오늘부터 대표다.'],
  hitFacade:['그거 마감재 비싼 거야!','외벽 샘플 승인받은 거라고!','커튼월 하자보수 누가 해!','유리 깨지면 네가 물어내!'],
  hitColumn:['그거 내력벽이야!!','구조기술사 불러!','기둥은 건드리지 마!!','구조계산서 다시 봐야겠네…'],
  floor:['보험 들어놨지…?','층 하나 날아갔잖아!','면적 줄었네… 설계변경 해야겠다','시공사한테 전화해!'],
  heavy:['감리 오기 전에 수습해!','이거 준공 받을 수 있는 거지?','일단 사진 찍지 마!'],
  tools:{
    crew:['인부를 왜 이렇게 많이 불렀어! 인건비!','반장님, 우리 편 아니었어?'],
    dozer:['그건 진입로가 아니야!','차 빼! 거기 주차장 아니야!'],
    crane:['타워크레인 임대료는 누가 내!','쇠공은 철거 현장에서나 써!'],
    pour:['레미콘 한 대에 얼만지 알아?!','옥상 방수 다 망가진다!'],
    blast:['그건 설계변경 아니잖아!','발파 허가는 받았어?!'],
    rebar:['철근은 시방서대로 넣었다고!','감리한테 말하지 마…'],
    move:['건물을 왜 옮겨! 지번 바뀌잖아!','어딜 들어!'],
    extrude:['용적률은 내가 알아서 할게','층수 올리면 일조권 걸려!'],
    trim:['내 도면 자르지 마!','TRIM은 CAD에서나 해!'],
    sink:['땅이 꺼진다고?!','지반조사 누가 했어!'],
    nuke:['…그 클라이언트 번호 차단해','전부 다시? 설계비도 다시 받아!'],
  },
  stun:['아야! 내가 누군 줄 알아?!','나 대표야, 대표!','이거 산재 처리 돼?'],
  flee:['회의 있어서 먼저 간다!','현장 미팅 다녀올게!','법인카드 챙겨!','이건 다 실장 책임이야!'],
  arrive:[['여기서부터 다시 시작한다.','{firm}? 오늘부터 내가 대표다.'],['개소식은 다음 주에 하자.','책상은 일단 중고로 사.'],['직원은… 일단 나 혼자.','사무실이 좀 좁네…','여기 월세 얼마야?']],
  caught:['…퇴직금은 주는 거지?','알았어, 설계비 올려줄게!','나 없으면 이 업계 안 돌아가!'],
};
const pickL=a=>a[Math.floor(Math.random()*a.length)];
let BOSS=null,CAMGO=null;
const SUIT=[0.16,0.19,0.30],SUIT_D=[0.11,0.13,0.21],SKIN=[0.95,0.78,0.62],HAIR=[0.55,0.55,0.57];
function bTop(b){return b.base+Math.max(0,b.h)}
function bossReset(){BOSS=null;CAMGO=null;drawBossUI()}
function bossSpawn(){const b=B.find(x=>x.hq&&x.alive);if(!b){BOSS=null;return}
  const sp0=bossSpotOf(b);BOSS={b,home:b,flees:0,state:'idle',t:0,sayT:2.5,lastSay:0,lastTool:0,text:'',textT:0,stun:0,flinch:0,x:sp0.x,z:sp0.z,y:bTop(b),visited:new Set([b]),firm:CUR?CUR.name:'',yaw:0}}
function bossFill(s){return s.replace(/\{firm\}/g,BOSS?BOSS.firm:'')}
function bossSay(text,prio){if(!BOSS||!text)return;const now=performance.now();if((prio||0)<1&&now-BOSS.lastSay<2600)return;if((prio||0)<2&&BOSS.state==='caught')return;
  BOSS.text=bossFill(text);BOSS.textT=3.4;BOSS.lastSay=now}
function bossHere(){if(!BOSS)return false;if(MODE==='section')return !!SEC&&SEC.b===BOSS.b;return true}
function bossHit(kind){if(!bossHere()||BOSS.state!=='idle')return;BOSS.flinch=0.5;
  const b=BOSS.b;let heavy=false;if(b.det){let a=0;for(let f=0;f<b.det.F;f++)a+=b.det.fl[f];heavy=a/b.det.F<0.6}
  if(kind==='floor')bossSay(pickL(heavy?BOSS_LINES.heavy:BOSS_LINES.floor),1);
  else bossSay(pickL(kind==='col'?BOSS_LINES.hitColumn:BOSS_LINES.hitFacade),0)}
function bossTool(id,x,z){if(!BOSS||BOSS.state!=='idle')return;const L=BOSS_LINES.tools[id];if(!L)return;
  if(MODE==='section'){if(!bossHere())return}else if(x!=null&&Math.hypot(x-BOSS.x,z-BOSS.z)>160)return;
  const now=performance.now();if(now-BOSS.lastTool<4000)return;BOSS.lastTool=now;BOSS.flinch=0.4;bossSay(pickL(L),1)}
// 사장님 위치(단면 모드에서는 단면 좌표)
function bossPos(){if(MODE==='section'&&SEC&&SEC.b===BOSS.b){if(BOSS.sec==null)BOSS.sec={x:SEC.W*0.22,y:secTop(),z:SEC.D/2-2,vx:0,vy:0,out:false};return BOSS.sec}return BOSS}
function bossScale(){return MODE==='section'?1.8:clamp(cam.dist*0.026,4,18)}   // 멀리서도 보이게 거리에 따라 키움
function bossClick(mx,my){if(!bossHere()||BOSS.state==='jump'||BOSS.state==='caught')return false;const p=bossPos(),S=bossScale();
  const a=project(p.x,p.y+0.2,p.z),c=project(p.x,p.y+2.1*S,p.z);if(!a||!c)return false;const h=Math.abs(a[1]-c[1]),w=Math.max(18,h*0.5);
  if(mx<a[0]-w||mx>a[0]+w||my<c[1]-6||my>a[1]+4)return false;
  BOSS.stun=1.4;if(MS)MS.boss++;bossSay(pickL(BOSS_LINES.stun),2);addScore(800);sfx(8,0.25);cam.shake=Math.max(cam.shake,2);
  for(let k=0;k<8;k++)spawn(p.x,p.y+2*S,p.z,(Math.random()-.5)*4,3,(Math.random()-.5)*4,0.15*S,[1,0.9,0.3],0.6,1);return true}

function bossFlee(){const from=BOSS.b;let best=null,bd=1e9;
  for(const b of NBB){if(!b.alive||b.lifted||b===from||BOSS.visited.has(b))continue;const d=Math.hypot(b.cx-BOSS.x,b.cz-BOSS.z);if(d<bd&&d<900){bd=d;best=b}}
  // 근처에 건축사무소가 없으면 빈 건물이라도 임시 사무실로 (도주는 최대 6번)
  if(!best)forBuildingsNear(BOSS.x,BOSS.z,500,b=>{if(!b.alive||b.lifted||b===from||BOSS.visited.has(b)||b.h0<10||b.area<150)return;const d=Math.hypot(b.cx-BOSS.x,b.cz-BOSS.z);if(d<bd){bd=d;best=b}});
  if(!best||BOSS.flees>=6){bossCaught();return}
  BOSS.visited.add(best);bossSay(pickL(BOSS_LINES.flee),3);
  const y0=MODE==='city'?BOSS.y:bTop(from);
  BOSS.state='jump';BOSS.jump={t:0,T:1.2+bd/240,x0:BOSS.x,y0,z0:BOSS.z,b:best,h:Math.max(30,bd*0.4)};
  CAMGO={t:0,dur:BOSS.jump.T+0.8,follow:true};
  toast(`${BT()}이 ${best.firms&&best.firms[0]?best.firms[0].short:'빈 건물'}(으)로 도망쳐요! 쫓아가세요`,2400);sfx(6,0.4)}
function bossLand(){const b=BOSS.jump.b;BOSS.b=b;BOSS.state='idle';BOSS.sayT=6;
  if(BOSS.rehire){BOSS.rehire=false;BOSS.firm=(b.firms&&b.firms[0]?b.firms[0].short:BOSS.firm);const top=bTop(b);boom3(BOSS.x,top+1,BOSS.z,10);sfx(14,0.4);
    if(BOSS.boom){BOSS.boom=false;bossSay(pickL(BOOM_LINES),3);floatText(BOSS.x,top+14,BOSS.z,`${BOOM.round}차 부동산 호황 · ${BT()} 컴백`,'count',2.6);return}
    bossSay(pickL(['돈 받았으니 다시 일한다!','재계약이다! 다들 자리로!','이번엔 진짜 끝까지 간다!']),3);floatText(BOSS.x,top+14,BOSS.z,BT()+' 재고용','cad',2.2);return}
  BOSS.flees++;const n=BOSS.flees;
  BOSS.firm=b.firms&&b.firms[0]?b.firms[0].short:'임시 사무실';
  bossSay(pickL(BOSS_LINES.arrive[Math.min(2,n-1)]),3);const bonus=5000*n;addScore(bonus);
  const top=bTop(b);boom3(BOSS.x,top+1,BOSS.z,10);cam.shake=Math.max(cam.shake,3);sfx(14,0.4);
  floatText(BOSS.x,top+14,BOSS.z,`${BOSS.firm} 대표 취임`,'cad',2.2);toast(`${BT()}이 ${BOSS.firm}에 새로 자리 잡았어요 · 도주 ${n}회 · +${fmt(bonus)}`,2600)}
function bossCaught(){BOSS.state='caught';BOSS.t=0;const bonus=50000+20000*BOSS.flees;addScore(bonus);
  bossSay(pickL(BOSS_LINES.caught),3);floatText(BOSS.x,BOSS.y+12,BOSS.z,'사장님 검거!','count',2.6);
  toast(`더 도망칠 곳이 없어요 — ${BT()} 검거! 도주 ${BOSS.flees}회 · +${fmt(bonus)}`,4000);sfx(20,1);flashScreen(0.3,'#fff3c4');boomArm()}
// 발주처가 새로 지은 건물로 사장님 재고용 (검거 상태에서도 풀려나 점프)
function bossRehire(b){if(!BOSS)return;const y0=BOSS.y,d=Math.hypot(b.cx-BOSS.x,b.cz-BOSS.z);
  BOSS.rehire=true;BOSS.flees=0;BOSS.visited=new Set([b]);BOSS.stun=0;BOSS.lastSay=0;
  BOSS.state='jump';BOSS.jump={t:0,T:1.0+d/240,x0:BOSS.x,y0,z0:BOSS.z,b,h:Math.max(25,d*0.4)};CAMGO={t:0,dur:BOSS.jump.T+0.6,follow:true}}
function bossUpdate(dt){if(!BOSS)return;const S=bossScale();
  BOSS.t+=dt;if(BOSS.textT>0)BOSS.textT-=dt;if(BOSS.stun>0)BOSS.stun-=dt;if(BOSS.flinch>0)BOSS.flinch-=dt;
  if(MODE==='section'){bossSecUpdate(dt);return}
  if(MODE!=='city')return;
  const b=BOSS.b;
  if(BOSS.state==='idle'){
    const sp=bossSpotOf(b);BOSS.x+=(sp.x-BOSS.x)*Math.min(1,dt*3);BOSS.z+=(sp.z-BOSS.z)*Math.min(1,dt*3);
    const ty=b.alive&&!b.lifted?bTop(b):groundAt(BOSS.x,BOSS.z);BOSS.y=BOSS.y>ty?Math.max(ty,BOSS.y-25*dt):ty;
    let low=false;if(b.det){let a=0;for(let f=0;f<b.det.F;f++)a+=b.det.fl[f];low=a/b.det.F<0.35}else low=b.h<b.h0*0.35;
    if(!b.alive||b.lifted||low){bossFlee();return}
    BOSS.sayT-=dt;if(BOSS.sayT<=0&&BOSS.stun<=0){BOSS.sayT=8+Math.random()*5;bossSay(pickL(BOSS.flees&&Math.random()<0.5?BOSS_LINES.newOffice:BOSS_LINES.idle),0)}}
  else if(BOSS.state==='jump'){const j=BOSS.jump;j.t+=dt;const u=Math.min(1,j.t/j.T),tb=j.b;const x1=tb.cx,z1=tb.cz,y1=tb.alive?bTop(tb):groundAt(x1,z1);
    BOSS.x=j.x0+(x1-j.x0)*u;BOSS.z=j.z0+(z1-j.z0)*u;BOSS.y=j.y0+(y1-j.y0)*u+Math.sin(Math.PI*u)*j.h;
    if(Math.random()<0.4)spawn(BOSS.x,BOSS.y+S,BOSS.z,0,0,0,0.25*S,[1,1,1],0.5,2);
    if(u>=1){if(!tb.alive){BOSS.b=tb;bossFlee();return}bossLand()}}
  else if(BOSS.state==='caught'){const g=groundAt(BOSS.x,BOSS.z);const top=b.alive?bTop(b):g;BOSS.y=Math.max(top,BOSS.y-20*dt);
    BOSS.sayT-=dt;if(BOSS.sayT<=0){BOSS.sayT=10;bossSay(pickL(BOSS_LINES.caught),2)}}
  // 카메라 따라가기 (WASD 누르면 바로 멈춤)
  if(CAMGO){CAMGO.t+=dt;const k=Math.min(1,dt*2.2);cam.tx+=(BOSS.x-cam.tx)*k;cam.tz+=(BOSS.z-cam.tz)*k;if(CAMGO.t>CAMGO.dur)CAMGO=null}
}
function bossSecUpdate(dt){if(!SEC||SEC.b!==BOSS.b)return;const p=bossPos();
  if(!p.out){const top=secTop();p.y=p.y>top?Math.max(top,p.y-20*dt):top;
    if(BOSS.state==='idle'){BOSS.sayT-=dt;if(BOSS.sayT<=0&&BOSS.stun<=0){BOSS.sayT=8+Math.random()*5;bossSay(pickL(BOSS_LINES.idle),0)}}
    if(BOSS.state==='idle'&&secCollapse()>=0.55){p.out=true;p.vx=(p.x>=0?1:-1)*9;p.vy=11;bossSay(pickL(BOSS_LINES.flee),3);
      toast(BT()+'이 도망쳤어요! [동네로] 나가면 근처 건축사무소까지 쫓아갈 수 있어요',3200)}}
  else{p.vy-=30*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.y<0){p.y=0;p.vy=0}}}
// ---------- 그리기 ----------
function drawBoss(m,mg){if(!bossHere())return;const p=bossPos();if(MODE==='section'&&p.out&&Math.abs(p.x)>SEC.W/2+40)return;
  const S=bossScale(),now=performance.now()/1000,st=BOSS.state;
  const dx=eye[0]-p.x,dz=eye[2]-p.z;let r=Math.atan2(-dx,dz);if(BOSS.stun>0)r+=now*12;
  const cr=Math.cos(r),sr=Math.sin(r),sh=BOSS.flinch>0?(Math.random()-.5)*0.08*S:0;
  const P=(lx,ly,lz,sx,sy,sz,c,shape)=>pushShape(m,shape||CUBE,p.x+(lx*cr-lz*sr)*S+sh,p.y+ly*S,p.z+(lx*sr+lz*cr)*S,sx*S,sy*S,sz*S,r,c,0);
  const sit=st==='caught',jump=st==='jump',talk=BOSS.textT>0;
  const bob=sit?0:Math.sin(now*3)*0.02;
  if(sit){P(0.13,0.15,0.3,0.15,0.15,0.6,SUIT_D);P(-0.13,0.15,0.3,0.15,0.15,0.6,SUIT_D)}
  else{const lg=jump?0.35:0;P(0.13+lg*0.3,0.42,0,0.17,0.8,0.18,SUIT_D);P(-0.13-lg*0.3,0.42,0,0.17,0.8,0.18,SUIT_D);
    P(0.13+lg*0.3,0.04,0.05,0.19,0.08,0.3,[0.08,0.08,0.08]);P(-0.13-lg*0.3,0.04,0.05,0.19,0.08,0.3,[0.08,0.08,0.08])}
  const by=(sit?-0.5:0)+bob;
  P(0,1.18+by,0,0.66,0.78,0.42,SUIT);P(0,1.1+by,0.12,0.36,0.34,0.3,SUIT,SPHERE);   // 몸통 · 배
  P(0,1.4+by,0.215,0.18,0.3,0.02,[0.97,0.97,0.96]);P(0,1.35+by,0.23,0.07,0.3,0.02,[0.8,0.1,0.1]);   // 셔츠 · 넥타이
  // 팔: 말할 때는 손가락질, 맞으면 만세, 점프하면 위로
  const up=jump||BOSS.flinch>0||BOSS.stun>0;const wave=talk&&!up?Math.sin(now*9)*0.12:0;
  if(up){P(0.42,1.75+by,0,0.14,0.55,0.14,SUIT);P(-0.42,1.75+by,0,0.14,0.55,0.14,SUIT);P(0.42,2.05+by,0,0.12,0.12,0.12,SKIN);P(-0.42,2.05+by,0,0.12,0.12,0.12,SKIN)}
  else{P(-0.4,1.2+by,0.02,0.14,0.55,0.14,SUIT);P(-0.4,0.9+by,0.05,0.12,0.12,0.12,SKIN);
    P(-0.42,1.0+by,0.18,0.05,0.42,0.3,[0.45,0.3,0.18]);P(-0.39,1.05+by,0.19,0.01,0.34,0.24,[0.96,0.95,0.9]);   // 결재판
    P(0.42,1.48+by+wave,0.18,0.14,0.14,0.5,SUIT);P(0.42,1.48+by+wave,0.47,0.1,0.1,0.14,SKIN)}   // 손가락질
  // 머리: 옆머리만 남은 흰머리 · 뿔테 안경
  P(0,1.83+by,0,0.42,0.42,0.4,SKIN);P(0.22,1.86+by,-0.02,0.04,0.2,0.32,HAIR);P(-0.22,1.86+by,-0.02,0.04,0.2,0.32,HAIR);P(0,1.86+by,-0.21,0.4,0.22,0.03,HAIR);
  P(0.1,1.86+by,0.21,0.14,0.08,0.02,[0.12,0.1,0.08]);P(-0.1,1.86+by,0.21,0.14,0.08,0.02,[0.12,0.1,0.08]);P(0,1.87+by,0.21,0.06,0.02,0.02,[0.12,0.1,0.08]);
  P(0,1.71+by,0.21,talk?0.12:0.14,talk?0.05+Math.abs(Math.sin(now*14))*0.04:0.02,0.02,[0.45,0.12,0.1]);
  if(BOSS.stun>0)for(let k=0;k<4;k++){const a=now*5+k*Math.PI/2;pushShape(mg,CUBE,p.x+Math.cos(a)*0.35*S,p.y+(2.2+by)*S,p.z+Math.sin(a)*0.35*S,0.09*S,0.09*S,0.09*S,a,[1,0.9,0.25],1)}
}
// 말풍선 · 이름표 · 화면 밖 화살표 · 상태
function drawBossUI(){const ui=$('#bossUI'),ar=$('#bossArrow'),bx=$('#bossBox');if(!ui)return;
  if(!BOSS||!bossHere()){ui.style.display='none';ar.style.display='none';bx.style.display=BOSS&&MODE==='city'?'':'none';return}
  const p=bossPos(),S=bossScale(),q=project(p.x,p.y+2.35*S,p.z);
  bx.style.display=MODE==='city'?'':'none';
  {const tg=ui.querySelector('.tag'),nm=bossName()||bossTitle();if(tg.textContent!==nm)tg.textContent=nm;const an=ar.lastChild;if(an&&an.nodeType===3&&an.textContent!==nm)an.textContent=nm}
  const t=`${BOOM.round?BOOM.round+'차 호황 · ':''}${BT()} · ${BOSS.state==='caught'?(BOOM.ship?'비행선 도착 중!':BOOM.need?`검거됨 · 호황까지 ${fmt(boomLeft())}점`:'검거됨'):BOSS.firm}${BOSS.flees&&BOSS.state!=='caught'?` · 도주 ${BOSS.flees}회`:''}`;if(bx.textContent!==t)bx.textContent=t;
  const W=innerWidth,H=innerHeight,f=project(p.x,p.y+0.5*S,p.z);const on=q&&f&&f[0]>10&&f[0]<W-10&&f[1]>10&&f[1]<H-60;
  if(on){ui.style.display='';ui.style.left=q[0]+'px';ui.style.top=Math.max(q[1],100)+'px';const bb=ui.querySelector('.bubble');
    const txt=BOSS.textT>0?BOSS.text:'';if(bb.textContent!==txt)bb.textContent=txt;bb.style.display=txt?'':'none';ar.style.display='none'}
  else{ui.style.display='none';if(MODE!=='city'){ar.style.display='none';return}
    let v=q?[q[0]-W/2,q[1]-H/2]:null;if(!v){const dx=p.x-cam.tx,dz=p.z-cam.tz,ct=Math.cos(cam.theta),st=Math.sin(cam.theta);v=[dx*ct-dz*st,-(dx*st+dz*ct)]}
    const k=Math.min((W/2-60)/Math.abs(v[0]||1e-6),(H/2-90)/Math.abs(v[1]||1e-6));
    ar.style.display='';ar.style.left=(W/2+v[0]*k)+'px';ar.style.top=(H/2+v[1]*k)+'px';ar.querySelector('i').style.transform=`rotate(${Math.atan2(v[1],v[0])}rad)`}}
function bossGo(){if(!BOSS||MODE!=='city')return;if(BOOM.ship){BOOM.ship.follow=true;return}CAMGO={t:0,dur:1.6}}

// =====================================================================
//  구청 공사중지 명령 — 짧은 시간에 건물을 몰아서 무너뜨리면 3초 동안 도구 사용 금지 (동네 모드)
//   · 기준: 최근 STOP_WIN초 안에 STOP_N동 이상 철거 → STOP_SEC초 정지, 끝나고 STOP_IMMUNE초는 다시 안 걸림
//   · 필살기를 쓴 직후 8초는 세지 않음 (필살기는 원래 한 번에 많이 부숨)
// =====================================================================
const STOP_N=10,STOP_WIN=3,STOP_SEC=3,STOP_IMMUNE=15;
let STOP={log:[],until:0,immune:0,grace:0,x:0,z:0,nag:0};
function stopOn(){return MODE==='city'&&performance.now()<STOP.until}
function stopNote(b){if(MODE!=='city'||!b)return;const now=performance.now();if(now<STOP.grace||now<STOP.until)return;
  STOP.log.push({t:now,x:b.cx,z:b.cz});while(STOP.log.length&&now-STOP.log[0].t>STOP_WIN*1000)STOP.log.shift();
  if(STOP.log.length>=STOP_N&&now>STOP.immune){let x=0,z=0;for(const k of STOP.log){x+=k.x;z+=k.z}STOP.x=x/STOP.log.length;STOP.z=z/STOP.log.length;STOP.log=[];
    STOP.until=now+STOP_SEC*1000;STOP.immune=STOP.until+STOP_IMMUNE*1000;
    if(gesture)gestureCancel();if(ultArmed){ultArmed=false;selectWeapon(weapon)}
    sfx(10,0.5);flashScreen(0.18,'#ffe066');if(BOSS&&BOSS.state==='idle')bossSay('구청에서 나왔다! 다들 손 멈춰!',3)}}
function stopNag(){const now=performance.now();if(now-STOP.nag<900)return;STOP.nag=now;toast(`🚧 공사중지 중이에요 — ${Math.ceil((STOP.until-now)/1000)}초 뒤에 다시 부술 수 있어요`,1200)}
function stopUI(){let el=$('#stopBan');const on=stopOn();
  if(!el){if(!on)return;el=document.createElement('div');el.id='stopBan';document.body.appendChild(el)}
  el.style.display=on?'':'none';if(!on)return;
  const left=Math.ceil((STOP.until-performance.now())/1000),t=`<b>🚧 구청 공사중지 명령 · ${left}초</b><small>너무 몰아서 부쉈어요! 잠깐 손 떼세요 (화면 이동은 돼요)</small>`;if(el.innerHTML!==t)el.innerHTML=t}
function drawStopFence(m){if(!stopOn())return;const n=36,R=75;
  for(let i=0;i<n;i++){const a=i/n*Math.PI*2,x=STOP.x+Math.cos(a)*R,z=STOP.z+Math.sin(a)*R,g=groundAt(x,z);
    pushShape(m,CUBE,x,g+2.2,z,R*2*Math.PI/n*0.96,4.4,0.5,a+Math.PI/2,i%2?[0.98,0.80,0.10]:[0.12,0.12,0.12],0);
    pushShape(m,CUBE,x,g+5,z,0.5,1.2,0.5,0,[0.95,0.2,0.1],1)}}

// =====================================================================
//  부동산 호황 — 사장님을 검거한 뒤 점수를 더 모으면 비행선을 타고 사장님이 돌아와 사옥을 새로 지음 (무한 반복)
//   · 필요 점수 = 검거 시점 점수 + BOOM_BASE × n²  (n = 지금까지 검거 횟수 → 10만 · 40만 · 90만 · 160만 …)
//   · 호황이 오면 발주처도 다시 한 번 등장할 수 있음
//  ※ 대사는 BOOM_LINES 만 고치면 돼요
// =====================================================================
const BOOM_BASE=100000;
const BOOM_LINES=['부동산 호황이야! 다시 시작한다!','분양 완판이다! 사옥 새로 올려!','금리 내렸대! 다들 출근해!','호황엔 야근이지. 자리로!'];
const BOOM_COLS=[[0.72,0.86,0.96],[0.96,0.84,0.55],[0.82,0.95,0.80],[0.95,0.78,0.86]];
let BOOM={n:0,round:0,need:0,ship:null};
function boomReset(){BOOM={n:0,round:0,need:0,ship:null}}
function boomLeft(){return Math.max(0,Math.ceil(BOOM.need-score))}
function boomArm(){try{if(!HOT.d)loadHot()}catch(e){}BOOM.n++;const add=BOOM_BASE*BOOM.n*BOOM.n;BOOM.need=score+add;
  setTimeout(()=>{if(BOSS&&BOSS.state==='caught'&&!BOOM.ship)toast(`🏗 ${fmt(add)}점 더 부수면 부동산 호황! ${BT()}이 비행선 타고 돌아와요`,4200)},4300)}
function boomTarget(){const h=BOSS&&BOSS.home;if(h&&B.includes(h))return h;return B.find(x=>x.hq)||null}
function boomStart(){const b=boomTarget();if(!b){BOOM.need=0;return}
  const a=Math.random()*Math.PI*2,R=900,ty=b.base+Math.max(b.h0*1.2+6,30)+70;
  BOOM.ship={b,t:0,phase:'in',T:6,x0:b.cx+Math.cos(a)*R,z0:b.cz+Math.sin(a)*R,x:b.cx+Math.cos(a)*R,y:ty+60,z:b.cz+Math.sin(a)*R,ty,dx:-Math.cos(a),dz:-Math.sin(a),follow:true};
  boomBanner();sfx(10,0.8);try{if(!HOT.d)loadHot()}catch(e){}const ht=shipTop();toast(`📢 부동산 호황! ${BT()}이 비행선을 타고 오고 있어요`+(ht?` · 현수막: 최다 철거 1위 ${ht.name}`:''),3600)}
function boomBanner(){const el=$('#clientBanner');if(!el)return;
  el.innerHTML=`<b>📢 부동산 호황!</b><span>${BOOM.round+1}차 호황</span><p>${esc(BT())}이 비행선을 타고 돌아와 사옥을 새로 지어요.<br><em>다시 부수세요!</em> 다음 호황은 점수가 더 많이 필요해요</p>`;
  el.classList.remove('on');void el.offsetWidth;el.classList.add('on');clearTimeout(clientBanner._t);clientBanner._t=setTimeout(()=>el.classList.remove('on'),5200)}
// 새 사옥 짓기 (발주처 재건축과 같은 방식, 호황이라 더 높고 반짝이게)
function boomRebuild(b){
  if(!b.custom){if(!b.colPre)b.colPre=b.col;b.col=BOOM_COLS[(BOOM.round-1)%BOOM_COLS.length];b.h0=Math.min(b.h0*1.2+6,b.h0+40)}
  freeDet(b);b.alive=true;b.lifted=false;b.h=b.h0;b.cdmg=0;b.domino=0;if(b.custom)ensureDet(b);markB(b);bldDirty=true;
  const R=Math.sqrt(b.area)/2+2;for(let i=0;i<MAXD;i++)if(D.used[i]&&Math.hypot(D.x[i]-b.cx,D.z[i]-b.cz)<R)D.used[i]=0;rubDirty=true;
  boom3(b.cx,b.base+3,b.cz,30);for(let k=0;k<30;k++)spawn(b.cx+(Math.random()-.5)*R*2,b.base+1,b.cz+(Math.random()-.5)*R*2,(Math.random()-.5)*10,4+Math.random()*8,(Math.random()-.5)*10,1+Math.random()*2,[0.85,0.83,0.8],0.9,2)}
function boomUpdate(dt){
  if(MODE!=='city'||!BOSS)return;const sh=BOOM.ship;
  if(!sh){if(BOSS.state==='caught'&&BOOM.need&&score>=BOOM.need&&!(CLIENT&&CLIENT.wind))boomStart();return}
  sh.t+=dt;const b=sh.b;
  if(sh.phase==='in'){const u=Math.min(1,sh.t/sh.T),e=1-Math.pow(1-u,3);
    sh.x=sh.x0+(b.cx-sh.x0)*e;sh.z=sh.z0+(b.cz-sh.z0)*e;sh.y=sh.ty+60*(1-e);
    if(u>=1){sh.phase='drop';sh.t=0;BOOM.round++;BOOM.need=0;boomRebuild(b);
      if(CLIENT&&CLIENT.state!=='leave')clientLeave('boom');CLIENT_USED=false;
      BOSS.x=sh.x;BOSS.z=sh.z;BOSS.y=sh.ty-8;BOSS.boom=true;bossRehire(b);
      const bonus=20000*BOOM.round;addScore(bonus);hitStop(0.08);sfxBoom(0.8);flashScreen(0.22,'#fff2c2');
      floatText(sh.x,sh.ty+16,sh.z,'🏗 부동산 호황!','count',3);toast(`${BOOM.round}차 부동산 호황! 사옥이 새로 올라갔어요 · +${fmt(bonus)}`,3600)}}
  else if(sh.phase==='drop'){if(sh.t>3){sh.phase='out';sh.t=0}}
  else{sh.x+=sh.dx*40*sh.t*dt*2;sh.z+=sh.dz*40*sh.t*dt*2;sh.y+=12*dt;if(sh.t>7)BOOM.ship=null}
  if(sh.follow&&sh.phase!=='out'){const k=Math.min(1,dt*1.8);cam.tx+=(sh.x-cam.tx)*k;cam.tz+=(sh.z-cam.tz)*k}}
// 비행선 그리기
function drawShip(m,mg){const sh=BOOM.ship;if(!sh||MODE!=='city')return;
  const r=Math.atan2(sh.dz,sh.dx),cr=Math.cos(r),sr=Math.sin(r),now=performance.now()/1000,bob=Math.sin(now*1.6)*1.2;
  const K=clamp(cam.dist/450,1,2.6);   // 멀리서 봐도 보이게 크기 키움
  const P=(lx,ly,lz,sx,sy,sz,c,shape,g)=>pushShape(g?mg:m,shape||CUBE,sh.x+(lx*cr-lz*sr)*K,sh.y+(ly+bob)*K,sh.z+(lx*sr+lz*cr)*K,sx*K,sy*K,sz*K,r,c,g?1:0);
  P(0,0,0,36,11,11,[0.93,0.93,0.95],SPHERE);                        // 기구
  P(0,0,0,30,11.4,1.2,[0.86,0.14,0.12]);                              // 빨간 띠 (현수막 자리)
  P(-30,0,0,8,0.8,16,[0.86,0.14,0.12]);P(-30,0,0,8,16,0.8,[0.86,0.14,0.12]);   // 꼬리 날개
  P(4,-13,0,14,4,5,[0.25,0.27,0.3]);P(4,-13,2.6,12,2,0.2,[1,0.86,0.45],CUBE,1);P(4,-13,-2.6,12,2,0.2,[1,0.86,0.45],CUBE,1);   // 곤돌라 · 창
  P(-6,-10.5,0,0.4,3.5,0.4,[0.3,0.3,0.32]);P(12,-10.5,0,0.4,3.5,0.4,[0.3,0.3,0.32]);
  P(-4,-19,0,0.35,12,0.35,[0.85,0.85,0.8]);P(12,-19,0,0.35,12,0.35,[0.85,0.85,0.8]);   // 현수막 줄 (글자판은 shipUI 가 겹쳐 그림)
  const blink=Math.sin(now*6)>0;P(36,0,0,1.6,1.6,1.6,blink?[1,0.3,0.25]:[0.4,0.1,0.1],SPHERE,blink);P(-34,8,0,1.2,1.2,1.2,[1,0.95,0.6],SPHERE,1);
  if(sh.phase==='in'&&Math.random()<0.5)spawn(sh.x-sh.dx*38,sh.y,sh.z-sh.dz*38,0,0,0,1.5,[1,1,1],0.6,2)}
// 비행선 현수막: 최근 7일 가장 많이 무너진 사옥 1위 (서버 '일별철거' 집계). 기록이 없으면 기본 문구
function shipTop(){const h=HOT&&HOT.d&&HOT.d[0];if(!h)return null;const i=keyIdx(h.key),mine=!!(CUR&&CUR.dkey===h.key);
  let nm=i!=null?FIRMDATA[i][0]:mine?CUR.name:((FIRMS.find(f=>f.dkey===h.key)||{}).name);if(!nm)return null;
  return{name:String(nm).replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|합자회사/g,'').trim(),kind:i!=null?(FIRMDATA[i][8]||''):(CUR&&mine?CUR.kind||'':''),people:h.people||1,mine}}
function shipUI(){let el=$('#shipBan');const sh=BOOM.ship;const on=!!sh&&MODE==='city';
  if(!el){if(!on)return;el=document.createElement('div');el.id='shipBan';document.body.appendChild(el)}
  if(!on){el.style.display='none';return}
  const K=clamp(cam.dist/450,1,2.6),bob=Math.sin(performance.now()/1000*1.6)*1.2,q=project(sh.x+sh.dx*4*K,sh.y+(bob-25)*K,sh.z+sh.dz*4*K);
  if(!q){el.style.display='none';return}
  const t=shipTop();let html;
  if(t&&t.mine)html=`<small>🎉 축 · 최근 7일 가장 많이 무너진 곳 1위 🎉</small><b>${esc(t.name)}</b><i>바로 여기! 👷 ${t.people}명이 무너뜨림</i>`;
  else if(t)html=`<small>🔥 최근 7일 가장 많이 무너진 ${t.kind==='u'?'캠퍼스':'사옥'} 1위</small><b>${esc(t.name)}</b><i>👷 ${t.people}명이 무너뜨림</i>`;
  else html=`<small>📢 부동산 호황</small><b>다음 1위는 우리 회사?</b><i>사옥 무너뜨리면 순위에 올라가요</i>`;
  if(el.dataset.h!==html){el.innerHTML=html;el.dataset.h=html}
  const sc=clamp(1.15-cam.dist/2600,0.55,1);el.style.display='';el.style.left=q[0]+'px';el.style.top=q[1]+'px';el.style.transform=`translate(-50%,0) scale(${sc.toFixed(2)})`;el.classList.toggle('mine',!!(t&&t.mine))}

// =====================================================================
//  📢 광고 타워 — 게임을 시작하고 조금 지나면 하늘에서 쌍둥이 타워가 내려와요.
//   두 타워를 잇는 연결 다리에 현수막(시트 '광고' 탭)이 걸려요. 타워는 진짜 건물이라 모든 도구로 부술 수 있고,
//   어느 한쪽이 다리 높이 아래로 무너지면 다리가 떨어지며 보너스.
//  ※ 문구·링크·이미지는 시트 '광고' 탭에서. 등장 시간은 AD_DELAY(초), 높이·간격은 AD_H·AD_GAP
// =====================================================================
const AD_DELAY=35,AD_H=120,AD_W=20,AD_GAP=56,AD_FALL=5.5,AD_BRIDGE=0.46;
let AD={list:null,t:0,tw:null,idx:0,swap:0,loading:false};
function adReset(){AD.t=0;AD.tw=null;const el=$('#adBan');if(el)el.style.display='none'}
async function adLoad(){if(AD.list||AD.loading)return;const u=rankUrl();if(!u){AD.list=[];return}AD.loading=true;
  try{const r=await fetchT(u+(u.includes('?')?'&':'?')+'action=ad',{},12000);AD.list=r&&r.ok&&Array.isArray(r.ads)?r.ads.filter(a=>a&&(a.text||a.img)):[]}catch(e){AD.list=[]}
  AD.loading=false}
// 사옥에서 120~300m 떨어진, 주변 35m 안에 건물이 없는 빈 땅 찾기 (없으면 가장 덜 붐비는 곳)
function adSpot(){const hq=B.find(b=>b.hq&&b.alive)||{cx:cam.tx,cz:cam.tz};let best=null,bs=1e9;
  for(let k=0;k<48;k++){const a=k*2.399,r=120+(k%6)*36,x=hq.cx+Math.cos(a)*r,z=hq.cz+Math.sin(a)*r;let n=0;
    forBuildingsNear(x,z,AD_GAP/2+AD_W,b=>{if(b.alive&&distToBuilding(b,x,z)<AD_GAP/2+AD_W)n+=b.area})
    if(n<bs){bs=n;best={x,z}}if(!n)break}
  return best}
function adTowerPts(x,z,rot){const h=AD_W/2,c=h*0.42,loc=[[-h+c,-h],[h-c,-h],[h,-h+c],[h,h-c],[h-c,h],[-h+c,h],[-h,h-c],[-h,-h+c]];   // 모서리를 깎은 정사각형
  const cr=Math.cos(rot),sr=Math.sin(rot);return loc.map(([u,v])=>[x+u*cr-v*sr,z+u*sr+v*cr])}
function adStart(){const p=adSpot();if(!p)return;const rot=Math.random()*Math.PI;const dx=Math.cos(rot)*AD_GAP/2,dz=Math.sin(rot)*AD_GAP/2;
  AD.tw={x:p.x,z:p.z,rot,a:{x:p.x-dx,z:p.z-dz},b:{x:p.x+dx,z:p.z+dz},phase:'fall',t:0,y:700,bs:[],bridge:true};AD.idx=0;AD.swap=0;
  sfx(10,0.6);toast('📢 하늘에서 광고 타워가 내려와요! 연결 다리를 무너뜨리면 보너스',4000)}
function adLand(){const tw=AD.tw;tw.phase='stand';tw.y=0;
  for(const s of [tw.a,tw.b]){const b=makeBuilding('ad'+Math.random().toString(36).slice(2,7),adTowerPts(s.x,s.z,tw.rot),{height:String(AD_H),building:'office'});if(!b)continue;
    b.style=2;b.col=[0.80,0.84,0.88];b.roof=[0.62,0.66,0.70];b.units=[];b.adTower=true;
    b.ck=chunkAt(b.cx,b.cz,true);b.ck.blds.push(b);B.push(b);indexBuilding(b,B.length-1);b.ck.dB=true;tw.bs.push(b);
    boom3(s.x,1,s.z,26);for(let k=0;k<24;k++)spawn(s.x+(Math.random()-.5)*40,1,s.z+(Math.random()-.5)*40,(Math.random()-.5)*16,3+Math.random()*6,(Math.random()-.5)*16,1.5+Math.random()*2,[0.85,0.83,0.8],0.9,2)}
  bldDirty=true;cam.shake=Math.max(cam.shake,opts.shake?6:0);sfxBoom(0.7);floatText(tw.x,AD_H+20,tw.z,'📢 광고 타워 도착','count',2.6)}
function adTop(b){return !b||!b.alive?0:b.det?b.base+detTop(b):bTop(b)}
function adUpdate(dt){if(MODE!=='city'||!CUR)return;
  if(!AD.tw){if(AD.list===null){adLoad();return}if(!AD.list.length)return;AD.t+=dt;if(AD.t>=AD_DELAY&&!$('#loading').classList.contains('on'))adStart();return}
  const tw=AD.tw;tw.t+=dt;AD.swap+=dt;if(AD.swap>8&&AD.list.length>1){AD.swap=0;AD.idx=(AD.idx+1)%AD.list.length}
  if(tw.phase==='fall'){const u=Math.min(1,tw.t/AD_FALL),e=1-Math.pow(1-u,3);tw.y=700*(1-e);if(Math.random()<0.6)for(const s of [tw.a,tw.b])spawn(s.x+(Math.random()-.5)*8,tw.y-2,s.z+(Math.random()-.5)*8,(Math.random()-.5)*4,-8-Math.random()*6,(Math.random()-.5)*4,1.2+Math.random(),[1,0.7,0.3],0.5,1);if(u>=1)adLand();return}
  if(tw.bridge){const by=AD_H*AD_BRIDGE;if(adTop(tw.bs[0])<by+3||adTop(tw.bs[1])<by+3){tw.bridge=false;adBridgeFall()}}}
function adBridgeFall(){const tw=AD.tw,by=AD_H*AD_BRIDGE;
  for(let k=0;k<30;k++){const t=Math.random();spawn(tw.a.x+(tw.b.x-tw.a.x)*t,by,tw.a.z+(tw.b.z-tw.a.z)*t,(Math.random()-.5)*8,Math.random()*4,(Math.random()-.5)*8,1.5+Math.random()*2.5,Math.random()<0.5?[0.80,0.84,0.88]:[0.86,0.14,0.12],0)}
  addScore(30000);sfxBoom(0.6);floatText(tw.x,by+8,tw.z,'📢 광고 다리 철거! +30,000','count',2.8);const el=$('#adBan');if(el)el.style.display='none'}
// 내려오는 동안은 통짜 타워를, 착륙 후에는 왕관(층층이 좁아지는 꼭대기)·첨탑·연결 다리만 그림 (몸통은 진짜 건물)
function drawAd(m,mg){const tw=AD.tw;if(!tw||MODE!=='city')return;const P=(x,y,z,sx,sy,sz,c,g,sh)=>pushShape(g?mg:m,sh||CUBE,x,y,z,sx,sy,sz,tw.rot,c,g?1:0);
  const silver=[0.80,0.84,0.88],dark=[0.42,0.47,0.53];
  [tw.a,tw.b].forEach((s,i)=>{const b=tw.bs[i];let base=tw.y;
    if(tw.phase==='fall'){P(s.x,base+AD_H/2,s.z,AD_W,AD_H,AD_W,silver);P(s.x,base+AD_H*0.25,s.z,AD_W+0.4,1,AD_W+0.4,dark);P(s.x,base+AD_H*0.7,s.z,AD_W+0.4,1,AD_W+0.4,dark);P(s.x,base-2,s.z,6,3,6,[1,0.75,0.35],1)}
    else if(!b||!b.alive||b.det||b.h<b.h0-0.5)return;
    const top=base+AD_H;P(s.x,top+5,s.z,AD_W*0.78,10,AD_W*0.78,silver);P(s.x,top+13,s.z,AD_W*0.52,7,AD_W*0.52,silver);P(s.x,top+19,s.z,AD_W*0.28,5,AD_W*0.28,dark);
    P(s.x,top+33,s.z,0.9,24,0.9,[0.9,0.9,0.92]);P(s.x,top+46,s.z,1.6,1.6,1.6,Math.sin(performance.now()/300)>0?[1,0.3,0.25]:[0.5,0.1,0.1],1,SPHERE)});
  if(tw.bridge){const by=tw.y+AD_H*AD_BRIDGE,len=AD_GAP-AD_W*0.8;P(tw.x,by,tw.z,len,4.2,5.5,silver);P(tw.x,by,tw.z,len+0.2,1.2,5.7,[1,0.86,0.45],1);P(tw.x,by-2.4,tw.z,len,0.6,6,dark)}}
function adUI(){let el=$('#adBan');const tw=AD.tw,on=!!tw&&tw.bridge&&MODE==='city'&&AD.list&&AD.list.length;
  if(!on){if(el)el.style.display='none';return}
  if(!el){el=document.createElement('a');el.id='adBan';el.target='_blank';el.rel='noopener';document.body.appendChild(el)}
  const by=tw.y+AD_H*AD_BRIDGE-3,q=project(tw.x,by,tw.z);if(!q){el.style.display='none';return}
  const a=AD.list[AD.idx%AD.list.length];const html=(a.who?`<small>${esc(a.who)}</small>`:'')+(a.img?`<img src="${esc(a.img)}" alt="" onerror="this.remove()">`:'')+(a.text?`<b>${esc(a.text)}</b>`:'')+(a.link?'<i>눌러서 보기 ↗</i>':'');
  if(el.dataset.h!==html){el.innerHTML=html;el.dataset.h=html;if(a.link)el.href=a.link;else el.removeAttribute('href');el.classList.toggle('lk',!!a.link)}
  const sc=clamp(0.95-cam.dist/2600,0.42,0.85);el.style.display='';el.style.left=q[0]+'px';el.style.top=q[1]+'px';el.style.transform=`translate(-50%,0) scale(${sc.toFixed(2)})`}
// =====================================================================
//  발주처(클라이언트) — "더 부술 거리를 던져주는 고급 샌드백"
//   · 등장: 사장님이 옥상에 있을 때 사장님 건물이 20~30% 부서지면 검은 차로 난입 (동네·단면 모드 모두, 한 판에 1번)
//   · 패턴 A 억지 보강 : 빨간 임시 철골(동바리)을 덧댐 → 때리면 유리처럼 깨지며 점수
//   · 패턴 B 부분 홀딩 : 한두 개 층에 빨간펜 테이프 → 약한 타격은 덜 먹지만, 불도저·쇠공·다이너마이트 같은 강한 타격이면 뜯기며 보너스
//   · 패턴 C 물량 공세 : "제가 생각한 느낌은 이런 거거든요" → 옥상·빈터에 매스를 마구 떨어뜨림 (추가 타깃)
//   · 재건축 1회 : 건물이 무너지면 "돈 줬잖아요, 다시 일하세요!" → 새 건물 + 사장님 강제 복귀. 두 번째 붕괴 때는 포기하고 도망
//  ※ 대사·회사 이름은 CLIENT_LINES / CLIENT_NAMES 만 고치면 돼요. (실제 회사와 관계없는 가상 이름만 쓰기)
// =====================================================================
function clientScale(){return MODE==='section'?2.2:bossScale()*1.4}   // 사장님보다 큼직하게
const CLIENT_NAMES=['(주)해줘해줘 개발','무한설변 홀딩스','느낌만 리츠','새벽회의 디벨롭먼트','마감엄수 자산운용'];
const CLIENT_LINES={
  arrive:['잠깐만요, 이거 누가 부수라고 했어요?','발주처입니다. 이거 제 건물이에요!','제 건물에 무슨 짓이에요!'],
  nag:['새벽에 회의하자고 했잖아요!','이번 주 마감까지 무조건 지켜주세요.','제가 낸 돈이 얼만데 아직도 이 모양이죠? 해줘, 해줘, 해달라고요!','느낌만 보게 대충 3D로 돌려주세요.',
    'A안이랑 B안 섞어서 C안 만들어 주세요.','예산은 그대로인데 좀 더 고급스럽게요.','처음 안이 제일 나았던 것 같아요.','회장님이 보시더니 다시 하재요.'],
  A:['임시로 철골 좀 덧대세요. 일단 버티게요!','보강하세요. 돈은 나중에 드릴게요.'],
  B:['수정사항 빨간펜으로 표시했어요. 여기는 손대지 마세요.','레드라인 확인하셨죠? 이 층은 건드리지 마요.'],
  C:['제가 생각한 느낌은 이런 거거든요.','매스 몇 개 더 얹어볼게요. 느낌 있게!','랜드마크가 필요해요. 툭툭 던져볼게요.'],
  D:['옆에 타워 하나 더 올리죠. 용적률은 알아서!','랜드마크 타워 갑니다. 높게, 더 높게!','공사비요? 일단 올리고 생각해요!'],
  broke:['그거 비싼 거예요!','제 아이디어였는데!','아니 그걸 왜 부숴요!'],
  tape:['제 빨간펜을 찢어요?!','수정사항 무시하시는 거예요?'],
  rebuild:['돈 줬잖아요, 다시 일하세요!','처음부터 다시 지어요. 예산은 그대로!','사장님, 재계약입니다. 도장 찍으세요.'],
  rebuilt:['자, 새 건물이에요. 이번엔 부수지 마세요.','준공 날짜는 그대로예요!'],
  giveup:['아 몰라요, 이 프로젝트 접을게요!','다른 사무소 알아볼게요!','법무팀이랑 얘기하세요!'],
};
let CLIENT=null,CLIENT_USED=false;
const CL_SHIRT=[0.93,0.52,0.64],CL_PANTS=[0.80,0.72,0.54],CL_CAP=[0.97,0.97,0.95],CL_CAR=[0.06,0.06,0.07],CL_GLASS=[0.16,0.2,0.24],CL_RED=[0.86,0.12,0.1];
const MASS_COLS=[[0.93,0.30,0.62],[0.18,0.78,0.72],[0.98,0.78,0.12],[0.56,0.38,0.92],[0.6,0.62,0.66]];
function clientReset(){CLIENT=null;drawClientUI()}
// 등장 배너 (PC·휴대폰 공통) — 누가 왔고 무엇을 하면 되는지 한눈에
function clientBanner(name){const el=$('#clientBanner');if(!el)return;
  el.innerHTML=`<b>😤 발주처 난입!</b><span>${esc(name)}</span><p>빨간 임시 철골 · 빨간펜 테이프 · 매스 · 가설 타워를 마구 갖다 놔요.<br><em>전부 부술 거리!</em> 부술수록 점수 폭발 · 건물이 무너지면 한 번 재건축</p>`;
  el.classList.remove('on');void el.offsetWidth;el.classList.add('on');clearTimeout(clientBanner._t);clientBanner._t=setTimeout(()=>el.classList.remove('on'),5200)}
// ---- 사용자가 정한 발주처 이름 (회사 고르기 창 · 설정) — 이 브라우저에만 저장, 서버·랭킹·공유로 보내지 않음
// ---- 사용자가 정한 사장님 이름 — 이 브라우저에만 저장. 철거 일보·공유·랭킹에는 넣지 않음
function bossName(){const v=lsGet('smasharch_boss');return typeof v==='string'?v:''}
function bossTitle(){return CUR&&CUR.kind==='u'?'총장님':'사장님'}   // 대학교는 총장님
function BT(){const n=bossName();return n?n+' '+bossTitle():bossTitle()}
(function(){const ins=[$('#bossName'),$('#bossName2')].filter(Boolean);
  const fill=()=>{ins.forEach(el=>{if(document.activeElement!==el)el.value=bossName()})};
  const save=el=>{lsSet('smasharch_boss',el.value.replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,12));fill()};
  ins.forEach(el=>{el.addEventListener('change',()=>save(el));el.addEventListener('blur',()=>save(el));el.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter')el.blur()})});fill()})();
function clientNamesUser(){const v=lsGet('smasharch_clients');return Array.isArray(v)?v:[]}
function clientName(){const u=clientNamesUser();return pickL(u.length?u:CLIENT_NAMES)}
(function(){const ins=[$('#clientNames'),$('#clientNames2')].filter(Boolean);
  const fill=()=>{const t=clientNamesUser().join(', ');ins.forEach(el=>{if(document.activeElement!==el)el.value=t})};
  const save=el=>{const v=el.value.split(/[,，]/).map(x=>x.replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,20)).filter(Boolean).slice(0,5);lsSet('smasharch_clients',v);fill()};
  ins.forEach(el=>{el.addEventListener('change',()=>save(el));el.addEventListener('blur',()=>save(el));el.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter')el.blur()})});fill()})();
function clientSay(text,prio){const c=CLIENT;if(!c||!text)return;const now=performance.now();if((prio||0)<1&&now-c.lastSay<2600)return;c.text=text;c.textT=3.2;c.lastSay=now}
function clientInSec(){return MODE==='section'&&!!SEC&&!!CLIENT&&SEC.b===CLIENT.b}
function clientHere(){return !!CLIENT&&(MODE==='city'||clientInSec())}
// 차 세울 자리 (동네: 건물 중심에서 카메라 쪽)
function clientSpot(b){let ax=MODE==='city'?eye[0]-b.cx:1,az=MODE==='city'?eye[2]-b.cz:0;const l=Math.hypot(ax,az)||1;ax/=l;az/=l;const R=Math.sqrt(b.area)/2+9;return{x:b.cx+ax*R,z:b.cz+az*R,tx:-az,tz:ax}}
// 발주처 위치 (모드별)
function clientPos(){const c=CLIENT;if(clientInSec())return{x:-(SEC.W/2+7),y:0,z:SEC.D/2+3,car:{x:-(SEC.W/2+16)+(c.state==='arrive'?-60*(1-Math.min(1,c.t/1.2)):0)+(c.state==='leave'&&c.t>0.7?-(c.t-0.7)*40:0),z:SEC.D/2+4,dx:1,dz:0}};
  return{x:c.x,y:groundAt(c.x,c.z),z:c.z,car:c.car}}
function clientCreate(b){const sp=clientSpot(b);CLIENT_USED=true;
  CLIENT={b,name:clientName(),state:'arrive',t:0,x:sp.x,z:sp.z,
    car:{x:sp.x+sp.tx*110,z:sp.z+sp.tz*110,px:sp.x+sp.tx*7,pz:sp.z+sp.tz*7,dx:-sp.tx,dz:-sp.tz,v:70},
    text:'',textT:0,lastSay:0,sayT:5,cool:1.5,wind:null,last:'',posts:[],tape:null,masses:[],rebuilt:false,broken:0};
  clientBanner(CLIENT.name);sfx(10,0.6);sfxBoom(0.5);
  if(BOSS)bossSay('발주처 오셨다! 다들 일어나!',3)}
// 동네: 사장님 건물 피해 누적 → 20~30% 정도 부서지면 등장
function clientDamage(b,n){if(CLIENT||CLIENT_USED||MODE!=='city'||!BOSS||BOSS.state!=='idle'||b!==BOSS.b||!b.det)return;b.cdmg=(b.cdmg||0)+n;
  const d=b.det;if(b.cdmg>0.22*(d.F*d.M+3*d.F*d.C))clientCreate(b)}
// ---------- 패턴 ----------
function clientWind(kind){CLIENT.wind={kind,t:0,T:kind==='rebuild'?2.4:1.4};clientSay(pickL(CLIENT_LINES[kind]),3)}
function clientDo(kind){const c=CLIENT;c.last=kind;if(clientInSec()){clientSecDo(kind);return}const b=c.b;if(!b.alive||!b.det&&kind!=='C')kind='C';const d=b.det;
  if(kind==='A'){let f=-1;for(let k=0;k<d.F;k++)if(!d.fl[k]){f=k;break}if(f<0){let w=1;for(let k=0;k<d.F;k++){if(!d.fl[k])continue;const s=floorSupport(d,k);if(s<w){w=s;f=k}}}if(f<0)f=0;
    const top=Math.min(b.base+d.fy[Math.min(d.F-1,f)]+d.fh*1.2,b.base+Math.max(3,b.h));const n=Math.min(16,Math.max(8,Math.round(d.M/2)));
    for(let k=0;k<n;k++){const j=Math.floor(k*d.M/n);const a=d.nodes[j],e=d.edgeN[j];c.posts.push({x:a[0]+e[0]*1.6,z:a[1]+e[1]*1.6,y0:b.base,y1:top,rot:Math.atan2(e[1],e[0]),alive:true})}
    floatText(b.cx,top+4,b.cz,'억지 보강','cad',1.6);sfx(6,0.3)}
  else if(kind==='B'){let f=0,w=-1;for(let k=0;k<d.F;k++){if(d.fl[k]&&(w<0||k<=d.F*0.4)){f=k;w=1}}c.tape={f0:Math.max(0,f-1),f1:f,tear:false};floatText(b.cx,bTop(b)+4,b.cz,'수정 지시','cad',1.6);sfx(4,0.3)}
  else if(kind==='D'){const R=Math.sqrt(b.area)/2;let alive=c.masses.filter(m=>m.alive).length;const n=1+(Math.random()<0.5?1:0);
    for(let k=0;k<n&&alive<16;k++,alive++){const a=Math.random()*Math.PI*2,r=R+16+Math.random()*25,w=10+Math.random()*7;
      c.masses.push({x:b.cx+Math.cos(a)*r,z:b.cz+Math.sin(a)*r,roof:false,w,h:35+Math.random()*35,d:w,rot:Math.random()*Math.PI,frame:true,tower:true,col:pickL([[0.98,0.78,0.12],[0.86,0.2,0.16],[0.2,0.55,0.95]]),dy:0,v:0,alive:true,landed:true,hit:0,hp:3,grow:0})}
    floatText(b.cx,bTop(b)+12,b.cz,'가설 타워 착공!','cad',1.8);sfx(12,0.8)}
  else{const R=Math.sqrt(b.area)/2,n=5+Math.floor(Math.random()*4);let alive=c.masses.filter(m=>m.alive).length;
    for(let k=0;k<n&&alive<16;k++,alive++){const roof=b.alive&&k<2;const s=clamp(R*(0.6+Math.random()*0.5),8,28);
      let x=b.cx,z=b.cz;if(roof){x+=(Math.random()-.5)*R*0.6;z+=(Math.random()-.5)*R*0.6}else{const a=Math.random()*Math.PI*2,r=R+8+Math.random()*32;x+=Math.cos(a)*r;z+=Math.sin(a)*r}
      c.masses.push({x,z,roof,w:s*(0.7+Math.random()*0.6),h:s*(0.6+Math.random()*0.8),d:s*(0.7+Math.random()*0.5),rot:Math.random()*Math.PI,frame:Math.random()<0.5,col:MASS_COLS[Math.floor(Math.random()*MASS_COLS.length)],
        dy:90+k*16,v:0,alive:true,landed:false,hit:0,hp:2})}}
}
// 단면 모드: 같은 패턴을 단면 부재로 추가 (되돌리기·재건축 때는 자동으로 사라짐)
function clientSecDo(kind){const c=CLIENT;SEC.tapeK=SEC.tapeK||new Set();
  const okS=SEC.st.filter(s=>s.state==='ok'&&s.k>=0);if(!okS.length)return;
  const add=(k,box,hp,w,col,extra)=>{const e=Object.assign({k,kind:'cx',box,hp,hp0:hp,w,col,alive:true,cx:1},extra||{});SEC.els.push(e);return e};
  if(kind==='A'){let best=null,bw=2;for(const s of okS){const h=storyHealth(s);if(h.r<bw){bw=h.r;best=s}}const s=best||okS[0];
    const n=Math.max(3,Math.round(SEC.W/9));for(let i=0;i<n;i++){const x=-SEC.W/2+2+(SEC.W-4)*(i+0.5)/n;add(s.k,[x-0.28,SLAB_T,SEC.D/2-2.4,x+0.28,s.h,SEC.D/2-1.8],0.6,3,CL_RED,{glass:0.6,post:1})}}
  else if(kind==='B'){const s=okS[Math.min(okS.length-1,Math.floor(okS.length*0.3))];add(s.k,[-SEC.W/2,s.h*0.42,SEC.D/2-0.5,SEC.W/2,s.h*0.58,SEC.D/2-0.1],1.2,6,[0.95,0.08,0.06],{ctape:1});SEC.tapeK.add(s.k)}
  else if(kind==='D'){const side=Math.random()<0.5?-1:1,w=5+Math.random()*3,x=side*(SEC.W/2+6+w/2),h=24+Math.random()*16;
    add(0,[x-w/2,SLAB_T,-w/2,x+w/2,SLAB_T+h,w/2],2.4,8,[0.98,0.78,0.12],{glass:0.2});add(0,[x-w/2-0.5,SLAB_T+h,-0.5,x+w/2+8,SLAB_T+h+0.8,0.5],0.8,2,[0.86,0.2,0.16])}
  else{const top=okS[okS.length-1];const n=5+Math.floor(Math.random()*3);
    for(let i=0;i<n;i++){const col=MASS_COLS[Math.floor(Math.random()*MASS_COLS.length)];
      if(i<2){const w=6+Math.random()*8,x=(Math.random()-.5)*(SEC.W-w-2),h=4+Math.random()*6;add(top.k,[x-w/2,top.h+SLAB_T,-SEC.D/2+2,x+w/2,top.h+SLAB_T+h,SEC.D/2-2],1.2,5,col,{glass:0.3})}
      else{const side=Math.random()<0.5?-1:1,w=5+Math.random()*7,x=side*(SEC.W/2+4+w/2+Math.random()*10),h=4+Math.random()*8;add(0,[x-w/2,SLAB_T,-4,x+w/2,SLAB_T+h,4],1.2,5,col,{glass:0.3})}}
    secBoom(0,secTop()+4,SEC.D*0.3,14)}
  secDirty=true;sfx(6,0.3)}
// 단면 부재(발주처가 추가한 것)가 부서졌을 때
function clientSecBroke(e){if(!CLIENT)return;CLIENT.broken++;addScore(1200);comboHit(1);
  if(e.ctape){if(SEC.tapeK)SEC.tapeK.delete(e.k);toast('빨간펜 테이프를 찢었어요! +3,000',1600);addScore(3000);clientSay(pickL(CLIENT_LINES.tape),2)}
  else if(Math.random()<0.4)clientSay(pickL(CLIENT_LINES.broke),1);
  sfxGlass()}
// 빨간펜: 약한 타격은 35%만 들어가고, 강한 타격(위력 1.2 이상)은 테이프를 찢음
function clientTape(b,y,power){const c=CLIENT,t=c.tape,d=b.det;if(!t||!d)return power;
  const f=Math.floor((y-b.base)/d.fh);if(f<t.f0||f>t.f1)return power;
  if(power>=1.2){c.tape=null;addScore(3000);comboHit(1);floatText(b.cx,b.base+d.fy[t.f1]+d.fh,b.cz,'빨간펜 찢음! +3,000','cad',1.6);clientSay(pickL(CLIENT_LINES.tape),2);sfxGlass();return power}
  if(Math.random()<0.15)floatText(b.cx,y+3,b.cz,'반려','cad',0.8);return power*0.35}
// 공용: (x,y,z) 반경 r 의 타격이 발주처 오브젝트(철골·매스)에 닿았는지
function clientHitAt(x,y,z,r,power,set){const c=CLIENT;if(!c||MODE!=='city'||c.state==='leave')return;
  for(const p of c.posts){if(!p.alive||(set&&set.has(p)))continue;if(Math.hypot(p.x-x,p.z-z)<r+1.5&&y>p.y0-2&&y<p.y1+r){p.alive=false;if(set)set.add(p);
    for(let k=0;k<6;k++)spawn(p.x,p.y0+Math.random()*(p.y1-p.y0),p.z,(Math.random()-.5)*8,2+Math.random()*5,(Math.random()-.5)*8,0.4+Math.random()*0.6,k%2?CL_RED:[0.75,0.85,0.9],1.6,2);
    addScore(1500);comboHit(1);c.broken++;sfxGlass()}}
  for(const m of c.masses){if(!m.alive||!m.landed||(set&&set.has(m)))continue;const my=clientMassY(m)+m.h/2;
    if(Math.hypot(m.x-x,m.z-z)<r+Math.max(m.w,m.d)*0.6&&Math.abs(my-y)<m.h/2+r){if(set)set.add(m);m.hit+=power>=1.2?2:1;m.flash=0.2;if(m.hit>=(m.hp||2)){clientBreakMass(m)}else if(m.tower)floatText(m.x,clientMassY(m)+m.h*(m.grow||1)+3,m.z,`타워 ${m.hit}/${m.hp}`,'cad',0.8)}}}
function clientMassY(m){const b=CLIENT.b;return m.roof&&b.alive?bTop(b):groundAt(m.x,m.z)}
function clientBreakMass(m){m.alive=false;const y=clientMassY(m);boom3(m.x,y+m.h/2,m.z,m.tower?26:14);if(m.tower){sfxBoom(0.9);cam.shake=Math.max(cam.shake,6);for(let k=0;k<24;k++)spawn(m.x+(Math.random()-.5)*m.w,y+Math.random()*m.h,m.z+(Math.random()-.5)*m.d,(Math.random()-.5)*16,2+Math.random()*8,(Math.random()-.5)*16,1+Math.random()*2.4,k%2?m.col:[0.55,0.55,0.58])}
  for(let k=0;k<14;k++)spawn(m.x+(Math.random()-.5)*m.w,y+Math.random()*m.h,m.z+(Math.random()-.5)*m.d,(Math.random()-.5)*14,4+Math.random()*8,(Math.random()-.5)*14,0.8+Math.random()*1.8,k%3?m.col:[0.75,0.85,0.9],2.2,2);
  const pts=m.tower?8000:2500;addScore(pts);comboHit(m.tower?2:1);CLIENT.broken++;floatText(m.x,y+m.h+3,m.z,'+'+fmt(pts),'cad',0.9);if(Math.random()<0.4)clientSay(pickL(CLIENT_LINES.broke),1);sfxGlass()}
// ---------- 재건축 1회 · 포기 ----------
function clientRebuild(){const c=CLIENT,b=c.b;c.rebuilt=true;c.posts=[];c.tape=null;
  if(clientInSec()){const sc=score;secRestore(SEC.base);score=sc;SEC.tapeK=new Set();if(BOSS){BOSS.sec=null;BOSS.state='idle'}}
  else{if(!b.custom){if(!b.colPre)b.colPre=b.col;b.col=[0.95,0.70,0.78];b.h0=Math.min(b.h0*1.15+4,b.h0+30)}
    freeDet(b);b.alive=true;b.lifted=false;b.h=b.h0;b.cdmg=0;b.domino=0;if(b.custom)ensureDet(b);markB(b);bldDirty=true;   // MAP 사옥 모델은 구조(det)가 있어야 모양이 그려짐
    const R=Math.sqrt(b.area)/2+2;for(let i=0;i<MAXD;i++)if(D.used[i]&&Math.hypot(D.x[i]-b.cx,D.z[i]-b.cz)<R)D.used[i]=0;rubDirty=true;
    boom3(b.cx,b.base+3,b.cz,30);for(let k=0;k<30;k++)spawn(b.cx+(Math.random()-.5)*R*2,b.base+1,b.cz+(Math.random()-.5)*R*2,(Math.random()-.5)*10,4+Math.random()*8,(Math.random()-.5)*10,1+Math.random()*2,[0.85,0.83,0.8],0.9,2);
    bossRehire(b)}
  hitStop(0.08);sfxBoom(0.8);flashScreen(0.2,'#ffe1ea');addScore(20000);
  clientSay(pickL(CLIENT_LINES.rebuilt),3);toast('발주처가 건물을 새로 지었어요 — '+BT()+' 강제 복귀! 다시 부수세요 · +20,000',3600);c.cool=3}
function clientLeave(why){const c=CLIENT;if(!c||c.state==='leave')return;c.state='leave';c.t=0;c.wind=null;c.tape=null;if(clientInSec()&&SEC.tapeK)SEC.tapeK.clear();
  if(why==='giveup'){const bonus=30000+c.broken*500;addScore(bonus);clientSay(pickL(CLIENT_LINES.giveup),3);const p=clientPos();
    floatText(p.x,p.y+clientScale()*3,p.z,'사업 포기','mark',3);flashScreen(0.2,'#ffd9d4');sfx(20,1);
    toast(`발주처가 프로젝트를 접고 도망갔어요! 부순 발주처 물건 ${c.broken}개 · +${fmt(bonus)}`,4000);if(BOSS&&BOSS.state==='idle')bossSay('발주처 가셨다… 이제 우리 끝이다…',3)}}
// ---------- 업데이트 ----------
function clientUpdate(dt){
  if(!CLIENT&&!CLIENT_USED&&MODE==='section'&&SEC&&BOSS&&BOSS.state==='idle'&&SEC.b===BOSS.b){clientUpdate.acc=(clientUpdate.acc||0)+dt;if(clientUpdate.acc>0.5){clientUpdate.acc=0;if(secCollapse()>=0.18)clientCreate(SEC.b)}}
  const c=CLIENT;if(!c)return;if(!clientHere())return;
  c.t+=dt;if(c.textT>0)c.textT-=dt;
  const sec=clientInSec(),b=c.b;
  if(c.state==='arrive'){if(sec){if(c.t>1.2){c.state='idle';c.t=0;c.car.x=c.car.px;c.car.z=c.car.pz;clientSay(pickL(CLIENT_LINES.arrive),2)}return}
    const car=c.car,dx=car.px-car.x,dz=car.pz-car.z,l=Math.hypot(dx,dz);
    if(l>0.6){const sp=Math.min(l,Math.max(12,Math.min(car.v,l*2.2))*dt);car.x+=dx/l*sp;car.z+=dz/l*sp}else{c.state='idle';c.t=0;clientSay(pickL(CLIENT_LINES.arrive),2)}return}
  if(c.state==='leave'){if(!sec&&c.t>0.7){const car=c.car;car.v=Math.min(90,(car.v||0)+60*dt);car.x+=car.dx*car.v*dt;car.z+=car.dz*car.v*dt}if(c.t>4.2)CLIENT=null;return}
  // 매스 낙하
  if(!sec)for(const m of c.masses){if(!m.alive)continue;if(m.roof&&!b.alive){m.roof=false;m.landed=false;m.dy=Math.max(m.dy,bTop(b)-groundAt(m.x,m.z))}
    if(m.tower&&m.grow<1){m.grow=Math.min(1,m.grow+dt*0.6);if(Math.random()<0.4)spawn(m.x+(Math.random()-.5)*m.w,groundAt(m.x,m.z)+1,m.z+(Math.random()-.5)*m.d,0,2,0,1,[0.8,0.78,0.74],0.8,3)}
    if(!m.landed){m.v+=70*dt;m.dy=Math.max(0,m.dy-m.v*dt);if(m.dy<=0){m.landed=true;m.v=0;const y=clientMassY(m);boom3(m.x,y+1,m.z,8);sfxBoom(0.3);cam.shake=Math.max(cam.shake,2)}}}
  // 건물 붕괴 → 재건축 1회, 두 번째면 포기
  const dead=sec?secCollapse()>=0.8:(!b.alive||b.lifted);
  if(c.wind&&c.wind.kind==='rebuild'){c.wind.t+=dt;if(c.wind.t>=c.wind.T){c.wind=null;clientRebuild()}return}
  if(dead){if(!c.rebuilt)clientWind('rebuild');else clientLeave('giveup');return}
  if(c.wind){c.wind.t+=dt;if(c.wind.t>=c.wind.T){const k=c.wind.kind;c.wind=null;clientDo(k);c.cool=3.5+Math.random()*2.5}}
  else{c.cool-=dt;if(c.cool<=0){const opts2=['A','B','C','D','C'].filter(k=>k!==c.last&&!(k==='B'&&(sec?SEC.tapeK&&SEC.tapeK.size:c.tape)));clientWind(pickL(opts2.length?opts2:['C']))}}
  c.sayT-=dt;if(c.sayT<=0){c.sayT=7+Math.random()*4;if(!c.wind)clientSay(pickL(CLIENT_LINES.nag),0)}
}
// ---------- 그리기 ----------
function drawClient(m,mg){const c=CLIENT;if(!c||!clientHere())return;
  const S=clientScale(),now=performance.now()/1000,b=c.b,sec=clientInSec(),P0=clientPos();
  // 검은 세단
  {const car=P0.car,g=sec?0:groundAt(car.x,car.z),r=Math.atan2(car.dz,car.dx),k=S*0.48,cr=Math.cos(r),sr=Math.sin(r);
    const P=(lx,ly,lz,sx,sy,sz,col)=>pushShape(m,CUBE,car.x+lx*cr*k-lz*sr*k,g+ly*k,car.z+lx*sr*k+lz*cr*k,sx*k,sy*k,sz*k,r,col,0);
    P(0,0.75,0,4.6,0.8,1.9,CL_CAR);P(-0.2,1.45,0,2.5,0.65,1.7,CL_GLASS);P(-0.2,1.8,0,2.4,0.08,1.6,CL_CAR);
    for(const [x,z] of [[1.5,0.95],[1.5,-0.95],[-1.5,0.95],[-1.5,-0.95]])P(x,0.4,z,0.8,0.8,0.25,[0.03,0.03,0.03]);
    P(2.31,0.8,0.6,0.05,0.18,0.35,[1,0.95,0.7]);P(2.31,0.8,-0.6,0.05,0.18,0.35,[1,0.95,0.7])}
  if(!sec){
    // 억지 보강 철골(동바리) · 빨간펜 · 매스
    for(const p of c.posts){if(!p.alive)continue;const h=p.y1-p.y0;pushShape(m,CUBE,p.x,p.y0+h/2,p.z,1.1,h,1.1,p.rot,CL_RED,0);
      pushShape(m,CUBE,p.x,p.y0+h*0.72,p.z,0.5,h*0.55,4,p.rot,[0.7,0.1,0.08],0);pushShape(mg,CUBE,p.x,p.y1+0.4,p.z,1.4,0.5,1.4,0,[1,0.25,0.15],1)}
    if(c.tape&&b.alive&&b.det){const d=b.det,pts=b.pts,n=pts.length,pul=0.75+0.25*Math.sin(now*6);
      for(let f=c.tape.f0;f<=c.tape.f1;f++){if(f>=d.F||!d.fl[f])continue;const y=b.base+d.fy[f]+d.fh*0.5;
        for(let i=0;i<n;i++){const A=pts[i],C=pts[(i+1)%n],dx=C[0]-A[0],dz=C[1]-A[1],L=Math.hypot(dx,dz);if(L<0.5)continue;let nx=dz/L,nz=-dx/L;const mx=(A[0]+C[0])/2,mz=(A[1]+C[1])/2;if((mx-b.cx)*nx+(mz-b.cz)*nz<0){nx=-nx;nz=-nz}
          pushShape(mg,CUBE,mx+nx*0.6,y,mz+nz*0.6,L+0.6,0.9,0.25,Math.atan2(dz,dx),[pul,0.05,0.04],1)}}}
    for(const ms of c.masses){if(!ms.alive)continue;const y=clientMassY(ms)+ms.dy;
      if(ms.flash>0)ms.flash-=0.016;
      if(ms.tower){const W=ms.w,H=ms.h*(ms.grow||1),cr=Math.cos(ms.rot),sr=Math.sin(ms.rot),col=ms.flash>0?[1,1,1]:ms.col;   // 가설 타워: 층마다 보·기둥
        const E=(lx,ly,lz,sx,sy,sz,c2)=>pushShape(m,CUBE,ms.x+lx*cr-lz*sr,y+ly,ms.z+lx*sr+lz*cr,sx,sy,sz,ms.rot,c2||col,0);
        for(const [sx,sz] of [[-1,-1],[1,-1],[-1,1],[1,1]])E(sx*W/2,H/2,sz*W/2,0.8,H,0.8);
        for(let yy=0;yy<=H;yy+=4.2){E(0,yy,-W/2,W,0.5,0.5);E(0,yy,W/2,W,0.5,0.5);E(-W/2,yy,0,0.5,0.5,W);E(W/2,yy,0,0.5,0.5,W);if(yy%12.6<4)E(0,yy,0,W,0.25,W,[0.6,0.6,0.62])}
        E(W/2+3,H+2,0,0.6,4,0.6,[0.98,0.78,0.12]);E(W/2-4,H+4,0,16,0.6,0.6,[0.98,0.78,0.12]);continue}   // 꼭대기 크레인
      if(ms.frame){const t=0.6,W=ms.w,H=ms.h,Dd=ms.d,cr=Math.cos(ms.rot),sr=Math.sin(ms.rot);   // 마감 안 된 철골조
        const E=(lx,ly,lz,sx,sy,sz)=>pushShape(m,CUBE,ms.x+lx*cr-lz*sr,y+ly,ms.z+lx*sr+lz*cr,sx,sy,sz,ms.rot,ms.col,0);
        for(const [sx,sz] of [[-1,-1],[1,-1],[-1,1],[1,1]])E(sx*W/2,H/2,sz*Dd/2,t,H,t);
        for(const yy of [0,H/2,H])for(const sz of [-1,1]){E(0,yy,sz*Dd/2,W,t,t);E(sz*W/2,yy,0,t,t,Dd)}}
      else pushShape(m,CUBE,ms.x,y+ms.h/2,ms.z,ms.w,ms.h,ms.d,ms.rot,ms.flash>0?[1,1,1]:ms.col,0);
      if(ms.dy>0)pushShape(mg,CUBE,ms.x,groundAt(ms.x,ms.z)+0.3+(ms.roof&&b.alive?bTop(b)-groundAt(ms.x,ms.z):0),ms.z,ms.w,0.2,ms.d,ms.rot,[1,0.3,0.4],1)}
    if(c.wind&&c.wind.kind==='rebuild'){const u=c.wind.t/c.wind.T,R=Math.sqrt(b.area)/2,pul=0.5+0.5*Math.sin(now*12),g0=groundAt(b.cx,b.cz);
      pushShape(mg,CUBE,b.cx,g0+0.5,b.cz,R*1.6,0.3,R*1.6,0,[1,0.4+0.3*pul,0.6],1);pushShape(mg,CUBE,b.cx,g0+(b.h0||20)*u*0.5,b.cz,R*0.9,(b.h0||20)*u,R*0.9,0,[1,0.55,0.75],1)}}
  // 발주처 본인 (차 안에 있을 땐 안 그림)
  if(c.state==='arrive'||(c.state==='leave'&&c.t>0.6))return;
  const g=P0.y,dx=eye[0]-P0.x,dz=eye[2]-P0.z;const r=Math.atan2(-dx,dz),cr=Math.cos(r),sr=Math.sin(r);
  const P=(lx,ly,lz,sx,sy,sz,col)=>pushShape(m,CUBE,P0.x+(lx*cr-lz*sr)*S,g+ly*S,P0.z+(lx*sr+lz*cr)*S,sx*S,sy*S,sz*S,r,col,0);
  const bob=Math.sin(now*4)*0.02,wind=!!c.wind,talk=c.textT>0;
  P(0.12,0.44,0,0.16,0.86,0.18,CL_PANTS);P(-0.12,0.44,0,0.16,0.86,0.18,CL_PANTS);
  P(0.12,0.04,0.05,0.18,0.08,0.3,[0.95,0.95,0.93]);P(-0.12,0.04,0.05,0.18,0.08,0.3,[0.95,0.95,0.93]);
  P(0,1.2+bob,0,0.6,0.74,0.36,CL_SHIRT);P(0,1.52+bob,0.12,0.26,0.08,0.14,[0.97,0.97,0.96]);
  if(wind){P(0.4,1.78+bob,0,0.13,0.6,0.13,CL_SHIRT);P(-0.4,1.78+bob,0,0.13,0.6,0.13,CL_SHIRT);P(0.4,2.1+bob,0,0.12,0.12,0.12,SKIN);P(-0.4,2.1+bob,0,0.12,0.12,0.12,SKIN)}
  else{P(-0.4,1.22+bob,0.02,0.13,0.55,0.13,CL_SHIRT);P(-0.4,0.92+bob,0.04,0.12,0.12,0.12,SKIN);P(-0.4,0.86+bob,0.04,0.14,0.05,0.14,[0.85,0.68,0.2]);
    P(0.36,1.5+bob,0.05,0.13,0.4,0.13,CL_SHIRT);P(0.3,1.82+bob,0.06,0.1,0.1,0.1,SKIN);P(0.27,1.88+bob,0.02,0.05,0.24,0.12,[0.1,0.1,0.12])}
  P(0,1.85+bob,0,0.4,0.4,0.38,SKIN);P(0,2.07+bob,-0.02,0.44,0.12,0.42,CL_CAP);P(0,2.02+bob,0.27,0.4,0.04,0.2,CL_CAP);
  P(0,1.9+bob,0.2,0.36,0.08,0.03,[0.04,0.04,0.05]);
  P(0,1.73+bob,0.2,talk?0.12:0.13,talk?0.05+Math.abs(Math.sin(now*14))*0.04:0.02,0.02,[0.45,0.12,0.1]);
  if(wind){const pul=0.5+0.5*Math.sin(now*16);pushShape(mg,CUBE,P0.x,g+0.15,P0.z,1.8*S,0.1,1.8*S,now,[1,0.15*pul,0.05],1)}
}
function drawClientUI(){const ui=$('#clientUI'),bx=$('#clientBox');if(!ui)return;const c=CLIENT;
  if(!c||!clientHere()){ui.style.display='none';if(bx)bx.style.display='none';return}
  if(bx){bx.style.display=MODE==='city'?'':'none';const n=c.masses.filter(m=>m.alive).length+c.posts.filter(p=>p.alive).length;
    const t=`발주처 · ${c.name}${n?` · 부술 거리 ${n}개`:''}${c.tape?' · 빨간펜':''} · 재건축 ${c.rebuilt?1:0}/1${c.state==='leave'?' · 퇴장':''}`;if(bx.textContent!==t)bx.textContent=t}
  if(c.state==='arrive'||(c.state==='leave'&&c.t>1.5)){ui.style.display='none';return}
  const P0=clientPos(),S=clientScale(),q=project(P0.x,P0.y+2.4*S,P0.z);
  if(!q||q[0]<10||q[0]>innerWidth-10||q[1]<10||q[1]>innerHeight-50){ui.style.display='none';return}
  ui.style.display='';ui.style.left=q[0]+'px';ui.style.top=Math.max(q[1],90)+'px';
  const bb=ui.querySelector('.bubble'),txt=c.textT>0?c.text:'';if(bb.textContent!==txt)bb.textContent=txt;bb.style.display=txt?'':'none';
  const W={A:'철골 덧대는 중!',B:'빨간펜 긋는 중!',C:'매스 던지는 중!',D:'타워 올리는 중!',rebuild:'재건축 중!'};const tg=ui.querySelector('.tag');const tt=c.wind?W[c.wind.kind]:'발주처';if(tg.textContent!==tt)tg.textContent=tt;
  tg.classList.toggle('warn',!!c.wind)}
// 유리·철골 깨지는 소리 (높고 짧게 여러 번)
function sfxGlass(){sfx(1,0.12);setTimeout(()=>sfx(0.5,0.1),40);setTimeout(()=>sfx(2,0.18),90)}

// =====================================================================
//  랭킹 (Google Apps Script 웹앱) · 공유
// =====================================================================
const RANK_URL_DEFAULT=(window.SMASH_CONFIG&&window.SMASH_CONFIG.API_URL)||'';   // config.js 의 API_URL
function rankUrl(){return String(lsGet('smasharch_rank_url')||RANK_URL_DEFAULT||'').trim()}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function renderRank(d){RANK_LAST=d;
  const f=(d.firms||[]).map((r,i)=>`<li><b>${i+1}</b><span>${esc(shortName(r.name))}</span><em>${fmt(r.total)}점 · ${r.count}회</em></li>`).join('')||'<li class="empty">아직 기록이 없어요</li>';
  const p=(d.players||[]).map((r,i)=>`<li><b>${i+1}</b><span>${esc(r.nick)} <small>${esc(shortName(r.firm))}</small></span><em>${fmt(r.score)}점</em></li>`).join('')||'<li class="empty">아직 기록이 없어요</li>';
  $('#rankBody').innerHTML=`<div class="rk-h" data-t="firms">이번 주 가장 많이 부서진 사무소</div><ol class="rk" data-t="firms">${f}</ol><div class="rk-h" data-t="players">개인 최고 점수</div><ol class="rk" data-t="players">${p}</ol>`;
  rankTab(RANK_TAB);
}
let RANK_TAB='firms';
function rankTab(t){RANK_TAB=t;document.querySelectorAll('#rankTabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));document.querySelectorAll('#rankBody [data-t]').forEach(e=>e.hidden=e.dataset.t!==t)}
document.querySelectorAll('#rankTabs button').forEach(b=>b.onclick=()=>rankTab(b.dataset.t));
async function openRank(){
  $('#mRank').classList.add('open');
  rankLockUI();
  $('#rankMine').textContent=CUR?`${CUR.name} · 현재 ${fmt(score)}점`:'';
  const u=rankUrl();
  if(!u){$('#rankBody').innerHTML='<p class="small">게임 서버가 아직 연결되지 않았어요. config.js 의 API_URL(또는 설정 → "게임 서버 주소")에 Apps Script 웹앱 주소를 넣어주세요.</p>';return}
  $('#rankBody').innerHTML='<p class="small">불러오는 중…</p>';
  try{const r=await fetchT(u+(u.includes('?')?'&':'?')+'action=top',{},15000);renderRank(r)}
  catch(e){$('#rankBody').innerHTML='<p class="small">랭킹을 불러오지 못했어요. 서버 주소와 배포 설정(액세스: 모든 사용자)을 확인해주세요.</p>'}
}
function rankLockUI(){const inp=$('#rankNick'),btn=$('#rankSubmit');const lock=RANK_LOCK&&RANK_LOCK.gid===GAME_ID;
  inp.value=lock?RANK_LOCK.nick:(lsGet('smasharch_nick')||'');inp.disabled=!!lock;
  inp.title=lock?'이번 판은 이 닉네임으로 등록됐어요. 다른 회사를 고르거나 [전부 복구]하면 새 판이에요':'';
  btn.textContent=lock?'점수 갱신':'내 점수 등록';
  const m=$('#rankLockMsg');if(m)m.textContent=lock?`이번 판은 “${RANK_LOCK.nick}”(으)로 ${fmt(RANK_LOCK.score)}점 등록됨 · 닉네임은 바꿀 수 없고, 점수가 오르면 [점수 갱신]으로 올라가요`:''}
async function submitRank(){
  const u=rankUrl();if(!u){toast('랭킹 서버 주소를 먼저 설정해주세요');return}
  if(!CUR||score<1){toast('먼저 뭔가를 부숴주세요');return}
  if(!GAME_ID)newGame();const gid=GAME_ID,sc0=Math.floor(score);
  const nick=RANK_LOCK&&RANK_LOCK.gid===GAME_ID?RANK_LOCK.nick:($('#rankNick').value.trim().slice(0,20)||'익명');
  if(RANK_LOCK&&RANK_LOCK.gid===GAME_ID&&Math.floor(score)<=RANK_LOCK.score){toast(`이번 판은 이미 ${fmt(RANK_LOCK.score)}점으로 등록됐어요 — 점수가 오르면 갱신돼요`,3000);return}
  lsSet('smasharch_nick',nick);
  const body=JSON.stringify({nick,firmKey:CUR.key||CUR.name,firmName:CUR.name,score:sc0,gid});
  $('#rankSubmit').disabled=true;
  try{const r=await fetchT(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body},15000);
    if(r&&r.ok){const nk=r.nick||nick;if(gid===GAME_ID){RANK_LOCK={gid,nick:nk,score:Math.max(sc0,r.score||0)};rankLockUI()}
      toast(r.updated?`이번 판 기록을 ${fmt(Math.max(sc0,r.score||0))}점으로 갱신했어요 (${nk})`:'랭킹에 등록했어요');if(r.top)renderRank(r.top)}else toast('등록 실패: '+((r&&r.error)||'알 수 없는 오류'))}
  catch(e){toast('등록 실패 — 서버 주소를 확인해주세요')}
  finally{setTimeout(()=>$('#rankSubmit').disabled=false,3000)}
}



// =====================================================================
// 회사 고르기 창: 최근 7일 가장 많이 무너진 사옥 TOP 10 (서버 '일별철거' 집계). 기록이 없으면 대형 설계사무소 목록
// =====================================================================
let HOT={t:0,d:null,busy:false};
async function loadHot(){const box=$('#hotList');if(!box)return;const u=rankUrl();
  if(!u){showHot(null);return}
  if(HOT.d&&performance.now()-HOT.t<120000){showHot(HOT.d);return}
  if(HOT.busy)return;HOT.busy=true;if(!HOT.d)box.innerHTML='<div class="small" style="opacity:.7">불러오는 중…</div>';
  try{const r=await fetchT(u+(u.includes('?')?'&':'?')+'action=hot',{},12000);if(r&&r.ok){HOT.d=r.hot||[];HOT.t=performance.now()}}catch(e){}
  HOT.busy=false;showHot(HOT.d)}
function showHot(list){const box=$('#hotList'),big=$('#bigFirms'),head=$('#hotHead');box.innerHTML='';
  const items=(list||[]).map(h=>{const i=keyIdx(h.key);if(i==null)return null;const pre=FIRMS.find(f=>f.dkey===h.key);return {h,i,f:pre||firmFromData(i)}}).filter(Boolean);
  if(!items.length){head.style.display='none';box.style.display='none';big.style.display='';return}
  head.style.display='';box.style.display='';big.style.display='none';
  items.forEach((it,n)=>{const r=FIRMDATA[it.i];const medal=['🥇','🥈','🥉'][n]||(n+1)+'.';
    const fb=firmButton(`${medal} ${({c:'🏗 ',g:'🏢 ',u:'🎓 '}[r[8]]||'')}${it.f.name}`,`${r[1]} · 👷 ${fmt(it.h.people||1)}명이 무너뜨림${it.h.count>(it.h.people||1)?` (총 ${fmt(it.h.count)}번)`:''}`,()=>loadFirm(it.f),it.f);if(n>=5)fb.classList.add('extra');box.appendChild(fb)});
  box.classList.add('short');if(items.length>5){const mb=document.createElement('button');mb.className='hot-more';mb.textContent=`더 보기 (${items.length-5}곳) ▾`;mb.onclick=()=>{box.classList.remove('short');mb.remove()};box.appendChild(mb)}}
// =====================================================================
// 회사 추가 요청 · 문의함 → Apps Script '요청함' 시트로
// =====================================================================
// 서버가 방금 추가한 회사 한 줄을 이 화면 목록에도 바로 넣기
function addFirmRow(r){const kid=+r[5];if(!isFinite(kid))return null;let i=FKI.get(kid);if(i!=null)return i;
  FIRMDATA.push(r);i=FIRMDATA.length-1;FIDX.push(norm(r[0])+'|'+norm(r[1]));FKI.set(kid,i);return i}
// 근사 좌표로 자동 추가된 회사: 추가한 사람이 30분 안에 지도에서 건물을 눌러 위치를 바로잡음 (서버 'fix')
let HQFIX=null;
function hqFixAsk(){if(!HQFIX||HQFIX.asked||!CUR||CUR.dkey!=='d'+HQFIX.kid)return;HQFIX.asked=true;
  setTimeout(()=>{pickHQ=true;$('#hint').textContent='우리 건물을 눌러주세요 — 위치가 바로 고쳐져요';toast('📍 주소로 정확한 건물을 못 찾았어요. 지도를 돌려보며 우리 건물을 눌러주세요 (30분 안에 1번, 모두에게 반영)',7000)},2600)}
async function hqFixSend(la,ln){if(!CUR||!CUR.dkey)return;
  if(!HQFIX||CUR.dkey!=='d'+HQFIX.kid||performance.now()>HQFIX.until)return hqPropose(la,ln);
  const kid=HQFIX.kid;HQFIX=null;const u=rankUrl();if(!u)return;
  try{const r=await fetchT(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({type:'fix',kid,lat:la,lng:ln,vid:lsGet('smasharch_vid')||''})},15000);
    if(r&&r.ok){const i=FKI.get(kid);if(i!=null){FIRMDATA[i][2]=la;FIRMDATA[i][3]=ln;FIRMDATA[i][4]=0}if(CUR){CUR.lat=la;CUR.lng=ln;CUR.approx=false}toast('위치를 고쳤어요! 다음부터 모두 이 건물로 가요 👍',3500)}
    else toast('위치 수정 실패: '+((r&&r.error)||'알 수 없는 오류'),4000)}catch(e){toast('위치 수정을 보내지 못했어요 — 설정 → 문의함으로 알려주세요',4000)}}
// 그 밖의 사람이 사옥 건물을 직접 고르면 → 서버 요청함에 '위치 제안' (2명이 같은 곳을 고르면 자동 확정, 아니면 개발자가 확인)
async function hqPropose(la,ln){const u=rankUrl(),kid=+String(CUR.dkey).slice(1);if(!u||!(kid>=0))return;geoNote(false);
  try{const r=await fetchT(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({type:'fix',kid,lat:la,lng:ln,vid:lsGet('smasharch_vid')||''})},15000);
    if(r&&r.ok&&r.applied){const i=FKI.get(kid);if(i!=null){FIRMDATA[i][2]=la;FIRMDATA[i][3]=ln;FIRMDATA[i][4]=0}toast('📍 다른 사람과 같은 건물을 골랐어요 — 모두에게 바로 반영됐어요 👍',4200)}
    else if(r&&r.ok)toast(r.again?'📍 오늘 이미 위치를 보냈어요. 이 브라우저에선 고른 건물로 보여요':'📍 위치 제안을 보냈어요 — 개발자가 확인하면 모두에게 반영돼요 (이 브라우저엔 바로 저장)',4200)
    else if(r&&r.error)toast('위치 제안: '+r.error,4000)}catch(e){}}
// 좌표가 근사값인 회사를 열었을 때 화면 위에 잠깐 뜨는 안내 (버튼으로 바로 직접 지정)
function geoNote(on,msg){let el=$('#geoNote');if(!on){if(el)el.classList.remove('on');return}
  if(!el){el=document.createElement('div');el.id='geoNote';el.innerHTML='<span></span><button class="gn-pick">📍 우리 건물 직접 고르기</button><button class="gn-x" aria-label="닫기">×</button>';document.body.appendChild(el);
    el.querySelector('.gn-pick').onclick=()=>{geoNote(false);closeModals();pickHQ=true;$('#hint').textContent='우리 사옥 건물을 눌러주세요';toast('우리 사옥 건물을 눌러주세요. 지도에 건물이 없으면 그 자리 빈 땅을 누르면 새로 세워요',4500)};
    el.querySelector('.gn-x').onclick=()=>geoNote(false)}
  el.querySelector('span').textContent=msg;el.classList.add('on');clearTimeout(geoNote._t);geoNote._t=setTimeout(()=>el.classList.remove('on'),14000)}
function openReq(kind,name){closeModals();const m=$('#mReq');if(!m)return;
  setReqKind(kind||'회사 추가');if(name!=null)$('#rqName').value=name;if(name&&/대학/.test(name))setReqCat('대학교');$('#rqMsg2').textContent='';m.classList.add('open');
  setTimeout(()=>{const fk=kind==='회사 추가'||kind==='정보 수정'||!kind;const el=fk?($('#rqName').value?$('#rqAddr'):$('#rqName')):$('#rqMsg');try{el.focus()}catch(e){}},60)}
function setReqCat(c){$('#rqCat').value=c;document.querySelectorAll('#rqCats button').forEach(b=>b.classList.toggle('on',b.dataset.c===c));
  const u=c==='대학교';$('#rqName').placeholder=u?'예: OO대학교 (캠퍼스가 여럿이면 OO대학교 OO캠퍼스)':c==='건설사'?'예: OO건설(주)':c==='일반 회사'?'예: (주)OO':'예: OO종합건축사사무소';
  $('#rqFloor').placeholder=u?'예: 건물 전체 (본관 기준)':'예: 3층 · 3~5층 · 건물 전체';$('#rqNameL').firstChild.textContent=u?'학교 이름 ':'회사 이름 '}
function setReqKind(k){document.querySelectorAll('#rqKinds button').forEach(b=>b.classList.toggle('on',b.dataset.k===k));$('#mReq').dataset.kind=k;
  const firm=k==='회사 추가'||k==='정보 수정';$('#rqFirmBox').style.display=firm?'':'none';
  $('#rqMsg').placeholder=k==='회사 추가'?'(선택) 덧붙일 말 — 예: 사옥이 2동이에요, 지도에서 위치가 달라요':k==='정보 수정'?'무엇이 틀렸는지 알려주세요 — 예: 이사했어요, 층수가 달라요':'문의·버그·아이디어를 자유롭게 적어주세요 (기기/브라우저도 적어주면 좋아요)'}
async function sendReq(){const k=$('#mReq').dataset.kind||'회사 추가',u=rankUrl();
  const d={type:'request',kind:k,name:$('#rqName').value.trim(),addr:$('#rqAddr').value.trim(),floor:$('#rqFloor').value.trim(),cat:$('#rqCat').value,msg:$('#rqMsg').value.trim(),contact:$('#rqContact').value.trim(),hp:$('#rqHp').value,vid:lsGet('smasharch_vid')||''};
  if(k==='회사 추가'||k==='정보 수정'){d.msg=(d.msg+(CUR&&k==='정보 수정'?`\n(보던 회사: ${CUR.name})`:'')).trim()}else{d.name=d.addr=d.floor='';d.cat=''}
  const say=t=>{$('#rqMsg2').textContent=t};
  if(k==='회사 추가'&&(!d.name||!d.addr)){say('회사 이름과 주소는 꼭 적어주세요');return}
  if(k==='정보 수정'&&!d.name){say('어느 회사인지 이름을 적어주세요');return}
  if(k==='문의·버그'&&d.msg.length<2){say('내용을 적어주세요');return}
  if(!u){say('서버가 연결되지 않아 보낼 수 없어요');return}
  const btn=$('#rqSend');btn.disabled=true;say('보내는 중…');
  try{const r=await fetchT(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(d)},15000);
    if(r&&r.ok){['#rqName','#rqAddr','#rqFloor','#rqMsg'].forEach(s=>$(s).value='');say('');closeModals();
      if(r.row&&Array.isArray(r.row)&&r.row.length>=8){const i=addFirmRow(r.row);if(r.approx&&!r.dup&&r.kid!=null)HQFIX={kid:r.kid,until:performance.now()+29*60000,asked:false};toast(r.dup?'이미 목록에 있는 회사예요 — 바로 가요':'목록에 추가됐어요! 바로 부수러 가요 🏗'+(r.note?' ('+r.note+')':''),3600);if(i!=null)setTimeout(()=>loadFirm(firmFromData(i)),600)}
      else toast(k==='회사 추가'?(r.auto===false?'요청을 받았어요 — 확인 후 넣을게요 🙏':'요청을 보냈어요 🙏'):'보냈어요! 고마워요 🙏',3400)}
    else say('보내기 실패: '+((r&&r.error)||'알 수 없는 오류'))}
  catch(e){say('보내기 실패 — 잠시 뒤에 다시 시도해주세요')}
  finally{setTimeout(()=>btn.disabled=false,2500)}}
(function(){if(!$('#mReq'))return;
  document.querySelectorAll('#rqKinds button').forEach(b=>b.onclick=()=>setReqKind(b.dataset.k));
  document.querySelectorAll('#rqCats button').forEach(b=>b.onclick=()=>setReqCat(b.dataset.c));
  $('#rqSend').onclick=sendReq;
  document.querySelectorAll('[data-req]').forEach(b=>b.onclick=()=>openReq(b.dataset.req,b.dataset.req==='회사 추가'?($('#customQ').value.trim()||null):null));
  $('#mReq').addEventListener('keydown',e=>e.stopPropagation())})();
// =====================================================================
// 공유 — 결과 카드(스크린샷)·랭킹 카드 이미지 + 링크. 링크로 들어온 사람은 같은 사옥에서 바로 시작, 점수 도전장(?vs=)
// =====================================================================
let RANK_LAST=null,SHARE_MODE='result',SHARE_IMG=null,SHARE_SHOT=null,KAKAO_OK=false;
const SITE_URL=(window.SMASH_CONFIG&&window.SMASH_CONFIG.SITE_URL)||'https://ccct12.github.io/smash-arch/';
function shareBase(){try{const u=new URL(location.href);if(/^https?:$/.test(u.protocol)){u.search='';u.hash='';return u}}catch(e){}return new URL(SITE_URL)}
function shareUrl(withVs){const u=shareBase();
  if(SHARE_MODE==='result'&&CUR){if(CUR.key)u.searchParams.set('firm',CUR.key);else if(CUR.lat){u.searchParams.set('lat',(+CUR.lat).toFixed(5));u.searchParams.set('lng',(+CUR.lng).toFixed(5));u.searchParams.set('name',CUR.name)}
    if(withVs&&score>=1)u.searchParams.set('vs',Math.floor(score))}
  return u.toString()}
function curRank(){let k=0;for(let i=0;i<RANKS.length;i++)if(score>=RANKS[i][0])k=i;return RANKS[k]}
function shareText(){const vs=$('#shVs')&&$('#shVs').checked,url=shareUrl(vs);
  if(SHARE_MODE==='rank'){const d=RANK_LAST||{};const f=(d.firms||[]).slice(0,5).map((r,i)=>`${i+1}. ${shortName(r.name)} (${fmt(r.total)}점)`).join('\n');
    return `🏆 SMASH ARCH 이번 주 가장 많이 부서진 사옥\n${f||'(아직 기록 없음)'}\n\n우리 회사·학교도 순위에 올려보자 👇\n${url}`}
  if(!CUR||score<1)return `💥 SMASH ARCH — 우리 회사·우리 학교 부수기 게임\n건축사사무소·건설사·대학교 1만 1천여 곳 중 우리 사옥 찾아서 같이 부숴요 🌙 밤엔 야근 모드, 사장님은 비행선 타고 컴백 👇\n${url}`;
  const tot=B.length,dead=B.filter(b=>!b.alive).length,pct=tot?Math.round(dead/tot*100):0;
  return `💥 ${shortName(CUR.name)} ${CUR.kind==='u'?'캠퍼스':'사옥'}을 ${fmt(score)}점어치 부쉈어요! (직급: ${curRank()[2]} · 파괴율 ${pct}%)\n${vs?'이 점수 넘을 수 있어? 👇':'같이 부수러 가기 👇'}\n${url}`}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function fitText(c,t,maxW){if(c.measureText(t).width<=maxW)return t;while(t.length>1&&c.measureText(t+'…').width>maxW)t=t.slice(0,-1);return t+'…'}
function makeCard(shot){const W=1200,H=630,cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');
  const F='"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  c.fillStyle='#1d2126';c.fillRect(0,0,W,H);
  if(SHARE_MODE==='result'&&shot){const s=Math.max(W/shot.width,H/shot.height),w=shot.width*s,h=shot.height*s;c.drawImage(shot,(W-w)/2,(H-h)/2,w,h)}
  else{c.fillStyle='#2a2f36';for(let i=0;i<14;i++){const x=i*95-20,h=120+((i*73)%5)*55;c.fillRect(x,H-h,70,h)}}
  let g=c.createLinearGradient(0,H*0.38,0,H);g.addColorStop(0,'rgba(10,12,14,0)');g.addColorStop(1,'rgba(10,12,14,.92)');c.fillStyle=g;c.fillRect(0,0,W,H);
  g=c.createLinearGradient(0,0,0,120);g.addColorStop(0,'rgba(10,12,14,.75)');g.addColorStop(1,'rgba(10,12,14,0)');c.fillStyle=g;c.fillRect(0,0,W,120);
  c.textBaseline='alphabetic';c.fillStyle='#fff';c.font=`900 40px ${F}`;c.fillText('SMASH',36,62);const sw=c.measureText('SMASH ').width;c.fillStyle='#f2b134';c.fillText('ARCH',36+sw,62);
  c.font=`600 20px ${F}`;c.fillStyle='rgba(255,255,255,.8)';c.textAlign='right';c.fillText('건축사무소 사옥 부수기',W-36,58);c.textAlign='left';
  if(SHARE_MODE==='rank'){const d=RANK_LAST||{};const fr=(d.firms||[]).slice(0,5),pl=(d.players||[]).slice(0,5);
    c.fillStyle='#f2b134';c.font=`800 30px ${F}`;c.fillText('🏆 이번 주 가장 많이 부서진 사무소',40,150);
    c.font=`700 30px ${F}`;fr.forEach((r,i)=>{const y=205+i*54;c.fillStyle=i<3?'#f2b134':'#fff';c.fillText(String(i+1),48,y);c.fillStyle='#fff';c.fillText(fitText(c,shortName(r.name),470),90,y);c.fillStyle='rgba(255,255,255,.7)';c.font=`600 22px ${F}`;c.fillText(`${fmt(r.total)}점`,90+480,y);c.font=`700 30px ${F}`});
    if(!fr.length){c.fillStyle='#fff';c.font=`600 26px ${F}`;c.fillText('아직 기록이 없어요 — 첫 번째가 되어보세요',48,210)}
    c.fillStyle='#f2b134';c.font=`800 24px ${F}`;c.fillText('개인 최고 점수',800,150);
    c.font=`600 22px ${F}`;pl.forEach((r,i)=>{const y=195+i*42;c.fillStyle='#fff';c.fillText(fitText(c,`${i+1}. ${r.nick}`,230),800,y);c.fillStyle='rgba(255,255,255,.7)';c.textAlign='right';c.fillText(fmt(r.score),W-40,y);c.textAlign='left'})}
  else if(CUR&&score>=1){const rk=curRank(),tot=B.length,dead=B.filter(b=>!b.alive).length,pct=tot?Math.round(dead/tot*100):0;
    c.fillStyle='#fff';c.font=`800 46px ${F}`;c.fillText(fitText(c,shortName(CUR.name)+(CUR.kind==='u'?' 캠퍼스':' 사옥'),760),40,H-150);
    c.font=`900 74px ${F}`;c.fillStyle='#f2b134';const st=fmt(score)+'점';c.fillText(st,40,H-70);const w1=c.measureText(st).width;
    c.font=`700 28px ${F}`;c.fillStyle='#fff';c.fillText(`어치 부숨 · 파괴율 ${pct}%`,52+w1,H-78);
    rr(c,W-250,H-210,210,150,14);c.fillStyle='rgba(242,177,52,.95)';c.fill();c.fillStyle='#1d2126';c.textAlign='center';c.font=`900 76px ${F}`;c.fillText(rk[1],W-145,H-112);c.font=`800 26px ${F}`;c.fillText(rk[2],W-145,H-76);c.textAlign='left';
    if(BOSS&&BOSS.state==='caught'){c.font=`800 22px ${F}`;rr(c,40,H-236,190,40,8);c.fillStyle='#8f1d16';c.fill();c.fillStyle='#fff';c.fillText('🚨 '+bossTitle()+' 검거',54,H-208)}}
  else{c.fillStyle='#fff';c.font=`800 48px ${F}`;c.fillText('우리 회사·우리 학교, 같이 부숴요',40,H-110);c.font=`600 26px ${F}`;c.fillStyle='rgba(255,255,255,.8)';c.fillText('건축사사무소·건설사·대학교 1만 1천여 곳 · 무료 · 설치 없음',40,H-66)}
  c.font=`600 19px ${F}`;c.fillStyle='rgba(255,255,255,.65)';c.textAlign='right';c.fillText(shareBase().host+shareBase().pathname.replace(/\/$/,''),W-36,H-24);c.textAlign='left';
  return cv}
function shareRefresh(){const cv=makeCard(SHARE_SHOT);SHARE_IMG=cv;$('#shImg').src=cv.toDataURL('image/jpeg',0.88);$('#shText').value=shareText();
  $('#shVsRow').style.display=SHARE_MODE==='result'&&CUR&&score>=1?'':'none';
  document.querySelectorAll('#shTabs button').forEach(b=>b.classList.toggle('on',b.dataset.m===SHARE_MODE));
  $('#shNative').style.display=navigator.share?'':'none';$('#shCopyImg').style.display=window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write?'':'none'}
async function openShare(mode){SHARE_MODE=mode||'result';closeModals();
  if(SHARE_MODE==='rank'&&!RANK_LAST){const u=rankUrl();if(u){try{RANK_LAST=await fetchT(u+(u.includes('?')?'&':'?')+'action=top',{},15000)}catch(e){}}}
  SHARE_SHOT=null;SHOT_CB=c=>{SHARE_SHOT=c;shareRefresh();$('#mShare').classList.add('open')};
  setTimeout(()=>{if(SHOT_CB){SHOT_CB=null;shareRefresh();$('#mShare').classList.add('open')}},600)}
function shareBlob(){return new Promise(r=>{if(!SHARE_IMG)return r(null);SHARE_IMG.toBlob(b=>r(b),'image/png')})}
function shareFileName(){return `smash-arch_${SHARE_MODE==='rank'?'ranking':(CUR?shortName(CUR.name).replace(/[\\/:*?"<>|\s]+/g,''):'play')}.png`}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch(e){try{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok}catch(_){return false}}}
const isPhone=()=>matchMedia('(pointer:coarse)').matches;
// 카카오톡: config.js 에 KAKAO_JS_KEY 가 있으면 카카오 공유(이미지 카드+버튼). 없으면 폰은 공유 시트, PC는 문구 복사 → 카톡에 붙여넣기
function kakaoKey(){return (window.SMASH_CONFIG&&window.SMASH_CONFIG.KAKAO_JS_KEY)||''}
function kakaoLoad(){return new Promise(res=>{if(KAKAO_OK)return res(true);const k=kakaoKey();if(!k)return res(false);
  if(window.Kakao&&window.Kakao.init){try{if(!Kakao.isInitialized())Kakao.init(k);KAKAO_OK=true}catch(e){}return res(KAKAO_OK)}
  const sc=document.createElement('script');sc.src=(window.SMASH_CONFIG.KAKAO_SDK||'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js');sc.crossOrigin='anonymous';
  sc.onload=()=>{try{Kakao.init(k);KAKAO_OK=true}catch(e){}res(KAKAO_OK)};sc.onerror=()=>res(false);document.head.appendChild(sc);setTimeout(()=>res(KAKAO_OK),6000)})}
async function shareKakao(){const vs=$('#shVs').checked,url=shareUrl(vs),text=$('#shText').value;
  if(await kakaoLoad()){let img=new URL('og.jpg',shareBase()).toString();
    try{const b=await shareBlob();if(b&&Kakao.Share.uploadImage){const r=await Kakao.Share.uploadImage({file:[new File([b],'card.png',{type:'image/png'})]});if(r&&r.infos&&r.infos.original)img=r.infos.original.url}}catch(e){}
    const title=SHARE_MODE==='rank'?'SMASH ARCH 이번 주 랭킹':(CUR&&score>=1?`${shortName(CUR.name)} 사옥 ${fmt(score)}점 철거`:'SMASH ARCH — 건축사무소 사옥 부수기');
    const desc=SHARE_MODE==='result'&&CUR&&score>=1?(vs?'이 점수 넘을 수 있어?':'같이 부수러 가기'):'전국 건축사무소 사옥을 3D 지도에서 부숴보세요';
    try{Kakao.Share.sendDefault({objectType:'feed',content:{title,description:desc,imageUrl:img,imageWidth:1200,imageHeight:630,link:{mobileWebUrl:url,webUrl:url}},buttons:[{title:SHARE_MODE==='result'&&vs?'도전하러 가기':'게임하러 가기',link:{mobileWebUrl:url,webUrl:url}}]});return}catch(e){}}
  if(navigator.share&&isPhone()){try{await navigator.share({title:'SMASH ARCH',text});}catch(e){}return}   // 폰: 공유 시트에서 카카오톡 선택 (링크 미리보기 카드가 붙어요)
  if(await copyText(text))toast('문구+링크를 복사했어요 — 카카오톡 대화창에 붙여넣기(Ctrl+V) 하세요',3600);else toast('복사 실패 — 아래 문구를 직접 복사해주세요')}
async function shareNative(){const text=$('#shText').value;
  try{const b=await shareBlob();const f=b&&new File([b],shareFileName(),{type:'image/png'});
    if(f&&navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],text,title:'SMASH ARCH'});return}
    await navigator.share({title:'SMASH ARCH',text})}catch(e){}}
async function shareSave(){const b=await shareBlob();if(!b){toast('이미지를 만들지 못했어요');return}const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=shareFileName();document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);toast('이미지를 저장했어요')}
async function shareCopyImg(){try{const b=await shareBlob();await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);toast('이미지를 복사했어요 — 카톡·메신저 대화창에 붙여넣기(Ctrl+V)',3600)}catch(e){toast('이미지 복사가 안 되는 브라우저예요 — [이미지 저장]을 써주세요')}}
async function shareCopy(){if(await copyText($('#shText').value))toast('문구+링크를 복사했어요');else toast('복사 실패 — 아래 문구를 직접 복사해주세요')}
function shareSns(kind){const url=shareUrl($('#shVs').checked),t=$('#shText').value.replace(/\n?https?:\/\/\S+$/,'');
  const u=kind==='x'?`https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(url)}`:kind==='fb'?`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`:`https://share.naver.com/web/shareView?url=${encodeURIComponent(url)}&title=${encodeURIComponent('SMASH ARCH')}`;
  window.open(u,'_blank','noopener,width=620,height=560')}
(function(){if(!$('#mShare'))return;
  $('#shKakao').onclick=shareKakao;$('#shNative').onclick=shareNative;$('#shSave').onclick=shareSave;$('#shCopyImg').onclick=shareCopyImg;$('#shCopy').onclick=shareCopy;
  document.querySelectorAll('#shSns button').forEach(b=>b.onclick=()=>shareSns(b.dataset.s));
  document.querySelectorAll('#shTabs button').forEach(b=>b.onclick=()=>{SHARE_MODE=b.dataset.m;if(SHARE_MODE==='rank'&&!RANK_LAST)openShare('rank');else shareRefresh()});
  $('#shVs').onchange=()=>{$('#shText').value=shareText()};
  $('#shText').addEventListener('keydown',e=>e.stopPropagation());
  if($('#rankShare'))$('#rankShare').onclick=()=>openShare('rank');
  if(kakaoKey())setTimeout(kakaoLoad,3000)})();
// ---- 도전장: 친구가 보낸 링크(?vs=점수)로 들어오면 목표 점수 표시, 넘으면 축하 + 되갚기 공유
let CHAL=null;
function challengeStart(goal){CHAL={goal,key:CUR&&(CUR.key||CUR.name),done:false};const el=$('#chal');if(!el)return;
  el.innerHTML=`🥊 친구 기록 <b>${fmt(goal)}</b>점 — 넘어보세요!`;el.style.display='';
  setTimeout(()=>toast(`친구가 이 사옥을 ${fmt(goal)}점어치 부쉈어요. 이겨보세요!`,4200),1500);
  el.onclick=()=>{if(CHAL&&CHAL.done)openShare('result')};
  setInterval(()=>{if(!CHAL)return;const k=CUR&&(CUR.key||CUR.name);if(k!==CHAL.key){el.style.display='none';return}el.style.display='';
    if(!CHAL.done&&score>CHAL.goal){CHAL.done=true;el.classList.add('win');el.innerHTML=`🎉 친구 기록 ${fmt(CHAL.goal)}점 돌파! <u>되갚아주기</u>`;toast('도전 성공! 친구 점수를 넘었어요 — 위 배지를 눌러 공유',4000);sfx&&sfx(14,0.3)}},500)}
// ---- PC 전체 화면 (휴대폰은 index.html 쪽에서 처리)
(function(){const d=document,el=d.documentElement,btn=$('#btnFS');if(!btn||matchMedia('(pointer:coarse)').matches)return;
  if(!(d.fullscreenEnabled||d.webkitFullscreenEnabled))return;d.body.classList.add('canfs-pc');
  const inFS=()=>!!(d.fullscreenElement||d.webkitFullscreenElement);
  const upd=()=>{btn.textContent='⛶';btn.title=inFS()?'전체 화면 나가기 (Esc)':'전체 화면 (F11도 돼요)';setTimeout(()=>{resize();layoutHUD()},120)};
  btn.onclick=()=>{try{if(inFS())(d.exitFullscreen||d.webkitExitFullscreen).call(d);else{const p=(el.requestFullscreen||el.webkitRequestFullscreen).call(el,{navigationUI:'hide'});if(p&&p.catch)p.catch(()=>toast('이 브라우저는 전체 화면을 막았어요 — F11을 눌러주세요'))}}catch(e){toast('F11을 눌러 전체 화면으로 바꿔주세요')}};
  d.addEventListener('fullscreenchange',upd);d.addEventListener('webkitfullscreenchange',upd);upd()})();

// ---------- 메인 루프 ----------
function resize(){const dpr=Math.min(devicePixelRatio||1,PERF_CAP[PERF.q]);canvas.width=Math.floor(innerWidth*dpr);canvas.height=Math.floor(innerHeight*dpr)}
function layoutHUD(){const tb=$('#toolbar');if(!tb)return;const r=tb.getBoundingClientRect(),gap=innerHeight-r.top,C=isCompact();
  $('#hint').style.bottom=(gap+(C?5:8))+'px';$('#cmdbar').style.bottom=(gap+(C?30:40))+'px';
  const u=$('#ult');const overlap=!C&&r.right>innerWidth-96;u.style.bottom=overlap?(gap+10)+'px':'';
  $('#btnDet').style.bottom=C?(gap+8)+'px':'';
  const c=$('#credit');c.style.bottom=C?'':Math.max(2,(innerHeight-r.bottom)-16)+'px'}
function isCompact(){return matchMedia('(pointer:coarse) and (max-height:500px)').matches}
addEventListener('resize',()=>{resize();layoutHUD()});resize();setTimeout(layoutHUD,0);
addEventListener('orientationchange',()=>setTimeout(()=>{resize();layoutHUD()},300));
let last=performance.now(),hudT=0;
const FOG=[0.902,0.914,0.922],FOG_DAY=FOG.slice(),FOG_NIGHT=[0.055,0.07,0.12];
function drawScene(shadowPass){
  if(MODE==='section'){mSec.draw();mRub.draw();mDyn.draw();if(!shadowPass)mGlow.draw();return}
  if(!shadowPass)mGround.draw();
  const vis=[];for(const c of CHUNKS.values()){if(Math.hypot(c.ox+TILE/2-cam.tx,c.oz+TILE/2-cam.tz)<CULL_R+Math.max(0,cam.dist-800))vis.push(c)}
  for(const c of vis)c.mg.draw();
  if(!shadowPass){gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-2,-2);for(const c of vis)c.mr.draw();gl.disable(gl.POLYGON_OFFSET_FILL)}
  for(const c of vis){c.mb.draw();c.mt.draw()}drawDets();mRub.draw();mDyn.draw();
  if(!shadowPass)mGlow.draw();
}
function frameBody(now){
  let dt=Math.min(0.05,(now-last)/1000);last=now;const rdt=dt;
  if(HSTOP>0){HSTOP=Math.max(0,HSTOP-rdt);dt*=0.05}   // 히트스톱: 순간 멈춤
  updateLater(dt);updateRings(dt);dayUpdate(rdt);
  if(MODE==='section'){secUpdate(dt);updateFloats(dt)}
  else{
  for(let i=FALL.length-1;i>=0;i--){const o=FALL[i];o.vy-=60*dt;o.y+=o.vy*dt;if(o.tx!=null){const k=Math.min(1,dt*1.2);o.x+=(o.tx-o.x)*k;o.z+=(o.tz-o.z)*k;o.rot+=dt*4}
    if(o.y-o.r<=groundAt(o.x,o.z)){if(o.tx!=null){o.x=o.tx;o.z=o.tz}FALL.splice(i,1);o.hit(o)}}
  if(beam&&firing){humStart();
    const vdInc=(4+vdAt(beam.x,beam.z)*0.95)*dt;
    const v=carve(beam.x,beam.z,5.5,28*dt,false,vdInc);addScore(v*0.6+Math.min(vdInc,500)*0.5);
    blast(beam.x,beam.z,7,60*dt*10,0.6);beam.y=groundAt(beam.x,beam.z);
    if(Math.random()<0.6)spawn(beam.x+(Math.random()-.5)*6,beam.y+1,beam.z+(Math.random()-.5)*6,(Math.random()-.5)*14,12+Math.random()*14,(Math.random()-.5)*14,1+Math.random()*1.5,[1,0.4+Math.random()*0.3,0.1],0.4+Math.random()*0.3,1);
    if(maxDepth>=12742000&&!beam.done){beam.done=true;toast('지구 반대편(남대서양, 우루과이 앞바다)에 도착했어요',3500)}}
  updateTools(dt);
  if(shock){shock.r+=260*dt;forBuildingsNear(shock.x,shock.z,shock.r+10,b=>{if(!b.alive||b.shockId===shock.id)return;const d=Math.hypot(b.cx-shock.x,b.cz-shock.z);if(Math.abs(d-shock.r)<14){b.shockId=shock.id;facadeStrip(b,shock.x,shock.z,Math.max(0,1-shock.r/shock.max)*1.1)}});
    forTreesNear(shock.x,shock.z,shock.r+10,t=>{if(t.alive&&Math.abs(Math.hypot(t.x-shock.x,t.z-shock.z)-shock.r)<10&&Math.random()<(1-shock.r/shock.max))killTree(t)});
    if(shock.r>shock.max)shock=null}
  if(quake){quake.t+=dt;cam.shake=Math.max(cam.shake,6*(1-quake.t/quake.dur));quake.acc+=dt;
    if(quake.acc>0.15){quake.acc=0;
      // 진원지 근처 건물의 저층 기둥이 주로 손상 (높고 가까울수록, 필로티면 더)
      for(let n=0;n<5;n++){const b=B[Math.floor(Math.random()*B.length)];if(!b||!b.alive)continue;const dd=Math.hypot(b.cx-quake.x,b.cz-quake.z);if(dd>280)continue;
        const p=(0.35+b.h/60)*(1-dd/280);if(Math.random()>p)continue;const d=ensureDet(b);
        const soft=b.style===1?2:1;for(let f=0;f<Math.min(d.F,3);f++){if(!d.fl[f])continue;for(let j=0;j<d.C;j++)if(Math.random()<0.25*soft/(1+f))d.hp[f*d.C+j]-=0.5+Math.random()*0.6;
          for(let j=0;j<d.M;j++)if(Math.random()<0.12)d.panel[f*d.M+j]=0}
        for(let f=3;f<d.F;f++)for(let j=0;j<d.M;j++)if(d.fl[f]&&Math.random()<0.03)d.panel[f*d.M+j]=0;
        d.dirty=true;detCheck(b)}}
    if(Math.random()<0.1){const a=Math.random()*Math.PI*2,r=Math.random()*200;carve(quake.x+Math.cos(a)*r,quake.z+Math.sin(a)*r,6+Math.random()*6,1+Math.random()*1.5)}
    if(quake.t>quake.dur)quake=null}
  }
  if(cam.shake>0)cam.shake=Math.max(0,cam.shake-rdt*10);
  if(MODE==='city'){moveCam(rdt);LVPcur=LVP=cityLVP()}
  updateCam();
  updateWorld(dt);
  if(MODE==='city')updateDet(dt);
  if(MODE==='section'&&secDirty){secDirty=false;buildSection()}
  updateDebris(dt);
  const useSh=opts.shadows&&SH_OK&&PERF.q<1;
  if(useSh){
    gl.bindFramebuffer(gl.FRAMEBUFFER,shFB);gl.viewport(0,0,SHSIZE,SHSIZE);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(sprog);gl.uniformMatrix4fv(SU.uLVP,false,LVPcur);drawScene(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(FOG[0],FOG[1],FOG[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prog);
  gl.uniformMatrix4fv(U.uVP,false,VP);gl.uniformMatrix4fv(U.uLVP,false,LVPcur);gl.uniform3fv(U.uCam,eye);gl.uniform3fv(U.uTgt,[cam.tx,cam.ty,cam.tz]);gl.uniform2fv(U.uFogR,MODE==='city'?[Math.max(420,cam.dist*0.6),Math.max(320,cam.dist*0.45)]:[9000,1000]);gl.uniform3fv(U.uFog,FOG);gl.uniform3fv(U.uSun,SUN);gl.uniform1f(U.uNight,DAY.k*(MODE==='section'?0.6:1));   // 단면은 속이 보여야 해서 덜 어둡게
  gl.uniform1f(U.uShOn,useSh?1:0);gl.uniform1f(U.uTexel,1/SHSIZE);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,litTex);gl.uniform1i(U.uLit,1);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,shTex);gl.uniform1i(U.uSh,0);
  drawScene(false);
  updateLabels();
  hudT+=dt;if(hudT>0.1){hudT=0;updateHUD()}
}
// 한 프레임에서 오류가 나도 게임이 멈추지 않게 (예전에는 오류 한 번이면 화면이 그대로 굳음)
let FRAME_ERR=0,lastFrameT=0,SHOT_CB=null;
function frame(now){try{frameBody(now);if(SHOT_CB){const cb=SHOT_CB;SHOT_CB=null;let c=null;try{c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;c.getContext('2d').drawImage(canvas,0,0)}catch(_){c=null}cb(c)}}catch(e){FRAME_ERR++;if(FRAME_ERR<6)console.error('[frame]',e);try{gl.bindFramebuffer(gl.FRAMEBUFFER,null)}catch(_){}}
  perfTick(lastFrameT?now-lastFrameT:16);lastFrameT=now;requestAnimationFrame(frame)}
// 그래픽 메모리가 부족해 WebGL 이 끊기면(휴대폰에서 흔함) 안내 후 다시 불러오기
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();const d=document.createElement('div');d.id='glLost';
  d.innerHTML='<div><b>그래픽이 잠깐 멈췄어요</b><p>휴대폰 메모리가 부족하면 생길 수 있어요.<br>설정에서 그림자·잔해를 끄면 덜 생겨요.</p><button class="btn-p" onclick="location.reload()">다시 불러오기</button></div>';document.body.appendChild(d)});
canvas.addEventListener('webglcontextrestored',()=>location.reload());

// ---------- 시작 ----------
(function start(){
  selectWeapon(0);$('#btnUndo').disabled=true;$('#btnReset').disabled=true;
  const sp=new URLSearchParams(location.search);const fk=sp.get('firm')||'';const vs=Math.floor(+sp.get('vs')||0);
  let f=FIRMS.find(x=>x.key===fk);
  if(!f&&/^d\d+$/.test(fk)){const i=FIRMDATA.findIndex(r=>r[5]===+fk.slice(1));if(i>=0)f=firmFromData(i)}
  if(!f&&sp.get('lat')&&sp.get('lng'))f={name:sp.get('name')||'공유된 위치',addr:'',lat:+sp.get('lat'),lng:+sp.get('lng')};
  requestAnimationFrame(frame);
  if(f){loadFirm(f);if(vs>0&&vs<1e10)challengeStart(vs)}else{resetWorld();$('#firmName').textContent='회사를 골라주세요';$('#mFirm').classList.add('open');loadHot()}
  if(!lsGet('smasharch_tut_v2'))lsSet('smasharch_ver',GAME_VER);                       // 처음 온 사람은 튜토리얼만
  else if(lsGet('smasharch_ver')!==GAME_VER&&$('#mPatch')){if(opts.patch===false)lsSet('smasharch_ver',GAME_VER);else $('#mPatch').classList.add('open')}   // 설정에서 끌 수 있음   // 다시 온 사람은 업데이트 내역
})();
if($('#patchOk'))$('#patchOk').onclick=()=>{$('#mPatch').classList.remove('open');lsSet('smasharch_ver',GAME_VER);
  const no=$('#patchNo');if(no){opts.patch=!no.checked;lsSet('smasharch_opts',opts);const o=$('#optPatch');if(o)o.checked=opts.patch}};
if($('#patchNo'))$('#patchNo').checked=opts.patch===false;
function openPatch(){closeModals();const no=$('#patchNo');if(no)no.checked=opts.patch===false;$('#mPatch').classList.add('open')}
if($('#setPatch'))$('#setPatch').onclick=openPatch;

$('#btnSection').onclick=()=>enterSection();

$('#btnRank').onclick=openRank;$('#rankSubmit').onclick=submitRank;
$('#optRankUrl').value=rankUrl();
$('#btnRankUrl').onclick=()=>{const v=$('#optRankUrl').value.trim();if(v&&!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v)){toast('Apps Script 웹앱 주소(…/exec) 형식이 아니에요');return}lsSet('smasharch_rank_url',v);toast(v?'랭킹 서버 주소를 저장했어요':'랭킹 서버 주소를 지웠어요')};

// ---------- 철거 공사 일보 (결과 화면) ----------
function openReport(){
  const alive=B.filter(b=>b.alive).length,tot=B.length,dead=tot-alive;const n=nbStats();
  let k=0;for(let i=0;i<RANKS.length;i++)if(score>=RANKS[i][0])k=i;
  const sec=STATS.t0?Math.round((performance.now()-STATS.t0)/1000):0;
  const names=Object.fromEntries([...WEAPONS,ULTIMATE].map(w=>[w.id,w.name]));
  const tools=Object.entries(STATS.tools).sort((a,b)=>b[1]-a[1]).map(([id,c])=>`${names[id]||id} ${c}회`).join(' · ')||'-';
  const d=new Date();const date=`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  const pct=tot?Math.round(dead/tot*100):0;
  $('#repBody').innerHTML=`<div class="rep-head"><div>철거 공사 일보</div><small>${date} · ${esc(CUR?CUR.name:'')}</small></div>
  <table class="rep"><tr><th>공정률(파괴율)</th><td>${pct}%</td></tr><tr><th>철거 동수</th><td>${dead}동 / ${tot}동</td></tr>
  <tr><th>철거한 건축사무소</th><td>${n.d} / ${n.t}곳</td></tr>${BOSS?`<tr><th>사장님</th><td>${BOSS.state==='caught'?'검거 완료':'도주 중'} · 도주 ${BOSS.flees}회</td></tr>`:''}${BOOM.round?`<tr><th>부동산 호황</th><td>${BOOM.round}차까지</td></tr>`:''}<tr><th>투입 장비·도구</th><td>${esc(tools)}</td></tr>
  <tr><th>공사 기간</th><td>${Math.floor(sec/60)}분 ${sec%60}초</td></tr><tr><th>점수</th><td>${fmt(score)}점</td></tr><tr><th>최종 직급</th><td><b>${RANKS[k][2]}</b></td></tr></table>
  <div class="rep-sign"><span>감리 확인</span><span class="stamp">철거<br>완료</span></div>`;
  $('#mReport').classList.add('open');
}
$('#btnReport').onclick=openReport;
$('#repShare').onclick=()=>{closeModals();openShare('result')};
$('#repRank').onclick=()=>{closeModals();openRank()};
$('#ult').onclick=armUlt;
$('#btnDet').onclick=detonate;
$('#bossArrow').onclick=bossGo;

// ---------- 게임 가이드 (? 버튼) · 처음 온 사람 환영 · 따라하기 미션 ----------
//  ※ 도구 설명은 GUIDE_TOOLS 만 고치면 돼요. 사진은 img/guide/*.jpg (번호 동그라미 = 누르는 순서)
const K=TOUCH?'탭':'클릭';
const GUIDE_TOOLS=[
  {w:0,img:'crew',name:'철거반',team:'시공',one:'인부 수십 명이 외벽을 타고 올라가 층마다 기둥을 오함마로 부숴요.',
    steps:[`아래 도구막대에서 <b>1 철거반</b>을 골라요`,`부수고 싶은 건물을 <b>${K}</b> ①`,'인부들이 달려가서 알아서 부숴요. 기다리면 끝!'],tip:'아래층 기둥이 부러지면 위층이 통째로 내려앉아요.'},
  {w:1,img:'dozer',name:'불도저',team:'시공',one:'선을 그으면 불도저 3대가 나란히 그 길을 밀고 지나가요.',
    steps:[`<b>2 불도저</b>를 골라요`,`출발점(건물 앞 땅)을 <b>${K}</b> ①`,`도착점(건물 뒤쪽)을 한 번 더 <b>${K}</b> ②`],tip:`누르고 끄는 게 아니라 <b>${K} → ${K}</b> 두 번이에요. 같은 곳을 두 번 누르면 취소.`},
  {w:2,img:'crane',name:'쇠공',team:'시공',one:'타워크레인이 세워지고, 쇠공이 그은 선을 따라 휘둘러져요.',
    steps:[`<b>3 쇠공</b>을 골라요`,`건물 한쪽 옆을 <b>${K}</b> ①`,`반대쪽 옆을 <b>${K}</b> ② — 그 사이를 쇠공이 지나가요`],tip:'건물 허리 높이를 가로지르게 그으면 가장 잘 부서져요.'},
  {w:3,img:'pour',name:'레미콘',team:'시공',one:'옥상에 콘크리트를 계속 부어서, 무게를 못 이긴 위층부터 내려앉아요.',
    steps:[`<b>4 레미콘</b>을 골라요`,`건물 <b>옥상</b>을 ${K} ①`,'레미콘 차가 와서 계속 붓는 걸 지켜봐요'],tip:'높고 가는 건물일수록 빨리 무너져요.'},
  {w:4,img:'blast1',img2:'blast2',name:'다이너마이트',team:'시공',one:'여러 곳에 붙여 두었다가 한 번에 연쇄 폭파해요.',
    steps:[`<b>5 다이너마이트</b>를 골라요`,`건물 벽 여러 곳을 ${K} ①②③ — 붙이기만 하고 아직 안 터져요`,TOUCH?'오른쪽 아래 <b>[기폭]</b> 버튼을 눌러 쾅!':'<b>Space</b> 키(또는 [기폭] 버튼)를 눌러 쾅!'],tip:'1층 기둥 쪽에 여러 개 붙이면 건물 전체가 무너져요.'},
  {w:5,img:'rebar',name:'철근 빼기',team:'시공',one:'기둥 속 철근을 몰래 빼서 건물이 서서히 약해져요. (순살 구조)',
    steps:[`<b>6 철근 빼기</b>를 골라요`,`건물을 ${K} ①`,'조금 기다리면 기둥이 하나씩 버티지 못하고 꺾여요'],tip:'바로 안 무너져요. 다른 도구랑 같이 쓰면 효과 만점.'},
  {w:6,img:'move',name:'MOVE',team:'설계',one:'건물을 통째로 들어 올려 끌고 가서 던져요.',
    steps:[`<b>7 MOVE</b>를 골라요`,TOUCH?'건물을 <b>꾹 누른 채로</b> ① (살짝 기다리면 들려요)':'건물을 <b>누른 채로</b> ①',TOUCH?'손가락을 떼지 말고 끌어서 ② 에서 놓으면 던져져요':'마우스를 끌어서 ② 에서 놓으면 던져져요'],tip:'빨리 끌수록 멀리 날아가요. 아주 큰 건물은 못 들어요.'},
  {w:7,img:'extrude',name:'EXTRUDE',team:'설계',one:'층을 계속 쌓아 올려서, 하중을 못 이기고 쓰러지게 해요.',
    steps:[`<b>8 EXTRUDE</b>를 골라요`,`건물 옥상을 ${K} ①`,'층이 쑥쑥 올라가다가 기울어지며 옆 건물을 덮쳐요'],tip:'쓰러지는 쪽에 있는 건물까지 같이 부서져요.'},
  {w:8,img:'trim',name:'TRIM',team:'설계',one:'CAD의 TRIM처럼, 그은 선 위쪽을 잘라내서 떨어뜨려요.',
    steps:[`<b>9 TRIM</b>을 골라요`,`건물 왼쪽 바깥을 ${K} ①`,`건물을 가로질러 오른쪽 바깥을 ${K} ② — 선 위쪽이 잘려 미끄러져요`],tip:'건물 <b>바깥에서 바깥으로</b> 완전히 가로질러야 잘려요. 비스듬히 그으면 비스듬히 잘려요.'},
  {w:9,img:'sink',name:'싱크홀',team:'설계',one:'누른 곳 일대 땅이 몇 초 동안 여기저기 꺼져요.',
    steps:[`<b>0 싱크홀</b>을 골라요`,`건물 근처 땅을 ${K} ①`,'땅이 꺼지면서 주변 건물이 기울고 빠져요'],tip:'한 번에 여러 채가 무너져요. 너무 몰아서 부수면 구청이 3초 공사중지를 걸어요!'},
];
const GUIDE_TABS=[['start','처음 시작'],['tools','도구 사용법'],['section','단면 모드'],['events','이벤트'],['score','점수·공유'],['patch','업데이트']];
function gStart(){const pc=!TOUCH;
  return `<div class="g-steps">
  <div class="g-step"><i>1</i><div><b>회사(또는 학교) 고르기</b><p>왼쪽 위 <kbd>⌂ 다른 회사</kbd>를 누르고 이름을 검색해요. 그 회사 동네의 실제 지도가 3D로 만들어져요.</p></div></div>
  <div class="g-step"><i>2</i><div><b>화면 움직이기</b>${pc?`
    <div class="g-ctl"><span><em>🖱 왼쪽 드래그</em>화면 돌리기</span><span><em>🖱 오른쪽 드래그<small>(또는 Shift+드래그)</small></em>옆으로 이동</span><span><em>🖱 휠</em>확대 · 축소</span><span><em>⌨ W A S D</em>앞뒤좌우 이동</span></div>`:`
    <div class="g-ctl"><span><em>☝ 한 손가락으로 밀기</em>화면 돌리기</span><span><em>✌ 두 손가락 벌리기·오므리기</em>확대 · 축소</span><span><em>✌ 두 손가락 같이 밀기</em>옆으로 이동</span></div>`}</div></div>
  <div class="g-step"><i>3</i><div><b>도구 고르고 건물 누르기</b><p>아래 도구막대에서 도구를 고르고${pc?' (숫자키 1~0도 돼요)':''}, 건물을 ${K}하면 부서져요.
    <br>⚠ <b>불도저·쇠공·TRIM</b>은 <u>${K} 한 번 → 끝점에 한 번 더 ${K}</u> 해서 선을 그어요. 누르고 끄는 게 아니에요!</p></div></div>
  <div class="g-step"><i>4</i><div><b>잘못했으면</b><p><kbd>되돌리기</kbd>${pc?'(Ctrl+Z)':''}로 한 단계 전으로, <kbd>전부 복구</kbd>로 처음 상태로 돌아가요.</p></div></div>
  </div>
  <div class="g-cta"><button class="btn-p" id="gMission">🎯 따라하기로 하나씩 배우기</button><button class="btn-s" data-gtab="tools">도구 사용법 보기 →</button></div>`}
function gTools(){return `<div class="g-tools">`+GUIDE_TOOLS.map(t=>`<div class="g-tool">
  <div class="g-img"><img loading="lazy" src="img/guide/${t.img}.jpg" alt="${t.name} 예시">${t.img2?`<img loading="lazy" src="img/guide/${t.img2}.jpg" alt="${t.name} 결과">`:''}</div>
  <div class="g-txt"><div class="g-name"><kbd>${t.w===9?0:t.w+1}</kbd> ${t.name} <small>${t.team}팀</small></div><p class="g-one">${t.one}</p>
  <ol>${t.steps.map(s=>`<li>${s}</li>`).join('')}</ol><p class="g-tip">💡 ${t.tip}</p>
  <button class="btn-s g-try" data-w="${t.w}">이 도구로 해보기</button></div></div>`).join('')+`
  <div class="g-tool g-ult"><div class="g-txt"><div class="g-name"><kbd>Q</kbd> 필살기</div><p class="g-one">부술수록 오른쪽 아래 원형 게이지가 차요. 가득 차면 ${TOUCH?'원을 누르고':'Q 키를 누르고'} 아무 곳이나 ${K}하면 일대가 한 번에 날아가요.</p></div></div></div>`}
function gSection(){return `<div class="g-tool"><div class="g-img"><img loading="lazy" src="img/guide/section.jpg" alt="단면 모드"></div><div class="g-txt">
  <div class="g-name">🔪 단면 모드 — 우리 층만 정밀 철거</div><p class="g-one">사옥을 잘라서 층별 단면으로 보여줘요. 기둥·코어·슬래브를 하나하나 부술 수 있어요.</p>
  <ol><li>아래 <kbd>단면</kbd> 버튼${TOUCH?'':' (또는 C 키)'}을 눌러요. 동네 지도의 파란 사무소 이름표를 ${TOUCH?'두 번 탭':'클릭'}해도 그 건물 단면으로 들어가요</li>
  <li>도구는 동네와 같아요. MOVE는 층을 통째로 빼서 던지고, EXTRUDE는 위로 끌어 올려 증축해요</li>
  <li>${TOUCH?'위쪽 [확대해서 보기]':'F 키'}로 우리 층을 확대하고, <kbd>동네로</kbd> 버튼으로 돌아가요</li></ol>
  <p class="g-tip">💡 한 층의 기둥이 절반 넘게 부러지면 그 층이 주저앉고, 위층이 연달아 무너져요. 적은 타격으로 완전 붕괴시키면 '구조 등급' 보너스!</p></div></div>`}
function gEvents(){return `<div class="g-ev">
  <div><b>👔 사장님</b><p>옥상에서 잔소리해요. 사장님을 ${K}하면 기절 + 보너스. 사옥이 무너지면 근처 건축사무소로 도망가요 — 화면 가장자리 화살표를 누르면 따라가요. 더 도망칠 곳이 없으면 검거! (대학교는 총장님)</p></div>
  <div><b>😤 발주처 난입</b><p>사옥이 꽤 부서지면 검은 차를 타고 와서 빨간 임시 철골·빨간펜 테이프·매스·타워를 갖다 놓아요. 전부 부수면 점수! 건물이 무너지면 한 번은 새로 지어요.</p></div>
  <div><b>📢 부동산 호황</b><p>사장님을 검거한 뒤 점수를 더 모으면 사장님이 비행선을 타고 돌아와 사옥을 새로 지어요. 비행선 현수막엔 최근 7일 가장 많이 무너진 사옥 1위!</p></div>
  <div><b>🌙 야근 모드</b><p>낮 90초 · 밤 60초. 밤에는 <b>불 켜진 건물 점수 ×2</b>, 꺼진 건물 ×0.25. 오른쪽 위에 남은 시간이 보여요.</p></div>
  <div><b>🚧 구청 공사중지</b><p>몇 초 만에 건물을 10동 넘게 몰아서 부수면 3초 동안 도구를 못 써요. 화면은 움직일 수 있어요.</p></div>
  <div><b>🔥 콤보</b><p>쉬지 않고 계속 부수면 n COMBO — 점수가 최대 ×2.</p></div></div>`}
function gScore(){return `<div class="g-ev">
  <div><b>📋 철거 공사 일보</b><p>오른쪽 위 <kbd>철거 일보</kbd>: 파괴율·철거 동수·점수·직급(인턴 → ANNIHILATOR). 여기서 랭킹 등록과 공유를 해요.</p></div>
  <div><b>🏆 랭킹</b><p>이번 주 점수 순위. 한 판(회사를 고른 뒤 다른 회사를 고르거나 전부 복구하기 전까지)에 닉네임 하나로 점수만 올라가요.</p></div>
  <div><b>🔥 가장 많이 무너진 사옥</b><p>회사 고르기 창 위쪽. 최근 7일 동안 그 사옥을 무너뜨린 <b>사람 수</b> 기준이에요. 동료들과 같이 부숴 1위를 만들어 보세요.</p></div>
  <div><b>🗺 정복</b><p>구별로 몇 곳을 무너뜨렸는지 지도로 보여줘요.</p></div>
  <div><b>📤 공유</b><p>지금 화면으로 결과 카드를 만들어 카카오톡·SNS로 보내요. "도전장"을 켜면 받은 친구 화면에 내 점수가 떠요.</p></div>
  <div><b>📮 회사 추가 · 문의</b><p>목록에 없으면 회사 고르기 창 검색 아래 버튼으로 이름·주소만 넣으면 바로 추가돼요.</p></div></div>`}
function gPatch(){const p=$('#mPatch');const ul=p?p.querySelector('ul'):null;const ver=p?p.querySelector('.small').textContent:'';
  return `<div class="small" style="margin-bottom:6px">${esc(ver)}</div><div class="card patch" style="padding:0;background:none;box-shadow:none;max-width:none">${ul?ul.outerHTML:''}</div>
  <label class="opt" style="margin-top:10px">업데이트가 있으면 시작할 때 이 내용 띄우기 <input type="checkbox" id="optPatch2" ${opts.patch!==false?'checked':''}></label>`}
function openGuide(tab){const m=$('#mGuide');if(!m)return;closeModals();m.classList.add('open');showGuide(tab||lsGet('smasharch_gtab')||'start')}
function showGuide(tab){const b=$('#gBody');if(!b)return;lsSet('smasharch_gtab',tab);
  document.querySelectorAll('#gTabs button').forEach(x=>x.classList.toggle('on',x.dataset.t===tab));
  b.innerHTML={start:gStart,tools:gTools,section:gSection,events:gEvents,score:gScore,patch:gPatch}[tab]();b.scrollTop=0;
  b.querySelectorAll('[data-gtab]').forEach(x=>x.onclick=()=>showGuide(x.dataset.gtab));
  b.querySelectorAll('.g-try').forEach(x=>x.onclick=()=>{closeModals();selectWeapon(+x.dataset.w);toast(`${WEAPONS[+x.dataset.w].name} 준비! 건물을 ${K}해 보세요`,2600)});
  const gm=$('#gMission');if(gm)gm.onclick=()=>{closeModals();missionStart()};
  const op=$('#optPatch2');if(op)op.onchange=()=>{opts.patch=op.checked;lsSet('smasharch_opts',opts);const o=$('#optPatch');if(o)o.checked=op.checked}}
(function(){const t=$('#gTabs');if(!t)return;t.innerHTML=GUIDE_TABS.map(([k,n])=>`<button data-t="${k}">${n}</button>`).join('');
  t.querySelectorAll('button').forEach(x=>x.onclick=()=>showGuide(x.dataset.t))})();
$('#btnHelp').onclick=()=>openGuide();if($('#setGuide'))$('#setGuide').onclick=()=>openGuide();
// 처음 온 사람: 환영 카드 → 따라하기 / 가이드 / 바로 시작
function showWelcome(){const m=$('#mWelcome');if(!m){openGuide('start');return}closeModals();m.classList.add('open')}
if($('#mWelcome')){$('#wMission').onclick=()=>{closeModals();lsSet('smasharch_tut_v2',1);missionStart()};
  $('#wGuide').onclick=()=>{lsSet('smasharch_tut_v2',1);openGuide('start')};$('#wSkip').onclick=()=>{closeModals();lsSet('smasharch_tut_v2',1)}}
// 따라하기 미션 — 화면 왼쪽에 할 일 목록, 해내면 자동으로 체크
const MISSIONS=[
  {t:TOUCH?'한 손가락으로 화면을 밀어 돌려보기':'빈 곳을 드래그해서 화면 돌려보기',ok:()=>MS.rot>0.6},
  {t:TOUCH?'두 손가락으로 확대·축소해 보기':'마우스 휠로 확대·축소해 보기',ok:()=>MS.zoom>0.25},
  {t:`<b>1 철거반</b>을 고르고 건물을 ${K}`,w:0,ok:()=>(STATS.tools.crew||0)>0},
  {t:`<b>2 불도저</b>: 땅을 ${K} → 건물 너머를 한 번 더 ${K}`,w:1,ok:()=>(STATS.tools.dozer||0)>0},
  {t:`<b>5 다이너마이트</b>를 벽에 붙이고 ${TOUCH?'[기폭]':'Space'}로 쾅`,w:4,ok:()=>(STATS.tools.blast||0)>0},
  {t:`옥상의 <b>사장님</b>을 ${K}해서 기절시키기`,ok:()=>MS.boss>0},
  {t:`<b>단면</b> 버튼으로 건물 속 들어가 보기`,ok:()=>MODE==='section'},
];
let MS=null;
function missionStart(){MS={i:0,rot:0,zoom:0,boss:0,th:cam.theta,ds:cam.dist,done:new Array(MISSIONS.length).fill(false)};missionUI();toast('🎯 왼쪽 목록을 하나씩 해보세요. 해내면 자동으로 체크돼요',3500)}
function missionTick(){if(!MS)return;MS.rot+=Math.abs(cam.theta-MS.th);MS.th=cam.theta;if(MS.ds>0)MS.zoom+=Math.abs(cam.dist-MS.ds)/MS.ds;MS.ds=cam.dist;
  let ch=false;MISSIONS.forEach((m,i)=>{if(!MS.done[i]&&m.ok()){MS.done[i]=true;ch=true;sfx(4,0.15)}});if(ch)missionUI()}
function missionUI(){let el=$('#mission');if(!MS){if(el)el.remove();return}
  if(!el){el=document.createElement('div');el.id='mission';document.body.appendChild(el)}
  const n=MS.done.filter(Boolean).length,all=n===MISSIONS.length;
  el.innerHTML=`<div class="mh"><b>🎯 따라하기 ${n}/${MISSIONS.length}</b><button title="닫기">×</button></div>`+MISSIONS.map((m,i)=>`<div class="mi${MS.done[i]?' ok':''}"><i>${MS.done[i]?'✔':i+1}</i><span>${m.t}</span>${m.w!=null&&!MS.done[i]?`<button data-w="${m.w}">고르기</button>`:''}</div>`).join('')+
    (all?`<div class="mdone">🎉 다 했어요! 이제 마음껏 부수세요.<br><button class="btn-s" id="mGuideBtn">📘 다른 도구도 보기</button></div>`:`<div class="mfoot"><button class="btn-s" id="mGuideBtn">📘 가이드 보기</button></div>`);
  el.querySelector('.mh button').onclick=()=>{MS=null;missionUI()};
  el.querySelectorAll('.mi button').forEach(b=>b.onclick=()=>{selectWeapon(+b.dataset.w);toast(`${WEAPONS[+b.dataset.w].name} 준비 완료`,1500)});
  const g=el.querySelector('#mGuideBtn');if(g)g.onclick=()=>openGuide('tools');
  if(all){flashScreen(0.2,'#fff3c4');sfx(20,0.6);setTimeout(()=>{if(MS&&MS.done.every(Boolean)){MS=null;missionUI()}},12000)}}
setInterval(missionTick,300);


function updateWorld(dt){
  if(MODE==='city'){pumpTiles();const ti=tileOf(cam.tx)+','+tileOf(cam.tz);if(basePlaneAt!==ti)buildBasePlane()}
  for(const c of CHUNKS.values()){
    if(groundDirty)c.dG=true;if(bldDirty)c.dB=true;if(treeDirty)c.dT=true;
    if(c.dG){c.dG=false;buildChunkGround(c);c.dT=true}
    if(c.dB)buildChunkBuildings(c);
    if(c.dT)buildChunkTrees(c);
  }
  groundDirty=bldDirty=treeDirty=false;
}


// =====================================================================
//  구별 정복 진행도 — 부순 건축사무소를 시도·시군구별로 집계
//  '나': 이 브라우저에 저장 / '모두 함께': Apps Script 웹앱 '철거' 탭
// =====================================================================
const CONQ=new Set(lsGet('smasharch_conq')||[]);
let CONQ_Q=new Set(), HOT_Q=new Set(), conqTimer=0, CONQ_ALL=null, conqView={who:'all',scope:'seoul',open:null};
const FKI=new Map(FIRMDATA.map((r,i)=>[r[5],i]));
function keyIdx(k){return /^d\d+$/.test(k||'')?FKI.get(+k.slice(1)):undefined}
function regionOfRow(r){return r&&r[6]?(r[6]+' '+r[7]).trim():''}
// 지역별 전체 수(좌표 있는 곳만) — 시트 데이터에서 계산
const REG=(()=>{const m=new Map();FIRMDATA.forEach((r,i)=>{if(!r[6])return;const k=regionOfRow(r);
  if(!m.has(k))m.set(k,{key:k,sido:r[6],sgg:r[7],idx:[],n:0});const g=m.get(k);g.n++;if(r[4]!==2&&r[2]!=null)g.idx.push(i)});return m})();
function conqKeysOf(b){const ks=[];if(b&&b.firms)for(const f of b.firms)if(f.i!=null&&FIRMDATA[f.i])ks.push('d'+FIRMDATA[f.i][5]);
  if(b&&b.hq&&CUR&&CUR.dkey)ks.push(CUR.dkey);return [...new Set(ks)]}
function myDone(reg){let n=0;for(const i of reg.idx)if(CONQ.has('d'+FIRMDATA[i][5]))n++;return n}
function allDone(reg){return CONQ_ALL&&CONQ_ALL.done?(CONQ_ALL.done[reg.key]||0):0}
function conqRecord(b){
  const ks=conqKeysOf(b);if(!ks.length)return;let fresh=[];
  if(b&&b.hq&&CUR&&CUR.dkey)HOT_Q.add(CUR.dkey);   // '가장 많이 무너진 사옥'은 고른 사옥만 (같은 건물에 든 다른 회사는 정복에만 반영)
  for(const k of ks){CONQ_Q.add(k);if(!CONQ.has(k)){CONQ.add(k);fresh.push(k)}}
  if(fresh.length){lsSet('smasharch_conq',[...CONQ]);
    const i=keyIdx(fresh[0]);const reg=i!=null?REG.get(regionOfRow(FIRMDATA[i])):null;
    if(reg){const d=myDone(reg),t=reg.idx.length;setTimeout(()=>toast(`${reg.sgg} 정복 ${d} / ${t}곳 (${Math.floor(d/t*100)}%)${d===t?' · 완전 정복!':''}`,2600),2400)}}
  clearTimeout(conqTimer);conqTimer=setTimeout(flushConq,6000);
}
function conqBody(){return JSON.stringify({type:'kill',keys:[...CONQ_Q].slice(0,200),hot:[...HOT_Q].slice(0,5),vid:lsGet('smasharch_vid')||'',nick:lsGet('smasharch_nick')||'익명'})}
async function flushConq(){
  const u=rankUrl();if(!u||!CONQ_Q.size)return;const body=conqBody();const sent=[...CONQ_Q].slice(0,200),sentH=[...HOT_Q];
  try{const r=await fetchT(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body},15000);
    if(r&&r.ok){for(const k of sent)CONQ_Q.delete(k);for(const k of sentH)HOT_Q.delete(k);if(CONQ_ALL)CONQ_ALL=null}}catch(e){}
  if(CONQ_Q.size){clearTimeout(conqTimer);conqTimer=setTimeout(flushConq,20000)}
}
addEventListener('pagehide',()=>{const u=rankUrl();if(u&&CONQ_Q.size&&navigator.sendBeacon){try{navigator.sendBeacon(u,new Blob([conqBody()],{type:'text/plain;charset=utf-8'}))}catch(e){}}});

// ---------- 접속 집계 (탭 하나당 1번만 서버에 알림 → 시트 '접속기록'·'접속자') ----------
// 어디서 들어왔는지: ?utm_source= → 앱 안 브라우저(카톡·인스타 등) → 이전 페이지 주소 → 없으면 '직접'
function visitSource(ref){
  try{const u=new URL(location.href).searchParams.get('utm_source');if(u)return u.slice(0,20)}catch(e){}
  const ua=navigator.userAgent||'';
  const app=[[/KAKAOTALK/i,'카카오톡'],[/Instagram/i,'인스타그램'],[/FBAN|FBAV|FB_IAB/i,'페이스북'],[/NAVER\(inapp|NAVER\//i,'네이버'],[/DaumApps|DaumDevice/i,'다음'],[/\bLine\//i,'라인'],[/everytimeApp/i,'에브리타임'],[/BAND\//i,'밴드'],[/Threads/i,'스레드'],[/Twitter/i,'X']];
  for(const [re,n] of app)if(re.test(ua))return n;
  const h=String(ref||'').toLowerCase();if(!h||h===location.hostname||/ccct12\.github\.io$/.test(h))return '직접';
  const site=[[/kakao|kakaocdn|daum\.net\/kakao/,'카카오톡'],[/naver/,'네이버'],[/google/,'구글'],[/daum/,'다음'],[/bing/,'빙'],[/instagram/,'인스타그램'],[/facebook|fb\.com/,'페이스북'],[/threads/,'스레드'],[/^t\.co$|twitter|(^|\.)x\.com$/,'X'],[/band\.us/,'밴드'],[/everytime/,'에브리타임'],[/teamblind|blind/,'블라인드'],[/dcinside/,'디시'],[/clien/,'클리앙'],[/theqoo/,'더쿠'],[/fmkorea/,'에펨코리아'],[/hada\.io/,'긱뉴스']];
  for(const [re,n] of site)if(re.test(h))return n;
  return h.slice(0,20)}
(function sendVisit(){
  const u=rankUrl();if(!u)return;
  try{if(sessionStorage.getItem('smasharch_visited'))return;sessionStorage.setItem('smasharch_visited','1')}catch(e){}
  let vid=lsGet('smasharch_vid'),first=false;
  if(!vid||!/^[a-z0-9]{8,32}$/.test(vid)){vid=(Date.now().toString(36)+Math.random().toString(36).slice(2,10)).slice(0,20);lsSet('smasharch_vid',vid);first=true}
  let ref='';try{ref=document.referrer?new URL(document.referrer).hostname:''}catch(e){}
  const body=JSON.stringify({type:'visit',vid,first,dev:matchMedia('(pointer:coarse)').matches?'모바일':'PC',ref,src:visitSource(ref)});
  setTimeout(()=>{try{fetch(u,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body,keepalive:true}).catch(()=>{})}catch(e){}},1500);
})();

// 서울 25개 구 타일 지도 (열, 행)
const SEOUL_TILES={'은평구':[2,0],'강북구':[4,0],'도봉구':[5,0],'노원구':[6,0],
  '마포구':[1,1],'서대문구':[2,1],'종로구':[3,1],'성북구':[4,1],'동대문구':[5,1],'중랑구':[6,1],
  '강서구':[0,2],'영등포구':[1,2],'용산구':[2,2],'중구':[3,2],'성동구':[4,2],'광진구':[5,2],'강동구':[6,2],
  '양천구':[0,3],'구로구':[1,3],'동작구':[2,3],'서초구':[3,3],'강남구':[4,3],'송파구':[5,3],
  '금천구':[1,4],'관악구':[2,4]};
function pctOf(reg){const t=reg.idx.length;if(!t)return 0;return Math.min(100,(conqView.who==='me'?myDone(reg):allDone(reg))/t*100)}
function heat(p){if(p<=0)return '#2b2e33';const a=0.25+0.75*Math.min(1,p/100);return `rgba(255,90,31,${a.toFixed(2)})`}
function pctTxt(p){return p>0&&p<1?'<1%':Math.floor(p)+'%'}
function conqBar(reg,label){const p=pctOf(reg),d=conqView.who==='me'?myDone(reg):allDone(reg);
  return `<button class="cq-row" data-reg="${esc(reg.key)}"><span class="cq-n">${esc(label)}</span><span class="cq-bar"><i style="width:${p.toFixed(1)}%"></i></span><em>${reg.idx.length?`${fmt(d)}/${fmt(reg.idx.length)} · ${pctTxt(p)}`:`좌표 준비 중 (${fmt(reg.n)}곳)`}</em></button>`}
function sidoGroups(){const g=new Map();for(const reg of REG.values()){if(!g.has(reg.sido))g.set(reg.sido,{key:reg.sido,sido:reg.sido,sgg:reg.sido,idx:[],subs:[]});const s=g.get(reg.sido);s.idx.push(...reg.idx);s.subs.push(reg)}
  return [...g.values()].sort((a,b)=>b.idx.length-a.idx.length)}
function allDoneSido(s){return s.subs.reduce((n,r)=>n+allDone(r),0)}
function renderConq(){
  const box=$('#conqBody');const who=conqView.who;
  document.querySelectorAll('#mConq [data-who]').forEach(b=>b.classList.toggle('on',b.dataset.who===who));
  document.querySelectorAll('#mConq [data-scope]').forEach(b=>b.classList.toggle('on',b.dataset.scope===conqView.scope));
  let tot=0,dn=0;for(const reg of REG.values()){tot+=reg.idx.length;dn+=who==='me'?myDone(reg):allDone(reg)}
  let note='';
  if(who==='all'&&!CONQ_ALL)note=rankUrl()?'<p class="small">모두의 기록을 불러오는 중…</p>':'<p class="small">서버가 연결되지 않아 "모두 함께" 기록을 볼 수 없어요. 설정 → 서버 주소를 확인해주세요.</p>';
  let html=`<div class="cq-sum"><b>${fmt(dn)}</b> / ${fmt(tot)}곳 정복 <small>(${pctTxt(tot?dn/tot*100:0)}, 좌표 있는 사무소 기준)</small></div>${note}`;
  if(conqView.scope==='seoul'){
    const regs=[...REG.values()].filter(r=>r.sido==='서울특별시');
    html+='<div class="cq-map">';
    for(const reg of regs){const t=SEOUL_TILES[reg.sgg];if(!t)continue;const p=pctOf(reg);
      html+=`<button class="cq-tile${p>=100?' full':''}" data-reg="${esc(reg.key)}" style="grid-column:${t[0]+1};grid-row:${t[1]+1};background:${heat(p)}"><b>${esc(reg.sgg.replace(/구$/,''))}</b><small>${reg.idx.length?pctTxt(p):'준비 중'}</small></button>`}
    html+='</div><div class="rk-h">구별 순위</div>';
    html+=regs.sort((a,b)=>pctOf(b)-pctOf(a)||a.sgg.localeCompare(b.sgg)).map(r=>conqBar(r,r.sgg)).join('');
  }else{
    for(const s of sidoGroups()){const t=s.idx.length,d=who==='me'?s.subs.reduce((n,r)=>n+myDone(r),0):allDoneSido(s),p=t?d/t*100:0,op=conqView.open===s.sido;
      html+=`<button class="cq-row sido" data-sido="${esc(s.sido)}"><span class="cq-n">${op?'▾':'▸'} ${esc(s.sido)}</span><span class="cq-bar"><i style="width:${p.toFixed(1)}%"></i></span><em>${fmt(d)}/${fmt(t)} · ${pctTxt(p)}</em></button>`;
      if(op)html+='<div class="cq-sub">'+s.subs.sort((a,b)=>pctOf(b)-pctOf(a)||b.idx.length-a.idx.length).map(r=>conqBar(r,r.sgg||r.sido)).join('')+'</div>'}
  }
  html+='<div id="conqPick"></div>';
  box.innerHTML=html;
  box.querySelectorAll('[data-reg]').forEach(el=>el.onclick=()=>conqPick(REG.get(el.dataset.reg)));
  box.querySelectorAll('[data-sido]').forEach(el=>el.onclick=()=>{conqView.open=conqView.open===el.dataset.sido?null:el.dataset.sido;renderConq()});
}
function conqPick(reg){if(!reg)return;const left=reg.idx.filter(i=>!CONQ.has('d'+FIRMDATA[i][5]));
  const el=$('#conqPick');const name=reg.sido==='서울특별시'?reg.sgg:reg.key;
  el.innerHTML=`<div class="cq-pick"><b>${esc(name)}</b> · ${reg.idx.length?`내가 남긴 사무소 ${fmt(left.length)}곳 / 전체 ${fmt(reg.idx.length)}곳`:`사무소 ${fmt(reg.n)}곳 · 아직 좌표가 없어요(시트에서 좌표 작업 후 열려요)`}<br><small>모두 함께 ${fmt(allDone(reg))}곳 철거</small>
    <div class="row"><button class="btn-p" id="cqGo" ${left.length?'':'disabled'} style="flex:1">${left.length?'남은 사무소로 출동':reg.idx.length?'완전 정복!':'좌표 준비 중'}</button></div></div>`;
  el.scrollIntoView({block:'nearest'});
  const go=$('#cqGo');if(go)go.onclick=()=>{const i=left[Math.floor(Math.random()*left.length)];closeModals();loadFirm(firmFromData(i))};
}
async function loadConqAll(){const u=rankUrl();if(!u)return;
  try{const r=await fetchT(u+(u.includes('?')?'&':'?')+'action=progress',{},15000);if(r&&r.ok){CONQ_ALL=r;if($('#mConq').classList.contains('open'))renderConq()}}catch(e){}}
function openConq(){$('#mConq').classList.add('open');renderConq();if(CONQ_Q.size)flushConq().then(loadConqAll);else loadConqAll()}
$('#btnConq').onclick=openConq;
document.querySelectorAll('#mConq [data-who]').forEach(b=>b.onclick=()=>{conqView.who=b.dataset.who;renderConq()});
document.querySelectorAll('#mConq [data-scope]').forEach(b=>b.onclick=()=>{conqView.scope=b.dataset.scope;renderConq()});
