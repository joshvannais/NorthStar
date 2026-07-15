const store = require('../src/polaris/store');
const comms = require('../src/polaris/communications-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

// 1. Init
var initResult = comms.init();
c('init returns object', typeof initResult === 'object');
c('init has loaded count', typeof initResult.loaded === 'number');

// 2. Record a communication
var r = comms.recordCommunication({
  customerId: 'cust_test_1',
  type: 'call',
  direction: 'inbound',
  channel: 'phone',
  subject: 'HVAC service inquiry',
  content: 'Customer called about AC not cooling',
  status: 'completed',
  author: 'John (Agent)',
  duration: 420,
});
c('record returns id', !!r.id);
c('record returns type', r.type === 'call');
c('record returns direction', r.direction === 'inbound');
c('record returns status', r.status === 'completed');
var commId = r.id;

// 3. Get single communication
var g = comms.getCommunication(commId);
c('get returns subject', g.subject === 'HVAC service inquiry');
c('get returns content', g.content.indexOf('AC not cooling') !== -1);
c('get returns duration', g.duration === 420);
c('get returns immutable copy', g.id === commId);

// 4. Record more communications
comms.recordCommunication({
  customerId: 'cust_test_1',
  type: 'sms',
  direction: 'outbound',
  channel: 'twilio',
  subject: 'Follow-up',
  content: 'Sent appointment confirmation',
  status: 'completed',
  author: 'System',
});

comms.recordCommunication({
  customerId: 'cust_test_1',
  type: 'email',
  direction: 'outbound',
  channel: 'sendgrid',
  subject: 'Quote estimate',
  content: 'Sent detailed quote for HVAC repair',
  status: 'completed',
  author: 'System',
});

comms.recordCommunication({
  customerId: 'cust_test_1',
  type: 'call',
  direction: 'outbound',
  channel: 'phone',
  subject: 'Missed call',
  content: 'Attempted follow-up, no answer',
  status: 'missed',
  author: 'John (Agent)',
  duration: 30,
});

comms.recordCommunication({
  customerId: 'cust_test_2',
  type: 'call',
  direction: 'inbound',
  channel: 'phone',
  subject: 'New customer',
  content: 'First contact from new lead',
  status: 'pending',
  author: 'Sarah (Agent)',
  duration: 180,
});

// 5. List communications by customer
var list = comms.getCommunications('cust_test_1');
c('list returns array', Array.isArray(list.communications));
c('list has 4 comms', list.total === 4);

// 6. Filter by type
var calls = comms.getCommunications('cust_test_1', { type: 'call' });
c('filter by type', calls.total === 2);

// 7. Filter by direction
var inbound = comms.getCommunications('cust_test_1', { direction: 'inbound' });
c('filter by direction', inbound.total === 1);

// 8. Filter by status
var missed = comms.getCommunications('cust_test_1', { status: 'missed' });
c('filter by status', missed.total === 1);

// 9. Filter by date range
var recent = comms.getCommunications('cust_test_1', { dateFrom: new Date(Date.now() - 86400000).toISOString() });
c('filter by date range', recent.total === 4);

// 10. Search
var search = comms.searchCommunications('HVAC');
c('search finds HVAC', search.total >= 1);

var search2 = comms.searchCommunications('follow-up');
c('search finds follow-up', search2.total >= 1);

// 11. Timeline
var tl = comms.getTimeline('cust_test_1');
c('timeline has entries', Array.isArray(tl.entries));
c('timeline total', tl.total === 4);

// 12. Last contact
var lc = comms.getLastContact('cust_test_1');
c('last contact has customerId', lc.customerId === 'cust_test_1');
c('last contact has daysSince', typeof lc.daysSince === 'number');
c('last contact has type', lc.type !== undefined);

// 13. Last contact with no history
var lc2 = comms.getLastContact('cust_nonexistent');
c('last contact with no history', lc2.lastContactAt === null);

// 14. Frequency
var freq = comms.getCommunicationFrequency('cust_test_1', 30);
c('frequency has total', freq.totalCommunications === 4);
c('frequency has average per day', typeof freq.averagePerDay === 'number');
c('frequency has byType', typeof freq.byType === 'object');
c('frequency has call count', freq.byType.call === 2);

// 15. Engagement score
var es = comms.getEngagementScore('cust_test_1');
c('engagement score is number', typeof es.engagementScore === 'number');
c('engagement score in range', es.engagementScore >= 0 && es.engagementScore <= 100);
c('engagement has label', typeof es.engagementLabel === 'string');
c('engagement has factors', typeof es.factors === 'object');

// 16. Engagement score with no history
var es2 = comms.getEngagementScore('cust_nonexistent');
c('no-history engagement is number', typeof es2.engagementScore === 'number');

// 17. Follow-up recommendations
var fr = comms.getFollowUpRecommendations('cust_test_1');
c('follow-up has recommendations array', Array.isArray(fr.recommendations));
c('follow-up has reasons', Array.isArray(fr.reasons));

// 18. Follow-up for no-contact customer
var fr2 = comms.getFollowUpRecommendations('cust_nonexistent');
c('no-contact follow-up recommends init', fr2.recommendations.length >= 1);

// 19. Outstanding conversations
var oc = comms.getOutstandingConversations();
c('outstanding has array', Array.isArray(oc.communications));
c('outstanding has missed or pending', oc.total >= 2);

// 20. Update communication status
var us = comms.updateCommunicationStatus(commId, 'resolved');
c('update status returns resolved', us.status === 'resolved');
var g2 = comms.getCommunication(commId);
c('status persisted', g2.status === 'resolved');

// 21. Type definitions
var types = comms.getCommunicationTypes();
c('7 types', types.length === 7);

var statuses = comms.getCommunicationStatuses();
c('5 statuses', statuses.length === 5);

// 22. Error cases
c('record without customerId', comms.recordCommunication({}).error !== undefined);
c('record without type', comms.recordCommunication({customerId:'x'}).error !== undefined);
c('get nonexistent', comms.getCommunication('nonexistent').error !== undefined);
c('invalid type', comms.recordCommunication({customerId:'x', type:'invalid'}).error !== undefined);
c('invalid status', comms.recordCommunication({customerId:'x', type:'call', status:'invalid'}).error !== undefined);
c('update nonexistent status', comms.updateCommunicationStatus('nonexistent', 'completed').error !== undefined);

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');