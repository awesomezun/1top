"""Presentation regression checks against a read-only live snapshot and mocked mutations.

Run with system Python (Playwright installed). Never forwards control POSTs to real sessions.
"""
import json
from pathlib import Path
import sqlite3
import sys
import threading
import time
import urllib.request
from urllib.parse import parse_qs, urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'agent/onetop/dist'
sys.path.insert(0,str(ROOT/'agent'))
from onetop.time_ranges import extend_snapshot
with urllib.request.urlopen('http://127.0.0.1:18766/api/state') as response:
    snapshot = json.load(response)
snapshot['action_token'] = 'presentation-test-only'
calls = []
range_requests = []
held_period = None
range_started = threading.Event()
range_release = threading.Event()
history = sqlite3.connect(':memory:',check_same_thread=False)
history.executescript('''CREATE TABLE events(t REAL,sid TEXT,kind TEXT,fresh INTEGER,cached INTEGER,written INTEGER,output INTEGER,account TEXT);
    CREATE TABLE weekly_samples(account TEXT,kind TEXT,t REAL,pct REAL,reset REAL);''')
sample_session=next(s for s in snapshot['sessions'] if s.get('tokens') is not None)
history.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',
    [(snapshot['updated']-age,sample_session['id'],sample_session['kind'],n,0,0,0,None)
     for age,n in [(3600,100),(26*3600,200),(6*86400,300)]])
history.commit()


