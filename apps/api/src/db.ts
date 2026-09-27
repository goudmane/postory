import pg from 'pg'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      email text NOT NULL, label text NOT NULL,
      imap_host text NOT NULL, imap_port integer NOT NULL, imap_secure boolean NOT NULL,
      smtp_host text NOT NULL, smtp_port integer NOT NULL, smtp_secure boolean NOT NULL,
      username text NOT NULL, credential jsonb NOT NULL,
      sent_path text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mail_accounts_owner ON mail_accounts(user_id);
    CREATE TABLE IF NOT EXISTS drafts (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      recipient text NOT NULL DEFAULT '', subject text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '',
      revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS send_intents (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      draft_id uuid REFERENCES drafts(id) ON DELETE SET NULL,
      message_id text NOT NULL, recipient text NOT NULL, subject text NOT NULL,
      status text NOT NULL, detail text, mime_blob jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS send_intents_owner_time ON send_intents(user_id, created_at DESC);
    ALTER TABLE send_intents ADD COLUMN IF NOT EXISTS mime_blob jsonb;
    CREATE UNIQUE INDEX IF NOT EXISTS send_intents_draft_once ON send_intents(draft_id) WHERE draft_id IS NOT NULL;
  `)
}
