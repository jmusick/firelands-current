import importlib.util
import json
spec = importlib.util.spec_from_file_location('source_fetch', 'scripts/editorial/2026-10-24/research.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
r.directory = r.editorial_directory('2026-11-03')
sources = {
 'sandusky':'https://www.cityofsandusky.com/',
 'schools':'https://www.scs-k12.net/',
 'perkins':'https://perkinstownship.com/',
 'parks':'https://eriemetroparks.org/',
 'sea-grant':'https://ohioseagrant.osu.edu/news',
 'growth':'https://huroncountyohio.com/',
 'gsp':'https://greatersandusky.com/news/',
 'health':'https://eriehealthohio.com/news-page/',
 'glcap':'https://www.glcap.org/',
 'huron':'https://www.cityofhuron.org/',
 'monroeville':'https://www.monroevilleohio.com/',
 'port-clinton-schools':'https://www.pccsd.net/',
 'vermilion-schools':'https://www.vermilionschools.org/',
 'bgsu':'https://www.bgsu.edu/firelands/news.html',
 'ottawa-refuge':'https://www.fws.gov/refuge/ottawa',
 'norwalk-calendar':'https://www.norwalkoh.com/city-calendar',
 'huron-health':'https://www.huroncohealth.com/public-information',
 'oberlin':'https://cityofoberlin.com/',
 'castalia':'https://www.villageofcastalia.com/news',
 'airport':'https://www.sanduskycountyairport.com/about/',
}
if __name__ == '__main__':
 with r.concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  out = list(pool.map(r.fetch, sources.items()))
 (r.directory/'evidence'/'sources.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
 for row in out: print(row['key'],row.get('status',row.get('error')))

