import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from '@supabase/supabase-js';
const supabase=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY);

const DEFAULT_CENTER={lat:53.4919264,lng:-0.3294266};

const FAT_GATE_RADIUS=10;

function haversine(a,b){const R=6371000,dLat=((b.lat-a.lat)*Math.PI)/180,dLng=((b.lng-a.lng)*Math.PI)/180,s=Math.sin(dLat/2)**2+Math.cos((a.lat*Math.PI)/180)*Math.cos((b.lat*Math.PI)/180)*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
function formatTime(ms){if(!ms)return"—";const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000),cs=Math.floor((ms%1000)/10);return`${m}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;}
function formatDist(m){return m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`;}
function project(coord,center,zoom,w,h){const scale=Math.pow(2,zoom)*256,mercY=c=>Math.log(Math.tan(Math.PI/4+(c*Math.PI)/360)),cx=(center.lng+180)/360,cy=(1-mercY(center.lat)/Math.PI)/2;return{x:((coord.lng+180)/360-cx)*scale+w/2,y:((1-mercY(coord.lat)/Math.PI)/2-cy)*scale+h/2};}
function unproject(x,y,center,zoom,w,h){const scale=Math.pow(2,zoom)*256,mercY=c=>Math.log(Math.tan(Math.PI/4+(c*Math.PI)/360)),cx=(center.lng+180)/360,cy=(1-mercY(center.lat)/Math.PI)/2,lng=((x-w/2)/scale+cx)*360-180,lat=((Math.atan(Math.exp(((1-2*((y-h/2)/scale+cy))*Math.PI)))*2-Math.PI/2)*180)/Math.PI;return{lat,lng};}

const C={orange:"#F59E0B",orangeL:"#FFF8E7",bg:"#FFFFFF",surface:"#F5F5F5",border:"#E6E6E6",text:"#1A1A1A",muted:"#8A8A8A",mutedL:"#C4C4C4",blue:"#2563EB",green:"#15803D",red:"#DC2626",yellow:"#B45309",mapBase:"#EAE6DF",mapWater:"#A8D3E8",mapWaterDark:"#8BBDD4",mapPark:"#D4E8D0",mapParkDark:"#BDDBB7",mapBuilding:"#D9D5CC",mapBuildingBorder:"#C8C4BB",mapHighwayBorder:"#C0B89A",mapHighway:"#F5D490",mapMajorRoad:"#FFFFFF",mapMajorBorder:"#C8C0A4",mapMinorRoad:"#FFFFFF",mapMinorBorder:"#D4CDB8",mapLabel:"#5A5A5A"};


// ── Course modes ──────────────────────────────────────────────────────────────
const COURSE_MODES=[
  {id:"practice",label:"Practice",icon:"🎯",desc:"One untimed run to learn the stages. Times not saved."},
  {id:"race",label:"Race",icon:"🏁",desc:"One timed run. Times go to the leaderboard."},
  {id:"mashup",label:"Mashup",icon:"⚡",desc:"Unlimited runs. Best time on each stage combined into your total."},
];

const SAMPLE_STAGES=[];

const LEADERBOARD_DATA={};
const SAMPLE_COURSES_DONE=[];
const SAMPLE_FEED=[];



// Default settings
const DEFAULT_SETTINGS={
  displayName:"Your Name",
  units:"metric",
  gpsAccuracy:"high",
  notifications:{newLeaderboard:true,sessionInvite:true,courseRecord:true,weeklyDigest:false},
  privacy:{defaultStagePrivacy:"private",showOnLeaderboard:true,shareActivity:true},
  strava:{connected:false,handle:""},
  instagram:{connected:false,handle:""},
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
  Strava:({size=20,color="#FC4C02"})=><svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>,
  Close:({size=18,color="#1A1A1A"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
};

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
    <div onClick={()=>onChange(!value)} style={{width:46,height:26,borderRadius:13,background:value?C.orange:"#DDD",position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:value?22:3,width:20,height:20,borderRadius:"50%",background:"white",boxShadow:"0 1px 4px rgba(0,0,0,0.2)",transition:"left 0.2s"}}/>
    </div>
  );
}

// ── Settings Screen ───────────────────────────────────────────────────────────
function SettingsScreen({settings,onSave,onBack}){
  const [s,setS]=useState(settings);
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

  return(
    <div style={{height:"calc(100vh - 44px)",overflowY:"auto",background:C.surface}}>
      {/* Header */}
      <div style={{padding:"16px 16px 12px",background:"white",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:5,display:"flex",alignItems:"center",gap:12}}>
        <button className="tap" onClick={()=>{onSave(s);onBack();}} style={{background:"none",border:"none",color:C.orange,fontSize:14,fontWeight:600}}>← Back</button>
        <div style={{fontSize:17,fontWeight:700,color:C.text,flex:1}}>Settings</div>
        <button className="tap" onClick={()=>{onSave(s);onBack();}} style={{background:C.orange,border:"none",borderRadius:8,padding:"6px 14px",color:"white",fontSize:13,fontWeight:600}}>Save</button>
      </div>

      <div style={{padding:"20px 16px"}}>

        {/* Profile */}
        <Section title="Profile">
          <Row label="Display Name" sub="Shown on leaderboards and in sessions" right={
            <input value={s.displayName} onChange={e=>update("displayName",e.target.value)}
              style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px",fontSize:14,color:C.text,width:140,textAlign:"right",background:C.surface}}/>
          }/>
          <Row label="Profile Photo" sub="Tap to change" noBorder right={
            <div style={{width:40,height:40,borderRadius:"50%",background:C.orange,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.User size={20} color="white"/></div>
          }/>
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

function MapboxStyleMap({center,zoom,flyToTrigger,width:W,height:H,stages=[],courses=[],userPos,onStagePress}){
  const mapContainer=useRef(null);
  const map=useRef(null);
  const markersRef=useRef([]);

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
        // Add stages as lines
        stages.forEach(stage=>{
          
          const startEl=document.createElement('div');startEl.innerHTML='<div style="width:18px;height:18px;border-radius:50%;background:#F59E0B;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>';
          new mapboxgl.Marker({element:startEl}).setLngLat([stage.start.lng,stage.start.lat]).addTo(map.current);
          const finishEl=document.createElement('div');finishEl.innerHTML='<div style="width:18px;height:18px;border-radius:50%;background:white;border:2px solid #1A1A1A;box-shadow:0 2px 6px rgba(0,0,0,0.3);overflow:hidden"><svg width="14" height="14" viewBox="0 0 8 8"><rect width="2" height="2" fill="#1A1A1A"/><rect x="4" width="2" height="2" fill="#1A1A1A"/><rect x="2" y="2" width="2" height="2" fill="#1A1A1A"/><rect x="6" y="2" width="2" height="2" fill="#1A1A1A"/><rect y="4" width="2" height="2" fill="#1A1A1A"/><rect x="4" y="4" width="2" height="2" fill="#1A1A1A"/><rect x="2" y="6" width="2" height="2" fill="#1A1A1A"/><rect x="6" y="6" width="2" height="2" fill="#1A1A1A"/></svg></div>';
          new mapboxgl.Marker({element:finishEl}).setLngLat([stage.finish.lng,stage.finish.lat]).addTo(map.current);


          if(stage.line_coords&&stage.line_coords.length>1){
            const id='line-'+stage.id;
            map.current.addSource(id,{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:stage.line_coords.map(c=>[c.lng,c.lat])}}});
            map.current.addLayer({id,type:'line',source:id,paint:{'line-color':'#F59E0B','line-width':3,'line-opacity':0.9}});
          }
        });

        // User dot
        if(userPos){
          new mapboxgl.Marker({color:'#2563EB'}).setLngLat([userPos.lng,userPos.lat]).addTo(map.current);
        }
      });
    });
  },[]);
  

  useEffect(()=>{if(map.current&&flyToTrigger)map.current.flyTo({center:[center.lng,center.lat],zoom:zoom,essential:true});},[flyToTrigger]);


  return(
    <div style={{position:"absolute",inset:0}}>
      <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet"/>
      <div ref={mapContainer} style={{width:"100%",height:"100%"}}/>
    </div>
  );
}



// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({initials,size=40,bg=C.orange,color="#fff",fontSize=13}){
  return <div style={{width:size,height:size,borderRadius:"50%",background:bg,display:"flex",alignItems:"center",justifyContent:"center",color,fontSize,fontWeight:700,flexShrink:0}}>{initials}</div>;
}

// ── Stage Detail Sheet ────────────────────────────────────────────────────────
  function StageDetailSheet({stage,onClose,onRace}){
  const [lb,setLb]=useState([]);
  useEffect(()=>{supabase.from('stage_times').select('time_ms,user_id,profiles(display_name)').eq('stage_id',stage.id).order('time_ms',{ascending:true}).limit(10).then(({data})=>{if(data)setLb(data.map((t,i)=>({pos:i+1,name:t.profiles?.display_name||'Unknown',time:t.time_ms})))});},[stage.id]);


  const dist=haversine(stage.start,stage.finish);
  const myEntry=lb.find(e=>e.avatar==="ME");
  const myPos=myEntry?myEntry.pos:null;
  const medalColor=pos=>pos===1?"#FFD700":pos===2?"#C0C0C0":pos===3?"#CD7F32":null;
  return(
    <div style={{padding:"0 0 40px"}}>
      <div style={{background:"linear-gradient(135deg,#1A1A1A,#2A2A2A)",padding:"20px 20px 20px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
         <div style={{fontSize:20,fontWeight:800,color:C.text}}>{settings.displayName}</div><div style={{fontSize:12,color:"rgba(255,255,255,0.6)"}}>{formatDist(dist)} · {stage.privacy}</div></div>
          <button className="tap" onClick={onClose} style={{background:"rgba(255,255,255,0.15)",borderRadius:8,padding:"6px 12px",color:"white",fontSize:13,border:"none"}}>Close</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          {[{l:"Your Best",v:stage.time?formatTime(stage.time):"—",hi:true},{l:"Position",v:myPos?`${myPos===1?"🥇":myPos===2?"🥈":myPos===3?"🥉":""}${myPos}${myPos===1?"st":myPos===2?"nd":myPos===3?"rd":"th"}`:"—",hi:!!myPos},{l:"Riders",v:`${lb.length}+`}].map(({l,v,hi})=>(
            <div key={l} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
              <div style={{fontSize:14,fontWeight:700,color:hi?"#FC4C02":"white"}}>{v}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",marginTop:2}}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      {stage.crHolder&&<div style={{margin:"16px 16px 0",background:"#FFFBEB",borderRadius:12,padding:"12px 14px",border:"1px solid #FDE68A",display:"flex",alignItems:"center",gap:10}}><Icon.Crown size={18} color="#92400E"/><div style={{flex:1}}><div style={{fontSize:11,color:"#92400E",fontWeight:600,marginBottom:1}}>COURSE RECORD</div><div style={{fontSize:13,fontWeight:700,color:"#92400E"}}>{stage.crHolder} · {lb[0]?formatTime(lb[0].time):"—"}</div></div><div style={{fontSize:11,color:"#B45309"}}>{stage.crDate}</div></div>}
      {stage.note&&<div style={{margin:"12px 16px 0",background:C.surface,borderRadius:10,padding:"11px 14px",border:`1px solid ${C.border}`}}><div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4}}>STAGE NOTES</div><div style={{fontSize:13,color:C.text,lineHeight:1.5}}>📋 {stage.note}</div></div>}
      <div style={{padding:"16px 16px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:15,fontWeight:700,color:C.text}}>Leaderboard</div>
          <div style={{fontSize:11,color:C.muted,background:C.surface,borderRadius:6,padding:"3px 8px",border:`1px solid ${C.border}`}}>Free · Top 10</div>
        </div>
        {lb.length===0?<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:13}}>No times yet — be the first!</div>:lb.map((entry,i)=>{
          const isMe=entry.avatar==="ME",mc=medalColor(entry.pos);
          return(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 12px",background:isMe?C.orangeL:"white",borderRadius:10,marginBottom:6,border:`1px solid ${isMe?C.orange:C.border}`}}>
              <div style={{width:28,textAlign:"center"}}>{mc?<div style={{width:24,height:24,borderRadius:"50%",background:mc,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"white",margin:"0 auto"}}>{entry.pos}</div>:<div style={{fontSize:13,fontWeight:600,color:C.muted}}>{entry.pos}</div>}</div>
              <Avatar initials={entry.avatar} size={32} bg={isMe?C.orange:["#2563EB","#15803D","#7C3AED","#B45309"][i%4]} fontSize={11}/>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:isMe?700:500,color:C.text}}>{isMe?"You":entry.name}</div><div style={{fontSize:11,color:C.muted}}>{entry.date}</div></div>
              <div style={{fontSize:15,fontWeight:700,color:isMe?C.orange:C.text}}>{formatTime(entry.time)}</div>
            </div>
          );
        })}
        
        <button className="tap" onClick={onRace} style={{width:"100%",background:C.orange,border:"none",borderRadius:10,padding:"12px 16px",color:"white",fontSize:14,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icon.Flag size={16} color="white"/>Race Stage</button>
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

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfileView({stages,settings,onSettingsPress,onStatPress}){
  const timed=stages.filter(s=>s.time);
  const bars=[28,0,52,34,0,89,65],days=["M","T","W","T","F","S","S"];
  const medalColor=pos=>pos===1?"#FFD700":pos===2?"#C0C0C0":pos===3?"#CD7F32":null;
  const medalLabel=pos=>pos===1?"🥇 1st":pos===2?"🥈 2nd":pos===3?"🥉 3rd":`${pos}th`;
  const modeColor=mode=>mode==="mashup"?C.blue:mode==="practice"?C.green:C.orange;
  const modeLabel=mode=>mode==="mashup"?"⚡ Mashup":mode==="practice"?"🎯 Practice":"🏁 Race";
  return(
    <div>
      <div style={{background:"#0F172A",padding:"24px 20px 20px"}}>

        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18}}>
          <div style={{width:60,height:60,borderRadius:"50%",background:"rgba(255,255,255,0.25)",border:"2px solid rgba(255,255,255,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.User size={28} color="#fff"/></div>
          <div style={{flex:1}}><div style={{fontSize:20,fontWeight:800,color:"#fff"}}>{settings.displayName}</div><div style={{fontSize:13,color:"rgba(255,255,255,0.75)",marginTop:2}}>Member since 2024</div></div>
          <button className="tap" onClick={onSettingsPress} style={{width:36,height:36,borderRadius:9,background:"rgba(255,255,255,0.2)",border:"none",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon.Settings size={18} color="white"/></button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[{l:"Fastest Stages",v:stages.filter(s=>s.cr).length,key:"fastest"},{l:"Best Courses",v:"—",key:"courses"},{l:"Stages Completed",v:stages.filter(s=>s.time).length,key:"completed"},{l:"Course Records",v:stages.filter(s=>s.cr).length,key:"records"}].map(({l,v,
          ))}<button key={key} className="tap" onClick={()=>onStatPress&&onStatPress(key)} style={{background:"#fff",border:`1px solid ${C.blue}`,borderRadius:10,padding:"12px 8px",textAlign:"center"}}><div style={{fontSize:18,fontWeight:700,color:C.text}}>{v}</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>{l}</div></button>

        </div>
      </div>

      <div style={{padding:"18px 16px 0"}}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:12}}>Activity This Week</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:5,height:56,marginBottom:6}}>
          {bars.map((h,i)=><div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}><div style={{width:"100%",height:`${h||3}%`,background:h>0?C.orange:"#F0F0F0",borderRadius:3,minHeight:3}}/><div style={{fontSize:9,color:C.muted,fontWeight:500}}>{days[i]}</div></div>)}
        </div>
      </div>

      {/* Courses with medals */}
      <div style={{padding:"16px 16px 0"}}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:12}}>Courses Ridden</div>
        {SAMPLE_COURSES_DONE.map(course=>{
          const mc=medalColor(course.pos),top3=course.pos<=3;
          return(
            <div key={course.id} style={{background:top3?`${mc}15`:"white",border:`1px solid ${top3?mc:C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:44,height:44,borderRadius:12,background:top3?mc:"#F0F0F0",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {top3?<span style={{fontSize:22}}>{course.pos===1?"🥇":course.pos===2?"🥈":"🥉"}</span>:<span style={{fontSize:16,fontWeight:700,color:C.muted}}>{course.pos}th</span>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{course.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{fontSize:11,color:C.muted}}>{course.date} · {course.stages} stages</div>
                  <div style={{fontSize:10,fontWeight:600,color:modeColor(course.mode),background:`${modeColor(course.mode)}15`,borderRadius:4,padding:"1px 5px"}}>{modeLabel(course.mode)}</div>
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:700,color:top3?C.orange:C.text}}>{formatTime(course.totalTime)}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:1}}>{medalLabel(course.pos)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stage records */}
      <div style={{padding:"16px"}}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:12}}>Stage Records</div>
        {timed.map(s=>(
          <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
            <div style={{width:36,height:36,borderRadius:8,background:s.cr?"#FEF3C7":`${C.blue}12`,display:"flex",alignItems:"center",justifyContent:"center"}}>{s.cr?<Icon.Crown size={16} color="#92400E"/>:<Icon.Lightning size={16} color={C.blue}/>}</div>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{s.name}</div><div style={{fontSize:11,color:C.muted}}>{formatDist(haversine(s.start,s.finish))}</div></div>
            <div style={{fontSize:15,fontWeight:700,color:s.cr?"#92400E":C.text}}>{formatTime(s.time)}</div>
          </div>
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
function StageBuilderSheet({onClose,onSave}){
  const [name,setName]=useState("");
  const [privacy,setPrivacy]=useState("private");
  const [start,setStart]=useState(null);
  const [finish,setFinish]=useState(null);
  const [note,setNote]=useState("");
  const [recording,setRecording]=useState(false);
  const [lineCoords,setLineCoords]=useState([]);
  const trackRef=useRef(null);
  const simulatePlace=()=>{if(!navigator.geolocation){alert("GPS not available");return;}navigator.geolocation.getCurrentPosition(pos=>{const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};if(!start){setStart(loc);setLineCoords([loc]);setRecording(true);trackRef.current=navigator.geolocation.watchPosition(p=>setLineCoords(prev=>[...prev,{lat:p.coords.latitude,lng:p.coords.longitude}]),err=>console.log(err),{enableHighAccuracy:true,maximumAge:0});}else if(!finish){setFinish(loc);setRecording(false);navigator.geolocation.clearWatch(trackRef.current);}},err=>alert("Could not get location — make sure GPS is on"),{enableHighAccuracy:true,timeout:10000});};


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
function CourseBuilderSheet({stages,onClose,onSave}){
  const [name,setName]=useState("");
  const [privacy,setPrivacy]=useState("group");
  const [selectedIds,setSelectedIds]=useState([]);
  const [mode,setMode]=useState("race");
  const toggle=id=>setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const moveUp=i=>{if(i===0)return;setSelectedIds(prev=>{const a=[...prev];[a[i-1],a[i]]=[a[i],a[i-1]];return a;});};
  const moveDown=i=>setSelectedIds(prev=>{if(i===prev.length-1)return prev;const a=[...prev];[a[i],a[i+1]]=[a[i+1],a[i]];return a;});
  const totalDist=selectedIds.reduce((acc,id)=>{const s=stages.find(x=>x.id===id);return s?acc+haversine(s.start,s.finish):acc;},0);
  const canSave=name.trim()&&selectedIds.length>=2;

  return(
    <div style={{padding:"0 16px 40px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0 18px"}}>
        <div><div style={{fontSize:17,fontWeight:700,color:C.text}}>Build Course</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>String stages into a race</div></div>
        <button className="tap" onClick={onClose} style={{background:C.surface,borderRadius:8,padding:"6px 14px",color:C.text,fontSize:13,fontWeight:500,border:`1px solid ${C.border}`}}>Cancel</button>
      </div>

      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Course name e.g. Sunday Enduro" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,color:C.text,background:C.surface,marginBottom:20}}/>

      {/* Mode selector — the key new feature */}
      <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Course Mode</div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
        {COURSE_MODES.map(m=>(
          <button key={m.id} className="tap" onClick={()=>setMode(m.id)} style={{display:"flex",alignItems:"flex-start",gap:12,background:mode===m.id?m.id==="mashup"?`${C.blue}10`:m.id==="practice"?`${C.green}10`:C.orangeL:C.surface,border:`1.5px solid ${mode===m.id?m.id==="mashup"?C.blue:m.id==="practice"?C.green:C.orange:C.border}`,borderRadius:14,padding:"14px 16px",textAlign:"left",transition:"all 0.15s"}}>
            <div style={{fontSize:24,flexShrink:0}}>{m.icon}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:mode===m.id?m.id==="mashup"?C.blue:m.id==="practice"?C.green:C.orange:C.text,marginBottom:2}}>{m.label}</div>
              <div style={{fontSize:12,color:C.muted,lineHeight:1.4}}>{m.desc}</div>
            </div>
            {mode===m.id&&<Icon.Check size={18} color={m.id==="mashup"?C.blue:m.id==="practice"?C.green:C.orange}/>}
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

      {selectedIds.length>=2&&(
        <div style={{marginTop:4,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>Stage Order</div>
          {selectedIds.map((id,i)=>{
            const stage=stages.find(s=>s.id===id);if(!stage)return null;
            return(
              <div key={id} style={{display:"flex",alignItems:"center",gap:10,background:"white",border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",marginBottom:6}}>
                <div style={{width:24,height:24,borderRadius:"50%",background:C.orange,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"white",flexShrink:0}}>{i+1}</div>
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
          <button key={p.val} className="tap" onClick={()=>setPrivacy(p.val)} style={{background:privacy===p.val?C.orangeL:C.surface,border:`1.5px solid ${privacy===p.val?C.orange:C.border}`,borderRadius:10,padding:"11px 8px",textAlign:"center",fontSize:13,fontWeight:privacy===p.val?600:400,color:privacy===p.val?C.orange:C.text,transition:"all 0.15s"}}>{p.label}</button>
        ))}
      </div>

      <button className="tap" onClick={()=>canSave&&onSave({id:Date.now(),name:name.trim(),stageIds:selectedIds,privacy,mode,times:{},bestPerStage:{}})} style={{width:"100%",background:canSave?C.orange:C.surface,border:"none",borderRadius:12,padding:15,color:canSave?"#fff":C.muted,fontSize:15,fontWeight:700,transition:"all 0.2s"}}>
        {canSave?`Create ${mode==="mashup"?"Mashup":mode==="practice"?"Practice":"Race"} Course`:"Select at least 2 stages"}
      </button>
    </div>
  );
}

// ── Race / Practice / Mashup Screen ──────────────────────────────────────────
function RaceScreen({course,stages,user,onFinish}){

  const courseStages=course.stageIds.map(id=>stages.find(s=>s.id===id)).filter(Boolean);
  const isPractice=course.mode==="practice";
  const isMashup=course.mode==="mashup";

  const [stageIndex,setStageIndex]=useState(0);
  const [phase,setPhase]=useState("modeIntro"); // modeIntro | transfer | countdown | racing | split | done
  const [countdown,setCountdown]=useState(3);
  const [timerMs,setTimerMs]=useState(0);
  const timerMsRef=useRef(0);
  const [splits,setSplits]=useState([]); // current run splits
  const [bestPerStage,setBestPerStage]=useState({}); // mashup: best time per stage id
  const [runCount,setRunCount]=useState(0); // how many full runs completed
  const [gateStatus,setGateStatus]=useState("waiting");
  const [distToGate,setDistToGate]=useState(null);

  const timerRef=useRef(null);
  const countRef=useRef(null);
  const gpsRef=useRef(null);

  const currentStage=courseStages[stageIndex];
  const totalStages=courseStages.length;
  const isLastStage=stageIndex===totalStages-1;

  // Simulate GPS toward gate
  useEffect(()=>{
    if(phase!=="transfer")return;
    if(!navigator.geolocation)return;
    const gate=currentStage.start;
    const id=navigator.geolocation.watchPosition(pos=>{
      const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};
      const dist=haversine(loc,gate);
      setDistToGate(Math.round(dist));
      if(dist<=FAT_GATE_RADIUS){navigator.geolocation.clearWatch(id);setGateStatus("entered");setTimeout(()=>startCountdown(),300);}
      else if(dist<=50)setGateStatus("near");
      else setGateStatus("waiting");
    },err=>console.log(err),{enableHighAccuracy:true,maximumAge:0,timeout:10000});
    return()=>navigator.geolocation.clearWatch(id);
  },[phase,stageIndex]);

  const startCountdown=()=>{
    setGateStatus("waiting");setPhase("countdown");setCountdown(3);let c=3;
    countRef.current=setInterval(()=>{c--;setCountdown(c);if(c<=0){clearInterval(countRef.current);setTimerMs(0);timerMsRef.current=0;setPhase("racing");timerRef.current=setInterval(()=>{timerMsRef.current+=10;setTimerMs(timerMsRef.current);},10);

    setTimeout(()=>{
      if(timerRef.current){
        clearInterval(timerRef.current);
        setPhase("transfer");
        setTimerMs(0);
        alert("Run cancelled — finish gate not reached in time");
      }
    },600000);
    }},1000);
  };


   
    const stopStage=async()=>{
    clearInterval(timerRef.current);
    const finalTime=timerMsRef.current;
    const{data:existing}=await supabase.from('stage_times').select('id,time_ms').eq('stage_id',currentStage.id).eq('user_id',user.id).order('time_ms',{ascending:true}).limit(1).single();if(!existing||finalTime<existing.time_ms){if(existing){await supabase.from('stage_times').update({time_ms:finalTime}).eq('id',existing.id);}else{await supabase.from('stage_times').insert({stage_id:currentStage.id,user_id:user.id,time_ms:finalTime});}}


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
  };

   useEffect(()=>{
    if(phase!=="racing")return;
    if(!navigator.geolocation)return;
    const gate=currentStage.finish;
    const id=navigator.geolocation.watchPosition(pos=>{
      const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};
      const dist=haversine(loc,gate);
      if(dist<=FAT_GATE_RADIUS){
        navigator.geolocation.clearWatch(id);
        stopStage();
      }
    },err=>console.log(err),{enableHighAccuracy:true,maximumAge:0,timeout:10000});
    return()=>navigator.geolocation.clearWatch(id);
  },[phase,stageIndex]);

  const nextStage=()=>{
    if(isLastStage){
      setRunCount(r=>r+1);
      if(isPractice){setPhase("done");}
      else if(isMashup){setPhase("mashupBetween");}
      else{setPhase("done");}
    } else {
      setStageIndex(i=>i+1);setPhase("transfer");
    }
  };

  const startAnotherRun=()=>{
    setStageIndex(0);setSplits([]);setPhase("transfer");
  };

  useEffect(()=>()=>{clearInterval(timerRef.current);clearInterval(countRef.current);clearInterval(gpsRef.current);},[]);

  const mashupTotal=Object.values(bestPerStage).reduce((a,b)=>a+b,0);

  // ── Mode intro screen ──
  if(phase==="modeIntro"){
    const modeInfo={
      practice:{color:C.green,icon:"🎯",title:"Practice Run",sub:"This run won't be saved. Ride it to learn the stages, then go again for real.",btn:"Start Practice",btnColor:C.green},
      race:{color:C.orange,icon:"🏁",title:"Race Mode",sub:"One timed run. Your times will go to the leaderboard. Make it count.",btn:"Start Race",btnColor:C.orange},
      mashup:{color:C.blue,icon:"⚡",title:"Mashup Mode",sub:"Unlimited runs. Your best time on each stage gets combined into one total. Keep going until you're happy.",btn:"Start Mashup",btnColor:C.blue},
    }[course.mode];
    return(
      <div style={{position:"fixed",inset:0,background:"#fff",zIndex:100,display:"flex",flexDirection:"column"}}>
        <div style={{background:modeInfo.color,padding:"52px 20px 32px",textAlign:"center",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          <div style={{fontSize:72,marginBottom:16}}>{modeInfo.icon}</div>
          <div style={{fontSize:28,fontWeight:800,color:"white",marginBottom:8}}>{course.name}</div>
          <div style={{fontSize:18,fontWeight:600,color:"rgba(255,255,255,0.9)",marginBottom:12}}>{modeInfo.title}</div>
          <div style={{fontSize:14,color:"rgba(255,255,255,0.75)",lineHeight:1.6,maxWidth:280,textAlign:"center",marginBottom:24}}>{modeInfo.sub}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
            {courseStages.map((s,i)=>(
              <div key={s.id} style={{background:"rgba(255,255,255,0.2)",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,color:"white"}}>
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
          <button className="tap" onClick={()=>{setPhase("transfer");}} style={{width:"100%",background:modeInfo.btnColor,border:"none",borderRadius:14,padding:18,color:"#fff",fontSize:16,fontWeight:700,boxShadow:`0 4px 20px ${modeInfo.btnColor}44`}}>
            {modeInfo.btn} →
          </button>
          <button className="tap" onClick={onFinish} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.muted,fontSize:14}}>
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
          <button className="tap" onClick={onFinish} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 14px",color:"rgba(255,255,255,0.7)",fontSize:13,border:"none"}}>Quit</button>
        </div>
        <div style={{padding:"16px 20px",background:headerBg,display:"flex",gap:6}}>
          {courseStages.map((_,i)=><div key={i} style={{flex:1,height:4,borderRadius:2,background:i<stageIndex?C.orange:i===stageIndex?"white":"rgba(255,255,255,0.2)"}}/>)}
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",textAlign:"center"}}>
          <div style={{width:100,height:100,borderRadius:"50%",background:`${gateColors[gateStatus]}20`,border:`3px solid ${gateColors[gateStatus]}`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20,transition:"all 0.3s"}}>
            <Icon.Location size={40} color={gateColors[gateStatus]}/>
          </div>
          <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:8}}>{stageIndex===0?`Head to Stage 1`:`Transfer to Stage ${stageIndex+1}`}</div>
          <div style={{fontSize:24,fontWeight:800,color:gateColors[gateStatus],marginBottom:8,transition:"all 0.3s"}}>{gateMsg[gateStatus]}</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:16}}>{isPractice?"Timer won't start — just ride it for feel":"Timer starts automatically when you enter the gate"}</div>
          {currentStage.note&&<div style={{background:C.surface,borderRadius:12,padding:"12px 16px",border:`1px solid ${C.border}`,fontSize:13,color:C.muted,maxWidth:280}}>📋 {currentStage.note}</div>}
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
          <button className="tap" onClick={stopStage} style={{width:"100%",background:isPractice?"rgba(255,255,255,0.2)":C.red,border:isPractice?"1px solid rgba(255,255,255,0.3)":"none",borderRadius:14,padding:18,color:"#fff",fontSize:16,fontWeight:700,boxShadow:isPractice?"none":"0 4px 20px rgba(220,38,38,0.4)"}}>
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
          <button className="tap" onClick={onFinish} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:14,color:C.muted,fontSize:14,fontWeight:500}}>Quit</button>
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
          <button className="tap" onClick={onFinish} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:14,color:C.text,fontSize:14,fontWeight:600}}>Back</button>
          {isPractice
            ?<button className="tap" onClick={onFinish} style={{flex:2,background:C.green,border:"none",borderRadius:12,padding:14,color:"#fff",fontSize:14,fontWeight:700}}>Ready to Race!</button>
            :<button className="tap" onClick={onFinish} style={{flex:2,background:isMashup?C.blue:C.orange,border:"none",borderRadius:12,padding:14,color:"#fff",fontSize:14,fontWeight:700}}>Save Results</button>
          }
        </div>
      </div>
    );
  }
  return null;
}

// ── Course Card ───────────────────────────────────────────────────────────────
function CourseCard({course,stages,onStart}){
  const courseStages=course.stageIds.map(id=>stages.find(s=>s.id===id)).filter(Boolean);
  const totalDist=courseStages.reduce((a,s)=>a+haversine(s.start,s.finish),0);
  const modeInfo={practice:{color:C.green,icon:"🎯",label:"Practice"},race:{color:C.orange,icon:"🏁",label:"Race"},mashup:{color:C.blue,icon:"⚡",label:"Mashup"}}[course.mode||"race"];
  return(
    <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:16,padding:"16px",marginBottom:12,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:4}}>{course.name}</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{fontSize:12,color:C.muted}}>{course.stageIds.length} stages · {formatDist(totalDist)}</div>
            <div style={{fontSize:11,fontWeight:600,color:modeInfo.color,background:`${modeInfo.color}15`,borderRadius:6,padding:"2px 7px"}}>{modeInfo.icon} {modeInfo.label}</div>
          </div>
        </div>
        <div style={{width:40,height:40,borderRadius:10,background:`${modeInfo.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{modeInfo.icon}</div>
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
      <button className="tap" onClick={()=>onStart(course)} style={{width:"100%",background:modeInfo.color,border:"none",borderRadius:10,padding:"12px 16px",color:"white",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <Icon.Flag size={16} color="white"/>{modeInfo.icon} Start {modeInfo.label}
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
      <div style={{background:C.orange,padding:"60px 24px 32px",textAlign:"center"}}>
        <div style={{fontSize:36,fontWeight:800,color:"white",letterSpacing:-1,marginBottom:4}}>GATE</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.8)"}}>Enduro timing for every trail</div>
      </div>
      <div style={{flex:1,padding:"32px 24px",overflowY:"auto"}}>
        <div style={{display:"flex",background:C.surface,borderRadius:10,padding:3,marginBottom:24}}>
          {["login","signup"].map(m=><button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"9px",borderRadius:8,background:mode===m?"#fff":"none",border:"none",color:mode===m?C.text:C.muted,fontSize:14,fontWeight:mode===m?600:400}}>{m==="login"?"Log In":"Sign Up"}</button>)}
        </div>
        {mode==="signup"&&<input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,marginBottom:12,background:C.surface}}/>}
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" type="email" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,marginBottom:12,background:C.surface}}/>
        <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" type="password" style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"13px 14px",fontSize:15,marginBottom:20,background:C.surface}}/>
        {error&&<div style={{fontSize:13,color:error.includes("Check")?C.green:C.red,marginBottom:16,textAlign:"center"}}>{error}</div>}
        <button className="tap" onClick={submit} style={{width:"100%",background:loading?C.surface:C.orange,border:"none",borderRadius:12,padding:16,color:loading?C.muted:"#fff",fontSize:15,fontWeight:700}}>
          {loading?"...":(mode==="login"?"Log In":"Create Account")}
        </button>
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
  const [courses,setCourses]=useState([]);
  const [recording,setRecording]=useState(false);
  const [timerMs,setTimerMs]=useState(0);
  const [timerRunning,setTimerRunning]=useState(false);
  const [sheet,setSheet]=useState(null);
  const [stagesFilter,setStagesFilter]=useState("all");
  const [coursesFilter,setCoursesFilter]=useState("stages");
  const [activeRace,setActiveRace]=useState(null);
  const [selectedStage,setSelectedStage]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [user,setUser]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  useEffect(()=>{if(!user)return;supabase.from('profiles').select('display_name').eq('id',user.id).single().then(({data})=>{if(data?.display_name)setSettings(prev=>({...prev,displayName:data.display_name}));});},[user]);

  const timerRef=useRef(null);
  const containerRef=useRef(null);
  const wakeLockRef=useRef(null);
  const [mapSize,setMapSize]=useState({w:390,h:844});
  const [userPos,setUserPos]=useState(DEFAULT_CENTER);

  useEffect(()=>{if(!navigator.geolocation)return;let centered=false;const id=navigator.geolocation.watchPosition(pos=>{const loc={lat:pos.coords.latitude,lng:pos.coords.longitude};setUserPos(loc);if(!centered){setMapCenter(loc);centered=true;}},err=>console.log(err),{enableHighAccuracy:true,maximumAge:2000,timeout:10000});return()=>navigator.geolocation.clearWatch(id);},[]);

useEffect(()=>{
  if(activeRace&&'wakeLock'in navigator){
    navigator.wakeLock.request('screen').then(lock=>{wakeLockRef.current=lock;}).catch(err=>console.log(err));
  }
  return()=>{if(wakeLockRef.current){wakeLockRef.current.release();wakeLockRef.current=null;}};
},[activeRace]);



  
  useEffect(()=>{const el=containerRef.current;if(!el)return;const ro=new ResizeObserver(e=>setMapSize({w:e[0].contentRect.width,h:e[0].contentRect.height}));ro.observe(el);setMapSize({w:el.clientWidth,h:el.clientHeight});return()=>ro.disconnect();},[]);
  useEffect(()=>{if(timerRunning){timerRef.current=setInterval(()=>setTimerMs(t=>t+10),10);}else clearInterval(timerRef.current);return()=>clearInterval(timerRef.current);},[timerRunning]);
  useEffect(()=>{
  supabase.auth.getSession().then(({data:{session}})=>setUser(session?.user??null));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setUser(session?.user??null));
  return()=>subscription.unsubscribe();
},[]);
useEffect(()=>{if(!user)return;supabase.from('stages').select('*').or(`privacy.eq.public,created_by.eq.${user.id}`).then(async({data})=>{if(!data)return;const{data:times}=await supabase.from('stage_times').select('stage_id,time_ms').eq('user_id',user.id);const bests={};if(times)times.forEach(t=>{if(!bests[t.stage_id]||t.time_ms<bests[t.stage_id])bests[t.stage_id]=t.time_ms;});setStages(data.map(s=>({id:s.id,name:s.name,note:s.note||'',privacy:s.privacy,created_by:s.created_by,start:{lat:s.start_lat,lng:s.start_lng},finish:{lat:s.finish_lat,lng:s.finish_lng},line_coords:s.line_coords||null,time:bests[s.id]||null,cr:false})));});},[user]);


    

  useEffect(()=>{if(!user)return;supabase.from('courses').select('*').then(({data})=>{if(data)setCourses(data.map(c=>({id:c.id,name:c.name,privacy:c.privacy,mode:c.mode,stageIds:c.stage_ids,times:{},bestPerStage:{}})));});},[user]);
  

  const dragRef=useRef(null),pinchRef=useRef(null);
  const onTouchStart=useCallback(e=>{if(e.touches.length===2){const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;pinchRef.current={dist:Math.sqrt(dx*dx+dy*dy),zoom};dragRef.current=null;}else{dragRef.current={x:e.touches[0].clientX,y:e.touches[0].clientY,center:{...mapCenter}};pinchRef.current=null;}},[mapCenter,zoom]);
  const onTouchMove=useCallback(e=>{e.preventDefault();if(e.touches.length===2&&pinchRef.current){const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY,dist=Math.sqrt(dx*dx+dy*dy);setZoom(z=>Math.max(8,Math.min(18,pinchRef.current.zoom+Math.log2(dist/pinchRef.current.dist))));}else if(e.touches.length===1&&dragRef.current){const dx=e.touches[0].clientX-dragRef.current.x,dy=e.touches[0].clientY-dragRef.current.y,scale=Math.pow(2,zoom)*256,mercY=Math.log(Math.tan(Math.PI/4+(dragRef.current.center.lat*Math.PI)/360)),newMercY=mercY+(dy/scale)*Math.PI*2;setMapCenter({lng:dragRef.current.center.lng-(dx/scale)*360,lat:((Math.atan(Math.exp(newMercY))*2-Math.PI/2)*180)/Math.PI});}},[zoom]);
  const onTouchEnd=()=>{dragRef.current=null;pinchRef.current=null;};
  const mouseRef=useRef(null);
  const onMouseDown=e=>{mouseRef.current={x:e.clientX,y:e.clientY,center:{...mapCenter}};};
  const onMouseMove=e=>{if(!mouseRef.current)return;const dx=e.clientX-mouseRef.current.x,dy=e.clientY-mouseRef.current.y,scale=Math.pow(2,zoom)*256,mercY=Math.log(Math.tan(Math.PI/4+(mouseRef.current.center.lat*Math.PI)/360)),newMercY=mercY+(dy/scale)*Math.PI*2;setMapCenter({lng:mouseRef.current.center.lng-(dx/scale)*360,lat:((Math.atan(Math.exp(newMercY))*2-Math.PI/2)*180)/Math.PI});};
  const onMouseUp=()=>{mouseRef.current=null;};
  const onWheel=e=>{e.preventDefault();setZoom(z=>Math.max(8,Math.min(18,z-e.deltaY*0.003)));};
  const filteredStages=stages.filter(s=>stagesFilter==="all"||s.privacy===stagesFilter);

  const TABS=[{id:"home",label:"Home",Ic:Icon.Home},{id:"map",label:"Map",Ic:Icon.Map},{id:"record",label:"",Ic:null},{id:"stages",label:"Stages",Ic:Icon.Lightning},{id:"profile",label:"Profile",Ic:Icon.User}];
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
      <SettingsScreen settings={settings} onSave={setSettings} onBack={()=>setShowSettings(false)}/>
    </div>
  );



  
  if(activeRace)return(
    <div ref={containerRef} style={{width:"100%",height:"100vh",position:"relative",overflow:"hidden",fontFamily:"'Inter',sans-serif"}}>
      <style>{STYLES}</style>
      <RaceScreen course={activeRace} stages={stages} user={user} onFinish={()=>setActiveRace(null)}/>

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
          {SAMPLE_FEED.map(item=><ActivityCard key={item.id} item={item}/>)}
        </div>
      )}

      {/* MAP */}
      {tab==="map"&&(
        <div style={{position:"absolute",inset:0}}>
          <div style={{position:"absolute",inset:0,cursor:"grab",touchAction:"none"}} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onWheel={onWheel}>
            <MapboxStyleMap center={mapCenter} zoom={zoom} flyToTrigger={flyToTrigger} width={mapSize.w} height={mapSize.h} stages={stages} courses={courses} userPos={userPos} onStagePress={s=>setSelectedStage(s)}/>
          </div>
          <div style={{position:"absolute",top:52,left:16,right:16,display:"flex",gap:10,zIndex:10}}>
            <div style={{flex:1,background:"white",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:8,boxShadow:"0 2px 10px rgba(0,0,0,0.1)"}}><Icon.Search/><span style={{fontSize:14,color:C.muted}}>Search stages…</span></div>
            <button className="tap" onClick={()=>setSheet("stageBuilder")} style={{background:C.orange,border:"none",borderRadius:12,padding:"10px 16px",display:"flex",alignItems:"center",gap:6,boxShadow:"0 2px 10px rgba(252,76,2,0.3)"}}><Icon.Plus/><span style={{fontSize:13,fontWeight:600,color:"#fff",whiteSpace:"nowrap"}}>Stage</span></button>
          </div>
          <div style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",display:"flex",flexDirection:"column",gap:6,zIndex:10}}>
            {[{l:"+",a:()=>setZoom(z=>Math.min(18,z+1))},{l:"−",a:()=>setZoom(z=>Math.max(8,z-1))},{l:"⌖",a:()=>{setMapCenter(userPos);setFlyToTrigger(Date.now());}}].map(({l,a})=>(
              <button key={l} className="tap" onClick={a} style={{width:36,height:36,borderRadius:9,background:"white",border:`1px solid ${C.border}`,fontSize:l==="⌖"?14:18,display:"flex",alignItems:"center",justifyContent:"center",color:C.text,boxShadow:"0 2px 6px rgba(0,0,0,0.08)"}}>{l}</button>
            ))}
          </div>
          {selectedStage&&(
            <><div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.3)",zIndex:39}} onClick={()=>setSelectedStage(null)}/><div className="slide-up" style={{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:40,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageDetailSheet stage={selectedStage} onClose={()=>setSelectedStage(null)} onRace={()=>{setActiveRace({id:Date.now(),name:selectedStage.name,stageIds:[selectedStage.id],mode:'race',times:{},bestPerStage:{}});setSelectedStage(null);}}/></div></>
          )}
          {sheet==="stageBuilder"&&(
            <><div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.25)",zIndex:39}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:40,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageBuilderSheet onClose={()=>setSheet(null)} onSave={async s=>{const{data,error}=await supabase.from('stages').insert({name:s.name,note:s.note,privacy:s.privacy,start_lat:s.start.lat,start_lng:s.start.lng,finish_lat:s.finish.lat,finish_lng:s.finish.lng,created_by:user.id,line_coords:s.lineCoords||null}).select().single();if(error){alert(error.message);}else{setStages(prev=>[...prev,{...s,id:data.id}]);}setSheet(null);}}/></div></>


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
            {coursesFilter==="stages"&&<div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:2}}>
              {[{v:"all",l:"All"},{v:"public",l:"Public"},{v:"group",l:"Group"},{v:"private",l:"Private"}].map(f=>(
                <button key={f.v} className="tap" onClick={()=>setStagesFilter(f.v)} style={{padding:"6px 14px",borderRadius:20,whiteSpace:"nowrap",background:stagesFilter===f.v?"white":C.surface,border:`1px solid ${stagesFilter===f.v?C.blue:C.border}`,color:stagesFilter===f.v?C.blue:C.text,fontSize:13,fontWeight:stagesFilter===f.v?600:400}}>{f.l}</button>
              ))}
            </div>}
          </div>
         {coursesFilter==="stages"&&(filteredStages.length===0?<div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}><Icon.Lightning size={36} color={C.mutedL}/><div style={{fontSize:15,fontWeight:500,marginBottom:4,marginTop:12}}>No stages</div></div>:filteredStages.map(s=><SegmentRow key={s.id} stage={s} userId={user.id} onPress={s=>{setSelectedStage(s);setMapCenter({lat:s.start.lat,lng:s.start.lng});setZoom(15);setTab("map");}} onDelete={async id=>{if(!window.confirm("Delete this stage?"))return;await supabase.from('stages').delete().eq('id',id).eq('created_by',user.id);setStages(prev=>prev.filter(s=>s.id!==id));}}/>))}


          {coursesFilter==="courses"&&(
            <div style={{padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div style={{fontSize:22,fontWeight:800,color:C.text}}>Courses</div>
                <button className="tap" onClick={()=>setSheet("courseBuilder")} style={{display:"flex",alignItems:"center",gap:6,background:C.orange,border:"none",borderRadius:10,padding:"9px 14px",color:"white",fontSize:13,fontWeight:600}}><Icon.Plus size={16} color="white"/>New</button>
              </div>
              {courses.length===0?(
                <div style={{textAlign:"center",padding:"48px 20px",color:C.muted}}>
                  <div style={{width:64,height:64,borderRadius:"50%",background:C.orangeL,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><Icon.Flag size={28} color={C.orange}/></div>
                  <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:6}}>No courses yet</div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:20,lineHeight:1.5}}>Choose Practice, Race or Mashup mode when building</div>
                  <button className="tap" onClick={()=>setSheet("courseBuilder")} style={{background:C.orange,border:"none",borderRadius:12,padding:"12px 24px",color:"white",fontSize:14,fontWeight:600}}>Build Your First Course</button>
                </div>
              ):courses.map(course=><CourseCard key={course.id} course={course} stages={stages} onStart={c=>setActiveRace(c)}/>)}
            </div>
          )}
        </div>
      )}

      {/* PROFILE */}
      {tab==="profile"&&(
        <div style={{height:"calc(100vh - 44px - 83px)",overflowY:"auto"}}>
          <ProfileView stages={stages} settings={settings} onSettingsPress={()=>setShowSettings(true)} onStatPress={key=>setSheet('stat-'+key)}/>

        </div>
      )}

      {/* Recording timer */}
      {recording&&tab!=="map"&&(
        <div className="fade-in" style={{position:"fixed",top:52,left:"50%",transform:"translateX(-50%)",zIndex:30,background:"white",borderRadius:12,padding:"8px 18px",boxShadow:"0 2px 14px rgba(0,0,0,0.12)",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:C.red,animation:"recPulse 1.5s infinite"}}/>
          <span style={{fontSize:20,fontWeight:700,color:C.text,fontVariantNumeric:"tabular-nums"}}>{formatTime(timerMs)}</span>
          <button className="tap" onClick={()=>setTimerRunning(t=>!t)} style={{background:"none",border:"none",fontSize:16,color:C.muted}}>{timerRunning?"⏸":"▶"}</button>
        </div>
      )}

      {/* Stage detail (from stages tab) */}
      {selectedStage&&tab!=="map"&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSelectedStage(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"88vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><StageDetailSheet stage={selectedStage} onClose={()=>setSelectedStage(null)} onRace={()=>{setActiveRace({id:Date.now(),name:selectedStage.name,stageIds:[selectedStage.id],mode:'race',times:{},bestPerStage:{}});setSelectedStage(null);}}/></div></>
      )}

      {/* Course builder */}
      {sheet==="courseBuilder"&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"90vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><CourseBuilderSheet stages={stages} onClose={()=>setSheet(null)} onSave={async c=>{const{data,error}=await supabase.from('courses').insert({name:c.name,privacy:c.privacy,mode:c.mode,stage_ids:c.stageIds,created_by:user.id}).select().single();if(!error){setCourses(prev=>[...prev,{...c,id:data.id}]);}setSheet(null);setCoursesFilter("courses");setTab("stages");}}/></div></>

      )}

      {/* Lobby */}
      {sheet==="lobby"&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"82vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div><LobbySheet onClose={()=>setSheet(null)}/></div></>
      )}

      {sheet&&sheet.startsWith('stat-')&&(
        <><div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:45}} onClick={()=>setSheet(null)}/><div className="slide-up" style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderRadius:"16px 16px 0 0",zIndex:46,maxHeight:"82vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"center",padding:"10px 0 4px"}}><div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/></div>
          <div style={{padding:"0 16px 80px"}}>
            <div style={{fontSize:17,fontWeight:700,color:C.text,marginBottom:16}}>{sheet==='stat-fastest'?'Fastest Stages':sheet==='stat-courses'?'Best Courses':sheet==='stat-completed'?'Stages Completed':'Course Records'}</div>
            {(sheet==='stat-fastest'||sheet==='stat-records')&&stages.filter(s=>s.cr).map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
                <Icon.Crown size={18} color="#92400E"/>
                <div style={{flex:1,fontSize:14,fontWeight:600,color:C.text}}>{s.name}</div>
                <div style={{fontSize:14,fontWeight:700,color:"#92400E"}}>{formatTime(s.time)}</div>
              </div>
            ))}
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
          if(t.id==="record")return(
            <button key="record" className="tap" onClick={()=>{if(!recording){setRecording(true);setTimerMs(0);setTimerRunning(true);}else{setRecording(false);setTimerRunning(false);}}} style={{width:54,height:54,borderRadius:"50%",background:recording?C.red:C.orange,border:"3px solid white",boxShadow:`0 4px 16px ${recording?"rgba(220,38,38,0.35)":"rgba(252,76,2,0.3)"}`,display:"flex",alignItems:"center",justifyContent:"center",marginTop:-14,transition:"all 0.2s"}}>
              <div style={{width:recording?16:18,height:recording?16:18,borderRadius:recording?3:"50%",background:"white",transition:"all 0.2s"}}/>
            </button>
          );
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
