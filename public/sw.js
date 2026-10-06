self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{};}catch(e){data={title:'GATE',body:event.data?event.data.text():''};}
  event.waitUntil(self.registration.showNotification(data.title||'GATE',{body:data.body||'',icon:'/icon-192.png',badge:'/icon-192.png',data:{url:data.url||'/'},tag:data.tag||undefined}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=(event.notification.data&&event.notification.data.url)||'/';
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if('focus' in c)return c.focus();}
    if(self.clients.openWindow)return self.clients.openWindow(url);
  }));
});
