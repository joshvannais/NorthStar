'use strict';
const {Worker}=require('node:worker_threads');
const path=require('node:path');
function extractPdf(bytes,{signal}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length>262144||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))return Promise.reject(new Error('The PDF is outside the supported document limits.'));
  if(!signal)return Promise.reject(new Error('A document deadline is required.'));
  if(signal.aborted)return Promise.reject(new Error('Source retrieval was interrupted.'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'taxPdfWorker.mjs'),{workerData:bytes,env:{},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4},stdout:true,stderr:true});
    // Never expose parser diagnostics or document text through application logs.
    worker.stdout.resume();worker.stderr.resume();
    let settling=false;
    const finish=async(error,result)=>{if(settling)return;settling=true;signal.removeEventListener('abort',abort);
      try{await worker.terminate();}catch(_){error=new Error('Document cleanup failed.');}
      if(signal.aborted)error=new Error('Source retrieval was interrupted.');
      error?reject(error):resolve(result);
    };
    const abort=()=>finish(new Error('Source retrieval was interrupted.'));
    signal.addEventListener('abort',abort,{once:true});
    worker.once('message',value=>{
      if(value?.error||typeof value?.text!=='string'||!value.text.trim()||Buffer.byteLength(value.text)>32768||!Number.isInteger(value.pages)||value.pages<1||value.pages>8||typeof value.extractionVersion!=='string')return finish(new Error('This PDF could not be read within the supported document limits.'));
      finish(null,value);
    });
    worker.once('error',()=>finish(new Error('The document reader is unavailable.')));
    worker.once('exit',()=>{if(!settling)finish(new Error('Document reading did not finish.'));});
    if(signal.aborted)abort();
  });
}
module.exports={extractPdf};
