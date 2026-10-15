(function(){
  if(typeof window.deleteHistory!=="function"||typeof window.historyById!=="function")return;

  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  async function settlePendingHistory(){
    try{if(typeof remoteTimer!=="undefined")clearTimeout(remoteTimer)}catch{}
    for(let i=0;i<50&&typeof remoteSaving!=="undefined"&&remoteSaving;i++)await wait(50);
    if(typeof remotePending!=="undefined"&&remotePending?.has?.("history")&&typeof flushRemote==="function"){
      await flushRemote();
      for(let i=0;i<50&&typeof remoteSaving!=="undefined"&&remoteSaving;i++)await wait(50);
    }
  }

  function applyHistoryLocally(rows,revision){
    orderHistory=Array.isArray(rows)?structuredClone(rows):[];
    localStorage.setItem(HISTORY_KEY,JSON.stringify(orderHistory));
    if(typeof REMOTE_REVISION!=="undefined"&&revision!==undefined&&revision!==null)REMOTE_REVISION=revision;
    if(typeof remotePending!=="undefined")remotePending.delete("history");
    if(typeof remoteState==="function"&&revision!==undefined&&revision!==null)remoteState(`Railway · rev ${revision}`,"ok");
    if(typeof renderHistory==="function")renderHistory();
  }

  async function persistDelete(id){
    const targetId=String(id||"");
    if(!targetId)return;
    try{
      if(typeof adminToken==="function"&&!adminToken()){
        if(typeof setAdminTokenPrompt==="function")setAdminTokenPrompt();
        if(!adminToken())throw new Error("Нужен Admin token Railway для удаления заявки.");
      }
      await settlePendingHistory();

      for(let attempt=0;attempt<2;attempt++){
        const fresh=await remoteFetch("/api/db",{admin:false});
        const serverHistory=Array.isArray(fresh.data?.history)?fresh.data.history:[];
        const next=serverHistory.filter(row=>String(row?.id||"")!==targetId);

        if(next.length===serverHistory.length){
          applyHistoryLocally(next,fresh.revision);
          if(typeof show==="function")show("historyMsg","Заявка уже удалена из Railway.","ok");
          return;
        }

        try{
          const out=await remoteFetch("/api/admin/db",{
            method:"PATCH",
            body:JSON.stringify({baseRevision:fresh.revision,changes:{history:next}})
          });
          applyHistoryLocally(next,out.revision);
          if(typeof show==="function")show("historyMsg","Заявка удалена из Railway и больше не будет восстанавливаться.","ok");
          return;
        }catch(e){
          if(e?.status===409&&attempt===0)continue;
          throw e;
        }
      }
    }catch(e){
      console.error(e);
      if(typeof show==="function")show("historyMsg","Не удалось удалить заявку из Railway: "+(e?.message||e),"err");
      else alert(e?.message||e);
      if(typeof reloadRemote==="function")reloadRemote();
    }
  }

  window.deleteHistory=function(id){
    const rec=window.historyById(id);
    const title=rec?`${rec.branch||""} · ${rec.supplier||""} · ${rec.requestDate||""}`:"эту заявку";
    askModal("Удалить заявку",`Удалить ${title} из рабочей базы Railway?`,"Удалить",()=>protectedDelete(()=>persistDelete(id)));
  };
})();
