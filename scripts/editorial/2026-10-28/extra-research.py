import sys,importlib.util,json
spec=importlib.util.spec_from_file_location('r','scripts/editorial/2026-10-24/research.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.directory=r.editorial_directory('2026-10-28')
sources={'jobsohio':'https://www.jobsohio.com/incentives-programs/support-for-small-businesses/jobsohio-small-business-grant','buyback':'https://eriemetroparks.org/buyback/','abc':'https://www.abcsupply.com/news-events/abc-supply-co-inc-acquires-the-assets-of-koch-building-products/','huron':'https://www.cityofhuron.org/','perkins-minutes':'https://perkinstownship.com/board-of-trustees/','bgsu':'https://www.bgsu.edu/firelands/news.html','huron-health':'https://www.huroncohealth.com/public-information','oak-harbor':'https://www.oakharbor.oh.us/newslist.php'}
with r.concurrent.futures.ThreadPoolExecutor(max_workers=8) as e: out=list(e.map(r.fetch,sources.items()))
(r.directory/'evidence'/'additional-sources.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
for x in out: print(x['key'],x.get('status',x.get('error')))
