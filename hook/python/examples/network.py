"""
Example: Network request interception demo.

Demonstrates the network hook intercepting urllib3 HTTP requests.
When the hook is active (via sitecustomize.py), outgoing HTTP requests
will be evaluated against security policies before being sent.
"""

import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("urllib3").setLevel(logging.INFO)

import urllib3

# Make an HTTP GET request — the hook intercepts this at the urllib3 layer
# and checks if the target host is allowed by security policies
resp = urllib3.request("GET", "https://jsonplaceholder.typicode.com/todos/1", body="body", timeout=3)
print(resp.json())
