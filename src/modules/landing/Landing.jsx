'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import './landing.css'
import { initLanding } from './landingMotion.js'

// Public marketing page. Rendered outside the signed-in shell (see PUBLIC_PATHS in app/AppRoot.jsx).
// The markup is static; landingMotion.js drives every animation from scroll position, so this
// component never re-renders after mount and React never overwrites the SVG the script draws.
export default function Landing() {
  const rootRef = useRef(null)

  useEffect(() => initLanding(rootRef.current), [])

  return (
    <div className="lp" ref={rootRef}>
      <nav aria-label="Primary">
        <div className="lp-nav-in">
          <a className="lp-brand" href="#top">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#A87CF6"/><stop offset="1" stopColor="#38BDF8"/></linearGradient></defs>
              <rect x=".5" y=".5" width="31" height="31" rx="8" fill="#0B1013" stroke="#1F2A2F"/>
              <ellipse cx="16" cy="16" rx="12.5" ry="10.5" stroke="#4F9CF0" strokeOpacity=".6" strokeWidth=".8" transform="rotate(-20 16 16)"/>
              <path d="M21.6 11.2A7 7 0 1 0 21.6 20.8" stroke="url(#lg)" strokeWidth="3" strokeLinecap="round"/>
              <path d="M7.5 23.5L24.5 9" stroke="#E9B872" strokeWidth="1.4" strokeLinecap="round"/>
              <circle cx="24.5" cy="9" r="2" fill="#E9B872"/><circle cx="7.5" cy="23.5" r="1.4" fill="#A87CF6"/>
            </svg>
            Capital Planning OS
          </a>
          <div className="lp-links">
            <a className="lp-hide-s" href="#tour">Tour</a>
            <a className="lp-hide-s" href="#scenario">Scenarios</a>
            <a className="lp-hide-s" href="#modules">Modules</a>
            <Link className="lp-btn lp-btn-ghost lp-btn-sm" href="/dashboard">Sign in</Link>
          </div>
        </div>
      </nav>

      <div className="lp-wrap">
        <header className="lp-hero" id="top">
          <div className="lp-hero-grid">
            <div>
              <span className="lp-pill"><b>AI</b> Forward-looking capital planning</span>
              <h1>Decide with the <em>next</em> <i>twelve months</i> <span className="lp-thin">in</span>view.</h1>
            </div>
            <div>
              <p className="lp-lede">Scenarios, cash-flow timing and an AI that works your real numbers.</p>
              <div className="lp-cta">
                <Link className="lp-btn lp-btn-primary" href="/dashboard">Get started</Link>
                <a className="lp-btn lp-btn-ghost" href="#tour">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1v10l9-5z" fill="currentColor"/></svg>
                  Watch tour
                </a>
              </div>
            </div>
          </div>

          <div className="lp-stage">
                  <div className="lp-stage-pin" id="hpin"><div className="lp-window" aria-label="Dashboard preview with example data">
              <div className="lp-win-bar"><span className="lp-dots"><i></i><i></i><i></i></span><span className="lp-url">capital · dashboard</span><span style={{ width: '42px' }}></span></div>
              <div className="lp-app">
                <aside className="lp-side" aria-hidden="true">
                  <span className="lp-lbl">MODULES</span>
                  <span className="lp-it lp-on" style={{ '--c': '#22D3BB' }}><i></i>Dashboard</span>
                  <span className="lp-it" style={{ '--c': 'var(--d-pay)' }}><i></i>Pay Periods</span>
                  <span className="lp-it" style={{ '--c': 'var(--d-fc)' }}><i></i>Forecast</span>
                  <span className="lp-it" style={{ '--c': 'var(--d-bud)' }}><i></i>Budget</span>
                  <span className="lp-it" style={{ '--c': 'var(--d-scn)' }}><i></i>Scenarios</span>
                  <span className="lp-it" style={{ '--c': 'var(--d-cc)' }}><i></i>Credit Cards</span>
                  <span className="lp-it" style={{ '--c': 'var(--d-wl)' }}><i></i>Wealth</span>
                  <span className="lp-it" style={{ '--c': 'var(--d-cm)' }}><i></i>Commitments</span>
                </aside>
                <div className="lp-main">
                  <div className="lp-main-head">
                    <div><div className="lp-eyebrow">FY 2027 · Plan A</div><h3 style={{ marginTop: '6px' }}>Good morning.</h3></div>
                    <div className="lp-seg" aria-hidden="true"><span>3M</span><span className="lp-on">12M</span><span>5Y</span></div>
                  </div>
                  <div className="lp-kpis">
                    <div className="lp-kpi"><div className="lp-l">Month-end low</div><div className="lp-v" id="k1">$4,860</div><div className="lp-d lp-up">▲ above floor</div></div>
                    <div className="lp-kpi"><div className="lp-l">Runway</div><div className="lp-v" id="k2">5.2 mo</div><div className="lp-d lp-up" id="k2d">▲ 0.4</div></div>
                    <div className="lp-kpi"><div className="lp-l">Net worth</div><div className="lp-v">$412k</div><div className="lp-d lp-up">▲ 3.1% YTD</div></div>
                    <div className="lp-kpi"><div className="lp-l">Next big hit</div><div className="lp-v" id="k4">Mar 14</div><div className="lp-d lp-wn" id="k4d">$1,300 insurance</div></div>
                  </div>
                  <div className="lp-row2">
                    <div className="lp-card">
                      <div className="lp-card-h"><span>Forecast vs. budget</span><span className="lp-mono">MONTHLY OUTFLOW</span></div>
                      <svg id="heroChart" viewBox="0 0 560 200" style={{ overflow: 'visible' }} width="100%" role="img" aria-label="Budget bars with a forecast line running above budget in March and November."></svg>
                      <div className="lp-legend"><span><i style={{ background: 'var(--bar)' }}></i>Budget</span><span><i style={{ background: 'var(--d-scn)' }}></i>Forecast</span><span><i style={{ background: 'var(--warn)' }}></i>Over</span></div>
                    </div>
                    <div className="lp-card">
                      <div className="lp-card-h"><span>Coming up</span><span className="lp-mono">NEXT 90 DAYS</span></div>
                      <div className="lp-hits">
                        <div className="lp-hit"><span className="lp-dt">FEB<b>28</b></span><span className="lp-nm"><i style={{ '--c': 'var(--d-cm)' }}></i>Tuition, spring</span><span className="lp-amt">$2,450</span></div>
                        <div className="lp-hit"><span className="lp-dt">MAR<b>14</b></span><span className="lp-nm"><i style={{ '--c': 'var(--warn)' }}></i>Home insurance</span><span className="lp-amt">$1,300</span></div>
                        <div className="lp-hit"><span className="lp-dt">APR<b>15</b></span><span className="lp-nm"><i style={{ '--c': 'var(--d-sys)' }}></i>Tax balance due</span><span className="lp-amt">$3,180</span></div>
                        <div className="lp-hit"><span className="lp-dt">MAY<b>01</b></span><span className="lp-nm"><i style={{ '--c': 'var(--d-cc)' }}></i>Card annual fee</span><span className="lp-amt">$695</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="lp-calc" id="calc" aria-hidden="true"><div className="lp-ch">RECALCULATING</div>
                    <div className="lp-cr"><span>Mar 09 balance</span><b>$7,380</b></div>
                    <div className="lp-cr"><span>Trip, moved from Nov</span><b>−$4,200</b></div>
                    <div className="lp-cr lp-res"><span>New low point</span><b>$3,180</b></div>
                    <div className="lp-cr lp-chk"><span>$3,000 floor</span><b>✓ clears by $180</b></div></div>
                  <p className="lp-example" style={{ margin: '0 0 -6px' }}>EXAMPLE DATA</p>
                  <div className="lp-cmd">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor"/></svg>
                    <span className="lp-q" id="typed">Can we move the November trip to March?</span>
                    <span className="lp-k" id="cmdK">⌘K</span>
                  </div>
                </div>
              </div>
            </div></div>
          </div>
        </header>

        <div className="lp-marquee" aria-hidden="true"><div className="lp-track">
          <div className="lp-grp"><span className="lp-o">Scenarios</span><i className="lp-s" style={{ '--c': 'var(--d-scn)' }}></i><span className="lp-f">Cash-flow timing</span><i className="lp-s" style={{ '--c': 'var(--d-fc)' }}></i><span className="lp-o">Forecasts</span><i className="lp-s" style={{ '--c': 'var(--d-cm)' }}></i><span className="lp-f">Commitments</span><i className="lp-s" style={{ '--c': 'var(--accent)' }}></i><span className="lp-o">Wealth</span><i className="lp-s" style={{ '--c': 'var(--d-wl)' }}></i></div>
          <div className="lp-grp"><span className="lp-o">Scenarios</span><i className="lp-s" style={{ '--c': 'var(--d-scn)' }}></i><span className="lp-f">Cash-flow timing</span><i className="lp-s" style={{ '--c': 'var(--d-fc)' }}></i><span className="lp-o">Forecasts</span><i className="lp-s" style={{ '--c': 'var(--d-cm)' }}></i><span className="lp-f">Commitments</span><i className="lp-s" style={{ '--c': 'var(--accent)' }}></i><span className="lp-o">Wealth</span><i className="lp-s" style={{ '--c': 'var(--d-wl)' }}></i></div>
        </div></div>

        <section id="tour">
          <div className="lp-sec-h">
            <p className="lp-eyebrow">Tour</p>
            <h2>Watch a decision <em>move</em> through the plan.</h2>
          </div>
          <div className="lp-pin" id="pin"><div className="lp-sticky"><div className="lp-video-frame">
            <video
              id="vid"
              muted
              playsInline
              preload="auto"
              poster="/landing/tour-poster.jpg"
              aria-label="Animated preview of the cash-flow forecast updating after a question is asked"
            >
              <source src="/landing/tour.mp4" type="video/mp4" />
            </video>
            <div className="lp-vprog"></div>
            <div className="lp-vf-foot"><span>PRODUCT PREVIEW</span><span id="hint">SCROLL TO PLAY</span></div>
          </div>
          </div></div>
        </section>

        <section id="scenario">
          <div className="lp-spin" id="spin"><div className="lp-spin-in">
          <div className="lp-demo">
            <div>
              <p className="lp-eyebrow">Try a scenario</p>
              <h2 style={{ marginTop: '14px' }}>Move one expense. See <em>every month</em> change.</h2>
              <div className="lp-opts" role="group" aria-label="Scenario">
                <button className="lp-opt" type="button" data-s="0" aria-pressed="true"><span className="lp-r"></span><span><b>Trip in November</b><small>Current plan</small></span></button>
                <button className="lp-opt" type="button" data-s="1" aria-pressed="false"><span className="lp-r"></span><span><b>Trip in March</b><small>$4,200 moves forward</small></span></button>
                <button className="lp-opt" type="button" data-s="2" aria-pressed="false"><span className="lp-r"></span><span><b>March, defer insurance</b><small>AI suggestion</small></span></button>
              </div>
            </div>
            <div className="lp-window">
              <div className="lp-readout">
                <div><div className="lp-l">Lowest month-end</div><div className="lp-big" id="low">$4,860</div></div>
                <span className="lp-status lp-ok" id="status">Clears $3,000 floor</span>
              </div>
              <svg id="demoChart" viewBox="0 0 600 260" width="100%" role="img" aria-label="Month-end balance for the selected scenario against a $3,000 floor."></svg>
              <p className="lp-example" style={{ marginTop: '4px' }}>EXAMPLE DATA</p>
            </div>
          </div>
          </div></div>
        </section>

        <section id="modules">
          <div className="lp-sec-h">
            <p className="lp-eyebrow">Modules</p>
            <h2>Eight modules. <em>One plan.</em></h2>
          </div>
          <div className="lp-mods">
            <div className="lp-mod" style={{ '--dx': '-16', '--dy': '-40', '--r': '-10', '--c': 'var(--accent)' }}><span className="lp-ic"><i></i></span><h3>Dashboard</h3><p>Runway and next big expense.</p></div>
            <div className="lp-mod" style={{ '--dx': '-6', '--dy': '-60', '--r': '6', '--c': 'var(--d-pay)' }}><span className="lp-ic"><i></i></span><h3>Pay Periods</h3><p>Bills on the day they land.</p></div>
            <div className="lp-mod" style={{ '--dx': '6', '--dy': '-45', '--r': '-7', '--c': 'var(--d-fc)' }}><span className="lp-ic"><i></i></span><h3>Forecast</h3><p>Twelve months over budget.</p></div>
            <div className="lp-mod" style={{ '--dx': '17', '--dy': '-35', '--r': '9', '--c': 'var(--d-bud)' }}><span className="lp-ic"><i></i></span><h3>Budget</h3><p>Multi-year, drill into any year.</p></div>
            <div className="lp-mod" style={{ '--dx': '-17', '--dy': '90', '--r': '8', '--c': 'var(--d-scn)' }}><span className="lp-ic"><i></i></span><h3>Scenarios</h3><p>Draft a what-if, then commit.</p></div>
            <div className="lp-mod" style={{ '--dx': '-5', '--dy': '120', '--r': '-6', '--c': 'var(--d-cc)' }}><span className="lp-ic"><i></i></span><h3>Credit Cards</h3><p>Earn rates and point value.</p></div>
            <div className="lp-mod" style={{ '--dx': '7', '--dy': '140', '--r': '10', '--c': 'var(--d-wl)' }}><span className="lp-ic"><i></i></span><h3>Wealth</h3><p>Net worth to retirement.</p></div>
            <div className="lp-mod" style={{ '--dx': '16', '--dy': '100', '--r': '-9', '--c': 'var(--d-cm)' }}><span className="lp-ic"><i></i></span><h3>Commitments</h3><p>Obligations past a year.</p></div>
          </div>
        </section>

        <section style={{ paddingTop: '72px' }}>
          <div className="lp-trust">
            <div><b>Works with your budget app</b><span>Monarch or YNAB keeps the history.</span></div>
            <div><b>Nothing changes silently</b><span>Scenarios stay drafts until you commit.</span></div>
            <div><b>Keys stay on the server</b><span>AI calls never run in the browser.</span></div>
          </div>
        </section>

        <div className="lp-closer" id="start">
          <svg className="lp-o" viewBox="0 0 400 400" fill="none" aria-hidden="true">
            <ellipse cx="200" cy="200" rx="190" ry="150" stroke="#4F9CF0" strokeOpacity=".35" transform="rotate(-24 200 200)"/>
            <path d="M268 132A96 96 0 1 0 268 268" stroke="url(#lg2)" strokeWidth="34" strokeLinecap="round" opacity=".85"/>
            <path d="M60 330L350 80" stroke="#E9B872" strokeWidth="5" strokeLinecap="round"/>
            <circle cx="350" cy="80" r="14" fill="#E9B872"/><circle cx="60" cy="330" r="9" fill="#A87CF6"/>
            <defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#A87CF6"/><stop offset="1" stopColor="#38BDF8"/></linearGradient></defs>
          </svg>
          <p className="lp-eyebrow">Get started</p>
          <h2>Plan the <em>next</em> big decision.</h2>
          <p>Installs to your phone as an app.</p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Link className="lp-btn lp-btn-primary" href="/dashboard">Sign in</Link>
            <a className="lp-btn lp-btn-ghost" href="#tour">Watch tour</a>
          </div>
        </div>

        <footer>
          <span>© 2026 AI Capital Planning OS</span>
          <span className="lp-mono">Decision support, not financial advice.</span>
        </footer>
      </div>
    </div>
  )
}
