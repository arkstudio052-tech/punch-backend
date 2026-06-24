const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('CRITICAL: Supabase credentials are missing in env configuration.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Formatting helpers
function formatDateShort(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function getBillingCycles(startDateStr, now) {
  const startDate = new Date(startDateStr);
  const cycles = [];
  
  let currentStart = new Date(startDate);
  while (true) {
    let nextStart = new Date(currentStart);
    nextStart.setMonth(nextStart.getMonth() + 1);
    
    if (nextStart > now) {
      break;
    }
    
    cycles.push({
      start: new Date(currentStart),
      end: new Date(nextStart),
      soaDate: new Date(nextStart),
      dueDate: new Date(nextStart.getTime() + 10 * 24 * 60 * 60 * 1000)
    });
    
    currentStart = nextStart;
  }
  
  let ongoingEnd = new Date(currentStart);
  ongoingEnd.setMonth(ongoingEnd.getMonth() + 1);
  const ongoing = {
    start: new Date(currentStart),
    end: ongoingEnd,
    soaDate: ongoingEnd,
    dueDate: new Date(ongoingEnd.getTime() + 10 * 24 * 60 * 60 * 1000)
  };
  
  return { completed: cycles, ongoing };
}

// Aggregation DB query helpers for stamps
async function countStampsInPeriod(start, end, shopId) {
  const cleanShopId = shopId.toLowerCase();
  let stamps = 0;
  
  // 1. Sum of points from customers registered during the period
  const { data: newCustomers, error: custErr } = await supabase
    .from('customers')
    .select('points')
    .eq('shop_id', cleanShopId)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());
    
  if (custErr) {
    console.error('Error fetching new customers for stamps count:', custErr);
  } else if (newCustomers) {
    newCustomers.forEach(c => {
      stamps += c.points || 0;
    });
  }

  // 2. Sum of pointsRedeemed in redemptions during the period
  const { data: redemptions, error: redErr } = await supabase
    .from('customer_redemptions')
    .select('points_redeemed, customers!inner(shop_id)')
    .eq('customers.shop_id', cleanShopId)
    .gte('redeemed_at', start.toISOString())
    .lt('redeemed_at', end.toISOString());

  if (redErr) {
    console.error('Error fetching redemptions for stamps count:', redErr);
  } else if (redemptions) {
    redemptions.forEach(r => {
      stamps += r.points_redeemed || 0;
    });
  }
  
  return stamps;
}

async function countTotalStamps(shopId) {
  const cleanShopId = shopId.toLowerCase();
  let stamps = 0;
  
  // 1. Total points of all current customers
  const { data: customers, error: custErr } = await supabase
    .from('customers')
    .select('points')
    .eq('shop_id', cleanShopId);
    
  if (custErr) {
    console.error('Error fetching customers for total stamps:', custErr);
  } else if (customers) {
    customers.forEach(c => {
      stamps += c.points || 0;
    });
  }

  // 2. Total redeemed points
  const { data: redemptions, error: redErr } = await supabase
    .from('customer_redemptions')
    .select('points_redeemed, customers!inner(shop_id)')
    .eq('customers.shop_id', cleanShopId);

  if (redErr) {
    console.error('Error fetching redemptions for total stamps:', redErr);
  } else if (redemptions) {
    redemptions.forEach(r => {
      stamps += r.points_redeemed || 0;
    });
  }
  
  return stamps;
}

// App data mapping helpers
function mapShopRowToApp(row, rewards = [], specials = [], payments = []) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    rule: row.rule,
    logo: row.logo,
    pointsPerPurchase: row.points_per_purchase,
    ownerUsername: row.owner_username,
    ownerPassword: row.owner_password,
    createdAt: row.created_at,
    totalPaid: row.total_paid ? parseFloat(row.total_paid) : 0,
    isSuspended: row.is_suspended,
    subscriptionMethod: row.subscription_method,
    subscriptionStartDate: row.subscription_start_date,
    trialExtensionDays: row.trial_extension_days || 0,
    rewards: (rewards || []).map(r => ({
      id: r.id,
      pointsRequired: r.points_required,
      rewardText: r.reward_text,
      isActive: r.is_active
    })),
    specials: (specials || []).map(s => s.special_text),
    payments: (payments || []).map(p => ({
      id: p.id,
      amount: p.amount ? parseFloat(p.amount) : 0,
      referenceNumber: p.reference_number,
      receiptImage: p.receipt_image,
      timestamp: p.timestamp,
      status: p.status,
      verifiedAt: p.verified_at
    }))
  };
}

function mapCustomerRowToApp(row, redemptions = []) {
  if (!row) return null;
  let pendingRedeem = null;
  if (row.pending_redeem_code) {
    pendingRedeem = {
      code: row.pending_redeem_code,
      pointsRequired: row.pending_redeem_points_required,
      createdAt: row.pending_redeem_created_at
    };
  }
  return {
    id: row.id,
    shopId: row.shop_id,
    phone: row.phone,
    name: row.name,
    points: row.points || 0,
    createdAt: row.created_at,
    pendingRedeem,
    redemptions: (redemptions || []).map(r => ({
      code: r.code,
      pointsRedeemed: r.points_redeemed,
      redeemedAt: r.redeemed_at
    }))
  };
}

