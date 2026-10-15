window.PRO_OPTIMA_CONFIG = Object.freeze({
  API_BASE: "https://pro-optima-production.up.railway.app"
});

(function(){
  const page=(location.pathname.split("/").pop()||"index.html").toLowerCase();
  const root=document.documentElement;
  if(page==="admin.html") root.classList.add("page-admin");
  if(page==="operator.html") root.classList.add("page-operator");
  if(page==="form.html") root.classList.add("page-form");

  const link=document.createElement("link");
  link.rel="stylesheet";
  link.href="pro-optima-ui.css?v=20261015-2";
  document.head.appendChild(link);

  if(page==="admin.html"){
    const adminTheme=document.createElement("link");
    adminTheme.rel="stylesheet";
    adminTheme.href="admin-theme-overhaul.css?v=20261015-1";
    document.head.appendChild(adminTheme);
  }

  if(page==="admin.html"){
    window.addEventListener("DOMContentLoaded",()=>{
      const row=document.querySelector(".header-row");
      if(row&&!row.querySelector(".po-role-switch")){
        const nav=document.createElement("div");
        nav.className="po-role-switch";
        nav.innerHTML='<a href="operator.html">Заявки · оператор</a><a href="form.html">Форма производства</a>';
        row.appendChild(nav);
      }
    });
  }

  window.addEventListener("load",()=>{
    const unitPresets=document.createElement("script");
    unitPresets.src="unit-presets.js?v=20261015-1";
    document.body.appendChild(unitPresets);
    if(page==="admin.html"){
      const patch=document.createElement("script");
      patch.src="admin-orders-patch.js?v=20261015-4";
      document.body.appendChild(patch);
      const unitSettings=document.createElement("script");
      unitSettings.src="admin-unit-settings.js?v=20261015-1";
      document.body.appendChild(unitSettings);
      const historyDeleteFix=document.createElement("script");
      historyDeleteFix.src="admin-history-delete-fix.js?v=20261015-1";
      document.body.appendChild(historyDeleteFix);
      const dispatcherSettings=document.createElement("script");
      dispatcherSettings.src="admin-dispatcher-settings.js?v=20261015-1";
      document.body.appendChild(dispatcherSettings);
      const orderedStock=document.createElement("script");
      orderedStock.src="admin-stock-ordered.js?v=20261015-2";
      document.body.appendChild(orderedStock);
      const cardHistory=document.createElement("script");
      cardHistory.src="admin-order-card-history.js?v=20261015-2";
      document.body.appendChild(cardHistory);
      const updateSafety=document.createElement("script");
      updateSafety.src="admin-update-safety.js?v=20261015-1";
      document.body.appendChild(updateSafety);
      const uiOverhaul=document.createElement("script");
      uiOverhaul.src="admin-ui-overhaul.js?v=20261015-1";
      uiOverhaul.async=false;
      document.body.appendChild(uiOverhaul);
    }
    if(page==="operator.html"){
      const dispatcherAuth=document.createElement("script");
      dispatcherAuth.src="operator-dispatcher-auth.js?v=20261015-1";
      document.body.appendChild(dispatcherAuth);
    }
    if(page==="form.html"){
      const dateAccess=document.createElement("script");
      dateAccess.src="form-date-native.js?v=20261015-2";
      document.body.appendChild(dateAccess);
    }
    const branchDisplay=document.createElement("script");
    branchDisplay.src="branch-display.js?v=20261015-1";
    branchDisplay.async=false;
    document.body.appendChild(branchDisplay);
    const realtime=document.createElement("script");
    realtime.src="realtime.js?v=20261015-1";
    document.body.appendChild(realtime);
  });
})();
