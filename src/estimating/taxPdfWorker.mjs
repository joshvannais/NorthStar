import {parentPort,workerData} from 'node:worker_threads';
// Data-only parser: no viewer, rendering, scripting, OCR or external font/CMap URLs.
globalThis.fetch = undefined;
let task;
try {
  const {getDocument,version}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  task=getDocument({data:new Uint8Array(workerData),isEvalSupported:false,enableScripting:false,
    useWorkerFetch:false,useSystemFonts:false,disableFontFace:true,isOffscreenCanvasSupported:false,
    isImageDecoderSupported:false,useWasm:false,stopAtErrors:true});
  task.onPassword=()=>task.destroy();
  const doc=await task.promise;
  const metadata=await doc.getMetadata();
  if(metadata.info?.EncryptFilterName||doc.numPages<1||doc.numPages>8)throw new Error('unsupported');
  const actions=await doc.getJSActions();
  if(actions&&Object.keys(actions).length)throw new Error('unsupported');
  let text='',bytes=0;
  for(let number=1;number<=doc.numPages;number++){
    const page=await doc.getPage(number),reader=page.streamTextContent().getReader();
    try{
      for(;;){const part=await reader.read();if(part.done)break;
        for(const item of part.value.items){if(typeof item.str!=='string')continue;
          const value=item.str+(item.hasEOL?'\n':' ');bytes+=Buffer.byteLength(value,'utf8');
          if(bytes>32768)throw new Error('size');text+=value;
        }
      }
      bytes++;if(bytes>32768)throw new Error('size');text+='\n';
    }finally{await reader.cancel().catch(()=>{});page.cleanup();}
  }
  if(!text.trim())throw new Error('empty');
  parentPort.postMessage({text,pages:doc.numPages,extractionVersion:'pdfjs-dist@'+version+'/text-v1'});
}catch(_){parentPort.postMessage({error:'This PDF could not be read within the supported document limits.'});}
finally{await task?.destroy().catch(()=>{});}
