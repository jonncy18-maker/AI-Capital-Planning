// Synthetic, deterministic fixture data for the mobile QA harness.
// Shapes follow db/migrations/*.sql + app/api/**/route.js SELECT lists.
// numeric columns are strings (neon http driver behaviour); ints stay numbers.

let seed = 20261015
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
let idc = 0
const uid = (p = 'a') => `${p}0000000-0000-4000-8000-${String(++idc).padStart(12, '0')}`
const num = n => String(Math.round(n * 100) / 100)
const pad = n => String(n).padStart(2, '0')

export const USER_ID = 'u0000000-0000-4000-8000-000000000001'
export const TODAY = new Date()
export const YEAR = TODAY.getFullYear()
export const MONTH = TODAY.getMonth() + 1
const NOW_ISO = new Date().toISOString()

// ── categories ───────────────────────────────────────────────────────────────
const CATS = [
  // [category, group, type, monthly]
  ['Paychecks', 'Income', 'Fixed', 0], ['Bonus', 'Income', 'Non-Monthly', 0], ['Interest & Dividends', 'Income', 'Flexible', 0],
  ['Mortgage', 'Housing', 'Fixed', 2850], ['Home Insurance', 'Housing', 'Fixed', 140], ['Electric & Gas Utilities', 'Housing', 'Flexible', 210],
  ['Water & Sewer', 'Housing', 'Flexible', 85], ['Internet & Cable Provider', 'Housing', 'Fixed', 95], ['Home Maintenance & Repairs', 'Housing', 'Flexible', 250],
  ['Car Payment', 'Transportation', 'Fixed', 540], ['Auto Insurance', 'Transportation', 'Fixed', 165], ['Gas & Fuel', 'Transportation', 'Flexible', 220],
  ['Parking & Tolls', 'Transportation', 'Flexible', 60], ['Auto Maintenance', 'Transportation', 'Non-Monthly', 120],
  ['Groceries', 'Food & Dining', 'Flexible', 950], ['Restaurants & Bars', 'Food & Dining', 'Flexible', 480], ['Coffee Shops', 'Food & Dining', 'Flexible', 90], ['Food Delivery Services', 'Food & Dining', 'Flexible', 120],
  ['Streaming Services', 'Entertainment', 'Fixed', 68], ['Movies, Concerts & Events', 'Entertainment', 'Flexible', 110], ['Hobbies & Games', 'Entertainment', 'Flexible', 80],
  ['Clothing & Accessories', 'Shopping', 'Flexible', 220], ['Electronics & Software', 'Shopping', 'Non-Monthly', 180], ['Household Goods & Supplies', 'Shopping', 'Flexible', 160],
  ['Medical & Dental', 'Health & Wellness', 'Flexible', 190], ['Pharmacy', 'Health & Wellness', 'Flexible', 55], ['Gym & Fitness Memberships', 'Health & Wellness', 'Fixed', 85],
  ['Health Insurance Premiums', 'Insurance', 'Fixed', 410], ['Life Insurance', 'Insurance', 'Fixed', 75],
  ['Tuition & School Fees', 'Education', 'Non-Monthly', 600], ['Books & Supplies', 'Education', 'Flexible', 70], ['Scholarship Support', 'Education', 'Fixed', 350],
  ['Flights & Airfare', 'Travel', 'Non-Monthly', 300], ['Hotels & Lodging', 'Travel', 'Non-Monthly', 260], ['Vacation Activities', 'Travel', 'Non-Monthly', 120],
  ['Gifts', 'Gifts & Donations', 'Non-Monthly', 140], ['Charitable Donations', 'Gifts & Donations', 'Fixed', 150], ['Family Support Remittance', 'Gifts & Donations', 'Fixed', 400],
  ['Personal Care & Salon', 'Personal', 'Flexible', 105], ['Pet Care & Vet', 'Personal', 'Flexible', 95], ['Phone Plan', 'Personal', 'Fixed', 110], ['Cash & ATM Withdrawals', 'Personal', 'Flexible', 120], ['Miscellaneous', 'Personal', 'Flexible', 60],
  ['Transfer', 'Transfers', 'Flexible', 0], ['Credit Card Payment', 'Transfers', 'Flexible', 0], ['Savings & Investment Transfers', 'Transfers', 'Flexible', 0],
]
const CC_MAP = { Groceries: 'groceries', 'Restaurants & Bars': 'dining', 'Coffee Shops': 'dining', 'Food Delivery Services': 'dining', 'Gas & Fuel': 'gas', 'Streaming Services': 'streaming', 'Flights & Airfare': 'travel', 'Hotels & Lodging': 'travel', 'Parking & Tolls': 'transit', 'Electronics & Software': 'online_shopping', Pharmacy: 'drugstore' }

