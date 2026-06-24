require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumn() {
  console.log("Checking shops table for trial_extension_days...");
  const { data, error } = await supabase
    .from('shops')
    .select('id, trial_extension_days')
    .limit(1);

  if (error) {
    console.error("Column check failed:", error);
    if (error.message.includes('column') || error.code === '42703') {
      console.log("\n-> ACTION REQUIRED: You must run this SQL in your Supabase SQL Editor:");
      console.log("ALTER TABLE shops ADD COLUMN IF NOT EXISTS trial_extension_days INT DEFAULT 0;\n");
    }
  } else {
    console.log("SUCCESS: trial_extension_days column is present in Supabase! Data sample:", data);
  }
}

checkColumn();
