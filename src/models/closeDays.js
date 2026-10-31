import { all, get, run } from '../db.js';

/** Returns { [contractType]: { [verticalMarket]: days } } for every stored override. */
export async function getMatrix() {
  const rows = await all('SELECT * FROM close_day_rules');
  const matrix = {};
  for (const row of rows) {
    matrix[row.contract_type] = matrix[row.contract_type] || {};
    matrix[row.contract_type][row.vertical_market] = row.days;
  }
  return matrix;
}

/** Sets (or clears, if days is blank/null) the override for one contract type + vertical market. */
export async function setRule(contractType, verticalMarket, days) {
  if (days === '' || days === null || days === undefined) {
    await run('DELETE FROM close_day_rules WHERE contract_type = ? AND vertical_market = ?', [contractType, verticalMarket]);
    return null;
  }
  await run(`
    INSERT INTO close_day_rules (contract_type, vertical_market, days)
    VALUES (?, ?, ?)
    ON CONFLICT(contract_type, vertical_market) DO UPDATE SET days = excluded.days, updated_at = datetime('now')
  `, [contractType, verticalMarket, Number(days)]);
  return get('SELECT * FROM close_day_rules WHERE contract_type = ? AND vertical_market = ?', [contractType, verticalMarket]);
}
