require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Serve static assets first (CSS, client JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// --- API ENDPOINTS ---

// Owner auth middleware
async function requireOwnerAuth(req, res, next) {
  let shopSlug = req.params.shopSlug;
  if (!shopSlug && req.params.customerId) {
    const lastHyphen = req.params.customerId.lastIndexOf('-');
    shopSlug = lastHyphen !== -1 ? req.params.customerId.substring(0, lastHyphen) : req.params.customerId;
  }
  
  if (!shopSlug) {
    return res.status(400).json({ error: 'Shop identification is required.' });
  }

  try {
    const shop = await db.getShop(shopSlug);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found.' });
    }

    const headerUsername = req.headers['x-owner-username'];
    const headerPassword = req.headers['x-owner-password'];

    const shopUser = shop.ownerUsername || 'admin';
    const shopPass = shop.ownerPassword || 'admin';

    if (headerUsername === shopUser && headerPassword === shopPass) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized. Invalid owner credentials.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Super Admin auth middleware
function requireSuperAdminAuth(req, res, next) {
  const code = req.headers['x-superadmin-code'];
  if (code === '*12341234' || code === '12341234') {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Invalid Super Admin code.' });
  }
}

// Check if shop is suspended
async function checkShopSuspension(req, res, next) {
  let shopSlug = req.params.shopSlug;
  if (!shopSlug && req.params.customerId) {
    const lastHyphen = req.params.customerId.lastIndexOf('-');
    shopSlug = lastHyphen !== -1 ? req.params.customerId.substring(0, lastHyphen) : req.params.customerId;
  }

  if (shopSlug) {
    try {
      const shop = await db.getShop(shopSlug);
      if (shop && shop.isSuspended) {
        return res.status(403).json({ error: 'This store has been suspended.' });
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  next();
}

// Shop owner login validation endpoint
app.post('/api/shops/:shopSlug/owner/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const shop = await db.getShop(req.params.shopSlug);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found.' });
    }

    const shopUser = shop.ownerUsername || 'admin';
    const shopPass = shop.ownerPassword || 'admin';

    if (username === shopUser && password === shopPass) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Invalid owner credentials.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register a new shop
app.post('/api/shops', async (req, res) => {
  const { name, slug, rule, ownerUsername, ownerPassword } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'Shop name and URL slug are required.' });
  }
  try {
    const shop = await db.createShop(name, slug, rule, ownerUsername, ownerPassword);
    res.status(201).json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all registered shops
app.get('/api/shops', async (req, res) => {
  try {
    const shops = await db.getAllShops();
    res.json(shops);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get shop metadata
app.get('/api/shops/:shopSlug', async (req, res) => {
  try {
    const shop = await db.getShop(req.params.shopSlug);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found.' });
    }
    res.json(shop);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get shop's customer list (Owner Dashboard utility)
app.get('/api/shops/:shopSlug/customers', requireOwnerAuth, async (req, res) => {
  try {
    const shop = await db.getShop(req.params.shopSlug);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found.' });
    }
    const customers = await db.getCustomersByShop(req.params.shopSlug);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get shop's subscription and billing details (Owner Dashboard utility)
app.get('/api/shops/:shopSlug/billing', requireOwnerAuth, async (req, res) => {
  try {
    const summary = await db.getShopBillingSummary(req.params.shopSlug);
    const settings = await db.getGlobalSettings();
    res.json({
      billingSummary: summary,
      paymentQr: settings.paymentQr,
      paymentInstructions: settings.paymentInstructions,
      pricing: {
        onetimeSetupFee: settings.onetimeSetupFee,
        systemDeveloperFee: settings.systemDeveloperFee,
        dailyFee: settings.dailyFee,
        monthlyFee: settings.monthlyFee,
        perStampFee: settings.perStampFee,
        perStampDeveloperFee: settings.perStampDeveloperFee
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update shop's selected subscription plan (Owner Dashboard utility)
app.post('/api/shops/:shopSlug/subscription-plan', requireOwnerAuth, async (req, res) => {
  const { subscriptionMethod } = req.body;
  try {
    await db.updateShopSubscriptionMethod(req.params.shopSlug, subscriptionMethod);
    const summary = await db.getShopBillingSummary(req.params.shopSlug);
    const settings = await db.getGlobalSettings();
    res.json({
      billingSummary: summary,
      paymentQr: settings.paymentQr,
      paymentInstructions: settings.paymentInstructions,
      pricing: {
        onetimeSetupFee: settings.onetimeSetupFee,
        systemDeveloperFee: settings.systemDeveloperFee,
        dailyFee: settings.dailyFee,
        monthlyFee: settings.monthlyFee,
        perStampFee: settings.perStampFee,
        perStampDeveloperFee: settings.perStampDeveloperFee
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Record a shop payment from the owner dashboard
app.post('/api/shops/:shopSlug/payment', requireOwnerAuth, async (req, res) => {
  const { amount, referenceNumber, receiptImage } = req.body;
  try {
    const shop = await db.recordShopPayment(req.params.shopSlug, amount, referenceNumber, receiptImage);
    // Add payment notification for the Super Admin
    await db.addPaymentNotification(req.params.shopSlug, amount);
    const summary = await db.getShopBillingSummary(req.params.shopSlug);
    const settings = await db.getGlobalSettings();
    res.json({
      billingSummary: summary,
      paymentQr: settings.paymentQr,
      paymentInstructions: settings.paymentInstructions,
      payments: shop.payments || []
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update shop Specials / Menu
app.post('/api/shops/:shopSlug/specials', requireOwnerAuth, async (req, res) => {
  const { specials } = req.body;
  try {
    const shop = await db.updateShopSpecials(req.params.shopSlug, specials);
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update shop Logo (base64)
app.post('/api/shops/:shopSlug/logo', requireOwnerAuth, async (req, res) => {
  const { logo } = req.body;
  try {
    const shop = await db.updateShopLogo(req.params.shopSlug, logo);
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Add shop loyalty reward rule
app.post('/api/shops/:shopSlug/rewards', requireOwnerAuth, async (req, res) => {
  const { pointsRequired, rewardText } = req.body;
  if (!pointsRequired || !rewardText) {
    return res.status(400).json({ error: 'Points required and reward description are required.' });
  }
  try {
    const shop = await db.addShopReward(req.params.shopSlug, pointsRequired, rewardText);
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Activate a shop loyalty reward rule
app.post('/api/shops/:shopSlug/rewards/:rewardId/activate', requireOwnerAuth, async (req, res) => {
  try {
    const shop = await db.activateShopReward(req.params.shopSlug, req.params.rewardId);
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete a shop loyalty reward rule
app.delete('/api/shops/:shopSlug/rewards/:rewardId', requireOwnerAuth, async (req, res) => {
  try {
    const shop = await db.deleteShopReward(req.params.shopSlug, req.params.rewardId);
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Edit a shop loyalty reward rule
app.put('/api/shops/:shopSlug/rewards/:rewardId', requireOwnerAuth, async (req, res) => {
  const { pointsRequired, rewardText } = req.body;
  if (!pointsRequired || !rewardText) {
    return res.status(400).json({ error: 'Points required and reward description are required.' });
  }
  try {
    const shop = await db.editShopReward(req.params.shopSlug, req.params.rewardId, pointsRequired, rewardText);
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Customer Login / Registration via phone & name
app.post('/api/shops/:shopSlug/auth', checkShopSuspension, async (req, res) => {
  const { phone, name } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }
  try {
    const customer = await db.authCustomer(req.params.shopSlug, phone, name);
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Fetch Customer and associated Shop details
app.get('/api/customers/:customerId', async (req, res) => {
  try {
    const customer = await db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const shop = await db.getShop(customer.shopId);
    res.json({ customer, shop });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Increment Customer points (Owner Auth Required)
app.post('/api/customers/:customerId/add-point', requireOwnerAuth, checkShopSuspension, async (req, res) => {
  try {
    const customer = await db.addCustomerPoint(req.params.customerId);
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// --- REDEMPTION ENDPOINTS ---

// Initialize a pending redemption (requires maxPoints - Customer facing)
app.post('/api/customers/:customerId/redeem/init', checkShopSuspension, async (req, res) => {
  const { maxPoints } = req.body;
  try {
    const customer = await db.createPendingRedeem(req.params.customerId, parseInt(maxPoints) || 10);
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Cancel a pending redemption (Customer facing)
app.post('/api/customers/:customerId/redeem/cancel', checkShopSuspension, async (req, res) => {
  try {
    const customer = await db.cancelPendingRedeem(req.params.customerId);
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Direct redemption confirmation (e.g. from scanned QR url - Owner Auth Required)
app.post('/api/customers/:customerId/redeem/confirm-direct', requireOwnerAuth, checkShopSuspension, async (req, res) => {
  const { code } = req.body;
  try {
    const customer = await db.confirmRedemptionDirect(req.params.customerId, code);
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Shop redemption confirmation via 4-digit code (typed by owner - Owner Auth Required)
app.post('/api/shops/:shopSlug/redeem/confirm', requireOwnerAuth, checkShopSuspension, async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Redemption code is required.' });
  }
  try {
    const customer = await db.confirmRedemptionByCode(req.params.shopSlug, code);
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get shop redemption history (Owner Auth Required)
app.get('/api/shops/:shopSlug/redemptions', requireOwnerAuth, async (req, res) => {
  try {
    const history = await db.getRedemptionsByShop(req.params.shopSlug);
    res.json(history);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// --- SUPER ADMIN ENDPOINTS ---

// Superadmin login code check
app.post('/api/superadmin/login', (req, res) => {
  const { code } = req.body;
  if (code === '*12341234' || code === '12341234') {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid Super Admin code.' });
  }
});

// Get all shops (full metadata with credentials/suspension status)
app.get('/api/superadmin/shops', requireSuperAdminAuth, async (req, res) => {
  try {
    const fullShops = await db.getAllShopsFull();
    const shops = await Promise.all(fullShops.map(async (shop) => {
      const shopCopy = JSON.parse(JSON.stringify(shop));
      try {
        shopCopy.billingSummary = await db.getShopBillingSummary(shop.id);
      } catch (e) {
        shopCopy.billingSummary = null;
      }
      return shopCopy;
    }));
    res.json(shops);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Record a shop payment
app.post('/api/superadmin/shops/:shopSlug/payment', requireSuperAdminAuth, async (req, res) => {
  const { amount } = req.body;
  try {
    const shop = await db.recordShopPayment(req.params.shopSlug, amount, `ADMIN-${Date.now()}`);
    const latestPayment = shop.payments[shop.payments.length - 1];
    const confirmResult = await db.confirmPayment(latestPayment.id);
    
    const shopCopy = JSON.parse(JSON.stringify(confirmResult.shop));
    shopCopy.billingSummary = await db.getShopBillingSummary(shopCopy.id);
    res.json(shopCopy);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update store details
app.put('/api/superadmin/shops/:shopSlug', requireSuperAdminAuth, async (req, res) => {
  const { name, rule, ownerUsername, ownerPassword, trialExtensionDays } = req.body;
  try {
    const shop = await db.updateShopDetails(req.params.shopSlug, { name, rule, ownerUsername, ownerPassword, trialExtensionDays });
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Toggle suspension
app.post('/api/superadmin/shops/:shopSlug/suspend', requireSuperAdminAuth, async (req, res) => {
  const { isSuspended } = req.body;
  try {
    const shop = await db.suspendShop(req.params.shopSlug, isSuspended);
    res.json(shop);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete store
app.delete('/api/superadmin/shops/:shopSlug', requireSuperAdminAuth, async (req, res) => {
  try {
    await db.deleteShop(req.params.shopSlug);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get global settings (public endpoint)
app.get('/api/superadmin/settings', async (req, res) => {
  try {
    const settings = await db.getGlobalSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update global settings
app.post('/api/superadmin/settings', requireSuperAdminAuth, async (req, res) => {
  const { 
    paymentQr, 
    paymentInstructions, 
    subscriptionMethod, 
    onetimeSetupFee, 
    systemDeveloperFee,
    dailyFee, 
    monthlyFee, 
    perStampDeveloperFee,
    perStampFee 
  } = req.body;
  try {
    const settings = await db.updateGlobalSettings({ 
      paymentQr, 
      paymentInstructions, 
      subscriptionMethod, 
      onetimeSetupFee: onetimeSetupFee !== undefined ? onetimeSetupFee : systemDeveloperFee,
      systemDeveloperFee: systemDeveloperFee !== undefined ? systemDeveloperFee : onetimeSetupFee,
      dailyFee, 
      monthlyFee, 
      perStampDeveloperFee,
      perStampFee 
    });
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get payment notifications (Super Admin)
app.get('/api/superadmin/notifications', requireSuperAdminAuth, async (req, res) => {
  try {
    const notifications = await db.getPaymentNotifications();
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark all payment notifications as read (Super Admin)
app.post('/api/superadmin/notifications/read', requireSuperAdminAuth, async (req, res) => {
  try {
    const notifications = await db.markNotificationsAsRead();
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all payment notifications (Super Admin)
app.post('/api/superadmin/notifications/clear', requireSuperAdminAuth, async (req, res) => {
  try {
    const notifications = await db.clearNotifications();
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all store payments history & requests (Super Admin)
app.get('/api/superadmin/payments', requireSuperAdminAuth, async (req, res) => {
  try {
    const payments = await db.getAllPayments();
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify & Confirm a pending store payment (Super Admin)
app.post('/api/superadmin/payments/:paymentId/confirm', requireSuperAdminAuth, async (req, res) => {
  try {
    const result = await db.confirmPayment(req.params.paymentId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Superadmin static page route
app.get('/superadmin', (req, res) => {
  res.sendFile('superadmin.html', { root: path.join(__dirname, 'public') });
});

// --- PAGE ROUTING ---

// Redeem claim page (scanned by cashier)
app.get('/redeem/:customerId/:code', async (req, res) => {
  try {
    const customer = await db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).send('Customer not found');
    }
    res.sendFile('redeem.html', { root: path.join(__dirname, 'public') });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Scan page
app.get('/scan/:customerId', async (req, res) => {
  try {
    const customer = await db.getCustomer(req.params.customerId);
    if (!customer) {
      return res.status(404).send('Customer not found');
    }
    res.sendFile('scan.html', { root: path.join(__dirname, 'public') });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Shop Owner dashboard page
app.get('/:shopSlug/owner', async (req, res) => {
  try {
    const shop = await db.getShop(req.params.shopSlug);
    if (!shop) {
      return res.status(404).send('Shop not found');
    }
    res.sendFile('owner.html', { root: path.join(__dirname, 'public') });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Customer Loyalty Page (e.g. /cuptropic)
app.get('/:shopSlug', async (req, res) => {
  try {
    const shop = await db.getShop(req.params.shopSlug);
    if (!shop) {
      return res.status(404).send('Shop not found');
    }
    res.sendFile('customer.html', { root: path.join(__dirname, 'public') });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Default Fallback
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Digital Loyalty MVP Server running at http://localhost:${PORT}`);
});
