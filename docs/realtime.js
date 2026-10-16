(function(){
  const cfg=window.PRO_OPTIMA_CONFIG||{};
  const api=String(cfg.API_BASE||"").replace(/\/+$/,"");
  if(!api)return;

  const page=(location.pathname.split("/").pop()||"index.html").toLowerCase();
  const operatorPolling=page==="operator.html";
  const recoveryPolling=page==="admin.html"||page==="form.html";
  let socket=null,retry=1000,retryTimer=null,refreshTimer=null,pollTimer=null,lastRevision=null,closedByPage=false;
  let healthKnown=false,healthOnline=false,bootstrapChecked=false;

  function setRealtimeState(ok){
    document.documentElement.dataset.realtime=ok?"online":"offline";
    window.dispatchEvent(new CustomEvent("pro-optima:realtime-state",{detail:{online:ok}}));
  }
  function runRefresh(message,force=false){
    const revision=Number(message?.revision);
    if(!force&&Number.isFinite(revision)&&revision===lastRevision)return;
    if(Number.isFinite(revision))lastRevision=revision;
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(async()=>{
      try{
        window.dispatchEvent(new CustomEvent("pro-optima:db-changed",{detail:message||{}}));
        if(typeof window.PRO_OPTIMA_REFRESH==="function"){
          await window.PRO_OPTIMA_REFRESH(message||{});
        }else if(page==="admin.html"&&typeof window.reloadRemote==="function"){
          await window.reloadRemote();
        }
      }catch(e){console.error("[PRO OPTIMA realtime] refresh failed",e)}
    },120);
  }

  function schedulePoll(delay){
    if(closedByPage||(!operatorPolling&&!recoveryPolling))return;
    clearTimeout(pollTimer);
    pollTimer=setTimeout(pollOnce,delay);
  }
  async function pollOnce(){
    if(closedByPage||(!operatorPolling&&!recoveryPolling))return;
    const wasOnline=healthOnline;
    try{
      const response=await fetch(api+"/api/health",{cache:"no-store"});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const message=await response.json();
      const revision=Number(message?.revision);
      healthKnown=true;healthOnline=true;setRealtimeState(true);

      if(Number.isFinite(revision)){
        if(lastRevision===null){
          lastRevision=revision;
          // A page can start while Railway is rolling over to a new container.
          // Admin then falls back to local cache and otherwise never retries.
          if(recoveryPolling&&!bootstrapChecked){
            bootstrapChecked=true;
            runRefresh({type:"db-recovery",revision,updatedAt:message.updatedAt||null,transport:"health"},true);
          }
        }else if(revision!==lastRevision){
          runRefresh({type:"db-changed",revision,updatedAt:message.updatedAt||null,transport:"health"});
        }else if(healthKnown&&!wasOnline){
          runRefresh({type:"db-recovery",revision,updatedAt:message.updatedAt||null,transport:"health"},true);
        }
      }
      schedulePoll(document.hidden?15000:(operatorPolling?3000:5000));
    }catch{
      healthKnown=true;healthOnline=false;
      if(!socket||socket.readyState!==WebSocket.OPEN)setRealtimeState(false);
      schedulePoll(document.hidden?15000:5000);
    }
  }

  function connect(){
    if(operatorPolling||!("WebSocket" in window)||closedByPage||socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;
    const wsUrl=api.replace(/^http:/i,"ws:").replace(/^https:/i,"wss:")+"/ws";
    clearTimeout(retryTimer);
    try{socket=new WebSocket(wsUrl)}catch(e){schedule();return}
    socket.onopen=()=>{retry=1000;setRealtimeState(true)};
    socket.onmessage=e=>{
      try{
        const msg=JSON.parse(e.data);
        if(msg.type==="hello"&&Number.isFinite(Number(msg.revision))){
          const revision=Number(msg.revision);
          if(lastRevision===null)lastRevision=revision;
          else if(revision!==lastRevision)runRefresh({...msg,type:"db-recovery",transport:"ws"});
        }
        if(msg.type==="db-changed")runRefresh(msg);
      }catch{}
    };
    socket.onerror=()=>{if(!healthOnline)setRealtimeState(false)};
    socket.onclose=()=>{if(!healthOnline)setRealtimeState(false);socket=null;schedule()};
  }
  function schedule(){if(closedByPage||operatorPolling)return;clearTimeout(retryTimer);retryTimer=setTimeout(connect,retry);retry=Math.min(15000,Math.round(retry*1.7))}

  document.addEventListener("visibilitychange",()=>{
    if(document.hidden)return;
    if(operatorPolling||recoveryPolling)schedulePoll(0);
    if(!operatorPolling)connect();
  });
  window.addEventListener("online",()=>{
    if(operatorPolling||recoveryPolling)schedulePoll(0);
    if(!operatorPolling)connect();
  });
  window.addEventListener("beforeunload",()=>{
    closedByPage=true;
    clearTimeout(retryTimer);clearTimeout(pollTimer);clearTimeout(refreshTimer);
    try{socket?.close()}catch{}
  });

  if(operatorPolling||recoveryPolling)pollOnce();
  if(!operatorPolling)connect();
})();
