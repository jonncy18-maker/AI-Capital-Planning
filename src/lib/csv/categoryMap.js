// Maps Monarch Money category names → { group, type } for our budget_categories schema.
// Expenses are categorized as Fixed / Flexible / Non-Monthly.
// Income rows keep group 'Income'. Transfers keep group 'Transfers'.
//
// Any category not found here is surfaced to the user during import as "unmapped."

export const MONARCH_CATEGORY_MAP = {
  // ── Housing ────────────────────────────────────────────────────────────────
  'Rent': { group: 'Housing', type: 'Fixed' },
  'Mortgage': { group: 'Housing', type: 'Fixed' },
  'Home Insurance': { group: 'Housing', type: 'Fixed' },
  'Renters Insurance': { group: 'Housing', type: 'Fixed' },
  'HOA Fees': { group: 'Housing', type: 'Fixed' },
  'Home Maintenance': { group: 'Housing', type: 'Flexible' },
  'Home Improvement': { group: 'Housing', type: 'Flexible' },
  'Lawn & Garden': { group: 'Housing', type: 'Flexible' },
  'Furniture': { group: 'Housing', type: 'Flexible' },
  'Utilities': { group: 'Housing', type: 'Flexible' },
  'Electric': { group: 'Housing', type: 'Flexible' },
  'Gas': { group: 'Housing', type: 'Flexible' },
  'Water': { group: 'Housing', type: 'Flexible' },
  'Internet': { group: 'Housing', type: 'Fixed' },
  'Cable': { group: 'Housing', type: 'Fixed' },
  'Phone': { group: 'Housing', type: 'Fixed' },

  // ── Transportation ─────────────────────────────────────────────────────────
  'Auto & Transport': { group: 'Transportation', type: 'Flexible' },
  'Auto Insurance': { group: 'Transportation', type: 'Fixed' },
  'Car Insurance': { group: 'Transportation', type: 'Fixed' },
  'Auto Payment': { group: 'Transportation', type: 'Fixed' },
  'Car Payment': { group: 'Transportation', type: 'Fixed' },
  'Auto Loan': { group: 'Transportation', type: 'Fixed' },
  'Car Lease': { group: 'Transportation', type: 'Fixed' },
  'Gas & Fuel': { group: 'Transportation', type: 'Flexible' },
  'Parking': { group: 'Transportation', type: 'Flexible' },
  'Rideshare': { group: 'Transportation', type: 'Flexible' },
  'Uber': { group: 'Transportation', type: 'Flexible' },
  'Lyft': { group: 'Transportation', type: 'Flexible' },
  'Public Transportation': { group: 'Transportation', type: 'Flexible' },
  'Auto Maintenance': { group: 'Transportation', type: 'Flexible' },
  'Car Maintenance': { group: 'Transportation', type: 'Flexible' },
  'Tolls': { group: 'Transportation', type: 'Flexible' },

  // ── Food & Dining ──────────────────────────────────────────────────────────
  'Food & Dining': { group: 'Food & Dining', type: 'Flexible' },
  'Groceries': { group: 'Food & Dining', type: 'Flexible' },
  'Restaurants': { group: 'Food & Dining', type: 'Flexible' },
  'Dining Out': { group: 'Food & Dining', type: 'Flexible' },
  'Coffee Shops': { group: 'Food & Dining', type: 'Flexible' },
  'Fast Food': { group: 'Food & Dining', type: 'Flexible' },
  'Alcohol & Bars': { group: 'Food & Dining', type: 'Flexible' },
  'Alcohol': { group: 'Food & Dining', type: 'Flexible' },
  'Food Delivery': { group: 'Food & Dining', type: 'Flexible' },

  // ── Entertainment ──────────────────────────────────────────────────────────
  'Entertainment': { group: 'Entertainment', type: 'Flexible' },
  'Movies & DVDs': { group: 'Entertainment', type: 'Flexible' },
  'Movies': { group: 'Entertainment', type: 'Flexible' },
  'Music': { group: 'Entertainment', type: 'Flexible' },
  'Games': { group: 'Entertainment', type: 'Flexible' },
  'Video Games': { group: 'Entertainment', type: 'Flexible' },
  'Sports': { group: 'Entertainment', type: 'Flexible' },
  'Hobbies': { group: 'Entertainment', type: 'Flexible' },
  'Arts': { group: 'Entertainment', type: 'Flexible' },
  'Concerts & Events': { group: 'Entertainment', type: 'Non-Monthly' },

  // ── Shopping ───────────────────────────────────────────────────────────────
  'Shopping': { group: 'Shopping', type: 'Flexible' },
  'Clothing': { group: 'Shopping', type: 'Flexible' },
  'Electronics & Software': { group: 'Shopping', type: 'Flexible' },
  'Electronics': { group: 'Shopping', type: 'Flexible' },
  'Books': { group: 'Shopping', type: 'Flexible' },
  'Household Supplies': { group: 'Shopping', type: 'Flexible' },
  'Personal Care': { group: 'Shopping', type: 'Flexible' },
  'Beauty': { group: 'Shopping', type: 'Flexible' },
  'Hair': { group: 'Shopping', type: 'Flexible' },
  'Gifts': { group: 'Shopping', type: 'Non-Monthly' },

  // ── Health ─────────────────────────────────────────────────────────────────
  'Health & Fitness': { group: 'Health', type: 'Flexible' },
  'Gym': { group: 'Health', type: 'Fixed' },
  'Gym & Fitness': { group: 'Health', type: 'Fixed' },
  'Doctor': { group: 'Health', type: 'Flexible' },
  'Medical': { group: 'Health', type: 'Flexible' },
  'Dentist': { group: 'Health', type: 'Non-Monthly' },
  'Pharmacy': { group: 'Health', type: 'Flexible' },
  'Vision': { group: 'Health', type: 'Non-Monthly' },
  'Health Insurance': { group: 'Health', type: 'Fixed' },
  'Mental Health': { group: 'Health', type: 'Flexible' },

  // ── Travel ─────────────────────────────────────────────────────────────────
  'Travel': { group: 'Travel', type: 'Non-Monthly' },
  'Hotel': { group: 'Travel', type: 'Non-Monthly' },
  'Hotels': { group: 'Travel', type: 'Non-Monthly' },
  'Air Travel': { group: 'Travel', type: 'Non-Monthly' },
  'Flights': { group: 'Travel', type: 'Non-Monthly' },
  'Rental Car': { group: 'Travel', type: 'Non-Monthly' },
  'Cruises': { group: 'Travel', type: 'Non-Monthly' },
  'Cruise': { group: 'Travel', type: 'Non-Monthly' },
  'Vacation': { group: 'Travel', type: 'Non-Monthly' },

  // ── Subscriptions ──────────────────────────────────────────────────────────
  'Subscriptions': { group: 'Subscriptions', type: 'Fixed' },
  'Streaming': { group: 'Subscriptions', type: 'Fixed' },
  'Software': { group: 'Subscriptions', type: 'Fixed' },
  'Membership Fees': { group: 'Subscriptions', type: 'Fixed' },
  'Newspapers & Magazines': { group: 'Subscriptions', type: 'Fixed' },

  // ── Commitments / Donations ────────────────────────────────────────────────
  'Charitable Giving': { group: 'Commitments', type: 'Non-Monthly' },
  'Donations': { group: 'Commitments', type: 'Non-Monthly' },
  'Charity': { group: 'Commitments', type: 'Non-Monthly' },
  'Education': { group: 'Commitments', type: 'Non-Monthly' },
  'Tuition': { group: 'Commitments', type: 'Non-Monthly' },
  'Student Loan': { group: 'Commitments', type: 'Fixed' },
  'Child Support': { group: 'Commitments', type: 'Fixed' },
  'Eldercare': { group: 'Commitments', type: 'Non-Monthly' },

  // ── Pets ───────────────────────────────────────────────────────────────────
  'Pets': { group: 'Pets', type: 'Flexible' },
  'Pet Food': { group: 'Pets', type: 'Flexible' },
  'Vet': { group: 'Pets', type: 'Flexible' },
  'Pet Grooming': { group: 'Pets', type: 'Flexible' },

  // ── Fees & Financial ───────────────────────────────────────────────────────
  'Fees & Charges': { group: 'Financial', type: 'Flexible' },
  'Bank Fees': { group: 'Financial', type: 'Flexible' },
  'Credit Card Fees': { group: 'Financial', type: 'Flexible' },
  'ATM Fee': { group: 'Financial', type: 'Flexible' },
  'Interest': { group: 'Financial', type: 'Flexible' },
  'Taxes': { group: 'Financial', type: 'Non-Monthly' },
  'Tax Payment': { group: 'Financial', type: 'Non-Monthly' },
  'Savings': { group: 'Financial', type: 'Fixed' },
  'Investments': { group: 'Financial', type: 'Fixed' },

  // ── Income ─────────────────────────────────────────────────────────────────
  'Income': { group: 'Income', type: 'Fixed' },
  'Paycheck': { group: 'Income', type: 'Fixed' },
  'Salary': { group: 'Income', type: 'Fixed' },
  'Bonus': { group: 'Income', type: 'Non-Monthly' },
  'Freelance': { group: 'Income', type: 'Flexible' },
  'Side Hustle': { group: 'Income', type: 'Flexible' },
  'Interest Income': { group: 'Income', type: 'Flexible' },
  'Dividend Income': { group: 'Income', type: 'Flexible' },
  'Dividends': { group: 'Income', type: 'Flexible' },
  'Refund': { group: 'Income', type: 'Flexible' },
  'Reimbursement': { group: 'Income', type: 'Flexible' },
  'Other Income': { group: 'Income', type: 'Flexible' },

  // ── Transfers ──────────────────────────────────────────────────────────────
  // Account transfers and credit-card payments move money around; they are not
  // real income or expense, so they default to excluded from totals.
  'Transfer': { group: 'Transfers', type: 'Flexible', exclude: true },
  'Transfers': { group: 'Transfers', type: 'Flexible', exclude: true },
  'Credit Card Payment': { group: 'Transfers', type: 'Flexible', exclude: true },
  'Loan Payment': { group: 'Transfers', type: 'Fixed' },

  // ── Catch-all ──────────────────────────────────────────────────────────────
  'Uncategorized': { group: 'Uncategorized', type: 'Flexible' },
}

