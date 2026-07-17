-- NorthStar Solutions — Voice Sessions Table
-- Migration 003: Voice call session tracking for M17 voice system

BEGIN;

-- ============================================================
-- Voice Sessions
-- Tracks real-time voice call sessions from Retell AI.
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id VARCHAR(255) UNIQUE NOT NULL,
    session_status VARCHAR(50) DEFAULT 'active',  -- 'active', 'completed', 'failed', 'transferred'
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    from_number VARCHAR(50) DEFAULT '',
    to_number VARCHAR(50) DEFAULT '',
    direction VARCHAR(20) DEFAULT 'inbound',  -- 'inbound', 'outbound'
    duration_ms INTEGER DEFAULT 0,
    sentiment VARCHAR(20) DEFAULT 'neutral',  -- 'positive', 'neutral', 'negative', 'frustrated', 'urgent'
    key_topics JSONB DEFAULT '[]',
    action_items JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    transcript TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    retell_analysis JSONB DEFAULT '{}',
    recording_url VARCHAR(500) DEFAULT '',
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_call_id ON voice_sessions(call_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_org_id ON voice_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_lead_id ON voice_sessions(lead_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_status ON voice_sessions(session_status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_from_number ON voice_sessions(from_number);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_started_at ON voice_sessions(started_at DESC);

-- ============================================================
-- Voice Session Events
-- Individual events within a voice session for detailed tracing.
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_session_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES voice_sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB DEFAULT '{}',
    intelligence_response JSONB DEFAULT '{}',
    emitted_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_events_session_id ON voice_session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_voice_events_type ON voice_session_events(event_type, emitted_at DESC);

COMMIT;
