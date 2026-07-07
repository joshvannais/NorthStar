-- NorthStar Solutions — Initial Schema (V3-28 Database Architecture)
-- Migration 001: Core tables, auth, organizations, leads, calls, billing

BEGIN;

-- ============================================================
-- 1. Organizations (the contractor's business)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_name VARCHAR(255) DEFAULT '',
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) DEFAULT '',
    business_address TEXT DEFAULT '',
    website VARCHAR(500) DEFAULT '',
    service_area TEXT DEFAULT '',
    services_offered TEXT DEFAULT '',
    business_hours TEXT DEFAULT '',
    emergency_phone VARCHAR(50) DEFAULT '',
    logo_url VARCHAR(500) DEFAULT '',
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 2. Users (contractor accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(50) DEFAULT '',
    role VARCHAR(50) DEFAULT 'owner',  -- 'owner', 'admin', 'dispatcher', 'tech'
    status VARCHAR(50) DEFAULT 'active',  -- 'active', 'suspended', 'disabled'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);

-- ============================================================
-- 3. Subscriptions / Billing
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    plan_type VARCHAR(50) DEFAULT 'Trial',  -- 'Trial', 'Starter', 'Professional', 'Enterprise'
    status VARCHAR(50) DEFAULT 'trial',      -- 'trial', 'active', 'past_due', 'canceled', 'expired'
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    trial_ends TIMESTAMP DEFAULT NOW() + INTERVAL '14 days',
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    canceled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org_id ON subscriptions(organization_id);

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'paid', 'failed', 'refunded'
    stripe_invoice_id VARCHAR(255),
    period_start TIMESTAMP,
    period_end TIMESTAMP,
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices(organization_id);

-- ============================================================
-- 4. Phone Numbers
-- ============================================================
CREATE TABLE IF NOT EXISTS phone_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) UNIQUE NOT NULL,
    twilio_sid VARCHAR(255),
    status VARCHAR(50) DEFAULT 'available',  -- 'available', 'assigned', 'suspended', 'released'
    forwarding_number VARCHAR(50) DEFAULT '',
    assigned_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_org_id ON phone_numbers(organization_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_status ON phone_numbers(status);

-- ============================================================
-- 5. Leads
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    caller_name VARCHAR(255) DEFAULT '',
    phone VARCHAR(50) DEFAULT '',
    phone_e164 VARCHAR(50) DEFAULT '',
    address TEXT DEFAULT '',
    service_type VARCHAR(255) DEFAULT '',
    preferred_time VARCHAR(100) DEFAULT '',
    estimated_price DECIMAL(10,2) DEFAULT 0,
    job_detail TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'new',  -- 'new', 'contacted', 'estimate-scheduled', 'estimate-completed', 'job-won', 'job-lost', 'work-completed'
    source VARCHAR(50) DEFAULT 'call',  -- 'call', 'web', 'referral', 'manual'
    notes TEXT DEFAULT '',
    assigned_to UUID REFERENCES users(id),
    called_back_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_org_id ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_org_created ON leads(organization_id, created_at DESC);

-- ============================================================
-- 6. Call Records
-- ============================================================
CREATE TABLE IF NOT EXISTS call_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    caller_name VARCHAR(255) DEFAULT '',
    caller_phone VARCHAR(50) DEFAULT '',
    caller_phone_e164 VARCHAR(50) DEFAULT '',
    service_type VARCHAR(255) DEFAULT '',
    estimated_price DECIMAL(10,2) DEFAULT 0,
    job_detail TEXT DEFAULT '',
    duration_seconds INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'answered',  -- 'answered', 'missed', 'voicemail'
    outcome VARCHAR(50) DEFAULT 'lead-captured',  -- 'appointment-set', 'lead-captured', 'follow-up', 'voicemail', 'no-interest'
    twilio_call_sid VARCHAR(255),
    retell_call_id VARCHAR(255),
    summary TEXT DEFAULT '',
    transcript TEXT DEFAULT '',
    recording_url VARCHAR(500) DEFAULT '',
    is_known_contact BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_org_id ON call_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_calls_org_created ON call_records(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_twilio_sid ON call_records(twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_phone_e164 ON call_records(caller_phone_e164);

-- ============================================================
-- 7. CRM Contacts (known contact cache)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) DEFAULT '',
    phone VARCHAR(50) DEFAULT '',
    phone_e164 VARCHAR(50) DEFAULT '',
    email VARCHAR(255) DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_known BOOLEAN DEFAULT FALSE,
    last_contacted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_org_id ON crm_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_phone_e164 ON crm_contacts(organization_id, phone_e164);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_phone_partial ON crm_contacts(organization_id, phone);

-- ============================================================
-- 8. Auth & Security
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address VARCHAR(45) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, attempted_at);

-- ============================================================
-- 9. Admin Users
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 10. Integrations
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,  -- 'jobber', 'hcp', 'google_calendar', 'outlook'
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_org_provider ON integration_credentials(organization_id, provider);

-- ============================================================
-- 11. AI Settings & Configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    retell_agent_id VARCHAR(255) DEFAULT '',
    voice_id VARCHAR(100) DEFAULT 'default',
    greeting_message TEXT DEFAULT 'Thank you for calling. How can I help you today?',
    after_hours_message TEXT DEFAULT 'Our business hours are {{hours}}. Please leave a message and we will get back to you.',
    knowledge_base TEXT DEFAULT '',
    transfer_on_known BOOLEAN DEFAULT FALSE,
    emergency_routing_phone VARCHAR(50) DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 12. Notification Preferences
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    email_new_lead BOOLEAN DEFAULT TRUE,
    email_call_summary BOOLEAN DEFAULT TRUE,
    email_appointment BOOLEAN DEFAULT TRUE,
    sms_new_lead BOOLEAN DEFAULT FALSE,
    sms_urgent BOOLEAN DEFAULT TRUE,
    notification_email VARCHAR(255) DEFAULT '',
    notification_phone VARCHAR(50) DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 13. Analytics & Logging
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    calls_answered INTEGER DEFAULT 0,
    calls_missed INTEGER DEFAULT 0,
    leads_captured INTEGER DEFAULT 0,
    appointments_booked INTEGER DEFAULT 0,
    estimated_revenue DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(organization_id, date)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) DEFAULT '',
    entity_id VARCHAR(50) DEFAULT '',
    details JSONB DEFAULT '{}',
    ip_address VARCHAR(45) DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id, created_at DESC);

-- ============================================================
-- 14. Background Jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue VARCHAR(50) NOT NULL DEFAULT 'default',
    job_type VARCHAR(100) NOT NULL,
    payload JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'
    run_at TIMESTAMP DEFAULT NOW(),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue, status, run_at);

-- ============================================================
-- 15. Webhooks
-- ============================================================
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    secret VARCHAR(255) DEFAULT '',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
    event VARCHAR(100) NOT NULL,
    payload JSONB DEFAULT '{}',
    response_status INTEGER,
    response_body TEXT,
    success BOOLEAN DEFAULT FALSE,
    attempted_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 16. Notification Deliveries
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL,  -- 'email', 'sms'
    event_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(500) DEFAULT '',
    body TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'sent',  -- 'sent', 'delivered', 'failed', 'bounced'
    provider_message_id VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

COMMIT;