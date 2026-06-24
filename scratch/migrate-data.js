require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Missing Supabase credentials in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const dbPath = path.join(__dirname, '../db.json');

async function runMigration() {
  if (!fs.existsSync(dbPath)) {
    console.error(`ERROR: db.json file not found at path: ${dbPath}`);
    process.exit(1);
  }

  console.log('Reading db.json file...');
  const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  // 1. Migrate Global Settings
  console.log('Migrating global settings...');
  if (dbData.settings) {
    const s = dbData.settings;
    const { error: setErr } = await supabase
      .from('global_settings')
      .upsert({
        id: 1,
        payment_qr: s.paymentQr || null,
        payment_instructions: s.paymentInstructions || 'Scan the GCash QR code below to settle your platform subscription fee.',
        subscription_method: s.subscriptionMethod || 'onetime_daily',
        system_developer_fee: s.systemDeveloperFee !== undefined ? s.systemDeveloperFee : (s.onetimeSetupFee !== undefined ? s.onetimeSetupFee : 5000),
        daily_fee: s.dailyFee !== undefined ? s.dailyFee : 50,
        monthly_fee: s.monthlyFee !== undefined ? s.monthlyFee : 1500,
        per_stamp_fee: s.perStampFee !== undefined ? s.perStampFee : 1,
        per_stamp_developer_fee: s.perStampDeveloperFee !== undefined ? s.perStampDeveloperFee : 3000
      });

    if (setErr) {
      console.error('Error inserting global settings:', setErr.message);
    } else {
      console.log('Global settings migrated successfully.');
    }
  }

  // 2. Migrate Shops
  console.log('Migrating shops...');
  if (dbData.shops) {
    for (const shopId in dbData.shops) {
      const shop = dbData.shops[shopId];
      const cleanSlug = shopId.toLowerCase();
      console.log(`- Shop: ${shop.name} (${cleanSlug})`);

      // Insert/Upsert Shop row
      const { error: shopErr } = await supabase
        .from('shops')
        .upsert({
          id: cleanSlug,
          name: shop.name || 'Unnamed Shop',
          rule: shop.rule || '',
          logo: shop.logo || null,
          points_per_purchase: shop.pointsPerPurchase !== undefined ? shop.pointsPerPurchase : 1,
          owner_username: shop.ownerUsername || 'admin',
          owner_password: shop.ownerPassword || 'admin',
          created_at: shop.createdAt || new Date().toISOString(),
          total_paid: shop.totalPaid || 0,
          is_suspended: shop.isSuspended || false,
          subscription_method: shop.subscriptionMethod || 'onetime_daily',
          subscription_start_date: shop.subscriptionStartDate || null
        });

      if (shopErr) {
        console.error(`  Error migrating shop ${cleanSlug}:`, shopErr.message);
        continue;
      }

      // Migrate shop rewards catalog
      if (shop.rewards && Array.isArray(shop.rewards)) {
        for (const r of shop.rewards) {
          const { error: rErr } = await supabase
            .from('shop_rewards')
            .upsert({
              id: r.id,
              shop_id: cleanSlug,
              points_required: r.pointsRequired !== undefined ? r.pointsRequired : 10,
              reward_text: r.rewardText || '',
              is_active: r.isActive || false
            });
          if (rErr) console.error(`  Error inserting reward ${r.id}:`, rErr.message);
        }
      }

      // Migrate shop specials list
      if (shop.specials && Array.isArray(shop.specials)) {
        for (const spec of shop.specials) {
          if (!spec) continue;
          const { error: sErr } = await supabase
            .from('shop_specials')
            .insert({
              shop_id: cleanSlug,
              special_text: spec
            });
          if (sErr) console.error(`  Error inserting special text:`, sErr.message);
        }
      }

      // Migrate shop payments
      if (shop.payments && Array.isArray(shop.payments)) {
        for (const p of shop.payments) {
          const { error: pErr } = await supabase
            .from('shop_payments')
            .upsert({
              id: p.id,
              shop_id: cleanSlug,
              amount: p.amount || 0,
              reference_number: p.referenceNumber || '',
              receipt_image: p.receiptImage || null,
              timestamp: p.timestamp || new Date().toISOString(),
              status: p.status || 'pending',
              verified_at: p.verifiedAt || null
            });
          if (pErr) console.error(`  Error inserting payment ${p.id}:`, pErr.message);
        }
      }
    }
  }

  // 3. Migrate Customers & Redemptions
  console.log('Migrating customers...');
  if (dbData.customers) {
    for (const customerId in dbData.customers) {
      const c = dbData.customers[customerId];
      const cleanShopId = c.shopId ? c.shopId.toLowerCase() : '';
      console.log(`- Customer: ${c.name} (${c.id})`);

      // Verify that the shop actually exists in Supabase
      const { data: matchedShop } = await supabase
        .from('shops')
        .select('id')
        .eq('id', cleanShopId)
        .maybeSingle();

      if (!matchedShop) {
        console.warn(`  Warning: Shop "${cleanShopId}" not found for customer "${c.id}". Skipping customer.`);
        continue;
      }

      // Insert customer
      const { error: custErr } = await supabase
        .from('customers')
        .upsert({
          id: c.id,
          shop_id: cleanShopId,
          phone: c.phone || '',
          name: c.name || '',
          points: c.points !== undefined ? c.points : 0,
          created_at: c.createdAt || new Date().toISOString(),
          pending_redeem_code: c.pendingRedeem ? c.pendingRedeem.code : null,
          pending_redeem_points_required: c.pendingRedeem ? c.pendingRedeem.pointsRequired : null,
          pending_redeem_created_at: c.pendingRedeem ? c.pendingRedeem.createdAt : null
        });

      if (custErr) {
        console.error(`  Error inserting customer ${c.id}:`, custErr.message);
        continue;
      }

      // Migrate customer redemption history
      if (c.redemptions && Array.isArray(c.redemptions)) {
        for (const red of c.redemptions) {
          const { error: redErr } = await supabase
            .from('customer_redemptions')
            .insert({
              customer_id: c.id,
              code: red.code || '',
              points_redeemed: red.pointsRedeemed || 0,
              redeemed_at: red.redeemedAt || new Date().toISOString()
            });
          if (redErr) console.error(`  Error inserting redemption log for ${c.id}:`, redErr.message);
        }
      }
    }
  }

  // 4. Migrate Payment Notifications
  console.log('Migrating payment notifications...');
  if (dbData.notifications && Array.isArray(dbData.notifications)) {
    for (const notif of dbData.notifications) {
      const { error: nErr } = await supabase
        .from('payment_notifications')
        .upsert({
          id: notif.id,
          shop_slug: notif.shopSlug || '',
          shop_name: notif.shopName || '',
          amount: notif.amount || 0,
          timestamp: notif.timestamp || new Date().toISOString(),
          read: notif.read || false
        });
      if (nErr) console.error(`  Error inserting notification ${notif.id}:`, nErr.message);
    }
  }

  console.log('--- Migration Finished! ---');
}

runMigration().catch(err => {
  console.error('Migration crashed:', err);
  process.exit(1);
});
