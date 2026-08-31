import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createClient } from '@supabase/supabase-js';
const supabase=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY);

const DEFAULT_CENTER={lat:53.4919264,lng:-0.3294266};

const FAT_GATE_RADIUS=10;
const FINISH_GATE_RADIUS=20;

function haversine(a,b){const R=6371000,dLat=((b.lat-a.lat)*Math.PI)/180,dLng=((b.lng-a.lng)*Math.PI)/180,s=Math.sin(dLat/2)**2+Math.cos((a.lat*Math.PI)/180)*Math.cos((b.lat*Math.PI)/180)*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
function metersOffset(from,to){const latRad=from.lat*Math.PI/180;return{x:(to.lng-from.lng)*111320*Math.cos(latRad),y:(to.lat-from.lat)*110540};}
function segmentCrossesGate(prevPos,currPos,gate,radius){if(!prevPos)return false;const a=metersOffset(gate,prevPos);const b=metersOffset(gate,currPos);const dx=b.x-a.x,dy=b.y-a.y;const lenSq=dx*dx+dy*dy;let t=lenSq===0?0:-(a.x*dx+a.y*dy)/lenSq;t=Math.max(0,Math.min(1,t));const cx=a.x+t*dx,cy=a.y+t*dy;return Math.sqrt(cx*cx+cy*cy)<=radius;}
function formatTime(ms){if(!ms)return"—";const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000),cs=Math.floor((ms%1000)/10);return`${m}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;}
function formatDist(m){return m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`;}
function timeAgo(iso){const s=(Date.now()-new Date(iso).getTime())/1000;if(s<60)return'just now';if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;if(s<604800)return`${Math.floor(s/86400)}d ago`;return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'});}
function playBeep(freq=880,duration=150){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const osc=ctx.createOscillator();const gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=freq;osc.type='sine';gain.gain.setValueAtTime(0.3,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+duration/1000);osc.start();osc.stop(ctx.currentTime+duration/1000);}catch(e){console.log(e);}}
function logEvent(userId,type,message,stageId=null,context=null){if(!userId)return Promise.resolve();return supabase.from('app_events').insert({user_id:userId,event_type:type,message,stage_id:stageId?String(stageId):null,context}).then(()=>{}).catch(err=>console.log('logEvent failed:',err?.message||err));}
function getMonday(d){const date=new Date(d);const day=date.getDay();const diff=(day===0?-6:1-day);date.setDate(date.getDate()+diff);date.setHours(0,0,0,0);return date;}
function project(coord,center,zoom,w,h){const scale=Math.pow(2,zoom)*256,mercY=c=>Math.log(Math.tan(Math.PI/4+(c*Math.PI)/360)),cx=(center.lng+180)/360,cy=(1-mercY(center.lat)/Math.PI)/2;return{x:((coord.lng+180)/360-cx)*scale+w/2,y:((1-mercY(coord.lat)/Math.PI)/2-cy)*scale+h/2};}
function unproject(x,y,center,zoom,w,h){const scale=Math.pow(2,zoom)*256,mercY=c=>Math.log(Math.tan(Math.PI/4+(c*Math.PI)/360)),cx=(center.lng+180)/360,cy=(1-mercY(center.lat)/Math.PI)/2,lng=((x-w/2)/scale+cx)*360-180,lat=((Math.atan(Math.exp(((1-2*((y-h/2)/scale+cy))*Math.PI)))*2-Math.PI/2)*180)/Math.PI;return{lat,lng};}

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
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>Settings <span style={{fontSize:11,color:C.muted}}>(build 4)</span></div>
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
            {key:"weeklyDigest",label:"Weekly digest",sub:"Summary of your activity",last:true},
          ].map(({key,label,sub,last})=>(
            <Row key={key} label={label} sub={sub} noBorder={last} right={
              <Toggle value={s.notifications[key]} onChange={v=>update(`notifications.${key}`,v)}/>
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

        {/* Connected apps */}
        <Section title="Connected Apps">
          <Row label="Strava" sub={s.strava.connected?`Connected as ${s.strava.handle}`:"Sync activities automatically"} right={
            <button className="tap" onClick={()=>update("strava.connected",!s.strava.connected)} style={{background:s.strava.connected?`${C.orange}15`:"#1A1A1A",border:`1px solid ${s.strava.connected?C.orange:"#333"}`,borderRadius:8,padding:"6px 14px",color:s.strava.connected?C.orange:"white",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
              <Icon.Strava size={14} color={s.strava.connected?C.orange:"white"}/>{s.strava.connected?"Connected":"Connect"}
            </button>
          }/>
          {s.strava.connected&&(
            <div style={{padding:"0 16px 12px"}}>
              <input value={s.strava.handle} onChange={e=>update("strava.handle",e.target.value)} placeholder="@yourhandle" style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:13,color:C.text,background:C.surface}}/>
            </div>
          )}
          <Row label="Instagram" sub={s.instagram.connected?`Connected as ${s.instagram.handle}`:"Link your profile"} noBorder right={
            <button className="tap" onClick={()=>update("instagram.connected",!s.instagram.connected)} style={{background:s.instagram.connected?"#E1306C15":"#1A1A1A",border:`1px solid ${s.instagram.connected?"#E1306C":"#333"}`,borderRadius:8,padding:"6px 14px",color:s.instagram.connected?"#E1306C":"white",fontSize:12,fontWeight:600}}>
              {s.instagram.connected?"Connected":"Connect"}
            </button>
          }/>
          {s.instagram.connected&&(
            <div style={{padding:"0 16px 12px"}}>
              <input value={s.instagram.handle} onChange={e=>update("instagram.handle",e.target.value)} placeholder="@yourhandle" style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:13,color:C.text,background:C.surface}}/>
            </div>
          )}
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

function MapboxStyleMap({center,zoom,flyToTrigger,width:W,height:H,stages=[],courses=[],userPos,userHeading,onStagePress}){
  const mapContainer=useRef(null);
  const map=useRef(null);
  const markersRef=useRef([]);
  const userMarkerRef=useRef(null);
  const userMarkerInnerRef=useRef(null);

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

        stages.forEach(stage=>{

          
          const startEl=document.createElement('div');startEl.innerHTML='<div style="width:18px;height:18px;border-radius:50%;background:#F59E0B;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>';
          new mapboxgl.Marker({element:startEl}).setLngLat([stage.start.lng,stage.start.lat]).addTo(map.current);
          const finishEl=document.createElement('div');finishEl.innerHTML='<div style="width:18px;height:18px;border-radius:50%;background:white;border:2px solid #1A1A1A;box-shadow:0 2px 6px rgba(0,0,0,0.3);overflow:hidden"><svg width="14" height="14" viewBox="0 0 8 8"><rect width="2" height="2" fill="#1A1A1A"/><rect x="4" width="2" height="2" fill="#1A1A1A"/><rect x="2" y="2" width="2" height="2" fill="#1A1A1A"/><rect x="6" y="2" width="2" height="2" fill="#1A1A1A"/><rect y="4" width="2" height="2" fill="#1A1A1A"/><rect x="4" y="4" width="2" height="2" fill="#1A1A1A"/><rect x="2" y="6" width="2" height="2" fill="#1A1A1A"/><rect x="6" y="6" width="2" height="2" fill="#1A1A1A"/></svg></div>';
          new mapboxgl.Marker({element:finishEl}).setLngLat([stage.finish.lng,stage.finish.lat]).addTo(map.current);

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

          midpointFeatures.push({type:'Feature',properties:{stageId:String(stage.id),name:stage.name},geometry:{type:'Point',coordinates:[midLng,midLat]}});

          if(stage.line_coords&&stage.line_coords.length>1){

            const id='line-'+stage.id;
            map.current.addSource(id,{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:stage.line_coords.map(c=>[c.lng,c.lat])}}});
            map.current.addLayer({id,type:'line',source:id,paint:{'line-color':'#F59E0B','line-width':3,'line-opacity':0.9}});
          }
        });

              if(midpointFeatures.length>0){
          map.current.addSource('stage-midpoints',{type:'geojson',data:{type:'FeatureCollection',features:midpointFeatures}});
          map.current.addLayer({id:'stage-midpoints-icon',type:'symbol',source:'stage-midpoints',layout:{'icon-image':'stage-pin','icon-size':['interpolate',['linear'],['zoom'],10,0.35,14,0.55,18,0.85],'icon-anchor':'center','icon-allow-overlap':true,'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],10,9,14,12,18,15],'text-offset':[1.1,0],'text-anchor':'left','text-allow-overlap':true},paint:{'text-color':'#1A1A1A','text-halo-color':'#ffffff','text-halo-width':1.4}});
          map.current.on('click','stage-midpoints-icon',e=>{
            const stageId=e.features[0].properties.stageId;
            const stage=stages.find(s=>String(s.id)===stageId);
            if(stage&&onStagePress)onStagePress(stage);
          });
        }
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

// ── Stage Detail Sheet ────────────────────────────────────────────────────────
    function StageDetailSheet({stage,onClose,onRace,onOpenSections,user,onRename}){
  const [lb,setLb]=useState([]);
const [myAttempts,setMyAttempts]=useState([]);
const [editingName,setEditingName]=useState(false);
const [nameVal,setNameVal]=useState(stage.name);
const [savingName,setSavingName]=useState(false);
 
    useEffect(()=>{supabase.from('stage_times').select('time_ms,user_id,created_at,profiles(display_name,avatar_url)').eq('stage_id',stage.id).order('time_ms',{ascending:true}).then(({data})=>{if(data){const seen={};const best=data.filter(t=>{const id=t.user_id;if(seen[id])return false;seen[id]=true;return true;});setLb(best.slice(0,10).map((t,i)=>({pos:i+1,name:t.profiles?.display_name||'Rider',avatarUrl:t.profiles?.avatar_url||null,time:t.time_ms,date:new Date(t.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}),user_id:t.user_id})))}});},[stage.id]);

 useEffect(()=>{if(!user)return;supabase.from('stage_times').select('time_ms,created_at').eq('stage_id',stage.id).eq('user_id',user.id).order('created_at',{ascending:true}).then(({data})=>{if(data)setMyAttempts(data);});},[stage.id,user]);
const isCreator=!!(user&&stage.created_by&&stage.created_by===user.id);
const saveName=async()=>{const trimmed=nameVal.trim();if(!trimmed||trimmed===stage.name){setEditingName(false);setNameVal(stage.name);return;}setSavingName(true);const{error}=await supabase.from('stages').update({name:trimmed}).eq('id',stage.id);setSavingName(false);if(error){alert(error.message);return;}onRename&&onRename(stage.id,trimmed);setEditingName(false);};
const dist=haversine(stage.start,stage.finish);
const myEntry=lb.find(e=>user&&e.user_id===user.id);
  const myPos=myEntry?myEntry.pos:null;
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
<div style={{fontSize:12,color:C.muted,marginTop:4}}>{formatDist(dist)} · {stage.privacy}</div>
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
<div style={{fontSize:14,fontWeight:700,color:C.text}}>{lb.length}+</div>
<div style={{fontSize:10,color:C.muted,marginTop:2}}>Riders</div>
</div>
</div>
</div>

      {lb.length>0&&<div style={{margin:"16px 16px 0",background:"#FFFBEB",borderRadius:12,padding:"12px 14px",border:"1px solid #FDE68A",display:"flex",alignItems:"center",gap:10}}><Icon.Crown size={18} color="#92400E"/><div style={{flex:1}}><div style={{fontSize:11,color:"#92400E",fontWeight:600,marginBottom:1}}>STAGE RECORD</div><div style={{fontSize:13,fontWeight:700,color:"#92400E"}}>{lb[0].name} · {formatTime(lb[0].time)}</div></div><div style={{fontSize:11,color:"#B45309"}}>{lb[0].date}</div></div>}
      {stage.note&&<div style={{margin:"12px 16px 0",background:C.surface,borderRadius:10,padding:"11px 14px",border:`1px solid ${C.border}`}}><div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4}}>STAGE NOTES</div><div style={{fontSize:13,color:C.text,lineHeight:1.5}}>📋 {stage.note}</div></div>}
      {myAttempts.length>=2&&<div style={{margin:"16px 16px 0",background:"#fff",borderRadius:12,padding:"14px",border:`1px solid ${C.border}`}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
<div style={{fontSize:14,fontWeight:700,color:C.text}}>Your Progress</div>
<div style={{fontSize:11,color:C.muted}}>{myAttempts.length} attempts</div>
</div>
<ProgressChart attempts={myAttempts}/>
<div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
<div style={{fontSize:10,color:C.mutedL}}>First: {formatTime(myAttempts[0].time_ms)}</div>
<div style={{fontSize:10,color:C.mutedL}}>Latest: {formatTime(myAttempts[myAttempts.length-1].time_ms)}</div>
</div>
</div>}
<div style={{padding:"16px 16px 0"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
<div style={{fontSize:15,fontWeight:700,color:C.text}}>Leaderboard</div>
          <div style={{fontSize:11,color:C.muted,background:C.surface,borderRadius:6,padding:"3px 8px",border:`1px solid ${C.border}`}}>Free · Top 10</div>
        </div>
        {lb.length===0?<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>No times yet — be the first!</div>:lb.map((entry,i)=>{
          const isMe=!!(user&&entry.user_id===user.id),mc=medalColor(entry.pos);
          return(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 12px",background:isMe?C.orangeL:"white",borderRadius:10,marginBottom:6,border:`1px solid ${isMe?C.orange:C.border}`}}>
              <div style={{width:34}}><PositionBadge pos={entry.pos} size={30}/></div>
                            <Avatar size={32} url={entry.avatarUrl}/>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:isMe?700:500,color:C.text}}>{isMe?"You":entry.name}</div><div style={{fontSize:11,color:C.muted}}>{entry.date}</div></div>
              <div style={{fontSize:15,fontWeight:700,color:isMe?C.orange:C.text}}>{formatTime(entry.time)}</div>
            </div>
          );
        })}
        
                <button className="tap" onClick={onRace} style={{width:"100%",background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"12px 16px",color:C.blue,fontSize:14,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon.Flag size={16} color={C.blue}/>Race Stage</button>
        <button className="tap" onClick={onOpenSections} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 16px",color:C.text,fontSize:13,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon.Lightning size={15} color={C.muted}/>Sections</button>

        <div style={{background:"linear-gradient(135deg,#1A1A1A,#2A2A2A)",borderRadius:14,padding:"16px",marginTop:8,textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:700,color:"white",marginBottom:4}}>Unlock Full Leaderboard</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginBottom:12}}>See all riders, filter by date, export results</div>
          <button className="tap" style={{background:C.orange,border:"none",borderRadius:10,padding:"10px 24px",color:"white",fontSize:13,fontWeight:700}}>Upgrade to Pro</button>
        </div>
      </div>
    </div>
  );
}

