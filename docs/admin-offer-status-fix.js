"use strict";

(function(){
  const BRANCH_ALIASES={
    "горняк":["ГОРНЯК","Горняк"],
    "лободы":["ЛОБОДЫ","Лободы"],
    "нуркен":["НУРКЕН","Нуркен"],
    "нуркена":["НУРКЕНА","Нуркена"],
    "сарань":["САРАНЬ","Сарань"],
    "пришахтинск":["ПРИШАХТИНСК","Пришахтинск"]
  };

  const norm=value=>String(value??"").trim().toLocaleLowerCase("ru-RU");
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function branchKeys(branch){
    const raw=String(branch??"").trim();
    const key=norm(raw);
    const out=new Set([raw]);
    if(raw&&raw!=="*"){
      out.add(raw.toLocaleUpperCase("ru-RU"));
      const pretty=raw.charAt(0).toLocaleUpperCase("ru-RU")+raw.slice(1).toLocaleLowerCase("ru-RU");
      out.add(pretty);
      (BRANCH_ALIASES[key]||[]).forEach(x=>out.add(x));
    }
    return [...out].filter(Boolean);
  }

  function matchingEntry(map,branch){
    if(!map||typeof map!=="object"||Array.isArray(map))return null;
    const target=norm(branch);
    for(const [key,value] of Object.entries(map)){
      if(norm(key)===target)return [key,value];
    }
    return null;
  }

  function writeBranchOverride(rawMap,branch,value){
    const map=cleanManualActiveByBranch(rawMap);
    const target=norm(branch);
    Object.keys(map).forEach(key=>{if(norm(key)===target)delete map[key]});
    if(value===true||value===false){
      // Keep aliases intentionally: the existing server used exact branch keys.
      // This makes old and new branch spellings resolve to the same manual state.
      branchKeys(branch).forEach(key=>{map[key]=value});
    }
    return map;
  }

  window.offerManualSetting=function(o,branch){
    if(branch&&branch!=="*"){
      const hit=matchingEntry(o?.manualActiveByBranch,branch);
      if(hit)return hit[1]===true?true:hit[1]===false?false:null;
    }
    return o?.manualActive===true?true:o?.manualActive===false?false:null;
  };

  window.offerHasBranchOverride=function(o,branch){
    if(!branch||branch==="*")return o?.manualActive!==null&&o?.manualActive!==undefined;
    return !!matchingEntry(o?.manualActiveByBranch,branch);
  };

  async function flushOffersNow(){
    if(!REMOTE_READY)throw new Error("База Railway ещё загружается. Повторите действие после загрузки.");
    if(!adminToken()){
      setAdminTokenPrompt();
      if(!adminToken())throw new Error("Для сохранения статуса нужен Admin token.");
    }

    remotePending.add("offers");
    if(remoteTimer){clearTimeout(remoteTimer);remoteTimer=null;}

    const deadline=Date.now()+8000;
    while(remoteSaving&&Date.now()<deadline)await wait(60);
    if(remoteSaving)throw new Error("Предыдущее сохранение ещё выполняется.");

    await flushRemote();
    if(remotePending.has("offers"))throw new Error("Railway не подтвердил сохранение статуса.");
  }

  window.setOfferManual=async function(id,value){
    const offer=supplierOffers.find(x=>String(x.id)===String(id));
    if(!offer)return;
    const branch=document.getElementById("offerBranch")?.value||"*";
    const previousManual=offer.manualActive;
    const previousMap=structuredClone(cleanManualActiveByBranch(offer.manualActiveByBranch));

    try{
      if(branch==="*")offer.manualActive=value;
      else offer.manualActiveByBranch=writeBranchOverride(offer.manualActiveByBranch,branch,value);

      localStorage.setItem(OFFER_KEY,JSON.stringify(supplierOffers));
      renderSupplierOffers();renderPriceComparison();renderOrderPlan();
      await flushOffersNow();

      renderSupplierOffers();renderPriceComparison();renderOrderPlan();
    }catch(error){
      offer.manualActive=previousManual;
      offer.manualActiveByBranch=previousMap;
      localStorage.setItem(OFFER_KEY,JSON.stringify(supplierOffers));
      remotePending.delete("offers");
      renderSupplierOffers();renderPriceComparison();renderOrderPlan();
      remoteState("статус не сохранён","bad");
      alert("Не удалось сохранить статус в Railway: "+(error?.message||error));
      console.error(error);
    }
  };
})();
