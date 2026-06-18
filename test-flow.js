const http = require('http');

const BASE_URL = 'http://localhost:3000';

function post(url, data, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data || {});
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...customHeaders
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          const err = new Error(body);
          err.statusCode = res.statusCode;
          err.body = body;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function put(url, data, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const putData = JSON.stringify(data || {});
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(putData),
        ...customHeaders
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          const err = new Error(body);
          err.statusCode = res.statusCode;
          err.body = body;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(putData);
    req.end();
  });
}

function get(url, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        ...customHeaders
      }
    };
    http.get(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          const err = new Error(body);
          err.statusCode = res.statusCode;
          err.body = body;
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function del(url, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'DELETE',
      headers: {
        ...customHeaders
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          const err = new Error(body);
          err.statusCode = res.statusCode;
          err.body = body;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Starting Automated Digital Loyalty Flow Verification...');

  try {
    const testId = Date.now();
    const testSlug = `cuptropic-test-${testId}`;
    const testPhone = `09${Math.floor(10000000 + Math.random() * 90000000)}`;
    const testUsername = `owner-${testId}`;
    const testPassword = `pass-${testId}`;
    const authHeaders = {
      'x-owner-username': testUsername,
      'x-owner-password': testPassword
    };
    const badHeaders = {
      'x-owner-username': testUsername,
      'x-owner-password': 'wrong-password'
    };

    // 1. Create a shop
    console.log(`1. Creating shop "${testSlug}" with owner "${testUsername}"...`);
    const shop = await post(`${BASE_URL}/api/shops`, {
      name: `Cuptropic Test ${testId}`,
      slug: testSlug,
      rule: '10 stamps = 1 free coffee',
      ownerUsername: testUsername,
      ownerPassword: testPassword
    });
    console.log('   ✓ Shop created successfully:', shop.id);

    // 1a. Test Owner Authentication Gate
    console.log('1a. Testing owner authentication gate security...');
    
    // Call without headers
    try {
      await post(`${BASE_URL}/api/shops/${testSlug}/rewards`, { pointsRequired: 15, rewardText: '1 free large fries' });
      throw new Error('Expected 401 status code, but request succeeded without headers.');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Blocked reward creation with missing headers');
      } else {
        throw err;
      }
    }

    // Call with incorrect headers
    try {
      await post(`${BASE_URL}/api/shops/${testSlug}/rewards`, { pointsRequired: 15, rewardText: '1 free large fries' }, badHeaders);
      throw new Error('Expected 401 status code, but request succeeded with invalid credentials.');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Blocked reward creation with incorrect credentials');
      } else {
        throw err;
      }
    }

    // 1b. Test Rewards Catalog Creation/Activation/Deletion
    console.log('1b. Testing dynamic rewards catalog operations (with authorization)...');
    
    // Add 15 stamps reward
    const shopWithNewReward = await post(`${BASE_URL}/api/shops/${testSlug}/rewards`, {
      pointsRequired: 15,
      rewardText: '1 free large fries'
    }, authHeaders);
    console.log('   ✓ Added reward option "1 free large fries" requiring 15 stamps');
    if (shopWithNewReward.rewards.length !== 2) throw new Error('Shop should have 2 rewards configured');
    
    const targetReward = shopWithNewReward.rewards.find(r => r.pointsRequired === 15);

    // Test PUT reward edit API
    console.log('1c. Testing PUT reward option edit endpoint...');
    
    // Edit with correct credentials
    const shopWithEditedReward = await put(`${BASE_URL}/api/shops/${testSlug}/rewards/${targetReward.id}`, {
      pointsRequired: 15,
      rewardText: '1 free extra large fries'
    }, authHeaders);
    console.log('   ✓ Edited reward option dynamically');
    const updatedReward = shopWithEditedReward.rewards.find(r => r.id === targetReward.id);
    if (updatedReward.rewardText !== '1 free extra large fries') {
      throw new Error('Reward text was not successfully edited');
    }

    // Try editing with bad credentials
    try {
      await put(`${BASE_URL}/api/shops/${testSlug}/rewards/${targetReward.id}`, {
        pointsRequired: 15,
        rewardText: '1 free huge fries'
      }, badHeaders);
      throw new Error('Expected 401 for invalid PUT reward edit');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Blocked unauthorized reward edits');
      } else {
        throw err;
      }
    }
    
    // Activate 15 stamps reward
    const shopWithActiveReward = await post(`${BASE_URL}/api/shops/${testSlug}/rewards/${targetReward.id}/activate`, {}, authHeaders);
    console.log('   ✓ Activated "1 free extra large fries" seasonal reward');
    if (!shopWithActiveReward.rewards.find(r => r.id === targetReward.id).isActive) {
      throw new Error('Reward should be active');
    }
    if (shopWithActiveReward.rule !== '15 stamps = 1 free extra large fries') {
      throw new Error('Shop rule text should be synced');
    }

    // Try deleting active reward (should fail)
    try {
      await del(`${BASE_URL}/api/shops/${testSlug}/rewards/${targetReward.id}`, authHeaders);
      throw new Error('Expected delete of active reward to fail.');
    } catch (err) {
      if (err.statusCode === 400) {
        console.log('   ✓ Confirmed active reward cannot be deleted');
      } else {
        throw err;
      }
    }

    // Delete default inactive reward
    const defaultReward = shopWithActiveReward.rewards.find(r => r.id === 'reward-default');
    const shopAfterDelete = await del(`${BASE_URL}/api/shops/${testSlug}/rewards/${defaultReward.id}`, authHeaders);
    console.log('   ✓ Deleted default inactive reward option');
    if (shopAfterDelete.rewards.length !== 1) throw new Error('Shop should have 1 reward remaining after delete');

    // 2. Register/auth customer
    console.log(`2. Registering customer with phone "${testPhone}" and name "Test User"...`);
    const authResult = await post(`${BASE_URL}/api/shops/${testSlug}/auth`, {
      phone: testPhone,
      name: 'Test User'
    });
    const customer = authResult.customer;
    console.log('   ✓ Customer registered successfully:', customer.id, `(${customer.name})`);
    if (customer.points !== 1) throw new Error('New customer points should be 1');
    if (customer.name !== 'Test User') throw new Error('Customer name should be "Test User"');

    // 3. Add point (Requires Auth)
    console.log('3. Awarding loyalty stamp point...');
    
    // Expect 401 without auth headers
    try {
      await post(`${BASE_URL}/api/customers/${customer.id}/add-point`);
      throw new Error('Expected add point to fail without auth headers.');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Blocked unauthorized point increment');
      } else {
        throw err;
      }
    }

    const updatedCustomer = await post(`${BASE_URL}/api/customers/${customer.id}/add-point`, {}, authHeaders);
    console.log('   ✓ Stamp awarded successfully. Current points:', updatedCustomer.points);
    if (updatedCustomer.points !== 2) throw new Error('Points should be 2 after award');

    // 4. Fetch details to confirm
    console.log('4. Fetching customer profile details to verify points persistent update...');
    let details = await get(`${BASE_URL}/api/customers/${customer.id}`);
    console.log('   ✓ Points verified in DB. Current customer points:', details.customer.points);
    if (details.customer.points !== 2) throw new Error('Points failed to persist');

    // 5. Add stamps in a loop to reach 15 points
    console.log('5. Awarding remaining stamps to reach 15 points...');
    for (let i = 0; i < 13; i++) {
      await post(`${BASE_URL}/api/customers/${customer.id}/add-point`, {}, authHeaders);
    }
    details = await get(`${BASE_URL}/api/customers/${customer.id}`);
    console.log('   ✓ Customer now has stamps:', details.customer.points);
    if (details.customer.points !== 15) throw new Error('Failed to reach 15 stamps');

    // 6. Initialize redemption code
    console.log('6. Initializing reward redemption request (generating 4-digit code)...');
    let claimInit = await post(`${BASE_URL}/api/customers/${customer.id}/redeem/init`, { maxPoints: 15 });
    const code = claimInit.pendingRedeem.code;
    console.log('   ✓ Reward claim code generated:', code);
    if (!code || code.length !== 4) throw new Error('Invalid code generated');

    // 7. Confirm redemption via code
    console.log(`7. Confirming redemption code "${code}" from owner endpoint...`);
    
    // Expect 401 without auth headers
    try {
      await post(`${BASE_URL}/api/shops/${testSlug}/redeem/confirm`, { code });
      throw new Error('Expected confirmation to fail without auth headers.');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Blocked unauthorized code redemption confirmation');
      } else {
        throw err;
      }
    }

    const claimConfirm = await post(`${BASE_URL}/api/shops/${testSlug}/redeem/confirm`, { code }, authHeaders);
    console.log('   ✓ Redemption confirmed. Remaining stamps:', claimConfirm.points);
    if (claimConfirm.points !== 0) throw new Error('Points should be 0 after redemption');

    // 8. Fetch shop redemptions history
    console.log('8. Fetching store redemptions history to verify claim tracking...');
    
    // Expect 401 without auth headers
    try {
      await get(`${BASE_URL}/api/shops/${testSlug}/redemptions`);
      throw new Error('Expected fetching history to fail without auth headers.');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Blocked unauthorized history access');
      } else {
        throw err;
      }
    }

    const history = await get(`${BASE_URL}/api/shops/${testSlug}/redemptions`, authHeaders);
    console.log('   ✓ History verified. Total claims listed:', history.length);
    if (history.length !== 1 || history[0].code !== code) throw new Error('Claim missing from shop history');

    // 9. Test Super Admin API endpoints
    console.log('\n9. Testing Super Admin Console APIs...');
    const superadminHeaders = { 'x-superadmin-code': '*12341234' };
    const badSuperadminHeaders = { 'x-superadmin-code': 'wrong-code' };

    // Login checks
    console.log('   Testing login code verification...');
    const loginOk = await post(`${BASE_URL}/api/superadmin/login`, { code: '*12341234' });
    if (!loginOk.success) throw new Error('Superadmin login request failed');
    try {
      await post(`${BASE_URL}/api/superadmin/login`, { code: 'wrong' });
      throw new Error('Expected invalid code login to fail');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Confirmed invalid login code blocked');
      } else {
        throw err;
      }
    }

    // List shops full (expect credentials)
    console.log('   Fetching all registered stores via superadmin...');
    const superShopsList = await get(`${BASE_URL}/api/superadmin/shops`, superadminHeaders);
    const superShopEntry = superShopsList.find(s => s.id === testSlug);
    if (!superShopEntry) throw new Error('Created shop not found in superadmin listings');
    if (superShopEntry.ownerUsername !== testUsername) throw new Error('Sensitive credentials missing from superadmin fetch');
    console.log('   ✓ Confirmed full shop credentials visible in superadmin list');

    // Reject listing for bad credentials
    try {
      await get(`${BASE_URL}/api/superadmin/shops`, badSuperadminHeaders);
      throw new Error('Expected 401 for unauthorized superadmin shops fetch');
    } catch (err) {
      if (err.statusCode === 401) {
        console.log('   ✓ Blocked unauthorized superadmin shops listing');
      } else {
        throw err;
      }
    }

    // Toggle suspension
    console.log(`   Suspending store "${testSlug}"...`);
    const suspendedShop = await post(`${BASE_URL}/api/superadmin/shops/${testSlug}/suspend`, { isSuspended: true }, superadminHeaders);
    if (!suspendedShop.isSuspended) throw new Error('Store was not successfully suspended');
    console.log('   ✓ Store status updated to suspended');

    // Verify operations fail for suspended store
    console.log('   Verifying point award rejects while store is suspended...');
    try {
      await post(`${BASE_URL}/api/shops/${testSlug}/auth`, { phone: '0911223344' });
      throw new Error('Expected customer registration auth to fail on suspended store');
    } catch (err) {
      if (err.statusCode === 403) {
        console.log('   ✓ Customer auth blocked for suspended store (403)');
      } else {
        throw err;
      }
    }

    try {
      await post(`${BASE_URL}/api/customers/${customer.id}/add-point`, {}, authHeaders);
      throw new Error('Expected point increment to fail on suspended store');
    } catch (err) {
      if (err.statusCode === 403) {
        console.log('   ✓ Point addition blocked for suspended store (403)');
      } else {
        throw err;
      }
    }

    // Unsuspend store
    console.log(`   Reactivating store "${testSlug}"...`);
    const activeShop = await post(`${BASE_URL}/api/superadmin/shops/${testSlug}/suspend`, { isSuspended: false }, superadminHeaders);
    if (activeShop.isSuspended) throw new Error('Store was not successfully unsuspended');
    console.log('   ✓ Store reactivated');

    // Edit store details
    console.log(`   Modifying store "${testSlug}" owner credentials...`);
    const updatedShopDetails = await put(`${BASE_URL}/api/superadmin/shops/${testSlug}`, {
      name: `Cuptropic Test Renamed`,
      rule: '15 stamps = 1 free extra large fries',
      ownerUsername: 'new-owner',
      ownerPassword: 'new-password'
    }, superadminHeaders);
    if (updatedShopDetails.name !== 'Cuptropic Test Renamed' || updatedShopDetails.ownerUsername !== 'new-owner') {
      throw new Error('Failed to update shop details');
    }
    console.log('   ✓ Shop credentials and name updated successfully');

    // Delete store
    console.log(`   Deleting store "${testSlug}"...`);
    const deleteRes = await del(`${BASE_URL}/api/superadmin/shops/${testSlug}`, superadminHeaders);
    if (!deleteRes.success) throw new Error('Failed to delete shop');
    
    // Assert shop deleted
    try {
      await get(`${BASE_URL}/api/shops/${testSlug}`);
      throw new Error('Expected shop metadata fetch to return 404 after deletion');
    } catch (err) {
      if (err.statusCode === 404) {
        console.log('   ✓ Confirmed shop record deleted permanently');
      } else {
        throw err;
      }
    }

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! The digital loyalty backend is fully functional with owner and super admin authentication.');
  } catch (error) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.statusCode ? `Status: ${error.statusCode}, Body: ${error.body}` : error.message);
    process.exit(1);
  }
}

// Check if server is running first, then start tests
http.get(BASE_URL, () => {
  runTests();
}).on('error', (err) => {
  console.error(`❌ Server is not running at ${BASE_URL}. Please run "node server.js" in another terminal before running tests.`);
  process.exit(1);
});

