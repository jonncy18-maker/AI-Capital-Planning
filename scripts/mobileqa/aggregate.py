import json,glob,os,collections
rs=[json.load(open(f)) for f in glob.glob('results/*__*.json')]
print('H-scroll in <main> (dark only):')
for r in sorted(rs,key=lambda r:(r['scene'],r['viewport'])):
    if r['theme']!='dark': continue
    if r.get('main') and r['main']['hScroll'] or r['docHScroll']:
        o=r['overflowOrigins'][:2]
        print(f"  {r['scene']:30} {r['viewport']:5} +{(r.get('main') or {}).get('overshootPx')}px doc={r['docHScroll']} ", [(x['component'],x['text'][:25],x['w']) for x in o])
print('errors:')
for r in rs:
    if r['errors'] and r['theme']=='dark' and r['viewport']==390: print(' ',r['scene'],r['errors'][:2])
print('overlays outside viewport / fab overlap:')
for r in rs:
    if r['theme']=='dark' and r['viewport'] in (360,390):
        if r['overlaysOutsideViewport']: print(' OVL',r['scene'],r['viewport'],[(o['component'],o['top'],o['bottom'],o['vh']) for o in r['overlaysOutsideViewport']][:2])
        if r['fabOverlap']: print(' FAB',r['scene'],r['viewport'],[(h['text'][:20],h['component']) for f in r['fabOverlap'] for h in f['hits']][:3])