export const categories = CATS.map(([category, group, type, m], i) => ({
  id: uid('c'), user_id: USER_ID, category, group, type,
  monthly_target: m ? num(m) : null, annual_target: type === 'Non-Monthly' ? num(m * 4) : null,
  is_active: true, created_at: NOW_ISO,
  exclude_from_totals: group === 'Transfers', cc_category: CC_MAP[category] ?? (group === 'Income' || group === 'Transfers' ? null : 'other'),
  cash_only: category === 'Cash & ATM Withdrawals', pinned_card_id: null,
}))
const expenseCats = categories.filter(c => c.group !== 'Income' && c.group !== 'Transfers')
const catByName = n => categories.find(c => c.category === n)

// ── transactions: 14 months back ─────────────────────────────────────────────
const MERCHANTS = {
  Groceries: ["Trader Joe's #512", 'Whole Foods Market Cherry Creek Denver CO', 'Safeway Store 1840', "Sprouts Farmers Market - Wash Park", 'Costco Wholesale Warehouse #1023 Aurora'],
  'Restaurants & Bars': ['The Cheesecake Factory - Cherry Creek', "Maggiano's Little Italy Banquet", 'Sweetgreen', 'Chipotle Mexican Grill 2231', 'The Original Pancake House and Cafe'],
  'Coffee Shops': ['Starbucks Store 09341', 'Blue Bottle Coffee', 'Dutch Bros'],
  'Food Delivery Services': ['DoorDash*Panda Express', 'Uber Eats Help.uber.com', 'Grubhub - Thai Basil Kitchen'],
  'Gas & Fuel': ['Shell Oil 57444291004', 'Chevron 0092417', 'King Soopers Fuel Center'],
  'Streaming Services': ['Netflix.com', 'Spotify USA', 'Disney Plus', 'YouTube Premium'],
  'Electric & Gas Utilities': ['Xcel Energy Autopay'],
  'Clothing & Accessories': ['Nordstrom Rack #0482', 'Uniqlo USA LLC', 'Amazon.com*2K4TT7ZB1 Amzn.com/bill'],
  'Household Goods & Supplies': ['Target 00012345', 'IKEA Centennial', 'Amazon.com*RT5JJ3SD0'],
  'Medical & Dental': ['Aspen Dental Management', 'Kaiser Permanente Copay'],
  Pharmacy: ['CVS/pharmacy #07724', 'Walgreens #12330'],
  'Gym & Fitness Memberships': ['Life Time Fitness Membership Dues'],
  'Personal Care & Salon': ['Great Clips #5871', 'Sephora 0412'],
  'Pet Care & Vet': ['Petco 1188', 'VCA Animal Hospitals - Greenwood Village'],
  'Phone Plan': ['Verizon Wireless Payment'],
  'Mortgage': ['Wells Fargo Home Mortgage Payment'],
  'Auto Insurance': ['GEICO Auto Premium'],
  'Car Payment': ['Toyota Financial Services'],
  'Internet & Cable Provider': ['Comcast Xfinity Internet'],
  'Water & Sewer': ['Denver Water Dept'],
  'Parking & Tolls': ['ParkMobile Denver Zone 4421', 'E-470 Toll Authority'],
  'Flights & Airfare': ['United Airlines 0162345678901', 'Delta Air Lines 0062199887766'],
  'Hotels & Lodging': ['Marriott Hotels - Waikiki Beach Resort & Spa'],
  Gifts: ['Etsy.com - HandmadeByAnnaMaria', 'Amazon Gift Cards'],
  'Charitable Donations': ['Doctors Without Borders USA'],
  'Family Support Remittance': ['Wise Transfer to Manila'],
  'Scholarship Support': ['NextGen Scholars Foundation ACH'],
  'Health Insurance Premiums': ['Anthem Blue Cross Premium'],
  'Life Insurance': ['Northwestern Mutual Life'],
  'Cash & ATM Withdrawals': ['ATM Withdrawal Chase 1900 Larimer St'],
  Miscellaneous: ['Venmo Payment', 'USPS PO 0813450123'],
  'Movies, Concerts & Events': ['AMC Theatres 3921', 'Ticketmaster - Red Rocks Amphitheatre'],
  'Electronics & Software': ['Apple.com/bill', 'Best Buy 00001234'],
  'Books & Supplies': ['Barnes & Noble #2641'],
  'Tuition & School Fees': ['Metropolitan State University Bursar'],
  'Home Maintenance & Repairs': ['Home Depot #1522', 'Ace Hardware'],
  'Auto Maintenance': ['Jiffy Lube #1134'],
  'Hobbies & Games': ['Steam Purchase'],
  'Vacation Activities': ['Viator Tours'],
  'Home Insurance': ['State Farm Homeowners'],
}
const ACCOUNTS = ['Chase Sapphire Preferred (...4421)', 'American Express Gold Card (...1005)', 'Capital One Venture X (...8832)', 'Citi Double Cash (...7710)', 'Chase Freedom Unlimited (...3098)', 'Discover it Cash Back (...2266)', 'Everyday Checking (...0912)']
export const transactions = []
function addTx(date, merchant, catName, amount, account) {
  const c = catByName(catName)
  transactions.push({
    id: uid('t'), user_id: USER_ID, date, merchant, category: catName, group: c?.group ?? null, account,
    amount: num(amount), original_statement: merchant.toUpperCase(), notes: null, owner: null, import_source: 'monarch', dedup_key: `${date}|${merchant}|${amount}|${account}`, created_at: NOW_ISO,
  })
}
for (let back = 14; back >= 0; back--) {
  const d0 = new Date(YEAR, MONTH - 1 - back, 1)
  const y = d0.getFullYear(), m = d0.getMonth() + 1
  const dim = new Date(y, m, 0).getDate()
  const isFuture = (day) => new Date(y, m - 1, day) > TODAY
  const emit = (day, merchant, cat, amt, acct) => { if (!isFuture(day)) addTx(`${y}-${pad(m)}-${pad(Math.min(day, dim))}`, merchant, cat, amt, acct) }
  emit(1, 'ACME CORP PAYROLL DIRECT DEP', 'Paychecks', 4650, ACCOUNTS[6])
  emit(15, 'ACME CORP PAYROLL DIRECT DEP', 'Paychecks', 4650, ACCOUNTS[6])
  if (m === 3 || m === 12) emit(20, 'ACME CORP ANNUAL BONUS PAYOUT', 'Bonus', 8200, ACCOUNTS[6])
  emit(28, 'Chase Savings Interest', 'Interest & Dividends', 42 + rnd() * 6, ACCOUNTS[6])
  emit(1, 'Wells Fargo Home Mortgage Payment', 'Mortgage', -2850, ACCOUNTS[6])
  emit(5, 'Toyota Financial Services', 'Car Payment', -540, ACCOUNTS[6])
  emit(9, 'GEICO Auto Premium', 'Auto Insurance', -165, ACCOUNTS[6])
  emit(12, 'Verizon Wireless Payment', 'Phone Plan', -110, ACCOUNTS[0])
  emit(14, 'Comcast Xfinity Internet', 'Internet & Cable Provider', -95, ACCOUNTS[4])
  emit(18, 'Anthem Blue Cross Premium', 'Health Insurance Premiums', -410, ACCOUNTS[6])
  emit(3, 'NextGen Scholars Foundation ACH', 'Scholarship Support', -350, ACCOUNTS[6])
  emit(7, 'Wise Transfer to Manila', 'Family Support Remittance', -400, ACCOUNTS[6])
  emit(22, 'Chase Credit Card Autopay', 'Credit Card Payment', -(2100 + rnd() * 900), ACCOUNTS[6])
  emit(25, 'Transfer to Vanguard Brokerage', 'Savings & Investment Transfers', -1200, ACCOUNTS[6])
  for (let k = 0; k < 17; k++) {
    const cat = pick(['Groceries', 'Groceries', 'Restaurants & Bars', 'Restaurants & Bars', 'Coffee Shops', 'Food Delivery Services', 'Gas & Fuel', 'Streaming Services', 'Clothing & Accessories', 'Household Goods & Supplies', 'Pharmacy', 'Medical & Dental', 'Personal Care & Salon', 'Pet Care & Vet', 'Parking & Tolls', 'Electric & Gas Utilities', 'Water & Sewer', 'Gym & Fitness Memberships', 'Movies, Concerts & Events', 'Miscellaneous', 'Cash & ATM Withdrawals', 'Home Maintenance & Repairs', 'Electronics & Software', 'Gifts', 'Hobbies & Games'])
    const merchant = pick(MERCHANTS[cat] ?? ['Misc Merchant'])
    const base = (catByName(cat).monthly_target ? Number(catByName(cat).monthly_target) : 60)
    emit(1 + Math.floor(rnd() * 28), merchant, cat, -(base / 3) * (0.4 + rnd() * 1.2), pick(ACCOUNTS.slice(0, 6)))
  }
  if (m % 4 === 2) { emit(10, 'United Airlines 0162345678901', 'Flights & Airfare', -(420 + rnd() * 500), ACCOUNTS[2]); emit(16, 'Marriott Hotels - Waikiki Beach Resort & Spa', 'Hotels & Lodging', -(780 + rnd() * 300), ACCOUNTS[2]) }
  if (m === 8 || m === 1) emit(12, 'Metropolitan State University Bursar', 'Tuition & School Fees', -1850, ACCOUNTS[6])
}
transactions.sort((a, b) => (a.date < b.date ? 1 : -1))

