from playwright.sync_api import sync_playwright
import re

test_queries = [
    "traffic night",
    "night driving",
    "highway night traffic",
    "city lights traffic",
    "rain night traffic",
    "street traffic night",
    "driving rain night",
    "city traffic dark",
    "car headlights night",
    "road night drive"
]

all_ids = set()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    
    for q in test_queries:
        context = browser.new_context(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        page = context.new_page()
        url = f"https://www.pexels.com/vi-vn/tim-kiem/videos/{q.replace(' ', '%20')}/?orientation=landscape"
        page.goto(url, wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        
        links = page.eval_on_selector_all('a[href*="/video/"]', 'els => els.map(e => e.href)')
        new_cnt = 0
        for l in links:
            m = re.search(r'/video/[^/]*?-?(\d+)/?', l)
            if m:
                vid = m.group(1)
                if vid not in all_ids:
                    all_ids.add(vid)
                    new_cnt += 1
        print(f"Query '{q}': New = {new_cnt}, Total = {len(all_ids)}")
        context.close()

    browser.close()
