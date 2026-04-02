import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("urllib3").setLevel(logging.INFO)

with open("./foo", "w") as w:
    w.write("hello world")

with open("./foo", "r") as r:
    print(r.read())
