"use strict";

(function(){
  const norm=value=>String(value??"").trim().toLocaleLowerCase("ru-RU");
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const canonicalBranch=value=>{
    const key=norm(value);
    if(key==="горняк")return "Горняк";
    if(key==="лободы")return "Лободы";
    if(key==="нуркен"||key==="нуркена")return "Нуркена";
    if(key==="сарань")return "Сарань";
    if(key==="пришахтинск")return "Пришахтинск";
    if(key==="ермекова")return "Ермекова";
    if(key==="анжерская"||key==="анжерского")return "Анжерская";
    return null;
  };

  function ensureOfferIds(){
    if(!Array.isArray(supplierOffers))return false;
    const seen=new Set();
    let next=supplierOffers.reduce((max,o)=>{
      const id=Number(o?.id);
      return Number.isInteger(id)&&id>0?Math.max(max,id):max;
    },0)+1;
    let changed=false;
    for(const offer of supplierOffers){
      let id=Number(offer?.id);
      if(!Number.isInteger(id)||id<=0||seen.has(id)){
        while(seen.has(next))next++;
        offer.id=next++;
        id=Number(offer.id);
        changed=true;
      }
      seen.add(id);
    }
    return changed;
  }

  const baseHydrateRemote=window.hydrateRemote;
  if(typeof baseHydrateRemote==="function"){
    window.hydrateRemote=function(data){
      const result=baseHydrateRemote(data);
      const changed=ensureOfferIds();
      if(changed)localStorage.setItem(OFFER_KEY,JSON.stringify(supplierOffers));
      return result;
    };
  }

  const idsAddedOnLoad=ensureOfferIds();
  if(idsAddedOnLoad){
    localStorage.setItem(OFFER_KEY,JSON.stringify(supplierOffers));
    if(typeof renderSupplierOffers==="function")renderSupplierOffers();
  }

  function matchingEntry(map,branch){
    if(!map||typeof map!=="object"||Array.isArray(map))return null;
    const target=canonicalBranch(branch);
    if(!target)return null;
    let fallback=null;
    for(const [key,value] of Object.entries(map)){
      if(canonicalBranch(key)!==target)continue;
      if(key===target)return [key,value];
      fallback=[key,value];
    }
    return fallback;
  }

  function writeBranchOverride(rawMap,branch,value){
    const map=cleanManualActiveByBranch(rawMap);
    const target=canonicalBranch(branch);
    if(!target)return map;
    Object.keys(map).forEach(key=>{if(canonicalBranch(key)===target)delete map[key]});
    if(value===true||value===false)map[target]=value;
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
    ensureOfferIds();
    const offer=supplierOffers.find(x=>String(x.id)===String(id));
    if(!offer){
      alert("Не удалось определить выбранное предложение. Обновите страницу и повторите.");
      return;
    }
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
