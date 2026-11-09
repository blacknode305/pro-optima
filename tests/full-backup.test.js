import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require=createRequire(import.meta.url);
const {createFullBackupStream}=require('../server/fullBackup.js');
function unpack(buffer){
  const out={};let offset=0;
  while(offset<buffer.length){
    const header=buffer.subarray(offset,offset+512);
    if(header.every(b=>b===0))break;
    const name=header.subarray(0,100).toString('ascii').split('\0')[0];
    const size=parseInt(header.subarray(124,136).toString('ascii').replace(/\0.*$/,'').trim(),8);
    assert.ok(Number.isSafeInteger(size));
    const recorded=parseInt(header.subarray(148,156).toString('ascii').replace(/\0.*$/,'').trim(),8);
    const expected=Buffer.from(header);expected.fill(32,148,156);
    assert.equal(recorded,[...expected].reduce((a,b)=>a+b,0),'valid TAR checksum');
    offset+=512;out[name]=buffer.subarray(offset,offset+size);
    offset+=Math.ceil(size/512)*512;
  }
  return out;
}
test('complete backup streams canonical DB, metadata, access and all photo bytes with checksums', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'optima-complete-export-'));
  try{
    mkdirSync(join(dir,'declaration-files'));
    const globalDb={format:'dashboardx-global-v1',schemaVersion:1,dashboardx:{
      optima:{suppliers:[],products:[{id:1}]},
      media:{radioStations:[{id:'fm1',name:'FM',url:'https://radio.example/stream'}]},
      learning:{english:{level:'A1'}}
    }};
    writeFileSync(join(dir,'dashboardx.json'),JSON.stringify(globalDb));
    writeFileSync(join(dir,'meta.json'),'{"revision":634}');
    writeFileSync(join(dir,'access.json'),'{"branches":{"test":{"pinHash":"scrypt"}}}');
    const sample=Buffer.alloc(10001,127);
    writeFileSync(join(dir,'declaration-files','photo-1.jpg'),sample);
    const parts=[];for await(const chunk of createFullBackupStream(dir,634))parts.push(chunk);
    const all=unpack(gunzipSync(Buffer.concat(parts)));
    assert.deepEqual(Object.keys(all),['dashboardx.json','meta.json','access.json','declaration-files/photo-1.jpg','manifest.json']);
    assert.deepEqual(all['declaration-files/photo-1.jpg'],sample);
    assert.deepEqual(JSON.parse(all['dashboardx.json'].toString('utf8')),globalDb,
      'canonical OPTIMA, radio and DashboardX data must remain together in one JSON');
    const manifest=JSON.parse(all['manifest.json'].toString('utf8'));
    assert.equal(manifest.revision,634);
    for(const record of manifest.files){
      assert.equal(record.sha256,createHash('sha256').update(all[record.path]).digest('hex'));
      assert.equal(record.size,all[record.path].length);
    }
  }finally{rmSync(dir,{recursive:true,force:true})}
});
