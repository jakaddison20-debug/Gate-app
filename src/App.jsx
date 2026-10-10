import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createClient } from '@supabase/supabase-js';
import { Analytics } from "@vercel/analytics/react";
const supabase=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY);

const DEFAULT_CENTER={lat:53.4919264,lng:-0.3294266};

const FAT_GATE_RADIUS=10;
const FINISH_GATE_RADIUS=20;

function haversine(a,b){const R=6371000,dLat=((b.lat-a.lat)*Math.PI)/180,dLng=((b.lng-a.lng)*Math.PI)/180,s=Math.sin(dLat/2)**2+Math.cos((a.lat*Math.PI)/180)*Math.cos((b.lat*Math.PI)/180)*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
function metersOffset(from,to){const latRad=from.lat*Math.PI/180;return{x:(to.lng-from.lng)*111320*Math.cos(latRad),y:(to.lat-from.lat)*110540};}
function segmentCrossesGate(prevPos,currPos,gate,radius){if(!prevPos)return false;const a=metersOffset(gate,prevPos);const b=metersOffset(gate,currPos);const dx=b.x-a.x,dy=b.y-a.y;const lenSq=dx*dx+dy*dy;let t=lenSq===0?0:-(a.x*dx+a.y*dy)/lenSq;t=Math.max(0,Math.min(1,t));const cx=a.x+t*dx,cy=a.y+t*dy;return Math.sqrt(cx*cx+cy*cy)<=radius;}
function gateCrossT(prevPos,currPos,gate){const a=metersOffset(gate,prevPos);const b=metersOffset(gate,currPos);const dx=b.x-a.x,dy=b.y-a.y;const lenSq=dx*dx+dy*dy;let t=lenSq===0?0:-(a.x*dx+a.y*dy)/lenSq;return Math.max(0,Math.min(1,t));}
function formatTime(ms){if(!ms)return"—";const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000),cs=Math.floor((ms%1000)/10);return`${m}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;}
function formatDist(m){return m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`;}
function timeAgo(iso){const s=(Date.now()-new Date(iso).getTime())/1000;if(s<60)return'just now';if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;if(s<604800)return`${Math.floor(s/86400)}d ago`;return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'});}
function playBeep(freq=880,duration=150){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const osc=ctx.createOscillator();const gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=freq;osc.type='sine';gain.gain.setValueAtTime(0.3,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+duration/1000);osc.start();osc.stop(ctx.currentTime+duration/1000);}catch(e){console.log(e);}}
function logEvent(userId,type,message,stageId=null,context=null){if(!userId)return Promise.resolve();return supabase.from('app_events').insert({user_id:userId,event_type:type,message,stage_id:stageId?String(stageId):null,context}).then(()=>{}).catch(err=>console.log('logEvent failed:',err?.message||err));}
async function saveStageTime({stage_id,stage_name,user_id,time_ms,created_at,trace}){
  const overallRes=await supabase.from('stage_times').select('time_ms').eq('stage_id',stage_id).order('time_ms',{ascending:true}).limit(1);
  const ownRes=await supabase.from('stage_times').select('time_ms').eq('stage_id',stage_id).eq('user_id',user_id).order('time_ms',{ascending:true}).limit(1);
  const prevBest=overallRes.data&&overallRes.data[0]?overallRes.data[0].time_ms:null;
  const ownPrevBest=ownRes.data&&ownRes.data[0]?ownRes.data[0].time_ms:null;
  const payload={stage_id,user_id,time_ms};
  if(created_at)payload.created_at=created_at;
  const{error}=await supabase.from('stage_times').insert(payload);
  if(error)throw error;
  // Keep the GPS path of your best run on this stage (powers the speed/gap charts). Never fails the save.
  if(trace&&trace.length>=3&&(ownPrevBest===null||time_ms<ownPrevBest)){
    try{
      const{error:traceErr}=await supabase.from('run_traces').upsert({user_id,stage_id:String(stage_id),time_ms,points:trace},{onConflict:'user_id,stage_id'});
      if(traceErr)console.log('trace save failed',traceErr.message);
    }catch(e){console.log('trace save failed',e);}
  }
  if(prevBest===null||time_ms<prevBest){
    logEvent(user_id,'stage_record',`set a new record on ${stage_name} · ${formatTime(time_ms)}`,stage_id,{time_ms});
  } else if(ownPrevBest!==null&&time_ms<ownPrevBest){
    logEvent(user_id,'personal_best',`set a new personal best on ${stage_name} · ${formatTime(time_ms)}`,stage_id,{time_ms});
  }
}
function getOfflineTimesQueue(){try{return JSON.parse(localStorage.getItem('gate_offline_times')||'[]');}catch(e){return [];}}
function saveOfflineTimesQueue(q){try{localStorage.setItem('gate_offline_times',JSON.stringify(q));}catch(e){}}
function queueOfflineTime(entry){const q=getOfflineTimesQueue();q.push(entry);saveOfflineTimesQueue(q);}
async function syncOfflineTimes(){
  const q=getOfflineTimesQueue();
  if(q.length===0)return{synced:0,remaining:0};
  const remaining=[];
  let synced=0;
  for(const entry of q){
    try{await saveStageTime(entry);synced++;}
    catch(err){console.log('offline sync failed, will retry later',err);remaining.push(entry);}
  }
  saveOfflineTimesQueue(remaining);
  return{synced,remaining:remaining.length};
}
const VAPID_PUBLIC_KEY="BADsQA8MkAdC8BjhzkkUJtTZm50ivtVAN_c1ZRnc33-Y-Kmn7QoskwxjtjS0asRgTOH_OJ5_BjQrLhKYrZVGshY";
function urlBase64ToUint8Array(b64){const pad="=".repeat((4-b64.length%4)%4);const base=(b64+pad).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
function pushSupported(){return typeof window!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;}
function isStandalone(){return (window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent);}
async function savePushSubscription(){
  const reg=await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
  const j=sub.toJSON();
  const{error}=await supabase.rpc('save_push_subscription',{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth,p_ua:navigator.userAgent.slice(0,200)});
  if(error)throw error;
}
async function enablePush(){
  const perm=await Notification.requestPermission();
  if(perm!=='granted')return{ok:false,reason:perm};
  try{await savePushSubscription();return{ok:true};}
  catch(e){return{ok:false,reason:(e&&e.message)||String(e)};}
}
function getMonday(d){const date=new Date(d);const day=date.getDay();const diff=(day===0?-6:1-day);date.setDate(date.getDate()+diff);date.setHours(0,0,0,0);return date;}
function project(coord,center,zoom,w,h){const scale=Math.pow(2,zoom)*256,mercY=c=>Math.log(Math.tan(Math.PI/4+(c*Math.PI)/360)),cx=(center.lng+180)/360,cy=(1-mercY(center.lat)/Math.PI)/2;return{x:((coord.lng+180)/360-cx)*scale+w/2,y:((1-mercY(coord.lat)/Math.PI)/2-cy)*scale+h/2};}
function unproject(x,y,center,zoom,w,h){const scale=Math.pow(2,zoom)*256,mercY=c=>Math.log(Math.tan(Math.PI/4+(c*Math.PI)/360)),cx=(center.lng+180)/360,cy=(1-mercY(center.lat)/Math.PI)/2,lng=((x-w/2)/scale+cx)*360-180,lat=((Math.atan(Math.exp(((1-2*((y-h/2)/scale+cy))*Math.PI)))*2-Math.PI/2)*180)/Math.PI;return{lat,lng};}

function gateMarkerScale(zoom){
  const stops=[[8,0.4],[11,0.55],[14,0.75],[17,1]];
  if(zoom<=stops[0][0])return stops[0][1];
  if(zoom>=stops[stops.length-1][0])return stops[stops.length-1][1];
  for(let i=0;i<stops.length-1;i++){
    const z0=stops[i][0],s0=stops[i][1],z1=stops[i+1][0],s1=stops[i+1][1];
    if(zoom>=z0&&zoom<=z1)return s0+(s1-s0)*((zoom-z0)/(z1-z0));
  }
  return 1;
}

const C={orange:"#F59E0B",orangeL:"#FFF8E7",bg:"#FFFFFF",surface:"#F5F5F5",border:"#E6E6E6",text:"#1A1A1A",muted:"#6B6B6B",mutedL:"#C4C4C4",blue:"#2563EB",green:"#15803D",red:"#DC2626",yellow:"#B45309",mapBase:"#EAE6DF",mapWater:"#A8D3E8",mapWaterDark:"#8BBDD4",mapPark:"#D4E8D0",mapParkDark:"#BDDBB7",mapBuilding:"#D9D5CC",mapBuildingBorder:"#C8C4BB",mapHighwayBorder:"#C0B89A",mapHighway:"#F5D490",mapMajorRoad:"#FFFFFF",mapMajorBorder:"#C8C0A4",mapMinorRoad:"#FFFFFF",mapMinorBorder:"#D4CDB8",mapLabel:"#5A5A5A"};

const SAMPLE_STAGES=[];

const LEADERBOARD_DATA={};
const SAMPLE_COURSES_DONE=[];
const SAMPLE_FEED=[];


// Default settings
const DEFAULT_SETTINGS={
  displayName:"Your Name",
  avatarUrl:null,
  units:"metric",
  gpsAccuracy:"high",
  notifications:{newLeaderboard:true,sessionInvite:true,courseRecord:true,weeklyDigest:false},
  privacy:{defaultStagePrivacy:"private",showOnLeaderboard:true,shareActivity:true},
  strava:{connected:false,handle:""},
instagram:{connected:false,handle:""},
bikeName:"",
riderWeight:"",
tireDryFront:"",
tireDryRear:"",
tireWetFront:"",
tireWetRear:"",
shockMode:"psi",
shockPsi:"",
shockSpringRate:"",
shockLsc:"",
shockHsc:"",
shockLsr:"",
shockHsr:"",
shockHsb:"",
shockTokens:"",
shockSag:"",
forkMode:"psi",
forkPsi:"",
forkSpringRate:"",
forkLsc:"",
forkHsc:"",
forkLsr:"",
forkHsr:"",
forkHsb:"",
forkTokens:"",
forkSag:"",
bikeNotes:"",
forkNotes:"",
shockNotes:"",
};

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon={
  Home:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12L12 4l9 8"/><path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9"/></svg>,
  Map:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  Lightning:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  User:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Plus:({size=20,color="#fff"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Bell:({size=22,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
  Users:({size=22,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  Location:({size=20,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 018 8c0 5.25-8 13-8 13S4 15.25 4 10a8 8 0 018-8z"/></svg>,
  Bike:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 100-2 1 1 0 000 2z" fill={color} stroke="none"/><path d="M12 17.5V14l-3-3 4-3 2 3h3"/></svg>,
  ChevronRight:({size=16,color="#C4C4C4"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  ChevronDown:({size=18,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
  ChevronUp:({size=18,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>,
  Lock:({size=14,color="#8A8A8A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  Globe:({size=14,color="#8A8A8A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  Crown:({size=14,color="#92400E"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 19h20M2 19l3-10 5 5 2-8 2 8 5-5 3 10"/></svg>,
  Search:({size=18,color="#8A8A8A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Flag:({size=20,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>,
  Trophy:({size=20,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="11"/><path d="M7 4H4a2 2 0 000 4c0 2.5 2 4 4 4"/><path d="M17 4h3a2 2 0 010 4c0 2.5-2 4-4 4"/><rect x="7" y="2" width="10" height="9" rx="1"/></svg>,
  Check:({size=20,color="#15803D"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Settings:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  Strava:({size=20,color="#FC4C02"})=><svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>,   Close:({size=18,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  BarChart:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="11"/></svg>,
  Image:({size=24,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
  };

// ── Course modes ──────────────────────────────────────────────────────────────
const COURSE_MODES=[
  {id:"race",label:"Race",Ic:Icon.Flag,desc:"One timed run. Times go to the leaderboard."},
  {id:"mashup",label:"Mashup",Ic:Icon.Lightning,desc:"Unlimited runs. Best time on each stage combined into your total."},
];

const STYLES=`
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#fff;font-family:'Inter',sans-serif;}
  ::-webkit-scrollbar{display:none;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
  @keyframes recPulse{0%,100%{box-shadow:0 0 0 0 rgba(252,76,2,0.35)}50%{box-shadow:0 0 0 10px rgba(252,76,2,0)}}
  @keyframes gateGlow{0%,100%{opacity:0.4}50%{opacity:1}}
  @keyframes mashupPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
  .fade-up{animation:fadeUp 0.25s ease;}
  .fade-in{animation:fadeIn 0.2s ease;}
  .slide-up{animation:slideUp 0.3s cubic-bezier(0.32,0.72,0,1);}
  .tap{transition:opacity 0.12s;} .tap:active{opacity:0.65;}
  button{cursor:pointer;border:none;font-family:'Inter',sans-serif;}
  input,textarea{font-family:'Inter',sans-serif;}
  input::placeholder,textarea::placeholder{color:#C4C4C4;}
  input:focus,textarea:focus{outline:none;} textarea{resize:none;}
`;

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({value,onChange}){
  return(
    <div onClick={()=>onChange(!value)} style={{width:46,height:26,borderRadius:13,background:value?C.blue:"#DDD",position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:value?22:3,width:20,height:20,borderRadius:"50%",background:"white",boxShadow:"0 1px 4px rgba(0,0,0,0.2)",transition:"left 0.2s"}}/>
    </div>
  );
}
function OfflineBanner(){
  const [count,setCount]=useState(0);
  const [syncing,setSyncing]=useState(false);
  useEffect(()=>{
    const check=()=>setCount(getOfflineTimesQueue().length);
    check();
    const interval=setInterval(check,5000);
    window.addEventListener('online',check);
    document.addEventListener('visibilitychange',check);
    return()=>{clearInterval(interval);window.removeEventListener('online',check);document.removeEventListener('visibilitychange',check);};
  },[]);
  const retry=async()=>{
    setSyncing(true);
    await syncOfflineTimes();
    setCount(getOfflineTimesQueue().length);
    setSyncing(false);
  };
  if(count===0)return null;
  return(
    <div style={{margin:"10px 16px 0",background:C.orangeL,border:`1px solid ${C.orange}`,borderRadius:10,padding:"10px 12px",display:"flex",alignItems:"center",gap:10}}>
      <div style={{flex:1,fontSize:12,color:"#92400E",fontWeight:600}}>{count} time{count===1?'':'s'} waiting to sync</div>
      <button className="tap" onClick={retry} disabled={syncing} style={{background:"#fff",border:`1px solid ${C.orange}`,borderRadius:8,padding:"5px 10px",color:C.orange,fontSize:11,fontWeight:700}}>{syncing?"…":"Retry"}</button>
    </div>
  );
}

// ── Settings Screen ───────────────────────────────────────────────────────────

const Section=({title,children})=>(
  <div style={{marginBottom:24}}>
    <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:8,paddingHorizontal:16}}>{title}</div>
    <div style={{background:"white",borderRadius:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>{children}</div>
  </div>
);

const Row=({label,sub,right,noBorder=false})=>(
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:noBorder?"none":`1px solid ${C.border}`}}>
    <div style={{flex:1,marginRight:12}}>
      <div style={{fontSize:14,fontWeight:500,color:C.text}}>{label}</div>
      {sub&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>{sub}</div>}
    </div>
    {right}
  </div>
);

const SegControl=({options,value,onChange})=>(
  <div style={{display:"flex",background:C.surface,borderRadius:8,padding:2,gap:2}}>
    {options.map(o=>(
      <button key={o.val} onClick={()=>onChange(o.val)} style={{padding:"5px 10px",borderRadius:6,background:value===o.val?"white":"none",border:"none",fontSize:12,fontWeight:value===o.val?600:400,color:value===o.val?C.text:C.muted,boxShadow:value===o.val?"0 1px 3px rgba(0,0,0,0.1)":"none",transition:"all 0.15s"}}>{o.label}</button>
    ))}
  </div>
);

function SettingsScreen({settings,onSave,onBack}){
const [s,setS]=useState(settings);
const [uploading,setUploading]=useState(false);
useEffect(()=>{setS(settings);},[settings]);
const handleAvatarUpload=async(e)=>{alert("handler fired");try{const file=e.target.files[0];if(!file){alert("No file selected");return;}setUploading(true);const{data:{user},error:userError}=await supabase.auth.getUser();if(userError||!user){alert("Auth error: "+(userError?.message||"no user"));setUploading(false);return;}const ext=file.name.split('.').pop();const path=`${user.id}/avatar.${ext}`;const{error:uploadError}=await supabase.storage.from('avatars').upload(path,file,{upsert:true});if(uploadError){alert("Upload error: "+uploadError.message);setUploading(false);return;}const{data:urlData}=supabase.storage.from('avatars').getPublicUrl(path);const publicUrl=urlData.publicUrl+'?t='+Date.now();const{error:updateError}=await supabase.from('profiles').update({avatar_url:publicUrl}).eq('id',user.id);if(updateError){alert("Save error: "+updateError.message);setUploading(false);return;}update("avatarUrl",publicUrl);alert("Success!");setUploading(false);}catch(err){alert("Unexpected error: "+err.message);setUploading(false);}};

  const update=(path,val)=>{

    setS(prev=>{
      const next={...prev};
      const keys=path.split(".");
      let obj=next;
      for(let i=0;i<keys.length-1;i++){obj[keys[i]]={...obj[keys[i]]};obj=obj[keys[i]];}
      obj[keys[keys.length-1]]=val;
      return next;
    });
  };

  
  return(
    <div style={{height:"calc(100vh - 44px)",overflowY:"auto",background:C.surface}}>
      
      {/* Header */}

      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:5,display:"flex",alignItems:"center",gap:12}}>
        <button className="tap" onClick={()=>{onSave(s);onBack();}} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>Settings</div>
        <button className="tap" onClick={()=>{onSave(s);onBack();}} style={{background:C.blue,border:"none",borderRadius:8,padding:"6px 14px",color:"white",fontSize:13,fontWeight:600}}>Save</button>
      </div>

      <div style={{padding:"20px 16px"}}>

        {/* Profile */}
        <Section title="Profile">
          <Row label="Display Name" sub="Shown on leaderboards and in sessions" right={
            <input value={s.displayName} onChange={e=>update("displayName",e.target.value)}
              style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px",fontSize:14,color:C.text,width:140,textAlign:"right",background:C.surface}}/>
          }/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px"}}>
          <div style={{flex:1,marginRight:12}}>
            <div style={{fontSize:14,fontWeight:500,color:C.text}}>Profile Photo</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>{uploading?"Uploading...":"Tap to change"}</div>
          </div>
          <div style={{position:"relative",width:40,height:40,borderRadius:"50%",overflow:"hidden",background:C.blue,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:"pointer",zIndex:2}}/>
        {s.avatarUrl?<img src={s.avatarUrl} style={{width:"100%",height:"100%",objectFit:"cover",zIndex:1,position:"relative",pointerEvents:"none"}}/>:<Icon.User size={20} color="white"/>}
        </div>

        </div>


        
        </Section>

        {/* Units */}
        <Section title="Units & Display">
          <Row label="Distance & Speed" right={
            <SegControl options={[{val:"metric",label:"km"},{val:"imperial",label:"mi"}]} value={s.units} onChange={v=>update("units",v)}/>
          }/>
          <Row label="GPS Accuracy" sub={s.gpsAccuracy==="high"?"Best accuracy, more battery":"Balanced accuracy and battery"} noBorder right={
            <SegControl options={[{val:"high",label:"High"},{val:"balanced",label:"Balanced"}]} value={s.gpsAccuracy} onChange={v=>update("gpsAccuracy",v)}/>
          }/>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          {[
            {key:"newLeaderboard",label:"Leaderboard changes",sub:"When someone beats your time"},
            {key:"sessionInvite",label:"Session invites",sub:"When a mate creates a session"},
            {key:"courseRecord",label:"Course records",sub:"When you set a new CR"},
            {key:"ridesOnMine",label:"Rides on your stages",sub:"A daily summary when others ride your stages"},
            {key:"weeklyDigest",label:"Weekly digest",sub:"Summary of your activity",last:true},
          ].map(({key,label,sub,last})=>(
            <Row key={key} label={label} sub={sub} noBorder={last} right={
              <Toggle value={s.notifications[key]!==false} onChange={v=>update(`notifications.${key}`,v)}/>
            }/>
          ))}
        </Section>

        {/* Privacy */}
        <Section title="Privacy">
          <Row label="Default Stage Privacy" right={
            <SegControl options={[{val:"private",label:"Private"},{val:"group",label:"Group"},{val:"public",label:"Public"}]} value={s.privacy.defaultStagePrivacy} onChange={v=>update("privacy.defaultStagePrivacy",v)}/>
          }/>
          <Row label="Show on leaderboards" sub="Others can see your times" right={
            <Toggle value={s.privacy.showOnLeaderboard} onChange={v=>update("privacy.showOnLeaderboard",v)}/>
          }/>
          <Row label="Share activity to feed" sub="Your rides appear in mates' feeds" noBorder right={
            <Toggle value={s.privacy.shareActivity} onChange={v=>update("privacy.shareActivity",v)}/>
          }/>
        </Section>

        {/* Danger zone */}
        <Section title="Account">
          <Row label="Export my data" sub="Download all your times and stages" right={<Icon.ChevronRight/>}/>
          <Row label="Clear all times" sub="Remove all your stage times" right={<Icon.ChevronRight/>}/>
          <Row label="Delete account" sub="Permanently delete everything" noBorder right={
            <div style={{fontSize:13,fontWeight:600,color:C.red}}>Delete</div>
          }/>
        </Section>

        <div style={{textAlign:"center",padding:"8px 0 32px"}}>
          <div style={{fontSize:12,color:C.muted}}>GATE v1.0.0 · Made for mountain bikers</div>
        </div>
      </div>
    </div>
  );
}

function MapboxStyleMap({center,zoom,flyToTrigger,width:W,height:H,stages=[],courses=[],userPos,userHeading,onStagePress,diffFilter}){
  const mapContainer=useRef(null);
  const map=useRef(null);
  const gateMarkersRef=useRef([]);
  const markerStagesRef=useRef([]);
  const diffFilterRef=useRef(diffFilter);
  const userMarkerRef=useRef(null);
  const userMarkerInnerRef=useRef(null);
  const onStagePressRef=useRef(onStagePress);
  useEffect(()=>{onStagePressRef.current=onStagePress;},[onStagePress]);

  useEffect(()=>{
    if(map.current)return;
    const token=import.meta.env.VITE_MAPBOX_TOKEN;
    if(!token)return;
    import('https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js').then(()=>{
      const mapboxgl=window.mapboxgl;
      mapboxgl.accessToken=token;
      map.current=new mapboxgl.Map({
        container:mapContainer.current,
        style:'mapbox://styles/mapbox/outdoors-v12',
        center:[center.lng,center.lat],
        zoom:zoom,
      });
            map.current.on('load',()=>{
        const pinCanvas=document.createElement('canvas');
pinCanvas.width=24;pinCanvas.height=24;
const ctx=pinCanvas.getContext('2d');
ctx.fillStyle='#2563EB';
ctx.beginPath();
ctx.moveTo(13,2);
ctx.lineTo(3,14);
ctx.lineTo(12,14);
ctx.lineTo(11,22);
ctx.lineTo(21,10);
ctx.lineTo(12,10);
ctx.closePath();
ctx.fill();
map.current.addImage('stage-pin',ctx.getImageData(0,0,24,24));

                // Add stages as lines
        const midpointFeatures=[];
        gateMarkersRef.current=[];markerStagesRef.current=[];

                stages.forEach(stage=>{

          const diffColors={blue:'#2563EB',red:'#DC2626',black:'#1A1A1A'};
          const stageColor=diffColors[stage.difficulty]||'#2563EB';
          const startEl=document.createElement('div');startEl.innerHTML=`<div style="width:18px;height:18px;transform-origin:center;transition:transform 0.1s ease;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));"><svg width="18" height="18" viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="${stageColor}" stroke="white" stroke-width="2" transform="rotate(45 12 12)"/></svg></div>`;
          new mapboxgl.Marker({element:startEl}).setLngLat([stage.start.lng,stage.start.lat]).addTo(map.current);
          gateMarkersRef.current.push(startEl.firstElementChild);markerStagesRef.current.push({el:startEl,difficulty:stage.difficulty||'blue'});
          const finishEl=document.createElement('div');finishEl.innerHTML='<div style="width:18px;height:18px;border-radius:50%;background:white;border:2px solid #1A1A1A;box-shadow:0 2px 6px rgba(0,0,0,0.3);overflow:hidden;transform-origin:center;transition:transform 0.1s ease;"><svg width="14" height="14" viewBox="0 0 8 8"><rect width="2" height="2" fill="#1A1A1A"/><rect x="4" width="2" height="2" fill="#1A1A1A"/><rect x="2" y="2" width="2" height="2" fill="#1A1A1A"/><rect x="6" y="2" width="2" height="2" fill="#1A1A1A"/><rect y="4" width="2" height="2" fill="#1A1A1A"/><rect x="4" y="4" width="2" height="2" fill="#1A1A1A"/><rect x="2" y="6" width="2" height="2" fill="#1A1A1A"/><rect x="6" y="6" width="2" height="2" fill="#1A1A1A"/></svg></div>';
          new mapboxgl.Marker({element:finishEl}).setLngLat([stage.finish.lng,stage.finish.lat]).addTo(map.current);
          gateMarkersRef.current.push(finishEl.firstElementChild);markerStagesRef.current.push({el:finishEl,difficulty:stage.difficulty||'blue'});

                              let midLat,midLng;
                if(stage.line_coords&&stage.line_coords.length>1){
            const raw=stage.line_coords;
            const coords=[raw[0]];
            for(let i=1;i<raw.length;i++){
              if(haversine(coords[coords.length-1],raw[i])<100){coords.push(raw[i]);}
            }
            if(coords.length<2)coords.push(raw[raw.length-1]);
            let totalLen=0;

            const segLens=[];
            for(let i=0;i<coords.length-1;i++){const d=haversine(coords[i],coords[i+1]);segLens.push(d);totalLen+=d;}
            const halfLen=totalLen/2;
            let acc=0,midPoint=coords[0];
            for(let i=0;i<segLens.length;i++){
              if(acc+segLens[i]>=halfLen){
                const remain=halfLen-acc;
                const frac=segLens[i]>0?remain/segLens[i]:0;
                midPoint={lat:coords[i].lat+(coords[i+1].lat-coords[i].lat)*frac,lng:coords[i].lng+(coords[i+1].lng-coords[i].lng)*frac};
                break;
              }
              acc+=segLens[i];
            }
            midLat=midPoint.lat;
            midLng=midPoint.lng;
          } else {
            midLat=(stage.start.lat+stage.finish.lat)/2;
            midLng=(stage.start.lng+stage.finish.lng)/2;
          }

          midpointFeatures.push({type:'Feature',properties:{stageId:String(stage.id),name:stage.name,difficulty:stage.difficulty||'blue'},geometry:{type:'Point',coordinates:[midLng,midLat]}});

                    if(stage.line_coords&&stage.line_coords.length>1){

            const id='line-'+stage.id;
            map.current.addSource(id,{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:stage.line_coords.map(c=>[c.lng,c.lat])}}});
            map.current.addLayer({id,type:'line',source:id,paint:{'line-color':stageColor,'line-width':3,'line-opacity':0.9}});
          }
        });

        const updateGateMarkerScale=()=>{
          const scale=gateMarkerScale(map.current.getZoom());
          gateMarkersRef.current.forEach(el=>{if(el)el.style.transform=`scale(${scale})`;});
        };
        map.current.on('zoom',updateGateMarkerScale);
        updateGateMarkerScale();

              if(midpointFeatures.length>0){
          map.current.addSource('stage-midpoints',{type:'geojson',data:{type:'FeatureCollection',features:midpointFeatures}});
          map.current.addLayer({id:'stage-midpoints-icon',type:'symbol',source:'stage-midpoints',layout:{'icon-image':'stage-pin','icon-size':['interpolate',['linear'],['zoom'],10,0.35,14,0.55,18,0.85],'icon-anchor':'center','icon-allow-overlap':true,'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],10,9,14,12,18,15],'text-offset':[1.1,0],'text-anchor':'left','text-allow-overlap':true},paint:{'text-color':'#1A1A1A','text-halo-color':'#ffffff','text-halo-width':1.4}});
                    map.current.on('click','stage-midpoints-icon',e=>{
            const stageId=e.features[0].properties.stageId;
            const stage=stages.find(s=>String(s.id)===stageId);
            if(stage&&onStagePressRef.current)onStagePressRef.current(stage);
          });
        }
        applyDiffFilter(diffFilterRef.current);
        // User dot (direction-aware)
        if(userPos){
          const userEl=document.createElement('div');
          userEl.style.cssText='width:34px;height:34px;';
          const inner=document.createElement('div');
          inner.style.cssText='width:100%;height:100%;transition:transform 0.3s ease;';
          inner.innerHTML='<svg width="34" height="34" viewBox="0 0 34 34"><polygon points="17,2 25,17 17,12 9,17" fill="#2563EB" opacity="0.85"/><circle cx="17" cy="17" r="7" fill="#2563EB" stroke="white" stroke-width="3"/></svg>';
          userEl.appendChild(inner);
          userMarkerRef.current=new mapboxgl.Marker({element:userEl}).setLngLat([userPos.lng,userPos.lat]).addTo(map.current);
          userMarkerInnerRef.current=inner;
        }
     
      });
    });
  },[]);
  

    const applyDiffFilter=(f)=>{
    const m=map.current;
    if(!m)return;
    const keys=Object.keys(f||{});
    const show=d=>keys.length===0||!!(f&&f[d||'blue']);
    stages.forEach(s=>{const id='line-'+s.id;if(m.getLayer(id))m.setLayoutProperty(id,'visibility',show(s.difficulty)?'visible':'none');});
    markerStagesRef.current.forEach(x=>{x.el.style.display=show(x.difficulty)?'':'none';});
    if(m.getLayer('stage-midpoints-icon'))m.setFilter('stage-midpoints-icon',keys.length===0?null:['in',['get','difficulty'],['literal',keys]]);
  };
  useEffect(()=>{diffFilterRef.current=diffFilter;applyDiffFilter(diffFilter);},[diffFilter]);
  useEffect(()=>{if(map.current&&flyToTrigger)map.current.flyTo({center:[center.lng,center.lat],zoom:zoom,essential:true});},[flyToTrigger]);

  useEffect(()=>{
    if(!userMarkerRef.current||!userPos)return;
    userMarkerRef.current.setLngLat([userPos.lng,userPos.lat]);
    if(userMarkerInnerRef.current)userMarkerInnerRef.current.style.transform=`rotate(${userHeading||0}deg)`;
  },[userPos,userHeading]);


  return(
    <div style={{position:"absolute",inset:0}}>
      <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet"/>
      <div ref={mapContainer} style={{width:"100%",height:"100%"}}/>
    </div>
  );
}



// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({size=40,url=null}){return <div style={{width:size,height:size,borderRadius:"50%",background:C.surface,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden"}}>{url?<img src={url} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<Icon.User size={size*0.5} color={C.muted}/>}</div>;
}

function SectionBuilderMap({stage,startIdx,endIdx,onTapPoint}){
  const mapContainer=useRef(null);
  const map=useRef(null);
  const onTapPointRef=useRef(onTapPoint);
  useEffect(()=>{onTapPointRef.current=onTapPoint;},[onTapPoint]);
  const coords=stage.line_coords&&stage.line_coords.length>1?stage.line_coords:[stage.start,stage.finish];

  useEffect(()=>{
    if(map.current)return;
    const token=import.meta.env.VITE_MAPBOX_TOKEN;
    if(!token)return;
    import('https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js').then(()=>{
      const mapboxgl=window.mapboxgl;
      mapboxgl.accessToken=token;
      const lats=coords.map(c=>c.lat),lngs=coords.map(c=>c.lng);
      map.current=new mapboxgl.Map({
        container:mapContainer.current,
        style:'mapbox://styles/mapbox/outdoors-v12',
        bounds:[[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],
        fitBoundsOptions:{padding:40},
      });
      map.current.on('load',()=>{
        map.current.addSource('section-line',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:coords.map(c=>[c.lng,c.lat])}}});
        map.current.addLayer({id:'section-line-layer',type:'line',source:'section-line',paint:{'line-color':'#F59E0B','line-width':4,'line-opacity':0.55}});
        map.current.addSource('section-highlight',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]}}});
        map.current.addLayer({id:'section-highlight-layer',type:'line',source:'section-highlight',paint:{'line-color':'#2563EB','line-width':6}});
        map.current.addSource('section-points',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        map.current.addLayer({id:'section-points-layer',type:'circle',source:'section-points',paint:{'circle-radius':7,'circle-color':['get','color'],'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
        map.current.on('click',e=>{onTapPointRef.current({lat:e.lngLat.lat,lng:e.lngLat.lng});});
      });
    });
  },[]);

  useEffect(()=>{
    if(!map.current||!map.current.getSource('section-highlight'))return;
    if(startIdx===null||endIdx===null){
      map.current.getSource('section-highlight').setData({type:'Feature',geometry:{type:'LineString',coordinates:[]}});
    } else {
      const lo=Math.min(startIdx,endIdx),hi=Math.max(startIdx,endIdx);
      map.current.getSource('section-highlight').setData({type:'Feature',geometry:{type:'LineString',coordinates:coords.slice(lo,hi+1).map(c=>[c.lng,c.lat])}});
    }
    const features=[];
    if(startIdx!==null)features.push({type:'Feature',properties:{color:'#15803D'},geometry:{type:'Point',coordinates:[coords[startIdx].lng,coords[startIdx].lat]}});
    if(endIdx!==null)features.push({type:'Feature',properties:{color:'#2563EB'},geometry:{type:'Point',coordinates:[coords[endIdx].lng,coords[endIdx].lat]}});
    if(map.current.getSource('section-points'))map.current.getSource('section-points').setData({type:'FeatureCollection',features});
  },[startIdx,endIdx]);

  return(
    <div style={{position:"relative",width:"100%",height:220,borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`}}>
      <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet"/>
      <div ref={mapContainer} style={{width:"100%",height:"100%"}}/>
    </div>
  );
}

function SectionsSheet({stage,user,onClose}){
  const [sections,setSections]=useState([]);
  const [adding,setAdding]=useState(false);
  const [startIdx,setStartIdx]=useState(null);
  const [endIdx,setEndIdx]=useState(null);
  const [name,setName]=useState("");
  const isCreator=stage.created_by===user.id;
  const coords=stage.line_coords&&stage.line_coords.length>1?stage.line_coords:[stage.start,stage.finish];

  useEffect(()=>{
    supabase.from('stage_sections').select('*').eq('stage_id',stage.id).order('created_at',{ascending:true}).then(({data})=>{if(data)setSections(data);});
  },[stage.id]);

  const bothPlaced=startIdx!==null&&endIdx!==null;
  const loIdx=bothPlaced?Math.min(startIdx,endIdx):null;
  const hiIdx=bothPlaced?Math.max(startIdx,endIdx):null;
  const sectionDist=bothPlaced?(()=>{let d=0;for(let i=loIdx;i<hiIdx;i++){d+=haversine(coords[i],coords[i+1]);}return Math.round(d);})():0;

  const nearestPointIdx=pt=>{let best=0,bestD=Infinity;coords.forEach((c,i)=>{const d=haversine(pt,c);if(d<bestD){bestD=d;best=i;}});return best;};
  const handleTap=pt=>{const idx=nearestPointIdx(pt);if(startIdx===null)setStartIdx(idx);else if(endIdx===null)setEndIdx(idx);};
  const resetPoints=()=>{setStartIdx(null);setEndIdx(null);};

  const saveSection=async()=>{
    if(!name.trim()||!bothPlaced)return;
    const startPt=coords[loIdx],finishPt=coords[hiIdx];
    const{data,error}=await supabase.from('stage_sections').insert({stage_id:stage.id,name:name.trim(),start_lat:startPt.lat,start_lng:startPt.lng,finish_lat:finishPt.lat,finish_lng:finishPt.lng,created_by:user.id}).select().single();
    if(error){alert("Couldn't save section: "+error.message);return;}
    setSections(prev=>[...prev,data]);
    setAdding(false);resetPoints();setName("");
  };

  return(
    <div style={{padding:"0 16px 40px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 16px"}}>
        <div style={{fontSize:17,fontWeight:700,color:C.text}}>Sections</div>
        <button className="tap" onClick={onClose} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 14px",color:C.text,fontSize:13}}>Done</button>
      </div>

      {!adding?(
        <>
          {isCreator&&(
            <button className="tap" onClick={()=>setAdding(true)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"11px",color:C.blue,fontSize:13,fontWeight:600,marginBottom:16}}>
              <Icon.Plus size={14} color={C.blue}/>Add Section
            </button>
          )}
          {sections.length===0?(
            <div style={{textAlign:"center",padding:"24px",color:C.muted,fontSize:13}}>No sections yet{isCreator?" — add a sprint or feature to split this stage up.":"."}</div>
          ):sections.map(s=>(
            <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8}}>
              <div style={{width:32,height:32,borderRadius:8,background:`${C.blue}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.Lightning size={15} color={C.blue}/></div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{s.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:3,fontSize:10,color:C.orange,background:`${C.orange}15`,borderRadius:4,padding:"1px 5px",marginTop:2,width:"fit-content"}}><Icon.Trophy size={9} color="#92400E"/>Leaderboard</div>
              </div>
              <Icon.ChevronRight size={16} color={C.mutedL}/>
            </div>
          ))}
          <div style={{fontSize:11,color:C.mutedL,marginTop:14,textAlign:"center",lineHeight:1.5}}>Section times have their own leaderboard and don't affect your overall stage time.</div>
        </>
      ):(
        <>
          <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{startIdx===null?"Tap the line to place the section start":endIdx===null?"Now tap where the section ends":"Section placed — name it below"}</div>
          <SectionBuilderMap stage={stage} startIdx={startIdx} endIdx={endIdx} onTapPoint={handleTap}/>
          {(startIdx!==null||endIdx!==null)&&(
            <button className="tap" onClick={resetPoints} style={{background:"none",border:"none",color:C.muted,fontSize:12,marginTop:10}}>Reset points</button>
          )}
          {bothPlaced&&(
            <>
              <div style={{textAlign:"center",fontSize:13,color:C.blue,fontWeight:600,margin:"14px 0"}}>Section length: {formatDist(sectionDist)}</div>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Section name e.g. Sprint 2" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,color:C.text,background:C.surface,marginBottom:16}}/>
              <button className="tap" onClick={saveSection} disabled={!name.trim()} style={{width:"100%",background:name.trim()?C.blue:C.surface,border:"none",borderRadius:12,padding:15,color:name.trim()?"#fff":C.muted,fontSize:15,fontWeight:700}}>Save Section</button>
            </>
          )}
           <button className="tap" onClick={()=>{setAdding(false);resetPoints();setName("");}} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:12,padding:13,color:C.muted,fontSize:14,marginTop:10,marginBottom:40}}>Cancel</button>
        </>
      )}
    </div>
  );
}

const PROGRESS_COLORS=["#2563EB","#15803D","#7C3AED","#0891B2","#DB2777"];
const PROGRESS_PLOT_LEFT=70,PROGRESS_PLOT_RIGHT=255,PROGRESS_PLOT_TOP=6,PROGRESS_PLOT_BOTTOM=108,PROGRESS_LABEL_GAP=13;

function resolveLabelCollisions(items){
  const sorted=[...items].sort((a,b)=>a.y-b.y).map(it=>({...it,labelY:it.y}));
  for(let i=1;i<sorted.length;i++){
    if(sorted[i].labelY<sorted[i-1].labelY+PROGRESS_LABEL_GAP)sorted[i].labelY=sorted[i-1].labelY+PROGRESS_LABEL_GAP;
  }
  return sorted;
}

function pbSeriesFromRuns(runs){
  let best=Infinity;const points=[];
  runs.forEach(r=>{if(r.time_ms<best){best=r.time_ms;points.push({time_ms:r.time_ms,date:r.created_at});}});
  return points;
}

// ── Consistency ───────────────────────────────────────────────────────────────
// Score = how close your recent runs are to your best. Uses your last 5 runs on a stage (min 3).
// Average gap to your best, as a % of your best time; 0% off = 100, 15%+ off = 0.
function consistencyLabel(score){return score>=90?"Locked in":score>=75?"Solid":score>=55?"Variable":"Scattered";}
function consistencyColor(score){return score>=90?C.green:score>=75?C.blue:score>=55?C.yellow:C.red;}
function consistencyFromRuns(runs){
  if(!runs||runs.length<3)return null;
  const sorted=[...runs].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const last=sorted.slice(-5).map(r=>r.time_ms);
  const best=Math.min(...last);
  const worst=Math.max(...last);
  const avg=last.reduce((s,t)=>s+t,0)/last.length;
  const avgGapMs=avg-best;
  const score=Math.max(0,Math.min(100,Math.round(100*(1-(avgGapMs/best)/0.15))));
  return{score,label:consistencyLabel(score),avgGapMs,best,avg,worst,runsUsed:last.length,totalRuns:runs.length};
}
const fmtSecs=ms=>(ms/1000).toFixed(1)+"s";
function ConsistencyRing({score,size=54,stroke=5,fontSize=18,label}){
  const r=(size-stroke)/2,c=2*Math.PI*r,color=consistencyColor(score);
  return(
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E6E6E6" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c*score/100} ${c}`}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize,fontWeight:800,color:C.text,lineHeight:1}}>{score}</span>
        {label&&<span style={{fontSize:10,fontWeight:600,color:C.muted,letterSpacing:1,marginTop:4}}>{label}</span>}
      </div>
    </div>
  );
}
function StageConsistencyCard({runs}){
  const [open,setOpen]=useState(false);
  if(!runs||runs.length===0)return null;
  const res=consistencyFromRuns(runs);
  if(!res)return(
    <div style={{margin:"16px 16px 0",background:C.surface,borderRadius:14,padding:"14px 16px",border:`1px solid ${C.border}`,fontSize:13,color:C.muted}}>Ride this stage 3 times to get your consistency score</div>
  );
  const color=consistencyColor(res.score);
  return(
    <div style={{margin:"16px 16px 0",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
      <button className="tap" onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:"none",border:"none",textAlign:"left"}}>
        <ConsistencyRing score={res.score}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:700,color:C.text}}>Consistency</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}><span style={{color,fontWeight:600}}>{res.label}</span> · last {res.runsUsed} runs</div>
        </div>
        <div style={{transform:open?"rotate(180deg)":"none",transition:"transform 0.15s",display:"flex"}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.mutedL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      </button>
      {open&&(
        <div style={{padding:"0 16px 14px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[{l:"Best",v:formatTime(res.best)},{l:"Average",v:formatTime(Math.round(res.avg))},{l:"Slowest",v:formatTime(res.worst)}].map(x=>(
              <div key={x.l} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 6px",textAlign:"center"}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text}}>{x.v}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:2}}>{x.l}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:12,color:C.muted,marginTop:10,lineHeight:1.45}}>Your last {res.runsUsed} runs are {fmtSecs(res.avgGapMs)} off your best on average. Closer to your best every run means a higher score.</div>
        </div>
      )}
    </div>
  );
}

// ── Time delta ────────────────────────────────────────────────────────────────
// Your best vs the fastest rider (or the rider behind you if you hold P1).
// Green + when you're ahead, red - when you're behind. Ring is full at 10% of their time.
function fmtDelta(ms){const s=Math.abs(ms)/1000;if(s<100)return s.toFixed(2);const m=Math.floor(s/60);return`${m}:${String(Math.floor(s%60)).padStart(2,"0")}`;}
function DeltaRing({fraction,color,text,size=54,stroke=5}){
  const r=(size-stroke)/2,c=2*Math.PI*r;
  const f=Math.max(0.04,Math.min(1,fraction));
  return(
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E6E6E6" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap={f>=1?"butt":"round"} strokeDasharray={`${c*f} ${c}`}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:text.length>6?11:text.length>5?12:14,fontWeight:800,color:C.text,letterSpacing:-0.3}}>{text}</div>
    </div>
  );
}

// ── Run traces (GPS path of your best run, saved to the run_traces table) ─────
const TRACE_MAX_POINTS=600;
const PROFILE_N=100;
function compactTrace(samples){
  let s=(samples||[]).filter((p,i,a)=>i===0||p.t>a[i-1].t);
  if(s.length>TRACE_MAX_POINTS){const step=s.length/TRACE_MAX_POINTS;const out=[];for(let i=0;i<TRACE_MAX_POINTS-1;i++)out.push(s[Math.floor(i*step)]);out.push(s[s.length-1]);s=out;}
  return s.map(p=>[Math.round(p.t),+p.lat.toFixed(6),+p.lng.toFixed(6)]);
}
// points: [[t_ms,lat,lng],...] -> time and speed sampled evenly along the distance travelled
function traceProfile(points){
  if(!points||points.length<3)return null;
  const cum=[0];
  for(let i=1;i<points.length;i++)cum.push(cum[i-1]+haversine({lat:points[i-1][1],lng:points[i-1][2]},{lat:points[i][1],lng:points[i][2]}));
  const total=cum[cum.length-1];
  if(total<20)return null;
  const N=PROFILE_N;
  const times=[];
  let j=1;
  for(let k=0;k<=N;k++){
    const d=total*k/N;
    while(j<points.length-1&&cum[j]<d)j++;
    const d0=cum[j-1],d1=cum[j];
    const f=d1>d0?(d-d0)/(d1-d0):0;
    times.push(points[j-1][0]+Math.max(0,Math.min(1,f))*(points[j][0]-points[j-1][0]));
  }
  const span=Math.max(2,Math.round(N*0.05));
  const speeds=times.map((_,k)=>{
    const a=Math.max(0,k-span),b=Math.min(N,k+span);
    const dt=times[b]-times[a];
    return dt>0?((b-a)/N*total)/(dt/1000):0;
  });
  return{total,times,speeds};
}
function niceCeil(v,steps){
  const raw=(v||1)/steps;const mag=Math.pow(10,Math.floor(Math.log10(raw)));const n=raw/mag;
  const step=(n<=1?1:n<=2?2:n<=5?5:10)*mag;
  const max=Math.max(step,Math.ceil(v/step)*step);
  const ticks=[];for(let x=step;x<=max+1e-9;x+=step)ticks.push(Math.round(x*100)/100);
  return{max,ticks};
}
function RunCompareCharts({mine,theirs,name,units}){
  const [idx,setIdx]=useState(null);
  const N=PROFILE_N;
  const imperial=units==="imperial";
  const spd=v=>v*(imperial?2.23694:3.6);
  const spdUnit=imperial?"mph":"km/h",distUnit=imperial?"ft":"m";
  const L=mine.total*(imperial?3.28084:1);
  const mySp=mine.speeds.map(spd),thSp=theirs.speeds.map(spd);
  const gap=mine.times.map((t,k)=>theirs.times[k]-t); // ms, + = you're ahead
  const W=320,H=112,PL=28,PR=6,PT=8,PB=18;
  const x=k=>PL+k/N*(W-PL-PR);
  const spdScale=niceCeil(Math.max(...mySp,...thSp,1),3);
  const ys=v=>PT+(1-v/spdScale.max)*(H-PT-PB);
  const gapM=Math.max(1,Math.ceil(Math.max(...gap.map(g=>Math.abs(g)))/1000));
  const yg=v=>PT+(1-(v+gapM)/(2*gapM))*(H-PT-PB);
  const yZero=yg(0);
  const line=(arr,fy)=>arr.map((v,k)=>`${k?"L":"M"}${x(k).toFixed(1)},${fy(v).toFixed(1)}`).join(" ");
  const gapSecs=gap.map(g=>g/1000);
  const gapLine=line(gapSecs,yg);
  const gapArea=`${gapLine} L${x(N).toFixed(1)},${yZero.toFixed(1)} L${x(0).toFixed(1)},${yZero.toFixed(1)} Z`;
  const finalAhead=gap[N]>=0;
  const gapColor=finalAhead?C.green:C.red;
  const xLabels=[0,1/3,2/3,1].map(f=>({f,t:(f===1?Math.round(L):Math.round(L*f/(L>1000?100:50))*(L>1000?100:50)).toLocaleString()+(f===1?" "+distUnit:"")}));
  const pick=e=>{
    const r=e.currentTarget.getBoundingClientRect();
    const px=(e.clientX-r.left)/r.width*W;
    setIdx(Math.max(0,Math.min(N,Math.round((px-PL)/(W-PL-PR)*N))));
  };
  const handlers={onPointerDown:pick,onPointerMove:e=>{if(e.pointerType==="mouse"&&e.buttons===0)return;pick(e);}};
  const win=Math.round(N*0.15);
  let bestK=0,bestChange=0;
  for(let k=0;k+win<=N;k++){const ch=gap[k+win]-gap[k];if(Math.abs(ch)>Math.abs(bestChange)){bestChange=ch;bestK=k;}}
  const rd=d=>{const step=L>1000?100:50;return Math.round(d/step)*step;};
  const d1=rd(L*bestK/N),d2=rd(L*(bestK+win)/N);
  const insight=Math.abs(bestChange)<300
    ?"Your runs are almost identical, with no single section that stands out."
    :bestChange<0
      ?`${name} pulls away by ${(Math.abs(bestChange)/1000).toFixed(1)}s between ${d1.toLocaleString()} and ${d2.toLocaleString()} ${distUnit}. Look there first.`
      :`You pull away by ${(bestChange/1000).toFixed(1)}s between ${d1.toLocaleString()} and ${d2.toLocaleString()} ${distUnit}. That's where you gain.`;
  const Cursor=({fy,a,b,ca,cb})=>idx===null?null:(
    <g>
      <line x1={x(idx)} x2={x(idx)} y1={PT} y2={H-PB} stroke="#BDBDBD" strokeWidth="1"/>
      {a!==undefined&&<circle cx={x(idx)} cy={fy(a)} r="3.5" fill={ca} stroke="#fff" strokeWidth="1.2"/>}
      {b!==undefined&&<circle cx={x(idx)} cy={fy(b)} r="3.5" fill={cb} stroke="#fff" strokeWidth="1.2"/>}
    </g>
  );
  const lbl={fontSize:9,fill:C.mutedL};
  const hdr={fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8};
  return(
    <div>
      <div style={{display:"flex",gap:16,marginTop:12,fontSize:13,fontWeight:700,color:C.text}}>
        <span style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:16,height:3,borderRadius:2,background:C.blue}}/>You</span>
        <span style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:16,height:3,borderRadius:2,background:"#1A1A1A"}}/>{name}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:14}}><span style={hdr}>SPEED ({spdUnit.toUpperCase()})</span><span style={{fontSize:11,color:C.muted}}>tap to read</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:"block",touchAction:"pan-y",marginTop:4}} {...handlers}>
        {spdScale.ticks.map(t=><g key={t}><line x1={PL} x2={W-PR} y1={ys(t)} y2={ys(t)} stroke="#E6E6E6" strokeDasharray="2 3"/><text x={PL-5} y={ys(t)+3} textAnchor="end" {...lbl}>{t}</text></g>)}
        <line x1={PL} x2={W-PR} y1={ys(0)} y2={ys(0)} stroke="#CFCFCF"/>
        {xLabels.map(l=><text key={l.f} x={l.f===0?PL:l.f===1?W-PR:x(l.f*N)} y={H-4} textAnchor={l.f===0?"start":l.f===1?"end":"middle"} {...lbl}>{l.t}</text>)}
        <path d={line(thSp,ys)} fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        <path d={line(mySp,ys)} fill="none" stroke={C.blue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        <Cursor fy={ys} a={idx===null?undefined:thSp[idx]} b={idx===null?undefined:mySp[idx]} ca="#1A1A1A" cb={C.blue}/>
      </svg>
      <div style={{marginTop:8,padding:"10px 12px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,fontSize:13,color:idx===null?C.mutedL:C.text,lineHeight:1.5}}>
        {idx===null?"Tap or drag a chart to compare at any point":<>{Math.round(L*idx/N).toLocaleString()} {distUnit} · You <b style={{color:C.blue}}>{mySp[idx].toFixed(1)} {spdUnit}</b> · {name} <b>{thSp[idx].toFixed(1)} {spdUnit}</b> · <b style={{color:gap[idx]>=0?C.green:C.red}}>{(Math.abs(gap[idx])/1000).toFixed(2)}s {gap[idx]>=0?"ahead":"behind"}</b></>}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:16}}><span style={hdr}>GAP TO {name.toUpperCase()}</span><span style={{fontSize:11,color:C.muted}}>up = you're ahead</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:"block",touchAction:"pan-y",marginTop:4}} {...handlers}>
        <defs>
          <clipPath id="gapAboveClip"><rect x={PL} y={0} width={W-PL-PR} height={yZero}/></clipPath>
          <clipPath id="gapBelowClip"><rect x={PL} y={yZero} width={W-PL-PR} height={H-yZero}/></clipPath>
        </defs>
        {[gapM,0,-gapM].map(t=><g key={t}><line x1={PL} x2={W-PR} y1={yg(t)} y2={yg(t)} stroke={t===0?"#CFCFCF":"#E6E6E6"} strokeDasharray={t===0?undefined:"2 3"}/><text x={PL-5} y={yg(t)+3} textAnchor="end" {...lbl}>{t>0?"+"+t:t}s</text></g>)}
        {xLabels.map(l=><text key={l.f} x={l.f===0?PL:l.f===1?W-PR:x(l.f*N)} y={H-4} textAnchor={l.f===0?"start":l.f===1?"end":"middle"} {...lbl}>{l.t}</text>)}
        <path d={gapArea} fill={`${C.green}30`} clipPath="url(#gapAboveClip)"/>
        <path d={gapArea} fill={`${C.red}30`} clipPath="url(#gapBelowClip)"/>
        <path d={gapLine} fill="none" stroke={gapColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        <Cursor fy={yg} a={idx===null?undefined:gapSecs[idx]} ca={gapColor}/>
      </svg>
      <div style={{marginTop:8,padding:"10px 12px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,fontSize:13,color:C.text,lineHeight:1.5}}>{insight}</div>
    </div>
  );
}
function StageTimeDeltaCard({stage,lb,myAttempts,user,units}){
  const [open,setOpen]=useState(false);
  const [traces,setTraces]=useState(undefined); // undefined = loading, null = unavailable
  const haveRuns=!!(user&&myAttempts&&myAttempts.length>0&&lb&&lb.length>0);
  const target=haveRuns?(lb[0].user_id===user.id?lb[1]:lb[0]):null;
  const targetId=target?target.user_id:null;
  const myId=user?user.id:null;
  useEffect(()=>{
    if(!open||!myId||!targetId)return;
    let cancelled=false;
    supabase.from('run_traces').select('user_id,time_ms,points').eq('stage_id',String(stage.id)).in('user_id',[myId,targetId]).then(({data,error})=>{
      if(cancelled)return;
      if(error||!data){setTraces(null);return;}
      const by={};data.forEach(r=>{by[r.user_id]=r;});
      setTraces(by);
    });
    return()=>{cancelled=true;};
  },[open,stage.id,myId,targetId]);
  if(!haveRuns||!target)return null;
  const myBest=Math.min(...myAttempts.map(a=>a.time_ms));
  const delta=target.time-myBest; // + = you're ahead
  const ahead=delta>0,level=delta===0;
  const color=level?C.muted:ahead?C.green:C.red;
  const fraction=Math.abs(delta)/target.time/0.10;
  const text=level?"0.00":(ahead?"+":"-")+fmtDelta(delta);
  // only use a trace if it belongs to that rider's current best run
  const prof=(row,best)=>row&&Math.abs(row.time_ms-best)<=1?traceProfile(row.points):null;
  const mineProf=traces?prof(traces[myId],myBest):null;
  const theirProf=traces?prof(traces[targetId],target.time):null;
  return(
    <div style={{margin:"16px 16px 0",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
      <button className="tap" onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:"none",border:"none",textAlign:"left"}}>
        <DeltaRing fraction={level?0:fraction} color={color} text={text}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:700,color:C.text}}>Time delta</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>vs {target.name} · P{target.pos}</div>
        </div>
        <div style={{transform:open?"rotate(180deg)":"none",transition:"transform 0.15s",display:"flex"}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.mutedL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      </button>
      {open&&(
        <div style={{padding:"0 16px 14px"}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,marginBottom:8}}>COMPARING WITH</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 14px"}}>
            <span style={{fontSize:14,fontWeight:700,color:C.text}}>{target.name}</span>
            <span style={{fontSize:15,fontWeight:800,color:C.text}}>{formatTime(target.time)}</span>
          </div>
          <div style={{fontSize:18,fontWeight:800,color,marginTop:14}}>{level?`Level with ${target.name}`:`${fmtDelta(delta)}s ${ahead?"ahead of":"behind"} ${target.name}`}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4,lineHeight:1.45}}>Your best run compared with {target.name}'s fastest time on this stage.</div>
          {traces===undefined?<div style={{fontSize:12,color:C.mutedL,marginTop:14}}>Loading speed data…</div>
            :mineProf&&theirProf?<RunCompareCharts mine={mineProf} theirs={theirProf} name={target.name} units={units}/>
            :<div style={{fontSize:12,color:C.muted,marginTop:14,padding:"10px 12px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,lineHeight:1.5}}>
              {!mineProf&&!theirProf?`Speed and gap charts appear once you and ${target.name} have both set a best on this stage with GPS recording. Beat your best to record yours.`
                :!mineProf?"Beat your best time on this stage to record your speed data and unlock the charts."
                :`No speed data for ${target.name}'s best run yet. The charts appear once they set a new best.`}
            </div>}
        </div>
      )}
    </div>
  );
}

function StageProgressCard({stage,user,lb,myAttempts}){
  const [view,setView]=useState('you');
  const [topSeries,setTopSeries]=useState(null);
  const [tappedIdx,setTappedIdx]=useState(null);

  const top5Ids=useMemo(()=>(lb||[]).slice(0,5).map(e=>e.user_id).join(','),[lb]);

  useEffect(()=>{
    const top5=(lb||[]).slice(0,5);
    if(top5.length===0){setTopSeries([]);return;}
    const userIds=top5.map(e=>e.user_id);
    supabase.from('stage_times').select('user_id,time_ms,created_at').eq('stage_id',stage.id).in('user_id',userIds).order('created_at',{ascending:true}).then(({data})=>{
      if(!data)return;
      const byUser={};
      data.forEach(t=>{(byUser[t.user_id]=byUser[t.user_id]||[]).push(t);});
      setTopSeries(top5.map((e,i)=>{
        const isYou=user&&e.user_id===user.id;
        return{user_id:e.user_id,name:isYou?'You':e.name,color:isYou?C.orange:PROGRESS_COLORS[i%PROGRESS_COLORS.length],points:pbSeriesFromRuns(byUser[e.user_id]||[])};
      }).filter(r=>r.points.length>0));
    });
  },[top5Ids,stage.id]);

  if((!myAttempts||myAttempts.length===0)&&(!lb||lb.length===0))return null;

  const Header=(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontSize:14,fontWeight:700,color:C.text}}>Progress</div>
      <SegControl options={[{val:'you',label:'You'},{val:'top5',label:'Top 5'}]} value={view} onChange={v=>{setView(v);setTappedIdx(null);}}/>
    </div>
  );

  if(view==='you'){
    if(!myAttempts||myAttempts.length<2)return(
      <div style={{margin:"16px 16px 0",background:"#fff",borderRadius:12,padding:"14px",border:`1px solid ${C.border}`}}>
        {Header}
        <div style={{textAlign:"center",padding:"20px",color:C.mutedL,fontSize:13}}>Ride this stage again to see your progress</div>
      </div>
    );
    const W=320,H=100,PAD=10;
    const times=myAttempts.map(a=>a.time_ms);
    const min=Math.min(...times),max=Math.max(...times);
    const range=max-min||1;
    const pts=myAttempts.map((a,i)=>({
      x:PAD+(i/((myAttempts.length-1)||1))*(W-PAD*2),
      y:PAD+((a.time_ms-min)/range)*(H-PAD*2),
      time_ms:a.time_ms,
      date:a.created_at
    }));
    const path=pts.map((p,i)=>`${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
    return(
      <div style={{margin:"16px 16px 0",background:"#fff",borderRadius:12,padding:"14px",border:`1px solid ${C.border}`}}>
        {Header}
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{overflow:"visible"}}>
          <path d={path} fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          {pts.map((p,i)=>{
            const active=tappedIdx===i;
            return(
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={active?6:i===pts.length-1?4:2.5} fill={active||i===pts.length-1?C.blue:"#fff"} stroke={C.blue} strokeWidth="1.5"/>
                <circle cx={p.x} cy={p.y} r="10" fill="transparent" style={{cursor:"pointer"}} onClick={()=>setTappedIdx(active?null:i)}/>
              </g>
            );
          })}
        </svg>
                <div style={{marginTop:10,padding:"10px 12px",background:C.surface,borderRadius:8,fontSize:12,color:tappedIdx!==null?C.text:C.mutedL}}>
          {tappedIdx!==null
            ?<>{new Date(pts[tappedIdx].date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})} &middot; <span style={{fontWeight:800}}>{formatTime(pts[tappedIdx].time_ms)}</span></>
            :"Tap a point to see that run"}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
          <div style={{fontSize:10,color:C.mutedL}}>First: {formatTime(myAttempts[0].time_ms)}</div>
          <div style={{fontSize:10,color:C.mutedL}}>Latest: {formatTime(myAttempts[myAttempts.length-1].time_ms)}</div>
        </div>
      </div>
    );
  }

  if(topSeries===null)return(
    <div style={{margin:"16px 16px 0",background:"#fff",borderRadius:12,padding:"14px",border:`1px solid ${C.border}`}}>
      {Header}
      <div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>Loading…</div>
    </div>
  );

  const allPoints=topSeries.flatMap(s=>s.points);
  if(allPoints.length===0)return(
    <div style={{margin:"16px 16px 0",background:"#fff",borderRadius:12,padding:"14px",border:`1px solid ${C.border}`}}>
      {Header}
      <div style={{textAlign:"center",padding:"20px",color:C.mutedL,fontSize:13}}>Nothing here yet</div>
    </div>
  );

    const dates=allPoints.map(p=>new Date(p.date).getTime());
  const minDate=Math.min(...dates),maxDate=Math.max(...dates,Date.now());
  const recentTimes=topSeries.filter(s=>s.points.length>0).map(s=>s.points[s.points.length-1].time_ms);
  let domMin=Math.min(...recentTimes),domMax=Math.max(...recentTimes);
  if(domMax===domMin){domMin-=1000;domMax+=1000;}
  const domPad=(domMax-domMin)*0.6;
  domMin-=domPad;domMax+=domPad;
  const xScale=d=>PROGRESS_PLOT_LEFT+(maxDate===minDate?(PROGRESS_PLOT_RIGHT-PROGRESS_PLOT_LEFT)/2:((new Date(d).getTime()-minDate)/(maxDate-minDate))*(PROGRESS_PLOT_RIGHT-PROGRESS_PLOT_LEFT));
  const yScale=t=>{const clamped=Math.min(Math.max(t,domMin),domMax);return PROGRESS_PLOT_TOP+((clamped-domMin)/(domMax-domMin))*(PROGRESS_PLOT_BOTTOM-PROGRESS_PLOT_TOP);};
  const isClamped=t=>t>domMax||t<domMin;
  const buildPath=(points)=>{
    if(points.length===0)return "";
    let d=`M${xScale(points[0].date)},${yScale(points[0].time_ms)}`;
    for(let i=1;i<points.length;i++){
      d+=` L${xScale(points[i].date)},${yScale(points[i-1].time_ms)} L${xScale(points[i].date)},${yScale(points[i].time_ms)}`;
    }
    d+=` L${PROGRESS_PLOT_RIGHT},${yScale(points[points.length-1].time_ms)}`;
    return d;
  };

  const tickCount=6;
  const ticks=Array.from({length:tickCount},(_,i)=>minDate+(maxDate-minDate)*(i/(tickCount-1)));
  const rightLabels=resolveLabelCollisions(topSeries.filter(s=>s.points.length>0).map(s=>({key:s.user_id,y:yScale(s.points[s.points.length-1].time_ms),color:s.color,label:formatTime(s.points[s.points.length-1].time_ms),isYou:s.name==='You'})));
  const leftLabels=resolveLabelCollisions(topSeries.filter(s=>s.points.length>0).map(s=>({key:s.user_id+'_l',y:yScale(s.points[0].time_ms),color:s.color,label:s.name})));

  return(
    <div style={{margin:"16px 16px 0",background:"#fff",borderRadius:12,padding:"14px",border:`1px solid ${C.border}`}}>
      {Header}
      <svg viewBox="0 0 340 130" width="100%" height="130">
        {ticks.map((t,i)=>(
          <line key={i} x1={xScale(t)} y1={PROGRESS_PLOT_TOP} x2={xScale(t)} y2={PROGRESS_PLOT_BOTTOM} stroke="#EDEDED" strokeWidth="1" strokeDasharray="2,3"/>
        ))}
                {topSeries.map(s=>s.points.length>0&&(
          <path key={s.user_id} d={buildPath(s.points)} fill="none" stroke={s.color} strokeWidth={s.name==='You'?2.5:1.5} strokeLinecap="round" strokeLinejoin="round" opacity={s.name==='You'?1:0.85}/>
        ))}
        {topSeries.map(s=>{
          if(s.points.length===0||!isClamped(s.points[0].time_ms))return null;
          const x=xScale(s.points[0].date);
          return <line key={s.user_id+'_stub'} x1={x} y1={PROGRESS_PLOT_BOTTOM} x2={x} y2={PROGRESS_PLOT_BOTTOM-6} stroke={s.color} strokeWidth="1.5" strokeDasharray="1,2.5" opacity="0.5"/>;
        })}
        {topSeries.map(s=>s.points.length>0&&(
          <circle key={s.user_id+'_dot'} cx={PROGRESS_PLOT_RIGHT} cy={yScale(s.points[s.points.length-1].time_ms)} r={s.name==='You'?3:2.5} fill={s.color}/>
        ))}
        {rightLabels.map(l=>(
          <g key={l.key}>
            {Math.abs(l.labelY-l.y)>3&&<line x1={PROGRESS_PLOT_RIGHT+1} y1={l.y} x2={PROGRESS_PLOT_RIGHT+4} y2={l.labelY} stroke={l.color} strokeWidth="1" opacity="0.4"/>}
            <text x={PROGRESS_PLOT_RIGHT+6} y={l.labelY+3} fontSize={l.isYou?11:10} fontWeight={l.isYou?800:700} fill={l.color}>{l.label}</text>
          </g>
        ))}
        {leftLabels.map(l=>(
          <text key={l.key} x={PROGRESS_PLOT_LEFT-8} y={l.labelY+4} fontSize="11" fontWeight={l.label==='You'?700:500} fill={l.color} textAnchor="end">{l.label}</text>
        ))}
        {ticks.map((t,i)=>(
          <text key={'tick'+i} x={xScale(t)} y={122} fontSize="9" fill="#C4C4C4" textAnchor={i===0?"start":i===ticks.length-1?"end":"middle"}>{new Date(t).toLocaleDateString('en-GB',{month:'short'})}</text>
        ))}
      </svg>
    </div>
  );
}


// ── Stage Detail Sheet ────────────────────────────────────────────────────────
// ── Improvement ───────────────────────────────────────────────────────────────
// Small shared pieces used by the Improvement tile and screen
function InsightRing({pct,color,size=54,r,stroke=5,children}){
  const rr=r||(size-stroke)/2,c=2*Math.PI*rr,f=pct>0?Math.max(0.03,Math.min(1,pct)):0;
  return(
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={rr} fill="none" stroke="#E6E6E6" strokeWidth={stroke}/>
        {f>0&&<circle cx={size/2} cy={size/2} r={rr} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c*f} ${c}`}/>}
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center"}}>{children}</div>
    </div>
  );
}
function InsightTile({open,onToggle,title,sub,ring,children}){
  return(
    <div style={{margin:"16px 16px 0",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
      <button className="tap" onClick={onToggle} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:"none",border:"none",textAlign:"left"}}>
        {ring}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:700,color:C.text}}>{title}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{sub}</div>
        </div>
        <div style={{transform:open?"rotate(180deg)":"none",transition:"transform 0.15s",display:"flex"}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.mutedL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
      </button>
      {open&&<div style={{padding:"0 16px 14px"}}>{children}</div>}
    </div>
  );
}
const MiniLabel=({children})=><div style={{fontSize:10,fontWeight:600,color:C.muted,letterSpacing:0.8}}>{children}</div>;
const TipBox=({children})=><div style={{marginTop:12,padding:"10px 12px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,fontSize:13,color:C.text,lineHeight:1.5}}>{children}</div>;

// --- Improvement maths ---
const fmtPct=v=>(v>=0?'+':'-')+Math.abs(v).toFixed(1)+'%';
const fmtShort=ms=>Math.floor(ms/60000)+':'+String(Math.round((ms%60000)/1000)).padStart(2,'0');
const monthIndex=d=>{const x=new Date(d);return x.getFullYear()*12+x.getMonth();};
const monthName=(idx,style='long')=>{const n=new Date(Math.floor(idx/12),idx%12,1).toLocaleDateString('en-GB',{month:'long'});return style==='short'?n.slice(0,3):n;};

// This calendar month vs last calendar month (average run time). Needs 2+ runs in each month.
function calcImprovement(runs,now=new Date()){
  if(!runs)return null;
  const cur=monthIndex(now),prev=cur-1;
  const a=runs.filter(r=>monthIndex(r.created_at)===prev);
  const b=runs.filter(r=>monthIndex(r.created_at)===cur);
  if(a.length<2||b.length<2)return null;
  const avg=arr=>arr.reduce((s,r)=>s+r.time_ms,0)/arr.length;
  const bestOf=arr=>Math.min(...arr.map(r=>r.time_ms));
  const pa=avg(a),ca=avg(b);
  return{prevAvg:pa,curAvg:ca,prevBest:bestOf(a),curBest:bestOf(b),prevRuns:a,curRuns:b,prevCount:a.length,curCount:b.length,
    diffMs:pa-ca,pct:((pa-ca)/pa)*100,
    prevLong:monthName(prev),curLong:monthName(cur),prevShort:monthName(prev,'short'),curShort:monthName(cur,'short')};
}

// --- Improvement stage-sheet card ---
function StageImprovementCard({myAttempts,defaultOpen=false}){
  const [open,setOpen]=useState(defaultOpen);
  const im=calcImprovement(myAttempts);
  if(!im){
    if(!myAttempts||myAttempts.length===0)return null;
    const cur=monthIndex(new Date()),prev=cur-1;
    const nCur=myAttempts.filter(r=>monthIndex(r.created_at)===cur).length,nPrev=myAttempts.filter(r=>monthIndex(r.created_at)===prev).length;
    return(
      <InsightTile
        open={open} onToggle={()=>setOpen(o=>!o)} title="Improvement" sub="Needs 2+ runs in both months"
        ring={<InsightRing pct={0} color={C.green}><span style={{fontSize:11,fontWeight:800,color:C.text}}>–</span></InsightRing>}>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>You've ridden this stage {nCur} time{nCur===1?'':'s'} in {monthName(cur)} and {nPrev} in {monthName(prev)}. Ride it at least twice in each month to see how your average run is changing.</div>
      </InsightTile>
    );
  }
  const up=im.diffMs>=0,color=up?C.green:C.red;
  const ringPct=Math.min(1,Math.abs(im.pct)/3);
  const all=[...im.prevRuns,...im.curRuns].map(r=>r.time_ms);
  const mn=Math.min(...all),mx=Math.max(...all),pad=Math.max(1000,(mx-mn)*0.15);
  const lo=mn-pad,hi=mx+pad,XL=34,XR=312;
  const xs=t=>XL+((t-lo)/(hi-lo))*(XR-XL);
  const ticks=[lo,(lo+hi)/2,hi];
  const xa=xs(im.prevAvg),xb=xs(im.curAvg);
  const bestDrop=(Math.min(...im.prevRuns.map(r=>r.time_ms))-Math.min(...im.curRuns.map(r=>r.time_ms)))/1000;
  const tip=`You rode ${im.curCount} times in ${im.curLong} against ${im.prevCount} in ${im.prevLong}, and your best ${bestDrop>=0?'dropped by ':'is '}${Math.abs(bestDrop).toFixed(1)}s${bestDrop>=0?'.':' slower.'}`;
  const card=(name,avg,best,count)=>(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12}}>
      <MiniLabel>{name.toUpperCase()}</MiniLabel>
      <div style={{fontSize:18,fontWeight:800,marginTop:6,color:C.text}}>{formatTime(Math.round(avg))}</div>
      <div style={{fontSize:11,color:C.muted,marginTop:2}}>average run</div>
      <div style={{fontSize:11,color:C.muted,marginTop:6}}>Best {formatTime(best)} &middot; {count} runs</div>
    </div>
  );
  return(
    <InsightTile
      open={open} onToggle={()=>setOpen(o=>!o)} title="Improvement" sub={`${im.curLong} vs ${im.prevLong}`}
      ring={<InsightRing pct={ringPct} color={color}><span style={{fontSize:11,letterSpacing:-0.4,fontWeight:800,color:C.text}}>{fmtPct(im.pct)}</span></InsightRing>}>
      <div style={{fontSize:17,fontWeight:800,color}}>{Math.abs(im.diffMs/1000).toFixed(1)}s {up?'faster':'slower'} than {im.prevLong}</div>
      <div style={{fontSize:12,color:C.muted,lineHeight:1.45,marginTop:6}}>Your average run in {im.curLong} against your average run in {im.prevLong}.</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,marginTop:12}}>
        {card(im.prevLong,im.prevAvg,im.prevBest,im.prevCount)}
        {card(im.curLong,im.curAvg,im.curBest,im.curCount)}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:16,marginBottom:4}}>
        <MiniLabel>EVERY RUN, BY MONTH</MiniLabel><div style={{fontSize:10,color:C.muted}}>left = faster</div>
      </div>
      <svg viewBox="0 0 320 112" width="100%" height="112" style={{display:"block"}}>
        <line x1={XL} y1="32" x2={XR} y2="32" stroke="#EDEDED" strokeWidth="1"/>
        <line x1={XL} y1="82" x2={XR} y2="82" stroke="#EDEDED" strokeWidth="1"/>
        <text x="28" y="35" fill={C.muted} fontSize="9" textAnchor="end">{im.prevShort}</text>
        <text x="28" y="85" fill={C.muted} fontSize="9" textAnchor="end">{im.curShort}</text>
        <line x1={xa} y1="57" x2={xb} y2="57" stroke={color} strokeWidth="2" strokeLinecap="round"/>
        <text x={(xa+xb)/2} y="49" fill={color} fontSize="10" fontWeight="700" textAnchor="middle">{(up?'-':'+')+Math.abs(im.diffMs/1000).toFixed(1)+'s'}</text>
        {im.prevRuns.map((r,i)=><circle key={'p'+i} cx={xs(r.time_ms)} cy="32" r="4.5" fill="#9CA3AF" stroke="#fff" strokeWidth="1.5"/>)}
        {im.curRuns.map((r,i)=><circle key={'c'+i} cx={xs(r.time_ms)} cy="82" r="4.5" fill={C.blue} stroke="#fff" strokeWidth="1.5"/>)}
        <rect x={xa-1} y="22" width="2" height="20" rx="1" fill={C.text}/>
        <rect x={xb-1} y="72" width="2" height="20" rx="1" fill={C.text}/>
        {ticks.map((t,i)=><text key={i} x={xs(t)} y="108" fill="#C4C4C4" fontSize="9" textAnchor={i===0?"start":i===2?"end":"middle"}>{fmtShort(t)}</text>)}
      </svg>
      <div style={{fontSize:10,color:C.mutedL,marginTop:4,textAlign:"center"}}>dots = your runs &middot; bar = month average</div>
      <TipBox>{tip}</TipBox>
    </InsightTile>
  );
}

// --- Improvement Statistics pieces ---
function improvementRows(grouped,stages){
  if(!grouped)return null;
  const cur=monthIndex(new Date());
  return Object.keys(grouped).map(id=>{
    const stage=stages.find(s=>String(s.id)===String(id));
    if(!stage)return null;
    const im=calcImprovement(grouped[id]);
    const runsThisMonth=grouped[id].filter(r=>monthIndex(r.created_at)===cur).length;
    if(!im&&runsThisMonth===0)return null;
    return{stage,im,runsThisMonth};
  }).filter(Boolean);
}

function InsightHubTile({ring,title,sub,onClick}){
  return(
    <button className="tap" onClick={onClick} style={{display:"flex",alignItems:"center",gap:16,background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"18px 16px",marginTop:12,width:"100%",textAlign:"left"}}>
      {ring}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text}}>{title}</div>
        <div style={{fontSize:12,color:C.muted,marginTop:4}}>{sub}</div>
      </div>
      <Icon.ChevronRight size={16} color={C.mutedL}/>
    </button>
  );
}

function ImprovementHubTile({rows,onClick}){
  const scored=rows?rows.filter(r=>r.im):[];
  if(rows===null||scored.length===0)return <InsightHubTile onClick={onClick} title="Improvement" sub={rows===null?"Loading…":"Needs 2+ runs in both months"} ring={<InsightRing pct={0} color={C.green}><span style={{fontSize:11,fontWeight:800,color:C.text}}>–</span></InsightRing>}/>;
  const overall=scored.reduce((a,r)=>a+r.im.pct,0)/scored.length;
  const up=overall>=0;
  const ex=scored[0].im;
  return <InsightHubTile onClick={onClick} title="Improvement" sub={`${up?'Faster':'Slower'} · ${ex.curShort} vs ${ex.prevShort}`} ring={<InsightRing pct={Math.min(1,Math.abs(overall)/3)} color={up?C.green:C.red}><span style={{fontSize:11,letterSpacing:-0.4,fontWeight:800,color:C.text}}>{fmtPct(overall)}</span></InsightRing>}/>;
}

const EmptyNote=({children})=><div style={{textAlign:"center",padding:"40px 20px",color:C.muted,fontSize:13}}>{children}</div>;
const StageDiamond=({stage})=><DifficultyDiamond color={(DIFFICULTIES.find(d=>d.val===(stage.difficulty||'blue'))||DIFFICULTIES[0]).color} size={16}/>;

function ImprovementScreen({rows}){
  const [sort,setSort]=useState('best');
  const [explain,setExplain]=useState(false);
  if(rows===null)return <EmptyNote>Loading…</EmptyNote>;
  const scored=rows.filter(r=>r.im);
  if(scored.length===0)return <EmptyNote>Ride the same stage at least twice this month and twice last month to see your improvement here.</EmptyNote>;
  const overall=scored.reduce((a,r)=>a+r.im.pct,0)/scored.length;
  const up=overall>=0,oColor=up?C.green:C.red;
  const byPct=scored.slice().sort((a,b)=>b.im.pct-a.im.pct);
  const top=byPct[0],low=byPct[byPct.length-1];
  const ordered=scored.slice().sort((a,b)=>sort==='best'?b.im.pct-a.im.pct:a.im.pct-b.im.pct).concat(rows.filter(r=>!r.im));
  const ex=scored[0].im;
  return(
    <div>
      <div style={{padding:"24px 16px 20px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
        <div style={{margin:"0 auto",width:132}}>
          <InsightRing size={132} r={56} stroke={10} pct={Math.min(1,Math.abs(overall)/3)} color={oColor}>
            <div><div style={{fontSize:28,fontWeight:800,lineHeight:1,color:C.text}}>{fmtPct(overall)}</div><div style={{fontSize:10,fontWeight:600,color:C.muted,marginTop:6,letterSpacing:0.6}}>{ex.curShort.toUpperCase()} VS {ex.prevShort.toUpperCase()}</div></div>
          </InsightRing>
        </div>
        <div style={{fontSize:20,fontWeight:800,color:oColor,marginTop:14}}>{up?'Getting faster':'Slowing down'}</div>
        <div style={{fontSize:13,color:C.muted,marginTop:4,lineHeight:1.45}}>Your average run this month against last month, across {scored.length} stage{scored.length===1?'':'s'} you rode in both.</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,padding:"16px 16px 0"}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12}}><MiniLabel>MOST IMPROVED</MiniLabel><div style={{fontSize:14,fontWeight:700,marginTop:6,color:C.text}}>{top.stage.name}</div><div style={{fontSize:12,color:top.im.pct>=0?C.green:C.red,fontWeight:600,marginTop:2}}>{fmtPct(top.im.pct)}</div></div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12}}><MiniLabel>{low.im.pct<0?'SLIPPING':'LEAST IMPROVED'}</MiniLabel><div style={{fontSize:14,fontWeight:700,marginTop:6,color:C.text}}>{low.stage.name}</div><div style={{fontSize:12,color:low.im.pct<0?C.red:C.yellow,fontWeight:600,marginTop:2}}>{fmtPct(low.im.pct)}</div></div>
      </div>
      <div style={{padding:"20px 16px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase"}}>By stage</div>
          <button onClick={()=>setSort(s=>s==='best'?'worst':'best')} style={{background:"none",border:"none",padding:0,fontSize:12,fontWeight:600,color:C.blue}}>Sort: {sort==='best'?'Most improved':'Least improved'} ▾</button>
        </div>
        {ordered.map(({stage,im,runsThisMonth})=>{
          const steady=im&&Math.abs(im.pct)<0.5,upS=im&&im.pct>=0;
          const col=!im?C.mutedL:steady?C.muted:upS?C.green:C.red;
          const w=im?Math.min(50,(Math.abs(im.pct)/4)*50):0;
          return(
            <div key={stage.id} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <StageDiamond stage={stage}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stage.name}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:1}}>{im?`${im.curCount} runs this month · avg ${Math.abs(im.diffMs/1000).toFixed(1)}s ${upS?'faster':'slower'}`:'Needs 2+ runs in both months'}</div>
                </div>
                <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:col}}>{im?fmtPct(im.pct):'-'}</div><div style={{fontSize:10,fontWeight:600,color:col}}>{!im?'Not enough runs':steady?'Steady':upS?'Faster':'Slower'}</div></div>
              </div>
              <div style={{position:"relative",height:4,background:"#F0F0F0",borderRadius:2,marginTop:9}}>
                <div style={{position:"absolute",top:0,left:`${im&&!upS?50-w:50}%`,width:`${w}%`,height:4,background:col,borderRadius:2}}/>
                <div style={{position:"absolute",top:-2,left:"50%",width:1,height:8,background:C.mutedL}}/>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{margin:"20px 16px 24px",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
        <button onClick={()=>setExplain(e=>!e)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 14px",background:"#fff",border:"none",textAlign:"left",fontSize:14,fontWeight:600,color:C.text}}>How it's measured<span style={{color:C.muted,fontSize:12}}>{explain?'Hide':'Show'}</span></button>
        {explain&&<div style={{padding:"0 14px 14px",background:C.surface,fontSize:12,lineHeight:1.55,color:C.text}}>
          <div style={{paddingTop:12}}>We take your average run time on a stage this calendar month and compare it with your average last month.</div>
          <div style={{marginTop:8}}>The percentage is how much quicker (or slower) that average is. Using percentages lets short and long stages be compared fairly.</div>
          <div style={{marginTop:10,color:C.muted}}>Needs at least 2 runs on the stage in each month to count.</div>
        </div>}
      </div>
    </div>
  );
}

// ── Leaderboard wedge (stage sheet) ───────────────────────────────────────────
function StageLeaderboardCard({lb,rank,user}){
  const [open,setOpen]=useState(false);
  const r=22,circ=2*Math.PI*r;
  const frac=rank.myPos&&rank.total?Math.max(0,Math.min(1,(rank.total-rank.myPos+1)/rank.total)):0;
  const lead=lb[0];
  const leadMe=!!(lead&&user&&lead.user_id===user.id);
  const sub=lead?`${leadMe?"You lead":lead.name+" leads"} · ${formatTime(lead.time)}`:"No times yet";
  const centre=rank.myPos?`P${rank.myPos}`:"–";
  return(
    <div style={{margin:"16px 16px 0",background:C.surface,borderRadius:16,border:`1px solid ${C.border}`,overflow:"hidden"}}>
      <button className="tap" onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",gap:16,padding:"18px 16px",background:C.surface,border:"none",textAlign:"left"}}>
        <div style={{position:"relative",width:56,height:56,flexShrink:0}}>
          <svg width="56" height="56" viewBox="0 0 56 56" style={{transform:"rotate(-90deg)"}}>
            <circle cx="28" cy="28" r={r} fill="none" stroke={C.border} strokeWidth="6"/>
            <circle cx="28" cy="28" r={r} fill="none" stroke={frac>0?C.orange:"transparent"} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(frac*circ).toFixed(1)} ${circ.toFixed(1)}`}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:rank.myPos>=100?12:17,fontWeight:800,letterSpacing:-0.5,color:C.text}}>{centre}</div>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>Leaderboard</div>
          <div style={{fontSize:12,color:C.muted,marginTop:4}}>{sub}</div>
        </div>
        {open?<Icon.ChevronUp size={16} color={C.mutedL}/>:<Icon.ChevronDown size={16} color={C.mutedL}/>}
      </button>
      {open&&(
        <div style={{padding:"14px 14px 8px",borderTop:`1px solid ${C.border}`,background:"#fff"}}>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
            <div style={{fontSize:11,color:C.muted,background:C.surface,borderRadius:6,padding:"3px 8px",border:`1px solid ${C.border}`}}>Free · Top 10</div>
          </div>
          {lb.length===0?<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>No times yet — be the first!</div>:lb.map((entry,i)=>{
            const isMe=!!(user&&entry.user_id===user.id);
            const gap=i===0?0:entry.time-lb[0].time;
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 12px",background:isMe?C.orangeL:"white",borderRadius:10,marginBottom:6,border:`1px solid ${isMe?C.orange:C.border}`}}>
                <div style={{width:34}}><PositionBadge pos={entry.pos} size={30}/></div>
                <Avatar size={32} url={entry.avatarUrl}/>
                <div style={{flex:1}}><div style={{fontSize:13,fontWeight:isMe?700:500,color:C.text}}>{isMe?"You":entry.name}</div><div style={{fontSize:11,color:C.muted}}>{entry.date}</div></div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:15,fontWeight:700,color:isMe?C.orange:C.text}}>{formatTime(entry.time)}</div>
                  {gap>0&&<div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:3,marginTop:2}}><svg width="7" height="7" viewBox="0 0 10 10"><path d="M1 1 L9 1 L5 9 Z" fill={C.muted}/></svg><span style={{fontSize:10,fontWeight:700,color:C.muted}}>{formatTime(gap)}</span></div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

    function StageDetailSheet({stage,onClose,onRace,onOpenSections,user,onRename,units}){
    const [lb,setLb]=useState([]);
const [rank,setRank]=useState({total:0,myPos:0});
const [myAttempts,setMyAttempts]=useState([]);
const [editingName,setEditingName]=useState(false);
const [nameVal,setNameVal]=useState(stage.name);
const [savingName,setSavingName]=useState(false);
const [difficulty,setDifficulty]=useState(stage.difficulty||'blue');
const [editingDifficulty,setEditingDifficulty]=useState(false);
const [builtBy,setBuiltBy]=useState(stage.built_by||'');
const [editingBuiltBy,setEditingBuiltBy]=useState(false);
const [builtByVal,setBuiltByVal]=useState(stage.built_by||'');
const saveBuiltBy=async()=>{
  const trimmed=builtByVal.trim().slice(0,60);
  const{error}=await supabase.from('stages').update({built_by:trimmed||null}).eq('id',stage.id);
  if(error){alert(error.message);return;}
  stage.built_by=trimmed||null;
  setBuiltBy(trimmed);setBuiltByVal(trimmed);setEditingBuiltBy(false);
};
const saveDifficulty=async(val)=>{
  setDifficulty(val);setEditingDifficulty(false);stage.difficulty=val;
  const{error}=await supabase.from('stages').update({difficulty:val}).eq('id',stage.id);
  if(error)alert(error.message);
};
 
    useEffect(()=>{supabase.from('stage_times').select('time_ms,user_id,created_at,profiles(display_name,avatar_url)').eq('stage_id',stage.id).order('time_ms',{ascending:true}).then(({data})=>{if(data){const seen={};const best=data.filter(t=>{const id=t.user_id;if(seen[id])return false;seen[id]=true;return true;});setLb(best.slice(0,10).map((t,i)=>({pos:i+1,name:t.profiles?.display_name||'Rider',avatarUrl:t.profiles?.avatar_url||null,time:t.time_ms,date:new Date(t.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}),user_id:t.user_id})));setRank({total:best.length,myPos:user?(best.findIndex(t=>t.user_id===user.id)+1):0});}});},[stage.id,user]);

 useEffect(()=>{if(!user)return;supabase.from('stage_times').select('time_ms,created_at').eq('stage_id',stage.id).eq('user_id',user.id).order('created_at',{ascending:true}).then(({data})=>{if(data)setMyAttempts(data);});},[stage.id,user]);
const isCreator=!!(user&&stage.created_by&&stage.created_by===user.id);
const saveName=async()=>{const trimmed=nameVal.trim();if(!trimmed||trimmed===stage.name){setEditingName(false);setNameVal(stage.name);return;}setSavingName(true);const{error}=await supabase.from('stages').update({name:trimmed}).eq('id',stage.id);setSavingName(false);if(error){alert(error.message);return;}onRename&&onRename(stage.id,trimmed);setEditingName(false);};
const dist=haversine(stage.start,stage.finish);
const myEntry=lb.find(e=>user&&e.user_id===user.id);
  const myPos=rank.myPos||null;
  const medalColor=pos=>pos===1?"#FFD700":pos===2?"#C0C0C0":pos===3?"#CD7F32":null;
  return(
    <div style={{padding:"0 0 40px"}}>
<div style={{background:"#fff",padding:"16px 16px 4px",borderBottom:`1px solid ${C.border}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
<div style={{flex:1,marginRight:12}}>
{editingName?(
<div style={{display:"flex",alignItems:"center",gap:8}}>
<input autoFocus value={nameVal} onChange={e=>setNameVal(e.target.value)} style={{flex:1,fontSize:20,fontWeight:800,color:C.text,border:`1.5px solid ${C.blue}`,borderRadius:8,padding:"6px 10px",background:"#fff"}}/>
<button className="tap" onClick={saveName} disabled={savingName} style={{background:C.blue,border:"none",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,fontWeight:700}}>{savingName?"…":"Save"}</button>
<button className="tap" onClick={()=>{setEditingName(false);setNameVal(stage.name);}} style={{background:"none",border:"none",color:C.muted,fontSize:13}}>Cancel</button>
</div>
):(
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{fontSize:20,fontWeight:800,color:C.text}}>{nameVal}</div>
{isCreator&&<button className="tap" onClick={()=>setEditingName(true)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 8px",color:C.muted,fontSize:11,fontWeight:600}}>Edit</button>}
</div>
)}
<div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
  <span style={{fontSize:12,color:C.muted}}>{formatDist(dist)}</span>
  <span style={{fontSize:12,color:C.muted}}>·</span>
  <span style={{fontSize:12,color:C.muted}}>{stage.privacy}</span>
  <span style={{fontSize:12,color:C.muted}}>·</span>
  {isCreator?(
    <button className="tap" onClick={()=>setEditingDifficulty(v=>!v)} style={{background:"none",border:"none",padding:0,display:"flex",alignItems:"center",gap:4}}>
      <DifficultyDiamond color={DIFFICULTIES.find(d=>d.val===difficulty)?.color} size={12}/>
      <span style={{fontSize:12,fontWeight:600,color:DIFFICULTIES.find(d=>d.val===difficulty)?.color}}>{DIFFICULTIES.find(d=>d.val===difficulty)?.label}</span>
    </button>
  ):(
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <DifficultyDiamond color={DIFFICULTIES.find(d=>d.val===difficulty)?.color} size={12}/>
      <span style={{fontSize:12,fontWeight:600,color:DIFFICULTIES.find(d=>d.val===difficulty)?.color}}>{DIFFICULTIES.find(d=>d.val===difficulty)?.label}</span>
    </div>
  )}
</div>
{editingDifficulty&&<div style={{marginTop:10}}><DifficultyPicker value={difficulty} onChange={saveDifficulty}/></div>}
{(builtBy||isCreator)&&(editingBuiltBy?(
  <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10}}>
    <input autoFocus value={builtByVal} onChange={e=>setBuiltByVal(e.target.value)} maxLength={60} placeholder="Who built this trail?" style={{flex:1,fontSize:13,color:C.text,border:`1.5px solid ${C.blue}`,borderRadius:8,padding:"7px 10px",background:"#fff"}}/>
    <button className="tap" onClick={saveBuiltBy} style={{background:C.blue,border:"none",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:12,fontWeight:700}}>Save</button>
    <button className="tap" onClick={()=>{setEditingBuiltBy(false);setBuiltByVal(builtBy);}} style={{background:"none",border:"none",color:C.muted,fontSize:12}}>Cancel</button>
  </div>
):(
  <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,fontSize:12,color:C.muted}}>
    {builtBy?<span>Trail built by <span style={{fontWeight:600,color:C.text}}>{builtBy}</span></span>:<span>No trail builder credited</span>}
    {isCreator&&<button className="tap" onClick={()=>setEditingBuiltBy(true)} style={{background:"none",border:"none",padding:0,color:C.blue,fontSize:12,fontWeight:600}}>{builtBy?"Edit":"Add"}</button>}
  </div>
))}
</div>
<button className="tap" onClick={onClose} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",color:C.text,fontSize:13}}>Close</button>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
<div style={{background:C.surface,borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
<div style={{fontSize:14,fontWeight:700,color:C.green}}>{stage.time?formatTime(stage.time):"—"}</div>
<div style={{fontSize:10,color:C.muted,marginTop:2}}>Your Best</div>
</div>
<div style={{background:C.surface,borderRadius:10,padding:"10px 8px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
<div style={{display:"flex",justifyContent:"center",marginBottom:4}}>{myPos?<PositionBadge pos={myPos} size={40}/>:<div style={{fontSize:14,fontWeight:700,color:C.text}}>—</div>}</div>
<div style={{fontSize:10,color:C.muted,marginTop:2}}>Position</div>
</div>
<div style={{background:C.surface,borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
<div style={{fontSize:14,fontWeight:700,color:C.text}}>{rank.total||lb.length}</div>
<div style={{fontSize:10,color:C.muted,marginTop:2}}>Riders</div>
</div>
</div>
</div>

    
            <StageLeaderboardCard lb={lb} rank={rank} user={user}/>
            <StageProgressCard stage={stage} user={user} lb={lb} myAttempts={myAttempts}/>
<StageConsistencyCard runs={myAttempts}/>
<StageTimeDeltaCard stage={stage} lb={lb} myAttempts={myAttempts} user={user} units={units}/>
<StageImprovementCard myAttempts={myAttempts}/>
<div style={{padding:"16px 16px 0"}}>
        
                <button className="tap" onClick={onRace} style={{width:"100%",background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"12px 16px",color:C.blue,fontSize:14,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon.Flag size={16} color={C.blue}/>Race Stage</button>
        <button className="tap" onClick={onOpenSections} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 16px",color:C.text,fontSize:13,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon.Lightning size={15} color={C.muted}/>Sections</button>

                <button className="tap" style={{width:"100%",height:38,background:"#fff",border:`1px solid ${C.border}`,borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",gap:7,boxShadow:"0 1px 2px rgba(0,0,0,0.04)",marginTop:8}}>
          <svg width="13" height="13" viewBox="0 0 24 24"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" fill={C.blue}/></svg>
          <span style={{fontSize:14,fontWeight:700,color:C.text}}>Upgrade</span>
        </button>
      </div>
    </div>
  );
}

function stageRouteThumb(stage,w,h,pad){
  const raw=stage.line_coords&&stage.line_coords.length>1?stage.line_coords:[stage.start,stage.finish];
  const lats=raw.map(c=>c.lat),lngs=raw.map(c=>c.lng);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats),minLng=Math.min(...lngs),maxLng=Math.max(...lngs);
  const latRange=maxLat-minLat||0.0001,lngRange=maxLng-minLng||0.0001;
  const pts=raw.map(c=>({x:pad+((c.lng-minLng)/lngRange)*(w-pad*2),y:pad+(1-(c.lat-minLat)/latRange)*(h-pad*2)}));
  const d=pts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return{d,start:pts[0],end:pts[pts.length-1]};
}
function RouteThumbSvg({stage,height=90}){
  const W=320,H=height,PAD=14;
  const{d,start,end}=stageRouteThumb(stage,W,H,PAD);
  return(
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{display:"block"}}>
      <rect width={W} height={H} fill={C.mapPark}/>
      <path d={d} fill="none" stroke={C.orange} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={start.x} cy={start.y} r="6.5" fill={C.orange} stroke="#fff" strokeWidth="2"/>
      <circle cx={end.x} cy={end.y} r="6.5" fill="#fff" stroke={C.text} strokeWidth="2"/>
    </svg>
  );
}
function RouteThumbnail({stage}){
  return(
    <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,marginTop:10}}>
      <RouteThumbSvg stage={stage}/>
    </div>
  );
}
function ShareStageSheet({stage,onShare,onDismiss}){
  const dist=haversine(stage.start,stage.finish);
  return(
    <div style={{padding:"0 20px 20px"}}>
      <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:4}}>Share to feed?</div>
      <div style={{fontSize:13,color:C.muted,marginBottom:14}}>Other riders on GATE will see this in their feed.</div>
      <div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`,marginBottom:16}}>
        <RouteThumbSvg stage={stage}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:C.surface}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>{stage.name}</div>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.muted}}>
            <span>{formatDist(dist)}</span><span>·</span>
            {stage.privacy==="public"?<Icon.Globe size={11} color={C.mutedL}/>:<Icon.Users size={11} color={C.mutedL}/>}
            <span>{stage.privacy}</span>
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:10}}>
        <button className="tap" onClick={onDismiss} style={{flex:1,background:"#fff",border:`1px solid ${C.border}`,borderRadius:12,padding:13,color:C.muted,fontSize:14,fontWeight:600}}>Not now</button>
        <button className="tap" onClick={onShare} style={{flex:2,background:C.blue,border:"none",borderRadius:12,padding:13,color:"#fff",fontSize:14,fontWeight:700}}>Share to Feed</button>
      </div>
    </div>
  );
}

// ── Activity Card ─────────────────────────────────────────────────────────────
    function FeedCard({item,stage,onViewStage}){
if(item.event_type==='day_recap'&&item.context&&item.context.stages){
  const n=item.context.stages.length;
  return(<div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`}}><DayRecapCard recap={item.context} head={{name:item.userName,avatarUrl:item.avatarUrl,ago:item.ago,text:`rode ${n} stage${n===1?"":"s"} today`}}/></div>);
}
const icons={stage_record:{Ic:Icon.Crown,color:"#92400E",bg:"#FFFBEB"},personal_best:{kind:"up",color:C.blue,bg:"#EFF6FF"},course_finish:{Ic:Icon.Flag,color:C.orange,bg:C.orangeL},stage_created:{Ic:Icon.Lightning,color:C.blue,bg:`${C.blue}15`},course_created:{Ic:Icon.Flag,color:C.blue,bg:`${C.blue}15`},day_recap:{Ic:Icon.BarChart,color:C.green,bg:`${C.green}15`}};
const cfg=icons[item.event_type]||{Ic:Icon.Lightning,color:C.muted,bg:C.surface};
const showViewStage=item.stage_id&&['stage_record','personal_best','stage_created'].includes(item.event_type);
return(
<div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`}}>
<div style={{display:"flex",alignItems:"flex-start",gap:12}}>
<Avatar size={38} url={item.avatarUrl}/>
<div style={{flex:1}}>
<div style={{fontSize:13,color:C.text,lineHeight:1.4}}><span style={{fontWeight:700}}>{item.userName}</span> {item.message}</div>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:4}}>
<div style={{fontSize:11,color:C.muted}}>{item.ago}</div>
{showViewStage&&<button className="tap" onClick={()=>onViewStage&&onViewStage(item.stage_id)} style={{background:"none",border:"none",padding:0,display:"flex",alignItems:"center",gap:3,fontSize:12,fontWeight:700,color:C.blue}}>View Stage →</button>}
</div>
</div>
<div style={{width:30,height:30,borderRadius:8,background:cfg.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{cfg.kind==='up'?<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>:<cfg.Ic size={15} color={cfg.color}/>}</div>
</div>
{item.event_type==='stage_created'&&stage&&<RouteThumbnail stage={stage}/>}
</div>
);
}
function ActivityCard({item}){

  const [kudosed,setKudosed]=useState(false);
  const colors=["#FC4C02","#2563EB","#15803D","#7C3AED","#B45309"];
  const bg=colors[item.id%colors.length];
  return(
    <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,paddingBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"16px 16px 12px"}}><Avatar initials={item.avatar} bg={bg}/><div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:C.text}}>{item.user}</div><div style={{fontSize:12,color:C.muted,marginTop:1}}>{item.type} · {item.ago}</div></div></div>
      <div style={{fontSize:16,fontWeight:700,color:C.text,padding:"0 16px 12px"}}>{item.name}</div>
      <div style={{height:120,margin:"0 16px 12px",borderRadius:12,overflow:"hidden",background:C.mapBase,position:"relative"}}>
        <svg width="100%" height="100%"><rect width="100%" height="100%" fill={C.mapBase}/><ellipse cx="60%" cy="60%" rx="80" ry="45" fill={C.mapPark} opacity="0.7"/><path d="M20,90 C35,86 48,88 60,84" fill="none" stroke={C.orange} strokeWidth="3" strokeLinecap="round" strokeDasharray="5 3"/><path d="M60,84 C80,76 110,78 150,58 C180,42 220,44 260,28" fill="none" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round"/><path d="M260,28 C272,24 282,22 290,20" fill="none" stroke={C.orange} strokeWidth="3" strokeLinecap="round" strokeDasharray="5 3"/><circle cx="20" cy="90" r="5" fill="white" stroke={C.green} strokeWidth="1.5"/><circle cx="20" cy="90" r="3" fill={C.green}/><circle cx="290" cy="20" r="5" fill="white" stroke={C.red} strokeWidth="1.5"/><rect x="287" y="17" width="6" height="6" rx="1" fill={C.red}/></svg>
        {item.stage&&<div style={{position:"absolute",bottom:8,left:8,background:"white",borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:600,color:C.blue,boxShadow:"0 1px 4px rgba(0,0,0,0.12)"}}>⚡ {item.stage}</div>}
      </div>
      <div style={{display:"flex",padding:"0 16px",marginBottom:12}}>
        {[{l:"Distance",v:item.dist},{l:"Elev Gain",v:item.elev},{l:"Moving Time",v:item.time}].map(({l,v},i)=>(
          <div key={l} style={{flex:1,borderRight:i<2?`1px solid ${C.border}`:"none",paddingRight:i<2?12:0,paddingLeft:i>0?12:0}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:3}}>{l}</div><div style={{fontSize:15,fontWeight:700,color:C.text}}>{v}</div>
          </div>
        ))}
      </div>
      {item.stage&&<div style={{margin:"0 16px 12px",background:item.cr?"#FFFBEB":C.surface,borderRadius:10,padding:"10px 14px",border:`1px solid ${item.cr?"#FDE68A":C.border}`,display:"flex",alignItems:"center",gap:10}}>{item.cr&&<Icon.Crown size={16} color="#92400E"/>}<div style={{flex:1}}><div style={{fontSize:11,color:C.muted,marginBottom:1}}>{item.stage}</div><div style={{fontSize:14,fontWeight:700,color:item.cr?"#92400E":C.text}}>{item.stageTime}</div></div>{item.cr&&<div style={{fontSize:11,fontWeight:700,color:"#92400E",background:"#FEF3C7",borderRadius:5,padding:"2px 7px"}}>Course Record</div>}</div>}
      <div style={{display:"flex",gap:8,padding:"0 16px"}}>
        <button className="tap" onClick={()=>setKudosed(k=>!k)} style={{display:"flex",alignItems:"center",gap:6,background:kudosed?C.orangeL:"none",border:`1px solid ${kudosed?C.orange:C.border}`,borderRadius:8,padding:"7px 14px",color:kudosed?C.orange:C.muted,fontSize:13,fontWeight:600,transition:"all 0.15s"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={kudosed?C.orange:"none"} stroke={kudosed?C.orange:C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>
          {item.kudos+(kudosed?1:0)}
        </button>
        <button className="tap" style={{display:"flex",alignItems:"center",gap:6,background:"none",border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 14px",color:C.muted,fontSize:13}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>Comment
        </button>
      </div>
    </div>
  );
}

// ── Segment Row ───────────────────────────────────────────────────────────────
function SegmentRow({stage,onPress,onDelete,userId}){

  const dist=haversine(stage.start,stage.finish);
  const privIcon=stage.privacy==="public"?<Icon.Globe size={12} color={C.mutedL}/>:stage.privacy==="group"?<Icon.Users size={12} color={C.mutedL}/>:<Icon.Lock size={12} color={C.mutedL}/>;
  return(
    <button className="tap" onClick={()=>onPress&&onPress(stage)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"13px 16px",borderBottom:`1px solid ${C.border}`,background:"white",textAlign:"left"}}>
      <div style={{width:40,height:40,borderRadius:10,background:`${C.blue}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.Lightning size={20} color={C.blue}/></div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}><div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stage.name}</div>{stage.cr&&<span style={{fontSize:9,background:"#FEF3C7",color:"#92400E",borderRadius:4,padding:"1px 5px",fontWeight:700,flexShrink:0}}>CR</span>}</div>
        <div style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:C.muted}}>{privIcon}<span>{formatDist(dist)}</span></div>
      </div>
      <div style={{textAlign:"right",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
        <div>{stage.time?<div style={{fontSize:15,fontWeight:700,color:C.text}}>{formatTime(stage.time)}</div>:<div style={{fontSize:13,color:C.mutedL}}>—</div>}<div style={{fontSize:10,color:C.mutedL,marginTop:1}}>best</div></div>
        <Icon.ChevronRight size={14} color={C.mutedL}/>{onDelete&&stage.created_by===userId&&<button className="tap" onClick={e=>{e.stopPropagation();onDelete(stage.id);}} style={{marginLeft:4,background:"none",border:"none",padding:"4px",color:C.red,fontSize:13,fontWeight:600}}>✕</button>}
      </div>
    </button>
  );
}
function PositionBadge({pos,size=32}){const crownColor=pos===1?"#C9A227":pos===2?"#AEB2B8":pos===3?"#AD8158":null;return(<div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>{crownColor&&<svg width={size*0.5} height={size*0.4} viewBox="0 0 24 20" style={{marginBottom:-size*0.06}}><path d="M3 19l-1.5-10L7 13l5-9 5 9 5.5-4L20 19H3z" fill={crownColor} stroke={crownColor} strokeLinejoin="round" strokeWidth="1"/><rect x="3" y="17" width="17" height="2.6" rx="1" fill={crownColor}/></svg>}<span style={{fontSize:size*0.44,fontWeight:800,color:C.text,letterSpacing:-0.5}}>P{pos}</span></div>);}
const DIFFICULTIES=[{val:"blue",label:"Blue",color:C.blue},{val:"red",label:"Red",color:C.red},{val:"black",label:"Black",color:"#1A1A1A"}];
function DifficultyDiamond({color,size=20}){
  return <svg width={size} height={size} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill={color} transform="rotate(45 12 12)"/></svg>;
}
function DifficultyPicker({value,onChange}){
  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
      {DIFFICULTIES.map(d=>(
        <button key={d.val} className="tap" onClick={()=>onChange(d.val)} style={{background:value===d.val?`${d.color}15`:C.surface,border:`1.5px solid ${value===d.val?d.color:C.border}`,borderRadius:10,padding:"12px 8px",textAlign:"center",transition:"all 0.15s"}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:6}}><DifficultyDiamond color={d.color}/></div>
          <div style={{fontSize:12,fontWeight:value===d.val?700:400,color:value===d.val?d.color:C.text}}>{d.label}</div>
        </button>
      ))}
    </div>
  );
}
function GoldCrown({size=20}){
  return <svg width={size} height={size*0.85} viewBox="0 0 24 20" style={{flexShrink:0}}><path d="M3 19l-1.5-10L7 13l5-9 5 9 5.5-4L20 19H3z" fill="#C9A227" stroke="#C9A227" strokeLinejoin="round" strokeWidth="1"/><rect x="3" y="17" width="17" height="2.6" rx="1" fill="#C9A227"/></svg>;
}

function NotificationsScreen({notifications,onBack,onMarkAll,onOpen}){
  const unread=notifications.filter(n=>!n.read_at).length;
  const describe=n=>{
    const who=<span style={{fontWeight:700}}>{n.actor_name}</span>;
    if(n.kind==='record_lost')return{icon:<GoldCrown size={16}/>,bg:"#FFFBEB",main:<>{who} took your record on {n.subject_name}</>,sub:`${formatTime(n.new_time_ms)} · you had ${formatTime(n.old_time_ms)}`};
    if(n.kind==='course_record_lost')return{icon:<GoldCrown size={16}/>,bg:"#FFFBEB",main:<>{who} took your course record on {n.subject_name}</>,sub:`${formatTime(n.new_time_ms)} · you had ${formatTime(n.old_time_ms)}`};
    if(n.kind==='time_beaten')return{icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>,bg:"#EFF6FF",main:<>{who} beat your time on {n.subject_name}</>,sub:`${formatTime(n.new_time_ms)}${n.new_position?` · you're now P${n.new_position}`:""}`};
    const rides=n.ride_count||1,riders=(n.rider_ids||[]).length||1;
    return{icon:<Icon.Lightning size={16} color={C.muted}/>,bg:C.surface,main:<><span style={{fontWeight:700}}>{rides} ride{rides===1?"":"s"}</span> on your stage {n.subject_name}</>,sub:`${riders} rider${riders===1?"":"s"}`};
  };
  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:"#fff"}}>
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button className="tap" onClick={onBack} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>Notifications</div>
        {unread>0&&<button className="tap" onClick={onMarkAll} style={{background:"none",border:"none",color:C.blue,fontSize:12,fontWeight:600}}>Mark all read</button>}
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {notifications.length===0?(
          <div style={{textAlign:"center",padding:"56px 24px",color:C.muted}}>
            <Icon.Bell size={34} color={C.mutedL}/>
            <div style={{fontSize:15,fontWeight:500,marginTop:12,marginBottom:4,color:C.text}}>Nothing yet</div>
            <div style={{fontSize:13,color:C.mutedL,lineHeight:1.5}}>You'll see an alert here when someone beats your time or takes your record.</div>
          </div>
        ):notifications.map(n=>{
          const d=describe(n);
          const isUnread=!n.read_at;
          return(
            <button key={n.id} className="tap" onClick={()=>onOpen(n)} style={{width:"100%",display:"flex",alignItems:"flex-start",gap:12,padding:"14px 16px",borderBottom:"1px solid #F0F0F0",background:isUnread?"#F8FAFF":"#fff",textAlign:"left"}}>
              <div style={{width:34,height:34,borderRadius:9,background:d.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{d.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:C.text,lineHeight:1.4}}>{d.main}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{d.sub}</div>
                <div style={{fontSize:11,color:"#9A9A9A",marginTop:4}}>{timeAgo(n.created_at)}</div>
              </div>
              <div style={{width:8,height:8,borderRadius:"50%",background:isUnread?C.blue:"transparent",marginTop:6,flexShrink:0}}/>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DifficultyChips({value,onChange,shadow=false}){
  const keys=Object.keys(value);
  const toggle=d=>{
    if(d==='all'){onChange({});return;}
    const next={...value};
    if(next[d])delete next[d];else next[d]=true;
    onChange(next);
  };
  const chipStyle=(active,color)=>({display:"flex",alignItems:"center",gap:6,padding:"7px 12px",borderRadius:20,fontSize:13,whiteSpace:"nowrap",background:active?`${color}15`:C.surface,border:`1px solid ${active?color:C.border}`,color:active?color:C.text,fontWeight:active?600:400,boxShadow:shadow?"0 2px 8px rgba(0,0,0,0.12)":"none"});
  return(
    <div style={{display:"flex",gap:8,overflowX:"auto"}}>
      <button className="tap" onClick={()=>toggle('all')} style={chipStyle(keys.length===0,C.blue)}>All</button>
      {DIFFICULTIES.map(d=>(
        <button key={d.val} className="tap" onClick={()=>toggle(d.val)} style={chipStyle(!!value[d.val],d.color)}><DifficultyDiamond color={d.color} size={14}/>{d.label}</button>
      ))}
    </div>
  );
}
function PopularStageCard({stage,rank,rides,distKm,onPress}){
  const color=(DIFFICULTIES.find(d=>d.val===stage.difficulty)||DIFFICULTIES[0]).color;
  const{d,start,end}=stageRouteThumb(stage,150,70,12);
  return(
    <button className="tap" onClick={()=>onPress(stage)} style={{flex:"0 0 150px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden",textAlign:"left",padding:0}}>
      <div style={{position:"relative"}}>
        <svg viewBox="0 0 150 70" width="150" height="70" style={{display:"block"}}>
          <rect width="150" height="70" fill={C.mapPark}/>
          <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          <g transform={`translate(${start.x},${start.y}) rotate(45)`}><rect x="-4.5" y="-4.5" width="9" height="9" rx="1" fill={color} stroke="#fff" strokeWidth="1.6"/></g>
          <circle cx={end.x} cy={end.y} r="4.5" fill="#fff" stroke={C.text} strokeWidth="1.6"/>
        </svg>
        <div style={{position:"absolute",top:6,left:6,background:"#fff",borderRadius:6,padding:"2px 7px",fontSize:11,fontWeight:800,color:C.text,boxShadow:"0 1px 3px rgba(0,0,0,0.15)"}}>#{rank}</div>
      </div>
      <div style={{padding:"9px 10px"}}>
        <div style={{display:"flex",alignItems:"center",gap:5}}><DifficultyDiamond color={color} size={13}/><span style={{fontSize:13,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stage.name}</span></div>
        <div style={{fontSize:11,color:C.muted,marginTop:3}}>{rides} ride{rides===1?"":"s"} · {distKm.toFixed(1)}km away</div>
      </div>
    </button>
  );
}
function ProgressChart({attempts}){
  const W=280,H=100,PAD=10;
  const times=attempts.map(a=>a.time_ms);
  const min=Math.min(...times),max=Math.max(...times);
  const range=max-min||1;
  const points=attempts.map((a,i)=>({
    x:PAD+(i/((attempts.length-1)||1))*(W-PAD*2),
    y:PAD+((a.time_ms-min)/range)*(H-PAD*2),
  }));
  const path=points.map((p,i)=>`${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
  return(
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      <path d={path} fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={i===points.length-1?4:2.5} fill={i===points.length-1?C.blue:"#fff"} stroke={C.blue} strokeWidth="1.5"/>)}
    </svg>
  );
}

function ProgressSheet({stages,user}){
  const [grouped,setGrouped]=useState(null);
  const [expandedId,setExpandedId]=useState(null);
  useEffect(()=>{
    supabase.from('stage_times').select('stage_id,time_ms,created_at').eq('user_id',user.id).order('created_at',{ascending:true}).then(({data})=>{
      if(!data)return setGrouped({});
      const byStage={};
      data.forEach(t=>{(byStage[t.stage_id]=byStage[t.stage_id]||[]).push(t);});
      setGrouped(byStage);
    });
  },[user.id]);

  if(grouped===null)return <div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>;

  const progressStages=Object.keys(grouped).filter(id=>grouped[id].length>=2).map(id=>({
    stage:stages.find(s=>String(s.id)===String(id)),
    attempts:grouped[id],
  })).filter(x=>x.stage);

    if(progressStages.length===0)return <div style={{padding:"0 16px 40px"}}><div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>Ride the same stage a couple of times to see your progress here.</div></div>;

   return(
    <div style={{padding:"0 16px 40px"}}>
      {progressStages.map(({stage,attempts})=>{
        const best=Math.min(...attempts.map(a=>a.time_ms));
        const isOpen=expandedId===stage.id;
        return(
          <div key={stage.id} style={{marginBottom:10,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
            <button className="tap" onClick={()=>setExpandedId(isOpen?null:stage.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#fff",border:"none",textAlign:"left"}}>
              <div style={{width:36,height:36,borderRadius:8,background:`${C.blue}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.Lightning size={16} color={C.blue}/></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stage.name}</div>
                <div style={{fontSize:11,color:C.muted}}>{attempts.length} attempts</div>
              </div>
              <div style={{fontSize:15,fontWeight:700,color:C.text}}>{formatTime(best)}</div>
              {isOpen?<Icon.ChevronUp size={16} color={C.mutedL}/>:<Icon.ChevronDown size={16} color={C.mutedL}/>}
            </button>
            {isOpen&&<div style={{padding:"4px 14px 16px",background:C.surface}}>
              <ProgressChart attempts={attempts}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                <div style={{fontSize:10,color:C.mutedL}}>First: {formatTime(attempts[0].time_ms)}</div>
                <div style={{fontSize:10,color:C.mutedL}}>Latest: {formatTime(attempts[attempts.length-1].time_ms)}</div>
              </div>
            </div>}
          </div>
        );
      })}
    </div>
  );
}

function CourseProgressSheet({courses,user}){
  const [grouped,setGrouped]=useState(null);
  const [expandedId,setExpandedId]=useState(null);
  useEffect(()=>{
    supabase.from('course_results').select('course_id,total_time_ms,completed_at').eq('user_id',user.id).order('completed_at',{ascending:true}).then(({data})=>{
      if(!data)return setGrouped({});
      const byCourse={};
      data.forEach(r=>{(byCourse[r.course_id]=byCourse[r.course_id]||[]).push(r);});
      setGrouped(byCourse);
    });
  },[user.id]);

  if(grouped===null)return <div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>;

  const progressCourses=Object.keys(grouped).filter(id=>grouped[id].length>=2).map(id=>({
    course:courses.find(c=>String(c.id)===String(id)),
    attempts:grouped[id],
  })).filter(x=>x.course);

  if(progressCourses.length===0)return <div style={{padding:"0 16px 40px"}}><div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>Complete the same course a couple of times to see your progress here.</div></div>;

  return(
    <div style={{padding:"0 16px 40px"}}>
      {progressCourses.map(({course,attempts})=>{
        const best=Math.min(...attempts.map(a=>a.total_time_ms));
        const isOpen=expandedId===course.id;
        return(
          <div key={course.id} style={{marginBottom:10,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
            <button className="tap" onClick={()=>setExpandedId(isOpen?null:course.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#fff",border:"none",textAlign:"left"}}>
              <div style={{width:36,height:36,borderRadius:8,background:`${C.blue}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.Flag size={16} color={C.blue}/></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{course.name}</div>
                <div style={{fontSize:11,color:C.muted}}>{attempts.length} completions</div>
              </div>
              <div style={{fontSize:15,fontWeight:700,color:C.text}}>{formatTime(best)}</div>
              {isOpen?<Icon.ChevronUp size={16} color={C.mutedL}/>:<Icon.ChevronDown size={16} color={C.mutedL}/>}
            </button>
            {isOpen&&<div style={{padding:"4px 14px 16px",background:C.surface}}>
              <ProgressChart attempts={attempts.map(a=>({time_ms:a.total_time_ms}))}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                <div style={{fontSize:10,color:C.mutedL}}>First: {formatTime(attempts[0].total_time_ms)}</div>
                <div style={{fontSize:10,color:C.mutedL}}>Latest: {formatTime(attempts[attempts.length-1].total_time_ms)}</div>
              </div>
            </div>}
          </div>
        );
      })}
    </div>
  );
}

function UnitField({label,unit,value,onChange,placeholder}){
return(
<div>
<div style={{fontSize:10,fontWeight:700,color:C.muted,marginBottom:4,letterSpacing:0.4,textTransform:"uppercase"}}>{label}</div>
<div style={{position:"relative"}}>
<input type="number" inputMode="decimal" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:unit?"8px 34px 8px 8px":"8px",fontSize:13,color:C.text,background:C.surface,boxSizing:"border-box"}}/>
{!!unit&&<span style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",fontSize:10,color:C.mutedL,fontWeight:700,pointerEvents:"none"}}>{unit}</span>}
</div>
</div>
);
}
const SUSPENSION_FIELDS=[{key:"psi",label:"PSI",unit:"psi"},{key:"lsc",label:"LSC",unit:"clicks"},{key:"hsc",label:"HSC",unit:"clicks"},{key:"lsr",label:"LSR",unit:"clicks"},{key:"hsr",label:"HSR",unit:"clicks"},{key:"hsb",label:"HSB",unit:"clicks"},{key:"tokens",label:"Tokens",unit:""},{key:"sag",label:"SAG",unit:"%"}];
const COIL_FIELDS=[{key:"springRate",label:"Spring Rate",unit:"lbs/in"},{key:"lsc",label:"LSC",unit:"clicks"},{key:"hsc",label:"HSC",unit:"clicks"},{key:"lsr",label:"LSR",unit:"clicks"},{key:"hsr",label:"HSR",unit:"clicks"},{key:"hsb",label:"HSB",unit:"clicks"},{key:"sag",label:"SAG",unit:"%"}];
function ModeToggle({mode,onChange}){
return(
<div style={{display:"flex",background:C.surface,borderRadius:8,padding:2,marginBottom:10}}>
{["psi","lbs"].map(m=>(
<button key={m} className="tap" onClick={()=>onChange(m)} style={{flex:1,border:"none",borderRadius:6,padding:"5px 0",background:mode===m?C.blue:"transparent",color:mode===m?"#fff":C.muted,fontSize:11,fontWeight:700}}>{m.toUpperCase()}</button>
))}
</div>
);
}
function SuspensionColumn({title,prefix,s,setField}){
const mode=s[prefix+"Mode"];
const fields=mode==="lbs"?COIL_FIELDS:SUSPENSION_FIELDS;
return(
<div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:16,padding:"14px 10px",flex:1,minWidth:0}}>
<div style={{fontSize:14,fontWeight:700,color:C.text,textAlign:"center",marginBottom:8}}>{title}</div>
<ModeToggle mode={mode} onChange={m=>setField(prefix+"Mode",m)}/>
<div style={{display:"flex",flexDirection:"column",gap:8}}>
{fields.map(f=>{
const key=prefix+f.key.charAt(0).toUpperCase()+f.key.slice(1);
return <UnitField key={f.key} label={f.label} unit={f.unit} value={s[key]} onChange={v=>setField(key,v)}/>;
})}
</div>
</div>
);
}
function NotesField({label,value,onChange}){
return(
<div style={{marginBottom:14}}>
<div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,letterSpacing:0.3,textTransform:"uppercase"}}>{label}</div>
<textarea value={value} onChange={e=>onChange(e.target.value)} rows={2} style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.text,background:C.surface,boxSizing:"border-box",resize:"none"}}/>
</div>
);
}
function BikeSetupScreen({settings,onSave,onBack}){
const [s,setS]=useState(settings);
useEffect(()=>{setS(settings);},[settings]);
const setField=(key,val)=>setS(prev=>({...prev,[key]:val}));
const saveAndClose=async()=>{
onSave(s);
const{data:{user}}=await supabase.auth.getUser();
if(user){
const{error}=await supabase.from('profiles').update({bike_name:s.bikeName,rider_weight:s.riderWeight,tire_dry_front:s.tireDryFront,tire_dry_rear:s.tireDryRear,tire_wet_front:s.tireWetFront,tire_wet_rear:s.tireWetRear,shock_mode:s.shockMode,shock_psi:s.shockPsi,shock_spring_rate:s.shockSpringRate,shock_lsc:s.shockLsc,shock_hsc:s.shockHsc,shock_lsr:s.shockLsr,shock_hsr:s.shockHsr,shock_hsb:s.shockHsb,shock_tokens:s.shockTokens,shock_sag:s.shockSag,fork_mode:s.forkMode,fork_psi:s.forkPsi,fork_spring_rate:s.forkSpringRate,fork_lsc:s.forkLsc,fork_hsc:s.forkHsc,fork_lsr:s.forkLsr,fork_hsr:s.forkHsr,fork_hsb:s.forkHsb,fork_tokens:s.forkTokens,fork_sag:s.forkSag,bike_notes:s.bikeNotes,fork_notes:s.forkNotes,shock_notes:s.shockNotes}).eq('id',user.id);
if(error){alert("Couldn't save bike setup: "+error.message);return;}
}
onBack();
};
return(
<div style={{height:"100%",display:"flex",flexDirection:"column",background:"#fff"}}>
<div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
<button className="tap" onClick={saveAndClose} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
<div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>Bike Setup</div>
</div>
<div style={{flex:1,overflowY:"auto",padding:"20px 16px 40px"}}>
<div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:16,padding:"16px",marginBottom:16}}>
<img src="/bike-setup.jpeg" alt="Bike" style={{width:"100%",height:"auto",display:"block",margin:"0 auto 14px"}}/>
<input value={s.bikeName} onChange={e=>setField("bikeName",e.target.value)} placeholder="Name your bike" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"12px 14px",fontSize:16,fontWeight:700,color:C.text,background:C.surface,marginBottom:12,boxSizing:"border-box",textAlign:"center"}}/>
<div style={{marginBottom:14}}>
<UnitField label="Rider weight — with gear" unit="kg" value={s.riderWeight} onChange={v=>setField("riderWeight",v)}/>
</div>
<div style={{fontSize:10,fontWeight:700,color:C.mutedL,letterSpacing:0.6,textTransform:"uppercase",marginBottom:6}}>Dry</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
<UnitField label="Tire — Rear" unit="psi" value={s.tireDryRear} onChange={v=>setField("tireDryRear",v)}/>
<UnitField label="Tire — Front" unit="psi" value={s.tireDryFront} onChange={v=>setField("tireDryFront",v)}/>
</div>
<div style={{fontSize:10,fontWeight:700,color:C.mutedL,letterSpacing:0.6,textTransform:"uppercase",marginBottom:6}}>Wet</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
<UnitField label="Tire — Rear" unit="psi" value={s.tireWetRear} onChange={v=>setField("tireWetRear",v)}/>
<UnitField label="Tire — Front" unit="psi" value={s.tireWetFront} onChange={v=>setField("tireWetFront",v)}/>
</div>
</div>
<div style={{display:"flex",gap:10,marginBottom:16}}>
<SuspensionColumn title="Shock" prefix="shock" s={s} setField={setField}/>
<SuspensionColumn title="Fork" prefix="fork" s={s} setField={setField}/>
</div>
<NotesField label="Bike notes" value={s.bikeNotes} onChange={v=>setField("bikeNotes",v)}/>
<NotesField label="Fork notes" value={s.forkNotes} onChange={v=>setField("forkNotes",v)}/>
<NotesField label="Shock notes" value={s.shockNotes} onChange={v=>setField("shockNotes",v)}/>
</div>
</div>
);
}

function GroupRow({group,onPress}){
  return(
    <button className="tap" onClick={()=>onPress(group)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderBottom:`1px solid ${C.border}`,background:"white",textAlign:"left"}}>
      <div style={{width:40,height:40,borderRadius:10,background:`${C.blue}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.Users size={20} color={C.blue}/></div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{group.name}</div>
        <div style={{fontSize:12,color:C.muted,marginTop:2}}>{group.memberCount} members</div>
      </div>
      <Icon.ChevronRight size={16} color={C.mutedL}/>
    </button>
  );
}
function GroupsScreen({user,onBack,onOpenGroup}){
  const [groups,setGroups]=useState(null);
  const [view,setView]=useState('list');
  const [newName,setNewName]=useState("");
  const [creating,setCreating]=useState(false);
  const [joinCode,setJoinCode]=useState("");
  const [joinPreview,setJoinPreview]=useState(null);
  const [joinError,setJoinError]=useState("");
  const [joining,setJoining]=useState(false);

  const loadGroups=()=>{
    supabase.from('groups').select('id,name,code,created_by,group_members(count)').then(({data,error})=>{
      if(error){console.log(error);setGroups([]);return;}
      setGroups((data||[]).map(g=>({id:g.id,name:g.name,code:g.code,created_by:g.created_by,memberCount:g.group_members?.[0]?.count||0})));
    });
  };
  useEffect(()=>{loadGroups();},[]);

  const createGroup=async()=>{
    const trimmed=newName.trim();
    if(!trimmed)return;
    setCreating(true);
    const code=Math.random().toString(36).substring(2,8).toUpperCase();
    const{data,error}=await supabase.from('groups').insert({name:trimmed,code,created_by:user.id}).select().single();
    if(error){alert(error.message);setCreating(false);return;}
    const{error:memberError}=await supabase.from('group_members').insert({group_id:data.id,user_id:user.id});
    if(memberError){alert(memberError.message);setCreating(false);return;}
    setCreating(false);setNewName("");setView('list');loadGroups();
  };

  const lookupCode=async()=>{
    const code=joinCode.trim().toUpperCase();
    if(code.length!==6)return;
    setJoinError("");
    const{data,error}=await supabase.rpc('preview_group_by_code',{p_code:code});
    if(error||!data||data.length===0){setJoinError("No group found with that code");setJoinPreview(null);return;}
    setJoinPreview(data[0]);
  };

  const confirmJoin=async()=>{
    setJoining(true);
    const{error}=await supabase.rpc('join_group_by_code',{p_code:joinCode.trim().toUpperCase()});
    setJoining(false);
    if(error){alert(error.message);return;}
    setJoinCode("");setJoinPreview(null);setView('list');loadGroups();
  };

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:"#fff"}}>
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button className="tap" onClick={()=>view==='list'?onBack():setView('list')} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>{view==='list'?'Groups':view==='create'?'New Group':'Join Group'}</div>
        {view==='list'&&<button className="tap" onClick={()=>setView('create')} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"7px 12px",color:C.blue,fontSize:13,fontWeight:600}}><Icon.Plus size={14} color={C.blue}/>New</button>}
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {view==='list'&&(groups===null?<div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>:
          groups.length===0?(
            <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
              <Icon.Users size={36} color={C.mutedL}/>
              <div style={{fontSize:15,fontWeight:500,marginBottom:4,marginTop:12}}>No groups yet</div>
              <div style={{fontSize:13,color:C.mutedL,marginBottom:16}}>Create one or join with a code</div>
            </div>
          ):groups.map(g=><GroupRow key={g.id} group={g} onPress={onOpenGroup}/>))}
        {view==='list'&&(
          <div style={{padding:"16px"}}>
            <button className="tap" onClick={()=>setView('join')} style={{width:"100%",background:C.surface,border:`1px dashed ${C.border}`,borderRadius:10,padding:12,fontSize:13,color:C.muted,fontWeight:500}}>Have a code? Join a group</button>
          </div>
        )}
        {view==='create'&&(
          <div style={{padding:"20px 16px"}}>
            <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Group name e.g. Sunday Grinders" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,color:C.text,background:C.surface,marginBottom:16,boxSizing:"border-box"}}/>
            <button className="tap" onClick={createGroup} disabled={!newName.trim()||creating} style={{width:"100%",background:newName.trim()?C.blue:C.surface,border:"none",borderRadius:12,padding:15,color:newName.trim()?"#fff":C.muted,fontSize:15,fontWeight:700}}>{creating?"Creating…":"Create Group"}</button>
          </div>
        )}
        {view==='join'&&(
          <div style={{padding:"20px 16px"}}>
            <div style={{fontSize:13,color:C.muted,marginBottom:12}}>Enter the 6-character code your mate shared</div>
            <input value={joinCode} onChange={e=>{setJoinCode(e.target.value.toUpperCase());setJoinPreview(null);setJoinError("");}} placeholder="ABC123" maxLength={6} style={{width:"100%",border:`1.5px solid ${joinCode.length===6?C.blue:C.border}`,borderRadius:12,padding:"18px",fontSize:28,fontWeight:800,color:C.blue,textAlign:"center",letterSpacing:6,background:C.surface,marginBottom:14,boxSizing:"border-box"}}/>
            {joinError&&<div style={{fontSize:13,color:C.red,textAlign:"center",marginBottom:14}}>{joinError}</div>}
            {!joinPreview?(
              <button className="tap" onClick={lookupCode} disabled={joinCode.length!==6} style={{width:"100%",background:joinCode.length===6?C.blue:C.surface,border:"none",borderRadius:12,padding:15,color:joinCode.length===6?"#fff":C.muted,fontSize:15,fontWeight:700}}>Find Group</button>
            ):(
              <>
                <div style={{background:C.surface,borderRadius:12,padding:"14px",border:`1px solid ${C.border}`,marginBottom:14,textAlign:"center"}}>
                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>{joinPreview.name}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:2}}>{joinPreview.member_count} members</div>
                </div>
                <button className="tap" onClick={confirmJoin} disabled={joining} style={{width:"100%",background:C.blue,border:"none",borderRadius:12,padding:15,color:"#fff",fontSize:15,fontWeight:700}}>{joining?"Joining…":"Join Group"}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function GroupDetailScreen({group,user,onBack,onOpenMap}){
  const [members,setMembers]=useState(null);
  const [groupStageIds,setGroupStageIds]=useState(null);
  const [times,setTimes]=useState(null);
  const [subView,setSubView]=useState(null);

  useEffect(()=>{
    supabase.from('group_members').select('user_id,profiles(display_name,avatar_url)').eq('group_id',group.id).then(({data})=>{
      setMembers((data||[]).map(m=>({user_id:m.user_id,name:m.profiles?.display_name||'Rider',avatarUrl:m.profiles?.avatar_url||null})));
    });
    supabase.from('group_stages').select('stage_id').eq('group_id',group.id).then(({data})=>{
      setGroupStageIds((data||[]).map(s=>s.stage_id));
    });
  },[group.id]);

  useEffect(()=>{
    if(!members||!groupStageIds)return;
    if(groupStageIds.length===0||members.length===0){setTimes([]);return;}
    const memberIds=members.map(m=>m.user_id);
    supabase.from('stage_times').select('stage_id,user_id,time_ms').in('stage_id',groupStageIds).in('user_id',memberIds).then(({data})=>{
      setTimes(data||[]);
    });
  },[members,groupStageIds]);

  const{stagesRidden,records,fastest}=useMemo(()=>{
    if(!members||!times)return{stagesRidden:[],records:[],fastest:[]};
    const bestMap={};
    times.forEach(t=>{
      const key=t.stage_id+'_'+t.user_id;
      if(!(key in bestMap)||t.time_ms<bestMap[key])bestMap[key]=t.time_ms;
    });
    const stagesCount={};
    Object.keys(bestMap).forEach(key=>{
      const userId=key.split('_')[1];
      stagesCount[userId]=(stagesCount[userId]||0)+1;
    });
    const bestPerStage={};
    Object.keys(bestMap).forEach(key=>{
      const idx=key.lastIndexOf('_');
      const stageId=key.substring(0,idx),userId=key.substring(idx+1);
      if(!bestPerStage[stageId]||bestMap[key]<bestPerStage[stageId].time){bestPerStage[stageId]={userId,time:bestMap[key]};}
    });
    const recordsCount={};
    Object.values(bestPerStage).forEach(({userId})=>{recordsCount[userId]=(recordsCount[userId]||0)+1;});
    const winsCount={};
    (groupStageIds||[]).forEach(stageId=>{
      const entries=members.map(m=>({userId:m.user_id,time:bestMap[stageId+'_'+m.user_id]})).filter(e=>e.time!==undefined);
      for(let i=0;i<entries.length;i++){
        for(let j=i+1;j<entries.length;j++){
          const winner=entries[i].time<entries[j].time?entries[i].userId:entries[j].userId;
          winsCount[winner]=(winsCount[winner]||0)+1;
        }
      }
    });
    const toRanked=(countMap)=>members.map(m=>({...m,value:countMap[m.user_id]||0})).filter(m=>m.value>0).sort((a,b)=>b.value-a.value);
    return{stagesRidden:toRanked(stagesCount),records:toRanked(recordsCount),fastest:toRanked(winsCount)};
  },[members,times,groupStageIds]);

  const shareGroup=()=>{
    const shareText=`Join my GATE group "${group.name}" — code: ${group.code}`;
    if(navigator.share){navigator.share({title:group.name,text:shareText}).catch(()=>{});}
    else if(navigator.clipboard){navigator.clipboard.writeText(group.code).then(()=>alert('Code copied to clipboard'));}
  };
  const copyCode=()=>{if(navigator.clipboard)navigator.clipboard.writeText(group.code).then(()=>alert('Code copied'));};

  const loading=members===null||groupStageIds===null||times===null;
  const noStages=groupStageIds!==null&&groupStageIds.length===0;

  if(subView){
    const dataMap={stages:{title:'Stages ridden',data:stagesRidden,fmt:v=>v},records:{title:'Records',data:records,fmt:v=>v},fastest:{title:'Fastest overall',data:fastest,fmt:v=>`${v} win${v===1?'':'s'}`}};
    const cfg=dataMap[subView];
    return(
      <div style={{height:"100%",display:"flex",flexDirection:"column",background:"#fff"}}>
        <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <button className="tap" onClick={()=>setSubView(null)} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
          <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>{cfg.title}</div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"16px"}}>
          {cfg.data.length===0?<div style={{textAlign:"center",padding:"40px 20px",color:C.muted,fontSize:13}}>Nothing here yet</div>:cfg.data.map((m,i)=>(
            <div key={m.user_id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:m.user_id===user.id?C.orangeL:"white",borderRadius:10,marginBottom:6,border:`1px solid ${m.user_id===user.id?C.orange:C.border}`}}>
              <PositionBadge pos={i+1} size={30}/>
              <Avatar size={30} url={m.avatarUrl}/>
              <div style={{flex:1,fontSize:13,fontWeight:m.user_id===user.id?700:500,color:C.text}}>{m.user_id===user.id?"You":m.name}</div>
              <div style={{fontSize:14,fontWeight:700,color:m.user_id===user.id?C.orange:C.text}}>{cfg.fmt(m.value)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:"#fff"}}>
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button className="tap" onClick={onBack} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:17,fontWeight:700,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{group.name}</div>
          <div style={{fontSize:12,color:C.muted}}>{members?members.length:'…'} members</div>
        </div>
        <button className="tap" onClick={shareGroup} style={{background:"none",border:"none",padding:6}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg></button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px"}}>
        {loading?<div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>:noStages?(
          <div style={{textAlign:"center",padding:"32px 20px",color:C.muted}}>
            <Icon.Flag size={32} color={C.mutedL}/>
            <div style={{fontSize:15,fontWeight:500,marginBottom:4,marginTop:12,color:C.text}}>No stages in this group yet</div>
            <div style={{fontSize:13,color:C.mutedL}}>Leaderboards fill in once stages are added</div>
          </div>
        ):(
          <>
            {[{key:'stages',title:'Stages ridden',data:stagesRidden,fmt:v=>v},{key:'records',title:'Records',data:records,fmt:v=>v},{key:'fastest',title:'Fastest overall',data:fastest,fmt:v=>`${v} win${v===1?'':'s'}`}].map(section=>(
              <div key={section.key} style={{marginBottom:20}}>
                <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>{section.title}</div>
                {section.data.length===0?(
                  <div style={{fontSize:13,color:C.mutedL,padding:"8px 0"}}>Nothing here yet</div>
                ):(
                  <>
                    {section.data.slice(0,3).map((m,i)=>(
                      <div key={m.user_id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:m.user_id===user.id?C.orangeL:"white",borderRadius:10,marginBottom:6,border:`1px solid ${m.user_id===user.id?C.orange:C.border}`}}>
                        <PositionBadge pos={i+1} size={30}/>
                        <Avatar size={30} url={m.avatarUrl}/>
                        <div style={{flex:1,fontSize:13,fontWeight:m.user_id===user.id?700:500,color:C.text}}>{m.user_id===user.id?"You":m.name}</div>
                        <div style={{fontSize:14,fontWeight:700,color:m.user_id===user.id?C.orange:C.text}}>{section.fmt(m.value)}</div>
                      </div>
                    ))}
                    {section.data.length>3&&<button className="tap" onClick={()=>setSubView(section.key)} style={{background:"none",border:"none",color:C.blue,fontSize:12,fontWeight:600,padding:"4px 0"}}>See more →</button>}
                  </>
                )}
              </div>
            ))}
          </>
        )}
                <button className="tap" onClick={onOpenMap} style={{width:"100%",background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"11px 16px",color:C.blue,fontSize:13,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon.Map size={15} color={C.blue}/>Group Map</button>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:C.surface,border:`1px dashed ${C.border}`,borderRadius:10,padding:"12px 14px",marginTop:8}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:0.6,textTransform:"uppercase"}}>Group code</div>
            <div style={{fontSize:16,fontWeight:800,color:C.text,letterSpacing:2,marginTop:2}}>{group.code}</div>
          </div>
          <button className="tap" onClick={copyCode} style={{background:"none",border:"none",padding:6}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        </div>
      </div>
    </div>
  );
}

function GroupMapScreen({group,stages,user,onBack,onAddStages}){
  const [groupStageIds,setGroupStageIds]=useState(null);
  const isCreator=group.created_by===user.id;
  useEffect(()=>{
    supabase.from('group_stages').select('stage_id').eq('group_id',group.id).then(({data})=>{
      setGroupStageIds((data||[]).map(s=>s.stage_id));
    });
  },[group.id]);
  const groupStages=groupStageIds?stages.filter(s=>groupStageIds.includes(s.id)):[];
  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:"#fff"}}>
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button className="tap" onClick={onBack} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>{group.name} · Map</div>
        {isCreator&&<button className="tap" onClick={onAddStages} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"7px 12px",color:C.blue,fontSize:13,fontWeight:600}}><Icon.Plus size={14} color={C.blue}/>Add</button>}
      </div>
      <div style={{flex:1,position:"relative"}}>
        {groupStageIds===null?(
          <div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>
        ):groupStages.length===0?(
          <div style={{padding:"48px 20px",textAlign:"center",color:C.muted}}>
            <Icon.Map size={32} color={C.mutedL}/>
            <div style={{fontSize:15,fontWeight:500,marginTop:12,marginBottom:4,color:C.text}}>No stages added yet</div>
            <div style={{fontSize:13,color:C.mutedL}}>{isCreator?"Tap Add to pick stages from the main map":"Ask the group creator to add stages"}</div>
          </div>
        ):(
          <MapboxStyleMap center={groupStages[0].start} zoom={12} stages={groupStages} onStagePress={s=>alert(`${s.name}\n${formatDist(haversine(s.start,s.finish))}`)}/>
        )}
      </div>
    </div>
  );
}

// ── Fatigue ───────────────────────────────────────────────────────────────────
const FADE_MIN_DAYS=4;
const FADE_SLOW_PCT=1;
const DEM_ZOOM=14;
const M_TO_FT=3.28084;

const fatCommas=v=>String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const fatSigned=v=>(v>=0?'+':'-')+Math.abs(v).toFixed(1)+'%';

const demHeight=(r,g,b)=>-10000+((r*65536+g*256+b)*0.1);

function lngLatToTile(lng,lat,z){
  const n=2**z,s=Math.sin(lat*Math.PI/180);
  return{x:(lng+180)/360*n,y:(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n};
}

function descentFromProfile(elev,win=3){
  if(!elev||elev.length<3)return 0;
  const sm=elev.map((_,i)=>{const w=Math.min(win,i,elev.length-1-i);let s=0,c=0;for(let k=i-w;k<=i+w;k++){s+=elev[k];c++;}return s/c;});
  let down=0;
  for(let i=1;i<sm.length;i++){const d=sm[i]-sm[i-1];if(d<0)down-=d;}
  return down;
}

const demTiles={};
function demTile(z,x,y){
  const key=`${z}/${x}/${y}`;
  if(!demTiles[key]){
    demTiles[key]=new Promise(res=>{
      const img=new Image();img.crossOrigin='anonymous';
      img.onload=()=>{try{const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(img,0,0);res(cx.getImageData(0,0,img.width,img.height));}catch(e){res(null);}};
      img.onerror=()=>res(null);
      img.src=`https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${key}.pngraw?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
    });
  }
  return demTiles[key];
}

async function elevationAt(lat,lng){
  const t=lngLatToTile(lng,lat,DEM_ZOOM),tx=Math.floor(t.x),ty=Math.floor(t.y);
  const img=await demTile(DEM_ZOOM,tx,ty);
  if(!img)return null;
  const sz=img.width,px=(t.x-tx)*sz-0.5,py=(t.y-ty)*sz-0.5;
  const x0=Math.max(0,Math.min(sz-2,Math.floor(px))),y0=Math.max(0,Math.min(sz-2,Math.floor(py)));
  const ax=Math.max(0,Math.min(1,px-x0)),ay=Math.max(0,Math.min(1,py-y0));
  const h=(xx,yy)=>{const i=(yy*sz+xx)*4;return demHeight(img.data[i],img.data[i+1],img.data[i+2]);};
  return h(x0,y0)*(1-ax)*(1-ay)+h(x0+1,y0)*ax*(1-ay)+h(x0,y0+1)*(1-ax)*ay+h(x0+1,y0+1)*ax*ay;
}

const DESC_KEY='gate_descent_ft_v1';
const readDescCache=()=>{try{return JSON.parse(localStorage.getItem(DESC_KEY)||'{}');}catch(e){return {};}};
const writeDescCache=o=>{try{localStorage.setItem(DESC_KEY,JSON.stringify(o));}catch(e){}};

async function stageDescentFt(stage){
  const line=stage.line_coords&&stage.line_coords.length>1?stage.line_coords:[stage.start,stage.finish];
  if(!line||line.length<2||!line[0]||!line[line.length-1])return null;
  const cum=[0];for(let i=1;i<line.length;i++)cum.push(cum[i-1]+haversine(line[i-1],line[i]));
  const total=cum[cum.length-1];
  if(total<20)return null;
  const sig=`${line.length}:${Math.round(total)}`;
  const cache=readDescCache(),hit=cache[stage.id];
  if(hit&&hit.sig===sig)return hit.ft;
  const step=Math.max(12,total/400),pts=[];
  for(let d=0,seg=0;d<=total;d+=step){
    while(seg<line.length-2&&cum[seg+1]<d)seg++;
    const span=cum[seg+1]-cum[seg],u=span>0?(d-cum[seg])/span:0;
    pts.push({lat:line[seg].lat+(line[seg+1].lat-line[seg].lat)*u,lng:line[seg].lng+(line[seg+1].lng-line[seg].lng)*u});
  }
  const elev=[];
  for(const p of pts){const e=await elevationAt(p.lat,p.lng);if(e===null)return null;elev.push(e);}
  const ft=Math.round(descentFromProfile(elev)*M_TO_FT/10)*10;
  cache[stage.id]={ft,sig};writeDescCache(cache);
  return ft;
}

function useStageDescents(grouped,stages){
  const [map,setMap]=useState(null);
  const ids=grouped?Object.keys(grouped).sort().join(','):'';
  useEffect(()=>{
    if(!grouped)return;
    let off=false;
    (async()=>{
      const out={};
      for(const id of Object.keys(grouped)){
        const s=stages.find(x=>String(x.id)===String(id));
        if(!s)continue;
        let ft=null;try{ft=await stageDescentFt(s);}catch(e){}
        if(off)return;
        if(ft)out[id]=ft;
      }
      setMap(out);
    })();
    return()=>{off=true;};
  },[ids,stages.length]);
  return map;
}

const dayStart=d=>{const x=new Date(d);return new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();};
const weekStart=d=>{const x=new Date(d),dow=(x.getDay()+6)%7;return new Date(x.getFullYear(),x.getMonth(),x.getDate()-dow).getTime();};

function fatigueModel(grouped,descents,mode='day'){
  if(!grouped||!descents)return null;
  const keyOf=mode==='week'?weekStart:dayStart,buckets={};
  Object.keys(grouped).forEach(id=>{
    const ft=descents[id];if(!ft)return;
    const runs=grouped[id],avg=runs.length>=3?runs.reduce((s,r)=>s+r.time_ms,0)/runs.length:null;
    runs.forEach(r=>{
      const k=keyOf(r.created_at),b=buckets[k]||(buckets[k]={t:k,ft:0,offs:[]});
      b.ft+=ft;if(avg)b.offs.push((r.time_ms-avg)/avg*100);
    });
  });
  const all=Object.values(buckets).sort((a,b)=>a.t-b.t).map(b=>({t:b.t,ft:Math.round(b.ft),off:b.offs.length?b.offs.reduce((s,v)=>s+v,0)/b.offs.length:null}));
  const scored=all.filter(b=>b.off!==null);
  if(scored.length<FADE_MIN_DAYS)return{ready:false,count:scored.length,mode};
  const byFt=scored.slice().sort((a,b)=>a.ft-b.ft),half=byFt.slice(0,Math.ceil(byFt.length/2));
  const base=half.reduce((s,b)=>s+b.off,0)/half.length;
  const bad=byFt.filter(b=>b.off-base>FADE_SLOW_PCT);
  let line;
  if(bad.length===0)line=byFt[byFt.length-1].ft;
  else{
    const lowestBad=Math.min(...bad.map(b=>b.ft)),ok=byFt.filter(b=>b.ft<lowestBad&&!bad.includes(b));
    line=ok.length?ok[ok.length-1].ft:lowestBad*0.8;
  }
  line=Math.max(500,Math.round(line/100)*100);
  const items=all.slice(-6),cur=all[all.length-1];
  const prev=scored.filter(b=>b!==cur).slice(-5);
  const usual=prev.length?prev.reduce((s,b)=>s+b.off,0)/prev.length:0;
  const load=cur.ft/line,slower=cur.off!==null&&cur.off-usual>FADE_SLOW_PCT;
  const status=load<0.7?{label:'Room to ride more',color:C.blue}:load<=1.1?{label:'On target',color:C.green}:slower?{label:'Over-riding',color:C.red}:{label:'Pushing it',color:C.yellow};
  return{ready:true,mode,items,line,cur,load,status,count:scored.length};
}

const barColour=(ft,off,line)=>ft/line<=1.1?C.green:(off!==null&&off>FADE_SLOW_PCT?C.red:C.yellow);
const dateLabel=t=>new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'short'});

function FatigueRing({size=56,r=22,stroke=6,load,children}){
  const circ=2*Math.PI*r,over=load>1;
  const dash=f=>`${(Math.max(0,Math.min(1,f))*circ).toFixed(1)} ${circ.toFixed(1)}`;
  const cx=size/2;
  return(
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{transform:"rotate(-90deg)"}}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={size>100?"#F0F0F0":C.border} strokeWidth={stroke}/>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={over||load<=0?"transparent":C.green} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={dash(over?0:load)}/>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={over?C.red:"transparent"} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={dash(over?load-1:0)}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{children}</div>
    </div>
  );
}

function FatigueHubTile({model,loading,onClick}){
  const body=(ring,sub)=><InsightHubTile onClick={onClick} title="Fatigue" ring={ring} sub={sub}/>;
  if(loading||!model)return body(<FatigueRing load={0}><span style={{fontSize:12,fontWeight:800,color:C.text}}>–</span></FatigueRing>,"Loading…");
  if(!model.ready)return body(<FatigueRing load={0}><span style={{fontSize:12,fontWeight:800,color:C.text}}>–</span></FatigueRing>,`Needs ${FADE_MIN_DAYS}+ days of riding · ${model.count} so far`);
  return body(
    <FatigueRing load={model.load}><span style={{fontSize:12,letterSpacing:-0.3,fontWeight:800,color:C.text}}>{Math.round(model.load*100)}%</span></FatigueRing>,
    `${model.status.label} · ${fatCommas(model.cur.ft)} ft last ${model.mode}`
  );
}

function FatigueScreen({grouped,descents}){
  const [mode,setMode]=useState('day');
  const [explain,setExplain]=useState(false);
  const model=useMemo(()=>fatigueModel(grouped,descents,mode),[grouped,descents,mode]);
  const dayModel=useMemo(()=>fatigueModel(grouped,descents,'day'),[grouped,descents]);
  if(!grouped||!descents)return <EmptyNote>Working out your descent…</EmptyNote>;
  if(!dayModel||!dayModel.ready)return <EmptyNote>Ride on {FADE_MIN_DAYS} different days to see your fade line. So far: {dayModel?dayModel.count:0}.</EmptyNote>;
  if(!model.ready)return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",padding:"16px 16px 0"}}><SegControl options={[{val:'day',label:'Day'},{val:'week',label:'Week'}]} value={mode} onChange={setMode}/></div>
      <EmptyNote>Ride in {FADE_MIN_DAYS} different weeks to see your weekly fade line. So far: {model.count}.</EmptyNote>
    </div>
  );
  const {items,line,cur,load,status}=model,unit=mode;
  const maxFt=Math.max(line,...items.map(i=>i.ft))*1.02;
  const barH=ft=>Math.round(ft/maxFt*84),lineBottom=Math.round(line/maxFt*84);
  return(
    <div>
      <div style={{padding:"24px 16px 20px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
        <div style={{margin:"0 auto",width:132}}>
          <FatigueRing size={132} r={56} stroke={10} load={load}>
            <div><div style={{fontSize:26,fontWeight:800,lineHeight:1,letterSpacing:-0.5,color:C.text}}>{fatCommas(cur.ft)}</div><div style={{fontSize:10,fontWeight:600,color:C.muted,marginTop:6,letterSpacing:0.6}}>FT, LAST {unit.toUpperCase()}</div></div>
          </FatigueRing>
        </div>
        <div style={{fontSize:20,fontWeight:800,color:status.color,marginTop:14}}>{status.label}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,padding:"16px 16px 0"}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12}}><div style={{fontSize:10,fontWeight:600,color:C.muted,letterSpacing:0.8}}>FADE STARTS AFTER</div><div style={{fontSize:14,fontWeight:700,marginTop:6,color:C.text}}>{fatCommas(line)} ft</div><div style={{fontSize:12,color:C.muted,fontWeight:600,marginTop:2}}>of descent in a {unit}</div></div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12}}><div style={{fontSize:10,fontWeight:600,color:C.muted,letterSpacing:0.8}}>BUILT FROM</div><div style={{fontSize:14,fontWeight:700,marginTop:6,color:C.text}}>{model.count} {unit}{model.count===1?'':'s'}</div><div style={{fontSize:12,color:C.muted,fontWeight:600,marginTop:2}}>needs {FADE_MIN_DAYS} to start</div></div>
      </div>
      <div style={{padding:"22px 16px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:600,color:C.text}}><div style={{width:22,height:0,borderTop:`2px dashed ${C.muted}`}}/><span>Fade line: {fatCommas(line)} ft</span></div>
          <SegControl options={[{val:'day',label:'Day'},{val:'week',label:'Week'}]} value={mode} onChange={setMode}/>
        </div>
        <div style={{position:"relative"}}>
          <div style={{display:"flex",alignItems:"flex-end",gap:10,height:86}}>
            {items.map((b,i)=>(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center",height:"100%"}}>
                <div style={{width:"100%",height:barH(b.ft),background:barColour(b.ft,b.off,line),borderRadius:"3px 3px 0 0"}}/>
              </div>
            ))}
          </div>
          <div style={{position:"absolute",left:0,right:0,bottom:lineBottom,borderTop:`1px dashed ${C.muted}`,height:0}}/>
        </div>
        <div style={{height:1,background:C.border}}/>
        <div style={{display:"flex",gap:10,marginTop:5}}>{items.map((b,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:10,fontWeight:600,color:C.muted}}>{dateLabel(b.t)}</div>)}</div>
        <div style={{display:"flex",gap:10,marginTop:3}}>{items.map((b,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:12,fontWeight:800,color:C.text}}>{fatCommas(b.ft)}</div>)}</div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:14,marginBottom:4}}>
          <div style={{fontSize:10,fontWeight:600,color:C.muted,letterSpacing:0.8}}>OFF YOUR AVERAGE TIME</div><div style={{fontSize:10,color:C.muted}}>minus = faster, plus = slower</div>
        </div>
        <div style={{display:"flex",gap:10}}>{items.map((b,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:12,fontWeight:800,color:b.off===null?C.mutedL:b.off>FADE_SLOW_PCT?C.red:b.off<-0.2?C.green:C.muted}}>{b.off===null?'–':fatSigned(b.off)}</div>)}</div>
      </div>
      <div style={{margin:"20px 16px 24px",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
        <button onClick={()=>setExplain(e=>!e)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 14px",background:"#fff",border:"none",textAlign:"left",fontSize:14,fontWeight:600,color:C.text}}>How it's worked out<span style={{color:C.muted,fontSize:12}}>{explain?'Hide':'Show'}</span></button>
        {explain&&<div style={{padding:"0 14px 14px",background:C.surface,fontSize:12,lineHeight:1.55,color:C.text}}>
          <div style={{paddingTop:12}}><b>Descent</b> is the height you drop on the stages you record, added up for each day or week. Climbs and transfers aren't recorded, so it counts the stage work only.</div>
          <div style={{marginTop:8}}><b>Off your average time:</b> each run is compared with your average time on that stage, then averaged for the day or week. Your average is steadier than your best, so one lucky run doesn't skew it.</div>
          <div style={{marginTop:8}}><b>The fade line:</b> the amount of descent after which your times start running more than 1% slower than normal, worked out from your own history. It improves the more you ride.</div>
          <div style={{marginTop:10,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"6px 12px",color:C.muted}}>
            <div><span style={{fontWeight:700,color:C.blue}}>Under 70%</span> of the line: Room to ride more</div><div><span style={{fontWeight:700,color:C.green}}>70-110%</span> On target</div>
            <div><span style={{fontWeight:700,color:C.yellow}}>Over 110%</span> Pushing it</div><div><span style={{fontWeight:700,color:C.red}}>Over 110%</span> and slower than usual: Over-riding</div>
          </div>
          <div style={{marginTop:10,color:C.muted}}>Needs {FADE_MIN_DAYS}+ days (or weeks) of riding to start. Track conditions and weather change times too, so treat it as a guide.</div>
        </div>}
      </div>
    </div>
  );
}

function StatisticsScreen({stages,courses,user,onBack,crCount,courseCRCount,stagesRiddenCount,coursesCompleteCount,courseCRList}){
  const [view,setView]=useState('hub');
  const [expandedCRCourse,setExpandedCRCourse]=useState(null);
  const titles={hub:"Statistics",stages:"Stages",courses:"Courses",fastest:"Stage records",records:"Course Records",myStages:"Your Stages",myCourses:"Your Courses",consistency:"Consistency",improvement:"Improvement",fatigue:"Fatigue"};
  const [myRuns,setMyRuns]=useState(null);
  const [consistencySort,setConsistencySort]=useState('most');
  const [showHowScored,setShowHowScored]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    supabase.from('stage_times').select('stage_id,time_ms,created_at').eq('user_id',user.id).order('created_at',{ascending:true}).then(({data})=>{if(!cancelled)setMyRuns(data||[]);});
    return()=>{cancelled=true;};
  },[user.id]);
  const runsByStage=useMemo(()=>{
    if(!myRuns)return null;
    const by={};
    myRuns.forEach(t=>{(by[t.stage_id]=by[t.stage_id]||[]).push(t);});
    return by;
  },[myRuns]);
  const impRows=useMemo(()=>improvementRows(runsByStage,stages),[runsByStage,stages]);
  const descents=useStageDescents(runsByStage,stages);
  const fatModel=useMemo(()=>fatigueModel(runsByStage,descents,'day'),[runsByStage,descents]);
  const consistency=useMemo(()=>{
    if(!myRuns)return null;
    const byStage={};
    myRuns.forEach(t=>{(byStage[t.stage_id]=byStage[t.stage_id]||[]).push(t);});
    const rows=[];
    Object.keys(byStage).forEach(id=>{
      const stage=stages.find(s=>String(s.id)===String(id));
      const res=consistencyFromRuns(byStage[id]);
      if(!stage||!res)return;
      rows.push({id:stage.id,name:stage.name,difficulty:stage.difficulty||'blue',...res});
    });
    if(rows.length===0)return{rows,overall:null};
    const overall=Math.round(rows.reduce((s,r)=>s+r.score,0)/rows.length);
    return{rows,overall};
  },[myRuns,stages]);
  const myStages=useMemo(()=>stages.filter(s=>s.created_by===user.id),[stages,user.id]);
  const myCourses=useMemo(()=>courses.filter(c=>c.created_by===user.id),[courses,user.id]);
  const [creatorStats,setCreatorStats]=useState(null);
  const myStageKey=myStages.map(s=>s.id).join(',');
  const myCourseKey=myCourses.map(c=>c.id).join(',');
  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      const stageRides={},stageRiders={},courseRides={},courseRiders={};
      const allStageRiders=new Set(),allCourseRiders=new Set();
      let stageTotal=0,courseTotal=0;
      if(myStages.length>0){
        const{data}=await supabase.from('stage_times').select('stage_id,user_id').in('stage_id',myStages.map(s=>s.id)).neq('user_id',user.id);
        (data||[]).forEach(t=>{stageTotal++;stageRides[t.stage_id]=(stageRides[t.stage_id]||0)+1;(stageRiders[t.stage_id]=stageRiders[t.stage_id]||new Set()).add(t.user_id);allStageRiders.add(t.user_id);});
      }
      if(myCourses.length>0){
        const{data}=await supabase.from('course_results').select('course_id,user_id').in('course_id',myCourses.map(c=>c.id)).neq('user_id',user.id);
        (data||[]).forEach(r=>{courseTotal++;courseRides[r.course_id]=(courseRides[r.course_id]||0)+1;(courseRiders[r.course_id]=courseRiders[r.course_id]||new Set()).add(r.user_id);allCourseRiders.add(r.user_id);});
      }
      if(cancelled)return;
      setCreatorStats({
        stageTotal,stageRiders:allStageRiders.size,courseTotal,courseRiders:allCourseRiders.size,
        stageRows:myStages.map(s=>({id:s.id,name:s.name,difficulty:s.difficulty||'blue',rides:stageRides[s.id]||0,riders:stageRiders[s.id]?stageRiders[s.id].size:0})).sort((a,b)=>b.rides-a.rides),
        courseRows:myCourses.map(c=>({id:c.id,name:c.name,rides:courseRides[c.id]||0,riders:courseRiders[c.id]?courseRiders[c.id].size:0})).sort((a,b)=>b.rides-a.rides),
      });
    };
    load();
    return()=>{cancelled=true;};
  },[myStageKey,myCourseKey,user.id]);
  const ridesIcon=<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
  const fmtStat=v=>v===null||v===undefined?"—":String(v);
  const creatorTiles=[
    {key:'stagesCreated',onClick:()=>setView('myStages'),icon:<Icon.Lightning size={20} color={C.muted}/>,value:String(myStages.length),label:"Stages created"},
    {key:'stageRides',onClick:()=>setView('myStages'),icon:ridesIcon,value:fmtStat(creatorStats&&creatorStats.stageTotal),label:"Rides on your stages"},
    {key:'coursesCreated',onClick:()=>setView('myCourses'),icon:<Icon.Flag size={20} color={C.muted}/>,value:String(myCourses.length),label:"Courses created"},
    {key:'courseRides',onClick:()=>setView('myCourses'),icon:ridesIcon,value:fmtStat(creatorStats&&creatorStats.courseTotal),label:"Rides on your courses"},
  ];
  const tiles=[
    {key:'cr',onClick:()=>setView('fastest'),content:<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><svg width="20" height="17" viewBox="0 0 24 20"><path d="M3 19l-1.5-10L7 13l5-9 5 9 5.5-4L20 19H3z" fill="#C9A227" stroke="#C9A227" strokeLinejoin="round" strokeWidth="1"/><rect x="3" y="17" width="17" height="2.6" rx="1" fill="#C9A227"/></svg><Icon.ChevronRight size={16} color={C.mutedL}/></div>
      <div><div style={{fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>{crCount}</div><div style={{fontSize:13,color:C.muted,marginTop:4}}>Stage records</div></div>
    </>},
    {key:'courseCr',onClick:()=>setView('records'),content:<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><svg width="20" height="17" viewBox="0 0 24 20"><path d="M3 19l-1.5-10L7 13l5-9 5 9 5.5-4L20 19H3z" fill="#C9A227" stroke="#C9A227" strokeLinejoin="round" strokeWidth="1"/><rect x="3" y="17" width="17" height="2.6" rx="1" fill="#C9A227"/></svg><Icon.ChevronRight size={16} color={C.mutedL}/></div>
      <div><div style={{fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>{courseCRCount}</div><div style={{fontSize:13,color:C.muted,marginTop:4}}>Course records</div></div>
    </>},
    {key:'stages',onClick:()=>setView('stages'),content:<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><Icon.Lightning size={20} color={C.muted}/><Icon.ChevronRight size={16} color={C.mutedL}/></div>
      <div><div style={{fontSize:16,fontWeight:700,color:C.text}}>Stages</div><div style={{fontSize:12,color:C.muted,marginTop:4}}>{stagesRiddenCount} ridden</div></div>
    </>},
    {key:'courses',onClick:()=>setView('courses'),content:<>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><Icon.Flag size={20} color={C.muted}/><Icon.ChevronRight size={16} color={C.mutedL}/></div>
      <div><div style={{fontSize:16,fontWeight:700,color:C.text}}>Courses</div><div style={{fontSize:12,color:C.muted,marginTop:4}}>{coursesCompleteCount} completed</div></div>
    </>},
  ];
  const crStages=stages.filter(s=>s.cr);
  return(
    <div style={{width:"100%",height:"100vh",display:"flex",flexDirection:"column",background:"#fff"}}>
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button className="tap" onClick={()=>view==='hub'?onBack():setView('hub')} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>{titles[view]}</div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {view==='hub'&&(
          <div style={{padding:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {tiles.map(t=>(
              <button key={t.key} className="tap" onClick={t.onClick} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"18px 16px",minHeight:118,display:"flex",flexDirection:"column",justifyContent:"space-between",textAlign:"left"}}>
                {t.content}
              </button>
            ))}
          </div>
        )}
        {view==='hub'&&(
          <div style={{padding:"0 16px 32px"}}>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",margin:"6px 0 10px"}}>Your creations</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {[creatorTiles[0],creatorTiles[2],creatorTiles[1],creatorTiles[3]].map(t=>(t.key==='stageRides'||t.key==='courseRides')?(
                <div key={t.key} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"18px 16px",minHeight:118,display:"flex",flexDirection:"column",justifyContent:"space-between",textAlign:"left"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>{t.icon}</div>
                  <div><div style={{fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>{t.value}</div><div style={{fontSize:13,color:C.muted,marginTop:4}}>{t.label}</div></div>
                </div>
              ):(
                <button key={t.key} className="tap" onClick={t.onClick} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"18px 16px",minHeight:118,display:"flex",flexDirection:"column",justifyContent:"space-between",textAlign:"left"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>{t.icon}<Icon.ChevronRight size={16} color={C.mutedL}/></div>
                  <div><div style={{fontSize:28,fontWeight:800,color:C.text,lineHeight:1}}>{t.value}</div><div style={{fontSize:13,color:C.muted,marginTop:4}}>{t.label}</div></div>
                </button>
              ))}
            </div>
          </div>
        )}
        {view==='hub'&&(
          <div style={{padding:"0 16px 32px"}}>
            <button className="tap" onClick={()=>setView('consistency')} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"16px",display:"flex",alignItems:"center",gap:14,textAlign:"left"}}>
              {consistency&&consistency.overall!==null?<ConsistencyRing score={consistency.overall} size={54}/>:<div style={{width:54,height:54,borderRadius:"50%",border:"5px solid #E6E6E6",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:C.mutedL,flexShrink:0}}>{consistency===null?"…":"—"}</div>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:16,fontWeight:700,color:C.text}}>Consistency</div>
                <div style={{fontSize:12,color:C.muted,marginTop:3}}>{consistency&&consistency.overall!==null?<><span style={{color:consistencyColor(consistency.overall),fontWeight:600}}>{consistencyLabel(consistency.overall)}</span> · across {consistency.rows.length} stage{consistency.rows.length===1?"":"s"}</>:consistency===null?"Loading…":"Ride a stage 3 times to get a score"}</div>
              </div>
              <Icon.ChevronRight size={16} color={C.mutedL}/>
            </button>
            <ImprovementHubTile rows={impRows} onClick={()=>setView('improvement')}/>
            <FatigueHubTile model={fatModel} loading={!descents} onClick={()=>setView('fatigue')}/>
          </div>
        )}
        {view==='consistency'&&(
          <div style={{paddingBottom:40}}>
            {consistency===null?<div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>:consistency.overall===null?(
              <div style={{textAlign:"center",padding:"48px 24px",color:C.muted,fontSize:13,lineHeight:1.5}}>No score yet. Ride a stage at least 3 times and your consistency will show up here.</div>
            ):(()=>{
              const rows=[...consistency.rows].sort((a,b)=>consistencySort==='most'?b.score-a.score:a.score-b.score);
              const best=[...consistency.rows].sort((a,b)=>b.score-a.score)[0];
              const worst=[...consistency.rows].sort((a,b)=>a.score-b.score)[0];
              const overallColor=consistencyColor(consistency.overall);
              return(
                <>
                  <div style={{padding:"28px 24px 22px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"center"}}><ConsistencyRing score={consistency.overall} size={150} stroke={9} fontSize={46} label="OUT OF 100"/></div>
                    <div style={{fontSize:24,fontWeight:800,color:overallColor,marginTop:14}}>{consistencyLabel(consistency.overall)}</div>
                    <div style={{fontSize:13,color:C.muted,marginTop:6,lineHeight:1.45}}>Average across {consistency.rows.length} stage{consistency.rows.length===1?"":"s"} with 3+ runs, using your last 5 on each.</div>
                  </div>
                  <div style={{padding:"16px 16px 0"}}>
                    {consistency.rows.length>1&&(
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[{k:"MOST CONSISTENT",r:best,c:C.green},{k:"ROOM TO TIGHTEN",r:worst,c:C.yellow}].map(x=>(
                          <div key={x.k} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px"}}>
                            <div style={{fontSize:10,fontWeight:600,color:C.muted,letterSpacing:0.8}}>{x.k}</div>
                            <div style={{fontSize:15,fontWeight:700,color:C.text,marginTop:5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.r.name}</div>
                            <div style={{fontSize:12,fontWeight:600,color:x.c,marginTop:3}}>{fmtSecs(x.r.avgGapMs)} spread</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"22px 0 6px"}}>
                      <span style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase"}}>By stage</span>
                      <button className="tap" onClick={()=>setConsistencySort(m=>m==='most'?'least':'most')} style={{background:"none",border:"none",padding:0,fontSize:12,fontWeight:600,color:C.blue}}>Sort: {consistencySort==='most'?'Most consistent':'Least consistent'} ▾</button>
                    </div>
                    {rows.map(r=>{
                      const dc=(DIFFICULTIES.find(d=>d.val===r.difficulty)||DIFFICULTIES[0]).color;
                      const col=consistencyColor(r.score);
                      return(
                        <div key={r.id} style={{padding:"13px 0",borderBottom:`1px solid ${C.border}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <DifficultyDiamond color={dc} size={14}/>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
                              <div style={{fontSize:12,color:C.muted,marginTop:1}}>{r.totalRuns} runs · {fmtSecs(r.avgGapMs)} off your best on average</div>
                            </div>
                            <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800,color:C.text,lineHeight:1}}>{r.score}</div><div style={{fontSize:11,fontWeight:600,color:col,marginTop:2}}>{r.label}</div></div>
                          </div>
                          <div style={{height:4,background:"#F0F0F0",borderRadius:2,marginTop:9}}><div style={{width:`${Math.max(r.score,3)}%`,height:4,background:col,borderRadius:2}}/></div>
                        </div>
                      );
                    })}
                    <button className="tap" onClick={()=>setShowHowScored(v=>!v)} style={{width:"100%",marginTop:18,background:"#fff",border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:14,fontWeight:700,color:C.text,textAlign:"left"}}>
                      How it's scored<span style={{fontSize:13,fontWeight:500,color:C.muted}}>{showHowScored?"Hide":"Show"}</span>
                    </button>
                    {showHowScored&&(
                      <div style={{fontSize:13,color:C.muted,lineHeight:1.55,padding:"12px 4px 0"}}>
                        For each stage with 3 or more runs, we take your last 5 and measure how far they are from your best of those runs, on average, as a share of your best time. 0% off scores 100 and 15% or more off scores 0. Your overall score is the average across your stages.
                        <div style={{marginTop:8}}><b style={{color:C.green}}>90+</b> Locked in · <b style={{color:C.blue}}>75+</b> Solid · <b style={{color:C.yellow}}>55+</b> Variable · <b style={{color:C.red}}>under 55</b> Scattered</div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}
        {view==='improvement'&&<ImprovementScreen rows={impRows}/>}
        {view==='fatigue'&&<FatigueScreen grouped={runsByStage} descents={descents}/>}
        {view==='myStages'&&(
          <div style={{padding:"16px 16px 40px"}}>
            {creatorStats===null?<div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>:creatorStats.stageRows.length===0?(
              <div style={{textAlign:"center",padding:"32px 20px",color:C.muted,fontSize:13}}>You haven't created any stages yet</div>
            ):(
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
                  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:C.text}}>{creatorStats.stageTotal}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Total rides</div></div>
                  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:C.text}}>{creatorStats.stageRiders}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Different riders</div></div>
                </div>
                <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",margin:"16px 0 4px"}}>Most popular</div>
                {creatorStats.stageRows.map(r=>{
                  const color=(DIFFICULTIES.find(d=>d.val===r.difficulty)||DIFFICULTIES[0]).color;
                  const max=creatorStats.stageRows[0].rides||1;
                  return(
                    <div key={r.id} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <svg width="16" height="16" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1.5" fill={color} transform="rotate(45 12 12)"/></svg>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div><div style={{fontSize:12,color:C.muted,marginTop:1}}>{r.riders} rider{r.riders===1?"":"s"}</div></div>
                        <div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:800,color:C.text}}>{r.rides}</div><div style={{fontSize:10,color:C.muted}}>ride{r.rides===1?"":"s"}</div></div>
                      </div>
                      <div style={{height:4,background:"#F0F0F0",borderRadius:2,marginTop:9}}><div style={{width:`${r.rides>0?Math.max((r.rides/max)*100,4):0}%`,height:4,background:color,borderRadius:2}}/></div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
        {view==='myCourses'&&(
          <div style={{padding:"16px 16px 40px"}}>
            {creatorStats===null?<div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading…</div>:creatorStats.courseRows.length===0?(
              <div style={{textAlign:"center",padding:"32px 20px",color:C.muted,fontSize:13}}>You haven't created any courses yet</div>
            ):(
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
                  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:C.text}}>{creatorStats.courseTotal}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Total rides</div></div>
                  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12,textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:C.text}}>{creatorStats.courseRiders}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Different riders</div></div>
                </div>
                <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",margin:"16px 0 4px"}}>Most popular</div>
                {creatorStats.courseRows.map(r=>{
                  const max=creatorStats.courseRows[0].rides||1;
                  return(
                    <div key={r.id} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <Icon.Flag size={16} color={C.blue}/>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div><div style={{fontSize:12,color:C.muted,marginTop:1}}>{r.riders} rider{r.riders===1?"":"s"}</div></div>
                        <div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:800,color:C.text}}>{r.rides}</div><div style={{fontSize:10,color:C.muted}}>ride{r.rides===1?"":"s"}</div></div>
                      </div>
                      <div style={{height:4,background:"#F0F0F0",borderRadius:2,marginTop:9}}><div style={{width:`${r.rides>0?Math.max((r.rides/max)*100,4):0}%`,height:4,background:C.blue,borderRadius:2}}/></div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
        {view==='stages'&&<ProgressSheet stages={stages} user={user}/>}
        {view==='courses'&&<CourseProgressSheet courses={courses} user={user}/>}
        {view==='fastest'&&(
          <div style={{padding:"0 16px 40px"}}>
            {crStages.length===0?<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>No stage records yet</div>:crStages.map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
                <GoldCrown size={20}/>
                <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{s.name}</div>
                <div style={{fontSize:14,fontWeight:700,color:"#92400E"}}>{formatTime(s.time)}</div>
              </div>
            ))}
          </div>
        )}
        {view==='records'&&(
          <div style={{padding:"16px 16px 40px"}}>
            {(!courseCRList||courseCRList.length===0)?<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>No course records yet</div>:courseCRList.map(c=>{
              const isOpen=expandedCRCourse===c.id;
              const trackNames=(c.stageIds||[]).map(id=>stages.find(s=>s.id===id)?.name).filter(Boolean);
              return(
                <div key={c.id} style={{marginBottom:8,border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
                  <button className="tap" onClick={()=>setExpandedCRCourse(isOpen?null:c.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:"#fff",border:"none",textAlign:"left"}}>
                    <GoldCrown size={20}/>
                    <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{c.name}</div>
                    <div style={{fontSize:14,fontWeight:700,color:"#92400E"}}>{formatTime(c.totalTime)}</div>
                    {isOpen?<Icon.ChevronUp size={14} color={C.mutedL}/>:<Icon.ChevronDown size={14} color={C.mutedL}/>}
                  </button>
                  {isOpen&&<div style={{padding:"8px 12px 12px",background:C.surface}}>
                    {trackNames.length===0?<div style={{fontSize:12,color:C.muted}}>No stages found</div>:trackNames.map((name,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0"}}>
                        <Icon.Lightning size={13} color={C.blue}/>
                        <div style={{fontSize:13,color:C.text}}>{i+1}. {name}</div>
                      </div>
                    ))}
                  </div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfileScreen({stages,settings,courseResults,pastWeeks,onSettingsPress,onGoToStages,onGoToCourses,onOpenProgress,onOpenBikeSetup}){
  const [selectedWeek,setSelectedWeek]=useState(pastWeeks.length-1);
  const stagesRidden=stages.filter(s=>s.time).length;
  const coursesComplete=courseResults.length;
  const w=pastWeeks[selectedWeek]||{stages:0,runs:0,mins:0,pbs:0,days:[false,false,false,false,false,false,false]};
  const weeksAgo=pastWeeks.length-1-selectedWeek;
  const weekLabel=weeksAgo===0?"This week":weeksAgo===1?"1 week ago":`${weeksAgo} weeks ago`;
  const fmtMins=m=>m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;
  const weekMax=Math.max(...pastWeeks.map(x=>x.mins),1);
  const dayLabels=["M","T","W","T","F","S","S"];
  const stats=[{label:"Stages",value:String(w.stages)},{label:"Runs",value:String(w.runs)},{label:"Time",value:fmtMins(w.mins)},{label:"New PBs",value:String(w.pbs),green:w.pbs>0}];
  return(
    <div>
      <div style={{background:"#fff",padding:"16px 20px 18px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div style={{width:60,height:60,borderRadius:"50%",background:C.surface,border:`2px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>{settings.avatarUrl?<img src={settings.avatarUrl} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<Icon.User size={28} color={C.muted}/>}</div>
          <div style={{flex:1}}><div style={{fontSize:20,fontWeight:800,color:C.text}}>{settings.displayName}</div></div>
          <button className="tap" onClick={onSettingsPress} style={{width:36,height:36,borderRadius:9,background:C.surface,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.Settings size={18} color={C.muted}/></button>
        </div>
        <div style={{display:"flex",gap:28}}>
          {[{label:"Followers",value:"—"},{label:"Stages Ridden",value:String(stagesRidden)},{label:"Courses Complete",value:String(coursesComplete)}].map(s=>(
            <div key={s.label}>
              <div style={{fontSize:11,color:C.muted,fontWeight:500}}>{s.label}</div>
              <div style={{fontSize:17,color:C.text,fontWeight:700,marginTop:3}}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{padding:"18px 16px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase"}}>Your week</div>
          <div style={{fontSize:12,color:C.muted}}>{weekLabel}</div>
        </div>
        <div style={{border:`1px solid ${C.border}`,borderRadius:14,padding:14}}>
          <div style={{display:"flex",gap:24,marginBottom:14}}>
            {stats.map(s=>(
              <div key={s.label}>
                <div style={{fontSize:20,fontWeight:800,color:s.green?C.green:C.text,lineHeight:1.1}}>{s.value}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:5}}>
            {dayLabels.map((l,i)=>(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                <div style={{width:"100%",height:5,borderRadius:3,background:w.days[i]?C.blue:"#F0F0F0"}}/>
                <div style={{fontSize:9,color:C.muted,fontWeight:500}}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{borderTop:`1px solid ${C.border}`,marginTop:14,paddingTop:12}}>
            <div style={{display:"flex",alignItems:"flex-end",gap:3,height:40,marginBottom:6}}>
              {pastWeeks.map((x,i)=>{
                const pct=x.mins>0?Math.max((x.mins/weekMax)*100,10):6;
                const on=i===selectedWeek;
                return(
                  <button key={i} onClick={()=>setSelectedWeek(i)} style={{flex:1,height:"100%",display:"flex",alignItems:"flex-end",background:"none",border:"none",padding:0,cursor:"pointer"}}>
                    <div style={{width:"100%",boxSizing:"border-box",height:`${pct}%`,background:on?`${C.blue}22`:C.mutedL,border:on?`1.5px solid ${C.blue}`:"none",borderRadius:2,minHeight:3}}/>
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div style={{fontSize:9,color:C.muted}}>12 wks ago</div>
              <div style={{fontSize:9,color:C.muted}}>Now</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{padding:"10px 16px 24px"}}>
        {[
          {label:"Statistics",Ic:Icon.BarChart,onClick:onOpenProgress},
          {label:"Stages",Ic:Icon.Lightning,onClick:onGoToStages},
          {label:"Courses",Ic:Icon.Flag,onClick:onGoToCourses},
          {label:"Bike Setup",Ic:Icon.Bike,onClick:onOpenBikeSetup},
          {label:"Posts",Ic:Icon.Image,onClick:null},
        ].map((item,i,arr)=>(
          <button key={item.label} className="tap" onClick={item.onClick||undefined} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"13px 0",background:"none",border:"none",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none",textAlign:"left"}}>
            <item.Ic size={18} color={C.muted}/>
            <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{item.label}</div>
            <Icon.ChevronRight size={16} color={C.mutedL}/>
          </button>
        ))}
      </div>

      <div style={{padding:"0 16px 60px"}}>
        <button className="tap" onClick={onSettingsPress} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",borderBottom:`1px solid ${C.border}`,background:"none",color:C.text,fontSize:14,fontWeight:500}}>
          Settings<Icon.ChevronRight/>
        </button>
        {["Connected Apps","Privacy"].map((item,i)=>(
          <button key={item} className="tap" style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",borderBottom:i<1?`1px solid ${C.border}`:"none",background:"none",color:C.text,fontSize:14,fontWeight:500}}>
            {item}<Icon.ChevronRight/>
          </button>
        ))}
        <button className="tap" onClick={async()=>{try{if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration();const sub=reg&&await reg.pushManager.getSubscription();if(sub)await supabase.rpc('remove_push_subscription',{p_endpoint:sub.endpoint});}}catch(e){}supabase.auth.signOut();}} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",background:"none",color:C.red,fontSize:14,fontWeight:500,border:"none"}}>Sign Out<Icon.ChevronRight/></button>
      </div>
    </div>
  );
}

function ProfileView({stages,settings,courseResults,weeklyActivity,pastWeeks,courseCRCount,onSettingsPress,onStatPress,onGoToStages,onGoToCourses,onOpenProgress,onOpenBikeSetup}){
  const [selectedWeek,setSelectedWeek]=useState(pastWeeks.length-1);
  const stagesRidden=stages.filter(s=>s.time).length;
  const coursesComplete=courseResults.length;
  const crCount=stages.filter(s=>s.cr).length;
  const dayMax=Math.max(...weeklyActivity.meters,1);
  const weekMaxMins=Math.max(...pastWeeks.map(w=>w.mins),1);
  const weekLabel=weeksAgo=>weeksAgo===0?"This Week":weeksAgo===1?"1 Week Ago":`${weeksAgo} Weeks Ago`;
  const selectedMins=pastWeeks[selectedWeek].mins;

  return(
    <div>
      <div style={{background:"#fff",padding:"16px 20px 18px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div style={{width:60,height:60,borderRadius:"50%",background:C.surface,border:`2px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>{settings.avatarUrl?<img src={settings.avatarUrl} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<Icon.User size={28} color={C.muted}/>}</div>
          <div style={{flex:1}}><div style={{fontSize:20,fontWeight:800,color:C.text}}>{settings.displayName}</div></div>
          <button className="tap" onClick={onSettingsPress} style={{width:36,height:36,borderRadius:9,background:C.surface,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.Settings size={18} color={C.muted}/></button>
        </div>

        <div style={{display:"flex",gap:28}}>
          {[
            {label:"Followers",value:"—"},
            {label:"Stages Ridden",value:String(stagesRidden)},
            {label:"Courses Complete",value:String(coursesComplete)},
          ].map(s=>(
            <div key={s.label}>
              <div style={{fontSize:11,color:C.muted,fontWeight:500}}>{s.label}</div>
              <div style={{fontSize:17,color:C.text,fontWeight:700,marginTop:3}}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{padding:"14px 16px 0"}}>
        <div style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Activity This Week</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:30,marginBottom:5}}>
          {weeklyActivity.meters.map((m,i)=>{
            const pct=m>0?Math.max((m/dayMax)*100,10):4;
            return(
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <div style={{width:"100%",height:`${pct}%`,background:m>0?C.blue:"#F0F0F0",borderRadius:2,minHeight:2}}/>
                <div style={{fontSize:8,color:C.muted,fontWeight:500}}>{weeklyActivity.dayLabels[i]}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{padding:"18px 16px 0"}}>
        <div style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>{weekLabel(pastWeeks.length-1-selectedWeek)}</div>

        <div style={{display:"flex",gap:28,marginBottom:16}}>
          <div>
            <div style={{fontSize:13,color:C.muted}}>Stages</div>
            <div style={{fontSize:18,fontWeight:800,color:C.text,marginTop:3}}>{pastWeeks[selectedWeek].stages}</div>
          </div>
          <div>
            <div style={{fontSize:13,color:C.muted}}>Time</div>
            <div style={{fontSize:18,fontWeight:800,color:C.text,marginTop:3}}>{selectedMins>=60?`${Math.floor(selectedMins/60)}h ${selectedMins%60}m`:`${selectedMins}m`}</div>
          </div>
          <div>
            <div style={{fontSize:13,color:C.muted}}>Descent</div>
            <div style={{fontSize:18,fontWeight:800,color:C.text,marginTop:3}}>—</div>
          </div>
        </div>

        <div style={{display:"flex",alignItems:"flex-end",gap:3,height:44,marginBottom:6}}>
          {pastWeeks.map((w,i)=>{
            const pct=w.mins>0?Math.max((w.mins/weekMaxMins)*100,10):6;
            const isSelected=i===selectedWeek;
            return(
              <button key={i} onClick={()=>setSelectedWeek(i)} style={{flex:1,height:"100%",display:"flex",alignItems:"flex-end",background:"none",border:"none",padding:0,cursor:"pointer"}}>
                <div style={{width:"100%",boxSizing:"border-box",height:`${pct}%`,background:isSelected?`${C.blue}22`:C.mutedL,border:isSelected?`1.5px solid ${C.blue}`:"none",borderRadius:2,minHeight:3}}/>
              </button>
            );
          })}
        </div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <div style={{fontSize:9,color:C.muted}}>12 wks ago</div>
          <div style={{fontSize:9,color:C.muted}}>Now</div>
        </div>
      </div>

      <div style={{padding:"0 16px 24px"}}>
               {[
          {label:"Statistics",Ic:Icon.BarChart,onClick:onOpenProgress},
          {label:"Stages",Ic:Icon.Lightning,onClick:onGoToStages},
         {label:"Courses",Ic:Icon.Flag,onClick:onGoToCourses},
         {label:"Bike Setup",Ic:Icon.Bike,onClick:onOpenBikeSetup},
          {label:"Posts",Ic:Icon.Image,onClick:null},
        ].map((item,i,arr)=>(
          <button key={item.label} className="tap" onClick={item.onClick||undefined} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"13px 0",background:"none",border:"none",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none",textAlign:"left"}}>
            <item.Ic size={18} color={C.muted}/>
            <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{item.label}</div>
            <Icon.ChevronRight size={16} color={C.mutedL}/>
          </button>
        ))}
      </div>

      <div style={{padding:"0 16px 60px"}}>
        <button className="tap" onClick={onSettingsPress} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",borderBottom:`1px solid ${C.border}`,background:"none",color:C.text,fontSize:14,fontWeight:500}}>
          Settings<Icon.ChevronRight/>
        </button>
        {["Connected Apps","Privacy"].map((item,i)=>(
          <button key={item} className="tap" style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",borderBottom:i<1?`1px solid ${C.border}`:"none",background:"none",color:C.text,fontSize:14,fontWeight:500}}>
            {item}<Icon.ChevronRight/>
          </button>
        ))}
        <button className="tap" onClick={async()=>{try{if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration();const sub=reg&&await reg.pushManager.getSubscription();if(sub)await supabase.rpc('remove_push_subscription',{p_endpoint:sub.endpoint});}}catch(e){}supabase.auth.signOut();}} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",background:"none",color:C.red,fontSize:14,fontWeight:500,border:"none"}}>Sign Out<Icon.ChevronRight/></button>
      </div>
    </div>
  );
}

// ── Stage Builder ─────────────────────────────────────────────────────────────
  function pointAtDistance(coords,targetDist){
 if(!coords||coords.length<2)return coords&&coords[0]?coords[0]:null;
 let acc=0;
 for(let i=0;i<coords.length-1;i++){
 const a=coords[i],b=coords[i+1];
 const segDist=haversine(a,b);
 if(acc+segDist>=targetDist){
 const remain=targetDist-acc;
 const frac=segDist===0?0:remain/segDist;
 return{lat:a.lat+(b.lat-a.lat)*frac,lng:a.lng+(b.lng-a.lng)*frac};
 }
 acc+=segDist;
 } 
 return coords[coords.length-1];
 }
 function trimLineFromStart(coords,targetDist){
 if(!coords||coords.length<2)return coords||[];
 let acc=0;
 for(let i=0;i<coords.length-1;i++){
 const a=coords[i],b=coords[i+1];
 const segDist=haversine(a,b);
 if(acc+segDist>=targetDist){
 const remain=targetDist-acc;
 const frac=segDist===0?0:remain/segDist;
 const point={lat:a.lat+(b.lat-a.lat)*frac,lng:a.lng+(b.lng-a.lng)*frac};
 return[point,...coords.slice(i+1)];
 }
 acc+=segDist;
 }
 return[coords[coords.length-1]];
 }
 function StageBuilderSheet({onClose,onSave}){
  const [name,setName]=useState("");
  const [difficulty,setDifficulty]=useState("blue");
  const [builtBy,setBuiltBy]=useState("");
  const [privacy,setPrivacy]=useState("private");
  const [start,setStart]=useState(null);
  const [finish,setFinish]=useState(null);
  const [recording,setRecording]=useState(false);
  const [lineCoords,setLineCoords]=useState([]);
  const trackRef=useRef(null);
  const simulatePlace=()=>{if(!navigator.geolocation){alert("GPS not available");return;}navigator.geolocation.getCurrentPosition(pos=>{const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};if(!start){setStart(loc);setLineCoords([loc]);setRecording(true);trackRef.current=navigator.geolocation.watchPosition(p=>setLineCoords(prev=>[...prev,{lat:p.coords.latitude,lng:p.coords.longitude}]),err=>console.log(err),{enableHighAccuracy:true,maximumAge:0});}else if(!finish){setFinish(loc);setRecording(false);navigator.geolocation.clearWatch(trackRef.current);const fullLine=[...lineCoords,loc];let total=0;for(let i=0;i<fullLine.length-1;i++)total+=haversine(fullLine[i],fullLine[i+1]);if(total>25){const trimmed=trimLineFromStart(fullLine,25);if(trimmed&&trimmed.length>0){setStart(trimmed[0]);setLineCoords(trimmed);}else{setLineCoords(fullLine);}}else{setLineCoords(fullLine);}}},err=>alert("Could not get location — make sure GPS is on"),{enableHighAccuracy:true,timeout:10000});};

    const canSave=name.trim()&&start&&finish;
  const dist=start&&finish?haversine(start,finish):null;
  return(
    <div style={{padding:"0 16px 60px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <div style={{fontSize:17,fontWeight:700,color:C.text}}>New Stage</div>
        <button className="tap" onClick={onClose} style={{background:C.surface,borderRadius:8,padding:"6px 14px",color:C.text,fontSize:13,fontWeight:500,border:`1px solid ${C.border}`}}>Cancel</button>
      </div>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Stage name" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,color:C.text,background:C.surface,marginBottom:16}}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        {[{label:"Start Gate",color:C.green,gate:start},{label:"Finish Gate",color:C.red,gate:finish}].map(({label,color,gate})=>(
          <div key={label} style={{background:gate?`${color}10`:C.surface,border:`1.5px solid ${gate?color:C.border}`,borderRadius:12,padding:"13px 12px"}}>
            <div style={{fontSize:10,fontWeight:600,color:gate?color:C.muted,letterSpacing:0.8,marginBottom:4}}>{label.toUpperCase()}</div>
            {gate?<div style={{fontSize:11,color,fontWeight:500}}>{gate.lat.toFixed(4)}, {gate.lng.toFixed(4)}</div>:<div style={{fontSize:12,color:C.muted}}>Not placed</div>}
          </div>
        ))}
      </div>
      <button className="tap" onClick={simulatePlace} style={{width:"100%",background:C.surface,border:`1px dashed ${C.border}`,borderRadius:10,padding:"11px",fontSize:13,color:C.muted,marginBottom:dist?8:16,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <Icon.Location size={16} color={C.muted}/>{!start?"Place Start Gate":!finish?"Place Finish Gate":"Both gates placed ✓"}
      </button>
      {dist&&<div style={{textAlign:"center",fontSize:13,color:C.blue,marginBottom:16,fontWeight:600}}>Stage length: {formatDist(dist)}</div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
        {[{val:"private",label:"Private",Icon:Icon.Lock},{val:"group",label:"Group",Icon:Icon.Users},{val:"public",label:"Public",Icon:Icon.Globe}].map(({val,label,Icon:Ic})=>(
          <button key={val} className="tap" onClick={()=>setPrivacy(val)} style={{background:privacy===val?C.orangeL:C.surface,border:`1.5px solid ${privacy===val?C.orange:C.border}`,borderRadius:10,padding:"12px 8px",textAlign:"center",transition:"all 0.15s"}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:4}}><Ic size={16} color={privacy===val?C.orange:C.muted}/></div>
            <div style={{fontSize:12,fontWeight:privacy===val?600:400,color:privacy===val?C.orange:C.text}}>{label}</div>
          </button>
        ))}
      </div>
      <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Difficulty</div>
      <div style={{marginBottom:16}}><DifficultyPicker value={difficulty} onChange={setDifficulty}/></div>
      <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Trail built by <span style={{textTransform:"none",letterSpacing:0,fontWeight:400}}>(optional)</span></div>
      <input value={builtBy} onChange={e=>setBuiltBy(e.target.value)} maxLength={60} placeholder="Give the builders credit" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"12px 14px",fontSize:14,color:C.text,background:C.surface,marginBottom:16}}/>
       <button className="tap" onClick={()=>canSave&&onSave({id:Date.now(),name:name.trim(),start,finish,privacy,difficulty,builtBy:builtBy.trim(),time:null,cr:false,crHolder:null,crDate:null,lineCoords})}
        style={{width:"100%",background:canSave?C.orange:C.surface,border:"none",borderRadius:12,padding:15,color:canSave?"#fff":C.muted,fontSize:15,fontWeight:700,transition:"all 0.2s"}}>
        {canSave?"Create Stage":"Complete all fields"}
      </button>
    </div>
  );
}

// ── Course Builder Sheet ──────────────────────────────────────────────────────
 function CourseStagesMap({courseStages}){
  const mapContainer=useRef(null);
  const map=useRef(null);
  const layerIdsRef=useRef([]);
  const markersRef=useRef([]);
  const stageIdsKey=courseStages.map(s=>s.id).join(',');

  const drawStages=()=>{
    if(!map.current||!map.current.isStyleLoaded())return;
    layerIdsRef.current.forEach(id=>{
      if(map.current.getLayer(id))map.current.removeLayer(id);
      if(map.current.getSource(id))map.current.removeSource(id);
    });
    layerIdsRef.current=[];
    markersRef.current.forEach(m=>m.remove());
    markersRef.current=[];
    if(courseStages.length===0)return;
    const boundsPoints=[];
    courseStages.forEach((stage,i)=>{
      const coords=stage.line_coords&&stage.line_coords.length>1?stage.line_coords:[stage.start,stage.finish];
      coords.forEach(c=>boundsPoints.push([c.lng,c.lat]));
      const id='course-line-'+stage.id;
      map.current.addSource(id,{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:coords.map(c=>[c.lng,c.lat])}}});
      map.current.addLayer({id,type:'line',source:id,paint:{'line-color':'#2563EB','line-width':4,'line-opacity':0.9}});
      layerIdsRef.current.push(id);
      const el=document.createElement('div');
      el.style.cssText='width:24px;height:24px;border-radius:50%;background:#2563EB;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:Inter,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);';
      el.textContent=String(i+1);
      const marker=new window.mapboxgl.Marker({element:el}).setLngLat([stage.start.lng,stage.start.lat]).addTo(map.current);
      markersRef.current.push(marker);
    });
    if(boundsPoints.length>0){
      const lats=boundsPoints.map(p=>p[1]),lngs=boundsPoints.map(p=>p[0]);
      map.current.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:40,duration:400});
    }
  };

  useEffect(()=>{
    if(map.current)return;
    const token=import.meta.env.VITE_MAPBOX_TOKEN;
    if(!token)return;
    import('https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js').then(()=>{
      const mapboxgl=window.mapboxgl;
      mapboxgl.accessToken=token;
      map.current=new mapboxgl.Map({container:mapContainer.current,style:'mapbox://styles/mapbox/outdoors-v12',center:[DEFAULT_CENTER.lng,DEFAULT_CENTER.lat],zoom:11});
      map.current.on('load',()=>{drawStages();});
    });
  },[]);

  useEffect(()=>{if(map.current&&map.current.isStyleLoaded())drawStages();},[stageIdsKey]);

  return(
    <div style={{position:"relative",width:"100%",height:170,borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`}}>
      <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet"/>
      <div ref={mapContainer} style={{width:"100%",height:"100%"}}/>
    </div>
  );
}
function CourseStagePickerMap({stages,selectedIds,onToggle}){
  const mapContainer=useRef(null);
  const map=useRef(null);
  const markersRef=useRef([]);
  const onToggleRef=useRef(onToggle);
  useEffect(()=>{onToggleRef.current=onToggle;},[onToggle]);

  const midpoint=(stage)=>{
    if(stage.line_coords&&stage.line_coords.length>1){
      const raw=stage.line_coords;
      const coords=[raw[0]];
      for(let i=1;i<raw.length;i++){if(haversine(coords[coords.length-1],raw[i])<100){coords.push(raw[i]);}}
      if(coords.length<2)coords.push(raw[raw.length-1]);
      let totalLen=0;const segLens=[];
      for(let i=0;i<coords.length-1;i++){const d=haversine(coords[i],coords[i+1]);segLens.push(d);totalLen+=d;}
      const halfLen=totalLen/2;let acc=0,midPoint=coords[0];
      for(let i=0;i<segLens.length;i++){if(acc+segLens[i]>=halfLen){const remain=halfLen-acc;const frac=segLens[i]>0?remain/segLens[i]:0;midPoint={lat:coords[i].lat+(coords[i+1].lat-coords[i].lat)*frac,lng:coords[i].lng+(coords[i+1].lng-coords[i].lng)*frac};break;}acc+=segLens[i];}
      return midPoint;
    }
    return{lat:(stage.start.lat+stage.finish.lat)/2,lng:(stage.start.lng+stage.finish.lng)/2};
  };

  const rebuildMarkers=()=>{
    if(!map.current)return;
    markersRef.current.forEach(m=>m.remove());
    markersRef.current=[];
    stages.forEach(stage=>{
      const idx=selectedIds.indexOf(stage.id);
      const on=idx>=0;
      const pt=midpoint(stage);
      const el=document.createElement('div');
      el.style.cssText='display:flex;flex-direction:column;align-items:center;cursor:pointer;';
      el.innerHTML=on
        ?`<div style="width:30px;height:30px;border-radius:50%;background:#2563EB;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;font-family:Inter,sans-serif;">${idx+1}</div><div style="margin-top:2px;font-size:10px;font-weight:600;color:#1A1A1A;background:rgba(255,255,255,0.9);border-radius:4px;padding:1px 5px;white-space:nowrap;">${stage.name}</div>`
        :`<div style="width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid #C4C4C4;box-shadow:0 2px 6px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;"><svg width="13" height="13" viewBox="0 0 24 24"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" fill="#8A8A8A"/></svg></div><div style="margin-top:2px;font-size:10px;font-weight:600;color:#6B6B6B;background:rgba(255,255,255,0.9);border-radius:4px;padding:1px 5px;white-space:nowrap;">${stage.name}</div>`;
      el.addEventListener('click',()=>onToggleRef.current(stage.id));
      const marker=new window.mapboxgl.Marker({element:el}).setLngLat([pt.lng,pt.lat]).addTo(map.current);
      markersRef.current.push(marker);
    });
  };

  useEffect(()=>{
    if(map.current)return;
    const token=import.meta.env.VITE_MAPBOX_TOKEN;
    if(!token)return;
    import('https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js').then(()=>{
      const mapboxgl=window.mapboxgl;
      mapboxgl.accessToken=token;
      const opts={container:mapContainer.current,style:'mapbox://styles/mapbox/outdoors-v12'};
      if(stages.length>0){
        const pts=stages.map(s=>midpoint(s));
        const lats=pts.map(p=>p.lat),lngs=pts.map(p=>p.lng);
        opts.bounds=[[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]];
        opts.fitBoundsOptions={padding:60};
      } else {
        opts.center=[DEFAULT_CENTER.lng,DEFAULT_CENTER.lat];
        opts.zoom=12;
      }
      map.current=new mapboxgl.Map(opts);
      map.current.on('load',()=>{rebuildMarkers();});
    });
  },[]);

  useEffect(()=>{if(map.current&&map.current.loaded())rebuildMarkers();},[selectedIds,stages]);

  return(
    <div style={{position:"relative",width:"100%",height:"100%"}}>
      <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet"/>
      <div ref={mapContainer} style={{width:"100%",height:"100%"}}/>
    </div>
  );
}
function CourseBuilderSheet({stages,course,onClose,onSave}){
  const [name,setName]=useState(course?.name||"");
  const [privacy,setPrivacy]=useState(course?.privacy||"group");
  const [selectedIds,setSelectedIds]=useState(course?.stageIds||[]);
  const [mode,setMode]=useState(course?.mode||"race");
  const [pickMode,setPickMode]=useState("list");
  const toggle=id=>setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const moveUp=i=>{if(i===0)return;setSelectedIds(prev=>{const a=[...prev];[a[i-1],a[i]]=[a[i],a[i-1]];return a;});};
  const moveDown=i=>setSelectedIds(prev=>{if(i===prev.length-1)return prev;const a=[...prev];[a[i],a[i+1]]=[a[i+1],a[i]];return a;});
  const totalDist=selectedIds.reduce((acc,id)=>{const s=stages.find(x=>x.id===id);return s?acc+haversine(s.start,s.finish):acc;},0);
  const canSave=name.trim()&&selectedIds.length>=2;

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:"#fff"}}>
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div>
          <div style={{fontSize:17,fontWeight:700,color:C.text}}>{course?"Edit Course":"Build Course"}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{course?"Rename, add or remove stages":"String stages into a race"}</div>
        </div>
        <button className="tap" onClick={onClose} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",color:C.text,fontSize:13}}>Close</button>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"16px"}}>

        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Course name e.g. Sunday Enduro" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,color:C.text,background:C.surface,marginBottom:20}}/>

        <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Course Mode</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
          {COURSE_MODES.map(m=>(
            <button key={m.id} className="tap" onClick={()=>setMode(m.id)} style={{display:"flex",alignItems:"flex-start",gap:12,background:mode===m.id?`${C.blue}10`:C.surface,border:`1.5px solid ${mode===m.id?C.blue:C.border}`,borderRadius:14,padding:"14px 16px",textAlign:"left",transition:"all 0.15s"}}>
              <div style={{width:24,flexShrink:0,display:"flex",alignItems:"center"}}><m.Ic size={20} color={mode===m.id?C.blue:C.muted}/></div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700,color:mode===m.id?C.blue:C.text,marginBottom:2}}>{m.label}</div>
                <div style={{fontSize:12,color:C.muted,lineHeight:1.4}}>{m.desc}</div>
              </div>
              {mode===m.id&&<Icon.Check size={18} color={C.blue}/>}
            </button>
          ))}
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase"}}>Select Stages ({selectedIds.length} selected)</div>
          <div style={{display:"flex",background:C.surface,borderRadius:8,padding:2}}>
            {["list","map"].map(m=>(
              <button key={m} className="tap" onClick={()=>setPickMode(m)} style={{padding:"5px 10px",borderRadius:6,background:pickMode===m?"#fff":"none",border:"none",fontSize:11,fontWeight:pickMode===m?600:400,color:pickMode===m?C.text:C.muted,boxShadow:pickMode===m?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>{m==="list"?"List":"Map"}</button>
            ))}
          </div>
        </div>

        {pickMode==="list"?stages.map(stage=>{
          const on=selectedIds.includes(stage.id),pos=selectedIds.indexOf(stage.id);
          return(
            <button key={stage.id} className="tap" onClick={()=>toggle(stage.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,background:on?`${C.blue}0D`:C.surface,border:`1px solid ${on?C.blue:C.border}`,borderRadius:12,padding:"12px 14px",marginBottom:8,textAlign:"left",transition:"all 0.15s"}}>
              <div style={{width:28,height:28,borderRadius:"50%",background:on?C.blue:"#E0E0E0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:on?"white":"#999",flexShrink:0}}>{on?pos+1:"·"}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:500,color:on?C.text:C.muted}}>{stage.name}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{formatDist(haversine(stage.start,stage.finish))} · {stage.privacy}</div>
              </div>
              {on&&<Icon.Check size={18} color={C.blue}/>}
            </button>
          );
        }):(
          <div style={{marginBottom:16}}>
            <div style={{textAlign:"center",fontSize:12,fontWeight:600,color:C.blue,background:`${C.blue}10`,borderRadius:8,padding:"8px",marginBottom:8}}>
              {selectedIds.length===0?"Tap a stage to add it as Stage 1":`Tap a stage to add it as Stage ${selectedIds.length+1}`}
            </div>
            <div style={{width:"100%",height:420,borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`}}>
              <CourseStagePickerMap stages={stages} selectedIds={selectedIds} onToggle={toggle}/>
            </div>
          </div>
        )}

        {selectedIds.length>0&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Route Preview</div>
            <CourseStagesMap courseStages={selectedIds.map(id=>stages.find(s=>s.id===id)).filter(Boolean)}/>
          </div>
        )}

        {selectedIds.length>=2&&(
          <div style={{marginTop:4,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Stage Order</div>
            {selectedIds.map((id,i)=>{
              const stage=stages.find(s=>s.id===id);
              if(!stage)return null;
              return(
                <div key={id} style={{display:"flex",alignItems:"center",gap:10,background:"white",border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",marginBottom:6}}>
                  <div style={{width:24,height:24,borderRadius:"50%",background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"white",flexShrink:0}}>{i+1}</div>
                  <div style={{flex:1,fontSize:13,fontWeight:500,color:C.text}}>{stage.name}</div>
                  <div style={{display:"flex",gap:4}}>
                    <button className="tap" onClick={e=>{e.stopPropagation();moveUp(i);}} style={{width:28,height:28,borderRadius:6,background:C.surface,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.ChevronUp size={14} color={i===0?C.mutedL:C.text}/></button>
                    <button className="tap" onClick={e=>{e.stopPropagation();moveDown(i);}} style={{width:28,height:28,borderRadius:6,background:C.surface,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.ChevronDown size={14} color={i===selectedIds.length-1?C.mutedL:C.text}/></button>
                  </div>
                </div>
              );
            })}
            {totalDist>0&&<div style={{textAlign:"center",fontSize:13,color:C.blue,fontWeight:600,marginTop:8}}>Total: {formatDist(totalDist)}</div>}
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
          {[{val:"private",label:"Private"},{val:"group",label:"Group"},{val:"public",label:"Public"}].map(p=>(
            <button key={p.val} className="tap" onClick={()=>setPrivacy(p.val)} style={{background:privacy===p.val?`${C.blue}10`:C.surface,border:`1.5px solid ${privacy===p.val?C.blue:C.border}`,borderRadius:10,padding:"11px 8px",textAlign:"center",fontSize:13,fontWeight:privacy===p.val?600:400,color:privacy===p.val?C.blue:C.text,transition:"all 0.15s"}}>{p.label}</button>
          ))}
        </div>

      </div>

      <div style={{padding:"12px 16px",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
        <button className="tap" onClick={()=>canSave&&onSave({id:course?.id||Date.now(),name:name.trim(),stageIds:selectedIds,privacy,mode,times:{},bestPerStage:{}})} style={{width:"100%",background:canSave?"#fff":C.surface,border:`1.5px solid ${canSave?C.blue:C.border}`,borderRadius:12,padding:15,color:canSave?C.blue:C.muted,fontSize:15,fontWeight:700,transition:"all 0.2s"}}>
          {canSave?(course?"Save Changes":`Create ${mode==="mashup"?"Mashup":"Race"} Course`):"Select at least 2 stages"}
        </button>
      </div>
    </div>
  );
}

// ── Race Map Overlay ──────────────────────────────────────────────────────────
function RaceMapOverlay({courseStages,onClose}){
  const mapContainer=useRef(null);
  const map=useRef(null);
  const userMarkerRef=useRef(null);
  const userMarkerInnerRef=useRef(null);
  const [userPos,setUserPos]=useState(null);

  useEffect(()=>{
    if(!navigator.geolocation)return;
    const id=navigator.geolocation.watchPosition(pos=>{
      setUserPos({lat:pos.coords.latitude,lng:pos.coords.longitude,heading:pos.coords.heading});
    },err=>console.log(err),{enableHighAccuracy:true,maximumAge:2000,timeout:10000});
    return()=>navigator.geolocation.clearWatch(id);
  },[]);

  useEffect(()=>{
    if(map.current)return;
    const token=import.meta.env.VITE_MAPBOX_TOKEN;
    if(!token)return;
    import('https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js').then(()=>{
      const mapboxgl=window.mapboxgl;
      mapboxgl.accessToken=token;
      const boundsPoints=[];
      courseStages.forEach(stage=>{
        const coords=stage.line_coords&&stage.line_coords.length>1?stage.line_coords:[stage.start,stage.finish];
        coords.forEach(c=>boundsPoints.push([c.lng,c.lat]));
      });
      const opts={container:mapContainer.current,style:'mapbox://styles/mapbox/outdoors-v12'};
      if(boundsPoints.length>0){
        const lats=boundsPoints.map(p=>p[1]),lngs=boundsPoints.map(p=>p[0]);
        opts.bounds=[[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]];
        opts.fitBoundsOptions={padding:60};
      } else {
        opts.center=[DEFAULT_CENTER.lng,DEFAULT_CENTER.lat];
        opts.zoom=13;
      }
      map.current=new mapboxgl.Map(opts);
      map.current.on('load',()=>{
        courseStages.forEach((stage,i)=>{
          const coords=stage.line_coords&&stage.line_coords.length>1?stage.line_coords:[stage.start,stage.finish];
          const id='race-line-'+stage.id;
          map.current.addSource(id,{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:coords.map(c=>[c.lng,c.lat])}}});
          map.current.addLayer({id,type:'line',source:id,paint:{'line-color':'#2563EB','line-width':4,'line-opacity':0.9}});
          const el=document.createElement('div');
          el.style.cssText='width:26px;height:26px;border-radius:50%;background:#2563EB;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:Inter,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);';
          el.textContent=String(i+1);
          new mapboxgl.Marker({element:el}).setLngLat([stage.start.lng,stage.start.lat]).addTo(map.current);
        });
      });
    });
  },[]);

  useEffect(()=>{
    if(!userPos||!map.current)return;
    if(!userMarkerRef.current){
      const el=document.createElement('div');
      el.style.cssText='width:34px;height:34px;';
      const inner=document.createElement('div');
      inner.style.cssText='width:100%;height:100%;transition:transform 0.3s ease;';
      inner.innerHTML='<svg width="34" height="34" viewBox="0 0 34 34"><polygon points="17,2 25,17 17,12 9,17" fill="#2563EB" opacity="0.85"/><circle cx="17" cy="17" r="7" fill="#2563EB" stroke="white" stroke-width="3"/></svg>';
      el.appendChild(inner);
      userMarkerRef.current=new window.mapboxgl.Marker({element:el}).setLngLat([userPos.lng,userPos.lat]).addTo(map.current);
      userMarkerInnerRef.current=inner;
    } else {
      userMarkerRef.current.setLngLat([userPos.lng,userPos.lat]);
      if(userMarkerInnerRef.current&&typeof userPos.heading==='number'&&!isNaN(userPos.heading))userMarkerInnerRef.current.style.transform=`rotate(${userPos.heading}deg)`;
    }
  },[userPos]);

  return(
    <div style={{position:"fixed",inset:0,background:"#fff",zIndex:150,display:"flex",flexDirection:"column"}}>
      <div style={{position:"absolute",top:52,left:16,right:16,zIndex:10,display:"flex",justifyContent:"flex-end"}}>
        <button className="tap" onClick={onClose} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 14px",color:C.text,fontSize:13,fontWeight:600,boxShadow:"0 2px 10px rgba(0,0,0,0.1)",display:"flex",alignItems:"center",gap:6}}><Icon.Close size={14} color={C.text}/>Close Map</button>
      </div>
      <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet"/>
      <div ref={mapContainer} style={{width:"100%",height:"100%"}}/>
    </div>
  );
}

// ── Race / Practice / Mashup Screen ──────────────────────────────────────────
function RaceScreen({course,stages,user,onFinish,onActivity}){

  const courseStages=course.stageIds.map(id=>stages.find(s=>s.id===id)).filter(Boolean);
  const isPractice=course.mode==="practice";
  const isMashup=course.mode==="mashup";

  const progressKey=`gate_progress_${course.id}_${user.id}`;
  const savedProgress=(()=>{try{const s=JSON.parse(localStorage.getItem(progressKey));if(s&&Date.now()-s.savedAt<12*3600*1000)return s;}catch(e){}return null;})();

  const [stageIndex,setStageIndex]=useState(savedProgress?savedProgress.stageIndex:0);
  const [phase,setPhase]=useState(savedProgress?"transfer":"modeIntro"); // modeIntro | transfer | countdown | racing | split | done
  const [countdown,setCountdown]=useState(3);
  const [timerMs,setTimerMs]=useState(0);
  const timerMsRef=useRef(0);
  const [splits,setSplits]=useState(savedProgress?savedProgress.splits:[]); // current run splits
  const [bestPerStage,setBestPerStage]=useState(savedProgress?savedProgress.bestPerStage:{}); // mashup: best time per stage id
  const [runCount,setRunCount]=useState(savedProgress?savedProgress.runCount:0); // how many full runs completed
  const [gateStatus,setGateStatus]=useState("waiting");
  const [distToGate,setDistToGate]=useState(null); const [armed,setArmed]=useState(false); const timerRef=useRef(null);
  const countRef=useRef(null);
  const gpsRef=useRef(null);
  const startTimeRef=useRef(0);
  const prevGpsRef=useRef(null);
  const traceRef=useRef([]);
    const [introDist,setIntroDist]=useState(null);
  const [showRaceMap,setShowRaceMap]=useState(false);

    const currentStage=courseStages[stageIndex];
  const totalStages=courseStages.length;
  const isLastStage=stageIndex===totalStages-1;

  useEffect(()=>{
    if(phase==="modeIntro")return;
    try{localStorage.setItem(progressKey,JSON.stringify({stageIndex,splits,bestPerStage,runCount,savedAt:Date.now()}));}catch(e){}
  },[stageIndex,splits,bestPerStage,runCount,phase]);

  const quitRace=()=>{try{localStorage.removeItem(progressKey);}catch(e){}onFinish();};
  useEffect(()=>{
    if(phase!=="modeIntro")return;
    if(!navigator.geolocation)return;
    const gate=courseStages[0]?.start;
    if(!gate)return;
    const id=navigator.geolocation.watchPosition(pos=>{
      const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};
      setIntroDist(Math.round(haversine(loc,gate)));
    },err=>console.log(err),{enableHighAccuracy:true,maximumAge:2000,timeout:10000});
    return()=>navigator.geolocation.clearWatch(id);
  },[phase]);

  // Simulate GPS toward gate
        useEffect(()=>{
if(phase!=="transfer"||!armed)return;
if(!navigator.geolocation)return;
const gate=currentStage.start;
prevGpsRef.current=null;
const id=navigator.geolocation.watchPosition(pos=>{
const loc={lat:pos.coords.latitude,lng:pos.coords.longitude,ts:pos.timestamp};
const dist=haversine(loc,gate);
setDistToGate(Math.round(dist));
const prev=prevGpsRef.current;
const crossed=segmentCrossesGate(prev,loc,gate,FAT_GATE_RADIUS);
prevGpsRef.current=loc;
if(crossed){
navigator.geolocation.clearWatch(id);
setGateStatus("entered");
const t=prev?gateCrossT(prev,loc,gate):0;
const crossTs=prev?prev.ts+t*(loc.ts-prev.ts):loc.ts;
setTimeout(()=>startCountdown(crossTs),300);
}
else if(dist<=50)setGateStatus("near");
else setGateStatus("waiting");
},err=>{console.log(err);logEvent(user?.id,"gps_error_transfer",err.message||String(err),currentStage?.id,{code:err.code});},{enableHighAccuracy:true,maximumAge:0,timeout:10000});
return()=>navigator.geolocation.clearWatch(id);
},[phase,stageIndex,armed]);

const startCountdown=(crossTs=null)=>{playBeep(880,150);setGateStatus("waiting");startTimeRef.current=crossTs||Date.now();timerMsRef.current=Date.now()-startTimeRef.current;setTimerMs(timerMsRef.current);setPhase("racing");timerRef.current=setInterval(()=>{timerMsRef.current=Date.now()-startTimeRef.current;setTimerMs(timerMsRef.current);},10);setTimeout(()=>{if(timerRef.current){clearInterval(timerRef.current);setPhase("transfer");setTimerMs(0);logEvent(user?.id,"finish_timeout","Finish gate not reached within 10 minutes",currentStage?.id);alert("Run cancelled — finish gate not reached in time");}},600000);};    
  const stopStage=(saveTime=false,crossTs=null)=>{
playBeep(440,250);
clearInterval(timerRef.current);
const finalTime=crossTs?Math.max(0,crossTs-startTimeRef.current):timerMsRef.current;  
const newSplit={stageId:currentStage.id,name:currentStage.name,time:finalTime};
setSplits(prev=>[...prev,newSplit]);
// Mashup: update best per stage
if(isMashup){
setBestPerStage(prev=>{
const current=prev[currentStage.id];
return{...prev,[currentStage.id]:(!current||finalTime<current)?finalTime:current};
});
}
setPhase("split");
if(saveTime&&!isPractice){
  const entry={stage_id:currentStage.id,stage_name:currentStage.name,user_id:user.id,time_ms:finalTime,created_at:new Date(crossTs||Date.now()).toISOString(),trace:compactTrace(traceRef.current)};
  saveStageTime(entry).then(()=>onActivity&&onActivity()).catch(err=>{console.log('save failed, storing offline',err);queueOfflineTime(entry);onActivity&&onActivity();});
}
};

             useEffect(()=>{
    if(phase!=="racing")return;
    if(!navigator.geolocation)return;
    const gate=currentStage.finish;
    prevGpsRef.current=null;
    traceRef.current=[{t:0,lat:currentStage.start.lat,lng:currentStage.start.lng}];
    const id=navigator.geolocation.watchPosition(pos=>{
      const loc={lat:pos.coords.latitude,lng:pos.coords.longitude,ts:pos.timestamp};
      const prev=prevGpsRef.current;
      const crossed=segmentCrossesGate(prev,loc,gate,FINISH_GATE_RADIUS);
      prevGpsRef.current=loc;
      if(!crossed&&loc.ts>startTimeRef.current)traceRef.current.push({t:loc.ts-startTimeRef.current,lat:loc.lat,lng:loc.lng});
      if(crossed){
navigator.geolocation.clearWatch(id);
const t=prev?gateCrossT(prev,loc,gate):0;
const crossTs=prev?prev.ts+t*(loc.ts-prev.ts):loc.ts;
traceRef.current.push({t:Math.max(0,crossTs-startTimeRef.current),lat:gate.lat,lng:gate.lng});
stopStage(true,crossTs);
}
},err=>{console.log(err);logEvent(user?.id,"gps_error_racing",err.message||String(err),currentStage?.id,{code:err.code});},{enableHighAccuracy:true,maximumAge:0,timeout:10000});
return()=>navigator.geolocation.clearWatch(id);
},[phase,stageIndex]);
           

  const nextStage=()=>{
if(isLastStage){
setRunCount(r=>r+1);
if(isPractice){setPhase("done");}
else if(isMashup){setPhase("mashupBetween");}
else{setPhase("done");}
} else {
setStageIndex(i=>i+1);setPhase("transfer");setArmed(false);
}
};

  const startAnotherRun=()=>{
setStageIndex(0);setSplits([]);setPhase("transfer");setArmed(false);
};

  useEffect(()=>()=>{clearInterval(timerRef.current);clearInterval(countRef.current);clearInterval(gpsRef.current);},[]);

  const mashupTotal=Object.values(bestPerStage).reduce((a,b)=>a+b,0);

  // ── Mode intro screen ──
  if(phase==="modeIntro"){
    const modeInfo={
      practice:{color:C.green,icon:"🎯",title:"Practice Run",sub:"This run won't be saved. Ride it to learn the stages, then go again for real.",btn:"Start Practice",btnColor:C.green},
      race:{color:C.blue,title:"Race Mode",sub:"One timed run. Your times will go to the leaderboard. Make it count.",btn:"Start Race",btnColor:C.blue},
      mashup:{color:C.blue,icon:"⚡",title:"Mashup Mode",sub:"Unlimited runs. Your best time on each stage gets combined into one total. Keep going until you're happy.",btn:"Start Mashup",btnColor:C.blue},
    }[course.mode];
    return(
      <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column"}}>
        <div style={{background:"#fff",padding:"52px 20px 32px",textAlign:"center",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:72,height:72,marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{course.mode==="mashup"?<Icon.Lightning size={56} color={modeInfo.color}/>:course.mode==="practice"?<span style={{fontSize:56}}>🎯</span>:<Icon.Flag size={56} color={modeInfo.color}/>}</div>
          <div style={{fontSize:28,fontWeight:800,color:C.text,marginBottom:8}}>{course.name}</div>
          <div style={{fontSize:18,fontWeight:600,color:C.text,marginBottom:12}}>{modeInfo.title}</div>
          <div style={{fontSize:14,color:C.muted,lineHeight:1.6,maxWidth:280,textAlign:"center",marginBottom:24}}>{modeInfo.sub}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
            {courseStages.map((s,i)=>(
              <div key={s.id} style={{background:`${C.blue}15`,border:`1px solid ${C.blue}33`,borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,color:C.blue}}>
                {i+1}. {s.name}
              </div>
            ))}
          </div>
        </div>

        <div style={{padding:"24px 20px 40px",display:"flex",flexDirection:"column",gap:12}}>
          {isMashup&&(
            <div style={{background:`${C.blue}10`,border:`1px solid ${C.blue}33`,borderRadius:12,padding:"12px 16px",textAlign:"center"}}>
              <div style={{fontSize:13,color:C.blue,fontWeight:600}}>⚡ Best times per stage combine into your total</div>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>Tap "Another Run" after each completion to keep improving</div>
            </div>
          )}
                        <div style={{textAlign:"center",padding:"10px 14px",background:introDist===null?C.surface:introDist<=20?`${C.green}15`:`${C.blue}15`,borderRadius:10,border:`1px solid ${introDist===null?C.border:introDist<=20?C.green:C.blue}`}}>
            <div style={{fontSize:13,fontWeight:600,color:introDist===null?C.muted:introDist<=20?C.green:C.blue}}>{introDist===null?"📍 Finding your location…":introDist<=20?"✓ You're at the start":`📍 ${introDist}m from the start`}</div>
            {introDist!==null&&introDist>20&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>Get within 20m to start</div>}
          </div>
                    <button className="tap" onClick={()=>{if(introDist!==null&&introDist<=20)setPhase("transfer");}} style={{width:"100%",background:(introDist!==null&&introDist<=20)?modeInfo.btnColor:C.surface,border:"none",borderRadius:14,padding:18,color:(introDist!==null&&introDist<=20)?"#fff":C.mutedL,fontSize:16,fontWeight:700,boxShadow:(introDist!==null&&introDist<=20)?`0 4px 20px ${modeInfo.btnColor}44`:"none"}}>
            {modeInfo.btn} →
          </button>
          <button className="tap" onClick={()=>setShowRaceMap(true)} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.text,fontSize:14,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <Icon.Map size={16} color={C.text}/>View Map
          </button>
          <button className="tap" onClick={quitRace} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.muted,fontSize:14}}>
            Back
          </button>
        </div>
        {showRaceMap&&<RaceMapOverlay courseStages={courseStages} onClose={()=>setShowRaceMap(false)}/>}
      </div>
    );
  }

  // ── Mashup between runs ──
  if(phase==="mashupBetween"){
    return(
      <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column"}}>
        <div style={{background:`linear-gradient(135deg,${C.blue},#1D4ED8)`,padding:"52px 20px 24px",textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:600,color:"rgba(255,255,255,0.7)",letterSpacing:1,marginBottom:8}}>RUN {runCount} COMPLETE</div>
          <div style={{fontSize:22,fontWeight:800,color:"white",marginBottom:16}}>{course.name}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginBottom:8}}>MASHUP TOTAL (best per stage)</div>
          <div style={{fontSize:52,fontWeight:800,color:"white",fontVariantNumeric:"tabular-nums"}}>{formatTime(mashupTotal)}</div>
        </div>
        <div style={{flex:1,padding:"20px 20px 0",overflowY:"auto"}}>
          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:12}}>Best Per Stage</div>
          {courseStages.map((stage,i)=>{
            const best=bestPerStage[stage.id];
            const thisRun=splits.find(s=>s.stageId===stage.id);
            const improved=thisRun&&best&&thisRun.time===best;
            return(
              <div key={stage.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:improved?`${C.blue}10`:C.surface,borderRadius:12,marginBottom:8,border:`1px solid ${improved?C.blue:C.border}`}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"white",flexShrink:0}}>{i+1}</div>
                <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:C.text}}>{stage.name}</div>{improved&&<div style={{fontSize:11,color:C.blue,fontWeight:600,marginTop:1}}>↓ Improved this run!</div>}</div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:700,color:best?C.blue:C.muted}}>{best?formatTime(best):"—"}</div>
                  {thisRun&&!improved&&best&&thisRun.time>best&&<div style={{fontSize:10,color:C.muted}}>+{formatTime(thisRun.time-best)} off best</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:"16px 20px 40px",display:"flex",flexDirection:"column",gap:10}}>
          <button className="tap" onClick={startAnotherRun} style={{width:"100%",background:C.blue,border:"none",borderRadius:14,padding:16,color:"#fff",fontSize:15,fontWeight:700}}>
            ⚡ Another Run →
          </button>
          <button className="tap" onClick={()=>setPhase("done")} style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.text,fontSize:14,fontWeight:600}}>
            I'm done — Save Results
          </button>
        </div>
      </div>
    );
  }

  // ── Transfer ──
  if(phase==="transfer"){
    const gateColors={waiting:C.muted,near:C.yellow,entered:C.green};
    const gateMsg={waiting:`${distToGate!==null?distToGate+"m away":"Calculating…"}`,near:`Almost there — ${distToGate}m`,entered:"Gate entered! Starting…"};
    const headerBg=isPractice?"#15803D":isMashup?C.blue:"#1A1A1A";
    return(
      <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column"}}>
        <div style={{background:headerBg,padding:"52px 20px 20px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            {isPractice&&<div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.7)",letterSpacing:2,marginBottom:4}}>🎯 PRACTICE RUN — NOT TIMED</div>}
            {isMashup&&<div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.7)",letterSpacing:2,marginBottom:4}}>⚡ MASHUP · RUN {runCount+1}</div>}
            <div style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)",letterSpacing:1,marginBottom:4}}>STAGE {stageIndex+1} OF {totalStages}</div>
            <div style={{fontSize:22,fontWeight:800,color:"white"}}>{currentStage.name}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",marginTop:4}}>{formatDist(haversine(currentStage.start,currentStage.finish))}</div>
          </div>
           <div style={{display:"flex",gap:8}}>
            <button className="tap" onClick={()=>setShowRaceMap(true)} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 14px",color:"rgba(255,255,255,0.9)",fontSize:13,border:"none",display:"flex",alignItems:"center",gap:6}}><Icon.Map size={14} color="rgba(255,255,255,0.9)"/>Map</button>
            <button className="tap" onClick={quitRace} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 14px",color:"rgba(255,255,255,0.7)",fontSize:13,border:"none"}}>Quit</button>
          </div>
        </div>
        <div style={{padding:"16px 20px",background:headerBg,display:"flex",gap:6}}>
          {courseStages.map((_,i)=><div key={i} style={{flex:1,height:4,borderRadius:2,background:i<stageIndex?C.orange:i===stageIndex?"white":"rgba(255,255,255,0.2)"}}/>)}
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",textAlign:"center"}}>
{!armed?(
<>
<div style={{width:100,height:100,borderRadius:"50%",background:`${C.muted}20`,border:`3px solid ${C.muted}`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20}}>
<Icon.Location size={40} color={C.muted}/>
</div>
<div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:8}}>{stageIndex===0?`Head to Stage 1`:`Transfer to Stage ${stageIndex+1}`}</div>
<div style={{fontSize:14,color:C.muted,marginBottom:20,maxWidth:260}}>Gate detection is off. Tap below once you're ready — the app will start watching for the start gate.</div>
<button className="tap" onClick={()=>{setGateStatus("waiting");setDistToGate(null);setArmed(true);}} style={{background:C.blue,border:"none",borderRadius:14,padding:"14px 28px",color:"#fff",fontSize:15,fontWeight:700}}>Arm Start Gate</button>
</>
):(
<>
<div style={{width:100,height:100,borderRadius:"50%",background:`${gateColors[gateStatus]}20`,border:`3px solid ${gateColors[gateStatus]}`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20,transition:"all 0.3s"}}>
<Icon.Location size={40} color={gateColors[gateStatus]}/>
</div>
<div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:8}}>{stageIndex===0?`Head to Stage 1`:`Transfer to Stage ${stageIndex+1}`}</div>
<div style={{fontSize:24,fontWeight:800,color:gateColors[gateStatus],marginBottom:8,transition:"all 0.3s"}}>{gateMsg[gateStatus]}</div>
<div style={{fontSize:13,color:C.muted,marginBottom:16}}>{isPractice?"Timer won't start — just ride it for feel":"Timer starts automatically when you enter the gate"}</div>
<button className="tap" onClick={()=>{setArmed(false);setGateStatus("waiting");setDistToGate(null);}} style={{marginTop:16,background:"none",border:"none",color:C.muted,fontSize:12,textDecoration:"underline"}}>Disarm</button>
</>
)}
</div>
        {isMashup&&Object.keys(bestPerStage).length>0&&(
          <div style={{padding:"0 20px 8px"}}>
            <div style={{fontSize:12,color:C.muted,fontWeight:600,marginBottom:6}}>CURRENT BEST TIMES</div>
            {courseStages.map(stage=>{
              const best=bestPerStage[stage.id];
              if(!best)return null;
              return <div key={stage.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0"}}><div style={{fontSize:12,color:C.muted}}>{stage.name}</div><div style={{fontSize:12,fontWeight:700,color:C.blue}}>{formatTime(best)}</div></div>;
            })}
          </div>
        )}
        {splits.length>0&&!isMashup&&(
          <div style={{padding:"0 20px 8px"}}>
            <div style={{fontSize:12,color:C.muted,fontWeight:600,marginBottom:6}}>SPLITS SO FAR</div>
            {splits.map((s,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}><div style={{fontSize:12,color:C.muted}}>{i+1}. {s.name}</div><div style={{fontSize:12,fontWeight:700,color:C.orange}}>{formatTime(s.time)}</div></div>)}
          </div>
        )}
                <div style={{padding:"16px 20px 40px"}}>
        
        </div>
        {showRaceMap&&<RaceMapOverlay courseStages={courseStages} onClose={()=>setShowRaceMap(false)}/>}
      </div>
    );
  }

  // ── Countdown ──
  if(phase==="countdown"){
    return(
      <div style={{position:"fixed",inset:0,background:isPractice?"#15803D":isMashup?C.blue:"#1A1A1A",zIndex:100,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        {isPractice&&<div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.7)",letterSpacing:2,marginBottom:8}}>🎯 PRACTICE — NOT SAVED</div>}
        {isMashup&&<div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.7)",letterSpacing:2,marginBottom:8}}>⚡ MASHUP RUN {runCount+1}</div>}
        <div style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.5)",letterSpacing:2,marginBottom:24}}>STAGE {stageIndex+1} · {currentStage.name.toUpperCase()}</div>
        <div style={{position:"relative",width:180,height:180,marginBottom:32}}>
          <svg width="180" height="180" style={{position:"absolute",inset:0,transform:"rotate(-90deg)"}}>
            <circle cx="90" cy="90" r="80" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8"/>
            <circle cx="90" cy="90" r="80" fill="none" stroke={isPractice?"#86efac":isMashup?"#93c5fd":"#FC4C02"} strokeWidth="8" strokeLinecap="round" strokeDasharray="502" strokeDashoffset={502*(1-countdown/3)} style={{transition:"stroke-dashoffset 0.9s linear"}}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontSize:countdown>0?96:72,fontWeight:800,color:"white",fontVariantNumeric:"tabular-nums"}}>{countdown>0?countdown:"GO!"}</div>
          </div>
        </div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.5)"}}>Gate detected — get ready</div>
      </div>
    );
  }

  // ── Racing ──
  if(phase==="racing"){
    const bgColor=isPractice?"#15803D":isMashup?C.blue:"#1A1A1A";
    return(
      <div style={{position:"fixed",inset:0,background:bgColor,zIndex:100,display:"flex",flexDirection:"column"}}>
        <div style={{padding:"52px 20px 16px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            {isPractice&&<div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.6)",letterSpacing:2,marginBottom:4}}>🎯 PRACTICE</div>}
            {isMashup&&<div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.6)",letterSpacing:2,marginBottom:4}}>⚡ MASHUP RUN {runCount+1}</div>}
            <div style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.4)",letterSpacing:1,marginBottom:4}}>STAGE {stageIndex+1} OF {totalStages}</div>
            <div style={{fontSize:18,fontWeight:700,color:"white"}}>{currentStage.name}</div>
          </div>
          <div style={{display:"flex",gap:6}}>{courseStages.map((_,i)=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:i<stageIndex?C.orange:i===stageIndex?"white":"rgba(255,255,255,0.2)"}}/>)}</div>
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          {isPractice&&<div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginBottom:8,fontWeight:600}}>NOT TIMED — JUST RIDE</div>}
          <div style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.4)",letterSpacing:3,marginBottom:16}}>{isPractice?"PRACTICE TIME":"ELAPSED"}</div>
          <div style={{fontSize:72,fontWeight:800,color:isPractice?"rgba(255,255,255,0.5)":"white",fontVariantNumeric:"tabular-nums",letterSpacing:-2}}>{formatTime(timerMs)}</div>
          {isMashup&&bestPerStage[currentStage.id]&&<div style={{marginTop:16,fontSize:13,color:"rgba(255,255,255,0.5)"}}>Best: {formatTime(bestPerStage[currentStage.id])}</div>}
          {!isPractice&&splits.length>0&&<div style={{marginTop:8,fontSize:13,color:"rgba(255,255,255,0.4)"}}>Running total: {formatTime(splits.reduce((a,s)=>a+s.time,0)+timerMs)}</div>}
          <div style={{marginTop:32,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:C.red,animation:isPractice?"none":"recPulse 1.5s infinite"}}/>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",fontWeight:500}}>{isPractice?"PRACTICE":"TIMING ACTIVE"}</div>
          </div>
        </div>
        <div style={{display:"flex",padding:"0 20px",marginBottom:24}}>
          {[{l:"Stage Dist",v:formatDist(haversine(currentStage.start,currentStage.finish))},{l:"Stage",v:`${stageIndex+1}/${totalStages}`},{l:isMashup?"My Best":"Best",v:isMashup?(bestPerStage[currentStage.id]?formatTime(bestPerStage[currentStage.id]):"—"):(currentStage.time?formatTime(currentStage.time):"—")}].map(({l,v},i)=>(
            <div key={i} style={{flex:1,borderRight:i<2?`1px solid rgba(255,255,255,0.1)`:"none",paddingRight:i<2?12:0,paddingLeft:i>0?12:0,textAlign:"center"}}>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:4}}>{l}</div>
              <div style={{fontSize:16,fontWeight:700,color:"white"}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{padding:"0 20px 44px"}}>
                    <button className="tap" onClick={()=>stopStage(false)} style={{width:"100%",background:isPractice?"rgba(255,255,255,0.2)":C.red,border:isPractice?"1px solid rgba(255,255,255,0.3)":"none",borderRadius:14,padding:18,color:"#fff",fontSize:16,fontWeight:700,boxShadow:isPractice?"none":"0 4px 20px rgba(220,38,38,0.4)"}}>
            {isPractice?"✓  Finish Gate — Next Stage":"■   Stop — Finish Gate"}
          </button>
        </div>
      </div>
    );
  }

  // ── Split result ──
  if(phase==="split"){
    const lastSplit=splits[splits.length-1];
    const prevBest=stages.find(s=>s.id===lastSplit.stageId)?.time;
    const mashupBest=bestPerStage[lastSplit.stageId];
    const isPB=!isPractice&&(!prevBest||lastSplit.time<prevBest);
    const isMashupBest=isMashup&&mashupBest&&lastSplit.time===mashupBest;
    const headerBg=isPractice?"#15803D":isPB||isMashupBest?C.green:isMashup?C.blue:"#1A1A1A";
    return(
      <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column"}}>
        <div style={{background:headerBg,padding:"52px 20px 24px",textAlign:"center"}}>
          {isPractice&&<div style={{fontSize:12,color:"rgba(255,255,255,0.7)",fontWeight:600,marginBottom:6}}>🎯 PRACTICE — NOT SAVED</div>}
          <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",letterSpacing:1,marginBottom:8}}>STAGE {stageIndex+1} COMPLETE</div>
          <div style={{fontSize:20,fontWeight:700,color:"white",marginBottom:16}}>{lastSplit.name}</div>
          {!isPractice&&<div style={{fontSize:56,fontWeight:800,color:"white",fontVariantNumeric:"tabular-nums"}}>{formatTime(lastSplit.time)}</div>}
          {isPractice&&<div style={{fontSize:20,color:"rgba(255,255,255,0.8)"}}>Good run — keep going</div>}
          {isPB&&<div style={{marginTop:8,fontSize:14,color:"rgba(255,255,255,0.8)",fontWeight:600}}>🏆 Personal Best!</div>}
          {isMashupBest&&!isPB&&<div style={{marginTop:8,fontSize:14,color:"rgba(255,255,255,0.8)",fontWeight:600}}>⚡ New mashup best for this stage!</div>}
        </div>
        <div style={{flex:1,padding:"24px 20px"}}>
          {!isPractice&&(
            <div style={{background:C.surface,borderRadius:14,padding:"16px",border:`1px solid ${C.border}`,marginBottom:16}}>
              <div style={{fontSize:12,color:C.muted,fontWeight:600,marginBottom:12}}>{isMashup?"BEST TIMES":"SPLITS"}</div>
              {isMashup?courseStages.map((stage,i)=>{
                const best=bestPerStage[stage.id];
                return <div key={stage.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:i<courseStages.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:22,height:22,borderRadius:"50%",background:stage.id===lastSplit.stageId?C.blue:"#DDD",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:stage.id===lastSplit.stageId?"white":"#999"}}>{i+1}</div><div style={{fontSize:13,color:C.text}}>{stage.name}</div></div>
                  <div style={{fontSize:13,fontWeight:700,color:best?C.blue:C.muted}}>{best?formatTime(best):"—"}</div>
                </div>;
              }):splits.map((s,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:i<splits.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:22,height:22,borderRadius:"50%",background:i===splits.length-1?C.orange:"#DDD",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:i===splits.length-1?"white":"#999"}}>{i+1}</div><div style={{fontSize:13,color:C.text}}>{s.name}</div></div>
                  <div style={{fontSize:13,fontWeight:700,color:i===splits.length-1?C.orange:C.muted}}>{formatTime(s.time)}</div>
                </div>
              ))}
              {isMashup&&<div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}><div style={{fontSize:13,fontWeight:700,color:C.text}}>Mashup Total</div><div style={{fontSize:15,fontWeight:800,color:C.blue}}>{mashupTotal>0?formatTime(mashupTotal):"—"}</div></div>}
            </div>
          )}
          {!isLastStage&&<div style={{textAlign:"center",padding:"8px 0"}}><div style={{fontSize:13,color:C.muted}}>Next: <span style={{fontWeight:600,color:C.text}}>{courseStages[stageIndex+1]?.name}</span></div></div>}
        </div>
        <div style={{padding:"0 20px 40px",display:"flex",gap:10}}>
          <button className="tap" onClick={quitRace} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:14,color:C.muted,fontSize:14,fontWeight:500}}>Quit</button>
          <button className="tap" onClick={nextStage} style={{flex:2,background:isPractice?C.green:isMashup?C.blue:C.orange,border:"none",borderRadius:12,padding:14,color:"#fff",fontSize:14,fontWeight:700}}>
            {isLastStage?(isPractice?"Done — Go Again?":isMashup?"Run Complete →":"See Results →"):"Next Stage →"}
          </button>
        </div>
      </div>
    );
  }

  // ── Done ──
  if(phase==="done"){
    const finalTotal=isPractice?null:isMashup?mashupTotal:splits.reduce((a,s)=>a+s.time,0);
    const headerBg=isPractice?"#15803D":isMashup?C.blue:C.orange;
    return(
      <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column"}}>
        <div style={{background:headerBg,padding:"52px 20px 24px",textAlign:"center"}}>
          <div style={{marginBottom:12}}><Icon.Trophy size={40} color="#fff"/></div>
          <div style={{fontSize:28,fontWeight:800,color:"#fff",marginBottom:4}}>{course.name}</div>
          <div style={{fontSize:14,color:"rgba(255,255,255,0.8)",marginBottom:isPractice?0:16}}>
            {isPractice?"Practice Complete":"Race Complete"} · {totalStages} stages
            {isMashup?` · ${runCount} run${runCount>1?"s":""}`:""}
          </div>
          {isPractice&&<div style={{fontSize:14,color:"rgba(255,255,255,0.8)",marginBottom:16}}>Times not saved — ready to race?</div>}
        </div>
        {!isPractice&&(
          <div style={{padding:"24px 20px 0",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:12,color:C.muted,fontWeight:600,letterSpacing:1,marginBottom:6}}>{isMashup?"MASHUP TOTAL (best per stage)":"TOTAL TIME"}</div>
            <div style={{fontSize:52,fontWeight:800,color:isMashup?C.blue:C.orange,fontVariantNumeric:"tabular-nums"}}>{formatTime(finalTotal)}</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:20}}>{formatDist(courseStages.reduce((a,s)=>a+haversine(s.start,s.finish),0))} timed</div>
          </div>
        )}
        <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
          {!isPractice&&(
            <>
              <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:12}}>Stage Breakdown</div>
              {(isMashup?courseStages.map(s=>({stageId:s.id,name:s.name,time:bestPerStage[s.id]})):splits).map((split,i)=>{
                const best=stages.find(s=>s.id===split.stageId)?.time;
                const isPB=!best||split.time<best;
                return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:C.surface,borderRadius:12,marginBottom:8,border:`1px solid ${C.border}`}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:isMashup?C.blue:C.orange,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"white",flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:C.text}}>{split.name}</div>{isPB&&split.time&&<div style={{fontSize:11,color:C.green,fontWeight:600,marginTop:1}}>↓ Personal best</div>}</div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:700,color:split.time?(isPB?C.green:isMashup?C.blue:C.orange):C.muted}}>{split.time?formatTime(split.time):"—"}</div>{best&&!isPB&&split.time&&<div style={{fontSize:10,color:C.muted}}>Best: {formatTime(best)}</div>}</div>
                  </div>
                );
              })}
            </>
          )}
          {isPractice&&(
            <div style={{textAlign:"center",padding:"20px 0"}}>
              <div style={{fontSize:40,marginBottom:12}}>🎯</div>
              <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:8}}>Practice complete</div>
              <div style={{fontSize:13,color:C.muted,lineHeight:1.6}}>You've seen all the stages. Now set it to Race or Mashup mode and go for a real time.</div>
            </div>
          )}
        </div>
        <div style={{padding:"16px 20px 36px",display:"flex",gap:10}}>
          <button className="tap" onClick={quitRace} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:14,color:C.text,fontSize:14,fontWeight:600}}>Back</button>
            {isPractice
            ?<button className="tap" onClick={quitRace} style={{flex:2,background:C.green,border:"none",borderRadius:12,padding:14,color:"#fff",fontSize:14,fontWeight:700}}>Ready to Race!</button>
           :<button className="tap" onClick={async()=>{if(totalStages>1){const{error}=await supabase.from('course_results').insert({course_id:course.id,user_id:user.id,total_time_ms:finalTotal,mode:course.mode});if(error){alert("Couldn't save course result: "+error.message);}else{logEvent(user.id,'course_finish',`finished ${course.name} · ${formatTime(finalTotal)}`,null,{course_id:course.id,total_time_ms:finalTotal,stage_count:totalStages}).then(()=>onActivity&&onActivity());}}try{localStorage.removeItem(progressKey);}catch(e){}onFinish();}} style={{flex:2,background:isMashup?C.blue:C.orange,border:"none",borderRadius:12,padding:14,color:"#fff",fontSize:14,fontWeight:700}}>Save Results</button>
        }
        </div>
      </div>
    );
  }
  return null;
}

// ── Course Card ───────────────────────────────────────────────────────────────
function CourseCard({course,stages,userId,onStart,onDelete,onEdit}){
  const courseStages=course.stageIds.map(id=>stages.find(s=>s.id===id)).filter(Boolean);
  const totalDist=courseStages.reduce((a,s)=>a+haversine(s.start,s.finish),0);
  const modeInfo={practice:{color:C.green,Ic:Icon.Flag,label:"Practice"},race:{color:C.blue,Ic:Icon.Flag,label:"Race"},mashup:{color:C.blue,Ic:Icon.Lightning,label:"Mashup"}}[course.mode||"race"];
  return(
    <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:16,padding:"16px",marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:4}}>{course.name}</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{fontSize:12,color:C.muted}}>{course.stageIds.length} stages · {formatDist(totalDist)}</div>
             <div style={{fontSize:11,fontWeight:600,color:modeInfo.color,background:`${modeInfo.color}15`,borderRadius:6,padding:"2px 7px",display:"flex",alignItems:"center",gap:4}}><modeInfo.Ic size={11} color={modeInfo.color}/>{modeInfo.label}</div>
          </div>
        </div>
       <div style={{display:"flex",alignItems:"center"}}><div style={{width:40,height:40,borderRadius:10,background:`${modeInfo.color}15`,display:"flex",alignItems:"center",justifyContent:"center"}}><modeInfo.Ic size={18} color={modeInfo.color}/></div>{onEdit&&course.created_by===userId&&<button className="tap" onClick={()=>onEdit(course)} style={{background:"none",border:"none",padding:"4px 0 4px 10px",color:C.blue,fontSize:13,fontWeight:600}}>Edit</button>}{onDelete&&course.created_by===userId&&<button className="tap" onClick={()=>onDelete(course.id)} style={{background:"none",border:"none",padding:"4px 0 4px 8px",color:C.red,fontSize:15,fontWeight:600}}>✕</button>}</div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {courseStages.map((stage,i)=>(
          <div key={stage.id} style={{display:"flex",alignItems:"center",gap:5,background:C.surface,borderRadius:8,padding:"5px 10px",border:`1px solid ${C.border}`}}>
            <div style={{width:18,height:18,borderRadius:"50%",background:stage.time?C.green:C.mutedL,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"white"}}>{i+1}</div>
            <div style={{fontSize:12,color:C.text,fontWeight:500}}>{stage.name}</div>
            {stage.time&&<div style={{fontSize:10,color:modeInfo.color,fontWeight:600}}>{formatTime(stage.time)}</div>}
          </div>
        ))}
      </div>
            <button className="tap" onClick={()=>onStart(course)} style={{width:"100%",background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"12px 16px",color:C.blue,fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
               <Icon.Flag size={16} color={C.blue}/>Start {modeInfo.label}
      </button>
    </div>
  );
}

// ── Lobby Sheet ───────────────────────────────────────────────────────────────
function LobbySheet({onClose}){
  const [code]=useState(()=>Math.random().toString(36).substring(2,8).toUpperCase());
  const [tab,setTab]=useState("create");
  const [joinCode,setJoinCode]=useState("");
  const [riders,setRiders]=useState([{name:"You",status:"ready",time:null}]);
  return(
    <div style={{padding:"0 16px 40px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 16px"}}>
        <div style={{fontSize:17,fontWeight:700,color:C.text}}>Session Lobby</div>
        <button className="tap" onClick={onClose} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 14px",color:C.text,fontSize:13}}>Done</button>
      </div>
      <div style={{display:"flex",background:C.surface,borderRadius:10,padding:3,marginBottom:20,gap:3}}>
        {["create","join"].map(t=><button key={t} className="tap" onClick={()=>setTab(t)} style={{flex:1,padding:"9px",borderRadius:8,background:tab===t?"#fff":"none",border:"none",color:tab===t?C.text:C.muted,fontSize:14,fontWeight:tab===t?600:400,boxShadow:tab===t?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>{t==="create"?"Create":"Join"}</button>)}
      </div>
      {tab==="create"&&<div>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:1,marginBottom:10}}>SESSION CODE</div>
          <div style={{fontSize:44,fontWeight:800,color:C.orange,letterSpacing:10,background:C.orangeL,borderRadius:14,padding:"16px 24px",display:"inline-block"}}>{code}</div>
          <div style={{fontSize:13,color:C.muted,marginTop:10}}>Share with your mates</div>
        </div>
        {riders.map((r,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:C.surface,borderRadius:10,marginBottom:6,border:`1px solid ${C.border}`}}><div style={{width:8,height:8,borderRadius:"50%",background:r.status==="ready"?C.green:C.orange}}/><div style={{flex:1,fontSize:14,fontWeight:500,color:C.text}}>{r.name}</div><div style={{fontSize:13,color:r.time?C.orange:C.muted,fontWeight:r.time?700:400}}>{r.time?formatTime(r.time):"waiting…"}</div></div>)}
        <button className="tap" onClick={()=>setRiders(r=>[...r,{name:`Rider ${r.length+1}`,status:"done",time:Math.floor(Math.random()*120000+60000)}])} style={{width:"100%",marginTop:6,background:"none",border:`1px dashed ${C.border}`,borderRadius:10,padding:"11px",color:C.muted,fontSize:13}}>+ Simulate rider joining</button>
      </div>}
      {tab==="join"&&<div>
        <div style={{fontSize:13,color:C.muted,marginBottom:12}}>Enter the 6-character code from your mate</div>
        <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} style={{width:"100%",border:`1.5px solid ${joinCode.length===6?C.orange:C.border}`,borderRadius:12,padding:"18px",fontSize:32,fontWeight:800,color:C.orange,textAlign:"center",letterSpacing:8,background:C.surface,marginBottom:14}}/>
        <button className="tap" style={{width:"100%",background:joinCode.length===6?C.orange:C.surface,border:"none",borderRadius:12,padding:15,color:joinCode.length===6?"#fff":C.muted,fontSize:15,fontWeight:700}}>Join Session</button>
      </div>}
    </div>
  );
}
function AuthScreen({onAuth}){
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [name,setName]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [agreed,setAgreed]=useState(false);

  const submit=async()=>{
    setLoading(true);setError("");
    if(mode==="login"){
      const{error}=await supabase.auth.signInWithPassword({email,password});
      if(error)setError(error.message);
    } else {
      const{error}=await supabase.auth.signUp({email,password,options:{data:{display_name:name}}});
      if(error)setError(error.message);
      else setError("Check your email to confirm your account!");
    }
    setLoading(false);
  };

    return(
    <div style={{position:"fixed",inset:0,background:"#fff",zIndex:200,display:"flex",flexDirection:"column"}}>
      <div style={{padding:"72px 24px 28px",textAlign:"center"}}>
        <svg width="30" height="30" viewBox="0 0 24 24" style={{margin:"0 auto 14px"}}><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" fill={C.blue}/></svg>
        <div style={{fontSize:30,fontWeight:800,color:C.text,letterSpacing:-1,marginBottom:4}}>GATE</div>
        <div style={{fontSize:13,color:C.muted}}>Enduro timing for every trail</div>
      </div>
      <div style={{flex:1,padding:"8px 24px 24px",overflowY:"auto"}}>
        <div style={{display:"flex",background:C.surface,borderRadius:10,padding:3,marginBottom:22}}>
          {["login","signup"].map(m=><button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"9px",borderRadius:8,background:mode===m?"#fff":"none",border:"none",color:mode===m?C.text:C.muted,fontSize:14,fontWeight:mode===m?600:400,boxShadow:mode===m?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>{m==="login"?"Log In":"Sign Up"}</button>)}
        </div>
        {mode==="signup"&&<input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,marginBottom:12,background:C.surface,boxSizing:"border-box"}}/>}
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" type="email" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,marginBottom:12,background:C.surface,boxSizing:"border-box"}}/>
        <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" type="password" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,marginBottom:20,background:C.surface,boxSizing:"border-box"}}/>
        {mode==="signup"&&(
          <label style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:20,cursor:"pointer"}}>
            <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{marginTop:2,width:16,height:16,accentColor:C.blue,flexShrink:0}}/>
            <span style={{fontSize:12,color:C.muted,lineHeight:1.5}}>I agree to the Terms & Conditions</span>
          </label>
        )}
        {error&&<div style={{fontSize:13,color:error.includes("Check")?C.green:C.red,marginBottom:16,textAlign:"center"}}>{error}</div>}
        <button className="tap" onClick={submit} disabled={mode==="signup"&&!agreed} style={{width:"100%",background:loading?C.surface:(mode==="signup"&&!agreed)?C.surface:C.blue,border:"none",borderRadius:12,padding:16,color:loading||(mode==="signup"&&!agreed)?C.muted:"#fff",fontSize:15,fontWeight:700}}>
          {loading?"...":(mode==="login"?"Log In":"Create Account")}
        </button>
        <div style={{textAlign:"center",fontSize:12,color:C.muted,marginTop:20,lineHeight:1.6}}>By continuing you agree that mountain biking carries inherent risk and you're responsible for riding within your ability.</div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

// ── Day recap posts ───────────────────────────────────────────────────────────
// ── Map screenshot (Mapbox Static Images, same style as the app map) ─────────
function encodePolyline(pts){
  let out='',pLa=0,pLn=0;
  for(const p of pts){
    const la=Math.round(p.lat*1e5),ln=Math.round(p.lng*1e5);
    for(const v of [la-pLa,ln-pLn]){
      let n=v<0?~(v<<1):(v<<1);
      while(n>=0x20){out+=String.fromCharCode((0x20|(n&0x1f))+63);n>>=5;}
      out+=String.fromCharCode(n+63);
    }
    pLa=la;pLn=ln;
  }
  return out;
}
// list: [{n, line:[{lat,lng}]}] -> [{n, p:encodedPolyline, s:[lng,lat] (start)}]  (small enough to store in app_events.context)
function recapMapPaths(list){
  const per=Math.max(6,Math.floor(120/Math.max(1,list.length)));
  return list.filter(x=>x.line&&x.line.length>1).map(x=>{
    const L=x.line,step=Math.max(1,Math.ceil(L.length/per)),pts=[];
    for(let i=0;i<L.length;i+=step)pts.push(L[i]);
    if(pts[pts.length-1]!==L[L.length-1])pts.push(L[L.length-1]);
    return{n:x.n,p:encodePolyline(pts),s:[+L[0].lng.toFixed(5),+L[0].lat.toFixed(5)]};
  });
}
function recapMapUrl(paths,w=480,h=270){
  if(!paths||!paths.length)return null;
  const e=encodeURIComponent;
  const overlay=[
    ...paths.map(p=>`path-7+ffffff(${e(p.p)})`),
    ...paths.map(p=>`path-4+f59e0b(${e(p.p)})`),
    ...paths.map(p=>`pin-s-${p.n}+f59e0b(${p.s[0]},${p.s[1]})`)
  ].join(',');
  return `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${overlay}/auto/${w}x${h}@2x?padding=36&access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
}

// ── Build today's recap ──────────────────────────────────────────────────────
const recapTotal=ms=>{const s=Math.round(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),r=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`:`${m}:${String(r).padStart(2,'0')}`;};

// Reads today's runs for this rider, finds each stage's best today and whether it beat their earlier best.
async function computeDayRecap(user,stages){
  const start=new Date();start.setHours(0,0,0,0);
  const {data:todays}=await supabase.from('stage_times').select('stage_id,time_ms,created_at').eq('user_id',user.id).gte('created_at',start.toISOString());
  if(!todays||!todays.length)return null;
  const ids=[...new Set(todays.map(t=>String(t.stage_id)))];
  const {data:before}=await supabase.from('stage_times').select('stage_id,time_ms').eq('user_id',user.id).lt('created_at',start.toISOString()).in('stage_id',ids);
  const prevBest={};(before||[]).forEach(t=>{const k=String(t.stage_id);if(prevBest[k]===undefined||t.time_ms<prevBest[k])prevBest[k]=t.time_ms;});
  const rows=[];
  for(const id of ids){
    const st=stages.find(s=>String(s.id)===id);if(!st)continue;
    const mine=todays.filter(t=>String(t.stage_id)===id),best=Math.min(...mine.map(t=>t.time_ms));
    rows.push({id,name:st.name,diff:st.difficulty||'blue',runs:mine.length,best,pb:prevBest[id]!==undefined&&best<prevBest[id],first:Math.min(...mine.map(t=>new Date(t.created_at).getTime())),st});
  }
  rows.sort((a,b)=>a.first-b.first);  // in the order ridden
  if(!rows.length)return null;
  let descent=0,haveDescent=false;
  if(typeof stageDescentFt==='function'){   // from the Fatigue code; skipped if it isn't in the app
    for(const r of rows){let ft=null;try{ft=await stageDescentFt(r.st);}catch(e){}if(ft){descent+=ft*r.runs;haveDescent=true;}}
  }
  const list=rows.map((r,i)=>({n:i+1,line:r.st.line_coords&&r.st.line_coords.length>1?r.st.line_coords:[r.st.start,r.st.finish]}));
  return{
    date:new Date().toISOString(),
    run_count:todays.length,
    total_time_ms:todays.reduce((a,t)=>a+t.time_ms,0),
    descent_ft:haveDescent?Math.round(descent/10)*10:null,
    stages:rows.map(r=>({id:r.id,name:r.name,diff:r.diff,runs:r.runs,best:r.best,pb:r.pb})),
    map:recapMapPaths(list)
  };
}

// ── The recap wedge (used in the feed and in the preview) ────────────────────
// recap = the object above (or an app_events.context). head = {name,avatarUrl,ago,text} to show the poster row (feed only).
function DayRecapCard({recap,head}){
  const [open,setOpen]=useState(false);
  const url=recapMapUrl(recap.map);
  const n=recap.stages.length,names=recap.stages.slice(0,2).map(s=>s.name).join(", ")+(n>2?` +${n-2}`:"");
  const box=(v,l)=><div style={{background:"#fff",borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}><div style={{fontSize:14,fontWeight:700,color:C.text}}>{v}</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>{l}</div></div>;
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden"}}>
      {head&&<div style={{display:"flex",alignItems:"flex-start",gap:12,padding:"14px 14px 12px"}}>
        <Avatar size={38} url={head.avatarUrl}/>
        <div style={{flex:1}}><div style={{fontSize:13,color:C.text,lineHeight:1.4}}><span style={{fontWeight:700}}>{head.name}</span> {head.text}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>{head.ago}</div></div>
        <div style={{width:30,height:30,borderRadius:8,background:`${C.green}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.BarChart size={15} color={C.green}/></div>
      </div>}
      <div style={{margin:head?"0 12px":"12px 12px 0",borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`,background:C.mapPark,aspectRatio:"16 / 9"}}>
        {url&&<img src={url} alt="" style={{width:"100%",height:"100%",display:"block",objectFit:"cover"}} onError={e=>{e.currentTarget.style.display="none";}}/>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,padding:"12px 12px 0"}}>
        {box(recap.run_count,"Runs")}{box(recapTotal(recap.total_time_ms),"Total time")}{box(recap.descent_ft?`${fatCommas(recap.descent_ft)} ft`:"–","Descent")}
      </div>
      <div style={{margin:12,background:"#fff",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
        <button className="tap" onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"13px 14px",background:"#fff",border:"none",textAlign:"left"}}>
          <div style={{width:40,height:40,borderRadius:"50%",border:`5px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:C.text,flexShrink:0,boxSizing:"border-box"}}>{n}</div>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:C.text}}>Stages</div><div style={{fontSize:12,color:C.muted,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{names}</div></div>
          {open?<Icon.ChevronUp size={16} color={C.mutedL}/>:<Icon.ChevronDown size={16} color={C.mutedL}/>}
        </button>
        {open&&recap.stages.map((s,i)=>(
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderTop:`1px solid ${C.border}`}}>
            <DifficultyDiamond color={(DIFFICULTIES.find(d=>d.val===s.diff)||DIFFICULTIES[0]).color} size={12}/>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{s.name}</div><div style={{fontSize:11,color:C.muted}}>{s.runs} run{s.runs===1?"":"s"}</div></div>
            {s.pb&&<span style={{fontSize:10,fontWeight:800,color:C.blue,background:"#EFF6FF",borderRadius:4,padding:"2px 5px"}}>PB</span>}
            <div style={{fontSize:14,fontWeight:700,color:C.text}}>{formatTime(s.best)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Share as an image (canvas, 1080 wide) ────────────────────────────────────
function rrect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
async function drawRecapImage(recap,name){
  const W=1080,P=60,F='Inter, -apple-system, "Helvetica Neue", Arial, sans-serif';
  const url=recapMapUrl(recap.map,480,270);
  let mapImg=null;
  if(url){try{mapImg=await new Promise((res,rej)=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=rej;i.src=url;});}catch(e){}}
  const rows=recap.stages.slice(0,6),more=recap.stages.length-rows.length,rowH=118,mapW=W-P*2,mapH=Math.round(mapW*9/16);
  const H=P+70+40+80+30+mapH+30+170+30+rows.length*rowH+(more>0?86:0)+30+60+P/2;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  let y=P;
  // header: bolt + GATE, date
  ctx.save();ctx.translate(P,y);ctx.scale(2.4,2.4);ctx.beginPath();[[13,2],[3,14],[12,14],[11,22],[21,10],[12,10]].forEach(([a,b],i)=>i?ctx.lineTo(a,b):ctx.moveTo(a,b));ctx.closePath();ctx.fillStyle=C.blue;ctx.fill();ctx.restore();
  ctx.textBaseline='alphabetic';ctx.fillStyle=C.text;ctx.font=`800 46px ${F}`;if('letterSpacing' in ctx)ctx.letterSpacing='4px';ctx.fillText('GATE',P+72,y+46);if('letterSpacing' in ctx)ctx.letterSpacing='0px';
  ctx.textAlign='right';ctx.fillStyle=C.muted;ctx.font=`600 32px ${F}`;ctx.fillText(new Date(recap.date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}),W-P,y+44);ctx.textAlign='left';
  y+=70+40;
  ctx.fillStyle=C.text;ctx.font=`800 68px ${F}`;ctx.fillText(`${name}'s ride`,P,y+54);y+=80+30;
  // map
  ctx.save();rrect(ctx,P,y,mapW,mapH,28);ctx.clip();ctx.fillStyle=C.mapPark;ctx.fillRect(P,y,mapW,mapH);if(mapImg)ctx.drawImage(mapImg,P,y,mapW,mapH);ctx.restore();
  rrect(ctx,P,y,mapW,mapH,28);ctx.strokeStyle=C.border;ctx.lineWidth=2;ctx.stroke();y+=mapH+30;
  // stats
  const bw=(mapW-48)/3,vals=[[String(recap.run_count),'Runs'],[recapTotal(recap.total_time_ms),'Total time'],[recap.descent_ft?`${fatCommas(recap.descent_ft)} ft`:'–','Descent']];
  vals.forEach(([v,l],i)=>{const x=P+i*(bw+24);rrect(ctx,x,y,bw,170,24);ctx.fillStyle=C.surface;ctx.fill();ctx.strokeStyle=C.border;ctx.stroke();ctx.textAlign='center';ctx.fillStyle=C.text;ctx.font=`700 52px ${F}`;ctx.fillText(v,x+bw/2,y+84);ctx.fillStyle=C.muted;ctx.font=`400 30px ${F}`;ctx.fillText(l,x+bw/2,y+130);});
  ctx.textAlign='left';y+=170+30;
  // stage rows
  const listH=rows.length*rowH+(more>0?86:0);
  rrect(ctx,P,y,mapW,listH,28);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=C.border;ctx.stroke();
  rows.forEach((s,i)=>{
    const ry=y+i*rowH;
    if(i){ctx.beginPath();ctx.moveTo(P,ry);ctx.lineTo(P+mapW,ry);ctx.strokeStyle=C.border;ctx.stroke();}
    const col=(DIFFICULTIES.find(d=>d.val===s.diff)||DIFFICULTIES[0]).color;
    ctx.save();ctx.translate(P+44,ry+rowH/2);ctx.rotate(Math.PI/4);ctx.fillStyle=col;ctx.fillRect(-12,-12,24,24);ctx.restore();
    ctx.fillStyle=C.text;ctx.font=`600 38px ${F}`;ctx.fillText(s.name,P+86,ry+54);
    ctx.fillStyle=C.muted;ctx.font=`400 28px ${F}`;ctx.fillText(`${s.runs} run${s.runs===1?'':'s'}`,P+86,ry+90);
    ctx.textAlign='right';ctx.fillStyle=C.text;ctx.font=`700 42px ${F}`;const t=formatTime(s.best);ctx.fillText(t,P+mapW-36,ry+rowH/2+15);
    if(s.pb){const tw=ctx.measureText(t).width;rrect(ctx,P+mapW-36-tw-24-62,ry+rowH/2-20,62,40,8);ctx.fillStyle='#EFF6FF';ctx.fill();ctx.fillStyle=C.blue;ctx.font=`800 24px ${F}`;ctx.textAlign='center';ctx.fillText('PB',P+mapW-36-tw-24-31,ry+rowH/2+8);}
    ctx.textAlign='left';
  });
  if(more>0){const ry=y+rows.length*rowH;ctx.beginPath();ctx.moveTo(P,ry);ctx.lineTo(P+mapW,ry);ctx.strokeStyle=C.border;ctx.stroke();ctx.textAlign='center';ctx.fillStyle=C.muted;ctx.font=`400 30px ${F}`;ctx.fillText(`+${more} more stage${more===1?'':'s'}`,W/2,ry+54);ctx.textAlign='left';}
  y+=listH+30;
  ctx.textAlign='center';ctx.fillStyle=C.mutedL;ctx.font=`600 28px ${F}`;ctx.fillText(window.location.host||'gate',W/2,y+40);
  return cv;
}
async function shareRecapImage(recap,name){
  const cv=await drawRecapImage(recap,name);
  const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
  if(!blob)return;
  const file=new File([blob],'gate-ride.png',{type:'image/png'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{await navigator.share({files:[file],title:'My GATE ride'});return;}catch(e){if(e&&e.name==='AbortError')return;}
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='gate-ride.png';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}

// ── Sheets ───────────────────────────────────────────────────────────────────
// The "+" sheet. For now it has one choice. todayInfo = {stages,runs} or null when there are no rides today.
function NewPostSheet({todayInfo,alreadyShared,busy,onDayRecap}){
  const ready=!!todayInfo&&!alreadyShared&&!busy;
  const sub=busy?"Building your recap…":alreadyShared?"Already shared today":todayInfo?`Today · ${todayInfo.stages} stage${todayInfo.stages===1?"":"s"} · ${todayInfo.runs} run${todayInfo.runs===1?"":"s"}`:"No rides today yet";
  return(
    <div style={{padding:"0 20px 28px"}}>
      <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:14}}>New post</div>
      <button className="tap" disabled={!ready} onClick={onDayRecap} style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:14,background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,textAlign:"left",opacity:ready?1:0.55}}>
        <div style={{width:44,height:44,borderRadius:12,background:`${C.green}15`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.BarChart size={20} color={C.green}/></div>
        <div style={{flex:1}}><div style={{fontSize:15,fontWeight:700,color:C.text}}>Day recap</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{sub}</div></div>
        <Icon.ChevronRight size={16} color={C.mutedL}/>
      </button>
    </div>
  );
}

function DayRecapPreviewSheet({recap,name,posting,onPost,onDismiss}){
  const [sharing,setSharing]=useState(false);
  return(
    <div style={{padding:"0 16px 22px"}}>
      <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:4,padding:"0 4px"}}>Share today's ride?</div>
      <div style={{fontSize:13,color:C.muted,marginBottom:12,padding:"0 4px"}}>Other riders on GATE will see this in their feed.</div>
      <div style={{marginBottom:14}}><DayRecapCard recap={recap}/></div>
      <div style={{display:"flex",gap:10}}>
        <button className="tap" onClick={onDismiss} style={{flex:"0 0 auto",whiteSpace:"nowrap",background:"#fff",border:`1px solid ${C.border}`,borderRadius:12,padding:"13px 16px",color:C.muted,fontSize:14,fontWeight:600}}>Not now</button>
        <button className="tap" disabled={sharing} onClick={async()=>{setSharing(true);try{await shareRecapImage(recap,name);}catch(e){}setSharing(false);}} style={{flex:1.5,whiteSpace:"nowrap",background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:12,padding:"13px 8px",color:C.blue,fontSize:14,fontWeight:700}}>{sharing?"Making image…":"Share image"}</button>
        <button className="tap" disabled={posting} onClick={onPost} style={{flex:2,whiteSpace:"nowrap",background:C.blue,border:"none",borderRadius:12,padding:"13px 8px",color:"#fff",fontSize:14,fontWeight:700,opacity:posting?0.7:1}}>{posting?"Posting…":"Post to Feed"}</button>
      </div>
    </div>
  );
}

export default function App(){
  const [tab,setTab]=useState("home");
  const [mapCenter,setMapCenter]=useState(DEFAULT_CENTER);
  const [flyToTrigger,setFlyToTrigger]=useState(null);
  const [zoom,setZoom]=useState(13);
  const [stages,setStages]=useState(SAMPLE_STAGES);
  const [courses,setCourses]=useState([]);   const [sheet,setSheet]=useState(null);
  const [editingCourse,setEditingCourse]=useState(null);
  const [showCourseBuilder,setShowCourseBuilder]=useState(false);
  const [stagesFilter,setStagesFilter]=useState("all");
  const [coursesFilter,setCoursesFilter]=useState("stages");
  const [activeRace,setActiveRace]=useState(null);
  const [selectedStage,setSelectedStage]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  const [showProgress,setShowProgress]=useState(false);
  const [showGroups,setShowGroups]=useState(false);
  const [activeGroup,setActiveGroup]=useState(null);
  const [groupMapOpen,setGroupMapOpen]=useState(false);
  const [pickingGroup,setPickingGroup]=useState(null);
  const [pickingExistingIds,setPickingExistingIds]=useState([]);
  const [showBikeSetup,setShowBikeSetup]=useState(false);
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const saveSettings=async(s)=>{setSettings(s);if(!user)return;await supabase.from('profiles').update({app_settings:{units:s.units,gpsAccuracy:s.gpsAccuracy,notifications:s.notifications,privacy:s.privacy}}).eq('id',user.id);};
  const [user,setUser]=useState(null);
    const goToStage=(stageId)=>{
  const stage=stages.find(s=>String(s.id)===String(stageId));
  if(!stage){alert("Couldn't find that stage");return;}
  setSelectedStage(stage);
  setMapCenter({lat:stage.start.lat,lng:stage.start.lng});
  setZoom(15);
  setTab('map');
  };
  const handlePickStage=async(s)=>{
  if(pickingExistingIds.includes(s.id)){alert(`${s.name} is already in this group`);return;}
  if(!window.confirm(`Add "${s.name}" to ${pickingGroup.name}?`))return;
  const{error}=await supabase.from('group_stages').insert({group_id:pickingGroup.id,stage_id:s.id,added_by:user.id});
  if(error){alert(error.message);return;}
  setPickingExistingIds(prev=>[...prev,s.id]);
  };
  const [showAuth,setShowAuth]=useState(false);
  const [pendingShareStage,setPendingShareStage]=useState(null);
  const [showNewPost,setShowNewPost]=useState(false);
  const [recapDraft,setRecapDraft]=useState(null);
  const [recapBusy,setRecapBusy]=useState(false);
  const [recapPosting,setRecapPosting]=useState(false);
  const [refreshTick,setRefreshTick]=useState(0);
    useEffect(()=>{
  const onVisible=()=>{if(document.visibilityState==="visible"){syncOfflineTimes().then(()=>setRefreshTick(t=>t+1));}};
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('pageshow',onVisible);
  window.addEventListener('online',onVisible);
  return()=>{document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('pageshow',onVisible);window.removeEventListener('online',onVisible);};
  },[]);

  useEffect(()=>{if(!user)return;supabase.from('profiles').select('display_name,avatar_url,app_settings,bike_name,rider_weight,tire_dry_front,tire_dry_rear,tire_wet_front,tire_wet_rear,shock_mode,shock_psi,shock_spring_rate,shock_lsc,shock_hsc,shock_lsr,shock_hsr,shock_hsb,shock_tokens,shock_sag,fork_mode,fork_psi,fork_spring_rate,fork_lsc,fork_hsc,fork_lsr,fork_hsr,fork_hsb,fork_tokens,fork_sag,bike_notes,fork_notes,shock_notes').eq('id',user.id).single().then(({data})=>{if(data)setSettings(prev=>({...prev,displayName:data.display_name||prev.displayName,avatarUrl:data.avatar_url||null,...(data.app_settings||{}),bikeName:data.bike_name??prev.bikeName,riderWeight:data.rider_weight??prev.riderWeight,tireDryFront:data.tire_dry_front??prev.tireDryFront,tireDryRear:data.tire_dry_rear??prev.tireDryRear,tireWetFront:data.tire_wet_front??prev.tireWetFront,tireWetRear:data.tire_wet_rear??prev.tireWetRear,shockMode:data.shock_mode??prev.shockMode,shockPsi:data.shock_psi??prev.shockPsi,shockSpringRate:data.shock_spring_rate??prev.shockSpringRate,shockLsc:data.shock_lsc??prev.shockLsc,shockHsc:data.shock_hsc??prev.shockHsc,shockLsr:data.shock_lsr??prev.shockLsr,shockHsr:data.shock_hsr??prev.shockHsr,shockHsb:data.shock_hsb??prev.shockHsb,shockTokens:data.shock_tokens??prev.shockTokens,shockSag:data.shock_sag??prev.shockSag,forkMode:data.fork_mode??prev.forkMode,forkPsi:data.fork_psi??prev.forkPsi,forkSpringRate:data.fork_spring_rate??prev.forkSpringRate,forkLsc:data.fork_lsc??prev.forkLsc,forkHsc:data.fork_hsc??prev.forkHsc,forkLsr:data.fork_lsr??prev.forkLsr,forkHsr:data.fork_hsr??prev.forkHsr,forkHsb:data.fork_hsb??prev.forkHsb,forkTokens:data.fork_tokens??prev.forkTokens,forkSag:data.fork_sag??prev.forkSag,bikeNotes:data.bike_notes??prev.bikeNotes,forkNotes:data.fork_notes??prev.forkNotes,shockNotes:data.shock_notes??prev.shockNotes}));});},[user,refreshTick]);
  const containerRef=useRef(null);
  const wakeLockRef=useRef(null);
  const [mapSize,setMapSize]=useState({w:390,h:844});
  const [userPos,setUserPos]=useState(DEFAULT_CENTER);
  const [userHeading,setUserHeading]=useState(null);

  useEffect(()=>{if(!navigator.geolocation)return;let centered=false;const id=navigator.geolocation.watchPosition(pos=>{const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};setUserPos(loc);if(typeof pos.coords.heading==='number'&&!isNaN(pos.coords.heading))setUserHeading(pos.coords.heading);if(!centered){setMapCenter(loc);centered=true;}},err=>console.log(err),{enableHighAccuracy:true,maximumAge:2000,timeout:10000});return()=>navigator.geolocation.clearWatch(id);},[]);

useEffect(()=>{
  if(activeRace&&'wakeLock'in navigator){
    navigator.wakeLock.request('screen').then(lock=>{wakeLockRef.current=lock;}).catch(err=>console.log(err));
  }
  return()=>{if(wakeLockRef.current){wakeLockRef.current.release();wakeLockRef.current=null;}};
},[activeRace]);
  
  useEffect(()=>{const el=containerRef.current;if(!el)return;const ro=new ResizeObserver(e=>setMapSize({w:e[0].contentRect.width,h:e[0].contentRect.height}));ro.observe(el);setMapSize({w:el.clientWidth,h:el.clientHeight});return()=>ro.disconnect();},[]);
  useEffect(()=>{
  supabase.auth.getSession().then(({data:{session}})=>setUser(session?.user??null));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setUser(session?.user??null));
  return()=>subscription.unsubscribe();
},[]);
useEffect(()=>{if(!user)return;supabase.from('stages').select('*').or(`privacy.eq.public,created_by.eq.${user.id}`).then(async({data})=>{if(!data)return;const{data:times}=await supabase.from('stage_times').select('stage_id,time_ms').eq('user_id',user.id);const bests={};if(times)times.forEach(t=>{if(!bests[t.stage_id]||t.time_ms<bests[t.stage_id])bests[t.stage_id]=t.time_ms;});setStages(prev=>{const prevCrById={};prev.forEach(s=>{prevCrById[s.id]=s.cr;});return data.map(s=>({id:s.id,name:s.name,note:s.note||'',privacy:s.privacy,difficulty:s.difficulty||'blue',built_by:s.built_by||null,created_by:s.created_by,start:{lat:s.start_lat,lng:s.start_lng},finish:{lat:s.finish_lat,lng:s.finish_lng},line_coords:s.line_coords||null,time:bests[s.id]||null,cr:prevCrById[s.id]||false}));});});},[user,refreshTick]);
    const stageIdsKey=useMemo(()=>stages.map(s=>s.id).join(','),[stages]);
  useEffect(()=>{
    if(!user||!stageIdsKey)return;
    const ids=stageIdsKey.split(',');
    supabase.from('stage_times').select('stage_id,user_id,time_ms').in('stage_id',ids).then(({data})=>{
      if(!data)return;
      const bestByStage={};
      data.forEach(t=>{if(!bestByStage[t.stage_id]||t.time_ms<bestByStage[t.stage_id].time_ms){bestByStage[t.stage_id]={user_id:t.user_id,time_ms:t.time_ms};}});
      setStages(prev=>prev.map(s=>{
        const best=bestByStage[s.id];
        const isCR=!!(best&&best.user_id===user.id);
        return s.cr===isCR?s:{...s,cr:isCR};
      }));
    });
  },[stageIdsKey,user,refreshTick]);

  
    useEffect(()=>{if(!user)return;supabase.from('courses').select('*').then(({data})=>{if(data)setCourses(data.map(c=>({id:c.id,name:c.name,privacy:c.privacy,mode:c.mode,created_by:c.created_by,stageIds:c.stage_ids,times:{},bestPerStage:{}})));});},[user,refreshTick]);
  const [courseResults,setCourseResults]=useState([]);    const [courseCRCount,setCourseCRCount]=useState(0);
  const [courseCRList,setCourseCRList]=useState([]);
  const [expandedCRCourse,setExpandedCRCourse]=useState(null);
  const courseIdsKey=useMemo(()=>courses.map(c=>c.id).join(','),[courses]);
  useEffect(()=>{
    if(!user||!courseIdsKey)return;
    const ids=courseIdsKey.split(',');
    supabase.from('course_results').select('course_id,user_id,total_time_ms').in('course_id',ids).then(({data})=>{
      if(!data)return;
      const bestByCourse={};
      data.forEach(r=>{if(!bestByCourse[r.course_id]||r.total_time_ms<bestByCourse[r.course_id].total_time_ms){bestByCourse[r.course_id]={user_id:r.user_id,total_time_ms:r.total_time_ms};}});
      const mine=Object.entries(bestByCourse).filter(([,b])=>b.user_id===user.id);
      setCourseCRCount(mine.length);
            setCourseCRList(mine.map(([cid,b])=>{
        const course=courses.find(c=>String(c.id)===String(cid));
        return course?{id:course.id,name:course.name,stageIds:course.stageIds,totalTime:b.total_time_ms}:null;
      }).filter(Boolean));
    });
  },[courseIdsKey,user,courses,refreshTick]);
  useEffect(()=>{if(!user)return;supabase.from('course_results').select('id,total_time_ms,mode,completed_at,courses(name,stage_ids)').eq('user_id',user.id).order('completed_at',{ascending:false}).then(({data})=>{if(data)setCourseResults(data.map(r=>({id:r.id,name:r.courses?.name||'Course',date:new Date(r.completed_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}),stages:r.courses?.stage_ids?.length||0,mode:r.mode,totalTime:r.total_time_ms,pos:null})));});},[user]);

    const [recentStageTimes,setRecentStageTimes]=useState([]);
const [feed,setFeed]=useState([]);
useEffect(()=>{if(!user)return;supabase.from('app_events').select('id,event_type,message,created_at,stage_id,context,profiles(display_name,avatar_url)').in('event_type',['stage_record','personal_best','course_finish','stage_created','course_created','day_recap']).order('created_at',{ascending:false}).limit(50).then(({data})=>{if(data)setFeed(data.map(e=>({id:e.id,event_type:e.event_type,message:e.message,stage_id:e.stage_id,userName:e.profiles?.display_name||'Rider',avatarUrl:e.profiles?.avatar_url||null,context:e.context,ago:timeAgo(e.created_at)})));});},[user,refreshTick]);
  const [pushState,setPushState]=useState('hidden');
useEffect(()=>{
  if(!user)return;
  if(pushSupported()){
    if(Notification.permission==='granted'){setPushState('hidden');savePushSubscription().catch(e=>console.log('push save failed',e));}
    else if(Notification.permission==='default')setPushState('prompt');
    else setPushState('hidden');
  }else if(isIOS()&&!isStandalone()){
    let dismissed=false;try{dismissed=!!localStorage.getItem('gate_ios_hint_dismissed');}catch(e){}
    setPushState(dismissed?'hidden':'ios');
  }else setPushState('hidden');
},[user?.id]);
const turnOnNotifications=async()=>{
  const r=await enablePush();
  if(r.ok)setPushState('done');
  else if(r.reason==='denied')setPushState('hidden');
  else alert("Couldn't turn on notifications: "+r.reason);
};
const dismissIosHint=()=>{try{localStorage.setItem('gate_ios_hint_dismissed','1');}catch(e){}setPushState('hidden');};
 const [rivals,setRivals]=useState([]);
const rivalStageKey=useMemo(()=>stages.filter(s=>s.time).map(s=>s.id).join(','),[stages]);
useEffect(()=>{
  if(!user||!rivalStageKey){setRivals([]);return;}
  const ids=rivalStageKey.split(',');
  supabase.from('stage_times').select('stage_id,user_id,time_ms,profiles(display_name)').in('stage_id',ids).then(({data})=>{
    if(!data)return;
    const byStage={};
    data.forEach(t=>{
      const st=(byStage[t.stage_id]=byStage[t.stage_id]||{});
      const cur=st[t.user_id];
      if(!cur||t.time_ms<cur.time)st[t.user_id]={user_id:t.user_id,time:t.time_ms,name:(t.profiles&&t.profiles.display_name)||'Rider'};
    });
    const cards=[];
    Object.keys(byStage).forEach(stageId=>{
      const list=Object.values(byStage[stageId]).sort((a,b)=>a.time-b.time);
      const idx=list.findIndex(e=>e.user_id===user.id);
      if(idx<0)return;
      const me=list[idx];
      const limit=Math.max(2000,me.time*0.05);
      const stage=stages.find(s=>String(s.id)===String(stageId));
      if(!stage)return;
      const ahead=idx>0?list[idx-1]:null;
      const behind=idx<list.length-1?list[idx+1]:null;
      const aGap=ahead?me.time-ahead.time:Infinity;
      const bGap=behind?behind.time-me.time:Infinity;
      if(aGap<=limit&&aGap<=bGap)cards.push({key:stageId+'a',kind:'chase',stageId,stageName:stage.name,name:ahead.name.split(' ')[0],gap:aGap});
      else if(bGap<=limit)cards.push({key:stageId+'b',kind:'defend',stageId,stageName:stage.name,name:behind.name.split(' ')[0],gap:bGap,pos:idx+1});
    });
    cards.sort((a,b)=>a.gap-b.gap);
    setRivals(cards.slice(0,3));
  });
},[rivalStageKey,user,refreshTick]);
const [diffFilter,setDiffFilter]=useState({});
const [sortMode,setSortMode]=useState('popular');
const [stageRides,setStageRides]=useState({});
useEffect(()=>{
  if(!user||!stageIdsKey)return;
  const since=new Date();since.setDate(since.getDate()-30);
  supabase.from('stage_times').select('stage_id').in('stage_id',stageIdsKey.split(',')).gte('created_at',since.toISOString()).then(({data})=>{
    if(!data)return;
    const counts={};
    data.forEach(t=>{counts[t.stage_id]=(counts[t.stage_id]||0)+1;});
    setStageRides(counts);
  });
},[stageIdsKey,user,refreshTick]);
const [notifications,setNotifications]=useState([]);
const [showNotifications,setShowNotifications]=useState(false);
useEffect(()=>{if(!user)return;supabase.from('notifications').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50).then(({data})=>{if(data)setNotifications(data);});},[user,refreshTick]);
const unreadCount=notifications.filter(n=>!n.read_at).length;
const markNotificationRead=(id)=>{
  const now=new Date().toISOString();
  setNotifications(prev=>prev.map(n=>n.id===id?{...n,read_at:now}:n));
  supabase.from('notifications').update({read_at:now}).eq('id',id).then(()=>{});
};
const markAllNotificationsRead=()=>{
  const now=new Date().toISOString();
  setNotifications(prev=>prev.map(n=>n.read_at?n:{...n,read_at:now}));
  supabase.from('notifications').update({read_at:now}).eq('user_id',user.id).is('read_at',null).then(()=>{});
};
const openNotification=(n)=>{
  if(!n.read_at)markNotificationRead(n.id);
  setShowNotifications(false);
  if(n.kind==='course_record_lost'){setCoursesFilter('courses');setTab('stages');}
  else if(n.stage_id)goToStage(n.stage_id);
}; 
const [todayStageTimes,setTodayStageTimes]=useState([]);
const [daySharedToday,setDaySharedToday]=useState(false);
useEffect(()=>{if(!user)return;const startOfDay=new Date();startOfDay.setHours(0,0,0,0);supabase.from('stage_times').select('time_ms,stage_id').eq('user_id',user.id).gte('created_at',startOfDay.toISOString()).then(({data})=>{if(data)setTodayStageTimes(data);});supabase.from('app_events').select('id').eq('user_id',user.id).eq('event_type','day_recap').gte('created_at',startOfDay.toISOString()).then(({data})=>{setDaySharedToday(!!(data&&data.length));});},[user,refreshTick]);
const openDayRecap=async()=>{
  if(recapBusy)return;setRecapBusy(true);
  const r=await computeDayRecap(user,stages).catch(()=>null);
  setRecapBusy(false);
  if(!r){alert("No rides found for today yet.");return;}
  setShowNewPost(false);setRecapDraft(r);
};
const postDayRecap=async()=>{
  if(!recapDraft||recapPosting)return;setRecapPosting(true);
  const n=recapDraft.stages.length;
  await logEvent(user.id,'day_recap',`rode ${n} stage${n===1?'':'s'} today · ${formatTime(recapDraft.total_time_ms)}`,null,recapDraft);
  setRecapPosting(false);setRecapDraft(null);setDaySharedToday(true);setRefreshTick(t=>t+1);
};
  const [todayKey,setTodayKey]=useState(new Date().toDateString());
  useEffect(()=>{
    const check=()=>{const now=new Date().toDateString();setTodayKey(prev=>prev!==now?now:prev);};
    document.addEventListener('visibilitychange',check);
    const interval=setInterval(check,60000);
    return()=>{document.removeEventListener('visibilitychange',check);clearInterval(interval);};
  },[]);
  useEffect(()=>{if(!user)return;const since=new Date();since.setDate(since.getDate()-83);since.setHours(0,0,0,0);supabase.from('stage_times').select('stage_id,time_ms,created_at').eq('user_id',user.id).gte('created_at',since.toISOString()).then(({data})=>{if(data)setRecentStageTimes(data);});},[user,refreshTick]);

    const weeklyActivity=useMemo(()=>{
    const monday=getMonday(new Date());
    const days=[];
    for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(d.getDate()+i);days.push(d);}
    const dayKeys=days.map(d=>d.toDateString());
    const dayLabels=days.map(d=>d.toLocaleDateString('en-GB',{weekday:'narrow'}));
    const distByDay={};
    dayKeys.forEach(k=>distByDay[k]=0);
    recentStageTimes.forEach(t=>{
      const stage=stages.find(s=>s.id===t.stage_id);
      if(!stage)return;
      const key=new Date(t.created_at).toDateString();
      if(key in distByDay)distByDay[key]+=haversine(stage.start,stage.finish);
    });
    return{meters:dayKeys.map(k=>distByDay[k]),dayLabels};
  },[stages,recentStageTimes,todayKey]);
  
    const pastWeeks=useMemo(()=>{
    const thisMonday=getMonday(new Date());
    const buckets=[];
    for(let w=11;w>=0;w--){
      const start=new Date(thisMonday);
      start.setDate(start.getDate()-w*7);
      const end=new Date(start);
      end.setDate(end.getDate()+6);
      end.setHours(23,59,59,999);
      buckets.push({start,end,stages:0,mins:0});
    }
    recentStageTimes.forEach(t=>{
      const created=new Date(t.created_at);
      const bucket=buckets.find(b=>created>=b.start&&created<=b.end);
      if(bucket){bucket.stages+=1;bucket.mins+=t.time_ms/60000;}
    });
    return buckets.map(b=>({stages:b.stages,mins:Math.round(b.mins)}));
  },[recentStageTimes,todayKey]);

const weekStats=useMemo(()=>{
  const thisMonday=getMonday(new Date());
  const buckets=[];
  for(let wk=11;wk>=0;wk--){
    const start=new Date(thisMonday);
    start.setDate(start.getDate()-wk*7);
    const end=new Date(start);
    end.setDate(end.getDate()+6);
    end.setHours(23,59,59,999);
    buckets.push({start,end,stageSet:new Set(),runs:0,mins:0,pbs:0,days:[false,false,false,false,false,false,false]});
  }
  const bestByStage={};
  [...recentStageTimes].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).forEach(t=>{
    const created=new Date(t.created_at);
    const prev=bestByStage[t.stage_id];
    const isPb=prev!==undefined&&t.time_ms<prev;
    if(prev===undefined||t.time_ms<prev)bestByStage[t.stage_id]=t.time_ms;
    const bucket=buckets.find(b=>created>=b.start&&created<=b.end);
    if(!bucket)return;
    bucket.stageSet.add(t.stage_id);
    bucket.runs+=1;
    bucket.mins+=t.time_ms/60000;
    if(isPb)bucket.pbs+=1;
    const dayIdx=Math.round((new Date(created.getFullYear(),created.getMonth(),created.getDate())-new Date(bucket.start.getFullYear(),bucket.start.getMonth(),bucket.start.getDate()))/86400000);
    if(dayIdx>=0&&dayIdx<7)bucket.days[dayIdx]=true;
  });
  return buckets.map(b=>({stages:b.stageSet.size,runs:b.runs,mins:Math.round(b.mins),pbs:b.pbs,days:b.days}));
},[recentStageTimes,todayKey]);

  const dragRef=useRef(null),pinchRef=useRef(null);
  const onTouchStart=useCallback(e=>{if(e.touches.length===2){return;}else{dragRef.current={x:e.touches[0].clientX,y:e.touches[0].clientY,center:{...mapCenter}};pinchRef.current=null;}},[mapCenter,zoom]);
  const onTouchMove=useCallback(e=>{e.preventDefault();if(e.touches.length===1&&dragRef.current){const dx=e.touches[0].clientX-dragRef.current.x,dy=e.touches[0].clientY-dragRef.current.y,scale=Math.pow(2,zoom)*256,mercY=Math.log(Math.tan(Math.PI/4+(dragRef.current.center.lat*Math.PI)/360)),newMercY=mercY+(dy/scale)*Math.PI*2;setMapCenter({lng:dragRef.current.center.lng-(dx/scale)*360,lat:((Math.atan(Math.exp(newMercY))*2-Math.PI/2)*180)/Math.PI});}},[zoom]);
  const onTouchEnd=()=>{dragRef.current=null;pinchRef.current=null;};
  const mouseRef=useRef(null);
  const onMouseDown=e=>{mouseRef.current={x:e.clientX,y:e.clientY,center:{...mapCenter}};};
  const onMouseMove=e=>{if(!mouseRef.current)return;const dx=e.clientX-mouseRef.current.x,dy=e.clientY-mouseRef.current.y,scale=Math.pow(2,zoom)*256,mercY=Math.log(Math.tan(Math.PI/4+(mouseRef.current.center.lat*Math.PI)/360)),newMercY=mercY+(dy/scale)*Math.PI*2;setMapCenter({lng:mouseRef.current.center.lng-(dx/scale)*360,lat:((Math.atan(Math.exp(newMercY))*2-Math.PI/2)*180)/Math.PI});};
  const onMouseUp=()=>{mouseRef.current=null;};
  const onWheel=e=>{e.preventDefault();setZoom(z=>Math.max(8,Math.min(18,z-e.deltaY*0.003)));};    const [proximityFilter,setProximityFilter]=useState("nearby");
  const diffKeys=Object.keys(diffFilter);
  const filteredStages=stages.filter(s=>stagesFilter==="all"||s.privacy===stagesFilter).filter(s=>proximityFilter==="explore"||haversine(userPos,s.start)<=32187).filter(s=>diffKeys.length===0||diffFilter[s.difficulty||'blue']).sort((a,b)=>sortMode==='popular'?((stageRides[b.id]||0)-(stageRides[a.id]||0)):(haversine(userPos,a.start)-haversine(userPos,b.start)));
  const popularStages=[...filteredStages].sort((a,b)=>(stageRides[b.id]||0)-(stageRides[a.id]||0)).filter(s=>(stageRides[s.id]||0)>0).slice(0,4);
  const [mapSearchQuery,setMapSearchQuery]=useState("");
  const mapSearchResults=mapSearchQuery.trim()?stages.filter(s=>s.name.toLowerCase().includes(mapSearchQuery.trim().toLowerCase())).slice(0,6):[];

    const TABS=[{id:"home",label:"Home",Ic:Icon.Home},{id:"map",label:"Map",Ic:Icon.Map},{id:"stages",label:"Stages",Ic:Icon.Lightning},{id:"profile",label:"Profile",Ic:Icon.User}];
    if(!user)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden"}}>
      <style>{STYLES}</style>
      <Analytics/>
      <AuthScreen/>
    </div>
  );

    // Settings screen overlay
  if(showSettings)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif"}}>
      <style>{STYLES}</style>
      <div style={{height:44,background:"#fff"}}/>
           <SettingsScreen settings={settings} onSave={saveSettings} 
onBack={()=>setShowSettings(false)}/>
</div>
);

// Bike Setup screen overlay
if(showBikeSetup)return(
<div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif",background:"#fff"}}>
<style>{STYLES}</style>
<div style={{height:44,background:"#fff"}}/>
<BikeSetupScreen settings={settings} onSave={setSettings} onBack={()=>setShowBikeSetup(false)}/>
</div>
);

        // Course builder overlay
  if(showCourseBuilder)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif",background:"#fff"}}>
      <style>{STYLES}</style>
      <div style={{height:44,background:"#fff"}}/>
      <div style={{height:"calc(100vh - 44px)"}}>
        <CourseBuilderSheet stages={stages} course={editingCourse} onClose={()=>{setShowCourseBuilder(false);setEditingCourse(null);}} onSave={async c=>{if(c.id&&courses.some(x=>x.id===c.id)){const{error}=await supabase.from('courses').update({name:c.name,privacy:c.privacy,mode:c.mode,stage_ids:c.stageIds}).eq('id',c.id);if(error){alert(error.message);}else{setCourses(prev=>prev.map(x=>x.id===c.id?{...x,name:c.name,privacy:c.privacy,mode:c.mode,stageIds:c.stageIds}:x));}setShowCourseBuilder(false);setEditingCourse(null);}else{const{data,error}=await supabase.from('courses').insert({name:c.name,privacy:c.privacy,mode:c.mode,stage_ids:c.stageIds,created_by:user.id}).select().single();if(!error){setCourses(prev=>[...prev,{...c,id:data.id,created_by:user.id}]);if(c.privacy!=="private"&&window.confirm(`Share "${c.name}" to the feed?`)){logEvent(user.id,'course_created',`created a new course: ${c.name}`).then(()=>setRefreshTick(t=>t+1));}}setShowCourseBuilder(false);setCoursesFilter("courses");setTab("stages");}}}/>
      </div>
    </div>
  );

    // Statistics screen overlay
  if(showProgress)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif",background:"#fff"}}>
      <style>{STYLES}</style>
            <StatisticsScreen stages={stages} courses={courses} user={user} onBack={()=>setShowProgress(false)}
        crCount={stages.filter(s=>s.cr).length} courseCRCount={courseCRCount}
        stagesRiddenCount={stages.filter(s=>s.time).length} coursesCompleteCount={courseResults.length}
        courseCRList={courseCRList}/>
    </div>
  );

    // Groups screen overlay
  if(showGroups)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif",background:"#fff"}}>
      <style>{STYLES}</style>
      {activeGroup
        ?(groupMapOpen
            ?<GroupMapScreen group={activeGroup} stages={stages} user={user} onBack={()=>setGroupMapOpen(false)} onAddStages={()=>{
                const g=activeGroup;
                setPickingGroup(g);
                supabase.from('group_stages').select('stage_id').eq('group_id',g.id).then(({data})=>{setPickingExistingIds((data||[]).map(s=>s.stage_id));});
                setGroupMapOpen(false);
                setShowGroups(false);
                setTab('map');
              }}/>
            :<GroupDetailScreen group={activeGroup} user={user} onBack={()=>setActiveGroup(null)} onOpenMap={()=>setGroupMapOpen(true)}/>)
        :<GroupsScreen user={user} onBack={()=>setShowGroups(false)} onOpenGroup={g=>setActiveGroup(g)}/>}
    </div>
  );

  
  if(showNotifications)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif",background:"#fff"}}>
      <style>{STYLES}</style>
      <NotificationsScreen notifications={notifications} onBack={()=>setShowNotifications(false)} onMarkAll={markAllNotificationsRead} onOpen={openNotification}/>
    </div>
  );
  if(activeRace)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif"}}>
      <style>{STYLES}</style>
      <RaceScreen course={activeRace} stages={stages} user={user} onFinish={()=>setActiveRace(null)} onActivity={()=>setRefreshTick(t=>t+1)}/>

    </div>
  );

  return(
        <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",background:"#fff",overflow:"hidden",fontFamily:"'Inter',sans-serif"}}>
      <style>{STYLES}</style>
      <Analytics/>
      <div style={{height:44,background:tab==="map"?"transparent":"#fff",position:"relative",zIndex:10}}/>

            {/* HOME */}
      {tab==="home"&&(
        <div style={{height:"calc(100vh - 44px - 83px)",overflowY:"auto"}}>
          <div style={{padding:"12px 16px 14px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:"#fff",zIndex:5}}>
            <div style={{fontSize:22,fontWeight:800,color:C.text,marginBottom:12}}>Feed</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <button className="tap" onClick={()=>setShowGroups(true)} style={{width:38,height:38,borderRadius:11,background:"#fff",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}><Icon.Users size={17} color={C.text}/></button>
              <button className="tap" onClick={()=>setShowNewPost(true)} style={{width:38,height:38,borderRadius:11,background:"#fff",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}><Icon.Plus size={19} color={C.text}/></button>
              <button className="tap" style={{flex:1,height:38,display:"flex",alignItems:"center",justifyContent:"center",gap:7,background:"#fff",border:`1px solid ${C.border}`,borderRadius:11,padding:"0 12px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}><svg width="13" height="13" viewBox="0 0 24 24"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" fill={C.blue}/></svg><span style={{color:C.text,fontSize:14,fontWeight:700}}>Upgrade</span></button>
               <button className="tap" onClick={()=>setShowNotifications(true)} style={{position:"relative",width:38,height:38,borderRadius:11,background:"#fff",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}><Icon.Bell size={17} color={C.text}/>{unreadCount>0&&<div style={{position:"absolute",top:-5,right:-5,minWidth:17,height:17,padding:"0 4px",borderRadius:9,background:C.blue,color:"#fff",fontSize:10,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #fff",boxSizing:"content-box"}}>{unreadCount>9?"9+":unreadCount}</div>}</button>
            </div>
          </div>
          <OfflineBanner/>
          {pushState==='prompt'&&(
            <div style={{margin:"14px 16px 0",background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:12,padding:14,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icon.Bell size={18} color={C.blue}/></div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text}}>Turn on notifications</div><div style={{fontSize:12,color:C.muted,marginTop:2,lineHeight:1.35}}>Know straight away when someone beats your time or takes your record.</div></div>
              <button className="tap" onClick={turnOnNotifications} style={{background:C.blue,border:"none",borderRadius:9,padding:"9px 14px",color:"#fff",fontSize:13,fontWeight:700}}>Turn on</button>
            </div>
          )}
          {pushState==='done'&&(
            <div style={{margin:"14px 16px 0",padding:"11px 14px",background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:12,fontSize:13,fontWeight:600,color:C.green}}>✓ Notifications are on</div>
          )}
          {pushState==='ios'&&(
            <div style={{margin:"14px 16px 0",background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:14,display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text}}>Get alerts on your iPhone</div><div style={{fontSize:12,color:C.muted,marginTop:2,lineHeight:1.35}}>Tap Share, then Add to Home Screen, and open GATE from the new icon.</div></div>
              <button className="tap" onClick={dismissIosHint} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:9,padding:"8px 12px",color:C.text,fontSize:12,fontWeight:600}}>Got it</button>
            </div>
          )}
          {rivals.length>0&&(
            <div style={{padding:"16px 16px 0"}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:8}}>Rivals</div>
              <div style={{border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                {rivals.map((r,i)=>(
                  <button key={r.key} className="tap" onClick={()=>goToStage(r.stageId)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#fff",border:"none",borderBottom:i<rivals.length-1?`1px solid ${C.border}`:"none",textAlign:"left"}}>
                    <div style={{width:34,height:34,borderRadius:9,background:r.kind==='chase'?"#EFF6FF":"#FFFBEB",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {r.kind==='chase'?<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>:r.pos===1?<GoldCrown size={16}/>:<span style={{fontSize:11,fontWeight:800,color:C.yellow}}>P{r.pos}</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:700,color:r.kind==='chase'?C.blue:C.yellow,letterSpacing:0.5}}>{r.kind==='chase'?"CHASE":"DEFEND"}</div>
                      <div style={{fontSize:13,color:C.text,lineHeight:1.35,marginTop:1}}>{r.name} is <span style={{fontWeight:700}}>{(r.gap/1000).toFixed(2)}s</span> {r.kind==='chase'?"ahead of you":"behind you"} on {r.stageName}</div>
                    </div>
                    <Icon.ChevronRight size={16} color={C.mutedL}/>
                  </button>
                ))}
              </div>
            </div>
          )}
          {feed.length===0?<div style={{textAlign:"center",padding:"48px 20px",color:C.muted,fontSize:13}}>No activity yet — set a record, finish a course, or add a stage to get things started.</div>:feed.map(item=><FeedCard key={item.id} item={item} stage={stages.find(s=>String(s.id)===String(item.stage_id))} onViewStage={goToStage}/>)}
        </div>
      )}

      {/* MAP */}
      {tab==="map"&&(
        <div style={{position:"absolute",inset:0}}>
          <div style={{position:"absolute",inset:0,cursor:"grab",touchAction:"none"}} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
              <MapboxStyleMap center={mapCenter} zoom={zoom} flyToTrigger={flyToTrigger} width={mapSize.w} height={mapSize.h} stages={stages} courses={courses} userPos={userPos} userHeading={userHeading} diffFilter={diffFilter} onStagePress={s=>pickingGroup?handlePickStage(s):setSelectedStage(s)}/>
          </div>
                       <div style={{position:"absolute",top:52,left:16,right:16,zIndex:10}}>
            {pickingGroup?(
              <div style={{background:C.blue,borderRadius:12,padding:"12px 14px",boxShadow:"0 2px 10px rgba(0,0,0,0.15)",display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Adding to {pickingGroup.name}</div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.75)",marginTop:1}}>Tap a stage to add it</div>
                </div>
                <button className="tap" onClick={()=>{const g=pickingGroup;setPickingGroup(null);setActiveGroup(g);setGroupMapOpen(true);setShowGroups(true);}} style={{background:"#fff",border:"none",borderRadius:8,padding:"8px 16px",color:C.blue,fontSize:13,fontWeight:700}}>Done</button>
              </div>
            ):(
              <>
                <div style={{display:"flex",gap:10}}>
                  <div style={{flex:1,background:"white",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:8,boxShadow:"0 2px 10px rgba(0,0,0,0.1)"}}>
                    <Icon.Search/>
                    <input value={mapSearchQuery} onChange={e=>setMapSearchQuery(e.target.value)} placeholder="Search stages…" style={{border:"none",outline:"none",background:"none",fontSize:14,color:C.text,flex:1,fontFamily:"'Inter',sans-serif"}}/>
                    {mapSearchQuery&&<button onClick={()=>setMapSearchQuery("")} style={{background:"none",border:"none",padding:0,display:"flex"}}><Icon.Close size={14} color={C.muted}/></button>}
                  </div>
                  <button className="tap" onClick={()=>setSheet("stageBuilder")} style={{background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:12,padding:"10px 16px",display:"flex",alignItems:"center",gap:6,boxShadow:"0 2px 10px rgba(0,0,0,0.08)"}}><Icon.Plus size={20} color={C.blue}/><span style={{fontSize:13,fontWeight:600,color:C.blue,whiteSpace:"nowrap"}}>Stage</span></button>
                </div>
                {mapSearchQuery.trim()&&(mapSearchResults.length>0?(
                  <div style={{marginTop:8,background:"#fff",borderRadius:12,border:`1px solid ${C.border}`,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",overflow:"hidden"}}>
                    {mapSearchResults.map((s,i)=>(
                      <button key={s.id} className="tap" onClick={()=>{setMapCenter({lat:s.start.lat,lng:s.start.lng});setZoom(15);setFlyToTrigger(Date.now());setSelectedStage(s);setMapSearchQuery("");}} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:"none",border:"none",borderBottom:i<mapSearchResults.length-1?`1px solid ${C.border}`:"none",textAlign:"left"}}>
                        <Icon.Lightning size={15} color={C.blue}/>
                        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{s.name}</div><div style={{fontSize:11,color:C.muted}}>{formatDist(haversine(s.start,s.finish))} · {s.privacy}</div></div>
                      </button>
                    ))}
                  </div>
                ):(
                  <div style={{marginTop:8,background:"#fff",borderRadius:12,border:`1px solid ${C.border}`,padding:"14px",textAlign:"center",fontSize:13,color:C.muted,boxShadow:"0 4px 16px rgba(0,0,0,0.12)"}}>No stages found</div>
                ))}
              </>
            )}
          </div>       

          {!pickingGroup&&(
            <div style={{position:"absolute",top:106,left:16,right:16,zIndex:9}}>
              <DifficultyChips value={diffFilter} onChange={setDiffFilter} shadow/>
            </div>
          )}
          <div style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",display:"flex",flexDirection:"column",gap:6,zIndex:10}}>
            {[{l:"+",a:()=>setZoom(z=>Math.min(18,z+1))},{l:"−",a:()=>setZoom(z=>Math.max(8,z-1))},{l:"⌖",a:()=>{setMapCenter(userPos);setFlyToTrigger(Date.now());}}].map(({l,a})=>(
              <button key={l} className="tap" onClick={a} style={{width:36,height:36,borderRadius:9,background:"white",border:`1px solid ${C.border}`,fontSize:l==="⌖"?14:18,display:"flex",alignItems:"center",justifyContent:"center",color:C.text,boxShadow:"0 2px 6px rgba(0,0,0,0.08)"}}>{l}</button>
            ))}
          </div>
                    {selectedStage&&sheet!=='sections'&&(
            <><div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.3)",zIndex:39}} onClick={()=>setSelectedStage(null)}/><div className="slide-up" style={{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:40,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageDetailSheet stage={selectedStage} units={settings.units} onClose={()=>setSelectedStage(null)}onRace={()=>{setActiveRace({id:Date.now(),name:selectedStage.name,stageIds:[selectedStage.id],mode:'race',times:{},bestPerStage:{}});setSelectedStage(null);}}
onOpenSections={()=>setSheet('sections')}
user={user}
onRename={(id,newName)=>{setStages(prev=>prev.map(s=>s.id===id?{...s,name:newName}:s));setSelectedStage(prev=>prev&&prev.id===id?{...prev,name:newName}:prev);}}/></div></>
)}
{sheet==="stageBuilder"&&(
           <><div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.25)",zIndex:39}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:40,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageBuilderSheet onClose={()=>setSheet(null)} onSave={async s=>{const{data,error}=await supabase.from('stages').insert({name:s.name,note:s.note,privacy:s.privacy,difficulty:s.difficulty,built_by:s.builtBy||null,start_lat:s.start.lat,start_lng:s.start.lng,finish_lat:s.finish.lat,finish_lng:s.finish.lng,created_by:user.id,line_coords:s.lineCoords||null}).select().single();if(error){alert(error.message);setSheet(null);return;}const newStage={...s,id:data.id,created_by:user.id,built_by:s.builtBy||null,line_coords:s.lineCoords||null};setStages(prev=>[...prev,newStage]);setSheet(null);if(s.privacy!=="private")setPendingShareStage(newStage);}}/></div></>
          )}
        </div>
      )}

      {/* STAGES */}
      {tab==="stages"&&(
        <div style={{height:"calc(100vh - 44px - 83px)",overflowY:"auto"}}>
                    <div style={{padding:"12px 16px 0",position:"sticky",top:0,background:"#fff",zIndex:5,borderBottom:`1px solid ${C.border}`,paddingBottom:12}}>
            <div style={{display:"flex",background:C.surface,borderRadius:10,padding:3,marginBottom:12}}>
              {[{val:"stages",label:"Stages"},{val:"courses",label:"Courses"}].map(t=>(
                <button key={t.val} className="tap" onClick={()=>setCoursesFilter(t.val)} style={{flex:1,padding:"9px",borderRadius:8,background:coursesFilter===t.val?"#fff":"none",border:"none",color:coursesFilter===t.val?C.text:C.muted,fontSize:14,fontWeight:coursesFilter===t.val?600:400,boxShadow:coursesFilter===t.val?"0 1px 4px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>{t.label}</button>
              ))}
            </div>
            {coursesFilter==="stages"&&<div style={{display:"flex",gap:8,marginBottom:12}}>
              {[{val:"nearby",label:"📍 Nearby",sub:"Within 20mi"},{val:"explore",label:"🌍 Explore",sub:"All stages"}].map(p=>(
                <button key={p.val} className="tap" onClick={()=>setProximityFilter(p.val)} style={{flex:1,background:proximityFilter===p.val?`${C.blue}10`:C.surface,border:`1.5px solid ${proximityFilter===p.val?C.blue:C.border}`,borderRadius:10,padding:"10px 8px",textAlign:"center",transition:"all 0.15s"}}>
                  <div style={{fontSize:13,fontWeight:600,color:proximityFilter===p.val?C.blue:C.text}}>{p.label}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:1}}>{p.sub}</div>
                </button>
              ))}
            </div>}
            {coursesFilter==="stages"&&<div style={{marginBottom:10}}><DifficultyChips value={diffFilter} onChange={setDiffFilter}/></div>}
            {coursesFilter==="stages"&&<div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:2}}>
              {[{v:"all",l:"All"},{v:"public",l:"Public"},{v:"group",l:"Group"},{v:"private",l:"Private"}].map(f=>(
                <button key={f.v} className="tap" onClick={()=>setStagesFilter(f.v)} style={{padding:"6px 14px",borderRadius:20,whiteSpace:"nowrap",background:stagesFilter===f.v?"white":C.surface,border:`1px solid ${stagesFilter===f.v?C.blue:C.border}`,color:stagesFilter===f.v?C.blue:C.text,fontSize:13,fontWeight:stagesFilter===f.v?600:400}}>{f.l}</button>
              ))}
            </div>}
          </div>
                {coursesFilter==="stages"&&popularStages.length>0&&(
            <div style={{padding:"16px 0 0"}}>
              <div style={{margin:"0 16px 8px"}}><span style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase"}}>Popular near you</span><span style={{fontSize:11,color:"#9A9A9A"}}> · most rides this month</span></div>
              <div style={{display:"flex",gap:10,overflowX:"auto",padding:"2px 16px 4px"}}>
                {popularStages.map((s,i)=><PopularStageCard key={s.id} stage={s} rank={i+1} rides={stageRides[s.id]||0} distKm={haversine(userPos,s.start)/1000} onPress={st=>{setSelectedStage(st);setMapCenter({lat:st.start.lat,lng:st.start.lng});setZoom(15);setTab("map");}}/>)}
              </div>
            </div>
          )}
          {coursesFilter==="stages"&&filteredStages.length>0&&(
            <div style={{padding:"18px 16px 6px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase"}}>All stages</span>
              <button className="tap" onClick={()=>setSortMode(m=>m==='popular'?'closest':'popular')} style={{background:"none",border:"none",padding:0,fontSize:12,fontWeight:600,color:C.blue}}>Sort: {sortMode==='popular'?'Popular':'Closest'} ▾</button>
            </div>
          )}
          {coursesFilter==="stages"&&(filteredStages.length===0?<div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}><Icon.Lightning size={36} color={C.mutedL}/><div style={{fontSize:15,fontWeight:500,marginBottom:4,marginTop:12}}>{proximityFilter==="nearby"?"No stages nearby":"No stages"}</div>{proximityFilter==="nearby"&&<div style={{fontSize:13,color:C.mutedL,marginBottom:16}}>Try Explore to see stages further afield</div>}</div>:filteredStages.map(s=><SegmentRow key={s.id} stage={s} userId={user.id} onPress={s=>{setSelectedStage(s);setMapCenter({lat:s.start.lat,lng:s.start.lng});setZoom(15);setTab("map");}} onDelete={async id=>{if(!window.confirm("Delete this stage?"))return;await supabase.from('stages').delete().eq('id',id).eq('created_by',user.id);setStages(prev=>prev.filter(s=>s.id!==id));}}/>))}


          {coursesFilter==="courses"&&(
            <div style={{padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div style={{fontSize:22,fontWeight:800,color:C.text}}>Courses</div>
                  <button className="tap" onClick={()=>{setEditingCourse(null);setShowCourseBuilder(true);}} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"9px 14px",color:C.blue,fontSize:13,fontWeight:600}}><Icon.Plus size={16} color={C.blue}/>New</button>
              </div>
              {courses.length===0?(
                <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
                                    <div style={{width:64,height:64,borderRadius:"50%",background:`${C.blue}15`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><Icon.Flag size={28} color={C.blue}/></div>
                  <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:6}}>No courses yet</div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:20,lineHeight:1.5}}>Choose Race or Mashup mode when building</div>
                  <button className="tap" onClick={()=>{setEditingCourse(null);setShowCourseBuilder(true);}} style={{background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:12,padding:"12px 24px",color:C.blue,fontSize:14,fontWeight:600}}>Build Your First Course</button>
                </div>
                ):courses.map(course=><CourseCard key={course.id} course={course} stages={stages} userId={user.id} onStart={c=>setActiveRace(c)} onEdit={c=>{setEditingCourse(c);setShowCourseBuilder(true);}} onDelete={async id=>{if(!window.confirm("Delete this course?"))return;await supabase.from('courses').delete().eq('id',id).eq('created_by',user.id);setCourses(prev=>prev.filter(c=>c.id!==id));}}/>)}
            </div>
          )}
        </div>
      )}

      {/* PROFILE */}
      {tab==="profile"&&(
        <div style={{height:"calc(100vh - 44px - 83px)",overflowY:"auto"}}>
            <ProfileScreen stages={stages} settings={settings} courseResults={courseResults} weeklyActivity={weeklyActivity} pastWeeks={weekStats} courseCRCount={courseCRCount} onSettingsPress={()=>setShowSettings(true)} onStatPress={key=>setSheet('stat-'+key)} onGoToStages={()=>{setCoursesFilter('stages');setTab('stages');}} onGoToCourses={()=>{setCoursesFilter('courses');setTab('stages');}}onOpenProgress={()=>setShowProgress(true)} onOpenBikeSetup={()=>setShowBikeSetup(true)}/>

        </div>
      )}


      {/* Stage detail (from stages tab) */}
      {selectedStage&&tab!=="map"&&sheet!=='sections'&&(
      <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSelectedStage(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageDetailSheet stage={selectedStage} units={settings.units} onClose={()=>setSelectedStage(null)} onRace={()=>{setActiveRace({id:Date.now(),name:selectedStage.name,stageIds:[selectedStage.id],mode:'race',times:{},bestPerStage:{}});setSelectedStage(null);}} onOpenSections={()=>setSheet('sections')} user={user} onRename={(id,newName)=>{setStages(prev=>prev.map(s=>s.id===id?{...s,name:newName}:s));setSelectedStage(prev=>prev&&prev.id===id?{...prev,name:newName}:prev);}}/></div></>
      )}    


      {/* Lobby */}
      {sheet==="lobby"&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"82vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><LobbySheet onClose={()=>setSheet(null)}/></div></>
      )}

          {showNewPost&&(<><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setShowNewPost(false)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 14px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><NewPostSheet todayInfo={todayStageTimes.length?{stages:new Set(todayStageTimes.map(t=>t.stage_id)).size,runs:todayStageTimes.length}:null} alreadyShared={daySharedToday} busy={recapBusy} onDayRecap={openDayRecap}/></div></>)}

          {recapDraft&&(<><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setRecapDraft(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 12px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><DayRecapPreviewSheet recap={recapDraft} name={settings.displayName||"My"} posting={recapPosting} onPost={postDayRecap} onDismiss={()=>setRecapDraft(null)}/></div></>)}

          {/* Share stage to feed */}
          {pendingShareStage&&(
            <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setPendingShareStage(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"82vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><ShareStageSheet stage={pendingShareStage} onDismiss={()=>setPendingShareStage(null)} onShare={()=>{logEvent(user.id,'stage_created',`created a new stage: ${pendingShareStage.name}`,pendingShareStage.id).then(()=>setRefreshTick(t=>t+1));setPendingShareStage(null);}}/></div></>
          )}

             
          {/* Sections */}
            {sheet==='sections'&&selectedStage&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"fixed",top:44,bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><SectionsSheet stage={selectedStage} user={user} onClose={()=>setSheet(null)}/></div></>
      )}

      {sheet&&sheet.startsWith('stat-')&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"82vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div>
          <div style={{padding:"0 16px 80px"}}>
            <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:16}}>{sheet==='stat-fastest'?'Fastest Stages':sheet==='stat-courses'?'Best Courses':sheet==='stat-completed'?'Stages Completed':'Course Records'}</div>
                       {sheet==='stat-fastest'&&stages.filter(s=>s.cr).map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
                <GoldCrown size={20}/>
                <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{s.name}</div>
                <div style={{fontSize:14,fontWeight:700,color:"#92400E"}}>{formatTime(s.time)}</div>
              </div>
            ))}
            {sheet==='stat-records'&&(courseCRList.length===0?<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>No course records yet</div>:courseCRList.map(c=>{
              const isOpen=expandedCRCourse===c.id;
              const trackNames=(c.stageIds||[]).map(id=>stages.find(s=>s.id===id)?.name).filter(Boolean);
              return(
                <div key={c.id} style={{marginBottom:8,border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
                  <button className="tap" onClick={()=>setExpandedCRCourse(isOpen?null:c.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:"#fff",border:"none",textAlign:"left"}}>
                    <GoldCrown size={20}/>
                    <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{c.name}</div>
                    <div style={{fontSize:14,fontWeight:700,color:"#92400E"}}>{formatTime(c.totalTime)}</div>
                    {isOpen?<Icon.ChevronUp size={14} color={C.mutedL}/>:<Icon.ChevronDown size={14} color={C.mutedL}/>}
                  </button>
                  {isOpen&&<div style={{padding:"8px 12px 12px",background:C.surface}}>
                    {trackNames.length===0?<div style={{fontSize:12,color:C.muted}}>No stages found</div>:trackNames.map((name,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0"}}>
                        <Icon.Lightning size={13} color={C.blue}/>
                        <div style={{fontSize:13,color:C.text}}>{i+1}. {name}</div>
                      </div>
                    ))}
                  </div>}
                </div>
              );
            }))}
            {sheet==='stat-completed'&&stages.filter(s=>s.time).map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
                <Icon.Lightning size={18} color={C.orange}/>
                <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{s.name}</div>
                <div style={{fontSize:14,fontWeight:700,color:C.orange}}>{formatTime(s.time)}</div>
              </div>
            ))}
            {sheet==='stat-courses'&&<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>Course history coming soon</div>}
          </div>
          </div></>
      )}


        {/* Tab bar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"white",borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-around",padding:"10px 0 24px",zIndex:50}}>
        {TABS.map(t=>{
          const active=tab===t.id;
          return(
            <button key={t.id} className="tap" onClick={()=>setTab(t.id)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",padding:"2px 10px"}}>
              <t.Ic size={22} color={active?C.blue:C.muted}/>
              <span style={{fontSize:10,fontWeight:active?600:400,color:active?C.blue:C.muted}}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
