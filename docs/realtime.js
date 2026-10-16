(function(){
  const cfg=window.PRO_OPTIMA_CONFIG||{};
  const api=String(cfg.API_BASE||"").replace(/\/+$/,"");
  if(!api)return;

  const page=(location.pathname.split("/").pop()||"index.html").toLowerCase();
  const operatorPolling=page==="operator.html";
  let socket=null,retry=1000,retryTimer=null,refreshTimer=null,pollTimer=null,lastRevision=null,closedByPage=false;

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

  function schedulePoll(delay){
    if(closedByPage||!operatorPolling)return;
    clearTimeout(pollTimer);
    pollTimer=setTimeout(pollOnce,delay);
  }
  async function pollOnce(){
    if(closedByPage||!operatorPolling)return;
    try{
      // Operator only needs to know whether database revision changed. Checking the
      // small health endpoint avoids a persistent websocket dependency on this page.
      const response=await fetch(api+"/api/health",{cache:"no-store"});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const message=await response.json();
      const revision=Number(message?.revision);
      setRealtimeState(true);
      if(Number.isFinite(revision)){
        if(lastRevision===null)lastRevision=revision;
        else if(revision!==lastRevision)requestRefresh({type:"db-changed",revision,updatedAt:message.updatedAt||null,transport:"poll"});
      }
      schedulePoll(document.hidden?10000:3000);
    }catch{
      setRealtimeState(false);
      schedulePoll(document.hidden?15000:5000);
    }
  }

  function connect(){
    if(operatorPolling||!("WebSocket" in window)||closedByPage||socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;
    const wsUrl=api.replace(/^http:/i,"ws:").replace(/^https:/i,"wss:")+"/ws";
    clearTimeout(retryTimer);
    try{socket=new WebSocket(wsUrl)}catch(e){schedule();return}
    socket.onopen=()=>{retry=1000;setRealtimeState(true)};
    socket.onmessage=e=>{try{const msg=JSON.parse(e.data);if(msg.type==="hello"&&Number.isFinite(Number(msg.revision)))lastRevision=Number(msg.revision);if(msg.type==="db-changed")requestRefresh(msg)}catch{}};
    socket.onerror=()=>setRealtimeState(false);
    socket.onclose=()=>{setRealtimeState(false);socket=null;schedule()};
  }
  function schedule(){if(closedByPage||operatorPolling)return;clearTimeout(retryTimer);retryTimer=setTimeout(connect,retry);retry=Math.min(15000,Math.round(retry*1.7))}

  document.addEventListener("visibilitychange",()=>{
    if(document.hidden)return;
    if(operatorPolling){schedulePoll(0);return}
    connect();
  });
  window.addEventListener("online",()=>{operatorPolling?schedulePoll(0):connect()});
  window.addEventListener("beforeunload",()=>{
    closedByPage=true;
    clearTimeout(retryTimer);clearTimeout(pollTimer);clearTimeout(refreshTimer);
    try{socket?.close()}catch{}
  });

  if(operatorPolling)pollOnce();else connect();
})();
