import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Pick up new deploys: when the app comes back to the foreground, compare the running build with the live one and reload if it changed
const runningBuild=(()=>{const el=[...document.scripts].find(x=>/\/assets\/index-[^/]+\.js/.test(x.src));return el?new URL(el.src).pathname:null;})();
let lastBuildCheck=0;
const checkBuild=async()=>{
  if(!runningBuild||document.visibilityState!=="visible"||window.__gateBusy)return;
  const now=Date.now();
  if(now-lastBuildCheck<60000)return;
  lastBuildCheck=now;
  try{
    const html=await (await fetch('/?v='+now,{cache:'no-store'})).text();
    const m=html.match(/\/assets\/index-[^"'/]+\.js/);
    if(!m||m[0]===runningBuild||window.__gateBusy)return;
    const last=Number(sessionStorage.getItem('gate_build_reload')||0);
    if(now-last<120000)return;
    sessionStorage.setItem('gate_build_reload',String(now));
    location.reload();
  }catch(e){}
};
document.addEventListener('visibilitychange',checkBuild);
window.addEventListener('pageshow',checkBuild);
