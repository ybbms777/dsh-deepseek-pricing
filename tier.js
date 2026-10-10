// GENERATED FILE — DO NOT EDIT BY HAND.
// The peak/off-peak rule lives in one place: the panel's index.html CORE block.
// Source: https://github.com/ybbms777/deepseek-pricing-panel @ a8ed932ed9e33b85b33038577a8b9932dbbce439
//         index.html
// CORE sha256: 9c9a3dda7706b309c9c57a896a4dd89fa3f265340e26c89271fde8ae35282b62
// Regenerate: node tools/sync-core.mjs
// ---- 纯逻辑：不依赖 DOM，可在 node 中独立测试 ----
const TZ = 8 * 3600 * 1000; // 北京时间 = UTC+8

function ymd(d){ const p=n=>String(n).padStart(2,'0'); return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate()); }
function range(a,b){ // 'YYYY-MM-DD' 闭区间
  const out=[], s=new Date(a+'T00:00:00Z'), e=new Date(b+'T00:00:00Z');
  for(let t=s.getTime(); t<=e.getTime(); t+=86400000) out.push(ymd(new Date(t)));
  return out;
}
// 2026 年国务院办公厅《关于2026年部分节假日安排的通知》：放假日期（不含调休上班日）
const HOLIDAYS = new Set([
  ...range('2026-01-01','2026-01-03'), // 元旦
  ...range('2026-02-15','2026-02-23'), // 春节
  ...range('2026-04-04','2026-04-06'), // 清明
  ...range('2026-05-01','2026-05-05'), // 劳动节
  ...range('2026-06-19','2026-06-21'), // 端午
  ...range('2026-09-25','2026-09-27'), // 中秋
  ...range('2026-10-01','2026-10-07')  // 国庆
]);

function bj(ts){ // 拆出北京时间各字段
  const d=new Date(ts+TZ);
  return {y:d.getUTCFullYear(),mo:d.getUTCMonth()+1,d:d.getUTCDate(),h:d.getUTCHours(),
          mi:d.getUTCMinutes(),s:d.getUTCSeconds(),wd:d.getUTCDay(),key:ymd(d)};
}
function isPeakHour(y,mo,d,h){
  const key=y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  if(HOLIDAYS.has(key)) return false;                       // 法定节假日 → 空闲
  const wd=new Date(Date.UTC(y,mo-1,d)).getUTCDay();
  if(wd===0||wd===6) return false;                          // 周末 → 空闲
  return (h>=9&&h<12)||(h>=14&&h<18);                       // 工作日高峰两段
}
function tierAt(ts){ const p=bj(ts); return isPeakHour(p.y,p.mo,p.d,p.h)?'peak':'off'; }
function nextSwitch(ts){ // 高峰/空闲边界都落在整点，逐小时向前找即可
  const base=Math.floor(ts/3600000)*3600000, cur=tierAt(ts);
  for(let i=1;i<=24*15;i++){ const t=base+i*3600000; if(tierAt(t)!==cur) return t; }
  return null;
}
function daySegments(ts){ // 返回该北京时间日的 [{h0,h1}] 高峰段
  const p=bj(ts), segs=[]; let open=null;
  for(let h=0;h<=24;h++){
    const peak = h<24 ? isPeakHour(p.y,p.mo,p.d,h) : false;
    if(peak && open===null) open=h;
    if(!peak && open!==null){ segs.push({h0:open,h1:h}); open=null; }
  }
  return segs;
}
// 模型：API 模型名 id → 官方“模型版本”字段 ver（已用 GET https://api.deepseek.com/models 核对 id 与 name）
const PRICES = {
  'deepseek-flash':  {ver:'DeepSeek-V4.1-Flash',        hit:[0.02,0.04],  miss:[1,2],       out:[4,8],        conc:2500},
  'deepseek-v4-pro': {ver:'DeepSeek-V4-Pro（0813 版）', hit:[0.15,0.30],  miss:[4.5,9.0],   out:[13.5,27.0],  conc:500}
};
const WD=['周日','周一','周二','周三','周四','周五','周六'];

const MODEL_NAMES = Object.fromEntries(Object.entries(PRICES).map(([m, v]) => [m, v.ver]));

export { tierAt, nextSwitch, daySegments, bj, HOLIDAYS, PRICES, MODEL_NAMES };
