export default async function run(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      errors.push(m.type() + ': ' + m.text());
    }
  });

  await page.goto('http://localhost:8767/todo.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  // Fetch and syntax-check the script the browser is actually loading.
  const diag = await page.evaluate(async () => {
    const res = await fetch('todo.js');
    const text = await res.text();
    let parseError = null;
    try {
      new Function(text);
    } catch (e) {
      parseError = e.name + ': ' + e.message;
    }
    return {
      bytes: text.length,
      parseError,
      firstLine: text.split('\n')[0],
      lastLine: text.trim().split('\n').pop(),
      hasIIFEOpen: text.includes('(function () {'),
      hasIIFEClose: text.includes('})();'),
    };
  });

  return { errors, diag };
}