(function(){
  if(window.__PRO_OPTIMA_FORM_STOCK_CARRYOVER__)return;
  const baseOpenOrder=window.openOrder;
  if(typeof baseOpenOrder!=="function")return;
  window.__PRO_OPTIMA_FORM_STOCK_CARRYOVER__=true;

  const n=s=>String(s??"").trim().toLocaleLowerCase("ru-RU");
  const matches=(item,product)=>
    (item?.productId&&Number(item.productId)===Number(product?.productId))||
    n(item?.product||item?.name)===n(product?.name);

  function latestStock(product,requestDate,skipOrderId){
    const rows=[];
    for(const order of (S?.orders||[])){
      if(String(order?.id||"")===String(skipOrderId||""))continue;
      if(String(order?.stage||"")==="cancelled")continue;
      if(String(order?.requestDate||"")>String(requestDate||"9999-12-31"))continue;
      const item=(order?.items||[]).find(x=>matches(x,product));
      if(!item||item.stock===undefined||item.stock===null||item.stock==="")continue;
      rows.push({order,item});
    }
    rows.sort((a,b)=>
      String(b.order?.requestDate||"").localeCompare(String(a.order?.requestDate||""))||
      String(b.order?.updatedAt||b.order?.createdAt||b.order?.sentAt||"").localeCompare(String(a.order?.updatedAt||a.order?.createdAt||a.order?.sentAt||""))
    );
    return rows[0]?.item||null;
  }

  function seededItem(product,snapshot){
    if(!snapshot)return null;
    return {
      productId:product.productId,
      product:product.name,
      stock:snapshot.used===false?"-":snapshot.stock,
      stockUnit:String(snapshot.stockUnit||product.unit||""),
      used:snapshot.used!==false,
      expected:"",
      unit:String(product.unit||""),
      delivered:null,
      deliveredUnit:String(product.unit||"")
    };
  }

  function applyInitialDashState(){
    document.querySelectorAll("#mb .item[data-i]").forEach(row=>{
      const stock=row.querySelector(".sq"),order=row.querySelector(".oq"),unit=row.querySelector(".ou");
      if(!stock||String(stock.value||"").trim()!=="-")return;
      if(order){order.value="0";order.disabled=true}
      if(unit)unit.disabled=true;
    });
  }

  window.openOrder=function(id){
    const r=typeof plan==="function"?plan(id):null;
    if(!r||!S||!Array.isArray(S.orders))return baseOpenOrder.apply(this,arguments);

    const current=typeof of==="function"?of(r):null;
    const items=(current?.items||[]).map(x=>({...x}));
    let added=0;
    for(const product of (r.items||[])){
      if(items.some(x=>matches(x,product)))continue;
      const seed=seededItem(product,latestStock(product,r.requestDate,current?.id));
      if(!seed)continue;
      items.push(seed);added++;
    }
    if(!added){
      const out=baseOpenOrder.apply(this,arguments);
      applyInitialDashState();
      return out;
    }

    const originalOrders=S.orders;
    const temporaryOrders=[...originalOrders];
    const synthetic=current?{...current,items}:{
      requestDate:r.requestDate,
      deliveryDate:r.deliveryDate,
      supplierId:r.supplierId,
      supplier:r.supplier,
      stage:"new",
      items
    };
    if(current){
      const i=temporaryOrders.indexOf(current);
      if(i>=0)temporaryOrders[i]=synthetic;else temporaryOrders.unshift(synthetic);
    }else temporaryOrders.unshift(synthetic);

    S.orders=temporaryOrders;
    try{
      const out=baseOpenOrder.apply(this,arguments);
      applyInitialDashState();
      return out;
    }finally{
      S.orders=originalOrders;
    }
  };
})();
