// Runs INSIDE the page (page.evaluate). Self-contained; returns a JSON-able report.
export function measureInPage() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const out = { vw, vh }
  const main = document.querySelector('main')
  const isHidden = el => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true
    const r = el.getBoundingClientRect()
    return r.width === 0 && r.height === 0
  }
  const compName = el => {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
    if (!key) return null
    let f = el[key]; const names = []
    while (f && names.length < 3) {
      if (typeof f.type === 'function' && f.type.name) names.push(f.type.name)
      f = f.return
    }
    return names.join(' < ') || null
  }
  const path = el => {
    const parts = []
    let e = el
    for (let i = 0; e && e.nodeType === 1 && i < 4 && e !== document.body; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase()
      if (e.id) s += '#' + e.id
      else if (typeof e.className === 'string' && e.className.trim()) s += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.')
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  const snippet = el => (el.innerText || el.getAttribute('aria-label') || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 50)
  const describe = el => {
    const r = el.getBoundingClientRect()
    return { tag: el.tagName.toLowerCase(), path: path(el), component: compName(el), text: snippet(el), x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }
  }
  // nearest ancestor that clips horizontally (overflow-x not visible), excluding html/body
  const clipAncestor = el => {
    for (let p = el.parentElement; p && p !== main && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox !== 'visible') return p
    }
    return null
  }

  // 1. horizontal scroll of the page and of the real scroller (<main>)
  const de = document.documentElement
  out.docScrollW = de.scrollWidth
  out.docHScroll = de.scrollWidth > vw
  out.bodyScrollW = document.body.scrollWidth
  if (main) {
    out.main = { clientW: main.clientWidth, scrollW: main.scrollWidth, hScroll: main.scrollWidth > main.clientWidth + 1, overshootPx: main.scrollWidth - main.clientWidth, clientH: main.clientHeight, scrollH: main.scrollHeight, overflowX: getComputedStyle(main).overflowX }
  }
  const limit = main ? main.getBoundingClientRect().right : vw
  const leftLimit = main ? main.getBoundingClientRect().left : 0

  // 2. elements poking beyond the viewport/main (ORIGINS only: parent fits, child does not), not clipped by a scroller
  const all = [...document.querySelectorAll('body *')].filter(el => !el.closest('nextjs-portal') && !isHidden(el))
  const over = []
  const scrollers = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      scrollers.push({ ...describe(el), scrollW: el.scrollWidth, clientW: el.clientWidth })
    }
    if (cs.position === 'fixed') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0) continue
    if (r.right > limit + 1 || r.left < leftLimit - 1) {
      if (clipAncestor(el)) continue
      const par = el.parentElement
      const pr = par && par.getBoundingClientRect()
      const parentOver = pr && (pr.right > limit + 1 || pr.left < leftLimit - 1) && !clipAncestor(par) && getComputedStyle(par).position !== 'fixed'
      if (parentOver) continue
      over.push({ ...describe(el), overshoot: Math.round(Math.max(r.right - limit, leftLimit - r.left)) })
    }
  }
  over.sort((a, b) => b.overshoot - a.overshoot)
  out.overflowOrigins = over.slice(0, 25)
  out.hScrollers = scrollers.slice(0, 25) // intentional overflow-x scrollers that actually scroll

  // 3. clipped content w/o scroller (overflow hidden/visible with scrollWidth>clientWidth); ellipsis truncation
  const clipped = []
  for (const el of all) {
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
        if (!snippet(el)) continue
        clipped.push({ ...describe(el), scrollW: el.scrollWidth, clientW: el.clientWidth, ellipsis: cs.textOverflow === 'ellipsis' })
      }
    }
  }
  out.clipped = clipped.slice(0, 40)

  // 4. tap targets < 40x40 at <=760
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], summary'
  const tiny = new Map()
  let interactiveCount = 0
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('nextjs-portal') || isHidden(el)) continue
    interactiveCount++
    const r = el.getBoundingClientRect()
    if (vw <= 760 && (r.width < 40 || r.height < 40)) {
      // The app widens button hit areas with an ::after the rect cannot see, so
      // probe with elementFromPoint to find the size that actually responds.
      if (el.matches('button, [role=button], summary, a[href]')) {
        const main = document.querySelector('main')
        const top0 = main ? main.scrollTop : 0
        el.scrollIntoView({ block: 'center', inline: 'center' })
        const b = el.getBoundingClientRect()
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2
        const hits = (x, y) => { const h = document.elementFromPoint(x, y); return h && (h === el || el.contains(h)) }
        const reach = (dx, dy) => { let n = 0; while (n < 40 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++; return n }
        const effW = reach(-1, 0) + reach(1, 0) + 1, effH = reach(0, -1) + reach(0, 1) + 1
        if (main) main.scrollTop = top0
        if (effW >= 40 && effH >= 40) continue
        r.effW = effW; r.effH = effH
      }
      const sig = el.tagName.toLowerCase() + '|' + (compName(el) || '') + '|' + snippet(el).slice(0, 24) + '|' + Math.round(r.width) + 'x' + Math.round(r.height)
      const prev = tiny.get(sig)
      if (prev) prev.count++
      else tiny.set(sig, { ...describe(el), count: 1, effW: r.effW, effH: r.effH })
    }
  }
  out.interactiveCount = interactiveCount
  out.smallTapTargets = [...tiny.values()].sort((a, b) => (a.w * a.h) - (b.w * b.h)).slice(0, 60)
  out.smallTapTargetTotal = [...tiny.values()].reduce((s, v) => s + v.count, 0)

  // 5. text smaller than 11px
  const small = new Map()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim()
    if (!t) continue
    const el = n.parentElement
    if (!el || el.closest('nextjs-portal, script, style') || isHidden(el)) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 11) {
      const sig = Math.round(fs * 10) / 10 + '|' + el.tagName + '|' + (compName(el) || '')
      const prev = small.get(sig)
      if (prev) { prev.count++ } else small.set(sig, { fontSize: fs, tag: el.tagName.toLowerCase(), component: compName(el), path: path(el), sample: t.slice(0, 40), count: 1 })
    }
  }
  out.smallText = [...small.values()].sort((a, b) => b.count - a.count).slice(0, 30)

  // 6. fixed / sticky elements
  const fixed = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed' || cs.position === 'sticky') {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      fixed.push({ ...describe(el), position: cs.position, top: Math.round(r.top), bottom: Math.round(r.bottom), z: cs.zIndex, coversPct: Math.round((r.width * r.height) / (vw * vh) * 100) })
    }
  }
  out.fixedSticky = fixed.slice(0, 30)

  // 7. dialogs / overlays that exceed the viewport
  const dlg = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed' && cs.zIndex !== 'auto' && Number(cs.zIndex) >= 40) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) dlg.push({ ...describe(el), top: Math.round(r.top), bottom: Math.round(r.bottom), vh, vw })
    }
  }
  out.overlaysOutsideViewport = dlg.slice(0, 15)

  // 8. FAB / fixed bottom controls overlapping content when scrolled to the end
  const fabs = fixed.filter(f => f.position === 'fixed' && f.w < 120 && f.h < 120 && f.bottom > vh * 0.5)
  out.fabOverlap = []
  if (main && fabs.length) {
    const prevTop = main.scrollTop
    main.scrollTop = main.scrollHeight
    for (const fab of fabs) {
      const fx0 = fab.x, fx1 = fab.right, fy0 = fab.bottom - fab.h, fy1 = fab.bottom
      const hits = []
      for (const el of document.querySelectorAll('main *')) {
        if (isHidden(el)) continue
        const hasText = [...el.childNodes].some(c => c.nodeType === 3 && c.nodeValue.trim())
        const interactive = el.matches(sel)
        if (!hasText && !interactive) continue
        const r = el.getBoundingClientRect()
        if (r.right > fx0 && r.left < fx1 && r.bottom > fy0 && r.top < fy1) hits.push({ ...describe(el) })
      }
      if (hits.length) out.fabOverlap.push({ fab: fab.path + ' ' + fab.w + 'x' + fab.h, hits: hits.slice(0, 5) })
    }
    main.scrollTop = prevTop
  }
  return out
}
