import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location('r', 'scripts/editorial/2026-11-03/research.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
sources = {
 'careers':'https://huroncountyohio.com/bac2026/',
 'food-drive':'https://perkinstownship.com/annual-food-drive/',
 'dark-skies':'https://ohioseagrant.osu.edu/news/calendar/2026/11/04/ememl/dark-skies-at-marinas',
 'marina-nov5':'https://ohioseagrant.osu.edu/news/calendar/2026/11/05/kra5y/ohio-clean-marinas',
 'marina-nov10':'https://ohioseagrant.osu.edu/news/calendar/2026/11/10/afivo/ohio-clean-marinas',
 'erie-elections':'https://www.boe.ohio.gov/erie/',
 'parks-brochure':'https://eriemetroparks.org/brochures/',
 'gsp':'https://greatersandusky.com/news/',
 'oak-harbor':'https://www.oakharbor.oh.us/newslist.php',
 'milan':'https://www.milanohio.gov/',
}
if __name__ == '__main__':
 if len(sys.argv)>1: sources={sys.argv[1]:sys.argv[2]}
 with r.r.concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: out=list(pool.map(r.r.fetch,sources.items()))
 (r.r.directory/'evidence'/('details-'+next(iter(sources))+'.json')).write_text(json.dumps(out,indent=2),encoding='utf-8')
 for row in out: print(row['key'],row.get('status',row.get('error')))

