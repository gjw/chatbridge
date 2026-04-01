CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Platform users
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,  -- bcrypt hashed
    role        TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Chat conversations
CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Chat messages
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         JSONB NOT NULL,  -- Matches Chatbox contentParts structure
    model           TEXT,
    token_usage     JSONB,           -- {input, output, cached}
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Registered third-party apps
CREATE TABLE apps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,       -- url-safe identifier
    manifest    JSONB NOT NULL,             -- Full app manifest
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'blocked')),
    trust_tier  TEXT NOT NULL
                CHECK (trust_tier IN ('internal', 'external_public', 'external_auth')),
    created_by  UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Per-user app installations
CREATE TABLE app_installations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id      UUID REFERENCES apps(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(app_id, user_id)
);

-- Tool invocation audit log
CREATE TABLE tool_invocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID REFERENCES messages(id),
    app_id          UUID REFERENCES apps(id),
    user_id         UUID REFERENCES users(id),
    tool_name       TEXT NOT NULL,
    parameters      JSONB,
    result          JSONB,
    status          TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error', 'timeout')),
    duration_ms     INT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- OAuth tokens (server-side custody)
CREATE TABLE oauth_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    app_id          UUID REFERENCES apps(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    access_token    TEXT NOT NULL,   -- encrypted at rest (pgcrypto)
    refresh_token   TEXT,            -- encrypted at rest
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, app_id, provider)
);

-- Conversation summaries for Loop C (meta-agent)
CREATE TABLE conversation_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    summary         TEXT NOT NULL,         -- LLM-generated structured summary
    topics          TEXT[] DEFAULT '{}',   -- Extracted topic tags
    apps_used       TEXT[] DEFAULT '{}',   -- App slugs used in this conversation
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_invocations_user ON tool_invocations(user_id, created_at);
CREATE INDEX idx_apps_status ON apps(status);
CREATE INDEX idx_summaries_user ON conversation_summaries(user_id, created_at);