// ── budget line items ────────────────────────────────────────────────────────
const nested = c => ({ id: c.id, category: c.category, group: c.group, type: c.type })
function lineItemsFor(year, source) {
  const out = []
  for (const c of expenseCats) {
    const base = Number(c.monthly_target)
    const months = c.type === 'Non-Monthly' ? (c.category.startsWith('Flights') || c.category.startsWith('Hotels') ? [2, 6, 11] : c.category.startsWith('Tuition') ? [1, 8] : [3, 6, 9, 12]) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    for (const mo of months) {
      const amt = c.type === 'Non-Monthly' ? base * (months.length > 2 ? 1.2 : 2) : base * (c.type === 'Flexible' ? 0.9 + ((mo * 7) % 5) * 0.05 : 1)
      out.push({ id: uid('b'), user_id: USER_ID, budget_year: year, budget_version: 'v1', category_id: c.id, month: mo, amount: num(amt), label: null, commitment_id: null, created_at: NOW_ISO, note: null, source, updated_at: NOW_ISO, source_scenario_id: null, budget_categories: nested(c) })
    }
  }
  // extra labelled lines (multiple line items per category-month)
  for (const nm of ['Groceries', 'Restaurants & Bars', 'Home Maintenance & Repairs']) {
    const c = catByName(nm)
    for (let mo = 1; mo <= 12; mo++) out.push({ id: uid('b'), user_id: USER_ID, budget_year: year, budget_version: 'v1', category_id: c.id, month: mo, amount: num(60 + mo * 3), label: nm === 'Groceries' ? 'Costco bulk run' : nm === 'Restaurants & Bars' ? 'Date night / birthdays' : 'HVAC filter + yard', commitment_id: null, created_at: NOW_ISO, note: null, source, updated_at: NOW_ISO, source_scenario_id: null, budget_categories: nested(c) })
  }
  for (const nm of ['Paychecks']) {
    const c = catByName(nm)
    for (let mo = 1; mo <= 12; mo++) out.push({ id: uid('b'), user_id: USER_ID, budget_year: year, budget_version: 'v1', category_id: c.id, month: mo, amount: num(9300), label: null, commitment_id: null, created_at: NOW_ISO, note: null, source, updated_at: NOW_ISO, source_scenario_id: null, budget_categories: nested(c) })
  }
  return out
}
export const budgetItemsByYear = { [YEAR - 1]: lineItemsFor(YEAR - 1, 'seed'), [YEAR]: lineItemsFor(YEAR, 'seed'), [YEAR + 1]: lineItemsFor(YEAR + 1, 'seed') }
export const forecastItems = budgetItemsByYear[YEAR].map((li, i) => ({ ...li, id: uid('f'), source: i % 11 === 0 ? 'manual' : 'seed', label: i % 11 === 0 ? 'Adjusted for actuals' : li.label }))
export const forecastOverrides = expenseCats.slice(0, 8).map((c, i) => ({ id: uid('o'), user_id: USER_ID, category_id: c.id, budget_year: YEAR, month: MONTH + (i % 3), amount: num(Number(c.monthly_target) * 1.4), note: 'Override', updated_at: NOW_ISO, budget_categories: nested(c) })).filter(o => o.month <= 12)

