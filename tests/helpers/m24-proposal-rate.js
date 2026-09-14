'use strict';
function transform(recipe,unit){
 const component=recipe.components.find(c=>c.kind==='pricing'),row=component.inputs.lines[0];
 Object.assign(row,{kind:'unit',quantity:'100',unit:'ft',rate:'1',amount:null});
 recipe.steps.push({id:'priceRate',op:'constant',unit,args:[],fieldId:null,value:'5'});
 component.bindings=[{line:0,field:'rate',step:'priceRate'}];
}
function transformKnowledge(knowledge,unit){
 const document=JSON.parse(knowledge.canonical_document);transform(document.content.estimateProposalRecipe,unit);
 const built=require('../../src/knowledge/contract').buildCanonicalKnowledgeDocument(document);
 Object.assign(knowledge,{canonical_document:built.canonicalDocument,canonical_digest:built.canonicalDigest,publication_digest:built.canonicalDigest});
}
module.exports={transform,transformKnowledge};
