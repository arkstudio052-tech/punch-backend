const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DB_FILE = path.join(__dirname, 'db.json');

const serviceAccountPath = path.join(__dirname, 'service-account-key.json');

// Initialize Firebase Admin
if (admin.getApps().length === 0) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = admin.cert(serviceAccount);
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:', e);
    }
  }
  
  if (!credential) {
    if (fs.existsSync(serviceAccountPath)) {
      credential = admin.cert(serviceAccountPath);
    } else {
      try {
        credential = admin.applicationDefault();
      } catch (e) {
        console.warn('Warning: Application Default Credentials not found. Local mock mode or admin credentials required.');
      }
    }
  }

  admin.initializeApp({
    credential,
    databaseURL: "https://punch-loyalty-card-default-rtdb.firebaseio.com"
  });
}

const { getDatabase } = require('firebase-admin/database');
const rtdb = getDatabase();
const dbRef = rtdb.ref('/');

// Billing helper functions
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

function countStampsInPeriod(start, end, shopId, db) {
  const cleanShopId = shopId.toLowerCase();
  const customers = Object.values(db.customers || {}).filter(c => c.shopId === cleanShopId);
  let stamps = 0;
  
  const startTime = start.getTime();
  const endTime = end.getTime();
  
  customers.forEach(c => {
    const cTime = new Date(c.createdAt).getTime();
    if (cTime >= startTime && cTime < endTime) {
      stamps += c.points || 0;
    }
    const redemptions = c.redemptions || [];
    redemptions.forEach(r => {
      const rTime = new Date(r.redeemedAt).getTime();
      if (rTime >= startTime && rTime < endTime) {
        stamps += r.pointsRedeemed || 0;
      }
    });
  });
  return stamps;
}

// Helper to read database
async function readDb() {
  try {
    const snapshot = await dbRef.once('value');
    let data = snapshot.val();
    
    // Seed DB if it's empty in Realtime Database
    if (!data || (!data.shops && !data.customers)) {
      if (fs.existsSync(DB_FILE)) {
        console.log('Seeding Realtime Database from local db.json...');
        try {
          const fileData = fs.readFileSync(DB_FILE, 'utf8');
          data = JSON.parse(fileData);
          await dbRef.set(data);
        } catch (err) {
          console.error('Failed to parse local db.json for seeding:', err);
          data = { shops: {}, customers: {}, notifications: [] };
        }
      } else {
        data = { shops: {}, customers: {}, notifications: [] };
      }
    }
    
    if (!data.shops) data.shops = {};
    if (!data.customers) data.customers = {};
    if (!data.notifications) data.notifications = [];
    
    return data;
  } catch (error) {
    console.error('Error reading from Firebase Realtime Database:', error);
    return { shops: {}, customers: {}, notifications: [] };
  }
}

// Helper to write database
async function writeDb(data) {
  try {
    await dbRef.set(data);
    return true;
  } catch (error) {
    console.error('Error writing to Firebase Realtime Database:', error);
    return false;
  }
}

