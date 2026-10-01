import { describe, expect, it } from 'vitest';
import { money, priceLabel, shows, type Account, type Product } from './account';

const product = (amount: number, interval: string | null): Product => ({
  id: interval ? 'producer' : 'export',
  name: '',
  summary: '',
  mode: interval ? 'subscription' : 'payment',
  amount,
  currency: 'aud',
  interval,
});

describe('prices', () => {
  it('shows Australian dollars, with cents only when there are some', () => {
    expect(money(1200, 'aud')).toBe('A$12');
    expect(money(1250, 'aud')).toBe('A$12.50');
    expect(money(24000, 'aud')).toBe('A$240');
    expect(money(1999, 'nzd')).toBe('NZD 19.99');
    expect(priceLabel(product(1200, null))).toBe('A$12');
    expect(priceLabel(product(2400, 'month'))).toBe('A$24 a month');
  });
});

describe('after checkout', () => {
  const account = (printReady: Account['printReady']) => ({ printReady }) as Account;

  it('waits for the plan when a plan was bought, and for any credit after an export', () => {
    expect(shows('producer')(account('credit'))).toBe(false);
    expect(shows('producer')(account('subscription'))).toBe(true);
    expect(shows('export')(account(null))).toBe(false);
    expect(shows('export')(account('credit'))).toBe(true);
    expect(shows(null)(account('credit'))).toBe(true);
  });
});
