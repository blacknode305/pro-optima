(function(){
  const cfg=window.PRO_OPTIMA_CONFIG||{};
  const api=String(cfg.API_BASE||"").replace(/\/+$/,"");
  if(!api||!("WebSocket" in window))return;
  const wsUrl=api.replace(/^http:/i,"ws:").replace(/^https:/i,"wss:")+"/ws";
  let socket=null,retry=1000,retryTimer=null,refreshTimer=null,lastRevision=null,closedByPage=false;

  function setRealtimeState(ok){
    document.documentElement.dataset.realtime=ok?"online":"offline";
    window.dispatchEvent(new CustomEvent("pro-optima:realtime-state",{detail:{online:ok}}));
  }
  function requestRefresh(message){
    const revision=Number(message?.revision);
    if(Number.isFinite(revision)&&revision===lastRevision)return;
    if(Number.isFinite(revision))lastRevision=revision;
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(async()=>{
      try{
        window.dispatchEvent(new CustomEvent("pro-optima:db-changed",{detail:message||{}}));
        if(typeof window.PRO_OPTIMA_REFRESH==="function")await window.PRO_OPTIMA_REFRESH(message||{});
      }catch(e){console.error("[PRO OPTIMA realtime] refresh failed",e)}
    },120);
  }
  function connect(){
    if(closedByPage||socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;
    clearTimeout(retryTimer);
    try{socket=new WebSocket(wsUrl)}catch(e){schedule();return}
    socket.onopen=()=>{retry=1000;setRealtimeState(true)};
    socket.onmessage=e=>{try{const msg=JSON.parse(e.data);if(msg.type==="hello"&&Number.isFinite(Number(msg.revision)))lastRevision=Number(msg.revision);if(msg.type==="db-changed")requestRefresh(msg)}catch{}};
    socket.onerror=()=>setRealtimeState(false);
    socket.onclose=()=>{setRealtimeState(false);socket=null;schedule()};
  }
  function schedule(){if(closedByPage)return;clearTimeout(retryTimer);retryTimer=setTimeout(connect,retry);retry=Math.min(15000,Math.round(retry*1.7))}
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)connect()});
  window.addEventListener("online",connect);
  window.addEventListener("beforeunload",()=>{closedByPage=true;clearTimeout(retryTimer);try{socket?.close()}catch{}});
  connect();
})();
