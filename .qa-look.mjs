export default async function run(page) {
  const out = {};

  for (const [w, theme, name] of [[1280, 'dark', 'todo-desktop.png'], [390, 'light', 'todo-mobile.png']]) {
    await page.setViewportSize({ width: w, height: 1100 });
    await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => {
      localStorage.clear();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('theme', t);
    }, theme);

    for (const [t, p] of [['Write the state reducer', 'high'], ['Review pull request', 'low'], ['Ship the release', 'medium']]) {
      await page.fill('#todo-input', t);
      await page.selectOption('#todo-priority', p);
      await page.click('#todo-submit');
      await page.waitForTimeout(50);
    }
    await page.click('.todo-item:has-text("Review pull request") .todo-check');
    await page.waitForTimeout(150);

    await page.screenshot({ path: `.qa-shots/${name}`, fullPage: true });
    out[name] = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      itemCols: getComputedStyle(document.querySelector('.todo-item')).gridTemplateColumns.split(' ').length,
      formCols: getComputedStyle(document.querySelector('.todo-form')).gridTemplateColumns.split(' ').length,
    }));
  }
  return out;
}