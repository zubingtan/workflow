import { expect, test } from '@playwright/test';

test('dark management pages share the neutral editor-surface background', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('workflow-theme', 'dark'));
  await page.emulateMedia({ colorScheme: 'dark' });

  for (const path of ['/#/workflows', '/#/agents', '/#/settings']) {
    await page.goto(path);
    const shell = page.getByTestId('app-shell');
    await expect(shell).toBeVisible();
    await expect.poll(() => page.locator('body').getAttribute('theme-mode')).toBe('dark');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect
      .poll(() =>
        shell.evaluate((element) => {
          const activeNavigation = element.querySelector<HTMLElement>(
            '[aria-label="Primary navigation"] [aria-current="page"]'
          );
          if (!activeNavigation) return 'missing';
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--secondary)';
          probe.style.position = 'absolute';
          probe.style.visibility = 'hidden';
          element.appendChild(probe);
          const value = `${getComputedStyle(activeNavigation).backgroundColor}|${
            getComputedStyle(probe).backgroundColor
          }`;
          probe.remove();
          return value;
        })
      )
      .toMatch(/^(.+)\|\1$/);
    const colors = await shell.evaluate((element) => {
      const main = element.querySelector<HTMLElement>('[data-ui="app-main"]');
      const activeNavigation = element.querySelector<HTMLElement>(
        '[aria-label="Primary navigation"] [aria-current="page"]'
      );
      if (!activeNavigation) throw new Error('Active primary navigation item is missing');
      const activeStyle = getComputedStyle(activeNavigation);
      const secondaryProbe = document.createElement('span');
      secondaryProbe.style.backgroundColor = 'var(--secondary)';
      secondaryProbe.style.position = 'absolute';
      secondaryProbe.style.visibility = 'hidden';
      element.appendChild(secondaryProbe);
      const secondaryBackground = getComputedStyle(secondaryProbe).backgroundColor;
      secondaryProbe.remove();
      return {
        shell: getComputedStyle(element).backgroundColor,
        main: main ? getComputedStyle(main).backgroundColor : null,
        secondary: activeStyle.getPropertyValue('--secondary').trim(),
        activeNavigation: activeStyle.backgroundColor,
        secondaryBackground,
      };
    });
    expect(colors.main).toBe(colors.shell);
    expect(colors.secondary).toMatch(/(?:oklch|lab)\([^)]*\s0(?:\s|\))/);
    expect(colors.activeNavigation).toBe(colors.secondaryBackground);
  }
});