module.exports = {
  // Shops Methods
  async getShop(slug) {
    const db = await readDb();
    const shop = db.shops[slug.toLowerCase()] || null;
    if (shop) {
      if (!shop.rewards) {
        // Fallback parser for old shop.rule string
        const pointsRequired = parseInt(shop.rule.match(/\d+/)?.[0]) || 10;
        const rewardText = shop.rule.replace(/^\d+\s*(stamps|points)?\s*=\s*/i, '').trim() || '1 free item';
        shop.rewards = [{
          id: 'reward-default',
          pointsRequired,
          rewardText,
          isActive: true
        }];
      }
      if (!shop.ownerUsername) {
        shop.ownerUsername = 'admin';
      }
      if (!shop.ownerPassword) {
        shop.ownerPassword = 'admin';
      }
      if (shop.isSuspended === undefined) {
        shop.isSuspended = false;
      }
      if (!shop.createdAt) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        shop.createdAt = yesterday.toISOString();
      }
      if (shop.totalPaid === undefined) {
        shop.totalPaid = 0;
      }
      if (!shop.payments) {
        shop.payments = [];
      }
      
      // Dynamic computation of isSuspended
      shop.isSuspended = this.isShopSuspended(shop, db);
    }
    return shop;
  },

  isShopSuspended(shop, db) {
    if (shop.isSuspended === true) {
      return true; // Manually suspended by admin
    }
    
    // Auto-suspend if trial expired and has outstanding balance
    const createdTime = shop.createdAt ? new Date(shop.createdAt).getTime() : Date.now();
    const msActive = Date.now() - createdTime;
    const daysActive = Math.ceil(msActive / (1000 * 60 * 60 * 24));
    
    if (daysActive > 7) {
      const settings = db.settings || { subscriptionMethod: 'onetime_daily' };
      const summary = this.computeBilling(shop, settings, db);
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
    const db = await readDb();
    return Object.values(db.shops).map(shop => {
      return {
        id: shop.id,
        name: shop.name,
        logo: shop.logo,
        rule: shop.rule || ''
      };
    });
  },

  async createShop(name, slug, rule, ownerUsername, ownerPassword) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '');
    if (db.shops[cleanSlug]) {
      throw new Error(`Shop with slug "${cleanSlug}" already exists.`);
    }
    
    const inputRule = rule.trim() || '10 stamps = 1 free coffee';
    const pointsRequired = parseInt(inputRule.match(/\d+/)?.[0]) || 10;
    const rewardText = inputRule.replace(/^\d+\s*(stamps|points)?\s*=\s*/i, '').trim() || '1 free coffee';

    const newShop = {
      id: cleanSlug,
      name: name.trim(),
      rule: inputRule,
      logo: null,
      pointsPerPurchase: 1,
      ownerUsername: ownerUsername ? ownerUsername.trim() : 'admin',
      ownerPassword: ownerPassword ? ownerPassword.trim() : 'admin',
      createdAt: new Date().toISOString(),
      totalPaid: 0,
      payments: [],
      rewards: [
        {
          id: 'reward-default',
          pointsRequired,
          rewardText,
          isActive: true
        }
      ],
      specials: [
        `Welcome to ${name}! Track your loyalty points here.`,
        'Ask our staff about today\'s special promotion!'
      ]
    };
    
    db.shops[cleanSlug] = newShop;
    await writeDb(db);
    return newShop;
  },

  async updateShopSpecials(slug, specials) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    if (!db.shops[cleanSlug]) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }
    
    // Ensure specials is an array of strings
    db.shops[cleanSlug].specials = Array.isArray(specials) 
      ? specials.map(s => String(s).trim()).filter(Boolean)
      : [];
    
    await writeDb(db);
    return db.shops[cleanSlug];
  },

  async updateShopLogo(slug, logoDataUrl) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    if (!db.shops[cleanSlug]) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }
    db.shops[cleanSlug].logo = logoDataUrl;
    await writeDb(db);
    return db.shops[cleanSlug];
  },

  async addShopReward(slug, pointsRequired, rewardText) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }

    if (!shop.rewards) {
      shop.rewards = [];
    }

    const rewardId = `reward-${Date.now()}`;
    const newReward = {
      id: rewardId,
      pointsRequired: parseInt(pointsRequired) || 10,
      rewardText: rewardText.trim(),
      isActive: false
    };

    shop.rewards.push(newReward);
    await writeDb(db);
    return shop;
  },

  async activateShopReward(slug, rewardId) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }

    if (!shop.rewards) {
      throw new Error('No rewards catalog found for this shop.');
    }

    const targetReward = shop.rewards.find(r => r.id === rewardId);
    if (!targetReward) {
      throw new Error('Reward item not found.');
    }

    // Set all other rewards to inactive, and target to active
    shop.rewards.forEach(r => {
      r.isActive = (r.id === rewardId);
    });

    // Sync legacy text rule
    shop.rule = `${targetReward.pointsRequired} stamps = ${targetReward.rewardText}`;

    await writeDb(db);
    return shop;
  },

  async deleteShopReward(slug, rewardId) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }

    if (!shop.rewards) {
      throw new Error('No rewards catalog found for this shop.');
    }

    const targetIndex = shop.rewards.findIndex(r => r.id === rewardId);
    if (targetIndex === -1) {
      throw new Error('Reward item not found.');
    }

    if (shop.rewards[targetIndex].isActive) {
      throw new Error('Cannot delete the currently active reward rules. Please activate another reward first.');
    }

    shop.rewards.splice(targetIndex, 1);
    await writeDb(db);
    return shop;
  },

  async editShopReward(slug, rewardId, pointsRequired, rewardText) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }

    if (!shop.rewards) {
      shop.rewards = [];
    }

    const reward = shop.rewards.find(r => r.id === rewardId);
    if (!reward) {
      throw new Error('Reward item not found.');
    }

    reward.pointsRequired = parseInt(pointsRequired) || 10;
    reward.rewardText = rewardText.trim();

    // If this reward is active, we must sync the legacy shop.rule string too!
    if (reward.isActive) {
      shop.rule = `${reward.pointsRequired} stamps = ${reward.rewardText}`;
    }

    await writeDb(db);
    return shop;
  },

  async getCustomer(id) {
    const db = await readDb();
    const customer = db.customers[id];
    if (customer) {
      if (!customer.redemptions) customer.redemptions = [];
      if (!customer.pendingRedeem) customer.pendingRedeem = null;
    }
    return customer || null;
  },

  async getCustomersByShop(shopId) {
    const db = await readDb();
    const cleanShopId = shopId.toLowerCase();
    return Object.values(db.customers).filter(c => c.shopId === cleanShopId);
  },

  async authCustomer(shopId, phone, name) {
    const db = await readDb();
    const cleanShopId = shopId.toLowerCase();
    const cleanPhone = phone.trim().replace(/[^0-9+]/g, '');
    
    if (!db.shops[cleanShopId]) {
      throw new Error(`Shop "${cleanShopId}" does not exist.`);
    }

    if (!cleanPhone) {
      throw new Error('Invalid phone number.');
    }

    const customerId = `${cleanShopId}-${cleanPhone}`;
    const existingCustomer = db.customers[customerId];
    
    if (existingCustomer) {
      // Update name if a new one is provided during re-auth
      if (name && name.trim()) {
        existingCustomer.name = name.trim();
        await writeDb(db);
      }
      return { customer: existingCustomer, isNew: false };
    }

    // Customer does not exist.
    // If name is not provided, indicate they are new so the UI prompts for name
    if (!name || !name.trim()) {
      return { customer: null, isNew: true };
    }

    // Create new customer with the welcome bonus points
    const newCustomer = {
      id: customerId,
      shopId: cleanShopId,
      phone: cleanPhone,
      name: name.trim(),
      points: 1,
      redemptions: [],
      pendingRedeem: null,
      createdAt: new Date().toISOString()
    };

    db.customers[customerId] = newCustomer;
    await writeDb(db);
    return { customer: newCustomer, isNew: false };
  },

  async addCustomerPoint(customerId) {
    const db = await readDb();
    if (!db.customers[customerId]) {
      throw new Error('Customer not found.');
    }

    db.customers[customerId].points += 1;
    await writeDb(db);
    return db.customers[customerId];
  },

  async createPendingRedeem(customerId, maxPoints) {
    const db = await readDb();
    const customer = db.customers[customerId];
    if (!customer) {
      throw new Error('Customer not found.');
    }
    if (customer.points < maxPoints) {
      throw new Error(`Insufficient points. Requires ${maxPoints} points to redeem.`);
    }

    // Generate random 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    customer.pendingRedeem = {
      code,
      pointsRequired: maxPoints,
      createdAt: new Date().toISOString()
    };

    await writeDb(db);
    return customer;
  },

  async cancelPendingRedeem(customerId) {
    const db = await readDb();
    const customer = db.customers[customerId];
    if (!customer) {
      throw new Error('Customer not found.');
    }

    customer.pendingRedeem = null;
    await writeDb(db);
    return customer;
  },

  async confirmRedemptionDirect(customerId, code) {
    const db = await readDb();
    const customer = db.customers[customerId];
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

    // Deduct points and push history
    customer.points -= pointsToRedeem;
    if (!customer.redemptions) customer.redemptions = [];
    customer.redemptions.push({
      code,
      pointsRedeemed: pointsToRedeem,
      redeemedAt: new Date().toISOString()
    });
    customer.pendingRedeem = null;

    await writeDb(db);
    return customer;
  },

  async confirmRedemptionByCode(shopId, code) {
    const db = await readDb();
    const cleanShopId = shopId.toLowerCase();
    
    // Find customer in this shop with matching active code
    const customer = Object.values(db.customers).find(c => 
      c.shopId === cleanShopId && 
      c.pendingRedeem && 
      c.pendingRedeem.code === code
    );

    if (!customer) {
      throw new Error(`No pending redemption found with code "${code}" at this shop.`);
    }

    const pointsToRedeem = customer.pendingRedeem.pointsRequired;
    customer.points -= pointsToRedeem;
    if (!customer.redemptions) customer.redemptions = [];
    customer.redemptions.push({
      code,
      pointsRedeemed: pointsToRedeem,
      redeemedAt: new Date().toISOString()
    });
    customer.pendingRedeem = null;

    await writeDb(db);
    return customer;
  },

  async getRedemptionsByShop(shopId) {
    const db = await readDb();
    const cleanShopId = shopId.toLowerCase();
    const shopCustomers = Object.values(db.customers).filter(c => c.shopId === cleanShopId);
    
    const history = [];
    shopCustomers.forEach(cust => {
      const redemptions = cust.redemptions || [];
      redemptions.forEach(r => {
        history.push({
          customerId: cust.id,
          customerName: cust.name,
          customerPhone: cust.phone,
          code: r.code,
          pointsRedeemed: r.pointsRedeemed,
          redeemedAt: r.redeemedAt
        });
      });
    });

    // Sort descending (newest claims first)
    return history.sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt));
  },

  async getAllShopsFull() {
    const db = await readDb();
    return Object.values(db.shops).map(shop => {
      if (!shop.ownerUsername) shop.ownerUsername = 'admin';
      if (!shop.ownerPassword) shop.ownerPassword = 'admin';
      shop.isSuspended = this.isShopSuspended(shop, db);
      return shop;
    });
  },

  async suspendShop(slug, isSuspended) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    if (!db.shops[cleanSlug]) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }
    db.shops[cleanSlug].isSuspended = !!isSuspended;
    await writeDb(db);
    return db.shops[cleanSlug];
  },

  async updateShopSubscriptionMethod(slug, method) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }
    const validMethods = ['onetime_daily', 'monthly', 'per_stamp'];
    if (!validMethods.includes(method)) {
      throw new Error(`Invalid subscription plan method: ${method}`);
    }
    shop.subscriptionMethod = method;
    await writeDb(db);
    return shop;
  },

  async deleteShop(slug) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    if (!db.shops[cleanSlug]) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }
    // Delete shop
    delete db.shops[cleanSlug];
    // Delete associated customers
    const updatedCustomers = {};
    Object.keys(db.customers).forEach(custId => {
      const cust = db.customers[custId];
      if (cust.shopId !== cleanSlug) {
        updatedCustomers[custId] = cust;
      }
    });
    db.customers = updatedCustomers;
    await writeDb(db);
    return true;
  },

  async updateShopDetails(slug, { name, rule, ownerUsername, ownerPassword }) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }
    if (name) shop.name = name.trim();
    if (ownerUsername) shop.ownerUsername = ownerUsername.trim();
    if (ownerPassword) shop.ownerPassword = ownerPassword.trim();
    
    if (rule) {
      shop.rule = rule.trim();
      const pointsRequired = parseInt(shop.rule.match(/\d+/)?.[0]) || 10;
      const rewardText = shop.rule.replace(/^\d+\s*(stamps|points)?\s*=\s*/i, '').trim() || '1 free item';
      
      if (shop.rewards) {
        const activeReward = shop.rewards.find(r => r.isActive);
        if (activeReward) {
          activeReward.pointsRequired = pointsRequired;
          activeReward.rewardText = rewardText;
        } else if (shop.rewards.length > 0) {
          shop.rewards[0].isActive = true;
          shop.rewards[0].pointsRequired = pointsRequired;
          shop.rewards[0].rewardText = rewardText;
        } else {
          shop.rewards.push({
            id: 'reward-default',
            pointsRequired,
            rewardText,
            isActive: true
          });
        }
      }
    }
    await writeDb(db);
    return shop;
  },

  async getGlobalSettings() {
    const db = await readDb();
    if (!db.settings) {
      db.settings = {};
    }
    if (!db.settings.paymentInstructions) {
      db.settings.paymentInstructions = 'Scan the GCash QR code below to settle your platform subscription fee.';
    }
    if (!db.settings.subscriptionMethod) {
      db.settings.subscriptionMethod = 'onetime_daily';
    }
    if (db.settings.systemDeveloperFee === undefined) {
      db.settings.systemDeveloperFee = db.settings.onetimeSetupFee !== undefined ? db.settings.onetimeSetupFee : 5000;
    }
    if (db.settings.onetimeSetupFee === undefined) {
      db.settings.onetimeSetupFee = db.settings.systemDeveloperFee;
    }
    if (db.settings.dailyFee === undefined) {
      db.settings.dailyFee = 50;
    }
    if (db.settings.monthlyFee === undefined) {
      db.settings.monthlyFee = 1500;
    }
    if (db.settings.perStampFee === undefined) {
      db.settings.perStampFee = 1;
    }
    if (db.settings.perStampDeveloperFee === undefined) {
      db.settings.perStampDeveloperFee = 3000;
    }
    await writeDb(db);
    return db.settings;
  },

  async updateGlobalSettings({ paymentQr, paymentInstructions, subscriptionMethod, systemDeveloperFee, dailyFee, monthlyFee, perStampDeveloperFee, perStampFee }) {
    const db = await readDb();
    if (!db.settings) {
      db.settings = {};
    }
    if (paymentQr !== undefined) db.settings.paymentQr = paymentQr;
    if (paymentInstructions !== undefined) db.settings.paymentInstructions = paymentInstructions;
    if (subscriptionMethod !== undefined) db.settings.subscriptionMethod = subscriptionMethod;
    if (systemDeveloperFee !== undefined) {
      db.settings.systemDeveloperFee = parseFloat(systemDeveloperFee) || 0;
      db.settings.onetimeSetupFee = db.settings.systemDeveloperFee; // Sync setup fee for compatibility
    }
    if (dailyFee !== undefined) db.settings.dailyFee = parseFloat(dailyFee) || 0;
    if (monthlyFee !== undefined) db.settings.monthlyFee = parseFloat(monthlyFee) || 0;
    if (perStampDeveloperFee !== undefined) db.settings.perStampDeveloperFee = parseFloat(perStampDeveloperFee) || 0;
    if (perStampFee !== undefined) db.settings.perStampFee = parseFloat(perStampFee) || 0;
    await writeDb(db);
    return db.settings;
  },

  computeBilling(shop, settings, db) {
    const method = shop.subscriptionMethod || settings.subscriptionMethod || 'onetime_daily';
    
    // Check if subscriptionStartDate is set (verified paid plan)
    if (shop.subscriptionStartDate) {
      const now = new Date();
      const cycleInfo = getBillingCycles(shop.subscriptionStartDate, now);
      const completed = cycleInfo.completed;
      const ongoing = cycleInfo.ongoing;
      
      let totalBilledDues = 0;
      let cycleBreakdowns = [];
      
      // 1. Setup Developer Fee (One-time)
      let developerFee = 0;
      if (method === 'onetime_daily') {
        developerFee = parseFloat(settings.systemDeveloperFee) || parseFloat(settings.onetimeSetupFee) || 0;
        totalBilledDues += developerFee;
        cycleBreakdowns.push(`System Developer Fee: ₱${developerFee.toLocaleString()} (One-time)`);
      } else if (method === 'monthly') {
        developerFee = 0;
      } else if (method === 'per_stamp') {
        developerFee = parseFloat(settings.perStampDeveloperFee) || 0;
        totalBilledDues += developerFee;
        cycleBreakdowns.push(`System Developer Fee: ₱${developerFee.toLocaleString()} (One-time)`);
      }
      
      // 2. Completed billing cycles dues
      completed.forEach((c, idx) => {
        const cycleDays = Math.ceil((c.end - c.start) / (1000 * 60 * 60 * 24));
        const cycleNum = idx + 1;
        
        let cycleFee = 0;
        if (method === 'onetime_daily') {
          cycleFee = cycleDays * (parseFloat(settings.dailyFee) || 0);
          totalBilledDues += cycleFee;
          cycleBreakdowns.push(`SOA #${cycleNum} (${formatDateShort(c.start)} to ${formatDateShort(c.end)}): ₱${cycleFee.toLocaleString()} (${cycleDays} day(s) * ₱${settings.dailyFee}) - Released: ${formatDateShort(c.soaDate)}, Due: ${formatDateShort(c.dueDate)}`);
        } else if (method === 'monthly') {
          cycleFee = parseFloat(settings.monthlyFee) || 0;
          totalBilledDues += cycleFee;
          cycleBreakdowns.push(`SOA #${cycleNum} (${formatDateShort(c.start)} to ${formatDateShort(c.end)}): ₱${cycleFee.toLocaleString()} (Flat Monthly) - Released: ${formatDateShort(c.soaDate)}, Due: ${formatDateShort(c.dueDate)}`);
        } else if (method === 'per_stamp') {
          const stampsInCycle = countStampsInPeriod(c.start, c.end, shop.id, db);
          cycleFee = stampsInCycle * (parseFloat(settings.perStampFee) || 0);
          totalBilledDues += cycleFee;
          cycleBreakdowns.push(`SOA #${cycleNum} (${formatDateShort(c.start)} to ${formatDateShort(c.end)}): ₱${cycleFee.toLocaleString()} (${stampsInCycle} stamp(s) * ₱${settings.perStampFee}) - Released: ${formatDateShort(c.soaDate)}, Due: ${formatDateShort(c.dueDate)}`);
        }
      });
      
      // 3. Ongoing active cycle unbilled usage
      const ongoingDays = Math.max(0, Math.floor((now - ongoing.start) / (1000 * 60 * 60 * 24)));
      let ongoingFee = 0;
      let ongoingLabel = '';
      if (method === 'onetime_daily') {
        ongoingFee = ongoingDays * (parseFloat(settings.dailyFee) || 0);
        ongoingLabel = `Current Cycle Daily Usage (${formatDateShort(ongoing.start)} to present): ₱${ongoingFee.toLocaleString()} (${ongoingDays} day(s) * ₱${settings.dailyFee}) - Next SOA: ${formatDateShort(ongoing.end)}`;
      } else if (method === 'monthly') {
        ongoingFee = 0;
        ongoingLabel = `Current Cycle (${formatDateShort(ongoing.start)} to present): ₱0 (Flat Monthly billed on cycle end) - Next SOA: ${formatDateShort(ongoing.end)}`;
      } else if (method === 'per_stamp') {
        const stampsInOngoing = countStampsInPeriod(ongoing.start, now, shop.id, db);
        ongoingFee = stampsInOngoing * (parseFloat(settings.perStampFee) || 0);
        ongoingLabel = `Current Cycle Stamp Usage (${formatDateShort(ongoing.start)} to present): ₱${ongoingFee.toLocaleString()} (${stampsInOngoing} stamp(s) * ₱${settings.perStampFee}) - Next SOA: ${formatDateShort(ongoing.end)}`;
      }
      
      const accumulatedFee = totalBilledDues + ongoingFee;
      
      // Calculate totalPaid
      let totalPaid = 0;
      if (shop.payments && shop.payments.length > 0) {
        shop.payments.forEach(p => {
          if (p.status === 'confirmed') {
            totalPaid += p.amount;
          }
        });
      } else {
        totalPaid = shop.totalPaid || 0;
      }
      
      const outstandingBalance = Math.max(0, accumulatedFee - totalPaid);
      const billedOutstanding = Math.max(0, totalBilledDues - totalPaid);
      
      // Calculate isOverdue
      let isOverdue = false;
      let runningBilled = developerFee;
      completed.forEach(c => {
        let cycleFee = 0;
        const cycleDays = Math.ceil((c.end - c.start) / (1000 * 60 * 60 * 24));
        if (method === 'onetime_daily') {
          cycleFee = cycleDays * (parseFloat(settings.dailyFee) || 0);
        } else if (method === 'monthly') {
          cycleFee = parseFloat(settings.monthlyFee) || 0;
        } else if (method === 'per_stamp') {
          const stampsInCycle = countStampsInPeriod(c.start, c.end, shop.id, db);
          cycleFee = stampsInCycle * (parseFloat(settings.perStampFee) || 0);
        }
        
        runningBilled += cycleFee;
        
        if (now > c.dueDate && totalPaid < runningBilled) {
          isOverdue = true;
        }
      });
      
      const methodLabel = method === 'onetime_daily' 
        ? 'Daily Active Plan (Billed Monthly)' 
        : (method === 'monthly' ? 'Flat Monthly Subscription (Billed Monthly)' : 'Pay-Per-Stamp Plan (Billed Monthly)');
      
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
    
    // Fallback: If subscriptionStartDate is NOT set yet (e.g. trial active or trial expired pre-payment)
    const createdTime = shop.createdAt ? new Date(shop.createdAt).getTime() : Date.now();
    const msActive = Date.now() - createdTime;
    const daysActive = Math.max(1, Math.ceil(msActive / (1000 * 60 * 60 * 24)));
    
    let methodLabel = '';
    let breakdown = '';
    let accumulatedFee = 0;
    
    if (daysActive <= 7 && (!shop.subscriptionMethod || shop.subscriptionMethod === 'trial')) {
      methodLabel = 'Basic Subscription (7-Day Free Trial)';
      const remainingDays = 7 - Math.floor(msActive / (1000 * 60 * 60 * 24));
      breakdown = `Free trial active. Expires in ${Math.max(0, remainingDays)} day(s).`;
      accumulatedFee = 0;
    } else {
      const activeDays = Math.max(0, daysActive - 7);
      if (method === 'onetime_daily') {
        const developerFee = parseFloat(settings.systemDeveloperFee) || parseFloat(settings.onetimeSetupFee) || 0;
        const dailyFee = parseFloat(settings.dailyFee) || 0;
        methodLabel = 'System Developer Fee + Daily Fee';
        breakdown = `System Developer Fee: ₱${developerFee.toLocaleString()} (One-time) + Daily Fee: ₱${dailyFee} (${activeDays} day(s) active on paid plan)`;
        accumulatedFee = developerFee + (activeDays * dailyFee);
      } else if (method === 'monthly') {
        const monthlyFee = parseFloat(settings.monthlyFee) || 0;
        const monthsActive = Math.max(1, Math.ceil(activeDays / 30));
        methodLabel = 'Flat Monthly Subscription';
        breakdown = `Monthly Fee: ₱${monthlyFee.toLocaleString()} (${monthsActive} month(s) active on paid plan)`;
        accumulatedFee = monthsActive * monthlyFee;
      } else if (method === 'per_stamp') {
        const perStampFee = parseFloat(settings.perStampFee) || 0;
        const developerFee = parseFloat(settings.perStampDeveloperFee) || 0;
        
        const cleanShopId = shop.id.toLowerCase();
        const customers = Object.values(db.customers || {}).filter(c => c.shopId === cleanShopId);
        
        let totalStamps = 0;
        customers.forEach(c => {
          totalStamps += c.points || 0;
          const redemptions = c.redemptions || [];
          redemptions.forEach(r => {
            totalStamps += r.pointsRedeemed || 0;
          });
        });
        methodLabel = 'Pay-As-You-Go per Stamp';
        breakdown = `System Developer Fee: ₱${developerFee.toLocaleString()} (One-time) + Fee per Stamp: ₱${perStampFee.toLocaleString()} (${totalStamps} stamp(s) issued)`;
        accumulatedFee = developerFee + (totalStamps * perStampFee);
      }
    }
    
    let totalPaid = 0;
    if (shop.payments && shop.payments.length > 0) {
      shop.payments.forEach(p => {
        if (p.status === 'confirmed') {
          totalPaid += p.amount;
        }
      });
    } else {
      totalPaid = shop.totalPaid || 0;
    }
    
    const outstandingBalance = Math.max(0, accumulatedFee - totalPaid);
    
    return {
      method: daysActive <= 7 ? 'trial' : method,
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
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) throw new Error(`Shop "${cleanSlug}" not found.`);
    
    if (!shop.createdAt) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      shop.createdAt = yesterday.toISOString();
    }
    if (shop.totalPaid === undefined) {
      shop.totalPaid = 0;
    }
    if (!shop.payments) {
      shop.payments = [];
    }
    
    const settings = db.settings || { subscriptionMethod: 'onetime_daily' };
    return this.computeBilling(shop, settings, db);
  },

  async recordShopPayment(slug, amount, referenceNumber, receiptImage) {
    const db = await readDb();
    const cleanSlug = slug.toLowerCase();
    const shop = db.shops[cleanSlug];
    if (!shop) {
      throw new Error(`Shop "${cleanSlug}" not found.`);
    }
    const pAmount = parseFloat(amount);
    if (isNaN(pAmount) || pAmount <= 0) {
      throw new Error('Payment amount must be a positive number.');
    }
    if (!shop.payments) {
      shop.payments = [];
    }

    const ref = referenceNumber ? String(referenceNumber).trim() : `REF-IMG-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newPayment = {
      id: `receipt-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      amount: pAmount,
      referenceNumber: ref,
      receiptImage: receiptImage || null,
      timestamp: new Date().toISOString(),
      status: 'pending',
      verifiedAt: null
    };

    shop.payments.push(newPayment);
    await writeDb(db);
    return shop;
  },

  async addPaymentNotification(shopSlug, amount) {
    const db = await readDb();
    const cleanSlug = shopSlug.toLowerCase();
    const shop = db.shops[cleanSlug];
    const shopName = shop ? shop.name : shopSlug;
    
    if (!db.notifications) {
      db.notifications = [];
    }
    
    const newNotification = {
      id: `notif-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      shopSlug: cleanSlug,
      shopName: shopName,
      amount: parseFloat(amount),
      timestamp: new Date().toISOString(),
      read: false
    };
    
    db.notifications.unshift(newNotification);
    
    if (db.notifications.length > 50) {
      db.notifications = db.notifications.slice(0, 50);
    }
    
    await writeDb(db);
    return newNotification;
  },

  async getPaymentNotifications() {
    const db = await readDb();
    return db.notifications || [];
  },

  async markNotificationsAsRead() {
    const db = await readDb();
    if (db.notifications) {
      db.notifications.forEach(n => n.read = true);
      await writeDb(db);
    }
    return db.notifications || [];
  },

  async clearNotifications() {
    const db = await readDb();
    db.notifications = [];
    await writeDb(db);
    return [];
  },

  async getAllPayments() {
    const db = await readDb();
    const all = [];
    Object.values(db.shops).forEach(shop => {
      const payments = shop.payments || [];
      payments.forEach(p => {
        all.push({
          ...p,
          shopId: shop.id,
          shopName: shop.name
        });
      });
    });
    return all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  async confirmPayment(paymentId) {
    const db = await readDb();
    let foundPayment = null;
    let targetShop = null;

    Object.values(db.shops).forEach(shop => {
      const payments = shop.payments || [];
      const payment = payments.find(p => p.id === paymentId);
      if (payment) {
        foundPayment = payment;
        targetShop = shop;
      }
    });

    if (!foundPayment) {
      throw new Error(`Payment request with ID "${paymentId}" not found.`);
    }

    foundPayment.status = 'confirmed';
    foundPayment.verifiedAt = new Date().toISOString();

    if (targetShop.totalPaid === undefined) {
      targetShop.totalPaid = 0;
    }
    targetShop.totalPaid += foundPayment.amount;

    if (!targetShop.subscriptionStartDate && targetShop.subscriptionMethod && targetShop.subscriptionMethod !== 'trial') {
      targetShop.subscriptionStartDate = new Date().toISOString();
    }

    await writeDb(db);
    return {
      payment: foundPayment,
      shop: targetShop
    };
  }
};
