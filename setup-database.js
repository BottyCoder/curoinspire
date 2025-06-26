
const { Client } = require('pg');

async function setupDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('🔗 Connected to Replit PostgreSQL database');

    // Enable pgcrypto extension for UUID generation
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    console.log('✅ pgcrypto extension enabled');

    // Create billing_log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_log (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_guid  TEXT NOT NULL,
        date         DATE DEFAULT CURRENT_DATE,
        total_messages INTEGER DEFAULT 0,
        total_cost   NUMERIC DEFAULT 0.00
      );
    `);
    console.log('✅ billing_log table created');

    // Create billing_records table
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_records (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mobile_number     VARCHAR NOT NULL,
        whatsapp_message_id TEXT,
        message_timestamp TIMESTAMPTZ DEFAULT now(),
        session_start_time TIMESTAMPTZ NOT NULL,
        cost_utility      NUMERIC DEFAULT 0.0076,
        cost_carrier      NUMERIC DEFAULT 0.01,
        cost_mau          NUMERIC DEFAULT 0.06,
        total_cost        NUMERIC,
        is_mau_charged    BOOLEAN DEFAULT false,
        created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        message_month     DATE,
        message_day       DATE
      );
    `);
    console.log('✅ billing_records table created');

    // Create billing_sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_sessions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mobile_number   VARCHAR NOT NULL,
        session_start   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        session_end     TIMESTAMPTZ,
        is_active       BOOLEAN DEFAULT true,
        created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ billing_sessions table created');

    // Create curoch_customers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS curoch_customers (
        guid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mobile_number  VARCHAR UNIQUE NOT NULL,
        customer_name  TEXT,
        created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ curoch_customers table created');

    // Create curoch_appointments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS curoch_appointments (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        guid           UUID,
        appointment_date TIMESTAMPTZ,
        status         VARCHAR DEFAULT 'scheduled',
        notes          TEXT,
        created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ curoch_appointments table created');

    // Create messages_log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages_log (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id       UUID,
        original_wamid   TEXT,
        tracking_code    TEXT UNIQUE,
        client_guid      TEXT,
        mobile_number    VARCHAR NOT NULL,
        customer_name    TEXT,
        message          TEXT,
        customer_response TEXT,
        channel          VARCHAR DEFAULT 'whatsapp',
        status           VARCHAR DEFAULT 'sent',
        timestamp        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        reply_timestamp  TIMESTAMPTZ,
        delivered_at     TIMESTAMPTZ,
        read_at          TIMESTAMPTZ,
        failed_at        TIMESTAMPTZ,
        error_message    TEXT
      );
    `);
    console.log('✅ messages_log table created');

    // Add foreign key constraints
    await client.query(`
      ALTER TABLE curoch_appointments 
      DROP CONSTRAINT IF EXISTS curo_appt_customer_fk;
      
      ALTER TABLE curoch_appointments
      ADD CONSTRAINT curo_appt_customer_fk
      FOREIGN KEY (guid) REFERENCES curoch_customers(guid);
    `);
    console.log('✅ curoch_appointments foreign key added');

    await client.query(`
      ALTER TABLE messages_log 
      DROP CONSTRAINT IF EXISTS messages_log_session_fk;
      
      ALTER TABLE messages_log
      ADD CONSTRAINT messages_log_session_fk
      FOREIGN KEY (session_id) REFERENCES billing_sessions(id);
    `);
    console.log('✅ messages_log foreign key added');

    // Create useful indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_billing_records_mobile ON billing_records(mobile_number);
      CREATE INDEX IF NOT EXISTS idx_billing_records_timestamp ON billing_records(message_timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_log_mobile ON messages_log(mobile_number);
      CREATE INDEX IF NOT EXISTS idx_messages_log_tracking ON messages_log(tracking_code);
      CREATE INDEX IF NOT EXISTS idx_messages_log_timestamp ON messages_log(timestamp);
    `);
    console.log('✅ Database indexes created');

    console.log('🎉 Database setup complete! All tables created successfully.');
    
  } catch (error) {
    console.error('❌ Database setup error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

setupDatabase().catch(console.error);
