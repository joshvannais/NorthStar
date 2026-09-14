'use strict';
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
function invalid(){throw new Error('The reviewed document text is unavailable. Review the source before using it.');}
// Source-controlled, independently reviewed evidence only. This never parses or
// decompresses a PDF. Page count is a review declaration, not a runtime finding.
function validateReviewedExtraction(value){
 const keys=['version','rawBytes','rawDocumentDigest','text','textDigest','pages','reviewedBy','reviewedOn','sourceExtractionVersion'];
 if(!value||Object.keys(value).sort().join('|')!==keys.sort().join('|')||value.version!=='reviewed-pinned-text-v1'||
  !Number.isInteger(value.rawBytes)||value.rawBytes<5||value.rawBytes>262144||!/^[a-f0-9]{64}$/.test(value.rawDocumentDigest)||
  typeof value.text!=='string'||!value.text.trim()||Buffer.byteLength(value.text)>32768||value.textDigest!==hash(value.text)||
  !Number.isInteger(value.pages)||value.pages<1||value.pages>8||typeof value.reviewedBy!=='string'||!value.reviewedBy.trim()||value.reviewedBy.length>200||
  typeof value.sourceExtractionVersion!=='string'||!value.sourceExtractionVersion.trim()||value.sourceExtractionVersion.length>200||
  typeof value.reviewedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedOn)||!Number.isFinite(Date.parse(value.reviewedOn))||new Date(value.reviewedOn).toISOString().slice(0,10)!==value.reviewedOn)invalid();
 return value;
}
function matchReviewedPdf(bytes,artifact,{signal}={}){
 if(!signal||signal.aborted)throw new Error('Source retrieval was interrupted.');
 const reviewed=validateReviewedExtraction(artifact);
 if(!Buffer.isBuffer(bytes)||bytes.length!==reviewed.rawBytes||bytes.length>262144||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||hash(bytes)!==reviewed.rawDocumentDigest)
  throw new Error('Source document changed. Review its contents before using it.');
 return {text:reviewed.text,pages:reviewed.pages,extractionVersion:'reviewed-pinned-text-v1'};
}
module.exports={validateReviewedExtraction,matchReviewedPdf};