function mapSettingsRowToApp(row) {
  if (!row) return {};
  return {
    paymentQr: row.payment_qr,
    paymentInstructions: row.payment_instructions,
    subscriptionMethod: row.subscription_method,
    systemDeveloperFee: row.system_developer_fee ? parseFloat(row.system_developer_fee) : 5000,
    onetimeSetupFee: row.system_developer_fee ? parseFloat(row.system_developer_fee) : 5000,
    dailyFee: row.daily_fee ? parseFloat(row.daily_fee) : 50,
    monthlyFee: row.monthly_fee ? parseFloat(row.monthly_fee) : 1250,
    monthlyPlanMonths: row.monthly_plan_months ? parseInt(row.monthly_plan_months) : 3,
    perStampFee: row.per_stamp_fee ? parseFloat(row.per_stamp_fee) : 1,
    perStampDeveloperFee: row.per_stamp_developer_fee ? parseFloat(row.per_stamp_developer_fee) : 3000,
    promotionalImages: (() => {
      if (!row.promotional_images) {
        return [
          { id: 'default1', url: '/images/punch_cover_photo.png', active: true },
          { id: 'default2', url: '/images/punch_cover_banner.png', active: true }
        ];
      }
      try {
        return JSON.parse(row.promotional_images);
      } catch (e) {
        console.error('Error parsing promotional_images:', e);
        return [
          { id: 'default1', url: '/images/punch_cover_photo.png', active: true },
          { id: 'default2', url: '/images/punch_cover_banner.png', active: true }
        ];
      }
    })()
  };
}

function mapNotificationRowToApp(row) {
  if (!row) return null;
  return {
    id: row.id,
    shopSlug: row.shop_slug,
    shopName: row.shop_name,
    amount: row.amount ? parseFloat(row.amount) : 0,
    timestamp: row.timestamp,
    read: row.read
  };
}

