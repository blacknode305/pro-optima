"use strict";
// Supplier declarations and veterinary certificates.
// Private attachment bytes are stored separately in the persistent Railway data volume.
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const TYPE_NAMES=new Set(["eaeu","veterinary"]);
const REVIEW_NAMES=new Set(["needs_review","confirmed"]);
const MIME_EXT={
  "image/jpeg":".jpg",
  "image/png":".png",
  "image/webp":".webp",
  "application/pdf":".pdf"
};
const limit=(x,size)=>String(x??"").trim().slice(0,size);
const dateValid=s=>{
  if(s==="")return true;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const d=new Date(s+"T12:00:00Z");
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
};
function normalizeRecord(data,db,old=null){
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Неверный формат документа.");
  const documentType=limit(data.documentType||old?.documentType||"eaeu",24);
  if(!TYPE_NAMES.has(documentType))throw Error("Неизвестная категория документа.");
  const reviewStatus=limit(data.reviewStatus||old?.reviewStatus||"needs_review",24);
  if(!REVIEW_NAMES.has(reviewStatus))throw Error("Недопустимый статус проверки.");
  const supplierId=limit(data.supplierId??old?.supplierId??"",120);
  if(supplierId&&!db.suppliers.some(x=>String(x.id)===supplierId))throw Error("Поставщик не найден.");
  if(!supplierId&&reviewStatus==="confirmed")throw Error("Для подтверждения документа выберите поставщика.");
  const productType=limit(data.productType??old?.productType,180);
  if(productType.length<2)throw Error("Укажите тип продукции (от 2 символов).");
  const startDate=limit(data.startDate??old?.startDate,10);
  const endDate=limit(data.endDate??old?.endDate,10);
  if(!dateValid(startDate)||!dateValid(endDate)||!endDate)throw Error("Укажите корректный срок действия.");
  if(startDate&&endDate<startDate)throw Error("Дата окончания раньше начала.");
  if(reviewStatus==="confirmed"&&!startDate)throw Error("Укажите дату начала действия перед подтверждением.");
  const fields={
    documentNumber:130,applicantName:190,manufacturerName:190,originCountry:90,
    productDescription:700,technicalRegulations:200,registrationDate:10,issueDate:10,
    qrUrl:900,recipientName:190,batchDetails:500,quantityPlaces:50,netWeight:70,
    receiptDate:10,receiptReference:120,notes:1200,supplierNameHint:190
  };
  const extra={};
  for(const [name,max] of Object.entries(fields)){
    const value=limit(data[name]??old?.[name],max);
    if(["registrationDate","issueDate","receiptDate"].includes(name)&&!dateValid(value))
      throw Error("Некорректная дата документа: "+name);
    if(name==="qrUrl"&&value){
      let parsed;
      try{parsed=new URL(value);}catch{throw Error("Ссылка из QR должна быть полным HTTPS-адресом.");}
      if(parsed.protocol!=="https:")throw Error("Ссылка из QR должна начинаться с https://.");
    }
    extra[name]=value;
  }
  const importSourceId=limit(old?.importSourceId||data.importSourceId,160);
  const qrPresent=Boolean(data.qrPresent??old?.qrPresent);
  return {
    id:old?.id||crypto.randomUUID(),documentType,reviewStatus,
    supplierId:supplierId||null,productType,startDate,endDate,...extra,
    qrPresent,importSourceId,attachments:Array.isArray(old?.attachments)?old.attachments.slice():[],
    createdAt:old?.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    ...(reviewStatus==="confirmed"?{reviewedAt:old?.reviewedAt||new Date().toISOString()}:{})
  };
}
function decodeAttachment(input){
  if(!input||typeof input!=="object")throw Error("Некорректное вложение.");
  const mime=limit(input.mime,60);
  const ext=MIME_EXT[mime];if(!ext)throw Error("Допустимы только JPG, PNG, WEBP и PDF.");
  const raw=String(input.base64||"");
  if(!raw||raw.length>11*1024*1024||!/^[A-Za-z0-9+/=]+$/.test(raw))
    throw Error("Слишком большой или повреждённый файл.");
  const bytes=Buffer.from(raw,"base64");
  if(bytes.length<8||bytes.length>8*1024*1024)throw Error("Размер вложения должен быть до 8 МБ.");
  const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP";
  const pdf=bytes.toString("ascii",0,5)==="%PDF-";
  if(!({"image/jpeg":jpeg,"image/png":png,"image/webp":webp,"application/pdf":pdf}[mime]))
    throw Error("Тип файла не соответствует содержимому.");
  const name=limit(input.name||"Документ"+ext,150).replace(/[\\/\u0000-\u001f]/g,"_");
  return {bytes,mime,ext,name,sha256:crypto.createHash("sha256").update(bytes).digest("hex")};
}
function storeFiles(dataDir,document,files,createdPaths){
  if(!Array.isArray(files)||files.length>10)throw Error("Можно приложить не более 10 файлов за раз.");
  const dir=path.join(dataDir,"declaration-files");fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const existing=new Set((document.attachments||[]).map(x=>x.sha256));
  for(const input of files){
    const file=decodeAttachment(input);
    if(existing.has(file.sha256))continue;
    const id=crypto.randomUUID(),storedAs=id+file.ext,full=path.join(dir,storedAs);
    fs.writeFileSync(full,file.bytes,{flag:"wx",mode:0o600});
    createdPaths.push(full);existing.add(file.sha256);
    document.attachments.push({id,storedAs,mime:file.mime,name:file.name,size:file.bytes.length,sha256:file.sha256});
  }
  if(document.attachments.length>20)throw Error("У документа может быть не более 20 вложений.");
}
function findFile(db,dataDir,recordId,fileId){
  const doc=db.declarations?.find(d=>String(d.id)===recordId);
  const attachment=doc?.attachments?.find(a=>String(a.id)===fileId);
  if(!attachment||!String(attachment.storedAs||"").match(/^[a-zA-Z0-9-]{36}\.(jpg|png|webp|pdf)$/))return null;
  return {attachment,path:path.join(dataDir,"declaration-files",attachment.storedAs)};
}
module.exports={normalizeRecord,decodeAttachment,storeFiles,findFile};
