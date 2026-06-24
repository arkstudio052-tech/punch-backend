require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const cleanSlug = `debug-shop-test-unique`;
  
  // Try inserting reward-default
  const { data, error } = await supabase
    .from('shop_rewards')
    .insert({
      id: 'reward-default',
      shop_id: 'kaya', // existing shop
      points_required: 10,
      reward_text: 'test',
      is_active: true
    });

  if (error) {
    console.log('Error caught:', error.message);
  } else {
    console.log('Success, inserted duplicate!');
  }
}

test().catch(console.error);
