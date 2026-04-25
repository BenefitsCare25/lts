import { expect, test } from '@playwright/test';

test('home page renders the bootstrap placeholder', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Insurance SaaS Platform' })).toBeVisible();
  await expect(page.getByText(/Phase 1 bootstrap/)).toBeVisible();
});
