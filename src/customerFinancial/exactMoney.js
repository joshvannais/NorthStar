'use strict';

const MAX_SAFE_MINOR_UNITS = 9007199254740991n;
const INTEGER = /^-?(?:0|[1-9][0-9]{0,15})$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;
const KEYS = ['version','currency','minorUnitExponent','minorUnits','decimal','exactZero'];

function failure(code, message) {
  const error = new Error(message); error.code = code; return error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' &&
    keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable);
}
function checkedCurrency(currency) {
  if (currency !== 'USD') throw failure('currency_unsupported', 'Only exact USD is supported.');
  return currency;
}
function checkedMinorUnits(value) {
  if (typeof value !== 'string' || !INTEGER.test(value)) {
    throw failure('CUSTOMER_FINANCIAL_EXACT_MONEY_INVALID',
      'Minor units must be a canonical base-10 integer string.');
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_MINOR_UNITS || parsed < -MAX_SAFE_MINOR_UNITS) {
    throw failure('CUSTOMER_FINANCIAL_EXACT_MONEY_INVALID',
      'Minor units exceed the exact application range.');
  }
  return parsed === 0n ? 0n : parsed;
}
function decimalFor(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const decimal = `${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
  return negative ? `-${decimal}` : decimal;
}
function fromMinorUnits(minorUnits, currency = 'USD') {
  checkedCurrency(currency);
  const parsed = checkedMinorUnits(minorUnits);
  return Object.freeze({ version: 'm27-exact-money-v1', currency,
    minorUnitExponent: 2, minorUnits: parsed.toString(), decimal: decimalFor(parsed),
    exactZero: parsed === 0n });
}
function fromDecimal(decimal, currency = 'USD') {
  checkedCurrency(currency);
  if (typeof decimal !== 'string' || !DECIMAL.test(decimal)) {
    throw failure('CUSTOMER_FINANCIAL_EXACT_MONEY_INVALID',
      'Decimal money must be a canonical string with no more than two fractional digits.');
  }
  const negative = decimal.startsWith('-');
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole, fraction = ''] = unsigned.split('.');
  const minor = (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0') || '0');
  return fromMinorUnits((negative ? -minor : minor).toString(), currency);
}
function verify(value) {
  if (!exact(value, KEYS) || value.version !== 'm27-exact-money-v1' ||
      value.minorUnitExponent !== 2 || typeof value.exactZero !== 'boolean') {
    throw failure('CUSTOMER_FINANCIAL_EXACT_MONEY_INVALID', 'Exact money evidence is invalid.');
  }
  const normalized = fromMinorUnits(value.minorUnits, value.currency);
  if (normalized.decimal !== value.decimal || normalized.exactZero !== value.exactZero) {
    throw failure('CUSTOMER_FINANCIAL_EXACT_MONEY_INVALID', 'Exact money evidence is invalid.');
  }
  return normalized;
}
function add(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 1000) {
    throw failure('CUSTOMER_FINANCIAL_EXACT_MONEY_INVALID', 'Exact money operands are invalid.');
  }
  let total = 0n;
  for (const value of values) total += BigInt(verify(value).minorUnits);
  return fromMinorUnits(total.toString(), 'USD');
}

module.exports = { fromMinorUnits, fromDecimal, verify, add, MAX_SAFE_MINOR_UNITS };
