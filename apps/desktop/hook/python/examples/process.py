"""
Example: Process execution interception demo.

Demonstrates the process hook intercepting os.system and subprocess calls.
When the hook is active (via sitecustomize.py), all process execution attempts
will be evaluated against security policies before being executed.
"""

import os
import subprocess

# Execute via os.system — the hook intercepts this and checks the command
os.system("echo foo")

# Execute via subprocess — the hook intercepts Popen (used internally by run())
subprocess.run(["echo", "bar"], shell=True)