export const ALL_GROUPS = [
  'Housing',
  'Transportation',
  'Food & Dining',
  'Entertainment',
  'Shopping',
  'Health',
  'Travel',
  'Subscriptions',
  'Commitments',
  'Pets',
  'Financial',
  'Income',
  'Transfers',
  'Uncategorized',
]

export const GROUP_TYPE_DEFAULTS = {
  'Housing': 'Fixed',
  'Transportation': 'Fixed',
  'Food & Dining': 'Flexible',
  'Entertainment': 'Flexible',
  'Shopping': 'Flexible',
  'Health': 'Flexible',
  'Travel': 'Non-Monthly',
  'Subscriptions': 'Fixed',
  'Commitments': 'Non-Monthly',
  'Pets': 'Flexible',
  'Financial': 'Flexible',
  'Income': 'Fixed',
  'Transfers': 'Flexible',
  'Uncategorized': 'Flexible',
}

// Built-in groups, used as defaults for a brand-new user. A user's own groups
// (from their budget_categories) take precedence everywhere — these are just the
// starting set, not a fixed taxonomy. Alias kept as ALL_GROUPS for back-compat.
export const DEFAULT_GROUPS = ALL_GROUPS

export function getCategoryMapping(monarchCategory) {
  return MONARCH_CATEGORY_MAP[monarchCategory] ?? null
}

