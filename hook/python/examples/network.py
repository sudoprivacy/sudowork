import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("urllib3").setLevel(logging.INFO)

import urllib3

resp = urllib3.request("GET", "https://jsonplaceholder.typicode.com/todos/1", body="body", timeout=3)
print(resp.json())
