"""
Example: File I/O interception demo.

Demonstrates the file hook intercepting built-in open() calls.
When the hook is active (via sitecustomize.py), both write and read operations
will be evaluated against security policies before proceeding.
"""

import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("urllib3").setLevel(logging.INFO)

# Write to a file — the hook intercepts this and checks if writing to "./foo" is allowed
with open("./foo", "w") as w:
    w.write("hello world")

# Read from a file — the hook intercepts this and checks if reading "./foo" is allowed
with open("./foo", "r") as r:
    print(r.read())
