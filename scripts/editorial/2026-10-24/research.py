"""Preserve primary-source pages for the October 24 editorial packet."""
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

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())


SOURCES = {
    'sandusky-leaves': 'https://www.cityofsandusky.com/news_detail_T12_R195.php',
    'sandusky-school-gold': 'https://www.scs-k12.net/protected/ArticleView.aspx?dasi=3GGI&iid=6IIYYGB',
    'sandusky-schools': 'https://www.scs-k12.net/',
    'school-news': 'https://www.scs-k12.net/News.aspx',
    'compost': 'https://huronlibrary.libcal.com/event/16889195',
    'huron-library-hours': 'https://www.huronlibrary.org/about-hpl/hours-location/',
    'cupcakes': 'https://milanberlin.librarycalendar.com/event/halloween-nailed-it-witch-cupcake-challenge-rr-c-4834',
    'autumn-walk': 'https://reservations.lovemyparks.com/programs/6046/',
    'ornaments': 'https://reservations.lovemyparks.com/programs/6049/',
    'erie-health': 'https://eriehealthohio.com/news-page/',
    'huron-city': 'https://www.cityofhuron.org/',
    'gsp': 'https://greatersandusky.com/news/',
    'huron-growth': 'https://huroncountyohio.com/',
    'sea-grant': 'https://ohioseagrant.osu.edu/news',
    'perkins': 'https://perkinstownship.com/',
    'monroeville': 'https://www.monroevilleohio.com/',
    'oberlin-library': 'https://www.oberlinlibrary.org/events',
    'amherst': 'https://amherstohio.org/',
    'fremont': 'https://fremontohio.org/residents/news-updates/',
    'huron-health': 'https://www.huroncohealth.com/public-information',
    'port-clinton-schools': 'https://www.pccsd.net/',
    'parish': 'https://sanduskycatholic.org/',
    'sandusky-library': 'https://www.sanduskylib.org/',
    'camp-street': 'https://cityofsandusky.com/city_projects/camp_street.php',
    'bellevue-library': 'https://www.bellevueohlibrary.org/',
    'bellevue-mystery': 'https://bellevue-lib.libcal.com/event/17538751',
    'amherst-road': 'https://amherstohio.org/cities-of-amherst-and-lorain-seek-comments-on-cooper-foster-park-road-rehabilitation/',
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
        result.update(status=response.status_code, final_url=response.url, sha256=hashlib.sha256(raw).hexdigest())
    except Exception as error:
        result['error'] = str(error)
    return result


if __name__ == '__main__':
    directory = editorial_directory('2026-10-24')
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(fetch, SOURCES.items()))
    (directory / 'evidence' / 'sources.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    for result in results:
        print(result['key'], result.get('status', result.get('error')))