// ── commitments ──────────────────────────────────────────────────────────────
const sd = (y, m) => `${y}-${pad(m)}-01`
export const commitments = [
  { name: 'Scholar Support: Janndilyne (BSN)', type: 'scholarship', start_date: sd(YEAR - 1, 6), end_date: sd(YEAR + 2, 5), cost_structure: { kind: 'monthly', amount: 350 }, split_rules: { 'Scholarship Support': 1 } },
  { name: 'Family Support - Manila household and tuition for siblings', type: 'family_support', start_date: sd(YEAR - 2, 1), end_date: null, cost_structure: { kind: 'monthly', amount: 400 }, split_rules: { 'Family Support Remittance': 0.7, 'Tuition & School Fees': 0.3 } },
  { name: 'Mortgage Escrow True-up', type: 'lease', start_date: sd(YEAR, 1), end_date: sd(YEAR + 5, 12), cost_structure: { kind: 'annual', amount: 1800, month: 4 }, split_rules: { Mortgage: 1 } },
  { name: 'Nursing Board Exam & Licensure Fees', type: 'scholarship', start_date: sd(YEAR, 3), end_date: sd(YEAR + 1, 9), cost_structure: { kind: 'total', amount: 9600 }, split_rules: { 'Tuition & School Fees': 1 } },
  { name: 'Eldercare Respite Program', type: 'eldercare', start_date: sd(YEAR, 5), end_date: sd(YEAR + 1, 4), cost_structure: { kind: 'custom', schedule: { '1': 300, '2': 300, '3': 450, '6': 900, '9': 450, '12': 1200 } }, split_rules: { 'Medical & Dental': 0.5, Gifts: 0.5 } },
  { name: 'Solar Panel Lease', type: 'lease', start_date: sd(YEAR - 1, 2), end_date: sd(YEAR + 8, 1), cost_structure: { kind: 'monthly', amount: 189 }, split_rules: {} },
].map((c, i) => ({ id: uid('m'), user_id: USER_ID, status: i === 5 ? 'paused' : 'active', notes: i % 2 ? 'Reviewed with family in July.' : null, created_at: NOW_ISO, ...c }))

