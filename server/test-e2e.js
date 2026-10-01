/**
 * ITS Full End-to-End System Test Suite
 */

const { getDb } = require('./db/database');

async function runTests() {
  console.log('🧪 Starting ITS System Integration Tests...\n');

  const BASE = 'http://localhost:3000';
  let cookieUser = '';
  let cookieAdmin = '';
  let cookieTech = '';

  const db = getDb();

  // 1. Get Seeded Admin & Tech User IDs
  const adminRow = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const techRow = db.prepare("SELECT * FROM users WHERE role = 'technician' LIMIT 1").get();

  console.log(`✓ Seeded Admin: ${adminRow.user_id} (${adminRow.email})`);
  console.log(`✓ Seeded Tech:  ${techRow.user_id} (${techRow.email})`);

  // 2. Test Registration
  console.log('\n--- Test 1: User Registration ---');
  const regEmail = `testuser_${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Test Employee',
      email: regEmail,
      department: 'Marketing',
      password: 'Password123',
      confirm_password: 'Password123'
    })
  });
  const regData = await regRes.json();
  console.log(`Registration HTTP ${regRes.status}:`, regData.message, 'User ID:', regData.user_id);
  if (!regData.user_id || !regData.user_id.startsWith('ITS-')) {
    throw new Error('Registration failed to generate ITS-XXXXXX user ID');
  }

  // 3. Verify Account is unconfirmed and blocked from login
  console.log('\n--- Test 2: Unconfirmed Login Block ---');
  const preLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: regData.user_id,
      password: 'Password123'
    })
  });
  const preLoginData = await preLoginRes.json();
  console.log(`Pre-confirmation login HTTP ${preLoginRes.status}:`, preLoginData.error);
  if (preLoginRes.status !== 403 || preLoginData.code !== 'UNCONFIRMED') {
    throw new Error('Expected 403 UNCONFIRMED for unconfirmed account');
  }

  // 4. Confirm Email via Token
  console.log('\n--- Test 3: Confirm Email Token ---');
  const userRow = db.prepare('SELECT id FROM users WHERE user_id = ?').get(regData.user_id);
  const tokenRow = db.prepare("SELECT token FROM email_tokens WHERE user_id = ? AND type = 'confirm' AND used = 0").get(userRow.id);
  if (!tokenRow) throw new Error('No confirm token found in DB');

  const confirmRes = await fetch(`${BASE}/api/auth/confirm-email?token=${tokenRow.token}`);
  const confirmData = await confirmRes.json();
  console.log(`Email confirm HTTP ${confirmRes.status}:`, confirmData.message);
  if (confirmRes.status !== 200) throw new Error('Failed to confirm email');

  // 5. Login as newly confirmed User
  console.log('\n--- Test 4: Authenticated Login ---');
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: regData.user_id,
      password: 'Password123'
    })
  });
  const loginData = await loginRes.json();
  console.log(`User login HTTP ${loginRes.status}:`, loginData.message, 'Role:', loginData.user?.role);
  if (loginRes.status !== 200) throw new Error('Failed to login after confirmation');
  cookieUser = loginRes.headers.get('set-cookie');

  // Login as Tech
  const techLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: techRow.user_id, password: 'Tech1234' })
  });
  cookieTech = techLoginRes.headers.get('set-cookie');
  console.log(`Tech login HTTP ${techLoginRes.status}: Tech:`, (await techLoginRes.json()).user?.full_name);

  // Login as Admin
  const adminLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: adminRow.user_id, password: 'Admin1234' })
  });
  cookieAdmin = adminLoginRes.headers.get('set-cookie');
  console.log(`Admin login HTTP ${adminLoginRes.status}: Admin:`, (await adminLoginRes.json()).user?.full_name);

  // 6. Test Knowledge Base Real-Time Search
  console.log('\n--- Test 5: Knowledge Base Search ---');
  const kbSearchRes = await fetch(`${BASE}/api/kb/search?q=VPN`, {
    headers: { 'Cookie': cookieUser }
  });
  const kbSearchData = await kbSearchRes.json();
  console.log(`KB search query 'VPN' returned:`, kbSearchData.articles.map(a => a.title));
  if (!kbSearchData.articles.length) throw new Error('Expected at least 1 KB match for VPN');

  // 7. Create a Support Ticket
  console.log('\n--- Test 6: Create Ticket ---');
  const ticketRes = await fetch(`${BASE}/api/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieUser
    },
    body: JSON.stringify({
      title: 'VPN Connection dropping every 5 minutes',
      category: 'Network',
      priority: 'High',
      description: 'Whenever I connect to the company VPN from my home fiber network, the connection terminates after 5 minutes.'
    })
  });
  const ticketData = await ticketRes.json();
  console.log(`Create ticket HTTP ${ticketRes.status}: Ticket ID:`, ticketData.ticket?.ticket_id);
  if (!ticketData.ticket?.ticket_id) throw new Error('Ticket creation failed');
  const createdTicketId = ticketData.ticket.ticket_id;

  // 8. Public Comment from User
  console.log('\n--- Test 7: Public User Comment ---');
  const comment1Res = await fetch(`${BASE}/api/tickets/${createdTicketId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieUser },
    body: JSON.stringify({ body: 'I noticed this started happening after yesterday Windows update.' })
  });
  console.log(`User comment HTTP ${comment1Res.status}`);

  // 9. Technician adds Internal Note (Hidden from regular user)
  console.log('\n--- Test 8: Technician Internal Note ---');
  const noteRes = await fetch(`${BASE}/api/tickets/${createdTicketId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieTech },
    body: JSON.stringify({
      body: 'Verified RADIUS server logs — gateway MTU needs to be adjusted for this user subnet.',
      is_internal: true
    })
  });
  console.log(`Internal note HTTP ${noteRes.status}`);

  // Verify User DOES NOT see internal note
  const userTicketView = await (await fetch(`${BASE}/api/tickets/${createdTicketId}`, { headers: { 'Cookie': cookieUser } })).json();
  const techTicketView = await (await fetch(`${BASE}/api/tickets/${createdTicketId}`, { headers: { 'Cookie': cookieTech } })).json();
  console.log(`Comments seen by User: ${userTicketView.comments.length}, Comments seen by Tech: ${techTicketView.comments.length}`);
  if (userTicketView.comments.some(c => c.is_internal)) {
    throw new Error('SECURITY VIOLATION: User can see internal technician note!');
  }
  if (!techTicketView.comments.some(c => c.is_internal)) {
    throw new Error('Technician failed to see internal note');
  }
  console.log('✓ Internal notes access control verified strictly isolated!');

  // 10. Technician Updates Status to Resolved
  console.log('\n--- Test 9: Ticket Resolution & Assignment ---');
  const patchRes = await fetch(`${BASE}/api/tickets/${createdTicketId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieTech },
    body: JSON.stringify({
      status: 'Resolved',
      assignee_id: techRow.id
    })
  });
  const patchData = await patchRes.json();
  console.log(`Update ticket HTTP ${patchRes.status}: Status is now:`, patchData.ticket?.status);
  if (patchData.ticket?.status !== 'Resolved') throw new Error('Failed to resolve ticket');

  // 11. User Rates Resolved Ticket (5 Stars + Feedback)
  console.log('\n--- Test 10: 5-Star Customer Rating ---');
  const rateRes = await fetch(`${BASE}/api/tickets/${createdTicketId}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieUser },
    body: JSON.stringify({
      stars: 5,
      comment: 'Super fast turnaround! VPN is stable now. Thank you Alex!'
    })
  });
  const rateData = await rateRes.json();
  console.log(`Rating HTTP ${rateRes.status}:`, rateData.message);
  if (rateRes.status !== 200) throw new Error('Rating submission failed');

  // 12. Admin Reports & Analytics
  console.log('\n--- Test 11: Admin Reports & Metrics ---');
  const reportsRes = await fetch(`${BASE}/api/admin/reports`, {
    headers: { 'Cookie': cookieAdmin }
  });
  const reports = await reportsRes.json();
  console.log(`Total resolved tickets reported:`, reports.byStatus);
  console.log(`Average satisfaction:`, reports.avgSatisfaction);
  if (!reports.byStatus || !reports.byCategory) throw new Error('Failed to fetch admin reports');

  // 13. Forgot User ID flow
  console.log('\n--- Test 12: Forgot User ID Flow ---');
  const forgotIdRes = await fetch(`${BASE}/api/auth/forgot-user-id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: regEmail })
  });
  console.log(`Forgot User ID HTTP ${forgotIdRes.status}:`, (await forgotIdRes.json()).message);

  // 14. Forgot Password & Reset Password flow
  console.log('\n--- Test 13: Password Reset Flow ---');
  const forgotPwRes = await fetch(`${BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: regData.user_id })
  });
  console.log(`Forgot Password HTTP ${forgotPwRes.status}:`, (await forgotPwRes.json()).message);

  const resetTokenRow = db.prepare("SELECT token FROM email_tokens WHERE user_id = ? AND type = 'reset' AND used = 0").get(userRow.id);
  if (!resetTokenRow) throw new Error('Reset token was not generated');

  const resetPwRes = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: resetTokenRow.token,
      password: 'NewPassword999',
      confirm_password: 'NewPassword999'
    })
  });
  console.log(`Reset Password HTTP ${resetPwRes.status}:`, (await resetPwRes.json()).message);

  // Test login with new password
  const newLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: regData.user_id,
      password: 'NewPassword999'
    })
  });
  console.log(`Login with new password HTTP ${newLoginRes.status}:`, (await newLoginRes.json()).message);
  if (newLoginRes.status !== 200) throw new Error('Failed to login with new reset password');

  console.log('\n🎉 ALL 13 TEST SUITES PASSED FLAWLESSLY! 🚀\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
