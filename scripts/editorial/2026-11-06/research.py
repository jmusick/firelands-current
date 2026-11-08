"""Preserve primary pages for the November 6 editorial budget."""
import concurrent.futures
import hashlib
import json
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from project_library import editorial_directory


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag == 'a':
            self.links.extend(value for key, value in attrs if key == 'href')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())


SOURCES = {
    'cedar-opening': 'https://www.sixflags.com/cedarpoint/events/opening-day',
    'cedar-events': 'https://www.sixflags.com/cedarpoint/events',
    'governor-zones': 'https://governor.ohio.gov/media/news-and-media/governor-dewine-announces-260-new-opportunity-zones-across-ohio',
    'development-zones': 'https://development.ohio.gov/business/state-incentives/ohio-opportunity-zones',
    'harbor-complete': 'https://www.army.mil/article/296582/sandusky_harbor_dredging_completed_benefits_local_beach_nourishment',
    'turkey-approved': 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news/ohios-spring-2027-turkey-hunting-seasons-updated-bass-fishing-regulations-approved-by-wildlife-council',
    'bay-view': 'https://villageofbayview.com/',
    'berlin-township': 'https://www.berlintwp.us/',
    'governor-rendered': 'https://governor.ohio.gov/wps/portal/gov/governor/media/news-and-media/governor-dewine-announces-260-new-opportunity-zones-across-ohio',
    'development-rendered': 'https://development.ohio.gov/wps/portal/gov/development/business/state-incentives/ohio-opportunity-zones',
    'turkey-rendered': 'https://ohiodnr.gov/wps/portal/gov/odnr/discover-and-learn/safety-conservation/about-ODNR/news/ohios-spring-2027-turkey-hunting-seasons-updated-bass-fishing-regulations-approved-by-wildlife-council',
    'school-election': 'https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIY300',
    'school-award': 'https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIY3YI',
    'county-jobs': 'https://www.eriecounty.oh.gov/content.aspx?id=26854',
    'odnr-news': 'https://ohiodnr.gov/discover-and-learn/safety-conservation/about-ODNR/news',
    'sea-grant': 'https://ohioseagrant.osu.edu/news',
    'glcap': 'https://www.glcap.org/blog/',
    'sandusky': 'https://www.cityofsandusky.com/',
    'huron': 'https://www.cityofhuron.org/',
    'milan': 'https://www.milanohio.gov/',
    'erie-parks': 'https://eriemetroparks.org/',
    'county-parks': 'https://www.lovemyparks.com/',
    'health': 'https://eriehealthohio.com/news-page/',
    'growth': 'https://huroncountyohio.com/',
    'partnership': 'https://greatersandusky.com/news/',
    'port-clinton-schools': 'https://www.pccsd.net/',
    'oberlin': 'https://cityofoberlin.com/',
    'monroeville': 'https://www.monroevilleohio.com/',
    'perkins': 'https://perkinstownship.com/',
    'hayes': 'https://www.rbhayes.org/news/',
}


def fetch(item):
    key, url = item
    result = {'key': key, 'url': url, 'checked_at': datetime.now(timezone.utc).isoformat()}
    try:
        response = requests.get(url, timeout=25)
        raw = response.content
        (directory / 'evidence' / (key + '.html')).write_bytes(raw)
        response.encoding = response.apparent_encoding
        parser = PageText()
        parser.feed(response.text)
        (directory / 'evidence' / (key + '.txt')).write_text('\n'.join(parser.parts), encoding='utf-8')
        (directory / 'evidence' / (key + '-links.json')).write_text(json.dumps(parser.links, indent=2), encoding='utf-8')
        result.update(status=response.status_code, final_url=response.url, sha256=hashlib.sha256(raw).hexdigest())
    except Exception as error:
        result['error'] = str(error)
    return result


if __name__ == '__main__':
    directory = editorial_directory('2026-11-06')
    if len(sys.argv) == 3:
        SOURCES = {sys.argv[1]: sys.argv[2]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(fetch, SOURCES.items()))
    (directory / 'evidence' / ('sources-' + (sys.argv[1] if len(sys.argv) == 3 else 'sweep') + '.json')).write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    for result in results:
        print(result['key'], result.get('status', result.get('error')))

