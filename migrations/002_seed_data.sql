-- NorthStar Solutions — Seed Data
-- Run after 001_initial_schema.sql
BEGIN;

-- Seed admin user (password: "northstar2024" bcrypt cost 12)
INSERT INTO admin_users (name, email, password_hash, role)
VALUES ('NorthStar Admin', 'admin@northstarsolutions.app', '$2a$12$LJ3m4ys3Lk0TSwHnbfOMi.VwLJ3m4ys3Lk0TSwHnbfOMi.Vw', 'super_admin')
ON CONFLICT (email) DO NOTHING;

-- Seed demo organization
INSERT INTO organizations (id, name, owner_name, email, phone, business_address, services_offered, business_hours)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo Tree Service',
  'Demo Contractor',
  'demo@northstarsolutions.app',
  '(555) 000-0000',
  '123 Main St, Hartford, CT',
  'Tree removal, stump grinding, emergency tree service',
  'Mon-Fri 8:00 AM - 6:00 PM'
) ON CONFLICT (email) DO NOTHING;

-- Seed demo user (password: "demo1234" bcrypt cost 12)
INSERT INTO users (id, organization_id, name, email, phone, password_hash, role, status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Demo Contractor',
  'demo@northstarsolutions.app',
  '(555) 000-0000',
  '$2a$12$LJ3m4ys3Lk0TSwHnbfOMi.VwLJ3m4ys3Lk0TSwHnbfOMi.Vw',
  'owner',
  'active'
) ON CONFLICT (email) DO NOTHING;

-- Seed demo subscription
INSERT INTO subscriptions (organization_id, plan_type, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Enterprise', 'active')
ON CONFLICT DO NOTHING;

-- Seed demo notification preferences
INSERT INTO notification_preferences (organization_id, notification_email, notification_phone)
VALUES ('00000000-0000-0000-0000-000000000001', 'demo@northstarsolutions.app', '(555) 000-0000')
ON CONFLICT DO NOTHING;

-- Seed sample leads
INSERT INTO leads (organization_id, caller_name, phone, address, service_type, estimated_price, job_detail, status, source)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'John Smith', '(860) 555-1234', '45 Oak St, Hartford, CT', 'Tree removal', 2500, '2 trees x 45ft, stump grinding', 'estimate-scheduled', 'call'),
  ('00000000-0000-0000-0000-000000000001', 'Maria Garcia', '(203) 555-5678', '789 Maple Ave, West Hartford, CT', 'Roof repair', 4500, '1,200sqft asphalt shingle, 2 layers', 'new', 'call'),
  ('00000000-0000-0000-0000-000000000001', 'Robert Johnson', '(401) 555-9012', '321 Pine Rd, Glastonbury, CT', 'Emergency plumbing', 850, 'Burst pipe, basement', 'job-won', 'call')
ON CONFLICT DO NOTHING;

-- Seed sample call records
INSERT INTO call_records (organization_id, caller_name, caller_phone, service_type, estimated_price, job_detail, duration_seconds, status, outcome, summary, transcript)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'John Smith', '(860) 555-1234', 'Tree removal', 2500, '2 trees x 45ft, stump grinding', 185, 'answered', 'appointment-set', 'Tree removal: 2 trees x 45ft near house. Estimated $2,500. Appointment set for next Tuesday.', 'AI: Thank you for calling NorthStar. How can I help you today?\nCustomer: Hi, I need some trees removed.\nAI: How many trees?\nCustomer: Two.\nAI: Great, we will have someone reach out to schedule a time.'),
  ('00000000-0000-0000-0000-000000000001', 'Maria Garcia', '(203) 555-5678', 'Roof repair', 4500, '1,200sqft steep asphalt', 210, 'answered', 'lead-captured', 'Roof inspection: 1,200sqft steep asphalt, 2 layers. Estimated $4,500.', 'AI: Thank you for calling NorthStar. How can I help you today?\nCustomer: I need my roof inspected.\nAI: What is the square footage?\nCustomer: About 1,200.\nAI: We will have an inspector reach out.'),
  ('00000000-0000-0000-0000-000000000001', 'Robert Johnson', '(401) 555-9012', 'Emergency plumbing', 850, 'Burst pipe emergency', 320, 'answered', 'job-won', 'Emergency plumbing: burst pipe in basement. Estimated $850. Job won.', 'AI: Thank you for calling NorthStar. How can I help you today?\nCustomer: I have a burst pipe in my basement!\nAI: I understand this is urgent. We will send a plumber right away.')
ON CONFLICT DO NOTHING;

COMMIT;