// ── credit cards ─────────────────────────────────────────────────────────────
const CARD_DEFS = [
  ['Sapphire Preferred', 'Chase', 'visa', '4421', 'Chase Ultimate Rewards', 12, 95, '#1a56db', true],
  ['Gold Card', 'American Express', 'amex', '1005', 'Amex Membership Rewards', 24, 250, '#b7791f', false],
  ['Venture X', 'Capital One', 'visa', '8832', 'Capital One Miles', 3, 395, '#2d3748', false],
  ['Double Cash', 'Citi', 'mastercard', '7710', 'Citi ThankYou', 18, 0, '#e53e3e', false],
  ['Freedom Unlimited', 'Chase', 'visa', '3098', 'Chase Ultimate Rewards', 12, 0, '#2b6cb0', false],
  ['Discover it Cash Back', 'Discover', 'discover', '2266', null, 28, 0, '#dd6b20', false],
]
export const cards = CARD_DEFS.map(([name, issuer, network, last_four, points_program, close, fee, color, def], i) => ({
  id: uid('k'), user_id: USER_ID, name, issuer, network, last_four, points_program, is_default: def, statement_close_day: close, due_days_after_close: 21,
  annual_fee: fee ? num(fee) : null, annual_fee_month: fee ? ((i * 3) % 12) + 1 : null, points_value_cents: num(1.25), color, active: true, display_order: i, created_at: NOW_ISO,
}))
const CCCATS = ['dining', 'travel', 'groceries', 'gas', 'streaming', 'transit', 'online_shopping', 'drugstore', 'other']
export const earnRates = cards.flatMap((c, i) => CCCATS.map((cc, j) => ({ id: uid('e'), card_id: c.id, user_id: USER_ID, cc_category: cc, earn_rate: num(1 + ((i + j) % 4)), created_at: NOW_ISO })))
export const pointsLatest = Object.fromEntries(cards.slice(0, 5).map((c, i) => [c.id, { id: uid('p'), card_id: c.id, user_id: USER_ID, balance: 24500 + i * 17300, as_of_date: `${YEAR}-${pad(MONTH)}-01`, created_at: NOW_ISO }]))
export const redemptions = [{ id: uid('r'), card_id: cards[0].id, user_id: USER_ID, year: YEAR, month: Math.max(1, MONTH - 2), points_amount: 40000, description: 'Statement credit - Hawaii flights', created_at: NOW_ISO }]
export const txnAccounts = ACCOUNTS.map((a, i) => ({ account: a, txn_count: 120 - i * 12 }))