// ── Activity Card ─────────────────────────────────────────────────────────────
  function FeedCard({item}){
const icons={stage_record:{Ic:Icon.Crown,color:"#92400E",bg:"#FFFBEB"},course_finish:{Ic:Icon.Flag,color:C.orange,bg:C.orangeL},stage_created:{Ic:Icon.Lightning,color:C.blue,bg:`${C.blue}15`},course_created:{Ic:Icon.Flag,color:C.blue,bg:`${C.blue}15`},day_recap:{Ic:Icon.BarChart,color:C.green,bg:`${C.green}15`}};
const cfg=icons[item.event_type]||{Ic:Icon.Lightning,color:C.muted,bg:C.surface};
return(
<div style={{display:"flex",alignItems:"flex-start",gap:12,padding:"14px 16px",borderBottom:`1px solid ${C.border}`}}>
<Avatar size={38} url={item.avatarUrl}/>
<div style={{flex:1}}>
<div style={{fontSize:13,color:C.text,lineHeight:1.4}}><span style={{fontWeight:700}}>{item.userName}</span> {item.message}</div>
<div style={{fontSize:11,color:C.muted,marginTop:2}}>{item.ago}</div>
</div>
<div style={{width:30,height:30,borderRadius:8,background:cfg.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><cfg.Ic size={15} color={cfg.color}/></div>
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
await supabase.from('profiles').update({bike_name:s.bikeName,rider_weight:s.riderWeight,tire_dry_front:s.tireDryFront,tire_dry_rear:s.tireDryRear,tire_wet_front:s.tireWetFront,tire_wet_rear:s.tireWetRear,shock_mode:s.shockMode,shock_psi:s.shockPsi,shock_spring_rate:s.shockSpringRate,shock_lsc:s.shockLsc,shock_hsc:s.shockHsc,shock_lsr:s.shockLsr,shock_hsr:s.shockHsr,shock_hsb:s.shockHsb,shock_tokens:s.shockTokens,shock_sag:s.shockSag,fork_mode:s.forkMode,fork_psi:s.forkPsi,fork_spring_rate:s.forkSpringRate,fork_lsc:s.forkLsc,fork_hsc:s.forkHsc,fork_lsr:s.forkLsr,fork_hsr:s.forkHsr,fork_hsb:s.forkHsb,fork_tokens:s.forkTokens,fork_sag:s.forkSag,bike_notes:s.bikeNotes,fork_notes:s.forkNotes,shock_notes:s.shockNotes}).eq('id',user.id);
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
function StatisticsScreen({stages,courses,user,onBack}){
  const [view,setView]=useState('hub');
  const titles={hub:"Statistics",stages:"Stages",courses:"Courses"};
  return(
    <div style={{width:"100%",height:"100vh",display:"flex",flexDirection:"column",background:"#fff"}}>
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button className="tap" onClick={()=>view==='hub'?onBack():setView('hub')} style={{background:"none",border:"none",color:C.blue,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>{titles[view]}</div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {view==='hub'&&(
          <div style={{padding:"16px"}}>
            {[{key:'stages',label:'Stages',Ic:Icon.Lightning},{key:'courses',label:'Courses',Ic:Icon.Flag}].map((item,i,arr)=>(
              <button key={item.key} className="tap" onClick={()=>setView(item.key)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"14px 0",background:"none",border:"none",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none",textAlign:"left"}}>
                <item.Ic size={18} color={C.muted}/>
                <div style={{flex:1,fontSize:15,fontWeight:600,color:C.text}}>{item.label}</div>
                <Icon.ChevronRight size={16} color={C.mutedL}/>
              </button>
            ))}
          </div>
        )}
        {view==='stages'&&<ProgressSheet stages={stages} user={user}/>}
        {view==='courses'&&<CourseProgressSheet courses={courses} user={user}/>}
      </div>
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────
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

      <div style={{padding:"16px 16px 28px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <button className="tap" onClick={()=>onStatPress&&onStatPress('fastest')} style={{background:"#fff",border:`1px solid ${C.blue}`,borderRadius:10,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <div style={{fontSize:17,fontWeight:700,color:C.text}}>{crCount}</div>
          <div style={{fontSize:12,color:C.muted}}>CR</div>
        </button>
               <button className="tap" onClick={()=>onStatPress&&onStatPress('records')} style={{background:"#fff",border:`1px solid ${C.blue}`,borderRadius:10,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <div style={{fontSize:17,fontWeight:700,color:C.text}}>{courseCRCount}</div>
          <div style={{fontSize:12,color:C.muted}}>Course CR</div>
        </button>
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
        <button className="tap" onClick={()=>supabase.auth.signOut()} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 0",background:"none",color:C.red,fontSize:14,fontWeight:500,border:"none"}}>Sign Out<Icon.ChevronRight/></button>
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
 function StageBuilderSheet({onClose,onSave}){
  const [name,setName]=useState("");
  const [privacy,setPrivacy]=useState("private");
  const [start,setStart]=useState(null);
  const [finish,setFinish]=useState(null);
  const [note,setNote]=useState("");
  const [recording,setRecording]=useState(false);
  const [lineCoords,setLineCoords]=useState([]);
  const trackRef=useRef(null);
  const simulatePlace=()=>{if(!navigator.geolocation){alert("GPS not available");return;}navigator.geolocation.getCurrentPosition(pos=>{const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};if(!start){setStart(loc);setLineCoords([loc]);setRecording(true);trackRef.current=navigator.geolocation.watchPosition(p=>setLineCoords(prev=>[...prev,{lat:p.coords.latitude,lng:p.coords.longitude}]),err=>console.log(err),{enableHighAccuracy:true,maximumAge:0});}else if(!finish){setFinish(loc);setRecording(false);navigator.geolocation.clearWatch(trackRef.current);const fullLine=[...lineCoords,loc];let total=0;for(let i=0;i<fullLine.length-1;i++)total+=haversine(fullLine[i],fullLine[i+1]);if(total>25){const offsetStart=pointAtDistance(fullLine,25);if(offsetStart)setStart(offsetStart);}setLineCoords(fullLine);}},err=>alert("Could not get location — make sure GPS is on"),{enableHighAccuracy:true,timeout:10000});};

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
      <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Notes — hazards, line choice…" rows={2} style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"12px 14px",fontSize:13,color:C.text,background:C.surface,marginBottom:20}}/>
       <button className="tap" onClick={()=>canSave&&onSave({id:Date.now(),name:name.trim(),start,finish,privacy,note,time:null,cr:false,crHolder:null,crDate:null,lineCoords})}
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
function CourseBuilderSheet({stages,course,onClose,onSave}){
  const [name,setName]=useState(course?.name||"");
  const [privacy,setPrivacy]=useState(course?.privacy||"group");
  const [selectedIds,setSelectedIds]=useState(course?.stageIds||[]);
  const [mode,setMode]=useState(course?.mode||"race");
  const toggle=id=>setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const moveUp=i=>{if(i===0)return;setSelectedIds(prev=>{const a=[...prev];[a[i-1],a[i]]=[a[i],a[i-1]];return a;});};
  const moveDown=i=>setSelectedIds(prev=>{if(i===prev.length-1)return prev;const a=[...prev];[a[i],a[i+1]]=[a[i+1],a[i]];return a;});
  const totalDist=selectedIds.reduce((acc,id)=>{const s=stages.find(x=>x.id===id);return s?acc+haversine(s.start,s.finish):acc;},0);
  const canSave=name.trim()&&selectedIds.length>=2;

  return(
    <div style={{padding:"0 16px 40px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <div><div style={{fontSize:17,fontWeight:700,color:C.text}}>{course?"Edit Course":"Build Course"}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{course?"Rename, add or remove stages":"String stages into a race"}</div></div>
        <button className="tap" onClick={onClose} style={{background:C.surface,borderRadius:8,padding:"6px 14px",color:C.text,fontSize:13,fontWeight:500,border:`1px solid ${C.border}`}}>Cancel</button>
      </div>

      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Course name e.g. Sunday Enduro" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,color:C.text,background:C.surface,marginBottom:20}}/>

      {/* Mode selector — the key new feature */}
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

      <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Select Stages ({selectedIds.length} selected)</div>
      {stages.map(stage=>{
        const on=selectedIds.includes(stage.id),pos=selectedIds.indexOf(stage.id);
        return(
          <button key={stage.id} className="tap" onClick={()=>toggle(stage.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,background:on?`${C.blue}0D`:C.surface,border:`1px solid ${on?C.blue:C.border}`,borderRadius:12,padding:"12px 14px",marginBottom:8,textAlign:"left",transition:"all 0.15s"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:on?C.blue:"#E0E0E0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:on?"white":"#999",flexShrink:0}}>{on?pos+1:"·"}</div>
            <div style={{flex:1}}><div style={{fontSize:14,fontWeight:500,color:on?C.text:C.muted}}>{stage.name}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>{formatDist(haversine(stage.start,stage.finish))} · {stage.privacy}</div></div>
            {on&&<Icon.Check size={18} color={C.blue}/>}
          </button>
        );
      })}

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
            const stage=stages.find(s=>s.id===id);if(!stage)return null;
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

        <button className="tap" onClick={()=>canSave&&onSave({id:course?.id||Date.now(),name:name.trim(),stageIds:selectedIds,privacy,mode,times:{},bestPerStage:{}})} style={{width:"100%",background:canSave?"#fff":C.surface,border:`1.5px solid ${canSave?C.blue:C.border}`,borderRadius:12,padding:15,color:canSave?C.blue:C.muted,fontSize:15,fontWeight:700,transition:"all 0.2s"}}>
        {canSave?(course?"Save Changes":`Create ${mode==="mashup"?"Mashup":"Race"} Course`):"Select at least 2 stages"}
      </button>
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
  const [introDist,setIntroDist]=useState(null);

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
const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};
const dist=haversine(loc,gate);
setDistToGate(Math.round(dist));
const crossed=segmentCrossesGate(prevGpsRef.current,loc,gate,FAT_GATE_RADIUS);
prevGpsRef.current=loc;
if(crossed){navigator.geolocation.clearWatch(id);setGateStatus("entered");setTimeout(()=>startCountdown(),300);}
else if(dist<=50)setGateStatus("near");
else setGateStatus("waiting");
},err=>{console.log(err);logEvent(user?.id,"gps_error_transfer",err.message||String(err),currentStage?.id,{code:err.code});},{enableHighAccuracy:true,maximumAge:0,timeout:10000});
return()=>navigator.geolocation.clearWatch(id);
},[phase,stageIndex,armed]);

const startCountdown=()=>{playBeep(880,150);setGateStatus("waiting");setTimerMs(0);timerMsRef.current=0;startTimeRef.current=Date.now();setPhase("racing");timerRef.current=setInterval(()=>{timerMsRef.current=Date.now()-startTimeRef.current;setTimerMs(timerMsRef.current);},10);setTimeout(()=>{if(timerRef.current){clearInterval(timerRef.current);setPhase("transfer");setTimerMs(0);logEvent(user?.id,"finish_timeout","Finish gate not reached within 10 minutes",currentStage?.id);alert("Run cancelled — finish gate not reached in time");}},600000);};    

    const stopStage=(saveTime=false)=>{
playBeep(440,250);
clearInterval(timerRef.current);
const finalTime=timerMsRef.current;
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
if(saveTime&&!isPractice){supabase.from('stage_times').select('time_ms').eq('stage_id',currentStage.id).order('time_ms',{ascending:true}).limit(1).then(({data})=>{const prevBest=data&&data[0]?data[0].time_ms:null;supabase.from('stage_times').insert({stage_id:currentStage.id,user_id:user.id,time_ms:finalTime}).then(()=>{if(prevBest===null||finalTime<prevBest){logEvent(user.id,'stage_record',`set a new record on ${currentStage.name} · ${formatTime(finalTime)}`,currentStage.id,{time_ms:finalTime}).then(()=>onActivity&&onActivity());}}).catch(err=>console.log(err));});}
};

            useEffect(()=>{
    if(phase!=="racing")return;
    if(!navigator.geolocation)return;
    const gate=currentStage.finish;
    prevGpsRef.current=null;
    const id=navigator.geolocation.watchPosition(pos=>{
      const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};
      const crossed=segmentCrossesGate(prevGpsRef.current,loc,gate,FINISH_GATE_RADIUS);
      prevGpsRef.current=loc;
      if(crossed){
navigator.geolocation.clearWatch(id);
stopStage(true);
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
  
          <button className="tap" onClick={quitRace} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.muted,fontSize:14}}>
            Back
          </button>
        </div>
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
          <button className="tap" onClick={quitRace} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 14px",color:"rgba(255,255,255,0.7)",fontSize:13,border:"none"}}>Quit</button>
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
{currentStage.note&&<div style={{background:C.surface,borderRadius:12,padding:"12px 16px",border:`1px solid ${C.border}`,fontSize:13,color:C.muted,maxWidth:280}}>📋 {currentStage.note}</div>}
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

export default function App(){
  const [tab,setTab]=useState("home");
  const [mapCenter,setMapCenter]=useState(DEFAULT_CENTER);
  const [flyToTrigger,setFlyToTrigger]=useState(null);
  const [zoom,setZoom]=useState(13);
  const [stages,setStages]=useState(SAMPLE_STAGES);
  const [courses,setCourses]=useState([]);   const [sheet,setSheet]=useState(null);
  const [editingCourse,setEditingCourse]=useState(null);
  const [stagesFilter,setStagesFilter]=useState("all");
  const [coursesFilter,setCoursesFilter]=useState("stages");
  const [activeRace,setActiveRace]=useState(null);
  const [selectedStage,setSelectedStage]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  const [showProgress,setShowProgress]=useState(false);
  const [showBikeSetup,setShowBikeSetup]=useState(false);
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [user,setUser]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  const [refreshTick,setRefreshTick]=useState(0);
  useEffect(()=>{
  const onVisible=()=>{if(document.visibilityState==="visible")setRefreshTick(t=>t+1);};
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('pageshow',onVisible);
  return()=>{document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('pageshow',onVisible);};
  },[]);

  useEffect(()=>{if(!user)return;supabase.from('profiles').select('display_name,avatar_url').eq('id',user.id).single().then(({data})=>{if(data)setSettings(prev=>({...prev,displayName:data.display_name||prev.displayName,avatarUrl:data.avatar_url||null}));});},[user,refreshTick]);
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
useEffect(()=>{if(!user)return;supabase.from('stages').select('*').or(`privacy.eq.public,created_by.eq.${user.id}`).then(async({data})=>{if(!data)return;const{data:times}=await supabase.from('stage_times').select('stage_id,time_ms').eq('user_id',user.id);const bests={};if(times)times.forEach(t=>{if(!bests[t.stage_id]||t.time_ms<bests[t.stage_id])bests[t.stage_id]=t.time_ms;});setStages(data.map(s=>({id:s.id,name:s.name,note:s.note||'',privacy:s.privacy,created_by:s.created_by,start:{lat:s.start_lat,lng:s.start_lng},finish:{lat:s.finish_lat,lng:s.finish_lng},line_coords:s.line_coords||null,time:bests[s.id]||null,cr:false})));});},[user,refreshTick]);


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
  },[stageIdsKey,user]);
  
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
useEffect(()=>{if(!user)return;supabase.from('app_events').select('id,event_type,message,created_at,profiles(display_name,avatar_url)').in('event_type',['stage_record','course_finish','stage_created','course_created','day_recap']).order('created_at',{ascending:false}).limit(50).then(({data})=>{if(data)setFeed(data.map(e=>({id:e.id,event_type:e.event_type,message:e.message,userName:e.profiles?.display_name||'Rider',avatarUrl:e.profiles?.avatar_url||null,ago:timeAgo(e.created_at)})));});},[user,refreshTick]);
const [todayStageTimes,setTodayStageTimes]=useState([]);
const [daySharedToday,setDaySharedToday]=useState(false);
useEffect(()=>{if(!user)return;const startOfDay=new Date();startOfDay.setHours(0,0,0,0);supabase.from('stage_times').select('time_ms,stage_id').eq('user_id',user.id).gte('created_at',startOfDay.toISOString()).then(({data})=>{if(data)setTodayStageTimes(data);});supabase.from('app_events').select('id').eq('user_id',user.id).eq('event_type','day_recap').gte('created_at',startOfDay.toISOString()).then(({data})=>{setDaySharedToday(!!(data&&data.length));});},[user,refreshTick]);
const shareDayRecap=()=>{const stageIds=[...new Set(todayStageTimes.map(t=>t.stage_id))];const totalMs=todayStageTimes.reduce((a,t)=>a+t.time_ms,0);if(!window.confirm(`Share today's ride?\n${stageIds.length} stage${stageIds.length>1?'s':''} · ${todayStageTimes.length} run${todayStageTimes.length>1?'s':''} · ${formatTime(totalMs)} total`))return;logEvent(user.id,'day_recap',`rode ${stageIds.length} stage${stageIds.length>1?'s':''} today · ${formatTime(totalMs)}`,null,{stage_count:stageIds.length,run_count:todayStageTimes.length,total_time_ms:totalMs}).then(()=>setRefreshTick(t=>t+1));};
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

  const dragRef=useRef(null),pinchRef=useRef(null);
  const onTouchStart=useCallback(e=>{if(e.touches.length===2){return;}else{dragRef.current={x:e.touches[0].clientX,y:e.touches[0].clientY,center:{...mapCenter}};pinchRef.current=null;}},[mapCenter,zoom]);
  const onTouchMove=useCallback(e=>{e.preventDefault();if(e.touches.length===1&&dragRef.current){const dx=e.touches[0].clientX-dragRef.current.x,dy=e.touches[0].clientY-dragRef.current.y,scale=Math.pow(2,zoom)*256,mercY=Math.log(Math.tan(Math.PI/4+(dragRef.current.center.lat*Math.PI)/360)),newMercY=mercY+(dy/scale)*Math.PI*2;setMapCenter({lng:dragRef.current.center.lng-(dx/scale)*360,lat:((Math.atan(Math.exp(newMercY))*2-Math.PI/2)*180)/Math.PI});}},[zoom]);
  const onTouchEnd=()=>{dragRef.current=null;pinchRef.current=null;};
  const mouseRef=useRef(null);
  const onMouseDown=e=>{mouseRef.current={x:e.clientX,y:e.clientY,center:{...mapCenter}};};
  const onMouseMove=e=>{if(!mouseRef.current)return;const dx=e.clientX-mouseRef.current.x,dy=e.clientY-mouseRef.current.y,scale=Math.pow(2,zoom)*256,mercY=Math.log(Math.tan(Math.PI/4+(mouseRef.current.center.lat*Math.PI)/360)),newMercY=mercY+(dy/scale)*Math.PI*2;setMapCenter({lng:mouseRef.current.center.lng-(dx/scale)*360,lat:((Math.atan(Math.exp(newMercY))*2-Math.PI/2)*180)/Math.PI});};
  const onMouseUp=()=>{mouseRef.current=null;};
  const onWheel=e=>{e.preventDefault();setZoom(z=>Math.max(8,Math.min(18,z-e.deltaY*0.003)));};    const [proximityFilter,setProximityFilter]=useState("nearby");
  const filteredStages=stages.filter(s=>stagesFilter==="all"||s.privacy===stagesFilter).filter(s=>proximityFilter==="explore"||haversine(userPos,s.start)<=32187);
  const [mapSearchQuery,setMapSearchQuery]=useState("");
  const mapSearchResults=mapSearchQuery.trim()?stages.filter(s=>s.name.toLowerCase().includes(mapSearchQuery.trim().toLowerCase())).slice(0,6):[];

    const TABS=[{id:"home",label:"Home",Ic:Icon.Home},{id:"map",label:"Map",Ic:Icon.Map},{id:"stages",label:"Stages",Ic:Icon.Lightning},{id:"profile",label:"Profile",Ic:Icon.User}];
  if(!user)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden"}}>
      <style>{STYLES}</style>
      <AuthScreen/>
    </div>
  );

    // Settings screen overlay
  if(showSettings)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif"}}>
      <style>{STYLES}</style>
      <div style={{height:44,background:"#fff"}}/>
      <SettingsScreen settings={settings} onSave={setSettings} 
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

  // Statistics screen overlay
  if(showProgress)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif",background:"#fff"}}>
      <style>{STYLES}</style>
      <StatisticsScreen stages={stages} courses={courses} user={user} onBack={()=>setShowProgress(false)}/>
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
      <div style={{height:44,background:tab==="map"?"transparent":"#fff",position:"relative",zIndex:10}}/>

      {/* HOME */}
      {tab==="home"&&(
        <div style={{height:"calc(100vh - 44px - 83px)",overflowY:"auto"}}>
          <div style={{padding:"12px 16px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:"#fff",zIndex:5}}>
            <div style={{fontSize:22,fontWeight:800,color:C.text}}>Feed</div>
            <div style={{display:"flex",gap:8}}>
              <button className="tap" onClick={()=>setSheet("lobby")} style={{display:"flex",alignItems:"center",gap:6,background:C.orangeL,border:`1px solid ${C.orange}22`,borderRadius:9,padding:"8px 13px",color:C.orange,fontSize:13,fontWeight:600}}><Icon.Users size={15} color={C.orange}/>Session</button>
              <button className="tap" style={{width:36,height:36,borderRadius:9,background:C.surface,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.Bell size={18} color={C.muted}/></button>
            </div>
          </div>
          {todayStageTimes.length>0&&!daySharedToday&&<button className="tap" onClick={shareDayRecap} style={{width:"calc(100% - 32px)",margin:"14px 16px 0",background:C.surface,border:`1px dashed ${C.border}`,borderRadius:10,padding:"12px 14px",color:C.text,fontSize:13,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon.BarChart size={15} color={C.green}/>Share today's ride · {new Set(todayStageTimes.map(t=>t.stage_id)).size} stages</button>}
          {feed.length===0?<div style={{textAlign:"center",padding:"48px 20px",color:C.muted,fontSize:13}}>No activity yet — set a record, finish a course, or add a stage to get things started.</div>:feed.map(item=><FeedCard key={item.id} item={item}/>)}
        </div>
      )}

      {/* MAP */}
      {tab==="map"&&(
        <div style={{position:"absolute",inset:0}}>
          <div style={{position:"absolute",inset:0,cursor:"grab",touchAction:"none"}} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
              <MapboxStyleMap center={mapCenter} zoom={zoom} flyToTrigger={flyToTrigger} width={mapSize.w} height={mapSize.h} stages={stages} courses={courses} userPos={userPos} userHeading={userHeading} onStagePress={s=>setSelectedStage(s)}/>
          </div>
                    <div style={{position:"absolute",top:52,left:16,right:16,zIndex:10}}>
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
          </div>

          <div style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",display:"flex",flexDirection:"column",gap:6,zIndex:10}}>
            {[{l:"+",a:()=>setZoom(z=>Math.min(18,z+1))},{l:"−",a:()=>setZoom(z=>Math.max(8,z-1))},{l:"⌖",a:()=>{setMapCenter(userPos);setFlyToTrigger(Date.now());}}].map(({l,a})=>(
              <button key={l} className="tap" onClick={a} style={{width:36,height:36,borderRadius:9,background:"white",border:`1px solid ${C.border}`,fontSize:l==="⌖"?14:18,display:"flex",alignItems:"center",justifyContent:"center",color:C.text,boxShadow:"0 2px 6px rgba(0,0,0,0.08)"}}>{l}</button>
            ))}
          </div>
                    {selectedStage&&sheet!=='sections'&&(
            <><div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.3)",zIndex:39}} onClick={()=>setSelectedStage(null)}/><div className="slide-up" style={{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:40,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageDetailSheet stage={selectedStage} onClose={()=>setSelectedStage(null)}onRace={()=>{setActiveRace({id:Date.now(),name:selectedStage.name,stageIds:[selectedStage.id],mode:'race',times:{},bestPerStage:{}});setSelectedStage(null);}}
onOpenSections={()=>setSheet('sections')}
user={user}
onRename={(id,newName)=>{setStages(prev=>prev.map(s=>s.id===id?{...s,name:newName}:s));setSelectedStage(prev=>prev&&prev.id===id?{...prev,name:newName}:prev);}}/></div></>
)}
{sheet==="stageBuilder"&&(
           <><div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.25)",zIndex:39}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:40,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageBuilderSheet onClose={()=>setSheet(null)} onSave={async s=>{const{data,error}=await supabase.from('stages').insert({name:s.name,note:s.note,privacy:s.privacy,start_lat:s.start.lat,start_lng:s.start.lng,finish_lat:s.finish.lat,finish_lng:s.finish.lng,created_by:user.id,line_coords:s.lineCoords||null}).select().single();if(error){alert(error.message);}else{setStages(prev=>[...prev,{...s,id:data.id,created_by:user.id,line_coords:s.lineCoords||null}]);logEvent(user.id,'stage_created',`created a new stage: ${s.name.trim()}`,data.id).then(()=>setRefreshTick(t=>t+1));}setSheet(null);}}/></div></>
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
            {coursesFilter==="stages"&&<div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:2}}>
              {[{v:"all",l:"All"},{v:"public",l:"Public"},{v:"group",l:"Group"},{v:"private",l:"Private"}].map(f=>(
                <button key={f.v} className="tap" onClick={()=>setStagesFilter(f.v)} style={{padding:"6px 14px",borderRadius:20,whiteSpace:"nowrap",background:stagesFilter===f.v?"white":C.surface,border:`1px solid ${stagesFilter===f.v?C.blue:C.border}`,color:stagesFilter===f.v?C.blue:C.text,fontSize:13,fontWeight:stagesFilter===f.v?600:400}}>{f.l}</button>
              ))}
            </div>}
          </div>
                {coursesFilter==="stages"&&(filteredStages.length===0?<div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}><Icon.Lightning size={36} color={C.mutedL}/><div style={{fontSize:15,fontWeight:500,marginBottom:4,marginTop:12}}>{proximityFilter==="nearby"?"No stages nearby":"No stages"}</div>{proximityFilter==="nearby"&&<div style={{fontSize:13,color:C.mutedL,marginBottom:16}}>Try Explore to see stages further afield</div>}</div>:filteredStages.map(s=><SegmentRow key={s.id} stage={s} userId={user.id} onPress={s=>{setSelectedStage(s);setMapCenter({lat:s.start.lat,lng:s.start.lng});setZoom(15);setTab("map");}} onDelete={async id=>{if(!window.confirm("Delete this stage?"))return;await supabase.from('stages').delete().eq('id',id).eq('created_by',user.id);setStages(prev=>prev.filter(s=>s.id!==id));}}/>))}


          {coursesFilter==="courses"&&(
            <div style={{padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div style={{fontSize:22,fontWeight:800,color:C.text}}>Courses</div>
                 <button className="tap" onClick={()=>{setEditingCourse(null);setSheet("courseBuilder");}} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:10,padding:"9px 14px",color:C.blue,fontSize:13,fontWeight:600}}><Icon.Plus size={16} color={C.blue}/>New</button>
              </div>
              {courses.length===0?(
                <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
                                    <div style={{width:64,height:64,borderRadius:"50%",background:`${C.blue}15`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><Icon.Flag size={28} color={C.blue}/></div>
                  <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:6}}>No courses yet</div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:20,lineHeight:1.5}}>Choose Race or Mashup mode when building</div>
                  <button className="tap" onClick={()=>{setEditingCourse(null);setSheet("courseBuilder");}} style={{background:"#fff",border:`1.5px solid ${C.blue}`,borderRadius:12,padding:"12px 24px",color:C.blue,fontSize:14,fontWeight:600}}>Build Your First Course</button>
                </div>
              ):courses.map(course=><CourseCard key={course.id} course={course} stages={stages} userId={user.id} onStart={c=>setActiveRace(c)} onEdit={c=>{setEditingCourse(c);setSheet("courseBuilder");}} onDelete={async id=>{if(!window.confirm("Delete this course?"))return;await supabase.from('courses').delete().eq('id',id).eq('created_by',user.id);setCourses(prev=>prev.filter(c=>c.id!==id));}}/>)}
            </div>
          )}
        </div>
      )}

      {/* PROFILE */}
      {tab==="profile"&&(
        <div style={{height:"calc(100vh - 44px - 83px)",overflowY:"auto"}}>
            <ProfileView stages={stages} settings={settings} courseResults={courseResults} weeklyActivity={weeklyActivity} pastWeeks={pastWeeks} courseCRCount={courseCRCount} onSettingsPress={()=>setShowSettings(true)} onStatPress={key=>setSheet('stat-'+key)} onGoToStages={()=>{setCoursesFilter('stages');setTab('stages');}} onGoToCourses={()=>{setCoursesFilter('courses');setTab('stages');}}onOpenProgress={()=>setShowProgress(true)} onOpenBikeSetup={()=>setShowBikeSetup(true)}/>

        </div>
      )}


      {/* Stage detail (from stages tab) */}
      {selectedStage&&tab!=="map"&&sheet!=='sections'&&(
      <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSelectedStage(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageDetailSheet stage={selectedStage} onClose={()=>setSelectedStage(null)} onRace={()=>{setActiveRace({id:Date.now(),name:selectedStage.name,stageIds:[selectedStage.id],mode:'race',times:{},bestPerStage:{}});setSelectedStage(null);}} onOpenSections={()=>setSheet('sections')} user={user} onRename={(id,newName)=>{setStages(prev=>prev.map(s=>s.id===id?{...s,name:newName}:s));setSelectedStage(prev=>prev&&prev.id===id?{...prev,name:newName}:prev);}}/></div></>
      )}

       {/* Course builder */}
       {sheet==="courseBuilder"&&(
       <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>{setSheet(null);setEditingCourse(null);}}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"90vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><CourseBuilderSheet stages={stages} course={editingCourse} onClose={()=>{setSheet(null);setEditingCourse(null);}} onSave={async c=>{if(c.id&&courses.some(x=>x.id===c.id)){const{error}=await supabase.from('courses').update({name:c.name,privacy:c.privacy,mode:c.mode,stage_ids:c.stageIds}).eq('id',c.id);if(error){alert(error.message);}else{setCourses(prev=>prev.map(x=>x.id===c.id?{...x,name:c.name,privacy:c.privacy,mode:c.mode,stageIds:c.stageIds}:x));}setSheet(null);setEditingCourse(null);}else{const{data,error}=await supabase.from('courses').insert({name:c.name,privacy:c.privacy,mode:c.mode,stage_ids:c.stageIds,created_by:user.id}).select().single();if(!error){setCourses(prev=>[...prev,{...c,id:data.id,created_by:user.id}]);logEvent(user.id,'course_created',`created a new course: ${c.name}`).then(()=>setRefreshTick(t=>t+1));}setSheet(null);setCoursesFilter("courses");setTab("stages");}}}/></div></>
       )}


      {/* Lobby */}
      {sheet==="lobby"&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"82vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><LobbySheet onClose={()=>setSheet(null)}/></div></>
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
                <Icon.Crown size={18} color="#92400E"/>
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
                    <Icon.Crown size={18} color="#92400E"/>
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
