// The look you chose (theme colours, poster size), put on the page before anything is drawn so it never flashes the default.
// A file of its own, not inline in index.html, so the page can be served with a policy that refuses inline scripts.
try {
  var saved = JSON.parse(localStorage.getItem('jellyflix.appearance.css') || 'null')
  if (saved && saved.vars) {
    for (var name in saved.vars) document.documentElement.style.setProperty(name, saved.vars[name])
    for (var attr in saved.attrs) document.documentElement.dataset[attr] = saved.attrs[attr]
    if (saved.bg) document.querySelector('meta[name="theme-color"]').setAttribute('content', saved.bg)
  }
} catch (e) {}