// ── accounts / bills ─────────────────────────────────────────────────────────
export const accounts = [
  { name: 'Everyday Checking (...0912)', type: 'checking', is_primary_checking: true }, { name: 'High-Yield Savings', type: 'savings', is_primary_checking: false },
  { name: 'Vanguard Brokerage', type: 'investment', is_primary_checking: false }, { name: 'Joint Checking with a very long account name for wrapping', type: 'checking', is_primary_checking: false },
].map((a, i) => ({ id: uid('x'), user_id: USER_ID, display_order: i, active: true, created_at: NOW_ISO, ...a }))
const BILL_DEFS = [
  ['Mortgage - Wells Fargo Home Mortgage', 'loan', 1, 1, 'auto', 2850, 'Mortgage'], ['Car Loan (Toyota Financial)', 'loan', 5, 5, 'auto', 540, 'Car Payment'], ['Chase Sapphire Preferred', 'credit_card', 2, 4, 'manual', null, null, 0],
  ['American Express Gold Card', 'credit_card', 14, 16, 'manual', null, null, 1], ['Netflix / Spotify / Disney+ bundle', 'subscription', 20, 20, 'auto', 68, 'Streaming Services'], ['Vanguard Roth IRA Contribution', 'investment', 25, 25, 'auto', 583, null],
  ['Xcel Energy electric and natural gas', 'other', 10, 10, 'manual', null, 'Electric & Gas Utilities'], ['Capital One Venture X', 'credit_card', 24, 26, 'manual', null, null, 2],
]
export const bills = BILL_DEFS.map(([name, bill_type, due_day, pay_day, payment_method, fixed, cat, cardIdx], i) => ({
  id: uid('l'), user_id: USER_ID, name, bill_type, due_day, pay_same_as_due: due_day === pay_day, pay_day, payment_method, fixed_amount: fixed ? num(fixed) : null,
  debits_from_account_id: accounts[0].id, active: true, display_order: i, is_auto_funded: false, auto_fund_account_id: null, auto_fund_day: null, auto_fund_amount: null, created_at: NOW_ISO,
  forecast_category_id: cat ? catByName(cat).id : null, forecast_divisor: 1, statement_close_day: bill_type === 'credit_card' ? cards[cardIdx].statement_close_day : null,
  credit_card_id: bill_type === 'credit_card' ? cards[cardIdx].id : null, actuals_category: null, exclude_from_schedule: false,
}))
export const billAmounts = bills.flatMap(b => [0, 1, 2, 3].map(k => {
  const d = new Date(YEAR, MONTH - 1 - k, 1)
  return { id: uid('n'), bill_id: b.id, user_id: USER_ID, year: d.getFullYear(), month: d.getMonth() + 1, amount: num(b.fixed_amount ? Number(b.fixed_amount) : 900 + rnd() * 1800), notes: null, created_at: NOW_ISO, items: null, item_revision: 0 }
}))
export const accountBalances = accounts.slice(0, 3).flatMap((a, i) => [1, 2].map(h => ({
  id: uid('y'), account_id: a.id, user_id: USER_ID, year: YEAR, month: MONTH, period_half: h, balance: num(12000 + i * 40000 + h * 800), created_at: NOW_ISO,
  account: { id: a.id, name: a.name, type: a.type, is_primary_checking: a.is_primary_checking },
})))

