'use strict';

const { createHash } = require('crypto');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = 'tax-source-candidate-v1';
const FIELDS = ['country', 'region', 'locality', 'jurisdiction', 'serviceKey', 'classification'];
const hash = value => createHash('sha256').update(value).digest('hex');
function invalid(message) { throw Object.assign(new Error(message), { code: 'TAX_SOURCE_INVALID' }); }
function day(value) {
  if (typeof value !== 'string' || !DAY.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid('A valid source date is required.');
  return value;
}
function publicContext(input) {
  const result = {};
  for (const field of FIELDS) {
    const value = input?.[field];
    if (typeof value !== 'string' || value.length > 300 || /[\u0000-\u001f]/.test(value)) invalid('The tax coverage context is incomplete.');
    result[field] = value.trim();
  }
  // Deliberately excludes registrations, exemption documents, street addresses,
  // names, rates and all additional properties, including model instructions.
  return Object.freeze(result);
}
function approvedUrl(value, allowedOrigins) {
  let url; try { url = new URL(value); } catch (_) { invalid('A supported source address is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !allowedOrigins.has(url.origin)) invalid('This source is outside the reviewed public source list.');
  return url.href;
}
function createTaxSourceAcquisition({ transport, allowedOrigins, clock = () => new Date() }) {
  // The application does not discover/follow arbitrary URLs. A reviewed adapter
  // owns source access, licenses, redirect checks and maximum download size.
  if (!transport || typeof transport.acquire !== 'function' || !(allowedOrigins instanceof Set) || !allowedOrigins.size) throw new TypeError('Tax acquisition requires a reviewed source transport.');
  return async function acquire(input, { signal } = {}) {
    const context = publicContext(input);
    if (!context.country || !context.region || !context.serviceKey) return { version: VERSION, state: 'unsupported', context, candidates: [] };
    const results = await transport.acquire(context, { signal });
    if (!Array.isArray(results) || results.length > 8) invalid('The source response exceeds the review limit.');
    const fetchedOn = day(clock().toISOString().slice(0, 10));
    const candidates = results.map(source => {
      if (!source || typeof source.content !== 'string' || !source.content || Buffer.byteLength(source.content, 'utf8') > 32768 ||
          Object.hasOwn(source, 'validation') || Object.hasOwn(source, 'validated') || Object.hasOwn(source, 'rate')) invalid('Source acquisition cannot validate or set a tax rate.');
      const effectiveOn = source.effectiveOn === null ? null : day(source.effectiveOn);
      const endsOn = source.endsOn === null ? null : day(source.endsOn);
      if (effectiveOn && endsOn && endsOn < effectiveOn) invalid('Source dates conflict.');
      if (typeof source.coverage !== 'string' || source.coverage.length > 2000 || typeof source.exclusions !== 'string' || source.exclusions.length > 2000) invalid('Source coverage needs review.');
      let document;
      if(Object.hasOwn(source,'document')){
        const d=source.document;
        if(!d||Object.keys(d).sort().join('|')!==['version','contentType','finalUrl','rawBytes','rawDocumentDigest','extractedTextDigest','pages','extractionVersion'].sort().join('|')||d.version!=='tax-document-provenance-v1'||d.contentType!=='application/pdf'||d.finalUrl!==source.url||!Number.isInteger(d.rawBytes)||d.rawBytes<5||d.rawBytes>262144||!Number.isInteger(d.pages)||d.pages<1||d.pages>8||!/^[a-f0-9]{64}$/.test(d.rawDocumentDigest)||d.extractedTextDigest!==hash(source.content)||d.extractionVersion!=='pdfjs-dist@6.3.289/text-v1')invalid('Document source evidence needs review.');
        document={...d};
      }
      return { version: VERSION, state: 'candidate', context,
        url: approvedUrl(source.url, allowedOrigins), contentDigest: hash(source.content), fetchedOn,
        effectiveOn, endsOn, coverage: source.coverage, exclusions: source.exclusions,
        excerpt: source.content, reviewRequired: true,...(document?{document}:{}) };
    });
    const result = { version: VERSION, state: candidates.length ? 'candidate' : 'unsupported', context, candidates };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 60000) invalid('The combined source evidence exceeds the review limit.');
    return result;
  };
}

module.exports = { VERSION, publicContext, createTaxSourceAcquisition, approvedUrl };
