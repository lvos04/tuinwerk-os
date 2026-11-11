// Developer-only acceptance probe for an isolated installation, never seed production.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const [action,url,file]=process.argv.slice(2);
if(!['seed','verify'].includes(action)||!url||!file)throw Error('Usage: node scripts/runtime-smoke.mjs seed|verify http://localhost:PORT /tmp/expected.json');
let token;
async function call(path,body,method='GET'){
 const response=await fetch(url+'/api'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const value=await response.json();assert.ok(response.ok,path+': '+JSON.stringify(value));return value;
}
const session=await call('/auth/login',{email:process.env.TEST_ADMIN_EMAIL,password:process.env.TEST_ADMIN_PASSWORD},'POST');token=session.token;
if(action==='seed'){
 const suffix=randomUUID().slice(0,8);
 const location=await call('/locations',{name:'Hersteltest '+suffix},'POST');
 const task=await call('/tasks',{title:'Herstelbare pomp '+suffix,locationId:location.id,operationId:randomUUID()},'POST');
 const item=await call('/inventory/items',{name:'Testpakking '+suffix,sku:'TEST-'+suffix,unit:'stuk',minimum:2},'POST');
 const movement={operationId:randomUUID(),itemId:item.id,locationId:location.id,type:'receipt',quantity:5};
 await call('/inventory/movements',movement,'POST');await call('/inventory/movements',movement,'POST');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6I0sAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.set('taskId',task.id);form.set('operationId',randomUUID());form.set('phase','before');form.set('file',new Blob([png],{type:'image/png'}),'voor.png');
 const response=await fetch(url+'/api/attachments',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});const attachment=await response.json();assert.ok(response.ok,JSON.stringify(attachment));
 const rule=await call('/recurrences',{title:'Hersteltest onderhoud '+suffix,config:{frequency:'yearly',startDate:new Date().toISOString().slice(0,10)},taskTemplate:{locationId:location.id}},'POST');
 await call('/recurrences/generate',{},'POST');await call('/recurrences/generate',{},'POST');
 const occurrences=await call('/recurrences/'+rule.id+'/occurrences');assert.equal(occurrences.length,1);
 await writeFile(file,JSON.stringify({taskId:task.id,locationId:location.id,itemId:item.id,attachmentId:attachment.id,photoHash:createHash('sha256').update(png).digest('hex'),ruleId:rule.id,title:task.title},null,2));
 console.log('Seed accepted: task, photo, idempotent stock receipt and recurrence.');
}else{
 const expected=JSON.parse(await readFile(file,'utf8'));
 const task=await call('/tasks/'+expected.taskId);assert.equal(task.title,expected.title);assert.equal(task.locationId,expected.locationId);
 const balances=await call('/inventory/balances?itemId='+expected.itemId);assert.equal(Number(balances.find(b=>b.locationId===expected.locationId).quantity),5);
 const photo=await fetch(url+'/api/attachments/'+expected.attachmentId+'/file',{headers:{Authorization:'Bearer '+token}});assert.ok(photo.ok);assert.equal(createHash('sha256').update(Buffer.from(await photo.arrayBuffer())).digest('hex'),expected.photoHash);
 await call('/recurrences/generate',{},'POST');assert.equal((await call('/recurrences/'+expected.ruleId+'/occurrences')).length,1);
 console.log('Verified: task and stable links, exact photo SHA-256, stock=5, recurrence still unique.');
}
