"""Process execution interception subpackage — intercepts subprocess.Popen and os.system calls."""

from hook.process.common import ProcessData, ProcessCallback
from hook.process.interceptor import ProcessInterceptor
