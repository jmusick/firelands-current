import sys,json
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('r','scripts/editorial/2026-10-24/research.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.directory=r.editorial_directory('2026-10-29')
sources={
'sandusky':'https://www.cityofsandusky.com/',
'volunteers':'https://www.cityofsandusky.com/news_detail_T12_R196.php',
'grants':'https://greatersandusky.com/state-offers-grants-of-up-to-50000/',
'glcap':'https://www.glcap.org/',
'sea-grant':'https://ohioseagrant.osu.edu/news',
'perkins':'https://perkinstownship.com/',
'camp':'https://cityofsandusky.com/city_projects/camp_street.php',
'parks':'https://eriemetroparks.org/',
'growth':'https://huroncountyohio.com/',
'schools':'https://www.scs-k12.net/',
'oberlin':'https://cityofoberlin.com/',
'monroeville':'https://www.monroevilleohio.com/',
'health':'https://eriehealthohio.com/news-page/',
'firelands-health':'https://www.firelands.com/medical-care/',
}
with r.concurrent.futures.ThreadPoolExecutor(max_workers=8) as e: out=list(e.map(r.fetch,sources.items()))
(r.directory/'evidence'/'sources.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for x in out: print(x['key'],x.get('status',x.get('error')))