// ── scenarios ────────────────────────────────────────────────────────────────
const scen = (name, state, description, extra = {}) => ({ id: uid('s'), user_id: USER_ID, name, description, state, parent_baseline: null, created_at: NOW_ISO, committed_at: state === 'committed' ? NOW_ISO : null, ...extra })
export const scenarios = [
  scen('Second child - childcare and larger car', 'modeled', 'Models daycare from June, a minivan swap, and extra grocery spend for the household.'),
  scen('Move to a smaller home and downsize mortgage payment', 'committed', 'Sell and move in September: lower mortgage, higher one-time moving costs.'),
  scen('Sabbatical year', 'idea', 'Idea only: six months at half income, travel through Southeast Asia.'),
  scen('Pay off car loan early', 'modeled', 'Extra principal of $1,000 a month until payoff.'),
]
export const adjustments = {}
for (const s of scenarios) {
  const rows = []
  const pickCats = s.state === 'idea' ? [] : expenseCats.filter((_, i) => i % 5 === 0).slice(0, 6)
  for (const c of pickCats) for (let mo = Math.min(12, MONTH); mo <= 12; mo += 2) rows.push({ id: uid('j'), user_id: USER_ID, scenario_id: s.id, category_id: c.id, month: mo, year: YEAR, delta_amount: num((mo % 3 ? 1 : -1) * (150 + mo * 20)), label: mo % 4 === 0 ? 'Moving truck + deposits (one-time)' : null, created_at: NOW_ISO, budget_categories: { category: c.category, group: c.group, type: c.type } })
  adjustments[s.id] = rows
}
export const outlookAdj = scenarios.filter(s => s.state === 'committed').map(s => ({ id: uid('q'), user_id: USER_ID, scenario_id: s.id, year: YEAR + 1, group_name: 'Housing', delta_amount: -4800, label: 'Smaller mortgage', created_at: NOW_ISO, scenario_state: 'committed' }))
export const outlookEvents = [{ id: uid('v'), user_id: USER_ID, year: YEAR + 2, group_name: 'Transportation', name: 'Replace the car', amount: 32000, created_at: NOW_ISO }, { id: uid('v'), user_id: USER_ID, year: YEAR + 3, group_name: 'Education', name: 'Master of Science in Nursing tuition', amount: 18000, created_at: NOW_ISO }]

