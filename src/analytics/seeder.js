/**
 * Server-side data seeder — populates demo data for new accounts.
 * Creates 15-30 realistic records spanning 30 days.
 */

const { addLead } = require('../leads/store');
const db = require('../db');

const SERVICE_NAMES = ['Tree removal','Roof inspection/replacement','Emergency plumbing','Electrical panel upgrade','Landscape design','HVAC repair','Gutter cleaning','Pest control','Concrete driveway','Fence installation','Window replacement','Carpet cleaning','Pressure washing','Interior painting','Drywall repair','Flooring installation','Garage door service','Solar panel installation','Deck building/repair','Pool service/repair','Appliance repair','Siding installation','Chimney service','Foundation repair','Mold remediation','Well pump service','Septic system service','Generator installation','Bathroom remodeling','Insulation'];
const FIRST_NAMES = ['James','Sarah','Mike','Emily','David','Jessica','Chris','Amanda','Ryan','Ashley','John','Lauren','Matt','Rachel','Kevin','Stephanie','Tom','Michelle','Dan','Megan'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin'];
const STREETS = ['Oak St','Maple Ave','Pine Rd','Cedar Ln','Elm St','Birch Dr','Walnut Way','Cherry Blvd','Spruce Ct','Ash Ave'];
const CITIES = ['Springfield','Riverside','Fairview','Madison','Georgetown','Burlington','Centerville','Franklin','Clinton','Highland'];
const OUTCOMES = ['appointment-set','lead-captured','follow-up','voicemail','no-interest'];
const OUTCOME_WEIGHTS = [0.25, 0.30, 0.15, 0.20, 0.10];

function pickWeighted(arr, weights) {
  const r = Math.random(); let cumulative = 0;
  for (let i = 0; i < arr.length; i++) { cumulative += weights[i]; if (r <= cumulative) return arr[i]; }
  return arr[arr.length - 1];
}
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randPhone() { return `(${rand(200,999)}) ${rand(200,999)}-${rand(1000,9999)}`; }

function genPrice(service) {
  const ranges = {'Tree removal':[300,2500],'Roof':[500,8000],'Plumbing':[150,2000],'Electrical':[200,4000],'Landscape':[500,5000],'HVAC':[300,5000],'Gutter':[100,600],'Pest':[100,800],'Concrete':[800,6000],'Fence':[500,4000],'Window':[500,5000],'Carpet':[100,700],'Pressure':[150,800],'Painting':[300,3000],'Drywall':[200,1500],'Flooring':[500,5000],'Garage':[150,1200],'Solar':[5000,25000],'Deck':[2000,10000],'Pool':[200,1500],'Appliance':[100,800],'Siding':[2000,10000],'Chimney':[200,1500],'Foundation':[2000,15000],'Mold':[500,5000],'Well':[1000,7000],'Septic':[500,4000],'Generator':[3000,12000],'Bathroom':[3000,15000],'Insulation':[500,3000]};
  for (const [k, [mn, mx]] of Object.entries(ranges)) { if (service.includes(k) || k.includes(service.split(' ')[0])) return rand(mn, mx); }
  return rand(200, 500);
}

function randDate(daysAgo) { const d = new Date(); d.setDate(d.getDate() - rand(0, daysAgo)); d.setHours(rand(7, 18), rand(0, 59)); return d.toISOString(); }

function genTranscript(service, name) {
  return `AI: NorthStar Solutions, this is your AI receptionist. How can I help?\nCustomer: I need help with ${service}.\nAI: I can definitely help you with that. May I have your name?\nCustomer: ${name}.\nAI: What's your address?\nCustomer: ${rand(100,9999)} ${STREETS[rand(0,STREETS.length-1)]}, ${CITIES[rand(0,CITIES.length-1)]}.\nAI: Great, I have you down for ${service}. We'll have an estimator contact you shortly. Thank you!\nCustomer: Thanks!`;
}

async function seedDemoData(userId, organizationId) {
  if (!organizationId) throw new Error('Validated organization context is required');
  if (!db.isAvailable()) throw new Error('Required persistence is unavailable');
  await db.query('SELECT 1');
  const numRecords = rand(15, 30);
  const seeded = [];
  for (let i = 0; i < numRecords; i++) {
    const firstName = FIRST_NAMES[rand(0, FIRST_NAMES.length - 1)];
    const lastName = LAST_NAMES[rand(0, LAST_NAMES.length - 1)];
    const name = `${firstName} ${lastName}`;
    const service = SERVICE_NAMES[rand(0, SERVICE_NAMES.length - 1)];
    const outcome = pickWeighted(OUTCOMES, OUTCOME_WEIGHTS);
    const price = genPrice(service);
    const receivedAt = randDate(30);
    const lead = addLead({
      customerName: name, phoneNumber: randPhone(),
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
      address: `${rand(100,9999)} ${STREETS[rand(0,STREETS.length-1)]}, ${CITIES[rand(0,CITIES.length-1)]}`,
      serviceRequested: service, preferredTime: ['Morning','Afternoon','Anytime'][rand(0,2)],
      notes: `Demo call about ${service}`, callOutcome: outcome, estimatedPrice: price,
      source: 'phone_call', receivedAt, transcript: genTranscript(service, name),
      summary: `Customer called about ${service}. Estimated value: $${price.toLocaleString()}. Outcome: ${outcome}.`,
      ownerUserId: userId,
      organizationId: organizationId,
    });
    await db.query(
      'INSERT INTO call_records (organization_id, caller_name, service_type, estimated_price, outcome, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [organizationId, name, service, price, outcome, 'demo', receivedAt]
    );
    seeded.push(lead);
  }
  console.log(`[Seeder] Seeded ${seeded.length} demo records for organization ${organizationId}`);
  return seeded;
}

module.exports = { seedDemoData, SERVICE_NAMES, FIRST_NAMES, LAST_NAMES };
