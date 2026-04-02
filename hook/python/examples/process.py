import os
import subprocess

os.system("echo foo")

subprocess.run(["echo", "bar"], shell=True)
