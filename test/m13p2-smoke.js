const store = require('../src/polaris/store');
const customer = require('../src/polaris/customer-engine');
var pass=0,fail=0;
function c(l,cond){if(cond){pass++;}else{fail++;console.log('FAIL:',l);}}

var initResult = customer.init();
c('init returns object', typeof initResult === 'object');
c('init has loaded count', typeof initResult.loaded === 'number');

var cr = customer.createCustomer({name:'Alice',email:'alice@test.com',phone:'555-0001'});
c('create returns id', !!cr.id);
var id = cr.id;

var g = customer.getCustomer(id);
c('get returns name', g.name === 'Alice');

var u = customer.updateCustomer(id, {phone:'555-0002'});
c('update returns changed', u.updated.indexOf('phone') !== -1);
var g2 = customer.getCustomer(id);
c('update applied', g2.phone === '555-0002');

var n = customer.addCustomerNote(id, {text:'Test note', author:'test'});
c('note added', !!n.id);
c('note has text', n.text === 'Test note');
var rn = customer.removeCustomerNote(id, n.id);
c('note removed', rn.removed === true);

var tl = customer.getCustomerTimeline(id);
c('timeline has entries', Array.isArray(tl.entries));

var h = customer.calculateCustomerHealth(id);
c('health is number', typeof h.healthScore === 'number');
c('health in range', h.healthScore >= 0 && h.healthScore <= 100);

var s = customer.updateCustomerStatus(id, 'inactive');
c('status changed', s.status === 'inactive');

var a = customer.archiveCustomer(id);
c('archived', a.status === 'archived');
var rs = customer.restoreCustomer(id);
c('restored', rs.status === 'active');

var lst = customer.listCustomers();
c('list returns array', Array.isArray(lst.customers));
c('list has Alice', lst.customers.some(function(x){return x.name==='Alice';}));
var sr = customer.searchCustomers('Alice');
c('search finds Alice', sr.total >= 1);

var m = customer.updateCustomerMetrics(id, {jobsIncrement:1, revenueIncrement:500});
c('metrics jobs', m.totalJobs === 1);
c('metrics revenue', m.totalRevenue === 500);

var statuses = customer.getCustomerStatuses();
c('4 statuses', statuses.length === 4);

c('create without name', customer.createCustomer({}).error !== undefined);
c('get nonexistent', customer.getCustomer('nonexistent').error !== undefined);
c('invalid status', customer.updateCustomerStatus(id, 'bogus').error !== undefined);

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');