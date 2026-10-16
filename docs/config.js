window.PRO_OPTIMA_CONFIG = Object.freeze({
  API_BASE: "https://pro-optima-api-7f42c9.up.railway.app"
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

  function installSafeMutationObserver(){
    if(page!=="admin.html"||window.__PRO_OPTIMA_SAFE_MUTATION_OBSERVER__)return;
    const NativeMutationObserver=window.MutationObserver;
    if(typeof NativeMutationObserver!=="function")return;
    window.__PRO_OPTIMA_SAFE_MUTATION_OBSERVER__=true;
    window.MutationObserver=class SafeMutationObserver{
      constructor(callback){
        this._active=false;
        this._target=null;
        this._options=null;
        this._native=new NativeMutationObserver(records=>{
          if(!this._active)return;
          const target=this._target,options=this._options;
          this._native.disconnect();
          try{callback(records,this)}finally{
            if(this._active&&target)this._native.observe(target,options);
          }
        });
      }
      observe(target,options){
        this._target=target;
        this._options=options;
        this._active=true;
        this._native.observe(target,options);
      }
      disconnect(){
        this._active=false;
        this._native.disconnect();
      }
      takeRecords(){return this._native.takeRecords()}
    };
  }

  function appendScript(src,ordered=false){
    const script=document.createElement("script");
    script.src=src;
    if(ordered)script.async=false;
    document.body.appendChild(script);
    return script;
  }

  window.addEventListener("DOMContentLoaded",()=>{
    if(page==="admin.html"){
      const row=document.querySelector(".header-row");
      if(row&&!row.querySelector(".po-role-switch")){
        const nav=document.createElement("div");
        nav.className="po-role-switch";
        nav.innerHTML='<a href="operator.html">Оператор</a><a href="form.html">Форма</a>';
        row.appendChild(nav);
      }
    }

    appendScript("unit-presets.js?v=20261015-1");

    if(page==="admin.html"){
      appendScript("admin-orders-patch.js?v=20261015-4");
      appendScript("admin-unit-settings.js?v=20261015-1");
      appendScript("admin-history-delete-fix.js?v=20261015-1");
      appendScript("admin-dispatcher-settings.js?v=20261015-1");
      appendScript("admin-stock-ordered.js?v=20261015-2");
      appendScript("admin-order-card-history.js?v=20261015-2");
      appendScript("admin-update-safety.js?v=20261015-1");
      installSafeMutationObserver();
      appendScript("admin-ui-overhaul.js?v=20261016-3",true);
      appendScript("admin-offer-status-fix.js?v=20261016-1",true);
    }

    if(page==="operator.html")appendScript("operator-dispatcher-auth.js?v=20261015-1");
    if(page==="form.html")appendScript("form-date-native.js?v=20261015-2");

    appendScript("branch-display.js?v=20261015-2",true);
    appendScript("realtime.js?v=20261016-5");
  });
})();
