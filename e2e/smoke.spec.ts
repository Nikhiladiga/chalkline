import { expect, test } from '@playwright/test';
import { launch } from './launch';

test('window opens with the app title', async () => {
  const { app, page } = await launch();
  await expect(page.getByText('Open Eraser').first()).toBeVisible();
  await app.close();
});