// ── wealth ───────────────────────────────────────────────────────────────────
export const wealthSnapshots = Array.from({ length: 18 }, (_, i) => {
  const d = new Date(YEAR, MONTH - 1 - i, 1)
  const nw = 412000 - i * 6900 + (i % 3) * 1500
  return { id: uid('w'), user_id: USER_ID, snapshot_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, net_worth: num(nw), investment_balance: num(nw * 0.35), retirement_balance: num(nw * 0.45), other_assets: num(nw * 0.55), liabilities: num(nw * 0.35), notes: i === 0 ? 'Latest snapshot' : null, created_at: NOW_ISO, emergency_cash: num(28000 - i * 200), investment_contributions_ytd: num(15000 - i * 500) }
})
export const wealthPlans = [{ id: uid('z'), user_id: USER_ID, name: 'Retire at 62 base plan', start_date: `${YEAR}-${pad(MONTH)}-01`, start_balance: '265000', monthly_contribution: '2400', annual_return: '0.06', horizon: 25, retirement_target: '2000000', emergency_cash_target: '30000', starting_contributions_ytd: '9500', annual_contributions: {}, annual_contributions_without_commitments: {}, annual_commitment_drain: '9000', include_commitments: true, created_at: NOW_ISO }]

// ── profile / misc ───────────────────────────────────────────────────────────
export const profile = {
  id: USER_ID, focuses: ['budget', 'forecast'], commitments: ['scholarship'], planning_horizon: [5, 10], period_options: ['monthly'], period_default: 'monthly', data_path: 'import', onboarding_complete: true,
  created_at: NOW_ISO, updated_at: NOW_ISO, annual_income: '214000', annual_bonus: '16400', savings_goal_amount: null, savings_goal_pct: '20', savings_goal_type: 'pct',
  tax_profile: { filingStatus: 'mfj', state: 'CO', preTax401k: 23000, preTaxOther: 3600 }, cc_coverage_pct: 80, cc_optimization_pct: 100, min_checking_balance: '5000',
  variance_threshold: 10, bonus_month: 3, benefits_amount: '410', benefits_pct: null, four01k_pct: '10', four01k_on_bonus: true, pay_frequency: 'semi_monthly', pay_day_1: 1, pay_day_2: 15,
}
export const taxBrackets = [
  { id: 1, year: YEAR, jurisdiction: 'federal', filing_status: 'single', brackets: [{ upTo: 12400, rate: 0.1 }, { upTo: 50400, rate: 0.12 }, { upTo: 105700, rate: 0.22 }, { upTo: 201775, rate: 0.24 }, { upTo: 256225, rate: 0.32 }, { upTo: 640600, rate: 0.35 }, { upTo: null, rate: 0.37 }], standard_deduction: '16100', meta: null },
  { id: 2, year: YEAR, jurisdiction: 'federal', filing_status: 'mfj', brackets: [{ upTo: 24800, rate: 0.1 }, { upTo: 100800, rate: 0.12 }, { upTo: 211400, rate: 0.22 }, { upTo: 403550, rate: 0.24 }, { upTo: 512450, rate: 0.32 }, { upTo: 768700, rate: 0.35 }, { upTo: null, rate: 0.37 }], standard_deduction: '32200', meta: null },
  { id: 3, year: YEAR, jurisdiction: 'fica', filing_status: 'all', brackets: null, standard_deduction: null, meta: { ssRate: 0.062, ssWageBase: 184500, medicareRate: 0.0145, addlMedicareRate: 0.009, addlMedicareThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 } } },
  { id: 4, year: YEAR, jurisdiction: 'CO', filing_status: 'all', brackets: null, standard_deduction: null, meta: { rate: 0.0425 } },
]
export const incomeActuals = Array.from({ length: 14 }, (_, i) => { const d = new Date(YEAR, MONTH - 1 - i, 1); return { id: uid('i'), user_id: USER_ID, year: d.getFullYear(), month: d.getMonth() + 1, amount: num(9300 + (i % 3 === 0 ? 8200 : 0)), source: 'pulled', notes: null, created_at: NOW_ISO } })
export const user = { id: USER_ID, email: 'qa@example.test', name: 'QA Tester', emailVerified: true, image: null, createdAt: NOW_ISO, updatedAt: NOW_ISO }
