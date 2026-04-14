async function load() {
  try {
    const res = await fetch('data/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const lu = document.getElementById('last-updated');
    lu.textContent = 'Last updated: ' + new Date(data.last_updated).toLocaleString();

    document.getElementById('index-dump').textContent =
      JSON.stringify(data, null, 2);
  } catch (err) {
    document.getElementById('last-updated').textContent = 'Load failed';
    document.getElementById('index-dump').textContent = 'Error: ' + err.message;
  }
}

load();
