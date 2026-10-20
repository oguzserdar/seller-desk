/** Check the saved connection; editing the address invalidates earlier results. */
(() => {
  const button = document.getElementById('seller-desk-check');
  const result = document.getElementById('seller-desk-check-result');
  const address = document.getElementById('seller-desk-origin');
  const status = document.getElementById('seller-desk-connection-state');
  if (!button || !result || !address || !status) return;
  let checkId = 0;
  let request;
  const saved = button.dataset.deskOrigin || '';
  const dirty = () => address.value.trim() !== saved;
  const show = (label, message, state) => {
    status.textContent = label;
    result.textContent = message;
    status.dataset.state = result.dataset.state = state;
  };
  address.addEventListener('input', () => {
    checkId++;
    request?.abort();
    button.disabled = dirty() || !saved;
    button.removeAttribute('aria-busy');
    show(dirty() ? 'Unsaved changes' : saved ? 'Ready to check' : 'Not connected',
      dirty() ? 'Save your address before checking this connection.' : saved ? 'Run a check to test the saved address.' : 'Save your Seller Desk address to get started.', 'idle');
  });
  button.addEventListener('click', async () => {
    if (!saved || dirty()) return;
    const id = ++checkId;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    show('Checking', 'Checking this website’s connection…', 'idle');
    const controller = new AbortController();
    request = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(saved + '/api/widget/allowed', { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error('connection failed');
      const data = await response.json();
      if (id !== checkId) return;
      if (data.allowed === true) show('Connected', 'This website can open your assistant. Open your website and try Ask the shop. AI and payments need their own test.', 'success');
      else if (data.allowed === false) show('Website needs approval', 'Complete step 2 in Seller Desk Setup, save, then check again.', 'attention');
      else throw new Error('invalid check response');
    } catch {
      if (id === checkId) show('Could not connect', 'Check that Seller Desk is running at the saved address, then try again.', 'attention');
    } finally {
      clearTimeout(timer);
      if (id === checkId) { button.disabled = dirty() || !saved; button.removeAttribute('aria-busy'); }
    }
  });
  const copy = document.getElementById('seller-desk-copy');
  const site = document.getElementById('seller-desk-site-address');
  const feedback = document.getElementById('seller-desk-copy-result');
  copy?.addEventListener('click', async () => {
    if (!site || !feedback) return;
    try {
      await navigator.clipboard.writeText(site.textContent.trim());
      feedback.textContent = 'Copied. Paste into Allowed websites in Seller Desk Setup.';
    } catch {
      feedback.textContent = 'Select the website address above and copy it.';
    }
  });
})();