class Preview(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route == '/api/state':
            snapshot['updated'] = time.time()
            period=parse_qs(urlsplit(self.path).query).get('period',[None])[0]
            if period:
                range_requests.append(period)
                if period == held_period:
                    range_started.set()
                    range_release.wait(10)
                result=extend_snapshot(history,{**snapshot,'history_started':snapshot['updated']-7*86400},period)
            else: result=snapshot
            body, mime = json.dumps(result).encode(), 'application/json'
        elif route == '/api/updates': body, mime = b'{}', 'application/json'
        else:
            path = (DIST / ('index.html' if route == '/' else route.lstrip('/'))).resolve()
            if not path.is_relative_to(DIST) or not path.is_file(): self.send_error(404); return
            body = path.read_bytes()
            mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.json':'application/json'}.get(path.suffix,'application/octet-stream')
        self.send_response(200); self.send_header('Content-Type',mime); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        calls.append(payload)
        if payload.get('action') == 'rename':
            for key in ('sessions','root_sessions'):
                for session in snapshot.get(key,[]):
                    if session['id']==payload['session_id']: session['orca_terminal']['title']=payload['title']
        body=json.dumps({'ok':True,'message':'QA only','title':payload.get('title')}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)


server=ThreadingHTTPServer(('127.0.0.1',0),Preview)
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[];errors=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page(viewport={'width':1440,'height':1100},color_scheme='dark')
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}')
        page.locator('#sessionsBody tr').first.wait_for()
        page.wait_for_timeout(250)
        page.evaluate('document.fonts.ready')
        assert 'Plex' not in page.locator('body').evaluate('(e)=>getComputedStyle(e).fontFamily')
        assert '1top Wordmark' in page.locator('.brand-wordmark').evaluate('(e)=>getComputedStyle(e).fontFamily')
        assert not page.evaluate('performance.getEntriesByType("resource").some(r=>/\\.(woff2?|ttf)(?:$|\\?)/.test(r.name))')
        assert page.locator('#views [data-view=sessions]').evaluate('(e)=>getComputedStyle(e).boxShadow')=='none'
        checks.append('system UI font, preserved logo, no font requests or sidebar accent stripe')
        size=page.locator('.sessions-table').evaluate('(e)=>({table:e.scrollWidth,parent:e.parentElement.clientWidth,cols:[...e.querySelectorAll("col")].map(c=>c.style.width)})')
        assert size['table']<=size['parent']+1,size
        assert page.locator('#pageTitle').inner_text()=='대시보드'
        assert page.locator('.workspace').count()==0
        assert page.locator('#views button').evaluate_all('(xs)=>xs.map(x=>x.dataset.view)')==['sessions','accounts','maps','system','operations','benchmark']
        assert page.locator('#views [data-view=accounts] span').inner_text()=='계정 한도'
        assert page.locator('#views [data-view=maps] span').inner_text()=='사용량 맵'
        menu_x=page.locator('#views button>span').evaluate_all('(xs)=>xs.map(x=>x.getBoundingClientRect().x)')
        assert max(menu_x)-min(menu_x)<1,menu_x
        assert page.locator('#views [data-view=sessions]').evaluate('(e)=>getComputedStyle(e).fontWeight')=='650'
        assert page.locator('.session-actions [data-action]').count()>0
        assert page.locator('#sessionsBody td[data-column="memory"]').all_text_contents()
        assert all('%' in v or v.strip()=='—' for v in page.locator('#sessionsBody td[data-column="memory"]').all_text_contents())
        assert not page.locator('td[data-column="period"] .burn-gauge').count()
        assert not page.locator('.session-panel .panel-foot').is_visible()
        checks.append('preserved controls, separate period/rate, RAM percent')
        page.evaluate("const k='onetop.dashboard.v1',s=JSON.parse(localStorage.getItem(k));s.period='custom:9240';delete s.rangeScale;localStorage.setItem(k,JSON.stringify(s))")
        page.reload()
        page.wait_for_function("document.getElementById('sessionPeriodTitle').textContent==='최근 3시간'")
        checks.append('legacy 154-minute selection migrates once to the nearest fixed stop')
        assert page.locator('[data-rate-unit]').count()==0
        assert all('%/시간' in v for v in page.locator('.burn-gauge small').all_text_contents())
        assert page.locator('#fleetSpeed').is_visible()
        assert page.locator('#fleetSpeedValue').inner_text()!='—'
        assert page.locator('#fleetSpeedBand').evaluate('(c)=>c.tagName')=='CANVAS'
        assert page.locator('#fleetSpeedUnit').inner_text()=='tokens/시간'
        assert page.locator('#fleetSpeedTotal').count()==0
        assert page.locator('#fleetSpeedBand').evaluate('(c)=>Math.abs(Number(c.getAttribute("aria-valuenow"))-OneTopSpeed.measure(data,selectedPeriod).rate*3600)<.001')
        assert page.locator('#fleetSpeedBand').evaluate('(c)=>c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((n,i)=>i%4===3&&n>0)')
        assert page.locator('#sessionsView .range-buttons').evaluate('(e)=>Math.abs(e.getBoundingClientRect().right-e.closest(".range-toolbar").getBoundingClientRect().right)<1')
        before_speed=page.locator('#fleetSpeedValue').inner_text()
        page.locator('#providers [data-provider]').first.click()
        assert page.locator('#fleetSpeedValue').inner_text()==before_speed
        page.locator('#providers [data-provider][aria-pressed=true]').click()
        # Migrate saved layouts without resetting their panel order or dimensions.
        old_order=['map','summary','sessions','flow','shared']
        page.evaluate('(order)=>{const k="onetop.dashboard.v1",s=JSON.parse(localStorage.getItem(k));s.panels=order;s.heights.flow=350;localStorage.setItem(k,JSON.stringify(s))}',old_order)
        page.reload();page.locator('#fleetSpeedValue').wait_for()
        assert page.locator('#dashboardGrid>[data-panel]').evaluate_all('(xs)=>xs.map(x=>x.dataset.panel)')==['map','summary','speed','sessions','flow','shared']
        assert page.locator('[data-panel=flow]').evaluate('(e)=>e.style.minHeight')=='350px'
        # Restore normal test layout before existing drag and resize scenarios.
        page.evaluate('const k="onetop.dashboard.v1",s=JSON.parse(localStorage.getItem(k));s.panels=["summary","speed","flow","map","sessions","shared"];delete s.heights.flow;localStorage.setItem(k,JSON.stringify(s))')
        page.reload();page.locator('#fleetSpeedValue').wait_for()
        slider=page.locator('#sessionsView .duration-slider')
        def assert_range_geometry(view='sessions'):
            positions=page.locator(f'#{view}View .duration-slider').evaluate('''slider=>{
                const heading=slider.closest('.range-toolbar').querySelector('[data-range-label]');
                const positions=Array.from({length:Number(slider.max)+1},(_,i)=>{
                    slider.value=i;slider.dispatchEvent(new Event('input',{bubbles:true}));
                    const r=slider.getBoundingClientRect(),text=document.createRange();text.selectNodeContents(heading);
                    const gap=slider.closest('.range-buttons').getBoundingClientRect().left-text.getBoundingClientRect().right;
                    return {x:r.x,y:r.y,width:r.width,label:heading.textContent,fits:heading.scrollWidth<=heading.clientWidth,compact:innerWidth<=640||(gap>=0&&gap<=13&&heading.clientWidth<=100)};
                });
                slider.dispatchEvent(new Event('pointercancel'));
                return positions;
            }''')
            for axis in ['x','y','width']:
                assert max(p[axis] for p in positions)-min(p[axis] for p in positions)<0.1,(view,axis,positions)
            assert all(p['fits'] for p in positions),(view,positions)
            assert all(p['compact'] for p in positions),(view,positions)
        assert_range_geometry()
        def select_stop(position):
            slider.evaluate("(el,n)=>{el.value=n;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}",position)
        page.locator('#sessionsView [data-range-stop="6"]').click()
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes('5시간')")
        assert slider.is_visible()
        assert page.locator('.duration-value,.range-presets').count()==0
        assert page.locator('#sessionsView .range-ticks button').all_text_contents()==['10분','1시간','5시간','1일','1주일','1개월','전체']
        assert slider.get_attribute('max')=='18' and slider.get_attribute('step')=='1'
        assert page.locator('#rangeDialog,[data-custom-range],#rangeUnits').count()==0
        page.evaluate('window.qaSlider=document.querySelector("#sessionsView .duration-slider")')
        box=slider.bounding_box();before=len(range_requests)
        page.mouse.move(box['x']+box['width']*.35,box['y']+box['height']/2);page.mouse.down()
        page.mouse.move(box['x']+box['width']*.62,box['y']+box['height']/2,steps=12)
        preview=slider.get_attribute('aria-valuetext')
        assert page.locator('#sessionPeriodTitle').inner_text()=='최근 '+preview
        page.wait_for_timeout(3300)
        assert len(range_requests)==before
        assert page.evaluate('window.qaSlider===document.querySelector("#sessionsView .duration-slider")')
        assert page.locator('#sessionPeriodTitle').inner_text()=='최근 '+preview
        assert preview in ['10분','15분','30분','1시간','2시간','3시간','5시간','6시간','12시간','24시간','2일','3일','1주','2주','1개월','3개월','6개월','1년','전체 기록']
        page.mouse.up()
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes(document.querySelector('#sessionsView .duration-slider').getAttribute('aria-valuetext'))")
        assert len(range_requests)>before
        slider.focus();slider.press('Home');slider.press('ArrowRight')
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes('15분')")
        # Keep the existing chart and panel positions while a period response is pending.
        held_period='custom:604800'
        chart_before=page.locator('#tokenChart').evaluate('(c)=>c.toDataURL()')
        panel_y=page.locator('#sessionsView .token-flow-panel').bounding_box()['y']
        try:
            page.locator('#sessionsView [data-range-stop="12"]').click()
            assert range_started.wait(3)
            assert not page.locator('#notice').is_visible()
            assert page.locator('#tokenChart').is_visible()
            assert page.locator('#tokenChart').evaluate('(c)=>c.toDataURL()')==chart_before
            assert abs(page.locator('#sessionsView .token-flow-panel').bounding_box()['y']-panel_y)<0.1
        finally:
            held_period=None
            range_release.set()
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes('1주')")
        checks.append('pending period requests retain the graph without a loading banner or vertical layout shift')
        assert range_requests[-1]=='custom:604800'
        page.reload();page.wait_for_function("document.getElementById('sessionPeriodTitle').textContent==='최근 1주'")
        # Every detail page keeps the same single period label after removing the input.
        for view in ['accounts','maps']:
            page.locator(f'#views [data-view="{view}"]').click()
            assert page.locator(f'#{view}View [data-range-label]').inner_text()=='최근 1주'
            assert page.locator(f'#{view}View .duration-slider').is_visible()
            assert_range_geometry(view)
        page.locator('#views [data-view="sessions"]').click()
        select_stop(17)
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes('1년')")
        assert range_requests[-1]=='custom:31536000'
        page.locator('#sessionsView [data-range-stop="18"]').focus();page.keyboard.press('Enter')
        page.wait_for_function("document.getElementById('sessionPeriodTitle').textContent==='전체 기록'")
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes('전체 기록')")
        assert range_requests[-1]=='all'
        page.locator('#sessionsView [data-range-stop="0"]').click()
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes('10분')")
        select_stop(6)
        page.wait_for_function("document.getElementById('periodColumn').textContent.includes('5시간')")
        checks.append('clickable duration ticks and keyboard activation; one global speed panel, filter-independent totals and preserved saved layouts; live drag preview and synchronized detail periods')
        header=page.locator('th[data-column="memory"] .column-label')
        header.focus();page.keyboard.press('ArrowLeft');page.keyboard.press('Shift+ArrowRight')
        order=page.locator('.sessions-table th').evaluate_all('(xs)=>xs.map(x=>x.dataset.column)')
        assert order.index('memory')<order.index('cpu')
        width=page.locator('col[data-column="memory"]').evaluate('(e)=>parseFloat(e.style.width)')
        page.wait_for_timeout(3300)
        assert page.locator('.sessions-table th').evaluate_all('(xs)=>xs.map(x=>x.dataset.column)')==order
        assert page.locator('col[data-column="memory"]').evaluate('(e)=>parseFloat(e.style.width)')==width
        checks.append('column order and width survive polling')
        # Exercise mouse interactions as well as the accessible keyboard controls.
        page.locator('th[data-column="model"] .column-label').drag_to(page.locator('th[data-column="status"] .column-label'))
        order=page.locator('.sessions-table th').evaluate_all('(xs)=>xs.map(x=>x.dataset.column)')
        assert order.index('model')>order.index('status')
        handle=page.locator('th[data-column="memory"] .column-resize').bounding_box()
        grip=page.locator('th[data-column="memory"] .column-resize')
        assert grip.inner_text()==''
        assert grip.evaluate('(e)=>!e.closest("[draggable=true]")')
        order_before_resize=page.locator('.sessions-table th').evaluate_all('(xs)=>xs.map(x=>x.dataset.column)')
        assert grip.evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
        assert grip.evaluate('(e)=>getComputedStyle(e,"::after").width')=='1px'
        assert handle['width']>=14
        assert grip.evaluate('(e)=>getComputedStyle(e,"::after").backgroundColor')!='rgba(0, 0, 0, 0)'
        page.mouse.move(handle['x']+handle['width']/2,handle['y']+20);page.mouse.down()
        page.mouse.move(handle['x']+handle['width']/2+20,handle['y']+20);page.mouse.up()
        assert page.locator('col[data-column="memory"]').evaluate('(e)=>parseFloat(e.style.width)')==width+20
        assert page.locator('.sessions-table th').evaluate_all('(xs)=>xs.map(x=>x.dataset.column)')==order_before_resize
        checks.append('thin width handles resize without reordering; labels reorder columns')
        assert not page.locator('[data-panel="flow"] .panel-drag').is_visible()
        page.locator('#editDashboard').click()
        assert all('↔' not in text for text in page.locator('.column-resize,.panel-edit-tools').all_text_contents())
        move=page.locator('[data-panel="map"] .panel-drag');move.focus();page.keyboard.press('ArrowLeft')
        panel_order=page.locator('#dashboardGrid>[data-panel]').evaluate_all('(xs)=>xs.map(x=>x.dataset.panel)')
        assert panel_order.index('map')<panel_order.index('flow')
        resize=page.locator('[data-panel="flow"] .panel-resize');resize.focus();page.keyboard.press('ArrowDown')
        assert 'min-height:' in page.locator('[data-panel="flow"]').get_attribute('style')
        table_resize=page.locator('[data-panel="sessions"] .panel-resize');table_resize.focus();page.keyboard.press('ArrowUp')
        assert page.locator('[data-panel="sessions"]').evaluate('(e)=>!!e.style.height')
        assert page.locator('[data-panel="sessions"] .table-scroll').evaluate('(e)=>e.scrollHeight>e.clientHeight')
        page.locator('[data-panel="sessions"] .panel-heading').scroll_into_view_if_needed()
        page.locator('#editDashboard').click()
        assert not page.locator('[data-panel="flow"] .panel-drag').is_visible()
        checks.append('Edit-gated panel move and resize')
        def finish_transition():
            page.wait_for_function('!document.documentElement.dataset.preferenceTransition')
        page.locator('[data-theme-switch]').click()
        page.wait_for_function("document.getAnimations().some(a=>a.effect?.pseudoElement==='::view-transition-new(root)'&&a.playState==='running')")
        page.screenshot(path=str(ROOT/'build/theme-reveal-v3.24.0.png'))
        finish_transition();assert page.locator('html').get_attribute('data-theme')=='light'
        pref_x=page.locator('[data-theme-switch]').bounding_box()['x']
        page.locator('[data-language="en"]').click()
        page.wait_for_function("[...document.querySelectorAll('canvas')].some(c=>c.style.viewTransitionName==='onetop-matrix')")
        page.wait_for_timeout(240)
        assert page.evaluate("[...document.querySelectorAll('canvas')].filter(c=>c.style.viewTransitionName==='onetop-matrix').some(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((n,i)=>i%4===3&&n>0))")
        page.screenshot(path=str(ROOT/'build/language-reveal-v3.24.0.png'))
        finish_transition();assert page.locator('#pageTitle').inner_text()=='Dashboard'
        assert_range_geometry()
        assert abs(page.locator('[data-theme-switch]').bounding_box()['x']-pref_x)<1
        assert page.locator('#fleetSpeedUnit').inner_text()=='tokens/h'
        assert 'Weekly limit' in page.locator('#periodColumn').inner_text()
        assert page.locator('#search').get_attribute('placeholder')=='Search terminal, project or model'
        page.locator('[data-language="zh"]').click();finish_transition();assert page.locator('#pageTitle').inner_text()=='仪表盘'
        assert_range_geometry()
        assert abs(page.locator('[data-theme-switch]').bounding_box()['x']-pref_x)<1
        page.locator('[data-language="ko"]').click();finish_transition();assert page.locator('#pageTitle').inner_text()=='대시보드'
        page.evaluate("for(const lang of ['en','zh','ko'])document.querySelector('[data-language='+lang+']').click()")
        finish_transition();assert page.locator('#pageTitle').inner_text()=='대시보드'
        assert page.locator('canvas[style*="onetop-matrix"]').count()==0
        page.emulate_media(reduced_motion='reduce')
        page.locator('[data-language="en"]').click();assert page.locator('#pageTitle').inner_text()=='Dashboard'
        assert page.locator('html').get_attribute('data-preference-transition') is None
        page.locator('[data-language="ko"]').click()
        page.emulate_media(reduced_motion='no-preference')
        checks.append('circular theme reveal, rendered matrix language ring, rapid picks and reduced motion')
        assert page.locator('.brand-wordmark').evaluate('(e)=>getComputedStyle(e).color')=='rgb(25, 38, 43)'
        checks.append('light, dark, Korean, English and Chinese')
        rename=page.locator('[data-rename]').first
        if rename.count():
            rename.click();page.locator('#renameTitle').fill('QA 제목 $(not-a-command)')
            page.locator('#saveRename').click();page.wait_for_timeout(300)
            assert calls[-1]['action']=='rename' and calls[-1]['title']=='QA 제목 $(not-a-command)'
            assert not page.locator('#renameDialog').is_visible()
            checks.append('rename uses guarded action payload; no real mutation')
        page.evaluate("const k='onetop.dashboard.v1',s=JSON.parse(localStorage.getItem(k));s.unit='minute';localStorage.setItem(k,JSON.stringify(s))")
        page.reload();page.locator('#sessionsBody tr').first.wait_for();page.wait_for_timeout(300)
        assert '5시간' in page.locator('#periodColumn').inner_text()
        assert page.locator('html').get_attribute('data-theme')=='light'
        assert page.locator('[data-rate-unit]').count()==0
        assert all('%/시간' in v for v in page.locator('.burn-gauge small').all_text_contents())
        assert page.locator('.sessions-table th').evaluate_all('(xs)=>xs.map(x=>x.dataset.column)')==order
        assert page.locator('#dashboardGrid>[data-panel]').evaluate_all('(xs)=>xs.map(x=>x.dataset.panel)')==panel_order
        checks.append('preferences and layout survive reload')
        page.screenshot(path=str(ROOT/'build/dashboard-light-v3.24.0.png'),full_page=False)
        page.locator('[data-theme-switch]').click()
        finish_transition()
        page.screenshot(path=str(ROOT/'build/dashboard-dark-v3.24.0.png'),full_page=False)
        page.locator('[data-language="en"]').click();finish_transition()
        for width in (1100,768,390):
            page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(100)
            assert_range_geometry()
            if not page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'):
                page.screenshot(path=str(ROOT/f'build/dashboard-overflow-{width}-v3.24.0.png'))
                print(page.locator('body *').evaluate_all('(xs)=>xs.filter(e=>e.getBoundingClientRect().right>innerWidth+1&&!e.closest("[hidden],.table-scroll")).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,30)'),flush=True)
                raise AssertionError(width)
        checks.append('1100px, 768px and mobile layout')
        checks.append('all 19 duration labels preserve slider position and width across detail views, languages and narrow layouts')
        page.evaluate('localStorage.removeItem("onetop.dashboard.v1")')
        page.set_viewport_size({'width':1440,'height':1100});page.reload()
        page.locator('#sessionsBody tr').first.wait_for();page.wait_for_timeout(300)
        page.screenshot(path=str(ROOT/'build/dashboard-default-v3.24.0.png'),full_page=False)
        assert not errors,errors
        (ROOT/'build/dashboard-browser-v3.24.0.json').write_text(json.dumps({'checks':checks,'errors':errors},indent=2))
        print(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False))
        browser.close()
finally:
    server.shutdown();server.server_close()
    history.close()
