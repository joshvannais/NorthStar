'use strict';
const express = require('express');
const db = require('../db');
const { requireTenantAccess, requireAccountMutation } = require('../auth/middleware');
const { actorInput } = require('../scheduling/operatorDirectory');
const repository = require('../workforce/workProfileRepository');
const { invalid } = require('../workforce/workProfileContract');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw invalid(); return value.toLowerCase(); }
function createWorkProfileRouter() {
  const router = express.Router();
  router.use(requireTenantAccess, (req,res,next) => { res.set('Cache-Control','no-store, private'); next(); });
  const handle = operation => async (req,res) => {
    try { return res.json({ success:true,data:await operation(req),requestId:req.requestId || 'unavailable' }); }
    catch (error) {
      const status = error && [400,403,404,409,503].includes(error.status) ? error.status : 503;
      return res.status(status).json({ success:false,error:{ code:error && error.status === status ? error.code : 'WORK_PROFILE_UNAVAILABLE',
        message:error && error.status === status ? error.message : 'Work profiles are temporarily unavailable.' },requestId:req.requestId || 'unavailable' });
    }
  };
  const input = req => ({ ...actorInput(req),csrfToken:req.headers['x-csrf-token'] });
  const read = req => {
    if (Object.keys(req.query).some(key => key !== 'historyOffset')) throw invalid();
    if (req.query.historyOffset !== undefined && (typeof req.query.historyOffset !== 'string' || !/^[0-9]+$/.test(req.query.historyOffset))) throw invalid();
    const offset = req.query.historyOffset === undefined ? 0 : Number(req.query.historyOffset);
    if (!Number.isInteger(offset) || offset<0 || offset>1000000) throw invalid();
    return repository.readProfile(db.getPool(),input(req),req.params.profileId ? uuid(req.params.profileId) : null,offset);
  };
  router.get('/me',handle(read));
  router.get('/reviews',handle(req => {
    if (Object.keys(req.query).some(key => key !== 'after')) throw invalid();
    return repository.directory(db.getPool(),input(req),req.query.after === undefined ? null : uuid(req.query.after));
  }));
  router.get('/reviews/:profileId',handle(read));
  const write = req => {
    if (Object.keys(req.query).length) throw invalid();
    const target = req.params.profileId ? uuid(req.params.profileId) : null;
    if ((!target && !['submit','availability'].includes(req.body && req.body.action)) ||
      (target && !['approve','reject','revoke'].includes(req.body && req.body.action))) throw invalid();
    return repository.mutate(db.getPool(),input(req),target,uuid(req.headers['idempotency-key']),req.body);
  };
  router.post('/me',requireAccountMutation,handle(write));
  router.post('/reviews/:profileId',requireAccountMutation,handle(write));
  return router;
}
module.exports = { createWorkProfileRouter };