module.exports = {
  // Shops Methods
  async getShop(slug) {
    const cleanSlug = slug.toLowerCase();
    
    // Get shop base record
    const { data: shopRow, error: shopErr } = await supabase
      .from('shops')
      .select('*')
      .eq('id', cleanSlug)
      .maybeSingle();

    if (shopErr || !shopRow) return null;

    // Fetch related tables
    const { data: rewards } = await supabase
      .from('shop_rewards')
      .select('*')
      .eq('shop_id', cleanSlug);

    const { data: specials } = await supabase
      .from('shop_specials')
      .select('*')
      .eq('shop_id', cleanSlug);

    const { data: payments } = await supabase
      .from('shop_payments')
      .select('*')
      .eq('shop_id', cleanSlug);

    const shop = mapShopRowToApp(shopRow, rewards, specials, payments);

    // Compute dynamic isSuspended flag
    shop.isSuspended = await this.isShopSuspended(shop);

    return shop;
  },

  async isShopSuspended(shop) {
    if (shop.isSuspended === true) {
      return true; // Manually suspended by admin
    }
    
    // Auto-suspend if trial expired and has outstanding balance
    const createdTime = shop.createdAt ? new Date(shop.createdAt).getTime() : Date.now();
    const msActive = Date.now() - createdTime;
    const daysActive = Math.ceil(msActive / (1000 * 60 * 60 * 24));
    
    const trialDays = 7 + (shop.trialExtensionDays || 0);
    if (daysActive > trialDays) {
      const settings = await this.getGlobalSettings();
      const summary = await this.computeBilling(shop, settings);
      if (summary.outstandingBalance > 0) {
        if (shop.subscriptionStartDate) {
          return !!summary.isOverdue;
        }
        return true;
      }
    }
    
    return false;
  },

  async getAllShops() {
    const { data: shopsList, error } = await supabase
      .from('shops')
      .select('id, name, logo, rule');
      
    if (error || !shopsList) return [];
    
    return shopsList.map(shop => ({
      id: shop.id,
      name: shop.name,
      logo: shop.logo,
      rule: shop.rule || ''
    }));
  },

  async createShop(name, slug, rule, ownerUsername, ownerPassword) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '');
    
    // Check if shop slug already exists
    const { data: existingShop } = await supabase
      .from('shops')
      .select('id')
      .eq('id', cleanSlug)
      .maybeSingle();

    if (existingShop) {
      throw new Error(`Shop with slug "${cleanSlug}" already exists.`);
    }
    
    const inputRule = rule.trim() || '10 stamps = 1 free coffee';
    const pointsRequired = parseInt(inputRule.match(/\d+/)?.[0]) || 10;
    const rewardText = inputRule.replace(/^\d+\s*(stamps|points)?\s*=\s*/i, '').trim() || '1 free coffee';

    // Insert shop row
    const { error: insertErr } = await supabase
      .from('shops')
      .insert({
        id: cleanSlug,
        name: name.trim(),
        rule: inputRule,
        logo: null,
        points_per_purchase: 1,
        owner_username: ownerUsername ? ownerUsername.trim() : 'admin',
        owner_password: ownerPassword ? ownerPassword.trim() : 'admin',
        created_at: new Date().toISOString(),
        total_paid: 0,
        is_suspended: false
      });

    if (insertErr) throw new Error(insertErr.message);

    // Create default reward entry
    const rewardId = 'reward-default';
    await supabase
      .from('shop_rewards')
      .insert({
        id: rewardId,
        shop_id: cleanSlug,
        points_required: pointsRequired,
        reward_text: rewardText,
        is_active: true
      });

    // Create default specials
    await supabase
      .from('shop_specials')
      .insert([
        {
          shop_id: cleanSlug,
          special_text: `Welcome to ${name.trim()}! Track your loyalty points here.`
        },
        {
          shop_id: cleanSlug,
          special_text: "Ask our staff about today's special promotion!"
        }
      ]);

    return this.getShop(cleanSlug);
  },

  async updateShopSpecials(slug, specials) {
    const cleanSlug = slug.toLowerCase();
    
    // Clear existing specials
    const { error: delErr } = await supabase
      .from('shop_specials')
      .delete()
      .eq('shop_id', cleanSlug);

    if (delErr) throw new Error(delErr.message);

    // Insert new specials list
    const newSpecials = Array.isArray(specials) 
      ? specials.map(s => String(s).trim()).filter(Boolean)
      : [];

    if (newSpecials.length > 0) {
      const inserts = newSpecials.map(txt => ({
        shop_id: cleanSlug,
        special_text: txt
      }));
      const { error: insErr } = await supabase
        .from('shop_specials')
        .insert(inserts);

      if (insErr) throw new Error(insErr.message);
    }
    
    return this.getShop(cleanSlug);
  },

  async updateShopLogo(slug, logoDataUrl) {
    const cleanSlug = slug.toLowerCase();
    const { error } = await supabase
      .from('shops')
      .update({ logo: logoDataUrl })
      .eq('id', cleanSlug);

    if (error) throw new Error(error.message);
    return this.getShop(cleanSlug);
  },

  async addShopReward(slug, pointsRequired, rewardText) {
    const cleanSlug = slug.toLowerCase();
    const rewardId = `reward-${Date.now()}`;
    
    const { error } = await supabase
      .from('shop_rewards')
      .insert({
        id: rewardId,
        shop_id: cleanSlug,
        points_required: parseInt(pointsRequired) || 10,
        reward_text: rewardText.trim(),
        is_active: false
      });

    if (error) throw new Error(error.message);
    return this.getShop(cleanSlug);
  },

  async activateShopReward(slug, rewardId) {
    const cleanSlug = slug.toLowerCase();
    
    // Find reward points required and reward text first
    const { data: targetReward, error: fetchErr } = await supabase
      .from('shop_rewards')
      .select('*')
      .eq('shop_id', cleanSlug)
      .eq('id', rewardId)
      .maybeSingle();

    if (fetchErr || !targetReward) {
      throw new Error('Reward item not found.');
    }

    // Set all rewards of this shop to inactive
    await supabase
      .from('shop_rewards')
      .update({ is_active: false })
      .eq('shop_id', cleanSlug);

    // Activate the targeted reward
    await supabase
      .from('shop_rewards')
      .update({ is_active: true })
      .eq('shop_id', cleanSlug)
      .eq('id', rewardId);

    // Update the legacy rule string on the shops table
    const ruleString = `${targetReward.points_required} stamps = ${targetReward.reward_text}`;
    await supabase
      .from('shops')
      .update({ rule: ruleString })
      .eq('id', cleanSlug);

    return this.getShop(cleanSlug);
  },

  async deleteShopReward(slug, rewardId) {
    const cleanSlug = slug.toLowerCase();
    
    const { data: reward } = await supabase
      .from('shop_rewards')
      .select('*')
      .eq('shop_id', cleanSlug)
      .eq('id', rewardId)
      .maybeSingle();

    if (!reward) {
      throw new Error('Reward item not found.');
    }

    if (reward.is_active) {
      throw new Error('Cannot delete the currently active reward rules. Please activate another reward first.');
    }

    const { error } = await supabase
      .from('shop_rewards')
      .delete()
      .eq('shop_id', cleanSlug)
      .eq('id', rewardId);

    if (error) throw new Error(error.message);
    return this.getShop(cleanSlug);
  },

  async editShopReward(slug, rewardId, pointsRequired, rewardText) {
    const cleanSlug = slug.toLowerCase();
    
    const { data: reward, error: fetchErr } = await supabase
      .from('shop_rewards')
      .select('*')
      .eq('shop_id', cleanSlug)
      .eq('id', rewardId)
      .maybeSingle();

    if (fetchErr || !reward) {
      throw new Error('Reward item not found.');
    }

    const points = parseInt(pointsRequired) || 10;
    const txt = rewardText.trim();

    // Update reward item
    const { error: updErr } = await supabase
      .from('shop_rewards')
      .update({
        points_required: points,
        reward_text: txt
      })
      .eq('shop_id', cleanSlug)
      .eq('id', rewardId);

    if (updErr) throw new Error(updErr.message);

    // Sync legacy shop.rule if active
    if (reward.is_active) {
      const ruleString = `${points} stamps = ${txt}`;
      await supabase
        .from('shops')
        .update({ rule: ruleString })
        .eq('id', cleanSlug);
    }

    return this.getShop(cleanSlug);
  },

  // Customers Methods
  async getCustomer(id) {
    const { data: custRow, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !custRow) return null;

    // Fetch redemptions history
    const { data: redemptions } = await supabase
      .from('customer_redemptions')
      .select('*')
      .eq('customer_id', id)
      .order('redeemed_at', { ascending: false });

    return mapCustomerRowToApp(custRow, redemptions);
  },

  async getCustomersByShop(shopId) {
    const cleanShopId = shopId.toLowerCase();
    const { data: rows, error } = await supabase
      .from('customers')
      .select('*')
      .eq('shop_id', cleanShopId);

    if (error || !rows) return [];

    const customersList = [];
    for (const r of rows) {
      const { data: redemptions } = await supabase
        .from('customer_redemptions')
        .select('*')
        .eq('customer_id', r.id)
        .order('redeemed_at', { ascending: false });

      customersList.push(mapCustomerRowToApp(r, redemptions));
    }
    return customersList;
  },

  async authCustomer(shopId, phone, name) {
    const cleanShopId = shopId.toLowerCase();
    const cleanPhone = phone.trim().replace(/[^0-9+]/g, '');
    const customerId = `${cleanShopId}-${cleanPhone}`;

    // Verify shop exists
    const { data: shop } = await supabase
      .from('shops')
      .select('id')
      .eq('id', cleanShopId)
      .maybeSingle();

    if (!shop) {
      throw new Error(`Shop "${cleanShopId}" does not exist.`);
    }

    if (!cleanPhone) {
      throw new Error('Invalid phone number.');
    }

    // Get customer
    const customer = await this.getCustomer(customerId);
    
    if (customer) {
      if (name && name.trim()) {
        const { error: updErr } = await supabase
          .from('customers')
          .update({ name: name.trim() })
          .eq('id', customerId);
        if (updErr) throw new Error(updErr.message);
        customer.name = name.trim();
      }
      return { customer, isNew: false };
    }

    // Customer does not exist
    if (!name || !name.trim()) {
      return { customer: null, isNew: true };
    }

    // Create new customer with welcome bonus (1 point)
    const { error: insErr } = await supabase
      .from('customers')
      .insert({
        id: customerId,
        shop_id: cleanShopId,
        phone: cleanPhone,
        name: name.trim(),
        points: 1,
        created_at: new Date().toISOString()
      });

    if (insErr) throw new Error(insErr.message);

    const newCustomer = await this.getCustomer(customerId);
    return { customer: newCustomer, isNew: false };
  },

  async addCustomerPoint(customerId) {
    const customer = await this.getCustomer(customerId);
    if (!customer) {
      throw new Error('Customer not found.');
    }

    const newPoints = (customer.points || 0) + 1;
    const { error } = await supabase
      .from('customers')
      .update({ points: newPoints })
      .eq('id', customerId);

    if (error) throw new Error(error.message);
    customer.points = newPoints;
    return customer;
  },

  async createPendingRedeem(customerId, maxPoints) {
    const customer = await this.getCustomer(customerId);
    if (!customer) {
      throw new Error('Customer not found.');
    }
    if (customer.points < maxPoints) {
      throw new Error(`Insufficient points. Requires ${maxPoints} points to redeem.`);
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const timestamp = new Date().toISOString();

    const { error } = await supabase
      .from('customers')
      .update({
        pending_redeem_code: code,
        pending_redeem_points_required: maxPoints,
        pending_redeem_created_at: timestamp
      })
      .eq('id', customerId);

    if (error) throw new Error(error.message);
    
    customer.pendingRedeem = {
      code,
      pointsRequired: maxPoints,
      createdAt: timestamp
    };
    return customer;
  },

  async cancelPendingRedeem(customerId) {
    const { error } = await supabase
      .from('customers')
      .update({
        pending_redeem_code: null,
        pending_redeem_points_required: null,
        pending_redeem_created_at: null
      })
      .eq('id', customerId);

    if (error) throw new Error(error.message);
    return this.getCustomer(customerId);
  },

  async confirmRedemptionDirect(customerId, code) {
    const customer = await this.getCustomer(customerId);
    if (!customer) {
      throw new Error('Customer not found.');
    }
    if (!customer.pendingRedeem || customer.pendingRedeem.code !== code) {
      throw new Error('Invalid or expired redemption code.');
    }

    const pointsToRedeem = customer.pendingRedeem.pointsRequired;
    if (customer.points < pointsToRedeem) {
      throw new Error('Insufficient points balance.');
    }

    const newPoints = customer.points - pointsToRedeem;

    // Deduct points and clear code
    const { error: updErr } = await supabase
      .from('customers')
      .update({
        points: newPoints,
        pending_redeem_code: null,
        pending_redeem_points_required: null,
        pending_redeem_created_at: null
      })
      .eq('id', customerId);

    if (updErr) throw new Error(updErr.message);

    // Insert redemption log
    const { error: logErr } = await supabase
      .from('customer_redemptions')
      .insert({
        customer_id: customerId,
        code,
        points_redeemed: pointsToRedeem,
        redeemed_at: new Date().toISOString()
      });

    if (logErr) throw new Error(logErr.message);

    return this.getCustomer(customerId);
  },

  async confirmRedemptionByCode(shopId, code) {
    const cleanShopId = shopId.toLowerCase();
    
    // Find customer in this shop with active matching code
    const { data: customerRow, error: custErr } = await supabase
      .from('customers')
      .select('*')
      .eq('shop_id', cleanShopId)
      .eq('pending_redeem_code', code)
      .maybeSingle();

    if (custErr || !customerRow) {
      throw new Error(`No pending redemption found with code "${code}" at this shop.`);
    }

    const pointsToRedeem = customerRow.pending_redeem_points_required;
    const newPoints = customerRow.points - pointsToRedeem;

    // Deduct points and clear code
    await supabase
      .from('customers')
      .update({
        points: newPoints,
        pending_redeem_code: null,
        pending_redeem_points_required: null,
        pending_redeem_created_at: null
      })
      .eq('id', customerRow.id);

    // Record redemption
    await supabase
      .from('customer_redemptions')
      .insert({
        customer_id: customerRow.id,
        code,
        points_redeemed: pointsToRedeem,
        redeemed_at: new Date().toISOString()
      });

    return this.getCustomer(customerRow.id);
  },

  async getRedemptionsByShop(shopId) {
    const cleanShopId = shopId.toLowerCase();
    
    // Join redemptions on customers to filter by shop
    const { data: rows, error } = await supabase
      .from('customer_redemptions')
      .select('code, points_redeemed, redeemed_at, customers!inner(id, name, phone)')
      .eq('customers.shop_id', cleanShopId)
      .order('redeemed_at', { ascending: false });

    if (error || !rows) return [];

    return rows.map(r => ({
      customerId: r.customers.id,
      customerName: r.customers.name,
      customerPhone: r.customers.phone,
      code: r.code,
      pointsRedeemed: r.points_redeemed,
      redeemedAt: r.redeemed_at
    }));
  },

  async getGlobalProfile(phone) {
    const cleanPhone = phone.trim().replace(/[^0-9+]/g, '');
    const { data: customerRows, error: custErr } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', cleanPhone);

    if (custErr || !customerRows) return { name: '', phone: cleanPhone, memberships: [] };

    let name = '';
    const memberships = [];
    
    for (const row of customerRows) {
      if (row.name && !name) {
        name = row.name;
      }
      
      const { data: shopRow } = await supabase
        .from('shops')
        .select('name, logo, rule')
        .eq('id', row.shop_id)
        .maybeSingle();

      if (shopRow) {
        memberships.push({
          shopId: row.shop_id,
          shopName: shopRow.name,
          logo: shopRow.logo,
          points: row.points || 0,
          rule: shopRow.rule || '10 stamps = 1 free reward'
        });
      }
    }

    return {
      name: name || 'Loyalty Member',
      phone: cleanPhone,
      memberships
    };
  },

  async getAllShopsFull() {
    const { data: shopRows, error } = await supabase
      .from('shops')
      .select('*');

    if (error || !shopRows) return [];

    const fullShops = [];
    for (const row of shopRows) {
      const shop = mapShopRowToApp(row);
      shop.isSuspended = await this.isShopSuspended(shop);
      fullShops.push(shop);
    }
    return fullShops;
  },

  async suspendShop(slug, isSuspended) {
    const cleanSlug = slug.toLowerCase();
    const { error } = await supabase
      .from('shops')
      .update({ is_suspended: !!isSuspended })
      .eq('id', cleanSlug);

    if (error) throw new Error(error.message);
    return this.getShop(cleanSlug);
  },

  async updateShopSubscriptionMethod(slug, method) {
    const cleanSlug = slug.toLowerCase();
    const validMethods = ['onetime_daily', 'monthly', 'per_stamp'];
    if (!validMethods.includes(method)) {
      throw new Error(`Invalid subscription plan method: ${method}`);
    }

    const shop = await this.getShop(cleanSlug);
    const updates = { subscription_method: method };
    if (shop && shop.subscriptionMethod !== method) {
      updates.subscription_start_date = null;
    }

    const { error } = await supabase
      .from('shops')
      .update(updates)
      .eq('id', cleanSlug);

    if (error) throw new Error(error.message);
    return this.getShop(cleanSlug);
  },

  async deleteShop(slug) {
    const cleanSlug = slug.toLowerCase();
    const { error } = await supabase
      .from('shops')
      .delete()
      .eq('id', cleanSlug);

    if (error) throw new Error(error.message);
    return true;
  },

  async updateShopDetails(slug, { name, rule, ownerUsername, ownerPassword, trialExtensionDays }) {
    const cleanSlug = slug.toLowerCase();
    const updates = {};
    if (name) updates.name = name.trim();
    if (ownerUsername) updates.owner_username = ownerUsername.trim();
    if (ownerPassword) updates.owner_password = ownerPassword.trim();
    if (trialExtensionDays !== undefined) updates.trial_extension_days = parseInt(trialExtensionDays) || 0;
    
    if (rule) {
      updates.rule = rule.trim();
      const pointsRequired = parseInt(updates.rule.match(/\d+/)?.[0]) || 10;
      const rewardText = updates.rule.replace(/^\d+\s*(stamps|points)?\s*=\s*/i, '').trim() || '1 free item';
      
      const { data: rewards } = await supabase
        .from('shop_rewards')
        .select('*')
        .eq('shop_id', cleanSlug);

      if (rewards && rewards.length > 0) {
        const activeReward = rewards.find(r => r.is_active);
        if (activeReward) {
          await supabase
            .from('shop_rewards')
            .update({
              points_required: pointsRequired,
              reward_text: rewardText
            })
            .eq('id', activeReward.id);
        } else {
          await supabase
            .from('shop_rewards')
            .update({
              points_required: pointsRequired,
              reward_text: rewardText,
              is_active: true
            })
            .eq('id', rewards[0].id);
        }
      } else {
        await supabase
          .from('shop_rewards')
          .insert({
            id: 'reward-default',
            shop_id: cleanSlug,
            points_required: pointsRequired,
            reward_text: rewardText,
            is_active: true
          });
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('shops')
        .update(updates)
        .eq('id', cleanSlug);
      if (error) throw new Error(error.message);
    }

    return this.getShop(cleanSlug);
  },

  // Settings Methods
  async getGlobalSettings() {
    const { data: settingsRow, error } = await supabase
      .from('global_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error || !settingsRow) {
      // Fallback
      return mapSettingsRowToApp({
        id: 1,
        payment_instructions: 'Scan the GCash QR code below to settle your platform subscription fee.',
        subscription_method: 'onetime_daily'
      });
    }

    return mapSettingsRowToApp(settingsRow);
  },

  async updateGlobalSettings({ paymentQr, paymentInstructions, subscriptionMethod, systemDeveloperFee, dailyFee, monthlyFee, monthlyPlanMonths, perStampDeveloperFee, perStampFee, promotionalImages }) {
    const updates = {};
    if (paymentQr !== undefined) updates.payment_qr = paymentQr;
    if (paymentInstructions !== undefined) updates.payment_instructions = paymentInstructions;
    if (subscriptionMethod !== undefined) updates.subscription_method = subscriptionMethod;
    if (systemDeveloperFee !== undefined) updates.system_developer_fee = parseFloat(systemDeveloperFee) || 0;
    if (dailyFee !== undefined) updates.daily_fee = parseFloat(dailyFee) || 0;
    if (monthlyFee !== undefined) updates.monthly_fee = parseFloat(monthlyFee) || 0;
    if (monthlyPlanMonths !== undefined) updates.monthly_plan_months = parseInt(monthlyPlanMonths) || 3;
    if (perStampDeveloperFee !== undefined) updates.per_stamp_developer_fee = parseFloat(perStampDeveloperFee) || 0;
    if (perStampFee !== undefined) updates.per_stamp_fee = parseFloat(perStampFee) || 0;
    if (promotionalImages !== undefined) {
      updates.promotional_images = typeof promotionalImages === 'string' ? promotionalImages : JSON.stringify(promotionalImages);
    }

    const { error } = await supabase
      .from('global_settings')
      .update(updates)
      .eq('id', 1);

    if (error) {
      if (error.message.includes('column') || error.code === '42703') {
        const msg = error.message.toLowerCase();
        if (msg.includes('promotional_images')) {
          throw new Error("Database column 'promotional_images' is missing. Please run the following SQL command in your Supabase SQL Editor first:\n\nALTER TABLE global_settings ADD COLUMN IF NOT EXISTS promotional_images TEXT;");
        } else if (msg.includes('monthly_plan_months')) {
          throw new Error("Database column 'monthly_plan_months' is missing. Please run the following SQL command in your Supabase SQL Editor first:\n\nALTER TABLE global_settings ADD COLUMN IF NOT EXISTS monthly_plan_months INT DEFAULT 3;");
        }
        throw new Error("Database column configuration issue. Please ensure your schema matches the database requirements: " + error.message);
      }
      throw new Error(error.message);
    }
    return this.getGlobalSettings();
  },

  async computeBilling(shop, settings) {
    const method = shop.subscriptionMethod || settings.subscriptionMethod || 'onetime_daily';
    const now = new Date();
    
    // Sum only payments confirmed since the active subscription plan started (if applicable)
    let totalPaid = 0;
    if (shop.subscriptionStartDate) {
      const subStart = new Date(shop.subscriptionStartDate);
      const subStartMs = subStart.getTime() - 60000; // 1-minute tolerance
      if (shop.payments && shop.payments.length > 0) {
        shop.payments.forEach(p => {
          if (p.status === 'confirmed') {
            const verifiedTime = p.verifiedAt ? new Date(p.verifiedAt).getTime() : new Date(p.timestamp).getTime();
            if (verifiedTime >= subStartMs) {
              totalPaid += p.amount;
            }
          }
        });
      } else {
        totalPaid = shop.totalPaid || 0;
      }
    } else {
      if (shop.payments && shop.payments.length > 0) {
        shop.payments.forEach(p => {
          if (p.status === 'confirmed') totalPaid += p.amount;
        });
      } else {
        totalPaid = shop.totalPaid || 0;
      }
    }

    if (shop.subscriptionStartDate) {
      if (method === 'monthly') {
        const monthlyFee = parseFloat(settings.monthlyFee) || 1250;
        const monthlyPlanMonths = parseInt(settings.monthlyPlanMonths) || 3;
        const subStart = new Date(shop.subscriptionStartDate);
        
        let monthsElapsed = (now.getFullYear() - subStart.getFullYear()) * 12 + (now.getMonth() - subStart.getMonth());
        if (now.getDate() < subStart.getDate()) {
          monthsElapsed--;
        }
        monthsElapsed = Math.max(0, monthsElapsed);
        
        const elapsedTerms = Math.max(1, Math.ceil((monthsElapsed + 1) / monthlyPlanMonths));
        const totalBilledDues = elapsedTerms * monthlyFee;
        const outstandingBalance = Math.max(0, totalBilledDues - totalPaid);
        
        const paidTerms = Math.floor(totalPaid / monthlyFee);
        const expirationDate = new Date(subStart);
        expirationDate.setMonth(expirationDate.getMonth() + (paidTerms * monthlyPlanMonths));
        
        const diffTime = expirationDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const isNearExpiration = diffDays <= 7 && diffDays > 0;
        const isExpired = diffDays <= 0;
        
        let breakdown = `Flat Rate Plan: ₱${monthlyFee.toLocaleString()} for ${monthlyPlanMonths} months. `;
        if (isExpired) {
          breakdown += `Expired on ${formatDateShort(expirationDate)}. Please renew your subscription.`;
        } else {
          breakdown += `Active until ${formatDateShort(expirationDate)}.`;
        }
        
        const methodLabel = `Flat Rate Plan (${monthlyPlanMonths} Months)`;
        
        return {
          method,
          selectedPlan: shop.subscriptionMethod || settings.subscriptionMethod || 'onetime_daily',
          methodLabel,
          breakdown,
          accumulatedFee: totalBilledDues,
          totalPaid,
          outstandingBalance,
          billedOutstanding: outstandingBalance,
          daysActive: Math.ceil((now - new Date(shop.createdAt)) / (1000 * 60 * 60 * 24)),
          isOverdue: isExpired,
          subscriptionStartDate: shop.subscriptionStartDate,
          expirationDate: expirationDate.toISOString(),
          isNearExpiration,
          isExpired,
          diffDays,
          monthlyFee,
          monthlyPlanMonths
        };
      }

      // Rest of subscriptionStartDate exists logic (daily/stamp plans)
      const cycleInfo = getBillingCycles(shop.subscriptionStartDate, now);
      const completed = cycleInfo.completed;
      const ongoing = cycleInfo.ongoing;
      
      let totalBilledDues = 0;
      let cycleBreakdowns = [];
      
      let developerFee = 0;
      if (method === 'onetime_daily') {
        developerFee = parseFloat(settings.systemDeveloperFee) || 0;
        totalBilledDues += developerFee;
        cycleBreakdowns.push(`System Developer Fee: ₱${developerFee.toLocaleString()} (One-time)`);
      } else if (method === 'per_stamp') {
        developerFee = parseFloat(settings.perStampDeveloperFee) || 0;
        totalBilledDues += developerFee;
        cycleBreakdowns.push(`System Developer Fee: ₱${developerFee.toLocaleString()} (One-time)`);
      }
      
      for (let idx = 0; idx < completed.length; idx++) {
        const c = completed[idx];
        const cycleDays = Math.ceil((c.end - c.start) / (1000 * 60 * 60 * 24));
        const cycleNum = idx + 1;
        
        let cycleFee = 0;
        if (method === 'onetime_daily') {
          cycleFee = cycleDays * (parseFloat(settings.dailyFee) || 0);
          totalBilledDues += cycleFee;
          cycleBreakdowns.push(`SOA #${cycleNum} (${formatDateShort(c.start)} to ${formatDateShort(c.end)}): ₱${cycleFee.toLocaleString()} (${cycleDays} day(s) * ₱${settings.dailyFee}) - Released: ${formatDateShort(c.soaDate)}, Due: ${formatDateShort(c.dueDate)}`);
        } else if (method === 'per_stamp') {
          const stampsInCycle = await countStampsInPeriod(c.start, c.end, shop.id);
          cycleFee = stampsInCycle * (parseFloat(settings.perStampFee) || 0);
          totalBilledDues += cycleFee;
          cycleBreakdowns.push(`SOA #${cycleNum} (${formatDateShort(c.start)} to ${formatDateShort(c.end)}): ₱${cycleFee.toLocaleString()} (${stampsInCycle} stamp(s) * ₱${settings.perStampFee}) - Released: ${formatDateShort(c.soaDate)}, Due: ${formatDateShort(c.dueDate)}`);
        }
      }
      
      const ongoingDays = Math.max(0, Math.floor((now - ongoing.start) / (1000 * 60 * 60 * 24)));
      let ongoingFee = 0;
      let ongoingLabel = '';
      if (method === 'onetime_daily') {
        ongoingFee = ongoingDays * (parseFloat(settings.dailyFee) || 0);
        ongoingLabel = `Current Cycle Daily Usage (${formatDateShort(ongoing.start)} to present): ₱${ongoingFee.toLocaleString()} (${ongoingDays} day(s) * ₱${settings.dailyFee}) - Next SOA: ${formatDateShort(ongoing.end)}`;
      } else if (method === 'per_stamp') {
        const stampsInOngoing = await countStampsInPeriod(ongoing.start, now, shop.id);
        ongoingFee = stampsInOngoing * (parseFloat(settings.perStampFee) || 0);
        ongoingLabel = `Current Cycle Stamp Usage (${formatDateShort(ongoing.start)} to present): ₱${ongoingFee.toLocaleString()} (${stampsInOngoing} stamp(s) * ₱${settings.perStampFee}) - Next SOA: ${formatDateShort(ongoing.end)}`;
      }
      
      const accumulatedFee = totalBilledDues + ongoingFee;
      const outstandingBalance = Math.max(0, accumulatedFee - totalPaid);
      const billedOutstanding = Math.max(0, totalBilledDues - totalPaid);
      
      let isOverdue = false;
      let runningBilled = developerFee;
      for (const c of completed) {
        let cycleFee = 0;
        const cycleDays = Math.ceil((c.end - c.start) / (1000 * 60 * 60 * 24));
        if (method === 'onetime_daily') {
          cycleFee = cycleDays * (parseFloat(settings.dailyFee) || 0);
        } else if (method === 'per_stamp') {
          const stampsInCycle = await countStampsInPeriod(c.start, c.end, shop.id);
          cycleFee = stampsInCycle * (parseFloat(settings.perStampFee) || 0);
        }
        
        runningBilled += cycleFee;
        if (now > c.dueDate && totalPaid < runningBilled) {
          isOverdue = true;
        }
      }
      
      const methodLabel = method === 'onetime_daily' 
        ? 'Daily Active Plan (Billed Monthly)' 
        : 'Pay-Per-Stamp Plan (Billed Monthly)';
      
      let breakdownText = cycleBreakdowns.join(' | ') || 'No statement of account released yet.';
      if (ongoingLabel) {
        breakdownText += ` | ${ongoingLabel}`;
      }
      
      return {
        method,
        selectedPlan: shop.subscriptionMethod || settings.subscriptionMethod || 'onetime_daily',
        methodLabel,
        breakdown: breakdownText,
        accumulatedFee,
        totalPaid,
        outstandingBalance,
        billedOutstanding,
        daysActive: Math.ceil((now - new Date(shop.createdAt)) / (1000 * 60 * 60 * 24)),
        isOverdue,
        subscriptionStartDate: shop.subscriptionStartDate,
        nextSoaDate: ongoing.soaDate.toISOString(),
        nextDueDate: ongoing.dueDate.toISOString()
      };
    }
    
    // Fallback: If subscriptionStartDate is NOT set yet
    const createdTime = shop.createdAt ? new Date(shop.createdAt).getTime() : Date.now();
    const msActive = Date.now() - createdTime;
    const daysActive = Math.max(1, Math.ceil(msActive / (1000 * 60 * 60 * 24)));
    
    let methodLabel = '';
    let breakdown = '';
    let accumulatedFee = 0;
    
    const trialDays = 7 + (shop.trialExtensionDays || 0);
    if (daysActive <= trialDays && (!shop.subscriptionMethod || shop.subscriptionMethod === 'trial')) {
      methodLabel = `Basic Subscription (${trialDays}-Day Free Trial)`;
      const remainingDays = trialDays - Math.floor(msActive / (1000 * 60 * 60 * 24));
      breakdown = `Free trial active. Expires in ${Math.max(0, remainingDays)} day(s).`;
      accumulatedFee = 0;
    } else {
      const activeDays = Math.max(0, daysActive - trialDays);
      if (method === 'onetime_daily') {
        const developerFee = parseFloat(settings.systemDeveloperFee) || 0;
        const dailyFee = parseFloat(settings.dailyFee) || 0;
        methodLabel = 'System Developer Fee + Daily Fee';
        breakdown = `System Developer Fee: ₱${developerFee.toLocaleString()} (One-time) + Daily Fee: ₱${dailyFee} (${activeDays} day(s) active on paid plan)`;
        accumulatedFee = developerFee + (activeDays * dailyFee);
      } else if (method === 'monthly') {
        const monthlyFee = parseFloat(settings.monthlyFee) || 1250;
        const monthlyPlanMonths = parseInt(settings.monthlyPlanMonths) || 3;
        methodLabel = `Flat Rate Plan (${monthlyPlanMonths} Months)`;
        breakdown = `Subscription fee: ₱${monthlyFee.toLocaleString()} for ${monthlyPlanMonths} months. Active upon payment confirmation.`;
        accumulatedFee = monthlyFee;
      } else if (method === 'per_stamp') {
        const perStampFee = parseFloat(settings.perStampFee) || 0;
        const developerFee = parseFloat(settings.perStampDeveloperFee) || 0;
        const totalStamps = await countTotalStamps(shop.id);
        methodLabel = 'Pay-As-You-Go per Stamp';
        breakdown = `System Developer Fee: ₱${developerFee.toLocaleString()} (One-time) + Fee per Stamp: ₱${perStampFee.toLocaleString()} (${totalStamps} stamp(s) issued)`;
        accumulatedFee = developerFee + (totalStamps * perStampFee);
      }
    }
    
    const outstandingBalance = Math.max(0, accumulatedFee - totalPaid);
    
    return {
      method: daysActive <= trialDays ? 'trial' : method,
      selectedPlan: shop.subscriptionMethod || settings.subscriptionMethod || 'onetime_daily',
      methodLabel,
      breakdown,
      accumulatedFee,
      totalPaid,
      outstandingBalance,
      daysActive,
      createdAt: shop.createdAt
    };
  },

  async getShopBillingSummary(slug) {
    const shop = await this.getShop(slug);
    if (!shop) throw new Error(`Shop "${slug}" not found.`);
    
    const settings = await this.getGlobalSettings();
    return this.computeBilling(shop, settings);
  },

  async recordShopPayment(slug, amount, referenceNumber, receiptImage) {
    const cleanSlug = slug.toLowerCase();
    const pAmount = parseFloat(amount);
    if (isNaN(pAmount) || pAmount <= 0) {
      throw new Error('Payment amount must be a positive number.');
    }

    const ref = referenceNumber ? String(referenceNumber).trim() : `REF-IMG-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const paymentId = `receipt-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const { error } = await supabase
      .from('shop_payments')
      .insert({
        id: paymentId,
        shop_id: cleanSlug,
        amount: pAmount,
        reference_number: ref,
        receipt_image: receiptImage || null,
        timestamp: new Date().toISOString(),
        status: 'pending',
        verified_at: null
      });

    if (error) throw new Error(error.message);
    return this.getShop(cleanSlug);
  },

  // Notifications Methods
  async addPaymentNotification(shopSlug, amount) {
    const cleanSlug = shopSlug.toLowerCase();
    
    // Get shop name
    const { data: shop } = await supabase
      .from('shops')
      .select('name')
      .eq('id', cleanSlug)
      .maybeSingle();

    const shopName = shop ? shop.name : shopSlug;
    const notificationId = `notif-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    
    const { error } = await supabase
      .from('payment_notifications')
      .insert({
        id: notificationId,
        shop_slug: cleanSlug,
        shop_name: shopName,
        amount: parseFloat(amount),
        timestamp: new Date().toISOString(),
        read: false
      });

    if (error) throw new Error(error.message);

    // Enforce 50 notifications limit by deleting older ones
    const { data: totalNotifications } = await supabase
      .from('payment_notifications')
      .select('id')
      .order('timestamp', { ascending: false });

    if (totalNotifications && totalNotifications.length > 50) {
      const keepIds = totalNotifications.slice(0, 50).map(n => n.id);
      await supabase
        .from('payment_notifications')
        .delete()
        .not('id', 'in', `(${keepIds.join(',')})`);
    }

    return {
      id: notificationId,
      shopSlug: cleanSlug,
      shopName,
      amount: parseFloat(amount),
      timestamp: new Date().toISOString(),
      read: false
    };
  },

  async getPaymentNotifications() {
    const { data: notifications, error } = await supabase
      .from('payment_notifications')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error || !notifications) return [];
    return notifications.map(mapNotificationRowToApp);
  },

  async markNotificationsAsRead() {
    await supabase
      .from('payment_notifications')
      .update({ read: true })
      .eq('read', false);

    return this.getPaymentNotifications();
  },

  async clearNotifications() {
    await supabase
      .from('payment_notifications')
      .delete()
      .neq('id', ''); // Clear all

    return [];
  },

  async getAllPayments() {
    // Join payments on shops to fetch name
    const { data: rows, error } = await supabase
      .from('shop_payments')
      .select('id, amount, reference_number, receipt_image, timestamp, status, verified_at, shops(id, name)')
      .order('timestamp', { ascending: false });

    if (error || !rows) return [];

    return rows.map(r => ({
      id: r.id,
      amount: r.amount ? parseFloat(r.amount) : 0,
      referenceNumber: r.reference_number,
      receiptImage: r.receipt_image,
      timestamp: r.timestamp,
      status: r.status,
      verifiedAt: r.verified_at,
      shopId: r.shops.id,
      shopName: r.shops.name
    }));
  },

  async confirmPayment(paymentId) {
    // Get target payment
    const { data: paymentRow, error: pErr } = await supabase
      .from('shop_payments')
      .select('*, shops(*)')
      .eq('id', paymentId)
      .maybeSingle();

    if (pErr || !paymentRow) {
      throw new Error(`Payment request with ID "${paymentId}" not found.`);
    }

    const newVerifiedAt = new Date().toISOString();
    
    // Update payment status
    await supabase
      .from('shop_payments')
      .update({
        status: 'confirmed',
        verified_at: newVerifiedAt
      })
      .eq('id', paymentId);

    // Update totalPaid on shop
    const shop = paymentRow.shops;
    const currentPaid = shop.total_paid ? parseFloat(shop.total_paid) : 0;
    const newPaid = currentPaid + parseFloat(paymentRow.amount);

    const shopUpdates = { total_paid: newPaid };
    
    if (!shop.subscription_start_date && shop.subscription_method && shop.subscription_method !== 'trial') {
      shopUpdates.subscription_start_date = new Date().toISOString();
    }

    await supabase
      .from('shops')
      .update(shopUpdates)
      .eq('id', shop.id);

    const updatedShop = await this.getShop(shop.id);
    const updatedPayment = {
      id: paymentRow.id,
      amount: parseFloat(paymentRow.amount),
      referenceNumber: paymentRow.reference_number,
      receiptImage: paymentRow.receipt_image,
      timestamp: paymentRow.timestamp,
      status: 'confirmed',
      verifiedAt: newVerifiedAt
    };

    return {
      payment: updatedPayment,
      shop: updatedShop
    };
  }
};