// Returns unique category strings from parsed rows that have no mapping —
// neither in the built-in map nor in the user's already-saved categories.
// Pass knownCategories (the user's existing budget_categories names) so we
// never re-ask for a mapping the user has already made.
export function findUnmappedCategories(rows, knownCategories = []) {
  const known = new Set(knownCategories)
  const unique = [...new Set(rows.map(r => r.category).filter(Boolean))]
  return unique.filter(cat => !MONARCH_CATEGORY_MAP[cat] && !known.has(cat))
}

// Apply group/type from the map to each row. Rows with no mapping get group=null.
export function applyMappings(rows, customMappings = {}) {
  return rows.map(row => {
    const m = customMappings[row.category] ?? getCategoryMapping(row.category)
    return {
      ...row,
      group: m?.group ?? null,
    }
  })
}

// Seed data for budget_categories — all known categories from the map.
export const CATEGORY_SEED_DATA = Object.entries(MONARCH_CATEGORY_MAP).map(
  ([category, { group, type, exclude }]) => ({ category, group, type, exclude: !!exclude })
)

// Category names that are transfers/payments, not real income or expense.
export const DEFAULT_EXCLUDED_CATEGORIES = new Set(
  Object.entries(MONARCH_CATEGORY_MAP).filter(([, v]) => v.exclude).map(([k]) => k)
)

// True when a set of transactions should be dropped from spend/income totals.
// `excludedNames` is the set of category names flagged exclude_from_totals.
export function isExcludedFromTotals(category, excludedNames) {
  return !!category && excludedNames instanceof Set && excludedNames.has(category)
}
